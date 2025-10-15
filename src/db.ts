import type { Db } from './types';
import { getReaction } from './registrar';
import { consoleLog } from './loggers';
import { scheduleAfterRender } from './schedule';

let appDb: any = {};

// Module-level reactions queue to store subVectorKey values
const reactionsQueue = new Set<string>();
let reactionsScheduled = false;

export function initAppDb<T = Record<string, any>>(value: Db<T>): void {
  appDb = value;
}

export function getAppDb<T = Record<string, any>>(): Db<T> {
  return appDb as Db<T>;
}

/**
 * Internal function to update the app database with pre-computed newDb and patches
 * @param newDb - The new database state
 * @param patches - Array of patches from Immer
 */
export function updateAppDbWithPatches<T = Record<string, any>>(newDb: Db<T>, patches: any[]): void {
  if (patches.length > 0) {
    appDb = newDb;

    for (const patch of patches) {
      const pathSegments = patch.path;
      if (pathSegments.length > 0) {
        const rootKey = pathSegments[0] as string;
        const subVectorKey = JSON.stringify([rootKey])
        const reaction = getReaction(subVectorKey);
        if (reaction) {
          if (!reaction.isRoot) {
            consoleLog('error', `[reflex] updateAppDb: root reaction id ${subVectorKey} registered with a computed function. This is not allowed.`)
            continue;
          }

          reactionsQueue.add(subVectorKey);
        }
      }
    }

    // Schedule all reaction updates after render (only if not already scheduled)
    if (reactionsQueue.size > 0 && !reactionsScheduled) {
      reactionsScheduled = true;
      scheduleAfterRender(() => {
        // Process all reactions in the queue
        // withTrace({ opType: 'raf' }, () => {
        for (const subVectorKey of reactionsQueue) {
          const reaction = getReaction(subVectorKey);
          if (reaction) {
            reaction.markDirty();
          }
        }
        // withTrace({ opType: 'raf-end' }, () => { });
        //withTrace({ opType: 'reagent/quiescent' }, () => { });
        //});

        // Empty the queue after processing
        reactionsQueue.clear();
        // Reset the scheduled flag
        reactionsScheduled = false;
      });
    }
  }
}