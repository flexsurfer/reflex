import type { Id, EventVector, EventHandler, EventParams, DefaultAppDb, Interceptor, Context, Db, Effects, ErrorHandler, TraceErrorTag } from './types';
import { getHandler, registerHandler, getInterceptors, setInterceptors } from './registrar';
import { consoleLog } from './loggers';
import * as interceptor from './interceptor';
import { getInjectCofxInterceptor } from './cofx';
import { doFxInterceptor } from './fx';
import type { Draft } from 'immer';
import { enablePatches, produceWithPatches } from 'immer';
import { getAppDb } from './db';
import { getGlobalInterceptors } from './settings';
import { mergeTrace, withTrace } from './trace';
import { IS_DEV } from './env';

const KIND = 'event';

// When the app augments EventPayloads, handler params are checked against the
// declared payload tuple for K (undeclared ids stay `any[]`). When the app
// augments AppDb, draftDb is typed without passing a generic. Note: an
// explicit db generic (`regEvent<MyDb>(id, handler)`) fixes K to `Id`, which
// suppresses payload inference — prefer augmenting AppDb, or annotate the
// coeffects param inline (`({ draftDb }: CoEffects<MyDb>, ...)`) instead.
/** Register an event handler with only a handler function (db event) */
export function regEvent<T = DefaultAppDb, K extends Id = Id>(id: K, handler: EventHandler<T, EventParams<K>>): void;
/** Register an event handler with interceptors and handler function (backward compatibility) */
export function regEvent<T = DefaultAppDb, K extends Id = Id>(id: K, handler: EventHandler<T, EventParams<K>>, interceptors: Interceptor<T>[]): void;
/** Register an event handler with cofx and handler function */
export function regEvent<T = DefaultAppDb, K extends Id = Id>(id: K, handler: EventHandler<T, EventParams<K>>, cofx: [Id, ...any[]][]): void;
/** Register an event handler with cofx, interceptors and handler function */
export function regEvent<T = DefaultAppDb, K extends Id = Id>(id: K, handler: EventHandler<T, EventParams<K>>, cofx: [Id, ...any[]][], interceptors: Interceptor<T>[]): void;
export function regEvent<T = Record<string, any>>(id: Id, handler: EventHandler<T>, cofxOrInterceptors?: [Id, ...any[]][] | Interceptor<T>[], interceptors?: Interceptor<T>[]): void {

  registerHandler(KIND, id, handler);

  registerInterceptors(id, cofxOrInterceptors, interceptors);
}

// Utility function to check if an array looks like cofx (array of arrays) vs interceptors (array of objects)
function isCofxArray(arr: any[]): arr is [Id, ...any[]][] {
  return arr.length > 0 && Array.isArray(arr[0]);
}

function registerInterceptors<T = Record<string, any>>(id: Id, cofxOrInterceptors?: [Id, ...any[]][] | Interceptor<T>[], interceptors?: Interceptor<T>[]): void {
  let cofx: string[][] | undefined;
  let finalInterceptors: Interceptor<T>[] | undefined;

  if (cofxOrInterceptors) {
    if (isCofxArray(cofxOrInterceptors)) {
      // cofxOrInterceptors is cofx
      cofx = cofxOrInterceptors;
      finalInterceptors = interceptors;
    } else {
      // cofxOrInterceptors is interceptors (backward compatibility)
      cofx = undefined;
      finalInterceptors = cofxOrInterceptors as Interceptor<T>[];
    }
  }

  // Create interceptors from cofx specifications
  const cofxInterceptors: Interceptor[] = [];
  if (cofx) {
    for (const cofxSpec of cofx) {
      if (cofxSpec.length === 1) {
        // Simple cofx like ['now']
        cofxInterceptors.push(getInjectCofxInterceptor(cofxSpec[0]));
      } else if (cofxSpec.length === 2) {
        // Cofx with value like ['random', 42]
        cofxInterceptors.push(getInjectCofxInterceptor(cofxSpec[0], cofxSpec[1]));
      } else {
        consoleLog('warn', '[reflex] invalid cofx specification:', cofxSpec);
      }
    }
  }

  // Validate provided interceptors
  const validatedInterceptors: Interceptor[] = [];
  if (finalInterceptors) {
    for (const interceptorCandidate of finalInterceptors) {
      if (interceptor.isInterceptor(interceptorCandidate)) {
        validatedInterceptors.push(interceptorCandidate);
      } else {
        consoleLog('error', '[reflex] invalid interceptor provided for event:', id, 'interceptor:', interceptorCandidate);
      }
    }
  }

  // Merge cofx interceptors with valid provided interceptors
  const allInterceptors = [...cofxInterceptors, ...validatedInterceptors];

  if (allInterceptors.length > 0) {
    setInterceptors(id, allInterceptors as Interceptor[]);
  }
}

