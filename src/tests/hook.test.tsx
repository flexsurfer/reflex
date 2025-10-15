/**
 * @jest-environment jsdom
 */
import { renderHook, cleanup, act, waitFor } from '@testing-library/react';
import { regSub } from '../subs';
import { initAppDb } from '../db';
import { useSubscription } from '../hook';
import { regEvent } from '../events';
import { dispatch } from '../router';
import { waitForEventAndReaction } from './test-utils';

describe('React Hooks', () => {
  // Register test subscriptions
  regSub('user');
  regSub('user-name', (user) => user?.name, () => [['user']]);
  regSub('todos');
  regSub('todos-count', (todos) => (todos || []).length, () => [['todos']]);

  beforeEach(() => {
    // Set up test data
    initAppDb({
      user: {
        name: 'John Doe',
        email: 'john@example.com'
      },
      todos: [
        { id: 1, text: 'Test todo', completed: false }
      ]
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe('useSubscription', () => {
    it('should return current root subscription value', () => {
      const { result } = renderHook(() => useSubscription(['user']));

      expect(result.current).toEqual({
        name: 'John Doe',
        email: 'john@example.com'
      });
    });

    it('should return derived subscription value', () => {
      const { result } = renderHook(() => useSubscription(['user-name']));

      expect(result.current).toBe('John Doe');
    });

    it('should return array subscription value', () => {
      const { result } = renderHook(() => useSubscription(['todos']));

      expect(result.current).toEqual([
        { id: 1, text: 'Test todo', completed: false }
      ]);
    });

    it('should return computed subscription value', () => {
      const { result } = renderHook(() => useSubscription(['todos-count']));

      expect(result.current).toBe(1);
    });

    it('should handle subscription with parameters', () => {
      // Register a parameterized subscription
      regSub('todo-by-id', (todos, id) => {
        return (todos || []).find((todo: any) => todo.id === id);
      }, () => [['todos']]);

      const { result } = renderHook(() => useSubscription(['todo-by-id', 1]));

      expect(result.current).toEqual({
        id: 1,
        text: 'Test todo',
        completed: false
      });
    });

    it('should handle subscription with deps parameters', () => {

      // Register a subscription that uses parameters in deps function
      regSub('todo-name-by-id', (todo) => {
        return todo?.text || null;
      }, (id) => {
        // Use the id parameter to create dynamic dependencies
        return [['todo-by-id', id]];
      });

      const { result } = renderHook(() => useSubscription(['todo-name-by-id', 1]));

      expect(result.current).toBe('Test todo');
    });

    it('should handle non-existent subscription gracefully', () => {
      const { result } = renderHook(() => useSubscription(['non-existent-sub']));
      
      // Should return undefined for non-existent subscription
      expect(result.current).toBeUndefined();
      
      // Should have logged the error
      expectLogCall('error', '[reflex] no sub handler registered for: non-existent-sub');
    });

    it('should update when subscription value changes', async () => {
      const { result } = renderHook(() => useSubscription(['todos-count']));

      expect(result.current).toBe(1);

      regEvent('set-todos', ({ draftDb }) => {
        draftDb.todos = [
          { id: 1, text: 'Test todo', completed: false },
          { id: 2, text: 'Another todo', completed: true }
        ];
      });
      // Update the database using updateAppDb for reactivity
      act(() => {
        dispatch(['set-todos']);
      });

      // Wait for the hook to automatically re-render due to subscription changes
      await waitFor(() => {
        expect(result.current).toBe(2);
      });
    });

    it('should handle multiple subscriptions in same component', () => {
      const { result } = renderHook(() => ({
        user: useSubscription<{ name: string, email: string }>(['user']),
        userName: useSubscription<string>(['user-name']),
        todosCount: useSubscription<number>(['todos-count'])
      }));

      expect(result.current.user?.name).toBe('John Doe');
      expect(result.current.userName).toBe('John Doe');
      expect(result.current.todosCount).toBe(1);
    });

    it('should re-render when AppDB changes via event dispatch', async () => {
      // Register an event handler that updates AppDB
      regEvent('add-todo', ({ draftDb }, text) => {

        const currentTodos = draftDb.todos || [];
        const newTodo = {
          id: Date.now(),
          text,
          completed: false
        };
        draftDb.todos = [...currentTodos, newTodo];
      });

      regEvent('update-user-name', ({ draftDb }, newName) => {
        if (!draftDb.user) draftDb.user = {};
        draftDb.user.name = newName;
      });

      // Set up hook to watch todos count
      const { result } = renderHook(() => ({
        todosCount: useSubscription<number>(['todos-count']),
        userName: useSubscription<string>(['user-name']),
        todos: useSubscription<Array<{ id: number, text: string, completed: boolean }>>(['todos'])
      }));

      // Initial state
      expect(result.current.todosCount).toBe(1);
      expect(result.current.userName).toBe('John Doe');
      expect(result.current.todos).toHaveLength(1);

      // Dispatch event to add a todo
      act(() => {
        dispatch(['add-todo', 'Learn Simple Reactive System']);
      });

      // Wait for event processing and reaction recomputation
      await waitForEventAndReaction();

      // Wait for the hook to automatically re-render due to subscription changes
      await waitFor(() => {
        expect(result.current.todosCount).toBe(2);
        expect(result.current.todos).toHaveLength(2);
        expect(result.current.todos[1].text).toBe('Learn Simple Reactive System');
      });

      // Dispatch event to update user name
      act(() => {
        dispatch(['update-user-name', 'Jane Smith']);
      });

      // Wait for event processing and reaction recomputation
      await waitForEventAndReaction();

      // Wait for the hook to automatically re-render due to subscription changes
      await waitFor(() => {
        expect(result.current.userName).toBe('Jane Smith');
        // Todos count should remain the same
        expect(result.current.todosCount).toBe(2);
      });
    });

    it('should handle rapid event dispatches correctly', async () => {
      // Register counter event
      regEvent('increment-counter', ({ draftDb }) => {
        draftDb.counter = (draftDb.counter || 0) + 1;
      });

      regEvent('set-counter', ({ draftDb },value) => {
        draftDb.counter = value;
      });

      // Register counter subscription
      regSub('counter');

      // Set initial counter
      initAppDb({
        counter: 0
      });

      const { result } = renderHook(() => ({
        counter: useSubscription(['counter'])
      }));

      expect(result.current.counter).toBe(0);

      // Dispatch multiple increments
      act(() => {
        dispatch(['increment-counter']);
        dispatch(['increment-counter']);
        dispatch(['increment-counter']);
      });

      // Wait for event processing and reaction recomputation
      await waitForEventAndReaction();

      // Wait for the hook to automatically re-render due to subscription changes
      await waitFor(() => {
        expect(result.current.counter).toBe(3);
      });

      // Set counter to specific value
      act(() => {
        dispatch(['set-counter', 10]);
      });

      // Wait for event processing and reaction recomputation
      await waitForEventAndReaction();

      // Wait for the hook to automatically re-render due to subscription changes
      await waitFor(() => {
        expect(result.current.counter).toBe(10);
      });

      // More increments
      act(() => {
        dispatch(['increment-counter']);
        dispatch(['increment-counter']);
      });

      // Wait for event processing and reaction recomputation
      await waitForEventAndReaction();

      // Wait for the hook to automatically re-render due to subscription changes
      await waitFor(() => {
        expect(result.current.counter).toBe(12);
      });
    });
  });
}); 