'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'content/element.js'), 'utf8');

class FakeMutationObserver {
  constructor(cb) { this.cb = cb; }
  observe() {}
  disconnect() {}
}
global.MutationObserver = FakeMutationObserver;

function matchPart(el, part) {
  if (!el) return false;
  if (part === '*') return true;
  if (part.startsWith('.')) return el.className.split(/\s+/).filter(Boolean).includes(part.slice(1));
  if (part.startsWith('[')) {
    const m = part.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
    if (!m) return false;
    const val = el.getAttribute(m[1]);
    return m[2] === undefined ? val !== null : val === m[2];
  }
  return el.tag === part;
}

function matchesSimple(el, simple) {
  const parts = simple.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;
  if (!matchPart(el, parts[parts.length - 1])) return false;
  let node = el.parentNode;
  for (let i = parts.length - 2; i >= 0; i--) {
    while (node && !matchPart(node, parts[i])) {
      node = node.parentNode;
    }
    if (!node) return false;
    node = node.parentNode;
  }
  return true;
}

function matches(el, selector) {
  return selector.split(',').map((s) => s.trim()).some((s) => matchesSimple(el, s));
}

function queryAll(root, selector) {
  const out = [];
  const walk = (node) => {
    if (node !== root && matches(node, selector)) out.push(node);
    (node._children || []).forEach(walk);
  };
  walk(root);
  return out;
}

function makeEl(tag, className) {
  const el = {
    tag,
    className: className || '',
    _children: [],
    _attrs: {},
    _text: '',
    dataset: {},
    style: {},
    listeners: {},
    parentNode: null,
    title: '',
    hidden: false,
  };
  Object.defineProperty(el, 'textContent', {
    get() {
      if (this._text !== '') return this._text;
      return this._children.map((c) => c.textContent).join('');
    },
    set(v) { this._text = String(v); },
  });
  el.appendChild = (c) => { c.parentNode = el; el._children.push(c); return c; };
  el.removeChild = (c) => {
    el._children = el._children.filter((x) => x !== c);
    c.parentNode = null;
    return c;
  };
  el.insertBefore = (node, ref) => {
    node.parentNode = el;
    const idx = ref ? el._children.indexOf(ref) : -1;
    if (ref && idx >= 0) el._children.splice(idx, 0, node);
    else el._children.push(node);
    return node;
  };
  el.setAttribute = (k, v) => { el._attrs[k] = String(v); };
  el.getAttribute = (k) => (k in el._attrs ? el._attrs[k] : null);
  el.querySelectorAll = (sel) => queryAll(el, sel);
  el.querySelector = (sel) => queryAll(el, sel)[0] || null;
  el.closest = (sel) => {
    let n = el;
    while (n) {
      if (matches(n, sel)) return n;
      n = n.parentNode;
    }
    return null;
  };
  el.addEventListener = (t, fn) => { (el.listeners[t] = el.listeners[t] || []).push(fn); };
  Object.defineProperty(el, 'nextSibling', {
    get() {
      if (!this.parentNode) return null;
      const idx = this.parentNode._children.indexOf(this);
      return this.parentNode._children[idx + 1] || null;
    },
  });
  return el;
}

const sentMessages = [];
const mocks = {
  sendMessage: async (msg) => { sentMessages.push(msg); return { ok: true, task: { id: 1 } }; },
  prefs: { elementReactAfterAdd: false },
};
global.chrome = {
  runtime: {
    getURL: (p) => `moz-extension://abc/${p}`,
    sendMessage: (msg) => mocks.sendMessage(msg),
  },
  storage: {
    sync: {
      get: async (defaults) => ({ ...defaults, ...mocks.prefs }),
    },
  },
};
global.location = { hash: '#/room/!abc:server' };

const body = makeEl('body');
const doc = makeEl('document');
doc.appendChild(body);

const header = makeEl('h1', 'mx_RoomHeader_nametext');
header.textContent = 'Test Room';
body.appendChild(header);

function makeTile(bodyText, senderName) {
  const tile = makeEl('div', 'mx_EventTile');
  const line = makeEl('div', 'mx_EventTile_line');
  if (senderName) {
    const details = makeEl('span', 'mx_EventTile_senderDetails');
    const name = makeEl('span', 'mx_DisambiguatedDisplayName');
    name.textContent = senderName;
    details.appendChild(name);
    line.appendChild(details);
  }
  const msgBody = makeEl('span', 'mx_EventTile_body');
  msgBody.textContent = bodyText;
  line.appendChild(msgBody);
  tile.appendChild(line);
  return tile;
}

