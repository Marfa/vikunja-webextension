(() => {
  'use strict';

  const { api, normalizeBaseUrl, getConfig, request } = window.VikunjaLib;

  const form = document.getElementById('settings-form');
  const urlInput = document.getElementById('base-url');
  const tokenInput = document.getElementById('token');
  const saveBtn = document.getElementById('save');
  const testBtn = document.getElementById('test');
  const statusEl = document.getElementById('status');

  function showStatus(message, kind) {
    statusEl.textContent = message;
    statusEl.className = `status ${kind}`;
    statusEl.hidden = false;
  }

  function clearStatus() {
    statusEl.hidden = true;
  }

  function formConfig() {
    return {
      baseUrl: normalizeBaseUrl(urlInput.value),
      token: tokenInput.value.trim(),
    };
  }

  function validate() {
    const { baseUrl, token } = formConfig();
    if (!baseUrl || !/^https?:\/\/[^/]+/.test(baseUrl)) {
      showStatus('Please enter a valid Vikunja URL (e.g. https://try.vikunja.io).', 'error');
      return null;
    }
    if (!token) {
      showStatus('Please enter your Vikunja API token.', 'error');
      return null;
    }
    return { baseUrl, token };
  }

  async function init() {
    const { baseUrl, token } = await getConfig();
    urlInput.value = baseUrl;
    tokenInput.value = token;
  }

  async function save() {
    const config = validate();
    if (!config) return;
    saveBtn.disabled = true;
    try {
      await api.storage.sync.set(config);
      showStatus('Settings saved.', 'ok');
    } catch (e) {
      showStatus(`Could not save settings: ${e.message}`, 'error');
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function test() {
    const config = validate();
    if (!config) return;
    testBtn.disabled = true;
    saveBtn.disabled = true;
    try {
      await api.storage.sync.set(config);
      const user = await request('user', {
        token: config.token,
        baseUrl: config.baseUrl,
      });
      showStatus(
        `Connected successfully${user && user.name ? ` as ${user.name}` : ''}.`,
        'ok'
      );
    } catch (e) {
      showStatus(`Connection failed: ${e.message}`, 'error');
    } finally {
      testBtn.disabled = false;
      saveBtn.disabled = false;
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });

  testBtn.addEventListener('click', test);
  urlInput.addEventListener('input', clearStatus);
  tokenInput.addEventListener('input', clearStatus);

  init();
})();
