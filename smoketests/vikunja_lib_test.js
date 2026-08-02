const fs = require('fs');
const path = require('path');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'lib/vikunja.js'), 'utf8');

const store = { baseUrl: 'https://vikunja.example', token: 'tk_test', defaultProjectId: '7', dueToday: true, customFilter: 'done = false' };
global.chrome = {
  storage: {
    sync: {
      get: async (defaults) => {
        const out = {};
        for (const [k, v] of Object.entries(defaults)) out[k] = (k in store) ? store[k] : v;
        return out;
      },
    },
  },
  runtime: { getURL: (p) => `moz-extension://abc/${p}` },
  windows: { create: (d) => d },
};

let failTasksPath = false;
let quickAddModeStored = 'todoist';
const calls = [];
const pageBody = (page) => Array.from({ length: 3 }, (_, i) => ({ id: (page - 1) * 3 + i + 1, title: `item ${(page - 1) * 3 + i + 1}`, project_id: page }));
const listResponse = (page) => ({
  ok: true,
  headers: { get: (n) => (n === 'x-pagination-total-pages' ? '2' : null) },
  text: async () => JSON.stringify(pageBody(page)),
});

global.fetch = async (url, opts) => {
  calls.push({ url, opts });
  const u = new URL(url);
  const page = Number(u.searchParams.get('page'));
  const path = u.pathname;
  if (path === '/api/v1/user') {
    return {
      ok: true,
      headers: { get: () => null },
      text: async () => JSON.stringify({ name: 'Test', settings: { frontend_settings: { quick_add_magic_mode: quickAddModeStored } } }),
    };
  }
  if (/^\/api\/v1\/projects\/\d+\/users$/.test(path)) {
    assert.ok(u.searchParams.has('s'), 'expected s query for user search');
    return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ result: [{ id: 7, username: 'alice', name: 'Alice', email: 'alice@example.com' }] }) };
  }
  if (path === '/api/v1/labels') {
    if (opts && opts.method === 'PUT') {
      const body = JSON.parse(opts.body);
      return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ id: 90, title: body.title, hex_color: body.hex_color }) };
    }
    assert.equal(u.searchParams.get('per_page'), '50');
    return listResponse(page);
  }
  if (/^\/api\/v1\/tasks\/\d+\/labels$/.test(path)) {
    assert.equal(opts.method, 'PUT', 'expected PUT for label attach');
    return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(JSON.parse(opts.body)) };
  }
  const isList = path.endsWith('/projects')
    || path.endsWith('/tasks/all')
    || path.endsWith('/projects/3/tasks')
    || (path.endsWith('/tasks') && !path.endsWith('/projects/3/tasks'));
  if (isList) {
    assert.equal(u.searchParams.get('per_page'), '50', 'expected per_page=50');
    if (failTasksPath && path.endsWith('/tasks') && !path.endsWith('/tasks/all') && !path.endsWith('/projects/3/tasks')) {
      return { ok: false, status: 404, headers: { get: () => null }, text: async () => '{"message":"Not Found"}' };
    }
    return listResponse(page);
  }
  if (/\/tasks\/\d+$/.test(path)) {
    assert.equal(opts.method, 'POST', 'expected POST for task update');
    return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(JSON.parse(opts.body)) };
  }
  throw new Error('unexpected url ' + url);
};

eval(src);
const V = globalThis.VikunjaLib;

(async () => {
  const prefs = await V.getPrefs();
  assert.deepStrictEqual(prefs, { defaultProjectId: '7', dueToday: true, customFilter: 'done = false' });

  calls.length = 0;
  const allTasks = await V.listTasks();
  assert.equal(allTasks.length, 6, 'expected 6 tasks across 2 pages');
  assert.ok(calls.every(c => c.url.includes('/api/v1/tasks?') || c.url.endsWith('/api/v1/tasks')), 'expected tasks path');
  assert.equal(calls.length, 2);

  calls.length = 0;
  const projTasks = await V.listTasks({ projectId: 3, filter: 'done = false', sortBy: 'due_date', orderBy: 'asc' });
  assert.equal(projTasks.length, 6);
  assert.ok(calls.every(c => c.url.includes('/api/v1/projects/3/tasks')));
  assert.ok(calls[0].url.includes('sort_by=due_date'));
  assert.ok(calls[0].url.includes('order_by=asc'));
  assert.ok(calls[0].url.includes('filter='));

  calls.length = 0;
  failTasksPath = true;
  const fallback = await V.listTasks();
  assert.equal(fallback.length, 6, 'expected fallback to /tasks/all');
  assert.ok(calls.some(c => c.url.includes('/api/v1/tasks/all')), 'expected /tasks/all fallback');
  failTasksPath = false;

  calls.length = 0;
  const done = await V.completeTask(5, true);
  assert.equal(done.done, true);
  assert.ok(calls[0].url.includes('/api/v1/tasks/5'));
  assert.deepStrictEqual(JSON.parse(calls[0].opts.body), { done: true });

  const tab = { title: 'Example — Docs', url: 'https://example.com/docs' };
  const c1 = V.buildTaskContent({ selectionText: 'Some (selected) text https://example.com/foo' }, tab);
  assert.equal(c1.title, 'Some [selected] text');
  assert.equal(c1.description, '[Some [selected] text](https://example.com/docs)');
  const c2 = V.buildTaskContent({}, tab);
  assert.equal(c2.title, 'Example — Docs');
  const c3 = V.buildTaskContent({ linkUrl: 'https://example.com/link' }, tab);
  assert.equal(c3.description, '[Example — Docs](https://example.com/link)');
  const c4 = V.buildTaskContent({}, {});
  assert.equal(c4.title, 'Add task');
  assert.equal(c4.description, '');

  const iso = V.dueTodayISO();
  const due = new Date(iso);
  const now = new Date();
  assert.equal(due.getFullYear(), now.getFullYear());
  assert.equal(due.getMonth(), now.getMonth());
  assert.equal(due.getDate(), now.getDate());

  const url = V.buildCaptureUrl({ title: 'a b', description: '[a](https://x)   ' });
  assert.ok(url.includes('capture/capture.html?'));
  assert.ok(url.includes('title=a+b'));
  const created = await V.openCapture({ title: 't' });
  assert.ok(created.type === 'popup' && created.focused === true);

  calls.length = 0;
  assert.equal(await V.getQuickAddMagicMode(), 'todoist');
  quickAddModeStored = 'disabled';
  assert.equal(await V.getQuickAddMagicMode(), 'disabled');
  quickAddModeStored = 'garbage';
  assert.equal(await V.getQuickAddMagicMode(), 'vikunja');
  quickAddModeStored = 'todoist';

  calls.length = 0;
  const labels = await V.listLabels();
  assert.equal(labels.length, 6);
  assert.ok(calls[0].url.includes('/api/v1/labels?'));

  calls.length = 0;
  const label = await V.createLabel({ title: 'new', hexColor: 'ff0000' });
  assert.equal(label.id, 90);
  assert.deepStrictEqual(JSON.parse(calls[0].opts.body), { title: 'new', hex_color: 'ff0000' });

  calls.length = 0;
  const attached = await V.addLabelToTask(5, 90);
  assert.ok(calls[0].url.includes('/api/v1/tasks/5/labels'));
  assert.deepStrictEqual(JSON.parse(calls[0].opts.body), { label_id: 90 });

  calls.length = 0;
  const users = await V.searchProjectUsers(3, 'alice');
  assert.equal(users.length, 1);
  assert.equal(users[0].id, 7);

  console.log('ALL PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
