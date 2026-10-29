const STORAGE_KEY = 'todo-list-items-v1';
const FILTERS = ['all', 'active', 'completed'];

const todoForm = document.getElementById('todo-form');
const todoInput = document.getElementById('todo-input');
const todoList = document.getElementById('todo-list');
const taskCounter = document.getElementById('task-counter');
const clearCompletedBtn = document.getElementById('clear-completed');
const filterButtons = [...document.querySelectorAll('.filter-btn')];
const template = document.getElementById('todo-item-template');

let currentFilter = 'all';

function readTodos() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch (error) {
    console.warn('Unable to read todos from local storage.', error);
    return [];
  }
}

function saveTodos(todos) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
}

function updateCounter(todos) {
  const remaining = todos.filter((todo) => !todo.completed).length;
  const label = `${remaining} item${remaining === 1 ? '' : 's'} left`;
  taskCounter.textContent = label;
}

function renderTodos() {
  const todos = readTodos();
  const filteredTodos = todos.filter((todo) => {
    if (currentFilter === 'active') return !todo.completed;
    if (currentFilter === 'completed') return todo.completed;
    return true;
  });

  todoList.innerHTML = '';

  filteredTodos.forEach((todo) => {
    const clone = template.content.cloneNode(true);
    const item = clone.querySelector('.todo-item');
    const checkbox = clone.querySelector('.checkbox');
    const text = clone.querySelector('.task-text');
    const deleteButton = clone.querySelector('.delete-btn');

    item.classList.toggle('completed', todo.completed);
    checkbox.checked = todo.completed;
    text.textContent = todo.text;

    checkbox.addEventListener('change', () => {
      toggleTodo(todo.id);
    });

    deleteButton.addEventListener('click', () => {
      deleteTodo(todo.id);
    });

    todoList.appendChild(clone);
  });

  updateCounter(todos);
  syncFilters();
}

function syncFilters() {
  filterButtons.forEach((button) => {
    const isActive = button.dataset.filter === currentFilter;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

function addTodo(text) {
  const trimmed = text.trim();
  if (!trimmed) return;

  const todos = readTodos();
  todos.push({
    id: crypto.randomUUID ? crypto.randomUUID() : `todo-${Date.now()}-${Math.random()}`,
    text: trimmed,
    completed: false,
  });

  saveTodos(todos);
  renderTodos();
}

function toggleTodo(id) {
  const todos = readTodos();
  const updated = todos.map((todo) =>
    todo.id === id ? { ...todo, completed: !todo.completed } : todo
  );

  saveTodos(updated);
  renderTodos();
}

function deleteTodo(id) {
  const todos = readTodos().filter((todo) => todo.id !== id);
  saveTodos(todos);
  renderTodos();
}

function clearCompleted() {
  const todos = readTodos().filter((todo) => !todo.completed);
  saveTodos(todos);
  renderTodos();
}

function setFilter(nextFilter) {
  if (!FILTERS.includes(nextFilter)) return;
  currentFilter = nextFilter;
  renderTodos();
}

todoForm.addEventListener('submit', (event) => {
  event.preventDefault();
  addTodo(todoInput.value);
  todoInput.value = '';
  todoInput.focus();
});

clearCompletedBtn.addEventListener('click', clearCompleted);

filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setFilter(button.dataset.filter);
  });
});

renderTodos();
