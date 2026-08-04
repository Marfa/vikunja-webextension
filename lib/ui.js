// Shared helpers for the extension pages (popup, options, capture). Loaded
// after lib/vikunja.js in page HTML, never in the service worker.
(() => {
  'use strict';

  function openOptions(api) {
    if (api.runtime && api.runtime.openOptionsPage) {
      api.runtime.openOptionsPage();
    } else {
      window.open(api.runtime.getURL('options/options.html'));
    }
  }

  // Native-app feel: suppress the browser context menu except inside editable
  // text fields, where the usual cut/copy/paste menu is still useful.
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('contextmenu', (e) => {
      const target = e.target;
      const tag = target && target.tagName;
      const editable =
        tag === 'INPUT' || tag === 'TEXTAREA' || (target && target.isContentEditable);
      if (!editable) {
        e.preventDefault();
      }
    });
  }

  let toastTimer = null;
  const { t } = globalThis.I18n || { t: (key, englishDefault) => englishDefault };
  function showToast(el, message, { duration = 2000, link } = {}) {
    el.textContent = '';
    if (link && link.href) {
      const idStr = String(link.id);
      const text = t('toastTaskAdded', 'Task $1 added', [idStr]);
      const anchor = document.createElement('a');
      anchor.href = link.href;
      anchor.target = '_blank';
      anchor.rel = 'noopener';
      anchor.textContent = idStr;
      const at = text.indexOf(idStr);
      if (at !== -1) {
        el.appendChild(document.createTextNode(text.slice(0, at)));
        el.appendChild(anchor);
        el.appendChild(document.createTextNode(text.slice(at + idStr.length)));
      } else {
        el.appendChild(anchor);
        el.appendChild(document.createTextNode(text));
      }
      duration = 4000;
    } else {
      el.textContent = message;
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, duration);
  }

  // Fill a <select> with project options and restore a selection. Returns the
  // effective value: the requested one when it exists, otherwise the first
  // real project (when fallbackToFirst), otherwise the placeholder.
  function fillProjectSelect(
    select,
    projects,
    { selectedId = null, placeholder = 'Select a project', placeholderDisabled = true, fallbackToFirst = true } = {},
  ) {
    select.textContent = '';
    const addOption = (value, label, disabled = false) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.disabled = disabled;
      select.appendChild(option);
    };
    addOption('', placeholder, placeholderDisabled);
    for (const p of projects) {
      addOption(String(p.id), p.title);
    }
    const options = [...select.options];
    let value =
      selectedId && options.some((o) => o.value === String(selectedId))
        ? String(selectedId)
        : '';
    if (!value && fallbackToFirst) {
      const first = options.find((o) => o.value !== '');
      if (first) value = first.value;
    }
    select.value = value;
    return value;
  }

  globalThis.UiLib = { openOptions, showToast, fillProjectSelect };
})();
