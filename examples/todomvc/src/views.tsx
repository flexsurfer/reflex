import React, { useState, useEffect, useRef } from 'react';
import { useSubscription, dispatch } from '@lib/index';
import type { Todo, Showing } from './db';

interface TodoInputProps {
  title?: string;
  onSave: (value: string) => void;
  onStop?: () => void;
  className?: string;
  id?: string;
  placeholder?: string;
}

const TodoInput: React.FC<TodoInputProps> = ({ 
  title = '', 
  onSave, 
  onStop, 
  className = '',
  id,
  placeholder 
}) => {
  const [value, setValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const stop = () => {
    setValue('');
    if (onStop) onStop();
  };

  const save = () => {
    const trimmed = value.trim();
    onSave(trimmed);
    stop();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      save();
    } else if (e.key === 'Escape') {
      stop();
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      className={className}
      id={id}
      placeholder={placeholder}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={handleKeyDown}
    />
  );
};

interface TodoItemProps {
  todo: Todo;
}

const TodoItem: React.FC<TodoItemProps> = React.memo(({ todo }) => {
  const [editing, setEditing] = useState(false);
  
  const handleSave = (newTitle: string) => {
    if (newTitle.length === 0) {
      dispatch(['delete-todo', todo.id]);
    } else {
      dispatch(['save', todo.id, newTitle]);
    }
    setEditing(false);
  };

  return (
    <li className={`${todo.done ? 'completed ' : ''}${editing ? 'editing' : ''}`}>
      <div className="view">
        <input
          className="toggle"
          type="checkbox"
          checked={todo.done}
          onChange={() => dispatch(['toggle-done', todo.id])}
        />
        <label onDoubleClick={() => setEditing(true)}>
          {todo.title}
        </label>
        <button
          className="destroy"
          onClick={() => dispatch(['delete-todo', todo.id])}
        />
      </div>
      {editing && (
        <TodoInput
          className="edit"
          title={todo.title}
          onSave={handleSave}
          onStop={() => setEditing(false)}
        />
      )}
    </li>
  );
});

const VisibleTodos: React.FC = () => {
    const visibleTodos = useSubscription<Todo[]>(['visible-todos'], 'VisibleTodos');

    return (
        <ul id="todo-list">
        {visibleTodos.map(todo => (
          <TodoItem key={todo.id} todo={todo} />
        ))}
      </ul>
    );
  };

const TaskList: React.FC = () => {
  const allComplete = useSubscription<boolean>(['all-complete?'], 'TaskList');

  return (
    <section id="main">
      <input
        id="toggle-all"
        type="checkbox"
        checked={allComplete}
        onChange={() => dispatch(['complete-all-toggle'])}
      />
      <label htmlFor="toggle-all">
        Mark all as complete
      </label>
      <VisibleTodos />
    </section>
  );
};

const FooterControls: React.FC = () => {
  const [active, done] = useSubscription<[number, number]>(['footer-counts'], 'FooterControls');
  const showing = useSubscription<Showing>(['showing'], 'FooterControls');

  const filterLink = (filterKw: Showing, text: string) => (
    <a
      className={showing === filterKw ? 'selected' : ''}
      href={`#/${filterKw}`}
      onClick={(e) => {
        e.preventDefault();
        dispatch(['set-showing', filterKw]);
      }}
    >
      {text}
    </a>
  );

  return (
    <footer id="footer">
      <span id="todo-count">
        <strong>{active}</strong> {active === 1 ? 'item' : 'items'} left
      </span>
      <ul id="filters">
        <li>{filterLink('all', 'All')}</li>
        <li>{filterLink('active', 'Active')}</li>
        <li>{filterLink('done', 'Completed')}</li>
      </ul>
      {done > 0 && (
        <button
          id="clear-completed"
          onClick={() => dispatch(['clear-completed'])}
        >
          Clear completed
        </button>
      )}
    </footer>
  );
};

const TaskEntry: React.FC = () => {
  return (
    <header id="header">
      <h1>todos</h1>
      <TodoInput
        id="new-todo"
        placeholder="What needs to be done?"
        onSave={(title) => {
          if (title.length > 0) {
            dispatch(['add-todo', title]);
          }
        }}
      />
    </header>
  );
};

export const TodoApp: React.FC = () => {

  return (
    <>
      <section id="todoapp">
        <TaskEntry />
        <TaskList />
        <FooterControls />
      </section>
      <footer id="info">
        <p>Double-click to edit a todo</p>
      </footer>
    </>
  );
};

export default TodoApp;
