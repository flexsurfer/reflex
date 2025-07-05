import { EventQueue, dispatch } from '../router';
import type { EventVector } from '../types';

// Helper to wait for all scheduled callbacks to complete
const waitForScheduled = async () => {
  // Wait for setImmediate (React Native priority)
  if (typeof (globalThis as any).setImmediate === 'function') {
    await new Promise(resolve => (globalThis as any).setImmediate(resolve));
    return;
  }
  
  // Wait for MessageChannel (Web priority)
  if (typeof MessageChannel !== 'undefined') {
    await new Promise(resolve => {
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = () => resolve(undefined);
      port2.postMessage(undefined);
    });
    return;
  }
  
  // Wait for setTimeout fallback
  await new Promise(resolve => setTimeout(resolve, 0));
};

// Helper to wait for animation frame scheduling
const waitForAnimationFrame = async () => {
  if (typeof requestAnimationFrame !== 'undefined') {
    await new Promise(resolve => requestAnimationFrame(resolve));
  } else {
    await new Promise(resolve => setTimeout(resolve, 16));
  }
};

// Helper to create events with meta
const createEventWithMeta = (eventId: string, meta: Record<string, any>): EventVector => {
  const event = [eventId] as EventVector;
  (event as any).meta = meta;
  return event;
};

