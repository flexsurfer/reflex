import type {
  EventVector,
  Interceptor,
  Context,
  CoEffects,
  InterceptorDirection,
  TraceErrorTag
} from './types';

import { getHandler } from './registrar';
import { mergeTrace } from './trace';

/**
 * Attach a JSON-serializable description of an interceptor/handler exception
 * to the current event trace, so devtools/MCP can report why the event
 * failed. `e` may be the wrapped reflex error (with `.data`/`.cause`) or a
 * raw error from the no-error-handler path.
 */
function traceError(e: any, eventV: EventVector): void {
  const original = e?.cause ?? e;
  const error: TraceErrorTag = {
    phase: 'handler',
    message: String(original?.message ?? original),
    stack: typeof original?.stack === 'string' ? original.stack : undefined,
    interceptor: e?.data?.interceptor,
    direction: e?.data?.direction,
    eventV
  };
  mergeTrace({ tags: { error } });
}

export function isInterceptor(m: any): m is Interceptor {
  if (typeof m !== 'object' || m === null) return false;
  const keys = new Set(Object.keys(m));
  // Must have 'id' field
  if (!keys.has('id')) return false;
  // Must have at least one of 'before' or 'after'
  if (!keys.has('before') && !keys.has('after')) return false;
  return true;
}

function exceptionToExInfo(e: Error, interceptor: Interceptor, direction: InterceptorDirection): Error & { data: any } {
  const ex = new Error(`Interceptor Exception: ${e.message}`);
  (ex as any).data = { direction, interceptor: interceptor.id, originalError: e };
  (ex as any).cause = e;
  return ex as Error & { data: any };
}

function mergeExData(e: Error, ...ms: any[]): Error & { data: any } {
  const ex = new Error(e.message);
  (ex as any).data = Object.assign({}, (e as any).data, ...ms);
  (ex as any).cause = (e as any).cause;
  return ex as Error & { data: any };
}

function invokeInterceptorFn(context: Context, interceptor: Interceptor, direction: InterceptorDirection): Context {
  const fn = interceptor[direction];
  if (!fn) return context;

  if (context.originalException) {
    return fn(context);
  }

  try {
    return fn(context);
  } catch (e: any) {
    throw exceptionToExInfo(e, interceptor, direction);
  }
}

function invokeInterceptors(context: Context, direction: InterceptorDirection): Context {
  let ctx = { ...context };

  // For both before and after, we process from the queue
  // Before: queue contains interceptors to process, stack is where we accumulate processed interceptors  
  // After: queue contains reversed interceptors to process, stack is unused
  while (ctx.queue.length > 0) {
    const [next, ...rest] = ctx.queue;

    ctx = invokeInterceptorFn(
      {
        ...ctx,
        queue: rest,
        stack: direction === 'before' ? [...ctx.stack, next] : ctx.stack
      },
      next,
      direction
    );
  }

  return ctx;
}

function changeDirection(context: Context): Context {
  return {
    ...context,
    queue: [...context.stack].reverse(),
    stack: []
  };
}

function createContext(eventV: EventVector, interceptors: Interceptor[]): Context {
  // Db-shape agnostic: the real draft is injected by eventHandlerInterceptor,
  // so this placeholder must not be typed against an augmented AppDb.
  const coeffects: CoEffects<Record<string, any>> = {
    event: eventV,
    draftDb: {}
  };

  return {
    coeffects,
    effects: [],
    queue: [...interceptors],
    stack: [],
    originalException: false
  };
}

function executeInterceptors(ctx: Context): Context {
  const ctxAfterBeforePhase = invokeInterceptors(ctx, 'before');
  const ctxChangedDirection = changeDirection(ctxAfterBeforePhase);
  return invokeInterceptors(ctxChangedDirection, 'after');
}

/**
 * Execute interceptor chain with given event and interceptors
 */
export function execute(eventV: EventVector, interceptors: Interceptor[]): Context {
  const ctx = createContext(eventV, interceptors);
  const errorHandler = getHandler('error', 'event-handler') as ((original: Error, reflex: Error & { data: any }) => void) | undefined;
  if (!errorHandler) {
    try {
      return executeInterceptors({ ...ctx, originalException: true });
    } catch (e: any) {
      traceError(e, eventV);
      throw e;
    }
  }
  try {
    return executeInterceptors(ctx);
  } catch (e: any) {
    const reflexError = mergeExData(e, { eventV });
    traceError(reflexError, eventV);
    errorHandler((e as any).cause || e, reflexError);
    return ctx; // Return original context if error handler doesn't throw
  }
}
