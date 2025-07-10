import { regEvent, clearHandlers } from '@lib/index';
import type { Todo, TodoId, Todos, Showing } from './db';
import { current } from 'immer';

// Event to initialize the app, load todos from localStorage with coeffect
regEvent('init-app', ({ draftDb, localStoreTodos }) => {
    if (localStoreTodos && localStoreTodos.size > 0) {
        draftDb.todos = localStoreTodos;
    }
}, [['local-store-todos']]);

// Event to add a new todo
regEvent('add-todo', ({ draftDb , now}, title: string) => {
    const newTodo: Todo = {
        id: now, // Simple ID generation
        title: title.trim(),
        done: false
    };

    draftDb.todos.set(newTodo.id, newTodo);
    // Save to localStorage
    return [['todos-to-local-store', current(draftDb.todos)]];
}, [['now']]);

// Event to toggle todo completion
regEvent('toggle-done', ({ draftDb }, id: TodoId) => {
    const todo = draftDb.todos.get(id);
    if (todo) {
        todo.done = !todo.done;
        // Save to localStorage
        return [['todos-to-local-store', current(draftDb.todos)]];
    }
});

// Event to delete a todo
regEvent('delete-todo', ({ draftDb }, id: TodoId) => {
    draftDb.todos.delete(id);
    // Save to localStorage
    return [['todos-to-local-store', current(draftDb.todos)]];
});

// Event to save/edit a todo
regEvent('save', ({ draftDb }, id: TodoId, newTitle: string) => {
    const todo = draftDb.todos.get(id);
    if (todo) {
        todo.title = newTitle.trim();
        // Save to localStorage
        return [['todos-to-local-store', current(draftDb.todos)]];
    }
});

// Event to toggle all todos completion
regEvent('complete-all-toggle', ({ draftDb }) => {
    const todosArray = Array.from((draftDb.todos as Todos).values()) as Todo[];
    const allComplete = todosArray.length > 0 && todosArray.every(todo => todo.done);

    todosArray.forEach(todo => {
        todo.done = !allComplete;
    });

    // Save to localStorage
    return [['todos-to-local-store', current(draftDb.todos)]];
});

// Event to clear completed todos
regEvent('clear-completed', ({ draftDb }) => {
    const todosArray = Array.from((draftDb.todos as Todos).entries()) as [TodoId, Todo][];
    todosArray.forEach(([id, todo]) => {
        if (todo.done) {
            draftDb.todos.delete(id);
        }
    });

    // Save to localStorage
    return [['todos-to-local-store', current(draftDb.todos)]];
});

// Event to set showing filter
regEvent('set-showing', ({ draftDb }, showing: Showing) => {
    draftDb.showing = showing;
});

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        clearHandlers('event');
    })

    import.meta.hot.accept((newModule) => {
        if (newModule) {
            console.log('updated: new events module')
        }
    })
}