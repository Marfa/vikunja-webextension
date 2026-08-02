'use strict';
const fs = require('fs');
const path = require('path');

function fakeElement(id) {
  const el = {
    id,
    hidden: false,
    _text: '',
    title: '',
    value: '',
    disabled: false,
    checked: false,
    _className: '',
    style: {},
    childNodes: [],
    listeners: {},
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    },
    appendChild(child) {
      this.childNodes.push(child);
      return child;
    },
    setAttribute(k, v) {
      this[k] = v;
    },
    querySelector() {
      return fakeElement(id + ':query');
    },
    focus() {},
  };
  Object.defineProperty(el, 'textContent', {
    get() {
      return this._text;
    },
    set(v) {
      this._text = String(v);
      if (!this._text) this.childNodes = [];
    },
  });
  Object.defineProperty(el, 'className', {
    get() {
      return this._className;
    },
    set(v) {
      this._className = String(v);
    },
  });
  Object.defineProperty(el, 'classList', {
    get() {
      const self = this;
      return {
        add(...names) {
          const set = new Set(self._className.split(/\s+/).filter(Boolean));
          names.forEach((n) => set.add(n));
          self._className = [...set].join(' ');
        },
        remove(...names) {
          const set = new Set(self._className.split(/\s+/).filter(Boolean));
          names.forEach((n) => set.delete(n));
          self._className = [...set].join(' ');
        },
      };
    },
  });
  Object.defineProperty(el, 'options', {
    get() {
      return this.childNodes.filter((c) => c.id === '<option>');
    },
  });
  return el;
}

const ids = {};
function getById(id) {
  return (ids[id] = ids[id] || fakeElement(id));
}

const storage = new Map();
const calls = { listTasks: [], createTask: [], completeTask: [] };
const magicCalls = { searchProjectUsers: [], listLabels: [], createLabel: [], addLabelToTask: [] };
let quickAddModeMock = 'vikunja';
const labelFixture = [{ id: 50, title: 'focus', hex_color: 'ff0000' }];
const userFixture = [{ id: 7, username: 'alice', name: 'Alice', email: 'alice@example.com' }];
const projects = [
  { id: 1, title: 'Work' },
  { id: 2, title: 'Home' },
];
const tasksFixture = [
  {
    id: 101,
    title: 'Ship the thing',
    description: 'deploy',
    project_id: 1,
    done: false,
    due_date: '2026-08-03T09:00:00Z',
    labels: [{ title: 'urgent', hex_color: 'e02b2b' }],
  },
  {
    id: 102,
    title: 'Buy milk',
    description: '',
    project_id: 2,
    done: true,
    due_date: '0001-01-01T00:00:00Z',
    labels: null,
  },
];

const VikunjaLib = {
  api: {
    storage: {
      local: {
        get(defaults) {
          const out = {};
          for (const [k, d] of Object.entries(defaults || {})) out[k] = storage.has(k) ? storage.get(k) : d;
          return Promise.resolve(out);
        },
        set(obj) {
          for (const [k, v] of Object.entries(obj)) storage.set(k, v);
          return Promise.resolve();
        },
      },
    },
    runtime: { openOptionsPage() {}, getURL: (p) => p },
  },
  getConfig: () => Promise.resolve({ baseUrl: 'https://try.vikunja.io' }),
  getPrefs: () => Promise.resolve({ defaultProjectId: null, dueToday: false, customFilter: '' }),
  listProjects: () => Promise.resolve(projects),
  listTasks: (opts) => {
    calls.listTasks.push(opts);
    return Promise.resolve(JSON.parse(JSON.stringify(tasksFixture)));
  },
  createTask: (projectId, data) => {
    calls.createTask.push({ projectId, data });
    return Promise.resolve({ id: 103, title: data.title, description: '', project_id: Number(projectId), done: false, due_date: '0001-01-01T00:00:00Z', labels: null });
  },
  completeTask: (id, done) => {
    calls.completeTask.push({ id, done });
    return Promise.resolve();
  },
  getQuickAddMagicMode: () => Promise.resolve(quickAddModeMock),
  searchProjectUsers: (projectId, q) => {
    magicCalls.searchProjectUsers.push({ projectId, q });
    return Promise.resolve(userFixture);
  },
  listLabels: () => {
    magicCalls.listLabels.push(true);
    return Promise.resolve(JSON.parse(JSON.stringify(labelFixture)));
  },
  createLabel: ({ title, hexColor }) => {
    magicCalls.createLabel.push({ title, hexColor });
    return Promise.resolve({ id: 99, title, hex_color: hexColor });
  },
  addLabelToTask: (taskId, labelId) => {
    magicCalls.addLabelToTask.push({ taskId, labelId });
    return Promise.resolve();
  },
  dueTodayISO: () => '2026-08-02T12:00:00.000Z',
  buildTaskContent: (base, tab) => Object.assign({}, base, { tabUrl: tab && tab.url, tabTitle: tab && tab.title }),
  getActiveTab: () => Promise.resolve({ url: 'https://example.com', title: 'Example' }),
  openCapture: (content) => {
    calls.openCapture = content;
    return Promise.resolve();
  },
};

