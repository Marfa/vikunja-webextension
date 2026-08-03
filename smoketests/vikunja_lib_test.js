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

let quickAddModeStored = 'todoist';
let failUserDetail = false;
const calls = [];
const pageBody = (page) => Array.from({ length: 3 }, (_, i) => ({ id: (page - 1) * 3 + i + 1, title: `item ${(page - 1) * 3 + i + 1}`, project_id: page }));
const listResponse = (page) => ({
  ok: true,
  headers: { get: () => null },
  text: async () => JSON.stringify({ items: pageBody(page), page, per_page: 3, total: 6, total_pages: 2 }),
});

global.fetch = async (url, opts) => {
  calls.push({ url, opts });
  const u = new URL(url);
  const page = Number(u.searchParams.get('page'));
  const path = u.pathname;
  if (path === '/api/v2/user') {
    if (failUserDetail) {
      return {
        ok: false,
        status: 422,
        headers: { get: () => null },
        text: async () => JSON.stringify({ title: 'Unprocessable Entity', status: 422, detail: 'Bad payload', code: 1500, errors: [] }),
      };
    }
    return {
      ok: true,
      headers: { get: () => null },
      text: async () => JSON.stringify({ name: 'Test', settings: { frontend_settings: { quick_add_magic_mode: quickAddModeStored } } }),
    };
  }
  if (/^\/api\/v2\/projects\/\d+\/users$/.test(path)) {
    assert.ok(u.searchParams.has('q'), 'expected q query for user search');
    return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ items: [{ id: 7, username: 'alice', name: 'Alice', email: 'alice@example.com' }] }) };
  }
  if (path === '/api/v2/labels') {
    if (opts && opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ id: 90, title: body.title, hex_color: body.hex_color }) };
    }
    assert.equal(u.searchParams.get('per_page'), '50');
    return listResponse(page);
  }
  if (/^\/api\/v2\/tasks\/\d+\/labels$/.test(path)) {
    assert.equal(opts.method, 'POST', 'expected POST for label attach');
    return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(JSON.parse(opts.body)) };
  }
  if (/^\/api\/v2\/tasks\/\d+\/assignees$/.test(path)) {
    assert.equal(opts.method, 'POST', 'expected POST for assignee attach');
    return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(JSON.parse(opts.body)) };
  }
  const isList = path.endsWith('/projects')
    || path.endsWith('/projects/3/tasks')
    || /^\/api\/v2\/projects\/\d+\/views$/.test(path)
    || /^\/api\/v2\/projects\/\d+\/views\/\d+\/tasks$/.test(path)
    || (path.endsWith('/tasks') && !path.endsWith('/projects/3/tasks'));
  if (isList) {
    assert.equal(u.searchParams.get('per_page'), '50', 'expected per_page=50');
    return listResponse(page);
  }
  if (/\/tasks\/\d+$/.test(path)) {
    assert.equal(opts.method, 'PATCH', 'expected PATCH for task update');
    assert.equal(opts.headers['Content-Type'], 'application/merge-patch+json', 'expected merge-patch content type');
    return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(JSON.parse(opts.body)) };
  }
  throw new Error('unexpected url ' + url);
};

eval(src);
const V = globalThis.VikunjaLib;

