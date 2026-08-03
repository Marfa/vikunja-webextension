'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'lib/vikunja.js'), 'utf8');
const bgSrc = fs.readFileSync(path.join(__dirname, '..', 'background/background.js'), 'utf8');

const store = {
  baseUrl: 'https://vikunja.example',
  token: 'tk_test',
  defaultProjectId: null,
  dueToday: true,
  elementInstances: [{ url: 'https://element.example' }],
};
const granted = new Set(['https://vikunja.example/*', 'https://element.example/*']);
const listeners = {
  onInstalled: [], onStartup: [], onChanged: [], onAdded: [], onRemoved: [],
  onMessage: [], onClicked: [], onCommand: [],
};
const calls = { createTask: [], sync: [] };
const projects = [{ id: 1, title: 'Work' }, { id: 2, title: 'Home' }];

global.chrome = {
  storage: {
    sync: {
      get: async (defaults) => {
        const out = {};
        for (const [k, v] of Object.entries(defaults)) out[k] = (k in store) ? store[k] : v;
        return out;
      },
      set: async (obj) => Object.assign(store, obj),
    },
    onChanged: { addListener: (fn) => listeners.onChanged.push(fn) },
  },
  runtime: {
    getURL: (p) => `moz-extension://abc/${p}`,
    onInstalled: { addListener: (fn) => listeners.onInstalled.push(fn) },
    onStartup: { addListener: (fn) => listeners.onStartup.push(fn) },
    onMessage: { addListener: (fn) => listeners.onMessage.push(fn) },
  },
  permissions: {
    contains: async ({ origins }) => origins.every((o) => granted.has(o)),
    request: async ({ origins }) => { origins.forEach((o) => granted.add(o)); return true; },
    onAdded: { addListener: (fn) => listeners.onAdded.push(fn) },
    onRemoved: { addListener: (fn) => listeners.onRemoved.push(fn) },
  },
  scripting: {
    registered: [],
    executeCalls: [],
    async registerContentScripts(scripts) { calls.sync.push('register'); this.registered = scripts; },
    async updateContentScripts(scripts) {
      if (this.registered.length === 0) throw new Error('script not registered');
      calls.sync.push('update');
      this.registered = scripts;
    },
    async unregisterContentScripts() { calls.sync.push('unregister'); this.registered = []; },
    async executeScript(opts) { this.executeCalls.push(opts); return [{ result: { event_id: 'r1' } }]; },
  },
  contextMenus: {
    removeAll: (cb) => cb && cb(),
    create: () => {},
    onClicked: { addListener: (fn) => listeners.onClicked.push(fn) },
  },
  commands: { onCommand: { addListener: (fn) => listeners.onCommand.push(fn) } },
  tabs: { query: async () => [] },
  windows: { create: (d) => d },
};

global.fetch = async (url, opts) => {
  const u = new URL(url);
  const pathname = u.pathname;
  if (opts && opts.method === 'POST') {
    assert.match(pathname, /\/api\/v2\/projects\/\d+\/tasks$/, 'expected task create URL, got ' + url);
    assert.equal(u.searchParams.get('format'), 'markdown', 'task create requests markdown descriptions');
    const body = JSON.parse(opts.body);
    calls.createTask.push({ projectId: pathname.split('/')[4], body });
    return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ id: 5, ...body }) };
  }
  assert.equal(pathname, '/api/v2/projects', 'unexpected url ' + url);
  return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ items: projects, total_pages: 1 }) };
};

eval(src);
eval(bgSrc);

const delay = (ms) => new Promise((r) => { setTimeout(r, ms); });
const send = (message, senderUrl) => new Promise((resolve) => {
  listeners.onMessage[0](message, { url: senderUrl }, resolve);
});
const sendRaw = (message, sender) => new Promise((resolve) => {
  listeners.onMessage[0](message, sender, resolve);
});

