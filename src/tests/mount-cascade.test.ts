/**
 * Regression guard for mount recompute cascades: newly mounting subscribers
 * must reuse clean cached values of shared parent subscriptions instead of
 * re-running them once per mount. By-id row subs over a shared sorted list is
 * the recommended pattern, so this is the hot path.
 */
import { regEvent } from '../events';
import { dispatch } from '../router';
import { initAppDb } from '../db';
import { regSub, getOrCreateReaction } from '../subs';
import { clearReactions } from '../registrar';
import { waitForScheduled, waitForAnimationFrame, waitForReaction } from './test-utils';

describe('Mount recompute cascades', () => {
  const ROWS = 50;

  let sortCount = 0;

  regSub('mc-items');
  regSub('mc-sorted', (items: any[]) => {
    sortCount++;
    return [...(items || [])].sort((a, b) => a.order - b.order);
  }, () => [['mc-items']]);
  regSub('mc-by-id', (sorted: any[], id: number) => {
    return sorted.find((item) => item.id === id);
  }, () => [['mc-sorted']]);

  beforeEach(() => {
    clearReactions();
    sortCount = 0;
    initAppDb({
      'mc-items': Array.from({ length: ROWS }, (_, i) => ({ id: i, order: ROWS - i }))
    });
  });

  it('should run a shared parent sub once while many by-id subscribers mount', () => {
    const cleanups: Array<() => void> = [];

    // Mimic what useSubscription does per row: read a snapshot during render,
    // then subscribe on commit
    for (let id = 0; id < ROWS; id++) {
      const reaction = getOrCreateReaction(['mc-by-id', id]);
      expect(reaction.getSnapshot()).toEqual({ id, order: ROWS - id });
      const callback = () => { };
      reaction.watch(callback);
      cleanups.push(() => reaction.unwatch(callback));
    }

    // The sorted list was computed once, not once per mounting row
    expect(sortCount).toBe(1);

    for (const cleanup of cleanups) cleanup();
  });

  it('should recompute the shared parent once per flush when data changes', async () => {
    regEvent('mc-reorder', ({ draftDb }) => {
      draftDb['mc-items'][0].order = 999;
    });

    const cleanups: Array<() => void> = [];
    for (let id = 0; id < ROWS; id++) {
      const reaction = getOrCreateReaction(['mc-by-id', id]);
      reaction.getSnapshot();
      const callback = () => { };
      reaction.watch(callback);
      cleanups.push(() => reaction.unwatch(callback));
    }
    expect(sortCount).toBe(1);

    dispatch(['mc-reorder']);
    await waitForScheduled();
    await waitForAnimationFrame();
    await waitForReaction();

    // One re-sort for the whole flush, regardless of subscriber count
    expect(sortCount).toBe(2);

    for (const cleanup of cleanups) cleanup();
  });
});
