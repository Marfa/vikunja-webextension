// Smoke-test mock for the WebExtension i18n API. The English catalog is the
// source of truth so existing assertions can keep expecting English strings.
// Usage (after the test built its own global.chrome/global.browser):
//
//   const { installI18nMock } = require('./lib/i18n-mock');
//   installI18nMock();
//   eval(fs.readFileSync(path.join(__dirname, '..', 'lib/i18n.js'), 'utf8'));
const fs = require('fs');
const path = require('path');

const messages = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', '_locales/en/messages.json'), 'utf8'),
);

function getMessage(name, substitutions) {
  const msg = messages[name];
  if (!msg || typeof msg.message !== 'string') {
    return '';
  }
  const subs = Array.isArray(substitutions)
    ? substitutions
    : (substitutions === undefined || substitutions === null) ? [] : [substitutions];
  let text = msg.message.replace(/\$\$/g, '\u0000');
  text = text.replace(/\$([1-9])/g, (match, n) => {
    const i = Number(n) - 1;
    if (i < subs.length) {
      return String(subs[i]);
    }
    const ph = msg.placeholders && msg.placeholders[n];
    return ph && ph.content !== null && ph.content !== undefined ? String(ph.content) : match;
  });
  return text.split('\u0000').join('$');
}

function getUILanguage() {
  return 'en';
}

// The tests build their own global.chrome/global.browser first, so this runs
// after them and just adds the i18n namespace.
function installI18nMock() {
  const i18n = { getMessage, getUILanguage };
  if (globalThis.chrome) {
    globalThis.chrome.i18n = i18n;
  } else {
    globalThis.chrome = { i18n };
  }
  if (globalThis.browser) {
    globalThis.browser.i18n = i18n;
  }
}

module.exports = { messages, getMessage, getUILanguage, installI18nMock };
