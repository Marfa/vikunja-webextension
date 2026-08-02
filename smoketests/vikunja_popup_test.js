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
    getAttribute(k) {
      return this[k] !== undefined ? String(this[k]) : null;
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
        contains(name) {
          return self._className.split(/\s+/).includes(name);
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
const calls = { listTasks: [], createTask: [], completeTask: [], listProjectViews: [] };
const createdTasks = [];
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
  listProjectViews: (projectId) => {
    calls.listProjectViews.push(projectId);
    return Promise.resolve([{ id: 10, title: 'List', type: 'list' }]);
  },
  listTasks: (opts) => {
    calls.listTasks.push(opts);
    return Promise.resolve(
      JSON.parse(JSON.stringify(tasksFixture)).concat(JSON.parse(JSON.stringify(createdTasks)))
    );
  },
  createTask: (projectId, data) => {
    calls.createTask.push({ projectId, data });
    const task = { id: 102 + createdTasks.length + 1, title: data.title, description: '', project_id: Number(projectId), done: false, due_date: '0001-01-01T00:00:00Z', labels: null };
    createdTasks.push(task);
    return Promise.resolve(JSON.parse(JSON.stringify(task)));
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
  assert(!ids['quick-chips'].classList.contains('show'), 'chips hidden while input empty');
  assert(ids['quick-title'].placeholder.includes('+Project'), 'vikunja placeholder hints magic, got ' + JSON.stringify(ids['quick-title'].placeholder));

  const triggerInput = () => {
    const onInput = ids['quick-title'].listeners['input'];
    onInput[onInput.length - 1]();
  };

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
  const getSubmit = () => {
    const l = ids['quick-add'].listeners['submit'];
    return l[l.length - 1];
  };
  await getSubmit()({ preventDefault() {} });
  assert(calls.createTask.length === 1 && calls.createTask[0].data.title === 'Water plants', 'createTask called for quick add');
  assert(calls.createTask[0].projectId === 1, 'no magic project -> first project default');
  assert(ids['task-list'].childNodes.length === 3, 'task list re-fetches after add (shows new task), got ' + ids['task-list'].childNodes.length);
  assert(ids['task-list'].childNodes[2].classList.contains('task--new'), 'new task row animated in');
  assert(storage.get('lastProjectId') === 1, 'lastProjectId persisted');

  // Quick Add Magic: +project, !priority, *label (vikunja mode)
  ids['quick-title'].value = '+Home Water plants !3 *focus';
  await getSubmit()({ preventDefault() {} });
  assert(calls.createTask.length === 2, 'magic quick add creates task');
  assert(calls.createTask[1].projectId === 2, '+project resolves by exact title -> Home (2)');
  assert(calls.createTask[1].data.title === 'Water plants', 'magic title cleaned, got ' + JSON.stringify(calls.createTask[1].data.title));
  assert(calls.createTask[1].data.priority === 3, '!3 priority parsed');
  assert(calls.createTask[1].data.project_id === 2, 'project_id in body');
  assert(magicCalls.listLabels.length === 1, 'listLabels called for magic label');
  assert(magicCalls.addLabelToTask.length === 1 && magicCalls.addLabelToTask[0].taskId === 104 && magicCalls.addLabelToTask[0].labelId === 50, 'existing label attached to new task');
  assert(magicCalls.createLabel.length === 0, 'no createLabel when label exists');

  // +project not found -> falls back to the last-used project
  ids['quick-title'].value = '+Nope Buy snacks';
  await getSubmit()({ preventDefault() {} });
  assert(calls.createTask.length === 3 && calls.createTask[2].projectId === 2, 'unknown +project falls back to last-used project');
  assert(calls.createTask[2].data.title === 'Buy snacks', 'fallback title kept');

  // todoist mode: #project +assignee
  quickAddModeMock = 'todoist';
  eval(src);
  await new Promise((r) => setTimeout(r, 20));
  ids['quick-title'].value = '#Home +alice Call Alice';
  await getSubmit()({ preventDefault() {} });
  assert(calls.createTask.length === 4 && calls.createTask[3].projectId === 2, 'todoist #project resolves Home');
  assert(calls.createTask[3].data.title === 'Call Alice', 'todoist assignee cleaned from title, got ' + JSON.stringify(calls.createTask[3].data.title));
  assert(calls.createTask[3].data.assignees && calls.createTask[3].data.assignees[0].id === 7, 'todoist +assignee resolved to user 7');

  // disabled mode: no magic parsing; only the project chip is shown and its
  // selection becomes the submit project
  quickAddModeMock = 'disabled';
  eval(src);
  await new Promise((r) => setTimeout(r, 20));
  assert(ids['quick-title'].placeholder === 'Add a task…', 'disabled placeholder, got ' + JSON.stringify(ids['quick-title'].placeholder));
  ids['quick-title'].value = 'x';
  triggerInput();
  assert(ids['quick-chips'].childNodes.length === 1, 'disabled mode shows only the project chip, got ' + ids['quick-chips'].childNodes.length);
  const disabledProj = ids['quick-chips'].childNodes[0];
  assert(disabledProj.className.includes('chip--project'), 'disabled project chip colored');
  disabledProj.value = '1';
  await disabledProj.listeners['change'][0]({ target: disabledProj });
  ids['quick-title'].value = '+Home Raw *text';
  await getSubmit()({ preventDefault() {} });
  assert(calls.createTask.length === 5 && calls.createTask[4].data.title === '+Home Raw *text', 'disabled mode keeps magic text as title');
  assert(calls.createTask[4].projectId === 1, 'disabled mode uses chip-selected project');

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
  ids['quick-title'].value = 'x';
  triggerInput();
  assert(ids['quick-chips'].childNodes[0].value === '1', 'stale default project -> falls back to first project, got ' + ids['quick-chips'].childNodes[0].value);

  // --- Quick Add chips: select-backed, write-into-the-text ---
  quickAddModeMock = 'vikunja';
  VikunjaLib.getPrefs = () => Promise.resolve({ defaultProjectId: null, dueToday: false, customFilter: '' });
  storage.set('lastProjectId', null);
  ids['quick-title'].value = '';
  eval(src);
  await new Promise((r) => setTimeout(r, 20));

  assert(!ids['quick-chips'].classList.contains('show'), 'chips hidden when input empty');
  assert(!ids['quick-add-btn'].classList.contains('show'), 'Add button hidden when input empty');
  assert(ids['quick-title'].placeholder.includes('+Project'), 'vikunja placeholder hints magic, got ' + JSON.stringify(ids['quick-title'].placeholder));
  const chips = () => ids['quick-chips'].childNodes;
  const chipSel = (i) => chips()[i];

  ids['quick-title'].value = '+Home Water !3 tomorrow every day';
  triggerInput();
  assert(ids['quick-chips'].classList.contains('show'), 'chips shown once typing');
  assert(ids['quick-add-btn'].classList.contains('show'), 'Add button shown once typing');
  assert(chips().length === 6, '6 chips in vikunja mode, got ' + chips().length);
  assert(chipSel(0).className.includes('chip--project'), 'project chip colored');
  assert(chipSel(0).value === '2', 'project chip reflects +Home, got ' + chipSel(0).value);
  assert(chipSel(1).className.includes('chip--priority'), 'priority chip colored when !3 set');
  assert(chipSel(1).value === '3', 'priority chip reflects !3, got ' + chipSel(1).value);
  assert(!chipSel(2).className.includes('chip--label'), 'label chip neutral without labels');
  assert(!chipSel(3).className.includes('chip--assignee'), 'assignee chip neutral without assignees');
  assert(chipSel(4).className.includes('chip--date'), 'date chip colored with tomorrow');
  assert(chipSel(5).className.includes('chip--repeat'), 'repeat chip colored with every day');

  ids['quick-title'].value = 'Water';
  triggerInput();
  assert(chipSel(0).value === '1', 'no magic project -> first project default, got ' + chipSel(0).value);
  assert(!chipSel(1).className.includes('chip--priority'), 'priority chip neutral without !');

  chipSel(0).value = '2';
  await chipSel(0).listeners['change'][0]({ target: chipSel(0) });
  assert(ids['quick-title'].value === 'Water +Home', 'project chip writes +Home, got ' + JSON.stringify(ids['quick-title'].value));

  ids['quick-title'].value = 'Water';
  triggerInput();
  chipSel(1).value = '2';
  await chipSel(1).listeners['change'][0]({ target: chipSel(1) });
  assert(ids['quick-title'].value === 'Water !2', 'priority chip writes !2, got ' + JSON.stringify(ids['quick-title'].value));

  ids['quick-title'].value = 'Water';
  triggerInput();
  await new Promise((r) => setTimeout(r, 0));
  chipSel(2).value = '50';
  await chipSel(2).listeners['change'][0]({ target: chipSel(2) });
  assert(ids['quick-title'].value === 'Water *focus', 'label chip appends *focus, got ' + JSON.stringify(ids['quick-title'].value));

  ids['quick-title'].value = 'Water';
  triggerInput();
  chipSel(4).value = 'tomorrow';
  await chipSel(4).listeners['change'][0]({ target: chipSel(4) });
  assert(ids['quick-title'].value === 'Water tomorrow', 'date chip writes tomorrow, got ' + JSON.stringify(ids['quick-title'].value));

  ids['quick-title'].value = 'Water';
  triggerInput();
  chipSel(5).value = 'every day';
  await chipSel(5).listeners['change'][0]({ target: chipSel(5) });
  assert(ids['quick-title'].value === 'Water every day', 'repeat chip writes every day, got ' + JSON.stringify(ids['quick-title'].value));

  ids['quick-title'].value = 'Water tomorrow every day';
  triggerInput();
  assert(chipSel(4).className.includes('chip--date'), 'date chip colored when date present');
  assert(chipSel(5).className.includes('chip--repeat'), 'repeat chip colored when repeat present');
  chipSel(4).value = 'in 2 days';
  await chipSel(4).listeners['change'][0]({ target: chipSel(4) });
  assert(ids['quick-title'].value === 'Water in 2 days every day', 'date chip replaces existing date, got ' + JSON.stringify(ids['quick-title'].value));
  chipSel(5).value = 'every week';
  await chipSel(5).listeners['change'][0]({ target: chipSel(5) });
  assert(ids['quick-title'].value === 'Water in 2 days every week', 'repeat chip replaces existing repeat, got ' + JSON.stringify(ids['quick-title'].value));

  // todoist mode: placeholder and chip prefixes adjust
  quickAddModeMock = 'todoist';
  ids['quick-title'].value = '';
  eval(src);
  await new Promise((r) => setTimeout(r, 20));
  assert(ids['quick-title'].placeholder.includes('#Project'), 'todoist placeholder, got ' + JSON.stringify(ids['quick-title'].placeholder));
  ids['quick-title'].value = '#Home Call !2';
  triggerInput();
  assert(chips().length === 6, '6 chips in todoist mode, got ' + chips().length);
  assert(chipSel(0).value === '2', 'todoist project chip resolves #Home, got ' + chipSel(0).value);
  assert(chipSel(1).className.includes('chip--priority'), 'todoist priority chip colored');

  // --- Sort button: dropdown, reverse, remember last choice ---
  quickAddModeMock = 'vikunja';
  VikunjaLib.getPrefs = () => Promise.resolve({ defaultProjectId: null, dueToday: false, customFilter: '', sortBy: 'created', rememberLastSort: true });
  storage.set('lastSort', null);
  ids['quick-title'].value = '';
  ids['sort-menu'].hidden = true;
  eval(src);
  await new Promise((r) => setTimeout(r, 20));

  assert(ids['sort-menu'].hidden === true, 'sort menu hidden initially');
  assert(ids['sort-btn'].title.includes('Created'), 'sort button title shows current sort, got ' + JSON.stringify(ids['sort-btn'].title));
  assert(calls.listTasks[calls.listTasks.length - 1].sortBy === 'created', 'default sort from prefs (created), got ' + JSON.stringify(calls.listTasks[calls.listTasks.length - 1]));
  assert(calls.listTasks[calls.listTasks.length - 1].orderBy === 'desc', 'created defaults to desc');

  const sortClick = () => {
    const l = ids['sort-btn'].listeners['click'];
    return l[l.length - 1];
  };
  sortClick()({ stopPropagation() {} });
  assert(ids['sort-menu'].hidden === false, 'sort menu opens on click');
  const sortItems = () => ids['sort-menu'].childNodes;
  const dueItem = sortItems().find((li) => li._text === 'Due date');
  assert(!!dueItem, 'sort menu lists Due date, got ' + JSON.stringify(sortItems().map((li) => li._text)));

  const before = calls.listTasks.length;
  await dueItem.listeners['click'][0]();
  assert(calls.listTasks.length === before + 1, 'picking a sort reloads tasks, got ' + calls.listTasks.length + ' vs ' + before);
  const lastFetch = calls.listTasks[calls.listTasks.length - 1];
  assert(lastFetch.sortBy === 'due_date', 'due date sort applied, got ' + JSON.stringify(lastFetch));
  assert(lastFetch.orderBy === 'asc', 'due date natural direction asc');
  assert(storage.get('lastSort') && storage.get('lastSort').mode === 'due_date' && storage.get('lastSort').orderBy === 'asc', 'remember last sort writes mode+order to local, got ' + JSON.stringify(storage.get('lastSort')));

  sortClick()({ stopPropagation() {} });
  const dirItem = sortItems()[sortItems().length - 1];
  assert(dirItem._text.includes('Ascending'), 'menu shows current direction, got ' + JSON.stringify(dirItem._text));
  dirItem.listeners['click'][0]();
  await new Promise((r) => setTimeout(r, 0));
  const lastFetch2 = calls.listTasks[calls.listTasks.length - 1];
  assert(lastFetch2.sortBy === 'due_date' && lastFetch2.orderBy === 'desc', 'direction toggle reverses to desc, got ' + JSON.stringify(lastFetch2));
  assert(storage.get('lastSort').orderBy === 'desc', 'reversed direction remembered');

  // rememberLastSort off: local lastSort is ignored, prefs default wins
  VikunjaLib.getPrefs = () => Promise.resolve({ defaultProjectId: null, dueToday: false, customFilter: '', sortBy: 'priority', rememberLastSort: false });
  storage.set('lastSort', { mode: 'due_date', orderBy: 'desc' });
  ids['quick-title'].value = '';
  eval(src);
  await new Promise((r) => setTimeout(r, 20));
  const lastFetch3 = calls.listTasks[calls.listTasks.length - 1];
  assert(lastFetch3.sortBy === 'priority', 'ignores local lastSort when remember is off, got ' + JSON.stringify(lastFetch3));
  assert(lastFetch3.orderBy === 'desc', 'priority defaults to desc');

  // manual sort: default project set, position sort resolves a view id
  VikunjaLib.getPrefs = () => Promise.resolve({ defaultProjectId: 9, dueToday: false, customFilter: '', sortBy: 'position', rememberLastSort: false });
  storage.set('lastSort', null);
  ids['quick-title'].value = '';
  ids['sort-menu'].hidden = true;
  eval(src);
  await new Promise((r) => setTimeout(r, 20));
  const lastFetch4 = calls.listTasks[calls.listTasks.length - 1];
  assert(calls.listProjectViews.includes(9), 'resolves views for the default project, got ' + JSON.stringify(calls.listProjectViews));
  assert(lastFetch4.viewId === 10, 'passes the list view id to listTasks, got ' + JSON.stringify(lastFetch4));
  assert(lastFetch4.sortBy === 'position' && lastFetch4.orderBy === 'asc', 'position sort via view, got ' + JSON.stringify(lastFetch4));
  assert(lastFetch4.projectId === 9, 'default project filter preserved');

  // manual sort without a resolvable view: falls back to created desc
  calls.listProjectViews.length = 0;
  VikunjaLib.listProjectViews = () => Promise.resolve([]);
  ids['quick-title'].value = '';
  eval(src);
  await new Promise((r) => setTimeout(r, 20));
  const lastFetch5 = calls.listTasks[calls.listTasks.length - 1];
  assert(lastFetch5.sortBy === 'created' && lastFetch5.orderBy === 'desc', 'falls back to created desc without a view, got ' + JSON.stringify(lastFetch5));

  if (errors.length) {
    console.log('FAIL');
    errors.forEach((e) => console.log('  - ' + e));
    process.exit(1);
  }
  console.log('POPUP SMOKE: ALL PASS');
})();
