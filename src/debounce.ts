import type { EventVector, Id } from './types';
import { dispatch } from './router';

// Storage for timeout IDs keyed by event keys
const timeout = new Map<Id, ReturnType<typeof setTimeout>>();

/**
 * Clears a specific timeout by event key
 */
export function clear(eventKey: Id): void {
  const eventTimeout = timeout.get(eventKey);
  if (eventTimeout) {
    clearTimeout(eventTimeout);
    timeout.delete(eventKey);
  }
}

/**
 * Clears all active timeouts
 */
export function clearAll(): void {
  for (const [, timeoutId] of timeout) {
    clearTimeout(timeoutId);
  }
  timeout.clear();
}

/**
 * Dispatches `event` iff it was not dispatched for the duration of `durationMs`.
 * Cancels any existing timeout for the same event and sets a new one.
 */
export function debounceAndDispatch(event: EventVector, durationMs: number): void {
  const eventKey = event[0];
  clear(eventKey);
  
  const timeoutId = setTimeout(() => {
    timeout.delete(eventKey);
    dispatch(event);
  }, durationMs);
  
  timeout.set(eventKey, timeoutId);
}

// Storage for throttle state keyed by event keys
const throttle = new Map<Id, boolean>();

/**
 * Dispatches event and ignores subsequent calls for the duration of `durationMs`.
 * Unlike debouncing, this dispatches immediately on the first call.
 */
export function throttleAndDispatch(event: EventVector, durationMs: number): void {
  const eventKey = event[0];
  
  if (!throttle.get(eventKey)) {
    throttle.set(eventKey, true);
    
    setTimeout(() => {
      throttle.delete(eventKey);
    }, durationMs);
    
    dispatch(event);
  }
}
