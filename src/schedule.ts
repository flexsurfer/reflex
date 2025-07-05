// Helpers for scheduling callbacks
export function scheduleAfterRender(f: () => void): void {
    if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => {
            Promise.resolve().then(f);
        });
    } else {
        // Fallback for non-browser environments
        setTimeout(f, 16);
    }
};

// Next Tick is needed to split event processing into chunks
export function scheduleNextTick(f: () => void): void {
    //React Native
    if (typeof (globalThis as any).setImmediate === 'function') {
        (globalThis as any).setImmediate(f);
        return;
    }

    //Web
    if (typeof MessageChannel !== 'undefined') {
        const { port1, port2 } = new MessageChannel();
        port1.onmessage = () => f();
        port2.postMessage(undefined);
        return;
    }

    // Fallback 
    setTimeout(f, 0);
}