describe('EventQueue', () => {
  let calls: EventVector[];
  let queue: EventQueue;

  beforeEach(() => {
    calls = [];
    queue = new EventQueue((event: EventVector) => {
      calls.push(event);
    });
    clearTestLogCalls();
  });

  describe('Basic Event Processing', () => {
    test('processes events asynchronously in order', async () => {
      queue.push(['first']);
      queue.push(['second']);
      queue.push(['third']);

      // Events should not be processed immediately
      expect(calls).toEqual([]);
      expect(queue.getState()).toBe('scheduled');
      expect(queue.getQueueLength()).toBe(3);

      await waitForScheduled();

      expect(calls).toEqual([['first'], ['second'], ['third']]);
      expect(queue.getState()).toBe('idle');
      expect(queue.getQueueLength()).toBe(0);
    });

    test('handles single event correctly', async () => {
      queue.push(['single-event', 'param1', 'param2']);

      expect(queue.getState()).toBe('scheduled');
      expect(queue.getQueueLength()).toBe(1);

      await waitForScheduled();

      expect(calls).toEqual([['single-event', 'param1', 'param2']]);
      expect(queue.getState()).toBe('idle');
    });

    test('can add events while processing', async () => {
      const processingQueue = new EventQueue((event: EventVector) => {
        calls.push(event);
        if (event[0] === 'first') {
          processingQueue.push(['added-during-processing']);
        }
      });

      processingQueue.push(['first']);
      processingQueue.push(['second']);

      await waitForScheduled();
      
      expect(calls).toEqual([['first'], ['second']]);

      // Wait a bit more for the added event to be processed
      await waitForScheduled();

      expect(calls).toEqual([['first'], ['second'], ['added-during-processing']]);
      expect(processingQueue.getState()).toBe('idle');
    });
  });

  describe('FSM State Transitions', () => {
    test('transitions from idle to scheduled on first event', () => {
      expect(queue.getState()).toBe('idle');
      
      queue.push(['event']);
      
      expect(queue.getState()).toBe('scheduled');
    });

    test('stays scheduled when adding multiple events before processing', () => {
      queue.push(['first']);
      expect(queue.getState()).toBe('scheduled');
      
      queue.push(['second']);
      expect(queue.getState()).toBe('scheduled');
      
      queue.push(['third']);
      expect(queue.getState()).toBe('scheduled');
    });

    test('transitions from scheduled to running when processing starts', async () => {
      let processingStarted = false;
      const testQueue = new EventQueue((event: EventVector) => {
        if (!processingStarted) {
          processingStarted = true;
          expect(testQueue.getState()).toBe('running');
        }
        calls.push(event);
      });

      testQueue.push(['event']);
      await waitForScheduled();
      
      expect(processingStarted).toBe(true);
    });

    test('transitions to idle after processing all events', async () => {
      queue.push(['event']);
      
      expect(queue.getState()).toBe('scheduled');
      await waitForScheduled();
      expect(queue.getState()).toBe('idle');
    });

    test('transitions to scheduled after processing when more events exist', async () => {
      const testQueue = new EventQueue((event: EventVector) => {
        calls.push(event);
        if (event[0] === 'first') {
          testQueue.push(['added-later']);
        }
      });

      testQueue.push(['first']);
      testQueue.push(['second']);
      expect(testQueue.getState()).toBe('scheduled');
      await waitForScheduled();
      expect(calls.length).toBe(2);
      expect(testQueue.getState()).toBe('scheduled');
      await waitForScheduled();
      // Should process first two, then be scheduled for the third
      expect(calls.length).toBe(3);
      expect(testQueue.getState()).toBe('idle'); // Will be idle after all processing
    });
  });

  describe('Meta-based Scheduling', () => {
    test('handles flush meta correctly', async () => {
      const flushEvent = createEventWithMeta('flush-event', { flush: true });
      const normalEvent: EventVector = ['normal-event'];

      queue.push(normalEvent);
      queue.push(flushEvent);
      queue.push(['after-flush']);

      await waitForScheduled();
      
      // Normal event should be processed first
      expect(calls[0]).toEqual(normalEvent);
      expect(queue.getState()).toBe('paused');

      // Wait for flush scheduling (requestAnimationFrame)
      await waitForAnimationFrame();

      expect(calls).toEqual([normalEvent, flushEvent, ['after-flush']]);
      expect(queue.getState()).toBe('idle');
    });

    test('handles yield meta correctly', async () => {
      const yieldEvent = createEventWithMeta('yield-event', { yield: true });

      queue.push(yieldEvent);
      queue.push(['after-yield']);

      await waitForScheduled();
      
      expect(calls.length).toBe(0);
      // Yield event should pause for next tick
      expect(queue.getState()).toBe('paused');
      
      await waitForScheduled();
      expect(calls.length).toBe(2);
      expect(calls).toEqual([yieldEvent, ['after-yield']]);
      expect(queue.getState()).toBe('idle');
    });

    test('prioritizes first meta key when multiple exist', async () => {
      const multiMetaEvent = createEventWithMeta('multi-meta', { 
        flush: true, 
        yield: true 
      });

      queue.push(['before']);
      queue.push(multiMetaEvent);
      queue.push(['after']);

      await waitForScheduled();
      
      expect(calls[0]).toEqual(['before']);
      expect(queue.getState()).toBe('paused');

      await waitForScheduled();
      // Still paused waiting for requestAnimationFrame
      expect(queue.getState()).toBe('paused');

      await waitForAnimationFrame();
      
      expect(calls).toEqual([['before'], multiMetaEvent, ['after']]);
    });
  });

  describe('Error Handling', () => {
    test('handles exceptions during event processing', async () => {
      const errorQueue = new EventQueue((event: EventVector) => {
        if (event[0] === 'error-event') {
          throw new Error('Test error');
        }
        calls.push(event);
      });

      // Test with just the error event to avoid race conditions
      errorQueue.push(['error-event']);

      await waitForScheduled();

      // Error should have occurred and queue should be purged
      expect(calls).toEqual([]);
      expect(errorQueue.getState()).toBe('idle');
      expect(errorQueue.getQueueLength()).toBe(0);

      // Should log the error (may have multiple error logs from state transitions)
      expect(getTestLogCalls().error.length).toBeGreaterThanOrEqual(1);
      expect(getTestLogCalls().error.some(call => 
        call[0] === '[reflex] event processing exception:'
      )).toBe(true);
    });

    test('handles exceptions with meta events', async () => {
      const errorQueue = new EventQueue((event: EventVector) => {
        if (event[0] === 'error-event') {
          throw new Error('Meta error');
        }
        calls.push(event);
      });

      const errorEvent = createEventWithMeta('error-event', { flush: true });
      
      errorQueue.push(['before-error']);
      errorQueue.push(errorEvent);
      errorQueue.push(['after-error']);

      await waitForScheduled();

      // Should process first event normally
      expect(calls).toEqual([['before-error']]);
      expect(errorQueue.getState()).toBe('paused');

      // Wait for the flush to trigger the error
      await waitForAnimationFrame();

      // Error should have purged the queue
      expect(errorQueue.getState()).toBe('idle');
      expect(errorQueue.getQueueLength()).toBe(0);
      expect(getTestLogCalls().error.length).toBeGreaterThanOrEqual(1);
    });

    test('logs error for invalid state transitions', () => {
      // This tests the default case in fsmTrigger
      // We can't easily trigger this in normal usage, but we can test the log
      const testQueue = new EventQueue(() => {});
      
      // Use reflection to call fsmTrigger with invalid transition
      (testQueue as any).fsmTrigger('invalid-trigger' as any);
      
      expect(getTestLogCalls().error.length).toBe(1);
      expect(getTestLogCalls().error[0][0]).toContain('[reflex] router state transition not found');
    });
  });

  describe('Pause and Resume', () => {
    test('pauses and resumes correctly with flush events', async () => {
      
      const flushEvent = createEventWithMeta('flush-event', { flush: true });
      
      queue.push(['before-flush']);
      queue.push(flushEvent);
      queue.push(['check-pause']);

      await waitForScheduled();
      expect(queue.getState()).toBe('paused');
      
      await waitForAnimationFrame();
      expect(queue.getState()).toBe('idle');
      expect(calls.length).toBe(3);
    });

    test('can add events while paused', async () => {
      const flushEvent = createEventWithMeta('flush-event', { flush: true });
      
      queue.push(['before-pause']);
      queue.push(flushEvent);

      await waitForScheduled();
      expect(queue.getState()).toBe('paused');

      // Add event while paused
      queue.push(['added-while-paused']);
      expect(queue.getState()).toBe('paused');

      await waitForAnimationFrame();

      expect(calls).toEqual([['before-pause'], flushEvent, ['added-while-paused']]);
      expect(queue.getState()).toBe('idle');
    });
  });

  describe('Purge Functionality', () => {
    test('purge clears pending events', async () => {
      queue.push(['first']);
      queue.push(['second']);
      
      expect(queue.getQueueLength()).toBe(2);
      queue.purge();
      expect(queue.getQueueLength()).toBe(0);

      await waitForScheduled();
      expect(calls).toEqual([]);
    });

    test('purge clears queue and stops processing remaining events', async () => {
      const testQueue = new EventQueue((event: EventVector) => {
        calls.push(event);
      });

      testQueue.push(['first']);
      testQueue.push(['second']);
      testQueue.push(['third']);
      
      // Purge before processing starts
      testQueue.purge();

      await waitForScheduled();

      // No events should be processed after purge
      expect(calls).toEqual([]);
      expect(testQueue.getQueueLength()).toBe(0);
      expect(testQueue.getState()).toBe('idle');
    });
  });

  describe('Debugging Methods', () => {
    test('getState returns correct FSM state', async () => {
      expect(queue.getState()).toBe('idle');
      
      queue.push(['event']);
      expect(queue.getState()).toBe('scheduled');
      
      await waitForScheduled();
      expect(queue.getState()).toBe('idle');
    });

    test('getQueueLength returns correct queue length', () => {
      expect(queue.getQueueLength()).toBe(0);
      
      queue.push(['first']);
      expect(queue.getQueueLength()).toBe(1);
      
      queue.push(['second']);
      expect(queue.getQueueLength()).toBe(2);
      
      queue.purge();
      expect(queue.getQueueLength()).toBe(0);
    });
  });
});

