/**
 * Subscription flush semantics: the shallow top-level diff wake-up, event
 * coalescing, and db generation reads (subscriptions serve the last flushed
 * generation, not the live db).
 */
import { regEvent } from '../events';
import { dispatch } from '../router';
import { initAppDb, getAppDb, updateAppDb, flushSubscriptions, getRenderDb } from '../db';
import { regSub, getOrCreateReaction, getSubscriptionValue } from '../subs';
import { clearReactions } from '../registrar';
import { waitForScheduled, waitForAnimationFrame, waitForReaction } from './test-utils';
import { produce } from 'immer';

const waitForFlush = async () => {
  await waitForAnimationFrame();
  await waitForReaction();
};

describe('Subscription flush', () => {
  regSub('flush-counter');
  regSub('flush-other');
  regSub('flush-double', (counter) => counter * 2, () => [['flush-counter']]);

  regEvent('flush-inc', ({ draftDb }) => {
    draftDb['flush-counter'] += 1;
  });
  regEvent('flush-noop', () => { });
  regEvent('flush-del-other', ({ draftDb }) => {
    delete draftDb['flush-other'];
  });

  beforeEach(() => {
    clearReactions();
    initAppDb({ 'flush-counter': 0, 'flush-other': 'unchanged' });
  });

  describe('db generation reads', () => {
    it('should serve the last flushed generation between commit and flush', async () => {
      const reaction = getOrCreateReaction(['flush-counter']);
      const callback = jest.fn();
      reaction.watch(callback);
      expect(reaction.getSnapshot()).toBe(0);

      dispatch(['flush-inc']);
      await waitForScheduled();

      // The event committed: the live db is ahead of the render generation
      expect(getAppDb()['flush-counter']).toBe(1);
      expect(getRenderDb()['flush-counter']).toBe(0);

      // Every subscription read — cached or fresh — serves the flushed
      // generation, so nothing on screen can mix db versions
      expect(reaction.getSnapshot()).toBe(0);
      expect(getSubscriptionValue(['flush-counter'])).toBe(0);
      expect(getSubscriptionValue(['flush-double'])).toBe(0);
      expect(callback).not.toHaveBeenCalled();

      await waitForFlush();

      expect(getRenderDb()['flush-counter']).toBe(1);
      expect(reaction.getSnapshot()).toBe(1);
      expect(getSubscriptionValue(['flush-double'])).toBe(2);
      expect(callback).toHaveBeenCalledWith(1);

      reaction.unwatch(callback);
    });

    it('should serve current data to reactions created after the flush', async () => {
      dispatch(['flush-inc']);
      await waitForScheduled();
      await waitForFlush();

      expect(getSubscriptionValue(['flush-double'])).toBe(2);
    });
  });

  describe('event coalescing', () => {
    it('should coalesce several events into a single flush and notification', async () => {
      const reaction = getOrCreateReaction(['flush-double']);
      const callback = jest.fn();
      reaction.watch(callback);
      expect(reaction.getSnapshot()).toBe(0);

      dispatch(['flush-inc']);
      dispatch(['flush-inc']);
      dispatch(['flush-inc']);
      await waitForScheduled();
      await waitForFlush();

      // One notification with the final value, not one per event
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(6);

      reaction.unwatch(callback);
    });
  });

  describe('shallow top-level diff wake-up', () => {
    it('should not wake subscriptions whose root key kept its reference', async () => {
      const counterReaction = getOrCreateReaction(['flush-counter']);
      const otherReaction = getOrCreateReaction(['flush-other']);
      const counterCallback = jest.fn();
      const otherCallback = jest.fn();
      counterReaction.watch(counterCallback);
      otherReaction.watch(otherCallback);
      counterReaction.getSnapshot();
      otherReaction.getSnapshot();

      dispatch(['flush-inc']);
      await waitForScheduled();
      await waitForFlush();

      expect(counterCallback).toHaveBeenCalledWith(1);
      expect(otherCallback).not.toHaveBeenCalled();

      counterReaction.unwatch(counterCallback);
      otherReaction.unwatch(otherCallback);
    });

    it('should not schedule anything when the handler leaves the db untouched', async () => {
      const dbBefore = getAppDb();

      dispatch(['flush-noop']);
      await waitForScheduled();

      // produce returned the same reference: no new generation committed
      expect(getAppDb()).toBe(dbBefore);
      expect(getRenderDb()).toBe(dbBefore);
    });

    it('should wake subscriptions when a top-level key is deleted', async () => {
      const reaction = getOrCreateReaction(['flush-other']);
      const callback = jest.fn();
      reaction.watch(callback);
      expect(reaction.getSnapshot()).toBe('unchanged');

      dispatch(['flush-del-other']);
      await waitForScheduled();
      await waitForFlush();

      expect(callback).toHaveBeenCalledWith(undefined);

      reaction.unwatch(callback);
    });
  });

  describe('flushSubscriptions', () => {
    it('should be a no-op when nothing was committed since the last flush', () => {
      const reaction = getOrCreateReaction(['flush-counter']);
      const callback = jest.fn();
      reaction.watch(callback);
      reaction.getSnapshot();

      flushSubscriptions(true);

      expect(callback).not.toHaveBeenCalled();
      reaction.unwatch(callback);
    });

    it('should recompute and notify synchronously when called with sync=true', () => {
      const reaction = getOrCreateReaction(['flush-double']);
      const callback = jest.fn();
      reaction.watch(callback);
      expect(reaction.getSnapshot()).toBe(0);

      updateAppDb(produce(getAppDb(), (draft: any) => {
        draft['flush-counter'] = 5;
      }));
      flushSubscriptions(true);

      expect(callback).toHaveBeenCalledWith(10);
      expect(reaction.getSnapshot()).toBe(10);

      reaction.unwatch(callback);
    });
  });
});
