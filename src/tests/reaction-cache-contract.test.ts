import { Reaction } from '../reaction';
import { regEvent } from '../events';
import { dispatch } from '../router';
import { initAppDb } from '../db';
import { clearReactions } from '../registrar';
import { getOrCreateReaction, getSubscriptionValue, regSub } from '../subs';
import { waitForAnimationFrame, waitForReaction, waitForScheduled } from './test-utils';

const waitForFlush = async () => {
  await waitForAnimationFrame();
  await waitForReaction();
};

const waitForMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('Reaction cache contract after mount cascade fix', () => {
  regSub('cache-items');
  regSub('cache-count', (items: number[]) => (items || []).length, () => [['cache-items']]);
  regSub('cache-even-items', (items: number[]) => (items || []).filter((item) => item % 2 === 0), () => [['cache-items']]);
  regSub('cache-even-count', (items: number[]) => items.length, () => [['cache-even-items']]);
  regSub('cache-revive-source');
  regSub('cache-revive-double', (value: number) => value * 2, () => [['cache-revive-source']]);

  regEvent('cache-add-item', ({ draftDb }, item: number) => {
    draftDb['cache-items'].push(item);
  });
  regEvent('cache-set-revive-source', ({ draftDb }, value: number) => {
    draftDb['cache-revive-source'] = value;
  });

  beforeEach(() => {
    clearReactions();
    initAppDb({
      'cache-items': [1],
      'cache-revive-source': 1,
    });
  });

  it('refreshes a dormant cached subscription after the db flush', async () => {
    const reaction = getOrCreateReaction(['cache-count']);

    expect(reaction.computeValue()).toBe(1);

    dispatch(['cache-add-item', 2]);
    await waitForScheduled();

    // The event committed, but subscriptions still read the last flushed
    // generation until the scheduled flush promotes renderDb.
    expect(getSubscriptionValue(['cache-count'])).toBe(1);

    await waitForFlush();

    // The reaction was never watched, so it did not receive scheduled
    // recomputes. The next read must still validate through the root and see
    // the flushed generation.
    expect(reaction.computeValue()).toBe(2);
  });

  it('updates an alive child through an unwatched shared parent', async () => {
    const reaction = getOrCreateReaction(['cache-even-count']);
    const callback = jest.fn();

    reaction.watch(callback);
    expect(reaction.getSnapshot()).toBe(0);

    dispatch(['cache-add-item', 2]);
    await waitForScheduled();
    await waitForFlush();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(1);
    expect(reaction.getSnapshot()).toBe(1);

    reaction.unwatch(callback);
  });

  it('re-resolves disposed dependencies on revival and refreshes stale values', async () => {
    const reaction = getOrCreateReaction(['cache-revive-double']);
    const callback = jest.fn();

    reaction.watch(callback);
    expect(reaction.getSnapshot()).toBe(2);

    reaction.unwatch(callback);

    dispatch(['cache-set-revive-source', 3]);
    await waitForScheduled();
    await waitForFlush();

    const revivedCallback = jest.fn();
    reaction.watch(revivedCallback);

    expect(reaction.getSnapshot()).toBe(6);
    expect(revivedCallback).not.toHaveBeenCalled();

    reaction.unwatch(revivedCallback);
  });

  it('keeps diamond graphs correct when the shared root changes identity', async () => {
    let rootValue = { n: 1 };
    let leftRuns = 0;
    let rightRuns = 0;
    let topRuns = 0;

    const root = Reaction.create(() => rootValue);
    const left = Reaction.create((value) => {
      leftRuns++;
      return value.n + 1;
    }, [root]);
    const right = Reaction.create((value) => {
      rightRuns++;
      return value.n + 2;
    }, [root]);
    const top = Reaction.create((leftValue, rightValue) => {
      topRuns++;
      return leftValue + rightValue;
    }, [left, right]);
    const callback = jest.fn();

    top.watch(callback);
    expect(top.computeValue()).toBe(5);
    expect(leftRuns).toBe(1);
    expect(rightRuns).toBe(1);
    expect(topRuns).toBe(1);

    rootValue = { n: 2 };
    root.markDirty();
    await waitForMicrotasks();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(7);
    expect(top.getSnapshot()).toBe(7);
    expect(leftRuns).toBe(2);
    expect(rightRuns).toBe(2);
    expect(topRuns).toBe(2);

    top.unwatch(callback);
  });

  it('lets computed equality stop downstream propagation after equal recompute', async () => {
    let source = { items: [1, 2] };
    let mappedRuns = 0;
    let lengthRuns = 0;

    const root = Reaction.create(() => source);
    const mapped = Reaction.create((value) => {
      mappedRuns++;
      return value.items.map((item: number) => item);
    }, [root]);
    const length = Reaction.create((items) => {
      lengthRuns++;
      return items.length;
    }, [mapped]);
    const callback = jest.fn();

    length.watch(callback);
    expect(length.computeValue()).toBe(2);
    expect(mappedRuns).toBe(1);
    expect(lengthRuns).toBe(1);

    // New root identity means the mapped subscription must re-run. Its fresh
    // array is deeply equal to the previous result, so the mapped version does
    // not bump and the downstream length subscription stays cached.
    source = { items: [1, 2] };
    root.markDirty();
    await waitForMicrotasks();

    expect(mappedRuns).toBe(2);
    expect(lengthRuns).toBe(1);
    expect(callback).not.toHaveBeenCalled();
    expect(length.getSnapshot()).toBe(2);

    length.unwatch(callback);
  });

  it('caches computed undefined results as real values', () => {
    let source = { selected: undefined as string | undefined };
    let selectedRuns = 0;

    const root = Reaction.create(() => source);
    const selected = Reaction.create((value) => {
      selectedRuns++;
      return value.selected;
    }, [root]);

    expect(selected.computeValue()).toBeUndefined();
    expect(selectedRuns).toBe(1);

    // `undefined` is a valid cached result, not a sentinel for "never
    // computed". With unchanged dep versions, the computed node must stay
    // cached instead of re-running on every read.
    expect(selected.computeValue()).toBeUndefined();
    expect(selectedRuns).toBe(1);
  });

  it('notifies when a computed value changes to and from undefined', async () => {
    let source = { selected: undefined as string | undefined };

    const root = Reaction.create(() => source);
    const selected = Reaction.create((value) => value.selected, [root]);
    const callback = jest.fn();

    selected.watch(callback);
    expect(selected.computeValue()).toBeUndefined();

    source = { selected: 'a' };
    root.markDirty();
    await waitForMicrotasks();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenLastCalledWith('a');
    expect(selected.getSnapshot()).toBe('a');

    source = { selected: undefined };
    root.markDirty();
    await waitForMicrotasks();

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith(undefined);
    expect(selected.getSnapshot()).toBeUndefined();

    selected.unwatch(callback);
  });

  it('documents that same-reference mutable roots do not invalidate dependents', async () => {
    const source = { n: 1 };
    let childRuns = 0;

    const root = Reaction.create(() => source);
    const child = Reaction.create((value) => {
      childRuns++;
      return value.n;
    }, [root]);
    const callback = jest.fn();

    child.watch(callback);
    expect(child.computeValue()).toBe(1);
    expect(childRuns).toBe(1);

    // This is intentionally not a supported Reflex db update pattern. Db roots
    // are immutable snapshots from Immer; changed roots get new identities.
    source.n = 2;
    root.markDirty();
    await waitForMicrotasks();

    expect(childRuns).toBe(1);
    expect(callback).not.toHaveBeenCalled();
    expect(child.getSnapshot()).toBe(1);

    child.unwatch(callback);
  });
});
