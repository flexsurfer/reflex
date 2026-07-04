import { shallowEqual } from '../equality';
import { regSub, getOrCreateReaction } from '../subs';
import { initAppDb } from '../db';
import { clearReactions } from '../registrar';

describe('shallowEqual', () => {
  it('should compare primitives with Object.is semantics', () => {
    expect(shallowEqual(1, 1)).toBe(true);
    expect(shallowEqual('a', 'a')).toBe(true);
    expect(shallowEqual(NaN, NaN)).toBe(true);
    expect(shallowEqual(null, null)).toBe(true);
    expect(shallowEqual(undefined, undefined)).toBe(true);
    expect(shallowEqual(1, 2)).toBe(false);
    expect(shallowEqual(0, -0)).toBe(false);
    expect(shallowEqual(null, undefined)).toBe(false);
    expect(shallowEqual(1, '1')).toBe(false);
  });

  it('should compare arrays one level deep', () => {
    const row = { id: 1 };
    expect(shallowEqual([row, 2], [row, 2])).toBe(true);
    expect(shallowEqual([], [])).toBe(true);
    expect(shallowEqual([row], [{ id: 1 }])).toBe(false); // different element identity
    expect(shallowEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(shallowEqual([1], { 0: 1, length: 1 })).toBe(false);
  });

  it('should compare plain objects one level deep', () => {
    const nested = { x: 1 };
    expect(shallowEqual({ a: nested, b: 2 }, { a: nested, b: 2 })).toBe(true);
    expect(shallowEqual({}, {})).toBe(true);
    expect(shallowEqual({ a: nested }, { a: { x: 1 } })).toBe(false); // different value identity
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(shallowEqual({ a: 1 }, { b: 1 })).toBe(false);
  });

  it('should treat identical references as equal', () => {
    const value = { rows: [1, 2, 3] };
    expect(shallowEqual(value, value)).toBe(true);
  });
});

describe('per-sub equalityCheck config with shallowEqual', () => {
  regSub('se-items');
  regSub('se-mapped', (items: number[]) => items.map((n) => n), () => [['se-items']], { equalityCheck: shallowEqual });

  beforeEach(() => {
    clearReactions();
    initAppDb({ 'se-items': [1, 2, 3] });
  });

  it('should gate recompute propagation with the configured check', () => {
    const reaction = getOrCreateReaction(['se-mapped']);
    const callback = jest.fn();
    reaction.watch(callback);

    const first = reaction.getSnapshot();
    expect(first).toEqual([1, 2, 3]);

    // Force a recompute of the mapped sub with unchanged content: the fresh
    // array is a different reference, but shallowEqual sees equal elements,
    // so the version must not bump
    const versionBefore = reaction.getVersion();
    reaction.markDirty();
    reaction.computeValue();
    expect(reaction.getVersion()).toBe(versionBefore);
    // The cached value keeps its identity for downstream consumers
    expect(reaction.getSnapshot()).toBe(first);

    reaction.unwatch(callback);
  });
});