describe('Global dispatch function', () => {
  beforeEach(() => {
    clearTestLogCalls();
  });

  test('dispatches valid events', async () => {
    // We can't easily test the global dispatch without mocking the global queue
    // But we can test the validation logic
    
    // Mock console to capture invalid dispatch logs
    dispatch(['valid-event', 'param']);
    
    // Should not log any errors for valid events
    expect(getTestLogCalls().error.length).toBe(0);
  });

  test('rejects invalid event vectors', () => {
    // Test invalid events
    dispatch(null as any);
    dispatch(undefined as any);
    dispatch('not-an-array' as any);
    dispatch([] as any); // Empty array
    dispatch({} as any); // Object instead of array

    // Should log errors for each invalid event
    expect(getTestLogCalls().error.length).toBe(5);
    getTestLogCalls().error.forEach(errorCall => {
      expect(errorCall[0]).toBe('[reflex] invalid dispatch event vector.');
    });
  });

  test('accepts various valid event vector formats', () => {
    dispatch(['simple']);
    dispatch(['with-param', 'value']);
    dispatch(['with-multiple', 'param1', 'param2', { complex: 'object' }]);
    
    // Should not log any errors
    expect(getTestLogCalls().error.length).toBe(0);
  });
});

describe('Environment Specific Scheduling', () => {
  describe('scheduleAfterRender', () => {
    test('uses requestAnimationFrame when available', async () => {
      // Mock requestAnimationFrame for testing
      const originalRAF = (globalThis as any).requestAnimationFrame;
      (globalThis as any).requestAnimationFrame = jest.fn((cb: any) => setTimeout(cb, 16));
      
      try {
        expect(typeof requestAnimationFrame).toBe('function');
        
        const flushEvent = createEventWithMeta('flush-test', { flush: true });
        const testQueue = new EventQueue((event) => {
          if (event[0] === 'flush-test') {
            expect(typeof requestAnimationFrame).toBe('function');
          }
        });

        testQueue.push(flushEvent);
        await waitForScheduled();
        await waitForAnimationFrame();
      } finally {
        // Restore original
        if (originalRAF) {
          (globalThis as any).requestAnimationFrame = originalRAF;
        } else {
          delete (globalThis as any).requestAnimationFrame;
        }
      }
    });
  });

  describe('scheduleNextTick', () => {
    test('uses MessageChannel when available', async () => {
      // MessageChannel is available in jsdom
      expect(typeof MessageChannel).toBe('function');
      
      const yieldEvent = createEventWithMeta('yield-test', { yield: true });
      const testQueue = new EventQueue((event) => {
        if (event[0] === 'yield-test') {
          expect(typeof MessageChannel).toBe('function');
        }
      });

      testQueue.push(yieldEvent);
      await waitForScheduled();
      await waitForScheduled(); // Wait for yield
    });
  });
});

