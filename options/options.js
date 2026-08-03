(() => {
  'use strict';

  const { api, normalizeBaseUrl, getConfig, getPrefs, request, listProjects, hostPermissionPatterns, requestHostPermissions, getElementInstances, elementInstancePatterns, hasHostPermissions } = window.VikunjaLib;
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
  const elementList = document.getElementById('element-instances');
  const addElementBtn = document.getElementById('add-element');
  const elementDialog = document.getElementById('element-dialog');
  const elementForm = document.getElementById('element-form');
  const elementUrlInput = document.getElementById('element-url');
  const elementStatusEl = document.getElementById('element-status');
  const elementAddBtn = document.getElementById('element-add');
  const elementCancelBtn = document.getElementById('element-cancel');
  const elementReactAfterAddInput = document.getElementById('element-react-after-add');
  const elementTagInput = document.getElementById('element-tag');

  let projects = [];
  let elementInstances = [];

  function showStatus(message, kind) {
    statusEl.textContent = message;
    statusEl.className = `status ${kind}`;
    statusEl.hidden = false;
  }

  function showElementStatus(message, kind) {
    elementStatusEl.textContent = message;
    elementStatusEl.className = `status ${kind}`;
    elementStatusEl.hidden = !message;
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
      elementReactAfterAdd: elementReactAfterAddInput.checked,
      elementTag: elementTagInput.value.trim(),
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
    const [config, prefs, instances] = await Promise.all([getConfig(), getPrefs(), getElementInstances()]);
    urlInput.value = config.baseUrl;
    tokenInput.value = config.token;
    dueTodayInput.checked = prefs.dueToday;
    customFilterInput.value = prefs.customFilter;
    sortByInput.value = prefs.sortBy || 'position';
    rememberLastSortInput.checked = prefs.rememberLastSort;
    elementReactAfterAddInput.checked = Boolean(prefs.elementReactAfterAdd);
    elementTagInput.value = prefs.elementTag || '';
    elementInstances = instances;
    renderElementInstances();
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
      // Ensure we have the permissions
      if (!await requestHostPermissions(hostPermissionPatterns(config))) {
        throw new Error(`Permission denied for ${config.baseUrl}`);
      }

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
        'ok',
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

  function elementBadge(granted) {
    const span = document.createElement('span');
    span.className = `badge ${granted ? 'granted' : 'missing'}`;
    span.textContent = granted ? 'Granted' : 'Not granted';
    return span;
  }

  async function renderElementInstances() {
    elementList.textContent = '';
    for (const inst of elementInstances) {
      const pattern = elementInstancePatterns([inst])[0];
      const li = document.createElement('li');
      const url = document.createElement('span');
      url.className = 'url';
      url.textContent = inst.url;
      const badge = elementBadge(pattern ? await hasHostPermissions([pattern]) : false);
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'secondary';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => removeElementInstance(inst.url));
      li.appendChild(url);
      li.appendChild(badge);
      li.appendChild(removeBtn);
      elementList.appendChild(li);
    }
  }

  async function removeElementInstance(url) {
    const pattern = elementInstancePatterns([{ url }])[0];
    elementInstances = elementInstances.filter((inst) => inst.url !== url);
    await api.storage.sync.set({ elementInstances });
    renderElementInstances();
    if (pattern && api.permissions && typeof api.permissions.remove === 'function') {
      api.permissions.remove({ origins: [pattern] }).catch(() => {});
    }
    showStatus(`Removed ${url}.`, 'ok');
  }

  function openElementDialog() {
    elementUrlInput.value = '';
    showElementStatus('', '');
    if (typeof elementDialog.showModal === 'function') {
      elementDialog.showModal();
    }
    elementUrlInput.focus();
  }

  async function addElement(e) {
    e.preventDefault();
    const url = normalizeBaseUrl(elementUrlInput.value);
    const pattern = elementInstancePatterns([{ url }])[0];
    if (!pattern) {
      showElementStatus('Please enter a valid Element URL (e.g. https://app.element.io).', 'error');
      return;
    }
    elementAddBtn.disabled = true;
    try {
      if (!await requestHostPermissions([pattern])) {
        showElementStatus('Access to that Element instance was not granted.', 'error');
        return;
      }
      if (!elementInstances.some((inst) => inst.url === url)) {
        elementInstances.push({ url });
        await api.storage.sync.set({ elementInstances });
      }
      if (typeof elementDialog.close === 'function') {
        elementDialog.close();
      }
      renderElementInstances();
      showStatus(`Added ${url}. You can now add tasks from Element.`, 'ok');
    } catch (err) {
      showElementStatus(`Could not add instance: ${err.message}`, 'error');
    } finally {
      elementAddBtn.disabled = false;
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });

  testBtn.addEventListener('click', test);
  urlInput.addEventListener('input', clearStatus);
  tokenInput.addEventListener('input', clearStatus);
  addElementBtn.addEventListener('click', openElementDialog);
  elementForm.addEventListener('submit', addElement);
  elementCancelBtn.addEventListener('click', () => {
    if (typeof elementDialog.close === 'function') {
      elementDialog.close();
    }
  });
  elementUrlInput.addEventListener('input', () => showElementStatus('', ''));

  init();
})();
