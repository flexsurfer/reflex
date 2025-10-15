import type { Interceptor } from './types';

// Global store for settings
interface Store {
  globalInterceptors: Interceptor[];
}

const store: Store = {
  globalInterceptors: []
};

/**
 * Private function to replace a global interceptor with the same ID
 */
function replaceGlobalInterceptor(globalInterceptors: Interceptor[],  interceptor: Interceptor): Interceptor[] {
  return globalInterceptors.reduce((ret: Interceptor[], existingInterceptor: Interceptor) => {
    if (interceptor.id === existingInterceptor.id) {
      return [...ret, interceptor];
    } else {
      return [...ret, existingInterceptor];
    }
  }, []);
}

/**
 * Register a global interceptor
 */
export function regGlobalInterceptor(interceptor: Interceptor): void {
  const { id } = interceptor;
  const ids = store.globalInterceptors.map(i => i.id);
  
  if (ids.includes(id)) {
    // If the id already exists we replace it in-place to maintain the ordering of
    // global interceptors esp during hot-code reloading in development.
    store.globalInterceptors = replaceGlobalInterceptor(store.globalInterceptors, interceptor);
  } else {
    store.globalInterceptors = [...store.globalInterceptors, interceptor];
  }
}

/**
 * Get all global interceptors
 */
export function getGlobalInterceptors(): Interceptor[] {
  return [...store.globalInterceptors];
}

/**
 * Clear global interceptors - either all or by specific ID
 */
export function clearGlobalInterceptors(): void;
export function clearGlobalInterceptors(id: string): void;
export function clearGlobalInterceptors(id?: string): void {
  if (id === undefined) {
    store.globalInterceptors = [];
  } else {
    store.globalInterceptors = store.globalInterceptors.filter(interceptor => interceptor.id !== id);
  }
}

