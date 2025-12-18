/**
 * Safe versions of immer's original and current functions
 * These check if the value is actually a draft before calling the immer functions
 */

import { isDraft, original as immerOriginal, current as immerCurrent, enableMapSet as immerEnableMapSet } from 'immer';

/**
 * Safe version of immer's original function
 * Returns the original (frozen) version of a draft if the value is a draft,
 * otherwise returns the value as-is
 */
export function original<T>(value: T): T {
  return isDraft(value) ? immerOriginal(value)! : value;
}

/**
 * Safe version of immer's current function
 * Returns the current draft state as a plain object if the value is a draft,
 * otherwise returns the value as-is
 */
export function current<T>(value: T): T {
  return isDraft(value) ? immerCurrent(value) : value;
}

/**
 * Enable Map and Set support in Immer
 * This allows Immer to handle Map and Set objects properly in drafts
 */
export function enableMapSet(): void {
  immerEnableMapSet();
}