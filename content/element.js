(() => {
  'use strict';

  const api = typeof browser !== 'undefined' ? browser : chrome;

  const BAR_SELECTOR = '.mx_MessageActionBar';
  const MENU_SELECTOR = '.mx_MessageContextMenu';
  const TILE_SELECTOR = '.mx_EventTile, .mx_EventBubbleTile, .mx_EventTimelineItem';
  const VIEW_SOURCE_LABELS = ['View source', 'View Source'];
  const EDIT_LABELS = ['Edit'];
  const ICON_URL = api.runtime.getURL('icons/icon-16.png');

  let toastEl = null;
  let toastTimer = null;
  let lastTile = null;

  function toast(message, isError) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'vikunja-element-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.style.background = isError ? '#c0392b' : '#0d9488';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastEl && toastEl.parentNode) {
        toastEl.parentNode.removeChild(toastEl);
      }
      toastEl = null;
    }, 2500);
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  // The label of an action-bar button or context-menu item, taken from the
  // dedicated label span when present, then aria-label/title, then text.
  function itemLabel(el) {
    const inner = el.querySelector
      && el.querySelector('.mx_IconizedContextMenu_label, .mx_MessageActionBar_labelText');
    if (inner) {
      return cleanText(inner.textContent);
    }
    return cleanText(el.getAttribute('aria-label')) || cleanText(el.title) || cleanText(el.textContent);
  }

  // Find an action-bar button or menu item by label. The selectors cover the
  // different element-web versions: icon/text buttons with aria-labels as
  // well as plain and iconized context menus.
  function findItem(container, labels) {
    const candidates = container.querySelectorAll(
      '[role="menuitem"], [role="button"], button, [aria-label], '
      + '.mx_IconizedContextMenu_item, .mx_ContextualMenu_option',
    );
    for (const el of candidates) {
      const label = itemLabel(el);
      if (label && labels.includes(label)) {
        return el;
      }
    }
    return null;
  }

  // Insert directly after the first matching label; returns false when the
  // item is not present so callers can try the next anchor.
  function insertAfterLabel(container, button, labels) {
    const item = findItem(container, labels);
    if (!item || !item.parentNode) {
      return false;
    }
    item.parentNode.insertBefore(button, item.nextSibling);
    return true;
  }

  function createButton(container) {
    const inMenu = String(container.className).includes('mx_MessageContextMenu');
    const button = document.createElement(inMenu ? 'li' : 'span');
    button.className = inMenu ? 'mx_IconizedContextMenu_item vikunja-element-add' : 'vikunja-element-add';
    button.setAttribute('role', inMenu ? 'menuitem' : 'button');
    button.setAttribute('tabindex', '0');
    button.setAttribute('aria-label', 'Add to Vikunja');
    button.title = 'Add to Vikunja';
    const img = document.createElement('img');
    img.src = ICON_URL;
    img.alt = '';
    img.draggable = false;
    button.appendChild(img);
    if (inMenu) {
      const label = document.createElement('span');
      label.className = 'mx_IconizedContextMenu_label';
      label.textContent = 'Add to Vikunja';
      button.appendChild(label);
    }
    button.addEventListener('click', () => {
      addToVikunja(button);
      closeMenu(button);
    });
    button.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        addToVikunja(button);
        closeMenu(button);
      }
    });
    return button;
  }

  // element-web's context menus are portals that only close on an outside
  // click, Escape, or a click on the invisible menu background. A click on our
  // injected item does none of those, so close the menu explicitly: click the
  // background when present, otherwise send an Escape keydown through the
  // wrapper. Doing this after addToVikunja was started is safe — the message
  // tile is captured before the menu unmounts.
  function closeMenu(button) {
    const wrapper = button.closest('.mx_ContextualMenu_wrapper');
    if (!wrapper) {
      return;
    }
    const background = wrapper.querySelector('.mx_ContextualMenu_background');
    if (background) {
      background.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } else {
      wrapper.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    }
  }

  // The per-message action either lives in the hover action bar (older
  // element-web versions that show a "View source" button there) or in the
  // per-message options menu (current versions — the default). Decide once
  // per page so a message never ends up with a button in both places.
  let barLayout = null;
  function scan() {
    if (barLayout === null) {
      const bar = document.querySelector(BAR_SELECTOR);
      barLayout = !!(bar && findItem(bar, VIEW_SOURCE_LABELS));
    }
    if (barLayout) {
      document.querySelectorAll(BAR_SELECTOR).forEach(inject);
    } else {
      document.querySelectorAll(MENU_SELECTOR).forEach(injectMenu);
    }
  }

  // Action bars: the button is only placed when the bar itself shows a "View
  // source" button, which marks the older layout. It is never appended to the
  // end of the bar — that lands after the ⋯ menu.
  function inject(bar) {
    if (bar.dataset.vikunjaInjected === 'true') {
      return;
    }
    const button = createButton(bar);
    if (insertAfterLabel(bar, button, VIEW_SOURCE_LABELS)) {
      bar.dataset.vikunjaInjected = 'true';
    }
  }

  // The per-message options menu (kebab or right-click) always lists "View
  // source", so this is where the button lives in current element-web.
  function injectMenu(menu) {
    if (menu.dataset.vikunjaInjected === 'true') {
      return;
    }
    // Some versions put the class on both a wrapper and the inner list.
    if (menu.querySelector(MENU_SELECTOR)) {
      return;
    }
    const button = createButton(menu);
    if (!insertAfterLabel(menu, button, VIEW_SOURCE_LABELS)
      && !insertAfterLabel(menu, button, EDIT_LABELS)) {
      menu.appendChild(button);
    }
    menu.dataset.vikunjaInjected = 'true';
  }

  // The options menu is rendered in a portal without a DOM link back to its
  // message, so the most recently hovered/clicked event tile stands in as
  // the message context for the injected menu button.
  function trackTile(e) {
    const target = e && e.target;
    const tile = target && target.closest ? target.closest(TILE_SELECTOR) : null;
    if (tile) {
      lastTile = tile;
    }
  }

  function tileOf(button) {
    return button.closest(TILE_SELECTOR) || lastTile;
  }

  // Room name from the DOM header. The markup changed across element-web
  // versions (and the current one renders the name in .mx_RoomHeader_truncated),
  // so match the known variants, most specific first.
  function roomName() {
    const els = document.querySelectorAll(
      '.mx_RoomHeader_truncated, .mx_RoomHeader_heading, '
        + '.mx_RoomHeader_nametext, .mx_RoomHeader_Heading_title, '
        + '.mx_RoomHeader_nameWithStatus, .mx_RoomHeader_name',
    );
    return els.length ? cleanText(els[0].textContent) : '';
  }

  // Fallback: ask the background to read the room name from element-web's own
  // MatrixClient (injected into the page's MAIN world), which is authoritative
  // and independent of the DOM layout. Best-effort like the reaction.
  async function roomNameFromClient() {
    const roomId = roomIdFromUrl();
    if (!roomId) {
      return '';
    }
    try {
      const response = await api.runtime.sendMessage({
        type: 'vikunja.matrix-room-name',
        roomId,
      });
      if (response && response.ok === true && response.name) {
        return cleanText(String(response.name));
      }
    } catch (e) {
      // fallback is best-effort
    }
    return '';
  }

  function senderName(tile) {
    const scope = tile || document;
    const el = scope.querySelector(
      '.mx_EventTile_senderDetails .mx_DisambiguatedDisplayName, '
        + '.mx_EventTile_senderName, '
        + '.mx_EventTile_senderDetails, '
        + '.mx_DisambiguatedDisplayName',
    );
    return el ? cleanText(el.textContent) : '';
  }

  // Plain-text body for the task title (no markup).
  function messageBody(tile) {
    if (!tile) {
      return '';
    }
    const el = tile.querySelector('.mx_EventTile_body');
    return el ? cleanText(el.textContent) : '';
  }

  // Convert element-web's rendered message HTML back to Markdown so the task
  // description keeps the message's formatting in Vikunja. Matrix transmits the
  // message as a plain body plus a formatted_body (HTML), never the original
  // Markdown, so the rendered DOM is the closest faithful copy to work from.
  function htmlToMarkdown(node) {
    if (!node) {
      return '';
    }
    const children = () => Array.from(node.childNodes || node._children || []).map(htmlToMarkdown).join('');
    const text = () => String(node.textContent || '');
    const inline = () => children() || text();
    const tag = String(node.tagName || node.tag || '').toLowerCase();
    const attr = (name) => (typeof node.getAttribute === 'function' ? node.getAttribute(name) : null);

    switch (tag) {
      case '':
        return inline();
      case 'br':
        return '\n';
      case 'hr':
        return '\n---\n';
      case 'p':
        return `\n\n${inline().trim()}\n`;
      case 'strong':
      case 'b':
        return `**${inline()}**`;
      case 'em':
      case 'i':
        return `*${inline()}*`;
      case 's':
      case 'del':
      case 'strike':
        return `~~${inline()}~~`;
      case 'u':
        return `_${inline()}_`;
      case 'code':
        return `\`${inline()}\``;
      case 'pre':
        return `\n\n\`\`\`\n${text().replace(/\n?$/, '')}\n\`\`\`\n`;
      case 'a': {
        const href = attr('href');
        return href ? `[${inline()}](${href})` : inline();
      }
      case 'img': {
        const src = attr('src');
        return src ? `![${attr('alt') || ''}](${src})` : '';
      }
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        return `\n\n${'#'.repeat(Number(tag.slice(1)))} ${inline().trim()}\n`;
      case 'ul':
      case 'ol': {
        const items = Array.from(node.childNodes || node._children || [])
          .filter((c) => String(c.tagName || c.tag || '').toLowerCase() === 'li')
          .map((li, i) => `${tag === 'ol' ? `${i + 1}.` : '-'} ${htmlToMarkdown(li).trim()}`);
        return `\n\n${items.join('\n')}\n`;
      }
      case 'blockquote':
        return `\n\n${inline().trim().split('\n').map((line) => `> ${line}`).join('\n')}\n`;
      default:
        return inline();
    }
  }

  // Formatted message body for the task description.
  function markdownBody(tile) {
    if (!tile) {
      return '';
    }
    const el = tile.querySelector('.mx_EventTile_body');
    return el ? htmlToMarkdown(el).trim() : '';
  }

  // The room id from the page URL. element-web can be configured with hash
  // routing (#/room/...) or path routing (/room/...), so check both.
  function roomIdFromUrl() {
    const candidate = location.hash || location.pathname || '';
    const match = candidate.match(/\/room\/([^/?]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  // Best-effort matrix.to link. Current element-web renders a data-event-id
  // attribute on message tiles, so the link is message-level when present and
  // room-level otherwise.
  function permalink(tile) {
    const roomId = roomIdFromUrl();
    if (!roomId) {
      return '';
    }
    const eventId = tile ? tile.getAttribute('data-event-id') : null;
    return eventId ? `https://matrix.to/#/${roomId}/${encodeURIComponent(eventId)}` : `https://matrix.to/#/${roomId}`;
  }

  // The first maxLen characters of a message, with an ellipsis when cut.
  function truncate(value, maxLen) {
    const text = String(value || '');
    if (text.length <= maxLen) {
      return text;
    }
    return `${text.slice(0, maxLen)}…`;
  }

  // Title: the room/DM partner name followed by the start of the message.
  // For direct messages the room header already shows the partner's name.
  function taskTitle(room, body, sender) {
    const start = truncate(body, 50);
    if (start) {
      return room ? `${room}: ${start}` : start;
    }
    return room || (sender ? `Message from ${sender}` : 'Add task');
  }

  function buildDescription(body, url) {
    const parts = [];
    if (body) {
      parts.push(body);
    }
    if (url) {
      parts.push(`[View message](${url})`);
    }
    return parts.join('\n\n');
  }

  // Best-effort reaction: ask the background to have Element react with 📝 via
  // its own MatrixClient (injected into the page's MAIN world). Everything here
  // is optional — a missing pref, event id or any failure just skips so the
  // "added to Vikunja" flow is never affected.
  async function reactWithMemo(tile) {
    const eventId = tile ? tile.getAttribute('data-event-id') : null;
    if (!eventId) {
      return;
    }
    const roomId = roomIdFromUrl();
    try {
      const response = await api.runtime.sendMessage({
        type: 'vikunja.matrix-react',
        roomId,
        eventId,
        emoji: '📝',
      });
      if (!response || response.ok !== true) {
        console.warn('Vikunja: automatic reaction failed:', response && response.error);
      }
    } catch (e) {
      console.warn('Vikunja: automatic reaction failed:', e && e.message);
    }
  }

  async function addToVikunja(button) {
    const tile = tileOf(button);
    let room = roomName();
    if (!room) {
      room = await roomNameFromClient();
    }
    const sender = senderName(tile);
    const url = permalink(tile);
    const body = messageBody(tile);
    const title = taskTitle(room, body, sender);
    const description = buildDescription(markdownBody(tile) || body, url);
    try {
      const response = await api.runtime.sendMessage({
        type: 'vikunja.create-task',
        title,
        description,
      });
      if (!response || response.ok !== true) {
        toast((response && response.error) || 'Could not add task to Vikunja.', true);
      } else {
        toast('Added to Vikunja.');
        api.storage.sync
          .get({ elementReactAfterAdd: false })
          .then((stored) => {
            if (stored && stored.elementReactAfterAdd) {
              reactWithMemo(tile);
            }
          })
          .catch(() => {});
      }
    } catch (e) {
      toast(e.message || 'Could not add task to Vikunja.', true);
    }
  }

  // When the extension is reloaded or updated, the background re-runs this
  // script into already-open Element tabs (dynamic registrations only apply to
  // pages loaded afterwards). Buttons and markers left behind by the previous
  // instance are stale (their icon URLs and event handlers died with it), so
  // remove them so this instance can inject fresh ones.
  document.querySelectorAll('.vikunja-element-add, .vikunja-element-toast')
    .forEach((el) => el.remove());
  document.querySelectorAll('[data-vikunja-injected]')
    .forEach((el) => el.removeAttribute('data-vikunja-injected'));

  const root = document.body || document.documentElement;
  if (root) {
    const observer = new MutationObserver(scan);
    observer.observe(root, { childList: true, subtree: true });
  }
  if (document.addEventListener) {
    document.addEventListener('click', trackTile, true);
    document.addEventListener('contextmenu', trackTile, true);
    document.addEventListener('mouseover', trackTile, true);
  }
  scan();
})();
