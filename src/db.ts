import type { Db, DefaultAppDb } from './types';
import { getReaction, getRootSubIdBySource } from './registrar';
import { consoleLog } from './loggers';
import { scheduleAfterRender } from './schedule';
import type { Reaction } from './reaction';

// The live db: events read it (via produce) and commit new generations to it.
let appDb: any = {};
// The last flushed generation: everything render-facing (root subscription
// handlers, and therefore the whole reaction graph) reads this one. It only
// advances in flushSubscriptions, so between an event's commit and the next
// flush all subscriptions — alive caches and newly mounting components alike —
// serve one consistent db generation instead of a mixed-version window.
let renderDb: any = {};

let flushScheduled = false;

// Keeps T out of inference so the DefaultAppDb default applies: without it,
// T infers from `value` and an augmented AppDb would never be checked.
type NoInfer<T> = [T][T extends any ? 0 : never];

export function initAppDb<T = DefaultAppDb>(value: Db<NoInfer<T>>): void {
  appDb = value;
  // A fresh init is a new baseline, not a change to react to: any pending
  // flush sees renderDb === appDb and no-ops.
  renderDb = value;
}

export function getAppDb<T = DefaultAppDb>(): Db<T> {
  return appDb as Db<T>;
}

/**
 * The db generation subscriptions read from. Internal: root subscription
 * handlers go through this so reads are consistent with the flush cycle.
 */
export function getRenderDb<T = DefaultAppDb>(): Db<T> {
  return renderDb as Db<T>;
}

/**
 * Commit a new db generation produced by an event handler and schedule the
 * subscription flush. Immer's structural sharing makes the change detection
 * here (and the per-key diff at flush time) a pure reference comparison:
 * untouched state keeps its identity, changed paths get fresh objects.
 */
export function updateAppDb<T = Record<string, any>>(newDb: Db<T>): void {
  if (newDb === appDb) {
    return;
  }
  appDb = newDb;
  if (!flushScheduled) {
    flushScheduled = true;
    scheduleAfterRender(() => {
      flushScheduled = false;
      flushSubscriptions();
    });
  }
}

/**
 * Promote the live db to the render generation and wake the root reactions
 * whose top-level key actually changed, found with a shallow reference diff
 * (`old[k] !== new[k]`). Consecutive events between two flushes coalesce into
 * a single diff against the previously flushed generation.
 *
 * With `sync = true` (dispatchSync) the affected subgraphs are recomputed and
 * watchers notified before returning, instead of on the microtask queue.
 */
export function flushSubscriptions(sync: boolean = false): void {
  if (renderDb === appDb) {
    return;
  }
  const oldDb = renderDb;
  const newDb = appDb;
  renderDb = newDb;

  const dirtyRoots: Reaction<any>[] = [];
  const keys = new Set([...Object.keys(oldDb), ...Object.keys(newDb)]);
  for (const key of keys) {
    if (oldDb[key] === newDb[key]) {
      continue;
    }

    const subId = getRootSubIdBySource(key);
    if (!subId) {
      continue;
    }

    const reaction = getReaction(JSON.stringify([subId]));
    if (!reaction) {
      continue;
    }
    if (!reaction.isRoot) {
      consoleLog('error', `[reflex] flushSubscriptions: root reaction id ${subId} registered with a computed function. This is not allowed.`);
      continue;
    }

    reaction.markDirty();
    dirtyRoots.push(reaction);
  }

  if (sync) {
    // Mark-all-then-recompute keeps reactions depending on several roots from
    // recomputing (and notifying) once per root.
    for (const reaction of dirtyRoots) {
      reaction.recomputeTreeSync();
    }
  }
}
