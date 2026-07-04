import type {
  EffectHandler,
  EffectParams,
  Context,
  DispatchLaterEffect,
  DispatchVector,
  Id,
  Interceptor,
  EventVector,
  TraceErrorTag
} from './types';
import { dispatch } from './router';
import { updateAppDbWithPatches } from './db';
import { getHandler, registerHandler } from './registrar';
import { consoleLog } from './loggers';
import { mergeTrace } from './trace';

// -- Registration -------------------------------------------------------

const KIND = 'fx';

// When the app augments EffectPayloads, the handler's value param is checked
// against the declared payload for K (undeclared ids stay `any`).
export function regEffect<K extends Id = Id>(id: K, handler: EffectHandler<EffectParams<K>>): void {
  registerHandler(KIND, id, handler);
}

// -- Interceptor --------------------------------------------------------

export const doFxInterceptor: Interceptor = {
  id: 'do-fx',
  after: (context: Context): Context => {
    
    if (context.newDb && context.patches) {
      updateAppDbWithPatches(context.newDb, context.patches);
    }

    const effects = context.effects;
    
    if (!Array.isArray(effects)) {
      consoleLog('warn', `[reflex] effects expects a vector, but was given ${typeof effects}`);
      return context;
    }
  
    const effectErrors: TraceErrorTag[] = [];

    effects.forEach((effect: unknown) => {

      if (!effect) {
        return;
      }

      if (!Array.isArray(effect) || effect.length === 0 || effect.length > 2) {
        consoleLog('warn', `[reflex] invalid effect in effects:`, effect);
        return;
      }
      const [key, val] = effect;

      const effectFn = getHandler(KIND, key) as EffectHandler | undefined;
      if (effectFn) {
        try {
          effectFn(val);
        } catch (error: any) {
          consoleLog('error', `[reflex] error in effects for ${key}:`, error);
          effectErrors.push({
            phase: 'effect',
            effect: key,
            message: String(error?.message ?? error),
            stack: typeof error?.stack === 'string' ? error.stack : undefined
          });
        }
      } else {
        consoleLog('warn', `[reflex] in 'effects' found ${key} which has no associated handler. Ignoring.`);
      }
    });

    // Runs inside the event's withTrace scope, so failed effects land on the
    // event's own trace for devtools/MCP.
    if (effectErrors.length > 0) {
      mergeTrace({ tags: { effectErrors } });
    }

    return context;
  }
};

// -- Constants ---------------------------------------------------------

export const DISPATCH_LATER = 'dispatch-later';
export const DISPATCH = 'dispatch';

// -- Built-in Effect Handlers ------------------------------------------

function dispatchLater(effect: DispatchLaterEffect): void {
  const { ms, dispatch: eventToDispatch } = effect;

  if (!Array.isArray(eventToDispatch) || typeof ms !== 'number') {
    consoleLog('error', '[reflex] ignoring bad dispatch-later value:', effect);
    return;
  }

  if (ms < 0) {
    consoleLog('warn', '[reflex] dispatch-later effect with negative delay:', ms);
  }
  // Cast: effect payloads are untyped at runtime; DispatchVector only narrows
  // for app code that augments EventPayloads.
  setTimeout(() => dispatch(eventToDispatch as DispatchVector), Math.max(0, ms));
}

regEffect(DISPATCH_LATER, (value: DispatchLaterEffect) => {
  dispatchLater(value);
});

regEffect(DISPATCH, (value: EventVector) => {
  if (!Array.isArray(value)) {
    consoleLog('error', '[reflex] ignoring bad dispatch value. Expected a vector, but got:', value);
    return;
  }
  dispatch(value as DispatchVector);
})
