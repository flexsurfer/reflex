/**
 * Port of re-frame.router from ClojureScript to TypeScript.
 * Implements an event queue with a finite-state-machine to schedule and process events.
 */

import type { EventVector } from './types';
import { handle } from './events';
import { consoleLog } from './loggers';
import { scheduleAfterRender, scheduleNextTick } from './schedule';

type FSMState = 'idle' | 'scheduled' | 'running' | 'paused';

type FSMTrigger =
    | 'add-event'
    | 'run-queue'
    | 'pause'
    | 'exception'
    | 'finish-run'
    | 'resume';

// Mapping of metadata keys to scheduling functions
const laterFns: Record<string, (f: () => void) => void> = {
    flush: scheduleAfterRender,
    yield: scheduleNextTick,
};

/**
 * Core event queue class implementing a finite-state-machine.
 */
export class EventQueue {
    private fsmState: FSMState = 'idle';
    private queue: EventVector[] = [];

    constructor(private eventHandler: (event: EventVector) => void) { }

    push(event: EventVector): void {
        this.fsmTrigger('add-event', event);
    }

    purge(): void {
        this.queue = [];
    }

    private fsmTrigger(trigger: FSMTrigger, arg?: any): void {
        let newState: FSMState;
        let actionFn: (() => void) | undefined;

        switch (`${this.fsmState}:${trigger}`) {
            case 'idle:add-event':
                newState = 'scheduled';
                actionFn = () => {
                    this.addEvent(arg);
                    this.runNextTick();
                };
                break;
            case 'scheduled:add-event':
                newState = 'scheduled';
                actionFn = () => this.addEvent(arg);
                break;
            case 'scheduled:run-queue':
                newState = 'running';
                actionFn = () => this.runQueue();
                break;
            case 'running:add-event':
                newState = 'running';
                actionFn = () => this.addEvent(arg);
                break;
            case 'running:pause':
                newState = 'paused';
                actionFn = () => this.pause(arg);
                break;
            case 'running:exception':
                newState = 'idle';
                actionFn = () => this.exception(arg);
                break;
            case 'running:finish-run':
                if (this.queue.length === 0) {
                    newState = 'idle';
                } else {
                    newState = 'scheduled';
                    actionFn = () => this.runNextTick();
                }
                break;
            case 'paused:add-event':
                newState = 'paused';
                actionFn = () => this.addEvent(arg);
                break;
            case 'paused:resume':
                newState = 'running';
                actionFn = () => this.resume();
                break;
            default:
                consoleLog('error', `[reflex] router state transition not found. ${this.fsmState} ${trigger}`);
                return;
        }

        this.fsmState = newState;
        if (actionFn) actionFn();
    }

    private addEvent(event: EventVector): void {
        this.queue.push(event);
    }

    private processFirstEvent(): void {
        const event = this.queue[0];
        try {
            this.eventHandler(event);
            this.queue.shift();
        } catch (ex) {
            this.fsmTrigger('exception', ex);
        }
    }

    private runNextTick(): void {
        laterFns.yield(() => this.fsmTrigger('run-queue'));
    }

    private runQueue(): void {
        let n = this.queue.length;
        while (n > 0) {
            const nextEvent = this.queue[0];
            const metaKeys = (nextEvent as any).meta ? Object.keys((nextEvent as any).meta) : [];
            const laterKey = metaKeys.find(k => laterFns[k]);
            if (laterKey) {
                this.fsmTrigger('pause', laterFns[laterKey]);
                return;
            }
            this.processFirstEvent();
            n -= 1;
        }
        this.fsmTrigger('finish-run');
    }

    private exception(ex: any): void {
        this.purge();
        consoleLog('error', '[reflex] event processing exception:', ex);
    }

    private pause(laterFn: (f: () => void) => void): void {
        laterFn(() => this.fsmTrigger('resume'));
    }

    private resume(): void {
        this.processFirstEvent();
        this.runQueue();
    }

    /**
     * Get current state for debugging
     */
    getState(): FSMState {
        return this.fsmState;
    }

    /**
     * Get queue length for debugging
     */
    getQueueLength(): number {
        return this.queue.length;
    }
}

// Create the global event queue
const eventQueue = new EventQueue(handle);

function isValidEventVector(value: any): value is EventVector {
    return Array.isArray(value) && value.length > 0;
}

/**
 * Dispatch an event asynchronously
 */
export function dispatch(event: EventVector): void {
    if (!isValidEventVector(event)) {
        consoleLog('error', '[reflex] invalid dispatch event vector.');
        return;
    }
    eventQueue.push(event);
}
