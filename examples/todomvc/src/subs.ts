import { regSub, setupSubsHotReload } from '@lib/index';
import type { Todos, Showing } from './db';

// Root subscriptions
regSub('todos');
regSub('showing');

// Computed subscriptions
regSub('visible-todos', (todos: Todos, showing: Showing) => {
    if (!todos) return [];
    const todosArray = Array.from(todos.values());
    switch (showing) {
        case 'active':
            return todosArray.filter(todo => !todo.done);
        case 'done':
            return todosArray.filter(todo => todo.done);
        default:
            return todosArray;
    }
}, () => [['todos'], ['showing']]);

regSub('all-complete?', (todos: Todos) => {
    const todosArray = Array.from(todos.values());
    return todosArray.length > 0 && todosArray.every(todo => todo.done);
}, () => [['todos']]);

regSub('footer-counts', (todos: Todos) => {
    const todosArray = Array.from(todos.values());
    const active = todosArray.filter(todo => !todo.done).length;
    const done = todosArray.filter(todo => todo.done).length;
    return [active, done];
}, () => [['todos']]);

if (import.meta.hot) {
    const { dispose, accept } = setupSubsHotReload();
    import.meta.hot.dispose(dispose);
    import.meta.hot.accept(accept);
}
