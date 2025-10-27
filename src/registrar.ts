import type { Id, EventHandler, EffectHandler, CoEffectHandler, Interceptor, ErrorHandler, SubHandler, SubDepsHandler } from './types';
import { consoleLog } from './loggers';
import { Reaction } from './reaction';

type Kind = 'event' | 'fx' | 'cofx' | 'sub' | 'subDeps' | 'error';
type RegistryHandler = EventHandler | EffectHandler | CoEffectHandler | ErrorHandler | SubHandler | SubDepsHandler;

const kindToIdToHandler: Record<Kind, Record<string, RegistryHandler>> = {
    event: {}, fx: {}, cofx: {}, sub: {}, subDeps: {}, error: {}
};

export function getHandler<T extends RegistryHandler = RegistryHandler>
    (kind: Kind, id: Id): T | undefined {
    const handler = kindToIdToHandler[kind][id] as T | undefined;

    if (!handler) {
        consoleLog('error', `[reflex] no ${kind} handler registered for:`, id);
    }

    return handler;
}

export function getHandlers(): Record<Kind, Record<string, RegistryHandler>> {
    return kindToIdToHandler;
}

export function registerHandler<T extends RegistryHandler = RegistryHandler>
    (kind: Kind, id: Id, handlerFn: T): T {
    if (kindToIdToHandler[kind][id]) {
        consoleLog('warn', `[reflex] overwriting ${kind} handler for:`, id);
    }

    kindToIdToHandler[kind][id] = handlerFn;
    return handlerFn;
}

export function clearHandlers(): void;
export function clearHandlers(kind: Kind): void;
export function clearHandlers(kind: Kind, id: string): void;
export function clearHandlers(kind?: Kind, id?: string): void {
    if (kind == null) {
        for (const k in kindToIdToHandler) {
            kindToIdToHandler[k as Kind] = {};
        }
    } else if (id == null) {
        if (!(kind in kindToIdToHandler)) {
            consoleLog('error', `[reflex] Unknown kind: ${kind}`);
            return;
        }
        kindToIdToHandler[kind] = {};
    } else {
        if (kindToIdToHandler[kind][id]) {
            delete kindToIdToHandler[kind][id];
        } else {
            consoleLog('warn', `[reflex] can't clear ${kind} handler for ${id}. Handler not found.`);
        }
    }
}

export function hasHandler(kind: Kind, id: string): boolean {
    return !!kindToIdToHandler[kind][id];
}

// === Reactions Registry Functions ===
const reactionsRegistry = new Map<string, Reaction<any>>();

export function getReaction(key: string): Reaction<any> | undefined {
    return reactionsRegistry.get(key);
}

export function getReactions(): Map<string, Reaction<any>> | undefined {
    return reactionsRegistry;
}

export function setReaction(key: string, reaction: Reaction<any>): void {
    reactionsRegistry.set(key, reaction);
}

export function hasReaction(key: string): boolean {
    return reactionsRegistry.has(key);
}

export function clearReactions(): void
export function clearReactions(id: string): void
export function clearReactions(id?: string): void {
    if (id == null) {
        reactionsRegistry.clear();
    } else {
        reactionsRegistry.delete(id);
    }
}

export function clearSubs(): void {
    clearReactions();
    clearHandlers('sub');
    clearHandlers('subDeps');
}

// === Interceptor Registry Functions ===
const interceptorsRegistry = new Map<Id, Interceptor[]>();

export function getInterceptors(eventId: Id): Interceptor[] {
    return interceptorsRegistry.get(eventId) || [];
}

export function setInterceptors(eventId: Id, interceptors: Interceptor[]): void {
    interceptorsRegistry.set(eventId, interceptors);
}

export function hasInterceptors(eventId: Id): boolean {
    return interceptorsRegistry.has(eventId) && interceptorsRegistry.get(eventId)!.length > 0;
}

export function clearInterceptors(): void;
export function clearInterceptors(eventId: Id): void;
export function clearInterceptors(eventId?: Id): void {
    if (eventId == null) {
        interceptorsRegistry.clear();
    } else {
        interceptorsRegistry.delete(eventId);
    }
}

export function clearAllRegistries(): void {
    clearHandlers();
    clearReactions();
    clearInterceptors();
}