function makeBar(tiles, viewSource, opts) {
  const bar = makeEl('div', 'mx_MessageActionBar');
  if (!(opts && opts.noEdit)) {
    const edit = makeEl('span', 'mx_MessageActionBar_labelButton');
    edit.setAttribute('role', 'button');
    edit.setAttribute('aria-label', 'Edit');
    bar.appendChild(edit);
  }
  if (viewSource) {
    const vs = makeEl('span', 'mx_MessageActionBar_labelButton');
    vs.setAttribute('role', 'button');
    vs.setAttribute('aria-label', 'View Source');
    bar.appendChild(vs);
  }
  for (const tile of tiles) tile.appendChild(bar);
  return bar;
}

function makeMenuItem(label) {
  const li = makeEl('li', 'mx_IconizedContextMenu_item');
  li.setAttribute('role', 'menuitem');
  const span = makeEl('span', 'mx_IconizedContextMenu_label');
  span.textContent = label;
  li.appendChild(span);
  return li;
}

function makeMenu() {
  const menu = makeEl('ul', 'mx_IconizedContextMenu mx_MessageContextMenu mx_IconizedContextMenu_compact');
  const list = makeEl('div', 'mx_IconizedContextMenu_optionList');
  list.appendChild(makeMenuItem('Reply'));
  list.appendChild(makeMenuItem('View source'));
  list.appendChild(makeMenuItem('Edit'));
  menu.appendChild(list);
  return menu;
}

const tileA = makeTile('Hello from Element', 'Alice');
tileA.setAttribute('data-event-id', '$msgA:server');
const barA = makeBar([tileA], true);
const tileB = makeTile('Second message', '');
const barB = makeBar([tileB], false);
const barC = makeBar([], false, { noEdit: true });
const kebab = makeEl('span', 'mx_MessageActionBar_kebab');
kebab.setAttribute('role', 'button');
kebab.setAttribute('aria-label', 'More options');
barC.appendChild(kebab);
const menu = makeMenu();
body.appendChild(tileA);
body.appendChild(tileB);
body.appendChild(barC);
body.appendChild(menu);

global.document = {
  body,
  documentElement: body,
  createElement: (tag) => makeEl(tag),
  querySelectorAll: (sel) => queryAll(doc, sel),
  addEventListener: (type, fn) => { (doc.listeners[type] = doc.listeners[type] || []).push(fn); },
};

eval(src);

const buttonsOf = (bar) => bar._children.filter((c) => c.getAttribute('aria-label') === 'Add to Vikunja');
const optionList = menu._children[0];
const menuButtonsOf = () => optionList._children.filter((c) => c.getAttribute('aria-label') === 'Add to Vikunja');

