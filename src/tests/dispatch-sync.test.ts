import { regEvent, regEventErrorHandler, defaultErrorHandler } from '../events';
import { regEffect } from '../fx';
import { dispatch, dispatchSync } from '../router';
import { initAppDb, getAppDb } from '../db';
import { regSub, getOrCreateReaction, getSubscriptionValue } from '../subs';
import { clearReactions } from '../registrar';
import { waitForScheduled, waitForAnimationFrame, waitForReaction } from './test-utils';

describe('dispatchSync', () => {
  regSub('ds-counter');
  regSub('ds-double', (counter) => counter * 2, () => [['ds-counter']]);

  regEvent('ds-inc', ({ draftDb }) => {
    draftDb['ds-counter'] += 1;
  });

  beforeEach(() => {
    clearReactions();
    initAppDb({ 'ds-counter': 0 });
  });

  it('should commit the db synchronously', () => {
    dispatchSync(['ds-inc']);

    expect(getAppDb()['ds-counter']).toBe(1);
    expect(getSubscriptionValue(['ds-counter'])).toBe(1);
  });

  it('should notify subscription watchers before returning', () => {
    const reaction = getOrCreateReaction(['ds-double']);
    const callback = jest.fn();
    reaction.watch(callback);
    expect(reaction.getSnapshot()).toBe(0);

    dispatchSync(['ds-inc']);

    // No queue tick, no animation frame: the watcher already ran
    expect(callback).toHaveBeenCalledWith(2);
    expect(reaction.getSnapshot()).toBe(2);

    reaction.unwatch(callback);
  });

  it('should run effects synchronously', () => {
    const captured: any[] = [];
    regEffect('ds-capture', (value) => {
      captured.push(value);
    });
    regEvent('ds-with-effect', () => {
      return [['ds-capture', 'ran']];
    });

    dispatchSync(['ds-with-effect']);

    expect(captured).toEqual(['ran']);
  });

  it('should flush changes committed by earlier async dispatches too', async () => {
    const reaction = getOrCreateReaction(['ds-double']);
    const callback = jest.fn();
    reaction.watch(callback);
    reaction.getSnapshot();

    // Async event commits but its animation-frame flush is still pending
    dispatch(['ds-inc']);
    await waitForScheduled();
    expect(callback).not.toHaveBeenCalled();

    // The sync flush promotes everything committed so far, in one shot
    dispatchSync(['ds-inc']);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(4);

    // The still-pending scheduled flush finds nothing left to do
    await waitForAnimationFrame();
    await waitForReaction();
    expect(callback).toHaveBeenCalledTimes(1);

    reaction.unwatch(callback);
  });

  it('should throw when called from within an event handler', () => {
    regEvent('ds-reentrant', () => {
      dispatchSync(['ds-inc']);
    });

    expect(() => dispatchSync(['ds-reentrant'])).toThrow(/dispatchSync/);
    // The inner event never ran
    expect(getAppDb()['ds-counter']).toBe(0);

    regEventErrorHandler(defaultErrorHandler);
  });

  it('should throw when called from within an effect handler', () => {
    // Effects run inside the event's interceptor chain, so the guard covers
    // them too: a sync reentrant commit mid-chain is just as unsafe there
    let effectError: Error | undefined;
    regEffect('ds-reentrant-effect', () => {
      try {
        dispatchSync(['ds-inc']);
      } catch (e: any) {
        effectError = e;
      }
    });
    regEvent('ds-with-reentrant-effect', ({ draftDb }) => {
      draftDb['ds-counter'] += 10;
      return [['ds-reentrant-effect']];
    });

    dispatchSync(['ds-with-reentrant-effect']);

    expect(effectError).toBeDefined();
    expect(String(effectError?.message)).toMatch(/dispatchSync/);
    // The outer event committed; the reentrant one never ran
    expect(getAppDb()['ds-counter']).toBe(10);
  });

  it('should propagate handler errors to the caller', () => {
    regEvent('ds-boom', () => {
      throw new Error('sync boom');
    });

    expect(() => dispatchSync(['ds-boom'])).toThrow('sync boom');

    regEventErrorHandler(defaultErrorHandler);
  });

  it('should reject invalid event vectors without throwing', () => {
    dispatchSync([] as any);

    expectLogCall('error', '[reflex] invalid dispatchSync event vector.');
  });
});
