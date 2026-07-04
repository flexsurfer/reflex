import { Reaction } from './reaction'
import { consoleLog } from './loggers';
import type { SubVector, Id, SubHandler, SubDepsHandler, SubConfig, SubPayloads, SubParams, SubResult, SubscribeVector } from './types';
import {
    getReaction,
    setReaction,
    hasReaction,
    clearReactions,
    markProvisionalReaction,
    unmarkProvisionalReaction,
    getHandler,
    registerHandler,
    hasHandler,
    setSubConfig,
    getSubConfig,
    setRootSubSource,
    getRootSubIdBySource
} from './registrar';
import { getAppDb } from './db';
import { mergeTrace, withTrace } from './trace';
import { getGlobalEqualityCheck } from './settings';
import { IS_DEV } from './env';

const KIND = 'sub';
const KIND_DEPS = 'subDeps';

function registerRootSub (id: Id, sourceKey: string) {
    const conflictingSubId = getRootSubIdBySource(sourceKey)
    if (conflictingSubId && conflictingSubId !== id) {
        consoleLog('error', `[reflex] Subscription with id '${id}' will be overridden. Root key '${sourceKey}' is already used by subscription '${conflictingSubId}'.`)
    }

    setRootSubSource(id, sourceKey)
    // Root subs read top-level keys dynamically; stay untyped so this
    // compiles when the app augments AppDb (no string index signature there).
    registerHandler(KIND, id, () => getAppDb<Record<string, any>>()[sourceKey])
    registerHandler(KIND_DEPS, id, () => [])
}

// When the app augments SubPayloads, the computeFn return value is checked
// against the declared result for K (undeclared ids fall back to R). K only
// infers a literal when R isn't passed explicitly; `regSub<Todo[]>(id, ...)`
// keeps its current behavior.
export function regSub<R = any, K extends Id = Id>(id: K, computeFn?: ((...values: any[]) => SubResult<K, R>) | string, depsFn?: (...params: any[]) => SubVector[], config?: SubConfig): void {
    if (hasHandler(KIND, id)) {
        consoleLog('warn', `[reflex] Overriding. Subscription '${id}' already registered.`)
    }

    if (!computeFn) {
        registerRootSub(id, id)
    } else if (typeof computeFn === 'string') {
        registerRootSub(id, computeFn as string)
    } else {
        // Computed subscriptions require depsFn
        if (!depsFn) {
            consoleLog('error', `[reflex] Subscription '${id}' has computeFn but missing depsFn. Computed subscriptions must specify their dependencies.`);
            return;
        }
        // Store computeFn and depsFn separately
        registerHandler(KIND, id, computeFn)
        registerHandler(KIND_DEPS, id, depsFn)
    }

    // Store config if provided
    if (config) {
        setSubConfig(id, config)
    }
}

/**
 * Subscription cache keys are produced with JSON.stringify(subVector), so
 * values that don't survive JSON serialization — at any nesting depth — can
 * collide on one cache entry, silently go stale, or throw during key
 * generation:
 * - undefined, functions, Symbols: dropped or serialized to null (collisions)
 * - Map, Set, RegExp: serialize to "{}" (collisions)
 * - NaN, Infinity: serialize to null (collide with each other)
 * - BigInt, circular references: JSON.stringify throws
 * `visiting` tracks the current descent path (added before recursing into an
 * object, removed after) so circular structures are detected without flagging
 * shared non-circular references.
 */
function isNonSerializableValue(value: any, visiting: WeakSet<object>): boolean {
    if (value === undefined) return true
    const type = typeof value
    if (type === 'function' || type === 'symbol' || type === 'bigint') return true
    if (type === 'number' && !Number.isFinite(value)) return true
    if (value === null || type !== 'object') return false
    if (value instanceof Map || value instanceof Set || value instanceof RegExp) return true
    if (visiting.has(value)) return true // circular: JSON.stringify would throw
    visiting.add(value)
    const values = Array.isArray(value) ? value : Object.values(value)
    const result = values.some((v) => isNonSerializableValue(v, visiting))
    visiting.delete(value)
    return result
}

export function hasNonSerializableSubParam(params: any[]): boolean {
    const visiting = new WeakSet<object>()
    return params.some((p) => isNonSerializableValue(p, visiting))
}

const warnedNonSerializableSubIds = new Set<Id>();

