(() => {
  'use strict';

  const { api, normalizeBaseUrl, getConfig, getPrefs, request, listProjects } = window.VikunjaLib;
  const { fillProjectSelect: uiFillProjectSelect } = window.UiLib;

  const form = document.getElementById('settings-form');
  const urlInput = document.getElementById('base-url');
  const tokenInput = document.getElementById('token');
  const defaultProjectSelect = document.getElementById('default-project');
  const dueTodayInput = document.getElementById('due-today');
  const customFilterInput = document.getElementById('custom-filter');
  const sortByInput = document.getElementById('sort-by');
  const rememberLastSortInput = document.getElementById('remember-last-sort');
  const saveBtn = document.getElementById('save');
  const testBtn = document.getElementById('test');
  const statusEl = document.getElementById('status');

  let projects = [];

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
      defaultProjectId: defaultProjectSelect.value || null,
      dueToday: dueTodayInput.checked,
      customFilter: customFilterInput.value.trim(),
      sortBy: sortByInput.value || 'position',
      rememberLastSort: rememberLastSortInput.checked,
    };
  }

  function validate() {
    const config = formConfig();
    if (!config.baseUrl || !/^https?:\/\/[^/]+/.test(config.baseUrl)) {
      showStatus('Please enter a valid Vikunja URL (e.g. https://try.vikunja.io).', 'error');
      return null;
    }
    if (!config.token) {
      showStatus('Please enter your Vikunja API token.', 'error');
      return null;
    }
    return config;
  }

  function fillProjectSelect(selected) {
    uiFillProjectSelect(defaultProjectSelect, projects, {
      selectedId: selected,
      placeholder: 'No default project',
      placeholderDisabled: false,
      fallbackToFirst: false,
    });
  }

  async function init() {
    const [config, prefs] = await Promise.all([getConfig(), getPrefs()]);
    urlInput.value = config.baseUrl;
    tokenInput.value = config.token;
    dueTodayInput.checked = prefs.dueToday;
    customFilterInput.value = prefs.customFilter;
    sortByInput.value = prefs.sortBy || 'position';
    rememberLastSortInput.checked = prefs.rememberLastSort;
    if (config.baseUrl && config.token) {
      try {
        projects = await listProjects();
      } catch (e) {
        projects = [];
      }
      fillProjectSelect(prefs.defaultProjectId);
    }
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
    await save();
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
      try {
        projects = await listProjects();
        fillProjectSelect(config.defaultProjectId);
      } catch (e) {
        showStatus(`Connected, but could not load projects: ${e.message}`, 'error');
      }
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
