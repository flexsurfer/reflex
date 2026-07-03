import { useMemo, useSyncExternalStore } from 'react'
import type { SubVector } from './types';
import { getOrCreateReaction, getSubVectorKey } from './subs';

/**
 * Subscribe a React component to a reflex subscription.
 *
 * Contract:
 * - `subVector` params must be JSON-serializable plain values (ids, strings,
 *   numbers, plain objects/arrays). Reactions are cached and re-subscribed by
 *   `JSON.stringify(subVector)`: object key order matters, and `undefined`,
 *   functions, Symbols, BigInt, `Map`/`Set`/`RegExp`, non-finite numbers or
 *   circular references (at any depth) collide, go stale, or throw during
 *   key generation (warned in dev).
 * - Changing the serialized vector across renders re-subscribes automatically.
 * - `componentName` is a devtools tracing label; pass a static string. It is
 *   captured when the subscription (re)binds, not on every render.
 */
export function useSubscription<T>(subVector: SubVector, componentName: string = 'react component'): T {
  // Key the store bindings on the serialized vector so changing subscription
  // parameters re-subscribes to the new reaction instead of silently keeping
  // the one captured on first mount. getSubVectorKey validates params in dev
  // before serializing, so unserializable params warn before any throw.
  const subVectorKey = getSubVectorKey(subVector)

  const store = useMemo(() => ({
    subscribe: (onStoreChange: () => void) => {
      const reaction = getOrCreateReaction(subVector)
      if (!reaction) return () => { }
      reaction.watch(onStoreChange, componentName)
      return () => {
        reaction.unwatch(onStoreChange)
      }
    },
    getSnapshot: (): T => {
      const reaction = getOrCreateReaction(subVector)
      return reaction ? reaction.getSnapshot() : undefined as T
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [subVectorKey])

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
