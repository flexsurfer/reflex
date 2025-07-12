import { Reaction } from './reaction'
import { consoleLog } from './loggers';
import { SubVector, Id, SubHandler, SubDepsHandler } from './types';
import {
    getReaction,
    setReaction,
    getHandler,
    registerHandler,
    hasHandler
} from './registrar';
import { getAppDb } from './db';
import { mergeTrace, withTrace } from './trace';

const KIND = 'sub';
const KIND_DEPS = 'subDeps';

export function regSub<R>(id: Id, computeFn?: (...values: any[]) => R, depsFn?: (...params: any[]) => SubVector[]): void {
    if (hasHandler(KIND, id)) {
        consoleLog('warn', `[reflex] Overriding. Subscription '${id}' already registered.`)
    }
    // If only id is provided, use root subscription logic
    if (!computeFn) {
        registerHandler(KIND, id, () => getAppDb()[id])
        registerHandler(KIND_DEPS, id, () => [])
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
}

export function getOrCreateReaction(subVector: SubVector): Reaction<any> {
    const subId = subVector[0]
    
    if (!hasHandler(KIND, subId)) {
        consoleLog('error', `[reflex] no sub handler registered for: ${subId}`);
        return null as any;
    }

    withTrace({ operation: subVector[0], opType: KIND, tags: { queryV: subVector } }, () => { });

    const computeFn = getHandler(KIND, subId) as SubHandler
    // Check if we already have this specific parameterized reaction
    const subVectorKey = JSON.stringify(subVector)
    const existingReaction = getReaction(subVectorKey)
    if (existingReaction) {
        mergeTrace({ tags: { 'cached?': true, reaction: existingReaction.getId() } });
        return existingReaction
    }
    mergeTrace({ tags: { 'cached?': false } });

    const params = subVector.length > 1 ? subVector.slice(1) : []
    // Check if this is a computed subscription (has dependencies)
    const depsFn = getHandler(KIND_DEPS, subId) as SubDepsHandler
    // Handle computed subscriptions
    const depsVectors = depsFn(...params as any[])
    const depsReactions = depsVectors.map((depVector: SubVector) => {
        // Recursively resolve dependencies
        return getOrCreateReaction(depVector)
    })
    
    const reaction = Reaction.create(
        (...depValues) => {
            if (params.length > 0) {
                return computeFn(...depValues, ...params)
            } else {
                return computeFn(...depValues)
            }
        },
        depsReactions
    )
    mergeTrace({ reaction: reaction.getId() });
    reaction.setId(subVectorKey)
    reaction.setSubVector(subVector)
    // Store the reaction by its full vector key
    setReaction(subVectorKey, reaction)
    return reaction
}

export function getSubscriptionValue<T>(subVector: SubVector): T {
    const reaction = getOrCreateReaction(subVector)
    return reaction ? reaction.getValue() : undefined as T
}