(async () => {
  // Install: registers the content script for the stored instance. The first
  // sync cannot update (nothing registered yet), so it cleans up and registers.
  listeners.onInstalled[0]();
  await delay(10);
  assert.deepStrictEqual(calls.sync, ['unregister', 'register'], 'install registers the content script');
  const registered = chrome.scripting.registered[0];
  assert.equal(registered.id, 'vikunja-element');
  assert.deepStrictEqual(registered.matches, ['https://element.example/*']);
  assert.deepStrictEqual(registered.js, ['content/element.js']);
  assert.deepStrictEqual(registered.css, ['content/element.css']);

  // Storage change for a different instance updates the scripts in place.
  store.elementInstances = [{ url: 'https://app.element.io' }];
  listeners.onChanged[0]({ elementInstances: { newValue: store.elementInstances } }, 'sync');
  await delay(10);
  assert.deepStrictEqual(calls.sync, ['unregister', 'register', 'update'], 'storage change updates the content script');
  assert.deepStrictEqual(chrome.scripting.registered[0].matches, ['https://app.element.io/*']);

  // Empty list unregisters the script again.
  store.elementInstances = [];
  listeners.onChanged[0]({ elementInstances: { newValue: store.elementInstances } }, 'sync');
  await delay(10);
  assert.deepStrictEqual(calls.sync, ['unregister', 'register', 'update', 'unregister'], 'empty list unregisters the content script');

  // Restore state for the message-handler tests.
  store.elementInstances = [{ url: 'https://element.example' }];
  listeners.onChanged[0]({ elementInstances: { newValue: store.elementInstances } }, 'sync');
  await delay(10);
  calls.sync = [];
  calls.createTask = [];

  // Valid sender origin, no default project -> falls back to the first project.
  let res = await send({ type: 'vikunja.create-task', title: '  Hello   world  ', description: 'From Room by Alice' }, 'https://element.example/#/room/!abc:server');
  assert.equal(res.ok, true, 'expected task to be created, got ' + JSON.stringify(res));
  assert.equal(res.task.title, 'Hello world', 'title is trimmed and collapsed');
  assert.equal(calls.createTask.length, 1);
  assert.equal(calls.createTask[0].projectId, '1', 'defaults to the first project');
  assert.equal(calls.createTask[0].body.description, 'From Room by Alice');
  assert.equal(calls.createTask[0].body.due_date, globalThis.VikunjaLib.dueTodayISO(), 'due today applied when enabled');

  // Preferred project id is used when set.
  store.defaultProjectId = '7';
  res = await send({ type: 'vikunja.create-task', title: 'Use pref' }, 'https://element.example');
  assert.equal(res.ok, true);
  assert.equal(calls.createTask.at(-1).projectId, '7');
  store.defaultProjectId = null;

  // Due-today pref off: no due_date in the body.
  store.dueToday = false;
  res = await send({ type: 'vikunja.create-task', title: 'No due' }, 'https://element.example');
  assert.equal(res.ok, true);
  assert.ok(!('due_date' in calls.createTask.at(-1).body), 'no due date when disabled');
  store.dueToday = true;

  // Rejects requests from non-registered origins.
  res = await send({ type: 'vikunja.create-task', title: 'x' }, 'https://evil.example');
  assert.equal(res.ok, false);
  assert.ok(res.error.includes('registered Element'), 'origin rejected, got ' + res.error);

  // Rejects when Vikunja is not configured.
  store.baseUrl = '';
  res = await send({ type: 'vikunja.create-task', title: 'x' }, 'https://element.example');
  assert.equal(res.ok, false);
  assert.ok(res.error.includes('configured'), 'config missing surfaced, got ' + res.error);
  store.baseUrl = 'https://vikunja.example';

  // Rejects empty titles.
  res = await send({ type: 'vikunja.create-task', title: '   ' }, 'https://element.example');
  assert.equal(res.ok, false);
  assert.ok(res.error.includes('No message text'), 'empty title rejected, got ' + res.error);

  // --- Reaction (📝) via element-web's own MatrixClient (MAIN world) ---

  // Accepts a request from a registered origin and injects the reaction into
  // the page's MAIN world with the room/event/emoji.
  chrome.scripting.executeCalls.length = 0;
  res = await sendRaw(
    { type: 'vikunja.matrix-react', roomId: '!abc:server', eventId: '$evt:server', emoji: '📝' },
    { url: 'https://element.example/#/room/!abc:server', tab: { id: 42 } },
  );
  assert.equal(res.ok, true, 'reaction accepted, got ' + JSON.stringify(res));
  assert.equal(chrome.scripting.executeCalls.length, 1);
  assert.deepStrictEqual(chrome.scripting.executeCalls[0].target, { tabId: 42 });
  assert.equal(chrome.scripting.executeCalls[0].world, 'MAIN');
  assert.deepStrictEqual(chrome.scripting.executeCalls[0].args, ['!abc:server', '$evt:server', '📝']);
  assert.equal(typeof chrome.scripting.executeCalls[0].func, 'function', 'injected function is provided');

  // The injected function sends the exact m.reaction content the UI's reaction
  // picker would, and only when element-web is logged in.
  const sendCalls = [];
  const rooms = {
    '!abc:server': { roomId: '!abc:server', findEventById: (id) => (id === '$evt:server' ? {} : null) },
  };
  global.window = {
    mxMatrixClientPeg: {
      safeGet: () => ({
        sendEvent: async (roomId, type, content) => { sendCalls.push({ roomId, type, content }); return { event_id: 'r1' }; },
        getRoom: (id) => rooms[id] || null,
        getRooms: () => Object.values(rooms),
      }),
    },
  };
  const fn = chrome.scripting.executeCalls[0].func;
  const evt = await fn('!abc:server', '$evt:server', '📝');
  assert.equal(evt.event_id, 'r1');
  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0].roomId, '!abc:server', 'uses the room id from the URL when the client knows it');
  assert.equal(sendCalls[0].type, 'm.reaction');
  assert.deepStrictEqual(sendCalls[0].content, {
    'm.relates_to': { rel_type: 'm.annotation', event_id: '$evt:server', key: '📝' },
  });

  // When the room id is missing or unknown (e.g. path-based routing), the room
  // is resolved by searching for the event instead.
  await fn('', '$evt:server', '📝');
  assert.equal(sendCalls.at(-1).roomId, '!abc:server', 'resolves the room from the event id');
  await fn('!other:server', '$evt:server', '📝');
  assert.equal(sendCalls.at(-1).roomId, '!abc:server', 'ignores an unknown room id and resolves by event');
  await assert.rejects(() => fn('', '$missing:server', '📝'), 'rejects when the event is in no known room');

  delete global.window.mxMatrixClientPeg;
  await assert.rejects(() => fn('!abc:server', '$evt:server', '📝'), 'rejects without a logged-in client');
  delete global.window;

  // Rejects when no event id is supplied at all.
  res = await sendRaw(
    { type: 'vikunja.matrix-react', roomId: '!abc:server' },
    { url: 'https://element.example', tab: { id: 42 } },
  );
  assert.equal(res.ok, false);
  assert.ok(res.error.includes('Missing event id'), 'missing event id surfaced, got ' + res.error);

  // Rejects requests from non-registered origins.
  res = await sendRaw(
    { type: 'vikunja.matrix-react', roomId: '!abc:server', eventId: '$evt:server' },
    { url: 'https://evil.example', tab: { id: 42 } },
  );
  assert.equal(res.ok, false);
  assert.ok(res.error.includes('registered Element'), 'origin rejected, got ' + res.error);

  // Rejects when there is no tab to inject into.
  res = await sendRaw(
    { type: 'vikunja.matrix-react', roomId: '!abc:server', eventId: '$evt:server' },
    { url: 'https://element.example' },
  );
  assert.equal(res.ok, false);
  assert.ok(res.error.includes('No tab'), 'no-tab rejected, got ' + res.error);

  // Rejects when the scripting API is unavailable (older browsers).
  const hadScripting = chrome.scripting;
  delete chrome.scripting;
  res = await sendRaw(
    { type: 'vikunja.matrix-react', roomId: '!abc:server', eventId: '$evt:server' },
    { url: 'https://element.example', tab: { id: 42 } },
  );
  assert.equal(res.ok, false);
  assert.ok(res.error.includes('Scripting API'), 'scripting missing surfaced, got ' + res.error);
  chrome.scripting = hadScripting;

  // --- Room name fallback via element-web's own MatrixClient (MAIN world) ---

  // Accepts a request from a registered origin, injects into the page's MAIN
  // world, and returns the client's room name.
  chrome.scripting.executeCalls.length = 0;
  const hadExecute = chrome.scripting.executeScript;
  chrome.scripting.executeScript = async (opts) => {
    chrome.scripting.executeCalls.push(opts);
    return [{ result: 'Client Room' }];
  };
  res = await sendRaw(
    { type: 'vikunja.matrix-room-name', roomId: '!abc:server' },
    { url: 'https://element.example/#/room/!abc:server', tab: { id: 42 } },
  );
  assert.equal(res.ok, true, 'room name accepted, got ' + JSON.stringify(res));
  assert.equal(res.name, 'Client Room');
  assert.equal(chrome.scripting.executeCalls.length, 1);
  assert.deepStrictEqual(chrome.scripting.executeCalls[0].target, { tabId: 42 });
  assert.equal(chrome.scripting.executeCalls[0].world, 'MAIN');
  assert.deepStrictEqual(chrome.scripting.executeCalls[0].args, ['!abc:server']);

  // The injected function reads room.name from the client, and returns an
  // empty string for an unknown room.
  global.window = {
    mxMatrixClientPeg: {
      safeGet: () => ({
        getRoom: (roomId) => (roomId === '!abc:server' ? { name: 'Client Room' } : null),
      }),
    },
  };
  const roomFn = chrome.scripting.executeCalls[0].func;
  assert.equal(await roomFn('!abc:server'), 'Client Room', 'reads the room name from the client');
  assert.equal(await roomFn('!other:server'), '', 'unknown room yields an empty name');
  delete global.window.mxMatrixClientPeg;
  await assert.rejects(() => roomFn('!abc:server'), 'rejects without a logged-in client');
  delete global.window;

  // Rejects requests from non-registered origins and without a tab.
  res = await sendRaw(
    { type: 'vikunja.matrix-room-name', roomId: '!abc:server' },
    { url: 'https://evil.example', tab: { id: 42 } },
  );
  assert.equal(res.ok, false);
  assert.ok(res.error.includes('registered Element'), 'origin rejected, got ' + res.error);
  res = await sendRaw(
    { type: 'vikunja.matrix-room-name', roomId: '!abc:server' },
    { url: 'https://element.example' },
  );
  assert.equal(res.ok, false);
  assert.ok(res.error.includes('No tab'), 'no-tab rejected, got ' + res.error);

  // Rejects a missing room id.
  res = await sendRaw({ type: 'vikunja.matrix-room-name', roomId: '   ' }, { url: 'https://element.example', tab: { id: 42 } });
  assert.equal(res.ok, false);
  assert.ok(res.error.includes('Missing room id'), 'missing room id surfaced, got ' + res.error);

  // Rejects when the scripting API is unavailable.
  delete chrome.scripting;
  res = await sendRaw(
    { type: 'vikunja.matrix-room-name', roomId: '!abc:server' },
    { url: 'https://element.example', tab: { id: 42 } },
  );
  assert.equal(res.ok, false);
  assert.ok(res.error.includes('Scripting API'), 'scripting missing surfaced, got ' + res.error);
  chrome.scripting = hadScripting;
  chrome.scripting.executeScript = hadExecute;

  console.log('ELEMENT SMOKE: ALL PASS');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
