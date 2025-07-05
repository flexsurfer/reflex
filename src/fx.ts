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
  
    effects.filter(effect => Array.isArray(effect) && effect.length === 2).forEach(([key, val]) => {
  
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

regEffect('dispatch-later', (value: DispatchLaterEffect) => {
  dispatchLater(value);
});

regEffect('dispatch', (value: EventVector) => {
  if (!Array.isArray(value)) {
    consoleLog('error', '[reflex] ignoring bad dispatch value. Expected a vector, but got:', value);
    return;
  }
  dispatch(value);
})
