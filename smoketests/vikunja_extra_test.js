'use strict';
const fs = require('fs');
const path = require('path');

function fakeElement(id) {
  const el = {
    id, hidden: false, _text: '', title: '', _value: '', disabled: false,
    checked: false, _className: '', style: {}, childNodes: [], listeners: {},
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    appendChild(c) { this.childNodes.push(c); return c; },
    setAttribute(k, v) { this[k] = v; },
    querySelector() { return fakeElement(id + ':query'); },
    focus() {}, select() {},
  };
  Object.defineProperty(el, 'value', {
    get() { return this._value; },
    set(v) { this._value = String(v); },
  });
  Object.defineProperty(el, 'textContent', {
    get() { return this._text; },
    set(v) { this._text = String(v); if (!this._text) this.childNodes = []; },
  });
  Object.defineProperty(el, 'className', {
    get() { return this._className; },
    set(v) { this._className = String(v); },
  });
  Object.defineProperty(el, 'classList', {
    get() {
      const self = this;
      return {
        add(...n) { const s = new Set(self._className.split(/\s+/).filter(Boolean)); n.forEach((x) => s.add(x)); self._className = [...s].join(' '); },
        remove(...n) { const s = new Set(self._className.split(/\s+/).filter(Boolean)); n.forEach((x) => s.delete(x)); self._className = [...s].join(' '); },
      };
    },
  });
  Object.defineProperty(el, 'options', {
    get() { return this.childNodes.filter((c) => c.id === '<option>'); },
  });
  return el;
}

const ids = {};
function getById(id) { return (ids[id] = ids[id] || fakeElement(id)); }
const projects = [
  { id: 1, title: 'Work' },
  { id: 2, title: 'Home' },
];
const calls = { createTask: [], request: [], syncSet: [], hostRequest: [] };

const VikunjaLib = {
  api: {
    storage: {
      local: {
        get: async (d) => d,
        set: async () => {},
      },
      sync: {
        set: async (obj) => { calls.syncSet.push(obj); },
      },
    },
    runtime: { openOptionsPage() {}, getURL: (p) => p },
    permissions: {
      request: async () => true,
      contains: async () => true,
    },
  },
  normalizeBaseUrl: (u) => (u ? u.replace(/\/+$/, '') : ''),
  getConfig: () => Promise.resolve({ baseUrl: 'https://try.vikunja.io', token: 'tk_test' }),
  getPrefs: () => Promise.resolve({ defaultProjectId: 1, dueToday: true, customFilter: 'priority >= 1', sortBy: 'due_date', rememberLastSort: true, elementReactAfterAdd: true, elementTag: 'from-element' }),
  listProjects: () => Promise.resolve(projects),
  listTasks: () => Promise.resolve([]),
  createTask: (projectId, body) => { calls.createTask.push({ projectId, body }); return Promise.resolve({ id: 1 }); },
  completeTask: () => Promise.resolve(),
  dueTodayISO: () => '2026-08-02T21:00:00Z',
  buildTaskContent: (_a, _b) => ({}),
  getActiveTab: () => Promise.resolve({}),
  openCapture: () => Promise.resolve(),
  request: (endpoint, opts) => { calls.request.push({ endpoint, opts }); return Promise.resolve({ name: 'Demo' }); },
  hostPermissionPatterns: (config) => (config && config.baseUrl ? [new URL(config.baseUrl).origin + '/*'] : []),
  hasHostPermissions: async () => true,
  requestHostPermissions: async (patterns) => { calls.hostRequest.push(patterns); return true; },
  getElementInstances: () => Promise.resolve([]),
  elementInstancePatterns: (instances) => (Array.isArray(instances) ? instances.map((i) => new URL(i.url).origin + '/*') : []),
};

global.window = { open() {}, close() {}, VikunjaLib };
global.document = {
  getElementById: getById,
  createElement: (tag) => fakeElement(`<${tag}>`),
  createElementNS: (ns, tag) => fakeElement(`<svg:${tag}>`),
  createTextNode: (text) => ({ textContent: String(text) }),
};
global.location = { search: '?title=Found%20bug&description=On%20page&url=https%3A%2F%2Fexample.com' };
global.URLSearchParams = URLSearchParams;

const errors = [];
const assert = (cond, msg) => { if (!cond) errors.push(msg); };

const root = path.join(__dirname, '..');

