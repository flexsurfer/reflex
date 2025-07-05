import type {
  Context,
  Interceptor,
  CoEffectHandler,
  CoEffects
} from './types';
import { registerHandler, getHandler } from './registrar';
import { consoleLog } from './loggers';

// -- Registration -----------------------------------------------------------

const KIND = 'cofx';

export function regCoeffect(id: string, handler: CoEffectHandler): void {
  registerHandler(KIND, id, handler);
}

// -- Interceptor -------------------------------------------------------------

export function getInjectCofxInterceptor(id: string): Interceptor;
export function getInjectCofxInterceptor(id: string, value: any): Interceptor;
export function getInjectCofxInterceptor(id: string, value?: any): Interceptor {
  return {
    id: `inject-${id}`,
    before: (context: Context): Context => {
      const handler = getHandler(KIND, id) as CoEffectHandler | undefined;
      if (handler) {
        try {
          context.coeffects = handler({ ...context.coeffects }, value);
        } catch (error) {
          consoleLog('error', `[reflex] Error in :${id} coeffect handler:`, error);
        }
      } else {
        consoleLog('error', '[reflex] No cofx handler registered for', id);
      }
      return context;
    }
  };
}

// -- Builtin CoEffects Handlers ---------------------------------------------

// Handler for now, injects current timestamp
regCoeffect('now', (coeffects: CoEffects): CoEffects => ({
  ...coeffects,
  now: Date.now()
}));

// Handler for random, injects a random number
regCoeffect('random', (coeffects: CoEffects): CoEffects => ({
  ...coeffects,
  random: Math.random()
}));
