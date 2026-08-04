// Tiny localization helper. Uses the WebExtension i18n API when available
// (browser-driven language selection via _locales/<locale>/messages.json),
// falling back to the English default passed in for every call so plain
// contexts (tests, a missing locale entry) still render readable text.
//
// Loaded first in every context that uses it: extension pages (via <script>),
// the background service worker (via importScripts) and the Matrix Element
// content script (registered before content/element.js).
//
// Extension pages keep their English text in the HTML and mark it with
// data-i18n / data-i18n-html / data-i18n-placeholder / data-i18n-title /
// data-i18n-aria-label attributes; each page's main script calls I18n.applyPage()
// once the DOM is ready. This swaps in the browser-language message. Chrome
// substitutes __MSG_ placeholders in HTML itself, but Firefox does not, so all
// page text goes through applyPage (works in both).
(() => {
  'use strict';

  const api = typeof browser !== 'undefined' ? browser : chrome;

  function t(key, englishDefault, substitutions) {
    try {
      if (api && api.i18n && typeof api.i18n.getMessage === 'function') {
        const message = api.i18n.getMessage(key, substitutions);
        if (message !== undefined && message !== null && message !== '') {
          return message;
        }
      }
    } catch (e) {
      // Fall through to the English default.
    }
    return englishDefault;
  }

  // Localize the static text of an extension page. The DOM keeps the English
  // text as the fallback; each element carries the message key in a data
  // attribute. Safe to run more than once.
  function applyPage() {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') {
      return;
    }
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'), el.textContent);
    });
    document.querySelectorAll('[data-i18n-html]').forEach((el) => {
      el.innerHTML = t(el.getAttribute('data-i18n-html'), el.innerHTML);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      el.setAttribute('placeholder', t(key, el.getAttribute('placeholder')));
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      el.title = t(key, el.title);
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria-label');
      el.setAttribute('aria-label', t(key, el.getAttribute('aria-label')));
    });
    if (document.documentElement) {
      document.documentElement.lang = t('htmlLang', document.documentElement.lang || 'en');
    }
  }

  globalThis.I18n = { t, applyPage };
})();
