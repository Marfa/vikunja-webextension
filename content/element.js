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
    button.addEventListener('click', () => addToVikunja(button));
    button.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        addToVikunja(button);
      }
    });
    return button;
  }

  // Action bars: the button is only placed when the bar itself shows a "View
  // source" or "Edit" button. It is never appended to the end of the bar —
  // that lands after the ⋯ menu; those element-web versions keep the item in
  // the options menu (injectMenu) instead.
  function inject(bar) {
    if (bar.dataset.vikunjaInjected === 'true') {
      return;
    }
    const button = createButton(bar);
    if (insertAfterLabel(bar, button, VIEW_SOURCE_LABELS)
      || insertAfterLabel(bar, button, EDIT_LABELS)) {
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

  function scan() {
    document.querySelectorAll(BAR_SELECTOR).forEach(inject);
    document.querySelectorAll(MENU_SELECTOR).forEach(injectMenu);
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

  function roomName() {
    const els = document.querySelectorAll(
      '.mx_RoomHeader_nametext, .mx_RoomHeader_Heading_title, .mx_RoomHeader_nameWithStatus, .mx_RoomHeader_name',
    );
    return els.length ? cleanText(els[0].textContent) : '';
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

  function messageBody(tile) {
    if (!tile) {
      return '';
    }
    const el = tile.querySelector('.mx_EventTile_body');
    return el ? cleanText(el.textContent) : '';
  }

  function roomIdFromHash() {
    const match = location.hash.match(/\/room\/([^/?]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  // Best-effort matrix.to link. Current element-web renders a data-event-id
  // attribute on message tiles, so the link is message-level when present and
  // room-level otherwise.
  function permalink(tile) {
    const roomId = roomIdFromHash();
    if (!roomId) {
      return '';
    }
    const eventId = tile ? tile.getAttribute('data-event-id') : null;
    return eventId ? `https://matrix.to/#/${roomId}/${encodeURIComponent(eventId)}` : `https://matrix.to/#/${roomId}`;
  }

  function buildDescription(room, sender, url) {
    const parts = [];
    if (room && sender) {
      parts.push(`From ${room} by ${sender}`);
    } else if (room) {
      parts.push(`From ${room}`);
    } else if (sender) {
      parts.push(`By ${sender}`);
    }
    if (url) {
      parts.push(`[View message](${url})`);
    }
    return parts.join('\n\n');
  }

  // Best-effort reaction: ask the background to have Element react with 📝 via
  // its own MatrixClient (injected into the page's MAIN world). Everything here
  // is optional — a missing pref, event id or room id, or any failure just
  // skips so the "added to Vikunja" flow is never affected.
  async function reactWithMemo(tile) {
    const eventId = tile ? tile.getAttribute('data-event-id') : null;
    const roomId = roomIdFromHash();
    if (!eventId || !roomId) {
      return;
    }
    try {
      await api.runtime.sendMessage({
        type: 'vikunja.matrix-react',
        roomId,
        eventId,
        emoji: '📝',
      });
    } catch (e) {
      // reaction is best-effort
    }
  }

  async function addToVikunja(button) {
    const tile = tileOf(button);
    const room = roomName();
    const sender = senderName(tile);
    const url = permalink(tile);
    const title = messageBody(tile) || (sender ? `Message from ${sender}` : 'Add task');
    const description = buildDescription(room, sender, url);
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
