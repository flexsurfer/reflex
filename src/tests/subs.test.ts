import { regSub, getOrCreateReaction, getSubscriptionValue, hasNonSerializableSubParam } from '../subs';
import { initAppDb } from '../db';
import { hasReaction, clearReactions, sweepProvisionalReactions } from '../registrar';
import { waitForAnimationFrame, waitForReaction } from './test-utils';

describe('Subscription registry lifecycle', () => {
  regSub('sweep-todos');
  regSub('sweep-count', (todos) => (todos || []).length, () => [['sweep-todos']]);

  const countKey = JSON.stringify(['sweep-count']);
  const rootKey = JSON.stringify(['sweep-todos']);

  beforeEach(() => {
    initAppDb({ 'sweep-todos': [1, 2, 3] });
    clearReactions();
  });

  describe('provisional reaction sweep (aborted renders)', () => {
    it('should sweep reactions that never went live after one full grace cycle', () => {
      // Simulates a render that never commits: the reaction (and its root
      // dependency) are created but subscribe() never runs
      expect(getSubscriptionValue(['sweep-count'])).toBe(3);
      expect(hasReaction(countKey)).toBe(true);
      expect(hasReaction(rootKey)).toBe(true);

      // First flush cycle: still within the grace period
      sweepProvisionalReactions();
      expect(hasReaction(countKey)).toBe(true);
      expect(hasReaction(rootKey)).toBe(true);

      // Second flush cycle: never went live, swept
      sweepProvisionalReactions();
      expect(hasReaction(countKey)).toBe(false);
      expect(hasReaction(rootKey)).toBe(false);
    });

    it('should keep reactions that go live during the grace period', () => {
      const reaction = getOrCreateReaction(['sweep-count']);
      sweepProvisionalReactions();

      // Late subscribe (e.g. a slow-committing render) inside the grace cycle
      const callback = () => { };
      reaction.watch(callback);

      sweepProvisionalReactions();
      sweepProvisionalReactions();
      expect(hasReaction(countKey)).toBe(true);
      expect(hasReaction(rootKey)).toBe(true);

      // Normal dispose path still prunes immediately once unwatched
      reaction.unwatch(callback);
      expect(hasReaction(countKey)).toBe(false);
      expect(hasReaction(rootKey)).toBe(false);
    });

    it('should recreate swept reactions transparently on the next read', () => {
      getSubscriptionValue(['sweep-count']);
      sweepProvisionalReactions();
      sweepProvisionalReactions();
      expect(hasReaction(countKey)).toBe(false);

      // Sweeping is safe: a later read (or subscribe) recreates and recomputes
      expect(getSubscriptionValue(['sweep-count'])).toBe(3);
      expect(hasReaction(countKey)).toBe(true);
    });

    it('should sweep via the runtime scheduler without manual sweeps or db updates', async () => {
      // A render-like read on an app that never dispatches afterwards
      getSubscriptionValue(['sweep-count']);
      expect(hasReaction(countKey)).toBe(true);
      expect(hasReaction(rootKey)).toBe(true);

      // Let the self-scheduled sweep run its grace cycle and deletion cycle
      for (let i = 0; i < 3; i++) {
        await waitForAnimationFrame();
        await waitForReaction();
      }

      expect(hasReaction(countKey)).toBe(false);
      expect(hasReaction(rootKey)).toBe(false);
    });

    it('should not sweep reactions that went live, via the runtime scheduler', async () => {
      const reaction = getOrCreateReaction(['sweep-count']);
      const callback = () => { };
      reaction.watch(callback);

      for (let i = 0; i < 3; i++) {
        await waitForAnimationFrame();
        await waitForReaction();
      }

      expect(hasReaction(countKey)).toBe(true);
      expect(hasReaction(rootKey)).toBe(true);

      reaction.unwatch(callback);
    });
  });

  describe('subscription key contract', () => {
    it('should flag params that do not survive JSON serialization', () => {
      expect(hasNonSerializableSubParam([new Map()])).toBe(true);
      expect(hasNonSerializableSubParam([new Set([1])])).toBe(true);
      expect(hasNonSerializableSubParam([() => 1])).toBe(true);
      expect(hasNonSerializableSubParam([1, undefined])).toBe(true);
    });

    it('should flag non-serializable values at any nesting depth', () => {
      expect(hasNonSerializableSubParam([{ x: undefined }])).toBe(true);
      expect(hasNonSerializableSubParam([{ m: new Map() }])).toBe(true);
      expect(hasNonSerializableSubParam([[undefined]])).toBe(true);
      expect(hasNonSerializableSubParam([{ a: { b: [() => 1] } }])).toBe(true);
      expect(hasNonSerializableSubParam([{ filters: { tags: new Set() } }])).toBe(true);
    });

    it('should flag values that degrade or break JSON.stringify', () => {
      expect(hasNonSerializableSubParam([Symbol('x')])).toBe(true);
      expect(hasNonSerializableSubParam([BigInt(1)])).toBe(true);
      expect(hasNonSerializableSubParam([{ big: BigInt(1) }])).toBe(true);
      expect(hasNonSerializableSubParam([/abc/])).toBe(true);
      expect(hasNonSerializableSubParam([NaN])).toBe(true);
      expect(hasNonSerializableSubParam([Infinity])).toBe(true);
    });

    it('should detect circular structures without throwing', () => {
      const circular: any = { a: 1 };
      circular.self = circular;
      expect(hasNonSerializableSubParam([circular])).toBe(true);

      const deepCircular: any = { level1: { level2: {} } };
      deepCircular.level1.level2.back = deepCircular;
      expect(hasNonSerializableSubParam([deepCircular])).toBe(true);
    });

    it('should not flag shared (diamond) references that JSON can serialize', () => {
      const shared = { id: 1 };
      expect(hasNonSerializableSubParam([{ x: shared, y: shared }])).toBe(false);
      expect(hasNonSerializableSubParam([[shared, shared]])).toBe(false);
    });

    it('should accept plain serializable params', () => {
      expect(hasNonSerializableSubParam([])).toBe(false);
      expect(hasNonSerializableSubParam([1, 'a', true, null])).toBe(false);
      expect(hasNonSerializableSubParam([{ id: 1 }, [1, 2]])).toBe(false);
      expect(hasNonSerializableSubParam([{ a: { b: [1, 'x', null] } }])).toBe(false);
      expect(hasNonSerializableSubParam([new Date(0)])).toBe(false); // has toJSON
    });
  });
});