(async () => {
  const prefs = await V.getPrefs();
  assert.deepStrictEqual(prefs, { defaultProjectId: '7', dueToday: true, customFilter: 'done = false', sortBy: 'position', rememberLastSort: false, elementReactAfterAdd: false, elementTag: '' });

  assert.deepStrictEqual(V.hostPermissionPatterns({ baseUrl: 'https://vikunja.example' }), ['https://vikunja.example/*']);
  assert.deepStrictEqual(V.hostPermissionPatterns({ baseUrl: 'https://vikunja.example:8443' }), ['https://vikunja.example:8443/*']);
  assert.deepStrictEqual(V.hostPermissionPatterns({ baseUrl: '' }), []);
  assert.deepStrictEqual(V.hostPermissionPatterns({}), []);
  assert.deepStrictEqual(V.hostPermissionPatterns(null), []);
  assert.equal(await V.hasHostPermissions(['https://vikunja.example/*']), true, 'expected granted without api.permissions');
  assert.equal(await V.requestHostPermissions(['https://vikunja.example/*']), true, 'expected granted without api.permissions');

  store.elementInstances = [{ url: 'https://element.example/' }, { url: 'https://app.element.io' }, { url: '' }];
  assert.deepStrictEqual(
    await V.getElementInstances(),
    [{ url: 'https://element.example' }, { url: 'https://app.element.io' }],
    'getElementInstances normalizes and filters stored instances',
  );
  assert.deepStrictEqual(V.elementInstancePatterns([{ url: 'https://element.example' }, { url: 'https://app.element.io' }]), ['https://element.example/*', 'https://app.element.io/*']);
  assert.deepStrictEqual(V.elementInstancePatterns([]), []);
  assert.deepStrictEqual(V.elementInstancePatterns(null), []);
  assert.deepStrictEqual(V.elementInstancePatterns([{ url: 'not a url' }]), []);
  store.elementInstances = [];

  calls.length = 0;
  const allTasks = await V.listTasks();
  assert.equal(allTasks.length, 6, 'expected 6 tasks across 2 pages');
  assert.ok(calls.every(c => c.url.includes('/api/v2/tasks?') || c.url.endsWith('/api/v2/tasks')), 'expected tasks path');
  assert.equal(calls.length, 2);

  calls.length = 0;
  const projTasks = await V.listTasks({ projectId: 3, filter: 'done = false', sortBy: 'due_date', orderBy: 'asc' });
  assert.equal(projTasks.length, 6);
  assert.ok(calls.every(c => c.url.includes('/api/v2/projects/3/tasks')));
  assert.ok(calls[0].url.includes('sort_by=due_date'));
  assert.ok(calls[0].url.includes('order_by=asc'));
  assert.ok(calls[0].url.includes('filter='));

  calls.length = 0;
  const viewTasks = await V.listTasks({ projectId: 3, viewId: 7, filter: 'done = false', sortBy: 'position', orderBy: 'asc' });
  assert.equal(viewTasks.length, 6);
  assert.ok(calls.every(c => c.url.includes('/api/v2/projects/3/views/7/tasks')));
  assert.ok(calls[0].url.includes('sort_by=position'));
  assert.ok(calls[0].url.includes('order_by=asc'));

  calls.length = 0;
  const views = await V.listProjectViews(3);
  assert.equal(views.length, 6);
  assert.ok(calls.every(c => c.url.includes('/api/v2/projects/3/views')), 'expected views path');
  assert.ok(calls[0].url.includes('per_page=50'));

  calls.length = 0;
  const done = await V.completeTask(5, true);
  assert.equal(done.done, true);
  assert.ok(calls[0].url.includes('/api/v2/tasks/5'));
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

  failUserDetail = true;
  let detailErr = null;
  try {
    await V.getCurrentUser();
  } catch (e) {
    detailErr = e;
  }
  assert.ok(detailErr, 'expected error for 422');
  assert.equal(detailErr.message, 'Bad payload', 'v2 problem+json detail surfaces, got ' + detailErr.message);
  assert.equal(detailErr.status, 422);
  failUserDetail = false;

  calls.length = 0;
  const labels = await V.listLabels();
  assert.equal(labels.length, 6);
  assert.ok(calls[0].url.includes('/api/v2/labels?'));

  calls.length = 0;
  const label = await V.createLabel({ title: 'new', hexColor: 'ff0000' });
  assert.equal(label.id, 90);
  assert.ok(calls[0].opts.method === 'POST', 'expected POST for label create');
  assert.deepStrictEqual(JSON.parse(calls[0].opts.body), { title: 'new', hex_color: 'ff0000' });

  calls.length = 0;
  await V.addLabelToTask(5, 90);
  assert.ok(calls[0].url.includes('/api/v2/tasks/5/labels'));
  assert.deepStrictEqual(JSON.parse(calls[0].opts.body), { label_id: 90 });

  // findOrCreateLabel returns an existing label matched case-insensitively.
  calls.length = 0;
  const existingLabel = await V.findOrCreateLabel('ITEM 1');
  assert.equal(existingLabel.id, 1, 'reuses the existing label');
  assert.ok(calls[0].url.includes('/api/v2/labels'), 'lists labels to find the match');

  // ...and creates the label when the title does not exist yet.
  calls.length = 0;
  const newLabel = await V.findOrCreateLabel('from-element');
  assert.equal(newLabel.id, 90, 'creates a missing label');
  assert.ok(calls.some((c) => c.opts && c.opts.method === 'POST' && c.url.includes('/api/v2/labels')), 'creates via label POST');

  await assert.rejects(() => V.findOrCreateLabel('   '), /No label title/, 'rejects empty titles');

  calls.length = 0;
  await V.addAssigneeToTask(5, 7);
  assert.ok(calls[0].url.includes('/api/v2/tasks/5/assignees'));
  assert.ok(calls[0].opts.method === 'POST', 'expected POST for assignee attach');
  assert.deepStrictEqual(JSON.parse(calls[0].opts.body), { user_id: 7 });

  calls.length = 0;
  const users = await V.searchProjectUsers(3, 'alice');
  assert.equal(users.length, 1);
  assert.equal(users[0].id, 7);

  console.log('ALL PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
