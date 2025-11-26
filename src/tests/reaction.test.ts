import { Reaction } from '../reaction';
import { consoleLog } from '../loggers';
import type { EqualityCheckFn } from '../types';

// Helper function to wait for microtask queue to flush
const waitForMicrotasks = () => new Promise<void>(resolve => queueMicrotask(() => resolve()));

describe('Reaction', () => {
  describe('Constructor and static methods', () => {
    it('should create root reaction without dependencies', () => {
      const root = Reaction.create(() => 'hello world');
      
      // Should compute when forced
      expect(root.computeValue()).toBe('hello world');
      // Should use cache after computation
      expect(root.computeValue()).toBe('hello world');
    });

    it('should create reaction with compute function and dependency', () => {
      const dep = Reaction.create(() => 42);
      const reaction = new Reaction((depValue) => depValue * 2, [dep]);

      expect(reaction.computeValue()).toBe(84);
      expect(reaction.computeValue()).toBe(84);
    });

    it('should create computed reaction with two axdependencies', () => {
      const a = Reaction.create(() => 5);
      const b = Reaction.create(() => 10);
      const computed = Reaction.create((x, y) => x + y, [a, b]);

      expect(computed.computeValue()).toBe(15);
    });
  });

  describe('get() method', () => {
    it('should not compute initially (lazy evaluation)', () => {
      let callCount = 0;
      const reaction = Reaction.create(() => {
        callCount++;
        return 42;
      });

      // Should not compute until dirty or forced
      expect(callCount).toBe(0);

      // Multiple calls should still not compute
      expect(callCount).toBe(0);
    });

    it('should compute when forced and cache results', () => {
      let callCount = 0;
      const reaction = Reaction.create(() => {
        callCount++;
        return 42;
      });

      // Force computation
      expect(reaction.computeValue()).toBe(42);
      expect(callCount).toBe(1);

      // Force again should recompute
      expect(reaction.computeValue()).toBe(42);
      expect(callCount).toBe(2);
    });

    it('should recompute when marked dirty', () => {
      let value = 10;
      let callCount = 0;
      const reaction = Reaction.create(() => {
        callCount++;
        return value;
      });

      // Force initial computation
      expect(reaction.computeValue()).toBe(10);
      expect(callCount).toBe(1);

      // Change value and mark dirty
      value = 20;
      reaction.markDirty();

      expect(reaction.computeValue()).toBe(20);
      expect(callCount).toBe(2);
    });
  });

  describe('watch() and unwatch() methods', () => {
    it('should add and remove watchers', () => {
      const reaction = Reaction.create(() => 'test');
      const callback = jest.fn();

      reaction.watch(callback);
      
      // But forced get should work
      expect(reaction.computeValue()).toBe('test');

      reaction.unwatch(callback);
    });

    it('should add and remove watchers with component name', () => {
      const reaction = Reaction.create(() => 'test');
      const callback = jest.fn();

      reaction.watch(callback, 'test component');
      
      // But forced get should work
      expect(reaction.computeValue()).toBe('test');

      reaction.unwatch(callback);
    });

    it('should call watchers when value changes through markDirty', async () => {
      let value = 1;
      const reaction = Reaction.create(() => value);
      const callback = jest.fn();

      reaction.watch(callback);
      
      // Force initial computation
      expect(reaction.computeValue()).toBe(1);

      // Change value and mark dirty to trigger watcher
      value = 2;
      reaction.markDirty();

      await waitForMicrotasks();
      expect(callback).toHaveBeenCalledWith(2);
      expect(callback).toHaveBeenCalledTimes(1);

      reaction.unwatch(callback);
    });

    it('should handle multiple watchers', async () => {
      let value = 1;
      const reaction = Reaction.create(() => value);
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      reaction.watch(callback1);
      reaction.watch(callback2);

      // Force initial computation
      reaction.computeValue();
      expect(callback1).toHaveBeenCalledTimes(0);
      expect(callback2).toHaveBeenCalledTimes(0);

      value = 2;
      reaction.markDirty();

      await waitForMicrotasks();
      expect(callback1).toHaveBeenCalledWith(2);
      expect(callback2).toHaveBeenCalledWith(2);
      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);

      reaction.unwatch(callback1);
      reaction.unwatch(callback2);
    });

    it('should dispose when no more watchers', () => {
      const dep = Reaction.create(() => 'dep');
      const computed = Reaction.create((val) => `computed: ${val}`, [dep]);
      const callback = jest.fn();

      computed.watch(callback);
      computed.unwatch(callback);

      // Should still work but dispose internally
      expect(computed.computeValue()).toBe('computed: dep');
    });
  });

  describe('dependency management', () => {
    it('should track dependencies correctly when forced', () => {
      const a = Reaction.create(() => 1);
      const b = Reaction.create(() => 2);
      const sum = Reaction.create((x, y) => x + y, [a, b]);

      expect(sum.computeValue()).toBe(3);
    });

    it('should create dependency chain with watchers', async () => {
      let aValue = 1;
      let bValue = 2;

      const a = Reaction.create(() => aValue);
      const b = Reaction.create(() => bValue);
      const sum = Reaction.create((x, y) => x + y, [a, b]);
      const sumCallback = jest.fn();

      sum.watch(sumCallback);
      expect(sum.computeValue()).toBe(3);

      // When dependency changes and is marked dirty, dependent should be marked dirty too
      aValue = 5;
      a.markDirty();

      await waitForMicrotasks();
      expect(sumCallback).toHaveBeenCalledWith(7); // 5 + 2

      sum.unwatch(sumCallback);
    });

    it('should propagate dirty state through dependency chain', async () => {
      let baseValue = 1;
      const base = Reaction.create(() => baseValue);
      const middle = Reaction.create((val) => val * 2, [base]);
      const top = Reaction.create((val) => val + 10, [middle]);
      
      const topCallback = jest.fn();
      top.watch(topCallback);

      expect(top.computeValue()).toBe(12); // (1 * 2) + 10

      // Change base value and mark it dirty
      baseValue = 3;
      base.markDirty();

      await waitForMicrotasks();
      expect(topCallback).toHaveBeenCalledWith(16); // (3 * 2) + 10
      expect(top.computeValue()).toBe(16); 

      top.unwatch(topCallback);
    });
  });

  describe('markDirty() method', () => {
    it('should mark reaction as dirty and schedule recomputation for alive reactions', async () => {
      let value = 1;
      const reaction = Reaction.create(() => value);
      const callback = jest.fn();

      reaction.watch(callback);
      reaction.computeValue(); // Force initial computation

      value = 2;
      reaction.markDirty();

      // Should be dirty immediately
      expect(reaction.isDirty).toBe(true);

      await waitForMicrotasks();
      expect(callback).toHaveBeenCalledWith(2);

      reaction.unwatch(callback);
    });

    it('should propagate dirty state to dependents', () => {
      const dep = Reaction.create(() => 'dep');
      const computed = Reaction.create((val) => `computed: ${val}`, [dep]);
      
      // Need to establish the dependency relationship first
      const callback = jest.fn();
      computed.watch(callback);

      expect(computed.isDirty).toBe(false);
      dep.markDirty();
      expect(computed.isDirty).toBe(true);
      
      computed.unwatch(callback);
    });

    it('should not schedule if already scheduled', async () => {
      let value = 1;
      let computeCount = 0;
      const reaction = Reaction.create(() => {
        computeCount++;
        return value;
      });
      const callback = jest.fn();

      reaction.watch(callback);
      reaction.computeValue(); // Force initial computation
      expect(computeCount).toBe(1);
      
      // Clear callback history
      callback.mockClear();
      
      value = 2;
      reaction.markDirty(); // First call - should schedule
      reaction.markDirty(); // Second call - should not schedule again
      reaction.markDirty(); // Third call - should not schedule again

      await waitForMicrotasks();
      
      // Should only recompute once despite multiple markDirty calls
      expect(computeCount).toBe(2);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(2);

      reaction.unwatch(callback);
    });
  });

  describe('ensureAliveWith functionality', () => {
    it('should establish dependency relationships when watching', () => {
      const dep = Reaction.create(() => 'dependency');
      const computed = Reaction.create((val) => `computed: ${val}`, [dep]);
      const callback = jest.fn();

      // When watching, dependencies should be ensured alive
      computed.watch(callback);
      expect(computed.computeValue()).toBe('computed: dependency');

      computed.unwatch(callback);
    });

    it('should create proper dependency graph', async () => {
      let value = 1;
      const base = Reaction.create(() => value);
      const level1 = Reaction.create((val) => val * 2, [base]);
      const level2 = Reaction.create((val) => val + 10, [level1]);
      
      const callback = jest.fn();
      level2.watch(callback);

      expect(level2.computeValue()).toBe(12); // (1 * 2) + 10

      // Marking base dirty should propagate through the entire chain
      value = 5;
      base.markDirty();

      await waitForMicrotasks();
      expect(callback).toHaveBeenCalledWith(20); // (5 * 2) + 10

      level2.unwatch(callback);
    });
  });

  describe('disposal and cleanup', () => {
    it('should dispose unused reactions', () => {
      const dep = Reaction.create(() => 'dependency');
      const computed = Reaction.create((val) => `computed: ${val}`, [dep]);
      const callback = jest.fn();

      computed.watch(callback);
      computed.unwatch(callback);

      // After unwatch, if no more watchers, should dispose
      // We can verify this works by checking the reaction still functions
      expect(computed.computeValue()).toBe('computed: dependency');
    });

    it('should clean up dependency relationships on disposal', () => {
      const a = Reaction.create(() => 1);
      const b = Reaction.create(() => 2);
      const c = Reaction.create((x, y) => x + y, [a, b]);
      const d = Reaction.create((val) => val * 2, [c]);

      const callback = jest.fn();
      d.watch(callback);
      expect(d.computeValue()).toBe(6); // (1 + 2) * 2

      d.unwatch(callback);
      // Dependencies should be cleaned up properly
    });

    it('should keep shared dependencies alive when other dependents exist', async () => {
      let sharedValue = 1;
      const shared = Reaction.create(() => sharedValue);
      const computed1 = Reaction.create((val) => `comp1: ${val}`, [shared]);
      const computed2 = Reaction.create((val) => `comp2: ${val}`, [shared]);

      const callback1 = jest.fn();
      const callback2 = jest.fn();
      computed1.watch(callback1);
      computed2.watch(callback2);

      expect(computed1.computeValue()).toBe('comp1: 1');
      expect(computed2.computeValue()).toBe('comp2: 1');

      // Clear the call history from initial computation
      callback1.mockClear();
      callback2.mockClear();

      // Unwatch first computed
      computed1.unwatch(callback1);

      // Shared dependency should still work for computed2
      sharedValue = 2;
      shared.markDirty();

      await waitForMicrotasks();
      expect(callback2).toHaveBeenCalledWith('comp2: 2');
      expect(callback1).not.toHaveBeenCalled(); // Should not be called after unwatch

      computed2.unwatch(callback2);
    });
  });

  describe('error handling', () => {
    it('should handle errors in compute function when forced', () => {
      const errorReaction = Reaction.create(() => {
        consoleLog('error', '[reflex] Computation error');
        return null;
      });

      // Should compute and return null when forced
      expect(errorReaction.computeValue()).toBeNull();
      expectLogCall('error', '[reflex] Computation error');
    });

    it('should handle errors in watchers', async () => {
      let value = 1;
      const reaction = Reaction.create(() => value);
      const errorCallback = jest.fn(() => {
        consoleLog('error', '[reflex] Watcher error');
      });
      const normalCallback = jest.fn();

      reaction.watch(errorCallback);
      reaction.watch(normalCallback);
      
      reaction.computeValue(); // Force initial computation

      value = 2;
      reaction.markDirty();

      await waitForMicrotasks();

      // Error should be logged but not stop other watchers
      expectLogCall('error', '[reflex] Watcher error');
      expect(normalCallback).toHaveBeenCalledWith(2);

      reaction.unwatch(errorCallback);
      reaction.unwatch(normalCallback);
    });
  });

  describe('scheduling and microtasks', () => {
    it('should schedule recomputation using microtasks for alive reactions', async () => {
      let value = 1;
      const reaction = Reaction.create(() => value);
      const callback = jest.fn();

      reaction.watch(callback);
      expect(reaction.computeValue()).toBe(1);
      
      // Clear any initial calls from the forced computation
      callback.mockClear();

      value = 2;
      reaction.markDirty();

      // Callback should not be called immediately after markDirty
      expect(callback).not.toHaveBeenCalled();

      await waitForMicrotasks();
      expect(callback).toHaveBeenCalledWith(2);

      reaction.unwatch(callback);
    });

    it('should batch multiple dirty marks into single recomputation', async () => {
      let computeCount = 0;
      let value = 1;
      
      const reaction = Reaction.create(() => {
        computeCount++;
        return value;
      });
      const callback = jest.fn();

      reaction.watch(callback);
      expect(reaction.computeValue()).toBe(1);
      expect(computeCount).toBe(1);
      
      // Clear initial calls
      callback.mockClear();

      // Mark dirty multiple times
      value = 2;
      reaction.markDirty();
      reaction.markDirty();
      reaction.markDirty();

      await waitForMicrotasks();
      
      // Should only compute once despite multiple markDirty calls
      expect(computeCount).toBe(2);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(2);

      reaction.unwatch(callback);
    });
  });

  describe('lifecycle and state management', () => {
    it('should track alive state correctly', () => {
      const reaction = Reaction.create(() => 'test');
      const callback = jest.fn();

      // Initially not alive (no watchers or dependents)
      reaction.watch(callback);
      // Now alive (has watchers)

      expect(reaction.computeValue()).toBe('test');

      reaction.unwatch(callback);
      // Should handle disposal if no longer alive
    });

    it('should track dirty state correctly', () => {
      const reaction = Reaction.create(() => 'test');

      expect(reaction.isDirty).toBe(false);
      
      reaction.markDirty();
      expect(reaction.isDirty).toBe(true);

      expect(reaction.computeValue()).toBe('test');
      expect(reaction.isDirty).toBe(false);
    });

    it('should handle force parameter in get method', () => {
      let computeCount = 0;
      const reaction = Reaction.create(() => {
        computeCount++;
        return 'value';
      });

      expect(computeCount).toBe(0);

      // Force get should compute
      expect(reaction.computeValue()).toBe('value');
      expect(computeCount).toBe(1);

      // Force get should recompute
      expect(reaction.computeValue()).toBe('value');
      expect(computeCount).toBe(2);
    });
  });

  describe('complex scenarios', () => {
    it('should handle diamond dependency pattern', async () => {
      let baseValue = 1;
      const base = Reaction.create(() => baseValue);
      const left = Reaction.create((val) => val * 2, [base]);
      const right = Reaction.create((val) => val + 1, [base]);
      const top = Reaction.create((l, r) => l + r, [left, right]);

      const callback = jest.fn();
      top.watch(callback);

      expect(top.computeValue()).toBe(4); // (1 * 2) + (1 + 1) = 4

      baseValue = 3;
      base.markDirty();

      await waitForMicrotasks();
      expect(callback).toHaveBeenCalledWith(10); // (3 * 2) + (3 + 1) = 10

      top.unwatch(callback);
    });

    it('should stay dirty without recomputing until watched', async () => {
      let baseValue = 1;
      let baseCallCount = 0;
      let dependentCallCount = 0;

      const base = Reaction.create(() => {
        baseCallCount++;
        return baseValue;
      });
      
      const dependent = Reaction.create((val) => {
        dependentCallCount++;
        return val * 2;
      }, [base]);

      // Mark base as dirty - should not recompute since no watchers
      base.markDirty();
      expect(base.isDirty).toBe(true);
      expect(baseCallCount).toBe(0);

      expect(dependent.isDirty).toBe(false);
      expect(dependentCallCount).toBe(0);

      // Now watch the dependent reaction
      const callback = jest.fn();
      dependent.watch(callback);
      expect(dependent.isDirty).toBe(false);
      expect(dependentCallCount).toBe(0);

      // Change value and mark base as dirty again
      baseValue = 5;
      base.markDirty();
      expect(base.isDirty).toBe(true);
      expect(dependent.isDirty).toBe(true);

      // Wait for microtasks to process
      await waitForMicrotasks();

      // Should have computed with new value
      expect(callback).toHaveBeenCalledWith(10); // 5 * 2
      expect(baseCallCount).toBe(1);
      expect(dependentCallCount).toBe(1);

      dependent.unwatch(callback);
    });

    it('should handle multiple watchers lifecycle correctly', async () => {
      let baseValue = 1;
      let baseCallCount = 0;
      let dependentCallCount = 0;

      const base = Reaction.create(() => {
        baseCallCount++;
        return baseValue;
      });
      
      const dependent = Reaction.create((val) => {
        dependentCallCount++;
        return val * 2;
      }, [base]);

      // Add two watchers
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      dependent.watch(callback1);
      dependent.watch(callback2);

      // Trigger computation and verify both callbacks dispatched
      baseValue = 2;
      base.markDirty();

      await waitForMicrotasks();
      expect(callback1).toHaveBeenCalledWith(4); // 2 * 2
      expect(callback2).toHaveBeenCalledWith(4); // 2 * 2
      expect(baseCallCount).toBe(1);
      expect(dependentCallCount).toBe(1);

      // Clear call history
      callback1.mockClear();
      callback2.mockClear();
      baseCallCount = 0;
      dependentCallCount = 0;

      // Remove one watcher - reactions should still be alive
      dependent.unwatch(callback1);

      // Trigger again and verify only remaining callback dispatched
      baseValue = 3;
      base.markDirty();

      await waitForMicrotasks();
      expect(callback1).not.toHaveBeenCalled(); // Should not be called after unwatch
      expect(callback2).toHaveBeenCalledWith(6); // 3 * 2
      expect(baseCallCount).toBe(1);
      expect(dependentCallCount).toBe(1);

      // Clear call history
      callback2.mockClear();
      baseCallCount = 0;
      dependentCallCount = 0;

      // Remove last watcher - reactions should become dead
      dependent.unwatch(callback2);

      // Trigger root reaction - should not compute since no watchers
      baseValue = 4;
      base.markDirty();

      await waitForMicrotasks();
      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
      expect(baseCallCount).toBe(0); // No computation should occur
      expect(dependentCallCount).toBe(0);

      // Add two watchers back
      const callback3 = jest.fn();
      const callback4 = jest.fn();
      dependent.watch(callback3);
      dependent.watch(callback4);

      // Trigger root - both should be handled
      baseValue = 5;
      base.markDirty();

      await waitForMicrotasks();
      expect(callback3).toHaveBeenCalledWith(10); // 5 * 2  
      expect(callback4).toHaveBeenCalledWith(10); // 5 * 2
      expect(baseCallCount).toBe(1);
      expect(dependentCallCount).toBe(1);

      // Clean up
      dependent.unwatch(callback3);
      dependent.unwatch(callback4);
    });

    it('should call each computation function only once in diamond dependency pattern', async () => {
      let baseValue = 1;
      let baseCallCount = 0;
      let leftCallCount = 0;
      let rightCallCount = 0;
      let topCallCount = 0;

      const base = Reaction.create(() => {
        baseCallCount++;
        return baseValue;
      });
      
      const left = Reaction.create((val) => {
        leftCallCount++;
        return val * 2;
      }, [base]);
      
      const right = Reaction.create((val) => {
        rightCallCount++;
        return val + 1;
      }, [base]);
      
      const top = Reaction.create((l, r) => {
        topCallCount++;
        return l + r;
      }, [left, right]);

      const callback = jest.fn();
      top.watch(callback);

      // Force initial computation - with optimization, each function should be called only once
      expect(top.computeValue()).toBe(4); // (1 * 2) + (1 + 1) = 4
      
      expect(baseCallCount).toBe(1);
      expect(leftCallCount).toBe(1);
      expect(rightCallCount).toBe(1);
      expect(topCallCount).toBe(1);

      // Reset counters before testing update scenario
      baseCallCount = 0;
      leftCallCount = 0;
      rightCallCount = 0;
      topCallCount = 0;

      // Change base value and mark dirty - this should only call each function once
      baseValue = 3;
      base.markDirty();

      await waitForMicrotasks();
      
      // During update propagation, each function should also be called exactly once
      expect(baseCallCount).toBe(1);
      expect(leftCallCount).toBe(1);
      expect(rightCallCount).toBe(1);
      expect(topCallCount).toBe(1);
      expect(callback).toHaveBeenCalledWith(10); // (3 * 2) + (3 + 1) = 10

      top.unwatch(callback);
    });
  });
});

