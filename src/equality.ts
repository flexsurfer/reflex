import type { EqualityCheckFn } from './types';

/**
 * Shallow equality: `Object.is` on primitives, one level of key/index
 * comparison (again by `Object.is`) for plain arrays and objects.
 *
 * The default subscription equality check is deep (`fast-deep-equal`), which
 * costs O(result size) every time a subscription recomputes. For large
 * derived collections that is usually wasted work: with Immer's structural
 * sharing, unchanged rows keep their identity, so a shallow check on a mapped
 * or filtered array already detects "nothing actually changed". Opt in
 * per subscription — `regSub(id, fn, deps, { equalityCheck: shallowEqual })` —
 * or globally via `setGlobalEqualityCheck(shallowEqual)`.
 */
export const shallowEqual: EqualityCheckFn = (a: any, b: any): boolean => {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!Object.is(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key) || !Object.is(a[key], b[key])) {
      return false;
    }
  }
  return true;
};
