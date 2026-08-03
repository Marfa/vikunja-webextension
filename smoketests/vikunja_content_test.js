'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'content/element.js'), 'utf8');

const observerCallbacks = [];
class FakeMutationObserver {
  constructor(cb) { observerCallbacks.push(cb); }
  observe() {}
  disconnect() {}
}
global.MutationObserver = FakeMutationObserver;

// Node has no DOM event constructors; browsers do. Simple shims so the
// content script's menu-close dispatch can run.
global.MouseEvent = class MouseEvent {
  constructor(type, opts = {}) { this.type = type; Object.assign(this, opts); }
};
global.KeyboardEvent = class KeyboardEvent {
  constructor(type, opts = {}) { this.type = type; Object.assign(this, opts); }
};

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

// Real DOM datasets are backed by data-* attributes (setting
// dataset.vikunjaInjected writes data-vikunja-injected); mirror that so the
// content script's attribute cleanup behaves like it does in a browser.
function datasetKey(prop) {
  return 'data-' + String(prop).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function makeEl(tag, className) {
  const el = {
    tag,
    className: className || '',
    _children: [],
    _attrs: {},
    _text: '',
    style: {},
    listeners: {},
    parentNode: null,
    title: '',
    hidden: false,
  };
  Object.defineProperty(el, 'dataset', {
    get() {
      return new Proxy({}, {
        get: (_target, prop) => {
          const key = datasetKey(prop);
          return key in el._attrs ? el._attrs[key] : undefined;
        },
        set: (_target, prop, value) => { el._attrs[datasetKey(prop)] = String(value); return true; },
      });
    },
  });
  el.remove = () => { if (el.parentNode) el.parentNode.removeChild(el); };
  Object.defineProperty(el, 'textContent', {
    get() {
      if (this._text !== '') return this._text;
      return this._children.map((c) => c.textContent).join('');
    },
    set(v) {
      this._text = String(v);
      if (!this._text) this._children = [];
    },
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
  el.removeAttribute = (k) => { delete el._attrs[k]; };
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
  el.dispatchEvent = (evt) => {
    (el.listeners[evt.type] = el.listeners[evt.type] || []).forEach((fn) => fn(evt));
    return true;
  };
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
  sendMessage: async (msg) => { sentMessages.push(msg); return { ok: true, task: { id: 1 }, url: 'https://vikunja.example/tasks/1' }; },
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
global.location = { hash: '#/room/!abc:server', pathname: '/' };

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
const barB = makeBar([tileB], true);
const tileEdit = makeTile('Own message', 'Me');
const barEditOnly = makeBar([tileEdit], false);
const barC = makeBar([], false, { noEdit: true });
const kebab = makeEl('span', 'mx_MessageActionBar_kebab');
kebab.setAttribute('role', 'button');
kebab.setAttribute('aria-label', 'More options');
barC.appendChild(kebab);
const longBody = 'This is a very long message that definitely exceeds the fifty character limit for the title and goes on.';
const tileLong = makeTile(longBody, 'Bob');
const barLong = makeBar([tileLong], true);
// A tile whose message body carries real formatting (what element-web renders
// from the message's formatted_body HTML).
function makeRichBody(children) {
  const msgBody = makeEl('span', 'mx_EventTile_body');
  children.forEach((c) => msgBody.appendChild(c));
  return msgBody;
}
function richEl(tag, attrs, text) {
  const el = makeEl(tag);
  (attrs || []).forEach(([k, v]) => el.setAttribute(k, v));
  if (text) el.textContent = text;
  return el;
}
function makeRichTile(children, senderName) {
  const tile = makeEl('div', 'mx_EventTile');
  const line = makeEl('div', 'mx_EventTile_line');
  if (senderName) {
    const details = makeEl('span', 'mx_EventTile_senderDetails');
    const name = makeEl('span', 'mx_DisambiguatedDisplayName');
    name.textContent = senderName;
    details.appendChild(name);
    line.appendChild(details);
  }
  line.appendChild(makeRichBody(children));
  tile.appendChild(line);
  return tile;
}
const tileRich = makeRichTile([
  richEl('', null, 'Hi '),
  richEl('strong', null, 'bold'),
  richEl('', null, ' and '),
  richEl('em', null, 'italic'),
  richEl('', null, ' and '),
  richEl('a', [['href', 'https://example.com/page']], 'link'),
  richEl('', null, ' and '),
  richEl('code', null, 'inline()'),
], 'Alice');
tileRich.setAttribute('data-event-id', '$msgR:server');
const barRich = makeBar([tileRich], true);
const tileMultiline = makeRichTile([
  richEl('', null, 'Line one'),
  richEl('br'),
  richEl('', null, 'Line two'),
], 'Alice');
const barMultiline = makeBar([tileMultiline], true);
body.appendChild(tileA);
body.appendChild(tileB);
body.appendChild(barC);
body.appendChild(tileEdit);
body.appendChild(tileLong);
// A plain context menu asserts that the bar layout leaves it alone; the
// default menu layout (with portal wrapper and background) is exercised later.
const menu = makeMenu();
body.appendChild(menu);
body.appendChild(tileRich);
body.appendChild(tileMultiline);

global.document = {
  body,
  documentElement: body,
  createElement: (tag) => makeEl(tag),
  createElementNS: (_ns, tag) => makeEl(tag),
  createTextNode: (text) => { const n = makeEl('#text'); n.textContent = text; return n; },
  querySelectorAll: (sel) => queryAll(doc, sel),
  querySelector: (sel) => queryAll(doc, sel)[0] || null,
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

  // The button renders a theme-aware inline svg mark, not the colored png.
  const barIcon = buttonsOf(barA)[0]._children[0];
  assert.deepStrictEqual(buttonsOf(barA)[0]._children.map((c) => c.tag), ['svg'], 'bar button has an inline svg icon');
  assert.strictEqual(barIcon.getAttribute('viewBox'), '0 0 256 256');
  assert.strictEqual(barIcon.getAttribute('aria-hidden'), 'true');
  assert.strictEqual(barIcon._children[0].getAttribute('stroke'), 'currentColor');
  assert.strictEqual(barIcon._children[1].getAttribute('fill'), 'currentColor');

  // A bar that shows "View source" marks the older layout; every such bar
  // gets the button after "View source".
  const labelsB = barB._children.map((c) => c.getAttribute('aria-label'));
  assert.deepStrictEqual(labelsB, ['Edit', 'View Source', 'Add to Vikunja'], 'button goes after View source');

  // A bar without a "View source" anchor never gets a button — no trailing
  // append and no "Edit" fallback. Current element-web's own-message bars
  // (Edit, no "View source") therefore leave the button to the options menu.
  assert.deepStrictEqual(buttonsOf(barC), [], 'no button appended to a bare action bar');
  assert.deepStrictEqual(buttonsOf(barEditOnly), [], 'no bar button without a View source anchor');

  // The options menu does not get the button in this (bar) layout.
  const menuLabels = optionList._children.map((c) => c.textContent.trim());
  assert.deepStrictEqual(
    menuLabels,
    ['Reply', 'View source', 'Edit'],
    'no menu button in the bar layout',
  );

  // Re-running the content script (extension reload/update) must not
  // duplicate the button: the new instance sweeps away the stale buttons and
  // markers of the previous one, then re-injects fresh.
  doc.listeners = {};
  observerCallbacks.length = 0;
  eval(src);
  assert.equal(buttonsOf(barA).length, 1, 'no duplicate injection on re-scan');
  assert.equal(buttonsOf(barB).length, 1, 'no duplicate injection on re-scan');
  assert.equal(menuButtonsOf().length, 0, 'no menu button in the bar layout after re-scan');

  await new Promise((r) => { setTimeout(r, 10); });
  sentMessages.length = 0;

  // Clicking builds the task content and messages the background.
  buttonsOf(barA)[0].listeners.click[0]();
  await new Promise((r) => { setTimeout(r, 10); });
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'vikunja.create-task');
  assert.equal(sentMessages[0].title, 'Test Room: Hello from Element');
  assert.equal(
    sentMessages[0].description,
    'Hello from Element\n\n[View message](https://matrix.to/#/!abc:server/%24msgA%3Aserver)',
    'description holds the full message and the message-level permalink',
  );

  // Message without a sender still works.
  buttonsOf(barB)[0].listeners.click[0]();
  await new Promise((r) => { setTimeout(r, 10); });
  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[1].title, 'Test Room: Second message');
  assert.equal(
    sentMessages[1].description,
    'Second message\n\n[View message](https://matrix.to/#/!abc:server)',
    'room-level permalink used without a sender',
  );

  // A message longer than 50 characters is truncated in the title; the full
  // message stays in the description.
  buttonsOf(barLong)[0].listeners.click[0]();
  await new Promise((r) => { setTimeout(r, 10); });
  assert.equal(sentMessages.length, 3);
  assert.equal(sentMessages[2].title, `Test Room: ${longBody.slice(0, 50)}…`, 'title truncates the message at 50 chars');
  assert.equal(
    sentMessages[2].description,
    `${longBody}\n\n[View message](https://matrix.to/#/!abc:server)`,
    'description keeps the full message',
  );

  // A formatted message keeps its markup in the description while the title
  // stays plain text.
  buttonsOf(barRich)[0].listeners.click[0]();
  await new Promise((r) => { setTimeout(r, 10); });
  assert.equal(sentMessages.length, 4);
  assert.equal(
    sentMessages[3].title,
    'Test Room: Hi bold and italic and link and inline()',
    'title strips markup',
  );
  assert.equal(
    sentMessages[3].description,
    'Hi **bold** and *italic* and [link](https://example.com/page) and `inline()`\n\n'
      + '[View message](https://matrix.to/#/!abc:server/%24msgR%3Aserver)',
    'description converts HTML to Markdown',
  );

  // <br> becomes a newline in the description.
  buttonsOf(barMultiline)[0].listeners.click[0]();
  await new Promise((r) => { setTimeout(r, 10); });
  assert.equal(sentMessages.length, 5);
  assert.equal(
    sentMessages[4].description,
    'Line one\nLine two\n\n[View message](https://matrix.to/#/!abc:server)',
    'line breaks survive into the description',
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
    return { ok: true, task: { id: 1 }, url: 'https://vikunja.example/tasks/1' };
  };
  buttonsOf(barA)[0].listeners.click[0]();
  await delay(10);
  assert.equal(toast.textContent, 'Task 1 added', 'reaction failure does not break the success toast');
  const toastLink = toast._children[1];
  assert.equal(toastLink.href, 'https://vikunja.example/tasks/1', 'success toast links to the new task');
  mocks.sendMessage = async (msg) => { sentMessages.push(msg); return { ok: true, task: { id: 1 }, url: 'https://vikunja.example/tasks/1' }; };

  // Path-based routing (useHashRouting: false) still yields the room id — from
  // the pathname — for both the permalink and the reaction.
  global.location = { hash: '', pathname: '/app/room/!def:server' };
  sentMessages.length = 0;
  mocks.prefs = { elementReactAfterAdd: true };
  buttonsOf(barA)[0].listeners.click[0]();
  await delay(10);
  const reactionPath = sentMessages.find((m) => m.type === 'vikunja.matrix-react');
  assert.ok(reactionPath, 'reaction requested under path routing');
  assert.equal(reactionPath.roomId, '!def:server', 'room id read from the pathname');
  const createPath = sentMessages.find((m) => m.type === 'vikunja.create-task');
  assert.equal(
    createPath.description,
    'Hello from Element\n\n[View message](https://matrix.to/#/!def:server/%24msgA%3Aserver)',
    'permalink uses the room id from the pathname',
  );

  // With no room id in the URL at all the reaction is still sent — the
  // background resolves the room from the event id instead.
  global.location = { hash: '', pathname: '/' };
  sentMessages.length = 0;
  buttonsOf(barA)[0].listeners.click[0]();
  await delay(10);
  const reactionNoRoom = sentMessages.find((m) => m.type === 'vikunja.matrix-react');
  assert.ok(reactionNoRoom, 'reaction requested without a room id in the URL');
  assert.equal(reactionNoRoom.roomId, '', 'empty room id passed through to the background');
  global.location = { hash: '#/room/!abc:server', pathname: '/' };

  // The current element-web renders the room name in .mx_RoomHeader_truncated.
  body.removeChild(header);
  const truncated = makeEl('h1', 'mx_RoomHeader_heading');
  const truncSpan = makeEl('span', 'mx_RoomHeader_truncated');
  truncSpan.textContent = 'Truncated Room';
  truncated.appendChild(truncSpan);
  body.insertBefore(truncated, body._children[0]);
  sentMessages.length = 0;
  buttonsOf(barB)[0].listeners.click[0]();
  await delay(10);
  assert.equal(
    sentMessages[0].title,
    'Truncated Room: Second message',
    'room name read from the current header markup',
  );
  assert.ok(
    !sentMessages.some((m) => m.type === 'vikunja.matrix-room-name'),
    'no client fallback when the DOM header is present',
  );

  // Without any header markup the room name falls back to the MatrixClient.
  body.removeChild(truncated);
  sentMessages.length = 0;
  mocks.sendMessage = async (msg) => {
    sentMessages.push(msg);
    if (msg.type === 'vikunja.matrix-room-name') return { ok: true, name: 'Client Room' };
    return { ok: true, task: { id: 1 } };
  };
  buttonsOf(barB)[0].listeners.click[0]();
  await delay(10);
  const createViaFallback = sentMessages.find((m) => m.type === 'vikunja.create-task');
  assert.equal(
    createViaFallback.title,
    'Client Room: Second message',
    'title falls back to the client room name',
  );
  assert.ok(
    sentMessages.some((m) => m.type === 'vikunja.matrix-room-name' && m.roomId === '!abc:server'),
    'client fallback queried with the room id from the hash',
  );

  // A failing client fallback leaves the room name out rather than breaking.
  sentMessages.length = 0;
  mocks.sendMessage = async (msg) => {
    sentMessages.push(msg);
    if (msg.type === 'vikunja.matrix-room-name') return { ok: false, error: 'not registered' };
    return { ok: true, task: { id: 1 } };
  };
  buttonsOf(barB)[0].listeners.click[0]();
  await delay(10);
  assert.equal(
    sentMessages.find((m) => m.type === 'vikunja.create-task').title,
    'Second message',
    'no room name when the fallback fails',
  );
  mocks.sendMessage = async (msg) => { sentMessages.push(msg); return { ok: true, task: { id: 1 } }; };

  // --- Menu layout (the default) ---
  // Current element-web keeps the per-message action in the options menu and
  // its hover action bars have no "View source" anchor (only "Edit" on own
  // messages). On such a page the button must live in the menu and nowhere
  // else. A fresh page is set up and the content script run again, which
  // re-decides the layout from the DOM.
  body._children = [];
  const header2 = makeEl('h1', 'mx_RoomHeader_nametext');
  header2.textContent = 'Test Room';
  body.appendChild(header2);
  const tileM = makeTile('Hello from Element', 'Alice');
  tileM.setAttribute('data-event-id', '$msgM:server');
  const barM = makeBar([tileM], false);
  const tileMN = makeTile('Second message', '');
  const barMN = makeBar([tileMN], false);
  const tileMBare = makeTile('Third message', '');
  const barMBare = makeBar([tileMBare], false, { noEdit: true });
  const menu2 = makeMenu();
  const menuWrapper2 = makeEl('div', 'mx_ContextualMenu_wrapper');
  const menuBackground2 = makeEl('div', 'mx_ContextualMenu_background');
  menuWrapper2.appendChild(menuBackground2);
  menuWrapper2.appendChild(menu2);
  body.appendChild(menuWrapper2);
  const escapeWrapper2 = makeEl('div', 'mx_ContextualMenu_wrapper');
  const escapeMenu2 = makeMenu();
  escapeWrapper2.appendChild(escapeMenu2);
  body.appendChild(escapeWrapper2);
  doc.listeners = {};
  observerCallbacks.length = 0;
  eval(src);

  const menuButtonsOf2 = () => queryAll(doc, '.mx_MessageContextMenu .vikunja-element-add');
  assert.deepStrictEqual(buttonsOf(barM), [], 'no bar button in the menu layout');
  assert.deepStrictEqual(buttonsOf(barMN), [], 'no bar button for a message without an anchor');
  assert.deepStrictEqual(buttonsOf(barMBare), [], 'no bar button for a bare action bar');
  assert.deepStrictEqual(
    menu2._children[0]._children.map((c) => c.textContent.trim()),
    ['Reply', 'View source', 'Add to Vikunja', 'Edit'],
    'menu button goes after View source',
  );
  const menuIcon = menuButtonsOf2()[0]._children[0];
  assert.strictEqual(menuIcon.tag, 'svg', 'menu button has an inline svg icon');
  assert.strictEqual(menuIcon.getAttribute('viewBox'), '0 0 256 256');
  assert.strictEqual(menuIcon.getAttribute('aria-hidden'), 'true');

  // Activating the injected menu item closes the menu, like element-web's own
  // items do: it clicks the menu's invisible background…
  let backgroundClicks = 0;
  menuBackground2.addEventListener('click', () => { backgroundClicks += 1; });
  menuButtonsOf2()[0].listeners.click[0]();
  assert.equal(backgroundClicks, 1, 'menu background clicked to close it');

  // …and a menu without a background gets an Escape keydown through its wrapper.
  const escapeMenuButton = escapeMenu2._children[0]._children
    .filter((c) => c.getAttribute('aria-label') === 'Add to Vikunja')[0];
  let escapeCount = 0;
  escapeWrapper2.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') escapeCount += 1;
  });
  escapeMenuButton.listeners.click[0]();
  assert.equal(escapeCount, 1, 'Escape keydown dispatched to close a background-less menu');

  // The menu button has no DOM link to its message (portal), so it uses the
  // most recently hovered/clicked event tile.
  sentMessages.length = 0;
  mocks.prefs = { elementReactAfterAdd: false };
  doc.listeners.click[0]({ target: tileM });
  menuButtonsOf2()[0].listeners.click[0]();
  await delay(10);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'vikunja.create-task');
  assert.equal(sentMessages[0].title, 'Test Room: Hello from Element', 'menu button uses the tracked tile');
  assert.equal(
    sentMessages[0].description,
    'Hello from Element\n\n[View message](https://matrix.to/#/!abc:server/%24msgM%3Aserver)',
    'menu button description from the tracked tile',
  );

  // The reaction pref works from the menu too.
  sentMessages.length = 0;
  mocks.prefs = { elementReactAfterAdd: true };
  doc.listeners.click[0]({ target: tileM });
  menuButtonsOf2()[0].listeners.click[0]();
  await delay(10);
  const menuTypes = sentMessages.map((m) => m.type);
  assert.ok(
    menuTypes.includes('vikunja.create-task') && menuTypes.includes('vikunja.matrix-react'),
    'reaction requested from the menu button',
  );
  const menuReaction = sentMessages.find((m) => m.type === 'vikunja.matrix-react');
  assert.deepStrictEqual(
    { roomId: menuReaction.roomId, eventId: menuReaction.eventId, emoji: menuReaction.emoji },
    { roomId: '!abc:server', eventId: '$msgM:server', emoji: '📝' },
    'menu reaction carries room, event and emoji',
  );

  console.log('CONTENT SMOKE: ALL PASS');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