describe('Complex Scenarios', () => {
  test('handles rapid event addition during processing', async () => {
    const calls: EventVector[] = [];
    let addMoreEvents = true;
    
    const rapidQueue = new EventQueue((event: EventVector) => {
      calls.push(event);
      
      if (addMoreEvents && calls.length < 5) {
        rapidQueue.push([`rapid-${calls.length}`]);
      } else {
        addMoreEvents = false;
      }
    });

    rapidQueue.push(['initial']);
    
    await waitForScheduled();
    
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual(['initial']);
    await waitForScheduled();
    expect(calls[1][0]).toBe('rapid-1');
    await waitForScheduled();
    expect(calls[2][0]).toBe('rapid-2');
    await waitForScheduled();
    expect(calls[3][0]).toBe('rapid-3');
    await waitForScheduled();
    expect(calls[4][0]).toBe('rapid-4');
    expect(calls.length).toBe(5);
    await waitForScheduled();
    expect(calls.length).toBe(5);
  });

  test('handles mixed meta events correctly', async () => {
    const calls: EventVector[] = [];
    const mixedQueue = new EventQueue((event) => calls.push(event));

    const flushEvent = createEventWithMeta('flush', { flush: true });
    const yieldEvent = createEventWithMeta('yield', { yield: true });

    mixedQueue.push(['normal1']);
    mixedQueue.push(flushEvent);
    mixedQueue.push(['normal2']);
    mixedQueue.push(yieldEvent);
    mixedQueue.push(['normal3']);

    // Process until first meta event
    await waitForScheduled();
    expect(calls[0]).toEqual(['normal1']);

    expect(mixedQueue.getState()).toBe('paused');
    // Process flush
    await waitForAnimationFrame();
    
    expect(calls[1]).toEqual(flushEvent);
    expect(calls[2]).toEqual(['normal2']);

    // Process yield
    await waitForScheduled();
    expect(calls[3]).toEqual(yieldEvent);
    expect(calls[4]).toEqual(['normal3']);
    expect(mixedQueue.getState()).toBe('idle');
    
    // Verify all events were processed in correct order
    expect(calls).toEqual([
      ['normal1'],
      flushEvent,
      ['normal2'], 
      yieldEvent,
      ['normal3']
    ]);
  });

  test('handles exception during meta event processing', async () => {
    const calls: EventVector[] = [];
    const errorQueue = new EventQueue((event: EventVector) => {
      calls.push(event);
      if (event[0] === 'flush-error') {
        throw new Error('Flush processing error');
      }
    });

    const errorFlushEvent = createEventWithMeta('flush-error', { flush: true });
    
    errorQueue.push(['before-error']);
    errorQueue.push(errorFlushEvent);
    errorQueue.push(['after-error']);

    await waitForScheduled();
    expect(calls).toEqual([['before-error']]);
    expect(errorQueue.getState()).toBe('paused');

    await waitForAnimationFrame();
    
    // Error should have been logged and queue purged
    expect(getTestLogCalls().error.length).toBeGreaterThanOrEqual(1);
    expect(errorQueue.getState()).toBe('idle');
    expect(errorQueue.getQueueLength()).toBe(0);
  });
});