// Enable the patches plugin for Immer
enablePatches();

// -- Interceptor Factories -------------------------------------------

function eventHandlerInterceptor(handler: EventHandler<any>): Interceptor {
  return {
    id: 'fx-handler',
    before(context: Context) {
      const event = context.coeffects.event;
      const params = event.slice(1); // Extract parameters excluding the event ID

      let effects: Effects = [];
      const [newDb, patches, reversePatches] = produceWithPatches(getAppDb<Db>(),
        (draftDb: Draft<Db>) => {
          const coeffectsWithDb = { ...context.coeffects, draftDb };
          effects = handler(coeffectsWithDb, ...params) || [];
        });

      if (IS_DEV) {
        try {
          JSON.stringify(effects);
        } catch (e) {
          consoleLog('warn', `[reflex] Effects ${effects} contain Proxy (probably an Immer draft). Use current() for draftDb values.`);
        }
      }
      
      context.newDb = newDb;
      context.patches = patches;

      mergeTrace({ tags: { 'patches': patches, 'reversePatches': reversePatches, 'effects': effects } });

      if (!Array.isArray(effects)) {
        consoleLog('warn', `[reflex] effects expects a vector, but was given ${typeof effects}`);
      } else {
        context.effects = [...(context.effects || []), ...effects];
      }

      return context;
    }
  }
}

export const injectGlobalInterceptors: Interceptor = {
  id: 'inject-global-interceptors',
  before(context) {
    const globals = getGlobalInterceptors();
    context.queue = [...globals, ...context.queue];
    return context;
  }
};

export function handle(eventV: EventVector): void {
  const eventId: Id = eventV[0];
  const handler = getHandler(KIND, eventId) as EventHandler<any> | undefined;

  if (!handler) {
    consoleLog('error', `[reflex] no event handler registered for:`, eventId);
    // Record the failed dispatch in the trace pipeline so devtools/MCP can
    // surface typo'd event ids, not just the console.
    const error: TraceErrorTag = { phase: 'missing-handler', message: `no event handler registered for: ${eventId}`, eventV };
    withTrace(
      { operation: eventId, opType: KIND, tags: { event: eventV, error } },
      () => { }
    );
    return;
  }

  // Get custom interceptors for this event, or use defaults
  const customInterceptors = getInterceptors(eventId);
  const interceptors = [
    doFxInterceptor,
    injectGlobalInterceptors,
    ...customInterceptors,
    eventHandlerInterceptor(handler)
  ]

  withTrace(
    { operation: eventId, opType: KIND, tags: { event: eventV } },
    () => {
      interceptor.execute(eventV, interceptors);
    }
  );
}

/**
 * Register the given event error handler function that will catch unhandled exceptions
 * thrown in the interceptors/handler chain.
 *
 * Only one handler can be registered. Registering a new handler clears the existing handler.
 *
 * This handler function has the signature:
 * `(originalError: Error, reflexError: Error & { data: any }) => void`
 *
 * - `originalError`: A platform-native Error object.
 *    Represents the original error thrown by user code.
 *    This is the error you see when no handler is registered.
 *
 * - `reflexError`: An Error object with additional data.
 *    Includes the stacktrace of reflex's internal functions,
 *    and extra data about the interceptor process.
 *    Access `reflexError.data` to get this info.
 *
 *    The data includes:
 *    - `interceptor`: the `id` of the throwing interceptor.
 *    - `direction`: `'before'` or `'after'`.
 *    - `eventV`: the reflex event which invoked this interceptor.
 */
export function regEventErrorHandler(handler: ErrorHandler): void {
  registerHandler('error', 'event-handler', handler);
}

/**
 * Default error handler that logs errors to console
 */
export function defaultErrorHandler(originalError: Error, reflexError: Error & { data: any }): void {
  consoleLog('error', '[reflex] Interceptor Exception:', {
    originalError,
    reflexError,
    data: reflexError.data
  });
  
  // Re-throw the original error to maintain normal error propagation
  throw originalError;
}

// Register the default error handler
regEventErrorHandler(defaultErrorHandler);