/**
 * Produce the canonical cache key for a subscription vector. All key
 * generation must go through here: dev validation runs before
 * JSON.stringify, so unserializable params (BigInt, circular structures)
 * warn with an actionable message before the native throw, and colliding
 * keys (two different Maps both stringifying to "{}") warn before the
 * registry lookup can return another vector's reaction.
 */
export function getSubVectorKey(subVector: SubVector): string {
    if (IS_DEV && subVector.length > 1) {
        const subId = subVector[0]
        if (!warnedNonSerializableSubIds.has(subId) && hasNonSerializableSubParam(subVector.slice(1))) {
            warnedNonSerializableSubIds.add(subId)
            consoleLog('warn', `[reflex] subscription '${subId}' called with a param that does not survive JSON.stringify (undefined, function, Symbol, BigInt, Map, Set, RegExp, non-finite number or circular reference, possibly nested). Subscription cache keys are JSON-serialized, so such params can collide, return stale data, or throw. Pass plain serializable values (ids, strings, numbers) instead.`);
        }
    }
    return JSON.stringify(subVector)
}

export function getOrCreateReaction(subVector: SubVector): Reaction<any> {
    const subId = subVector[0]

    if (!hasHandler(KIND, subId)) {
        consoleLog('error', `[reflex] no sub handler registered for: ${subId}`);
        return null as any;
    }

    const computeFn = getHandler(KIND, subId) as SubHandler
    // Check if we already have this specific parameterized reaction
    const subVectorKey = getSubVectorKey(subVector)
    const existingReaction = getReaction(subVectorKey)
    if (existingReaction) {
        mergeTrace({ tags: { 'cached?': true, reaction: existingReaction.getId() } });
        return existingReaction
    }

    withTrace({ operation: subVector[0], opType: 'sub/create', tags: { queryV: subVector } }, () => { });

    const params = subVector.length > 1 ? subVector.slice(1) : []
    // Check if this is a computed subscription (has dependencies)
    const depsFn = getHandler(KIND_DEPS, subId) as SubDepsHandler
    // Handle computed subscriptions
    const depsVectors = depsFn(...params as any[])
    const depsReactions = depsVectors.map((depVector: SubVector) => {
        // Recursively resolve dependencies
        return getOrCreateReaction(depVector)
    })

    // Determine equality check: per-subscription config takes precedence over global
    const subConfig = getSubConfig(subId)
    const equalityCheck = subConfig?.equalityCheck || getGlobalEqualityCheck()

    const reaction = Reaction.create(
        (...depValues) => {
            if (params.length > 0) {
                return computeFn(...depValues, ...params)
            } else {
                return computeFn(...depValues)
            }
        },
        depsReactions,
        equalityCheck
    )
    reaction.setId(subVectorKey)
    reaction.setSubVector(subVector)
    // Store the reaction by its full vector key. Until it goes live it is
    // provisional: renders that never commit would otherwise leak it.
    setReaction(subVectorKey, reaction)
    markProvisionalReaction(subVectorKey)
    // Prune from the registry once nothing watches or depends on it, so
    // parameterized subs over unbounded id spaces don't grow memory forever.
    // Guard against evicting a newer reaction registered under the same key
    // (e.g. after hot reload recreated the registry while this one was alive).
    reaction.setOnDispose(() => {
        if (getReaction(subVectorKey) === reaction) {
            clearReactions(subVectorKey)
        }
    })
    // When the reaction comes (back) to life, re-resolve its dependencies
    // through the registry: cached dep instances may have been pruned and
    // replaced, and only registered instances receive db wake-ups.
    reaction.setDepsResolver(() => {
        return depsFn(...params as any[]).map((depVector: SubVector) => getOrCreateReaction(depVector))
    })
    reaction.setOnRevive(() => {
        unmarkProvisionalReaction(subVectorKey)
        if (!hasReaction(subVectorKey)) {
            setReaction(subVectorKey, reaction)
        }
    })
    return reaction
}

// Same typing contract as useSubscription: untyped until SubPayloads is
// augmented, then declared ids infer params and result from the map.
export function getSubscriptionValue<K extends keyof SubPayloads & Id>(subVector: [K, ...SubParams<K>]): SubResult<K>;
export function getSubscriptionValue<T>(subVector: SubscribeVector): T;
export function getSubscriptionValue<T>(subVector: SubVector): T {
    const reaction = getOrCreateReaction(subVector)
    return reaction ? reaction.computeValue() : undefined as T
}