(async () => {
  eval(fs.readFileSync(path.join(root, 'lib/ui.js'), 'utf8'));
  global.window.UiLib = globalThis.UiLib;
  eval(fs.readFileSync(path.join(root, 'options/options.js'), 'utf8'));
  await new Promise((r) => { setTimeout(r, 20); });
  assert(ids['base-url'].value === 'https://try.vikunja.io', 'options: url filled');
  assert(ids['token'].value === 'tk_test', 'options: token filled');
  assert(ids['due-today'].checked === true, 'options: due-today checked');
  assert(ids['custom-filter'].value === 'priority >= 1', 'options: filter filled');
  assert(ids['sort-by'].value === 'due_date', 'options: default sort filled, got ' + ids['sort-by'].value);
  assert(ids['remember-last-sort'].checked === true, 'options: remember-last-sort checked');
  assert(ids['element-react-after-add'].checked === true, 'options: element-react-after-add checked');
  assert(ids['element-tag'].value === 'from-element', 'options: element-tag filled, got ' + ids['element-tag'].value);
  assert(ids['default-project'].options.length === 3, 'options: default-project select filled');

  ids['base-url'].value = 'https://try.vikunja.io/';
  ids['token'].value = 'tk_test';
  await ids['settings-form'].listeners['submit'][0]({ preventDefault() {} });
  assert(calls.syncSet.length === 1, 'options: save calls sync.set');
  assert(calls.syncSet[0].baseUrl === 'https://try.vikunja.io', 'options: baseUrl normalized');
  assert(String(calls.syncSet[0].defaultProjectId) === '1', 'options: defaultProjectId preserved');
  assert(calls.syncSet[0].customFilter === 'priority >= 1', 'options: filter preserved');
  assert(calls.syncSet[0].sortBy === 'due_date', 'options: sort preserved');
  assert(calls.syncSet[0].rememberLastSort === true, 'options: remember-last-sort preserved');
  assert(calls.syncSet[0].elementReactAfterAdd === true, 'options: element-react-after-add preserved');
  assert(calls.syncSet[0].elementTag === 'from-element', 'options: element-tag preserved');
  assert(calls.hostRequest.length === 1, 'options: save requests host permissions');
  assert(calls.hostRequest[0].length === 1 && calls.hostRequest[0][0] === 'https://try.vikunja.io/*', 'options: save requests all host patterns');

  await ids['test'].listeners['click'][0]();
  assert(calls.request.length === 1 && calls.request[0].endpoint === 'user', 'options: test hits /user');
  assert(ids['status'].hidden === false && ids['status'].className.includes('ok'), 'options: test ok status');

  eval(fs.readFileSync(path.join(root, 'capture/capture.js'), 'utf8'));
  await new Promise((r) => { setTimeout(r, 20); });
  assert(ids['capture-form'].hidden === false, 'capture: form shown');
  assert(ids['title'].value === 'Found bug', 'capture: title from query');
  assert(ids['description'].value === 'On page', 'capture: description from query');
  assert(ids['due-today'].checked === true, 'capture: due-today from prefs');
  assert(ids['project'].options.length === 3, 'capture: project select filled');
  assert(ids['project'].value === '1', 'capture: default project selected');

  await ids['capture-form'].listeners['submit'][0]({ preventDefault() {} });
  assert(calls.createTask.length === 1 && calls.createTask[0].projectId === '1', 'capture: createTask called');
  assert(calls.createTask[0].body.title === 'Found bug', 'capture: body title');
  assert(calls.createTask[0].body.due_date === '2026-08-02T21:00:00Z', 'capture: due today set');
  const captureToastLink = ids['toast'].childNodes.find((c) => c.textContent === '1');
  assert(captureToastLink && captureToastLink.href === 'https://try.vikunja.io/tasks/1', 'capture: success toast links to the new task, got ' + (captureToastLink && captureToastLink.href));

  VikunjaLib.getPrefs = () => Promise.resolve({ defaultProjectId: null, dueToday: false, customFilter: '' });
  eval(fs.readFileSync(path.join(root, 'capture/capture.js'), 'utf8'));
  await new Promise((r) => { setTimeout(r, 20); });
  assert(ids['project'].value === '1', 'capture: no default project -> first project preselected');

  if (errors.length) {
    console.log('FAIL');
    errors.forEach((e) => console.log('  - ' + e));
    process.exit(1);
  }
  console.log('OPTIONS + CAPTURE SMOKE: ALL PASS');
})();