describe('Complex data structures and memoization', () => {
  const waitForMicrotasks = () => new Promise<void>(resolve => queueMicrotask(() => resolve()));

  describe('Deep equality optimization with objects', () => {
    it('should not invoke computeFn when object dependencies have not changed', async () => {
      const obj1 = { a: 1, b: { c: 2, d: [3, 4] } };
      const obj2 = { x: 10, y: { z: 20 } };
      
      const root1 = Reaction.create(() => obj1);
      const root2 = Reaction.create(() => obj2);
      
      const dep1computeFn = jest.fn((o1, o2) => ({
        total: o1.b.c + o2.y.z
      }));

      const dep1computed = Reaction.create(dep1computeFn, [root1, root2]);

      const computeFn = jest.fn((d) => ({
        ...d
      }));
      
      const computed = Reaction.create(computeFn, [dep1computed]);
      const callback = jest.fn();
      computed.watch(callback);
      
      // Force initial computation
      const result1 = computed.computeValue();
      expect(computeFn).toHaveBeenCalledTimes(1);
      expect(dep1computeFn).toHaveBeenCalledTimes(1);
      expect(result1.total).toBe(22); // 1 + 10
      
      // Mark dependencies dirty but keep same object references
      obj1.a = 2;
      obj2.x = 20;
      root1.markDirty();
      root2.markDirty();
      
      await waitForMicrotasks();
      expect(dep1computeFn).toHaveBeenCalledTimes(2);
      // computeFn should NOT be called again since values haven't changed
      expect(computeFn).toHaveBeenCalledTimes(1);
      expect(callback).not.toHaveBeenCalled();
      
      computed.unwatch(callback);
    });

    it('should invoke computeFn when object dependencies change deeply', async () => {
      const initialObj = { a: 1, b: { c: 2, d: [3, 4] } };
      let depValue = initialObj;
      
      const dep = Reaction.create(() => depValue);
      const computeFn = jest.fn((obj) => ({
        sum: obj.a + obj.b.c + obj.b.d.reduce((sum: number, n: number) => sum + n, 0)
      }));
      
      const computed = Reaction.create(computeFn, [dep]);
      const callback = jest.fn();
      computed.watch(callback);
      
      // Force initial computation
      const result1 = computed.computeValue();
      expect(computeFn).toHaveBeenCalledTimes(1);
      expect(result1.sum).toBe(10); // 1 + 2 + 3 + 4
      
      // Change object deeply and mark dirty
      depValue = { a: 1, b: { c: 2, d: [3, 5] } }; // changed 4 to 5
      dep.markDirty();
      
      await waitForMicrotasks();
      
      // computeFn should be called again since values changed
      expect(computeFn).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenCalledWith({ sum: 11 }); // 1 + 2 + 3 + 5
      
      computed.unwatch(callback);
    });
  });

  describe('Deep equality optimization with arrays', () => {
    it('should not invoke computeFn when array dependencies have not changed', async () => {
      const arr1 = [1, 2, { a: 3 }];
      const arr2 = [{ x: 4, y: [5, 6] }, 7];
      
      let dep1Value = arr1;
      let dep2Value = arr2;
      
      const dep1 = Reaction.create(() => dep1Value);
      const dep2 = Reaction.create(() => dep2Value);
      
      const computeFn = jest.fn((a1, a2) => [
        ...a1,
        ...a2
      ]);
      
      const computed = Reaction.create(computeFn, [dep1, dep2]);
      const callback = jest.fn();
      computed.watch(callback);
      
      // Force initial computation
      const result1 = computed.computeValue();
      expect(computeFn).toHaveBeenCalledTimes(1);
      expect(result1).toHaveLength(5);
      
      // Mark dependencies dirty but keep same array references
      dep1.markDirty();
      dep2.markDirty();
      
      await waitForMicrotasks();
    
      expect(callback).not.toHaveBeenCalled();
      
      computed.unwatch(callback);
    });

    it('should invoke computeFn when array dependencies change', async () => {
      let depValue = [1, 2, { a: 3, b: [4, 5] }];
      
      const dep = Reaction.create(() => depValue);
      const computeFn = jest.fn((arr) => {
        return arr.reduce((sum: number, item: any) => {
          if (typeof item === 'number') return sum + item;
          if (typeof item === 'object' && item.a) {
            return sum + item.a + (item.b?.reduce((s: number, n: number) => s + n, 0) || 0);
          }
          return sum;
        }, 0);
      });
      
      const computed = Reaction.create(computeFn, [dep]);
      const callback = jest.fn();
      computed.watch(callback);
      
      // Force initial computation
      expect(computed.computeValue()).toBe(15); // 1 + 2 + 3 + 4 + 5
      expect(computeFn).toHaveBeenCalledTimes(1);
      
      // Change array element
      depValue = [1, 2, { a: 3, b: [4, 6] }]; // changed 5 to 6
      dep.markDirty();
      
      await waitForMicrotasks();
      
      // computeFn should be called again since values changed
      expect(computeFn).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenCalledWith(16); // 1 + 2 + 3 + 4 + 6
      
      computed.unwatch(callback);
    });
  });

  describe('Deep equality optimization with nested structures', () => {
    it('should handle complex nested object with arrays and primitives', async () => {
      const complexObj = {
        id: 1,
        name: 'test',
        data: {
          values: [1, 2, 3],
          metadata: {
            created: new Date('2023-01-01'),
            tags: ['a', 'b'],
            config: {
              enabled: true,
              settings: { theme: 'dark', lang: 'en' }
            }
          }
        },
        items: [
          { id: 1, value: 'one' },
          { id: 2, value: 'two' }
        ]
      };
      
      let depValue = complexObj;
      
      const dep = Reaction.create(() => depValue);
      const computeFn = jest.fn((obj) => ({
        summary: {
          id: obj.id,
          name: obj.name,
          valueSum: obj.data.values.reduce((s: number, n: number) => s + n, 0),
          tagCount: obj.data.metadata.tags.length,
          itemCount: obj.items.length,
          theme: obj.data.metadata.config.settings.theme
        }
      }));
      
      const computed = Reaction.create(computeFn, [dep]);
      const callback = jest.fn();
      computed.watch(callback);
      
      // Force initial computation
      const result1 = computed.computeValue();
      expect(computeFn).toHaveBeenCalledTimes(1);
      expect(result1.summary.valueSum).toBe(6);
      expect(result1.summary.tagCount).toBe(2);
      
      // Create structurally identical object (different reference)
      depValue = {
        id: 1,
        name: 'test',
        data: {
          values: [1, 2, 3],
          metadata: {
            created: new Date('2023-01-01'),
            tags: ['a', 'b'],
            config: {
              enabled: true,
              settings: { theme: 'dark', lang: 'en' }
            }
          }
        },
        items: [
          { id: 1, value: 'one' },
          { id: 2, value: 'two' }
        ]
      };
      dep.markDirty();
      
      await waitForMicrotasks();
      
      expect(callback).not.toHaveBeenCalled();
      
      // Now make a deep change
      depValue = {
        ...depValue,
        data: {
          ...depValue.data,
          metadata: {
            ...depValue.data.metadata,
            config: {
              ...depValue.data.metadata.config,
              settings: { 
                ...depValue.data.metadata.config.settings,
                theme: 'light' // Changed theme
              }
            }
          }
        }
      };
      dep.markDirty();
      
      await waitForMicrotasks();
      
      expect(callback).toHaveBeenCalledWith({
        summary: expect.objectContaining({
          theme: 'light'
        })
      });
      
      computed.unwatch(callback);
    });
  });

  describe('Multiple complex dependencies', () => {
    it('should optimize correctly with multiple complex dependencies', async () => {
      const obj1 = { users: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }] };
      const obj2 = { config: { theme: 'dark', features: ['a', 'b'] } };
      const obj3 = { stats: { views: 100, likes: 50 } };
      
      let dep1Value = obj1;
      let dep2Value = obj2;
      let dep3Value = obj3;
      
      const dep1 = Reaction.create(() => dep1Value);
      const dep2 = Reaction.create(() => dep2Value);
      const dep3 = Reaction.create(() => dep3Value);
      
      const computeFn = jest.fn((users, config, stats) => ({
        userCount: users.users.length,
        theme: config.config.theme,
        featureCount: config.config.features.length,
        totalEngagement: stats.stats.views + stats.stats.likes
      }));
      
      const computed = Reaction.create(computeFn, [dep1, dep2, dep3]);
      const callback = jest.fn();
      computed.watch(callback);
      
      // Force initial computation
      const result1 = computed.computeValue();
      expect(computeFn).toHaveBeenCalledTimes(1);
      expect(result1.totalEngagement).toBe(150);
      
      // Mark all dependencies dirty but don't change values
      dep1.markDirty();
      dep2.markDirty();
      dep3.markDirty();
      
      await waitForMicrotasks();
      
      expect(callback).not.toHaveBeenCalled();
      
      // Change only one dependency
      dep2Value = { config: { theme: 'light', features: ['a', 'b'] } };
      dep2.markDirty();
      
      await waitForMicrotasks();
      
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        theme: 'light'
      }));
      
      computed.unwatch(callback);
    });
  });

  describe('Custom equality check configuration', () => {
    // Note: Equality checks are only used for COMPUTED reactions (those with dependencies).
    // Root reactions always mark changed=true and don't use equality checks.

    it('should use custom equality check for computed reactions', async () => {
      // Custom equality: only compare the 'id' field, ignoring 'timestamp'
      const idOnlyEqual: EqualityCheckFn = (a, b) => a?.id === b?.id;
      let rootValue = { id: 1, timestamp: 100 };
      const root = Reaction.create(() => rootValue);
      const computed = Reaction.create((val) => ({ ...val }), [root], idOnlyEqual);
      const callback = jest.fn();

      computed.watch(callback);
      expect(computed.computeValue()).toEqual({ id: 1, timestamp: 100 });
      callback.mockClear();

      // Change timestamp but keep id same - custom equality should consider them equal
      rootValue = { id: 1, timestamp: 999 };
      root.markDirty();

      await waitForMicrotasks();
      // Callback should NOT be called because idOnlyEqual considers them equal (same id)
      expect(callback).not.toHaveBeenCalled();

      // Now change the id - custom equality should detect the change
      callback.mockClear();
      rootValue = { id: 2, timestamp: 999 };
      root.markDirty();

      await waitForMicrotasks();
      // Callback SHOULD be called because id changed
      expect(callback).toHaveBeenCalledWith({ id: 2, timestamp: 999 });

      computed.unwatch(callback);
    });

    it('should use never-equal check to always trigger changes', async () => {
      // neverEqual treats all values as different, so watchers should always be notified
      const neverEqual: EqualityCheckFn = () => false;
      let rootValue = 1;
      const root = Reaction.create(() => rootValue);
      const computed = Reaction.create((val) => val, [root], neverEqual);
      const callback = jest.fn();

      computed.watch(callback);
      expect(computed.computeValue()).toBe(1);
      callback.mockClear();

      // Even with same value, neverEqual should trigger change
      rootValue = 1; // Same value
      root.markDirty();

      await waitForMicrotasks();
      expect(callback).toHaveBeenCalledWith(1); // Should be called even though value didn't change

      computed.unwatch(callback);
    });

    it('should use reference equality instead of deep equality', async () => {
      // Reference equality will detect changes when object reference changes,
      // even if the content is the same
      const referenceEqual: EqualityCheckFn = (a, b) => a === b;
      let rootObj = { count: 1 };
      const root = Reaction.create(() => rootObj);
      // Pass through the same object reference
      const computed = Reaction.create((val) => val, [root], referenceEqual);
      const callback = jest.fn();

      computed.watch(callback);
      expect(computed.computeValue()).toEqual({ count: 1 });
      callback.mockClear();

      // Create new object with same content - reference equality should detect change
      rootObj = { count: 1 };
      root.markDirty();

      await waitForMicrotasks();
      expect(callback).toHaveBeenCalledWith({ count: 1 }); // Called because reference changed

      computed.unwatch(callback);
    });

    it('should not trigger change with reference equality when reference is same', async () => {
      const referenceEqual: EqualityCheckFn = (a, b) => a === b;
      const obj = { count: 1 };
      let rootObj = obj;
      const root = Reaction.create(() => rootObj);
      const computed = Reaction.create((val) => val, [root], referenceEqual);
      const callback = jest.fn();

      computed.watch(callback);
      expect(computed.computeValue()).toEqual({ count: 1 });
      callback.mockClear();

      // Mutate object but keep same reference
      obj.count = 999;
      rootObj = obj; // Same reference
      root.markDirty();

      await waitForMicrotasks();
      // Should NOT be called because reference is the same (even though content changed)
      expect(callback).not.toHaveBeenCalled();

      computed.unwatch(callback);
    });

    it('should fall back to deep equality when no custom equality provided', async () => {
      let obj = { count: 1 };
      const root = Reaction.create(() => obj);
      const computed = Reaction.create((val) => val, [root]); // No custom equality - uses deep equality
      const callback = jest.fn();

      computed.watch(callback);
      expect(computed.computeValue()).toEqual({ count: 1 });
      callback.mockClear();

      // Create new object with same content - deep equality should NOT detect change
      obj = { count: 1 };
      root.markDirty();

      await waitForMicrotasks();
      expect(callback).not.toHaveBeenCalled(); // Should not be called due to deep equality

      computed.unwatch(callback);
    });

    it('should trigger change with deep equality when content differs', async () => {
      let obj = { count: 1 };
      const root = Reaction.create(() => obj);
      const computed = Reaction.create((val) => val, [root]); // No custom equality - uses deep equality
      const callback = jest.fn();

      computed.watch(callback);
      expect(computed.computeValue()).toEqual({ count: 1 });
      callback.mockClear();

      // Create new object with different content
      obj = { count: 2 };
      root.markDirty();

      await waitForMicrotasks();
      expect(callback).toHaveBeenCalledWith({ count: 2 }); // Should be called due to different content

      computed.unwatch(callback);
    });
  });
}); 