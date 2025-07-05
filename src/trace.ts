type TraceID = number;

interface TraceOpts {
    operation?: string;
    opType?: string;
    tags?: Record<string, any>;
    childOf?: TraceID;
}

interface Trace extends TraceOpts {
    id: TraceID;
    start: number;
    end?: number;
    duration?: number;
}

type TraceCallback = (traces: Trace[]) => void;

let nextId = 1;
let traces: Trace[] = [];
let currentTrace: Trace | null = null;
let traceEnabled = false;
const traceCbs = new Map<string, TraceCallback>();

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_TIME = 50;

export function enableTracing() {
    traceEnabled = true;
}

export function disableTracing() {
    traceEnabled = false;
    resetTracing();
}

export function resetTracing() {
    nextId = 1;
    traces = [];
    currentTrace = null;
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
}

export function isTraceEnabled(): boolean {
    return traceEnabled;
}

export function registerTraceCb(key: string, cb: TraceCallback): void {
    if (!traceEnabled) {
        console.warn(
            'Tracing is not enabled; call enableTracing() before registering callbacks'
        );
        return;
    }
    traceCbs.set(key, cb);
}

export function removeTraceCb(key: string): void {
    traceCbs.delete(key);
}

function scheduleFlush() {
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
        const batch = traces.slice();
        traces = [];
        debounceTimer = null;
        for (const cb of traceCbs.values()) {
            try {
                cb(batch);
            } catch (e) {
                console.error('Error in trace callback', e);
            }
        }
    }, DEBOUNCE_TIME);
}

export function startTrace(opts: TraceOpts): Trace {
    const parentId = opts.childOf ?? currentTrace?.id ?? null;
    const trace: Trace = {
        id: nextId++,
        operation: opts.operation,
        opType: opts.opType,
        tags: opts.tags ?? {},
        childOf: parentId ?? undefined,
        start: Date.now(),
    };
    return trace;
}

export function finishTrace(trace: Trace): void {
    if (!traceEnabled) return;
    trace.end = Date.now();
    trace.duration = trace.end - trace.start;
    traces.push(trace);
    scheduleFlush();
}

export function withTrace<T>(opts: TraceOpts, fn: () => T): T {
    if (!traceEnabled) {
        return fn();
    }
    const parent = currentTrace;
    currentTrace = startTrace(opts);
    try {
        return fn();
    } finally {
        finishTrace(currentTrace);
        currentTrace = parent;
    }
}

export function mergeTrace(update: { tags?: Record<string, any>;[key: string]: any; }): void {
    if (!traceEnabled || !currentTrace) {
        return;
    }
    if (update.tags) {
        currentTrace.tags = { ...currentTrace.tags, ...update.tags };
    }

    for (const k of Object.keys(update)) {
        if (k !== 'tags') {
            (currentTrace as any)[k] = update[k];
        }
    }
}

export function enableTracePrint() {
    registerTraceCb('reflex-default-tracer', (traces) => {
        console.log('%c[reflex] [trace] ', 'font-weight: bold; color: blue;', traces)
    })
}