global.window = {
  open() {},
  VikunjaLib,
};
global.document = {
  getElementById: getById,
  createElement: (tag) => fakeElement(`<${tag}>`),
  createElementNS: (ns, tag) => fakeElement(`<svg:${tag}>`),
};

global.window.VikunjaLib = VikunjaLib;

const projectRoot = path.join(__dirname, '..');
const quickAddSrc = fs.readFileSync(path.join(projectRoot, 'lib/quick-add.js'), 'utf8');
eval(quickAddSrc);
global.window.QuickAdd = globalThis.QuickAdd;
const uiSrc = fs.readFileSync(path.join(projectRoot, 'lib/ui.js'), 'utf8');
eval(uiSrc);
global.window.UiLib = globalThis.UiLib;

const src = fs.readFileSync(path.join(projectRoot, 'popup/popup.js'), 'utf8');
eval(src);

const errors = [];
const assert = (cond, msg) => { if (!cond) errors.push(msg); };

(async () => {
  await new Promise((r) => setTimeout(r, 20));

  assert(ids['list'].hidden === false, 'list view shown');
  assert(ids['config-prompt'].hidden === true, 'config prompt hidden');
  assert(ids['task-list'].childNodes.length === 2, '2 tasks rendered, got ' + ids['task-list'].childNodes.length);
  assert(calls.listTasks.length === 1 && calls.listTasks[0].filter === 'done = false', 'default filter done=false, got ' + JSON.stringify(calls.listTasks[0]));
  assert(!calls.listTasks[0].projectId, 'no project filter without defaultProject');
  assert(ids['quick-project'].options.length === 3, 'project select filled: placeholder + 2');
  assert(ids['quick-project'].value === '1', 'no default project -> first project preselected');

  const firstTask = ids['task-list'].childNodes[0];
  assert(firstTask.className.includes('task'), 'first row is task');
  const checkboxInput = firstTask.childNodes[0].childNodes[0];
  assert(checkboxInput.checked === false, 'first checkbox unchecked');
  const doneRow = ids['task-list'].childNodes[1];
  assert(doneRow.className.includes('done'), 'completed task row has .done');
  const doneInput = doneRow.childNodes[0].childNodes[0];
  assert(doneInput.checked === true, 'completed checkbox checked');

  const change = doneInput.listeners['change'][0];
  const fakeChangeEvent = { target: doneInput };
  doneInput.checked = false;
  await change(fakeChangeEvent);
  assert(calls.completeTask.length === 1 && calls.completeTask[0].id === 102 && calls.completeTask[0].done === false, 'completeTask called to reopen');
  assert(ids['task-list'].childNodes.length === 2, 'tasks persist after toggle (no refetch), got ' + ids['task-list'].childNodes.length);

  ids['quick-title'].value = 'Water plants';
  ids['quick-project'].value = '2';
  const getSubmit = () => {
    const l = ids['quick-add'].listeners['submit'];
    return l[l.length - 1];
  };
  await getSubmit()({ preventDefault() {} });
  assert(calls.createTask.length === 1 && calls.createTask[0].data.title === 'Water plants', 'createTask called for quick add');
  assert(calls.createTask[0].projectId === 2, 'quick add uses dropdown project');
  assert(ids['task-list'].childNodes.length === 3, 'new task appended locally, got ' + ids['task-list'].childNodes.length);
  assert(storage.get('lastProjectId') === 2, 'lastProjectId persisted');

  // Quick Add Magic: +project, !priority, *label (vikunja mode)
  ids['quick-title'].value = '+Home Water plants !3 *focus';
  ids['quick-project'].value = '1';
  await getSubmit()({ preventDefault() {} });
  assert(calls.createTask.length === 2, 'magic quick add creates task');
  assert(calls.createTask[1].projectId === 2, '+project resolves by exact title -> Home (2)');
  assert(calls.createTask[1].data.title === 'Water plants', 'magic title cleaned, got ' + JSON.stringify(calls.createTask[1].data.title));
  assert(calls.createTask[1].data.priority === 3, '!3 priority parsed');
  assert(calls.createTask[1].data.project_id === 2, 'project_id in body');
  assert(magicCalls.listLabels.length === 1, 'listLabels called for magic label');
  assert(magicCalls.addLabelToTask.length === 1 && magicCalls.addLabelToTask[0].taskId === 103 && magicCalls.addLabelToTask[0].labelId === 50, 'existing label attached to new task');
  assert(magicCalls.createLabel.length === 0, 'no createLabel when label exists');

  // +project not found -> falls back to dropdown selection
  ids['quick-title'].value = '+Nope Buy snacks';
  ids['quick-project'].value = '2';
  await getSubmit()({ preventDefault() {} });
  assert(calls.createTask.length === 3 && calls.createTask[2].projectId === 2, 'unknown +project falls back to dropdown');
  assert(calls.createTask[2].data.title === 'Buy snacks', 'fallback title kept');

  // todoist mode: #project +assignee
  quickAddModeMock = 'todoist';
  eval(src);
  await new Promise((r) => setTimeout(r, 20));
  ids['quick-title'].value = '#Home +alice Call Alice';
  ids['quick-project'].value = '1';
  await getSubmit()({ preventDefault() {} });
  assert(calls.createTask.length === 4 && calls.createTask[3].projectId === 2, 'todoist #project resolves Home');
  assert(calls.createTask[3].data.title === 'Call Alice', 'todoist assignee cleaned from title, got ' + JSON.stringify(calls.createTask[3].data.title));
  assert(calls.createTask[3].data.assignees && calls.createTask[3].data.assignees[0].id === 7, 'todoist +assignee resolved to user 7');

  // disabled mode: no magic parsing
  quickAddModeMock = 'disabled';
  eval(src);
  await new Promise((r) => setTimeout(r, 20));
  ids['quick-title'].value = '+Home Raw *text';
  ids['quick-project'].value = '1';
  await getSubmit()({ preventDefault() {} });
  assert(calls.createTask.length === 5 && calls.createTask[4].data.title === '+Home Raw *text', 'disabled mode keeps magic text as title');
  assert(calls.createTask[4].projectId === 1, 'disabled mode uses dropdown project');

  // Logo opens the instance
  const opened = [];
  const origOpen = global.window.open;
  global.window.open = (url) => opened.push(url);
  const logoClick = ids['logo'].listeners['click'];
  logoClick[logoClick.length - 1]();
  assert(opened.length === 1 && opened[0] === 'https://try.vikunja.io', 'logo click opens baseUrl');
  global.window.open = origOpen;

  ids['search'].value = 'milk';
  const onSearch = ids['search'].listeners['input'][0];
  onSearch();
  assert(ids['task-list'].childNodes.length === 1, 'search filters to 1, got ' + ids['task-list'].childNodes.length);
  assert(ids['task-empty'].hidden === true, 'no empty state while results exist');
  ids['search'].value = 'zzz';
  onSearch();
  assert(ids['task-list'].childNodes.length === 0 && ids['task-empty'].hidden === false, 'search empty state shows');
  assert(ids['task-empty'].textContent === 'No matching tasks.', 'empty state text');

  const addSite = ids['add-site'].listeners['click'][0];
  await addSite();
  assert(calls.openCapture && calls.openCapture.tabUrl === 'https://example.com', 'openCapture called with tab');

  VikunjaLib.getPrefs = () => Promise.resolve({ defaultProjectId: 999, dueToday: false, customFilter: '' });
  eval(src);
  await new Promise((r) => setTimeout(r, 20));
  assert(ids['quick-project'].value === '1', 'stale default project -> falls back to first project');

  if (errors.length) {
    console.log('FAIL');
    errors.forEach((e) => console.log('  - ' + e));
    process.exit(1);
  }
  console.log('POPUP SMOKE: ALL PASS');
})();
