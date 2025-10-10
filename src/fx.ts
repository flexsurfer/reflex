import type {
  EffectHandler,
  Context,
  DispatchLaterEffect,
  Interceptor,
  EventVector
} from './types';
import { dispatch } from './router';
import { updateAppDbWithPatches } from './db';
import { getHandler, registerHandler } from './registrar';
import { consoleLog } from './loggers';

// -- Registration -------------------------------------------------------

const KIND = 'fx';

export function regEffect(id: string, handler: EffectHandler): void {
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
        } catch (error) {
          consoleLog('error', `[reflex] error in effects for ${key}:`, error);
        }
      } else {
        consoleLog('warn', `[reflex] in 'effects' found ${key} which has no associated handler. Ignoring.`);
      }
    });

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
  setTimeout(() => dispatch(eventToDispatch), Math.max(0, ms));
}

regEffect(DISPATCH_LATER, (value: DispatchLaterEffect) => {
  dispatchLater(value);
});

regEffect(DISPATCH, (value: EventVector) => {
  if (!Array.isArray(value)) {
    consoleLog('error', '[reflex] ignoring bad dispatch value. Expected a vector, but got:', value);
    return;
  }
  dispatch(value);
})