(async () => {
  // Preferred placement: right after the "View source" button.
  const labels = barA._children.map((c) => c.getAttribute('aria-label'));
  assert.deepStrictEqual(labels, ['Edit', 'View Source', 'Add to Vikunja'], 'button goes after View source');

  // Fallback placement: next to the Edit button.
  const labelsB = barB._children.map((c) => c.getAttribute('aria-label'));
  assert.deepStrictEqual(labelsB, ['Edit', 'Add to Vikunja'], 'button goes after Edit when no View source');

  // A bar without View source or Edit never gets a trailing button (that
  // would land after the ⋯ menu); the item lives in the options menu instead.
  assert.deepStrictEqual(buttonsOf(barC), [], 'no button appended to a bare action bar');

  // The options menu gets the button directly after the "View source" item.
  const menuLabels = optionList._children.map((c) => c.textContent.trim());
  assert.deepStrictEqual(
    menuLabels,
    ['Reply', 'View source', 'Add to Vikunja', 'Edit'],
    'menu button goes after View source',
  );

  // Re-running scan must not duplicate the button.
  eval(src);
  assert.equal(buttonsOf(barA).length, 1, 'no duplicate injection on re-scan');
  assert.equal(buttonsOf(barB).length, 1, 'no duplicate injection on re-scan (fallback bar)');
  assert.equal(menuButtonsOf().length, 1, 'no duplicate injection in the options menu');

  // Clicking builds the task content and messages the background.
  buttonsOf(barA)[0].listeners.click[0]();
  await new Promise((r) => { setTimeout(r, 10); });
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'vikunja.create-task');
  assert.equal(sentMessages[0].title, 'Hello from Element');
  assert.equal(
    sentMessages[0].description,
    'From Test Room by Alice\n\n[View message](https://matrix.to/#/!abc:server/%24msgA%3Aserver)',
    'description has room, sender and message-level permalink',
  );

  // Message without a sender still works.
  buttonsOf(barB)[0].listeners.click[0]();
  await new Promise((r) => { setTimeout(r, 10); });
  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[1].title, 'Second message');
  assert.equal(
    sentMessages[1].description,
    'From Test Room\n\n[View message](https://matrix.to/#/!abc:server)',
    'room-level permalink used without a sender',
  );

  // The menu button has no DOM link to its message (portal), so it uses the
  // most recently hovered/clicked event tile.
  doc.listeners.click[0]({ target: tileA });
  menuButtonsOf()[0].listeners.click[0]();
  await new Promise((r) => { setTimeout(r, 10); });
  assert.equal(sentMessages.length, 3);
  assert.equal(sentMessages[2].title, 'Hello from Element', 'menu button uses the tracked tile');
  assert.equal(
    sentMessages[2].description,
    'From Test Room by Alice\n\n[View message](https://matrix.to/#/!abc:server/%24msgA%3Aserver)',
    'menu button description from the tracked tile',
  );

  // A failed create surfaces as an error toast.
  mocks.sendMessage = async () => ({ ok: false, error: 'Vikunja is not configured yet.' });
  buttonsOf(barB)[0].listeners.click[0]();
  await new Promise((r) => { setTimeout(r, 10); });
  const toast = body._children.find((c) => c.className === 'vikunja-element-toast');
  assert.ok(toast, 'toast is rendered');
  assert.equal(toast.textContent, 'Vikunja is not configured yet.');
  assert.equal(toast.style.background, '#c0392b');

  const delay = (ms) => new Promise((r) => { setTimeout(r, ms); });
  mocks.sendMessage = async (msg) => { sentMessages.push(msg); return { ok: true, task: { id: 1 } }; };

  // With the reaction pref off, a successful add sends no reaction request.
  sentMessages.length = 0;
  mocks.prefs = { elementReactAfterAdd: false };
  buttonsOf(barB)[0].listeners.click[0]();
  await delay(10);
  assert.equal(sentMessages.length, 1, 'no reaction request when the pref is off');
  assert.equal(sentMessages[0].type, 'vikunja.create-task');

  // With the pref on and a message-level event id, the background is asked to
  // react with 📝 after the task was created.
  sentMessages.length = 0;
  mocks.prefs = { elementReactAfterAdd: true };
  buttonsOf(barA)[0].listeners.click[0]();
  await delay(10);
  const types = sentMessages.map((m) => m.type);
  assert.ok(
    types.includes('vikunja.create-task') && types.includes('vikunja.matrix-react'),
    'reaction requested after a successful add',
  );
  const reaction = sentMessages.find((m) => m.type === 'vikunja.matrix-react');
  assert.deepStrictEqual(
    { roomId: reaction.roomId, eventId: reaction.eventId, emoji: reaction.emoji },
    { roomId: '!abc:server', eventId: '$msgA:server', emoji: '📝' },
    'reaction carries room, event and emoji',
  );

  // Without a data-event-id the reaction is skipped, the task is still added.
  sentMessages.length = 0;
  mocks.prefs = { elementReactAfterAdd: true };
  buttonsOf(barB)[0].listeners.click[0]();
  await delay(10);
  assert.equal(sentMessages.length, 1, 'no reaction without an event id');
  assert.equal(sentMessages[0].type, 'vikunja.create-task');

  // A failing reaction never breaks the success toast.
  sentMessages.length = 0;
  mocks.sendMessage = async (msg) => {
    if (msg.type === 'vikunja.matrix-react') throw new Error('executeScript failed');
    sentMessages.push(msg);
    return { ok: true, task: { id: 1 } };
  };
  buttonsOf(barA)[0].listeners.click[0]();
  await delay(10);
  assert.equal(toast.textContent, 'Added to Vikunja.', 'reaction failure does not break the success toast');

  console.log('CONTENT SMOKE: ALL PASS');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
