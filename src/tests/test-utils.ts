/**
 * Shared test utilities for proper async event handling
 */

import type { EventVector } from '../types';

/**
 * Wait for all scheduled callbacks to complete.
 * This accounts for the different scheduling mechanisms used by scheduleNextTick:
 * - setImmediate (React Native)
 * - MessageChannel (Web)
 * - setTimeout (fallback)
 */
export const waitForScheduled = async () => {
  // Wait for setImmediate (React Native priority)
  if (typeof (globalThis as any).setImmediate === 'function') {
    await new Promise(resolve => (globalThis as any).setImmediate(resolve));
    return;
  }
  
  // Wait for MessageChannel (Web priority)
  if (typeof MessageChannel !== 'undefined') {
    await new Promise(resolve => {
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = () => resolve(undefined);
      port2.postMessage(undefined);
    });
    return;
  }
  
  // Wait for setTimeout fallback
  await new Promise(resolve => setTimeout(resolve, 0));
};

/**
 * Wait for animation frame scheduling
 */
export const waitForAnimationFrame = async () => {
  if (typeof requestAnimationFrame !== 'undefined') {
    await new Promise(resolve => requestAnimationFrame(resolve));
  } else {
    await new Promise(resolve => setTimeout(resolve, 16));
  }
};

/**
 * Wait for reaction recomputation (which uses queueMicrotask)
 */
export const waitForReaction = async () => {
  await new Promise(resolve => queueMicrotask(() => resolve(undefined)));
};

/**
 * Wait for both event processing and reaction recomputation.
 * Use this when you need to ensure both the event queue and reactions have settled.
 */
export const waitForEventAndReaction = async () => {
  await waitForScheduled();
  await waitForReaction();
};

/**
 * Helper to create events with meta
 */
export const createEventWithMeta = (eventId: string, meta: Record<string, any>): EventVector => {
  const event = [eventId] as EventVector;
  (event as any).meta = meta;
  return event;
};

