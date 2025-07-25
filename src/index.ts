// Re-export main functionality
export { initAppDb, getAppDb } from './db';

export { regEvent, regEventErrorHandler, defaultErrorHandler } from './events';
export { regSub, getSubscriptionValue } from './subs';
export { regEffect } from './fx';
export { regCoeffect } from './cofx';
export { regGlobalInterceptor, getGlobalInterceptors, clearGlobalInterceptors, setDebugEnabled, isDebugEnabled } from './settings';
export { getHandler, clearHandlers, clearReactions, clearSubs } from './registrar';

export { dispatch } from './router';
export { debounceAndDispatch, throttleAndDispatch } from './debounce'
export { useSubscription } from './hook';
export { 
  registerHotReloadCallback, 
  triggerHotReload, 
  clearHotReloadCallbacks, 
  useHotReload, 
  useHotReloadKey, 
  setupSubsHotReload, 
  HotReloadWrapper 
} from './hot-reload';

// Trace
export { enableTracing, disableTracing, registerTraceCb, enableTracePrint } from './trace';

// Re-export types for external use
export type {
  EventVector,
  EventHandler,
  Interceptor,
  Id,
  SubVector,
  Db,
  Effects,
  CoEffects,
  CoEffectHandler,
  EffectHandler,
  Context,
  DispatchLaterEffect,
  ErrorHandler
} from './types';