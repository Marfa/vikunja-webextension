(() => {
  'use strict';

  const api = typeof browser !== 'undefined' ? browser : chrome;

  function normalizeBaseUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '');
  }

  async function getConfig() {
    const stored = await api.storage.sync.get({ baseUrl: '', token: '' });
    return {
      baseUrl: normalizeBaseUrl(stored.baseUrl),
      token: String(stored.token || '').trim(),
    };
  }

  async function getPrefs() {
    const stored = await api.storage.sync.get({
      defaultProjectId: null,
      dueToday: false,
      customFilter: '',
      sortBy: 'position',
      rememberLastSort: false,
    });
    return {
      defaultProjectId: stored.defaultProjectId || null,
      dueToday: Boolean(stored.dueToday),
      customFilter: String(stored.customFilter || '').trim(),
      sortBy: String(stored.sortBy || 'position'),
      rememberLastSort: Boolean(stored.rememberLastSort),
    };
  }

  // baseUrl -> "https://example.com/*", or null for an invalid/empty URL.
  function originPattern(baseUrl) {
    try {
      const origin = new URL(baseUrl).origin;
      return origin ? origin + '/*' : null;
    } catch {
      return null;
    }
  }

  // Single source of truth for every host origin the extension needs. Popup,
  // capture and options all derive their permission checks/requests from here,
  // so future hosts (extra instances, a sync server, ...) only need to be
  // appended to this list and every entry point requests them together.
  function hostPermissionPatterns(config) {
    return [originPattern(config && config.baseUrl)].filter(Boolean);
  }

  function hasHostPermissions(patterns) {
    if (!api.permissions || !patterns || patterns.length === 0) {
      return Promise.resolve(true);
    }
    return api.permissions.contains({ origins: patterns });
  }

  // One prompt for all patterns; the browser grants all or none.
  function requestHostPermissions(patterns) {
    if (!api.permissions || !patterns || patterns.length === 0) {
      return Promise.resolve(true);
    }
    return api.permissions.request({ origins: patterns });
  }

  function apiError(url, status, body) {
    const msg = (body && body.detail)
      ? body.detail
      : ((body && body.message) ? body.message : `Request failed with status ${status}`);
    const err = new Error(msg);
    err.status = status;
    err.url = url;
    return err;
  }

  async function rawRequest(path, { method = 'GET', body, token, baseUrl, contentType } = {}) {
    const url = `${baseUrl}/api/v2/${path}`;
    const headers = { Accept: 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (body !== undefined) {
      headers['Content-Type'] = contentType || 'application/json';
    }
    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new Error(`Could not reach Vikunja at ${baseUrl}: ${e.message}`);
    }
    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = null; }
    }
    if (!res.ok) {
      throw apiError(url, res.status, data);
    }
    return { data, headers: res.headers };
  }

  async function request(path, opts = {}) {
    const { data } = await rawRequest(path, opts);
    return data;
  }

  function parseItems(data) {
    if (Array.isArray(data)) {
      return data;
    }
    if (data && Array.isArray(data.items)) {
      return data.items;
    }
    if (data && Array.isArray(data.projects)) {
      return data.projects;
    }
    if (data && Array.isArray(data.result)) {
      return data.result;
    }
    return [];
  }

  async function paginate(path, { token, baseUrl, baseParams = new URLSearchParams() } = {}) {
    const items = [];
    let page = 1;
    let totalPages = 1;
    do {
      const params = new URLSearchParams(baseParams);
      params.set('page', String(page));
      const { data, headers } = await rawRequest(`${path}?${params}`, { token, baseUrl });
      items.push(...parseItems(data));
      if (data && typeof data.total_pages === 'number') {
        totalPages = data.total_pages;
      } else {
        const headerPages = headers.get('x-pagination-total-pages');
        if (headerPages !== null) {
          totalPages = parseInt(headerPages, 10) || 1;
        }
      }
      page += 1;
    } while (page <= totalPages && page <= 50);
    return items;
  }

  async function listProjects() {
    const { baseUrl, token } = await getConfig();
    if (!baseUrl || !token) {
      throw new Error('Vikunja is not configured yet.');
    }
    return paginate('projects', {
      token,
      baseUrl,
      baseParams: new URLSearchParams({ per_page: '50' }),
    });
  }

  async function listTasks({ projectId = null, viewId = null, filter = '', sortBy = 'id', orderBy = 'desc' } = {}) {
    const { baseUrl, token } = await getConfig();
    if (!baseUrl || !token) {
      throw new Error('Vikunja is not configured yet.');
    }
    const baseParams = new URLSearchParams({ per_page: '50' });
    if (sortBy) {
      baseParams.set('sort_by', sortBy);
      baseParams.set('order_by', orderBy || 'asc');
    }
    if (filter) {
      baseParams.set('filter', filter);
    }

    // Position ("manually sorted") is only valid through a project view, so
    // the call switches to the views/tasks endpoint when a view is supplied.
    if (projectId && viewId) {
      return paginate(`projects/${projectId}/views/${viewId}/tasks`, { token, baseUrl, baseParams });
    }
    if (projectId) {
      return paginate(`projects/${projectId}/tasks`, { token, baseUrl, baseParams });
    }
    return paginate('tasks', { token, baseUrl, baseParams });
  }

  async function listProjectViews(projectId) {
    const { baseUrl, token } = await getConfig();
    if (!baseUrl || !token) {
      throw new Error('Vikunja is not configured yet.');
    }
    return paginate(`projects/${projectId}/views`, {
      token,
      baseUrl,
      baseParams: new URLSearchParams({ per_page: '50' }),
    });
  }

  async function createTask(projectId, task) {
    const { baseUrl, token } = await getConfig();
    if (!baseUrl || !token) {
      throw new Error('Vikunja is not configured yet.');
    }
    return request(`projects/${projectId}/tasks`, {
      method: 'POST',
      body: task,
      token,
      baseUrl,
    });
  }

  async function completeTask(id, done = true) {
    const { baseUrl, token } = await getConfig();
    if (!baseUrl || !token) {
      throw new Error('Vikunja is not configured yet.');
    }
    // v2 PUT is a full replace, so a partial update goes through PATCH with a
    // JSON Merge Patch body (only the fields present are changed).
    return request(`tasks/${id}`, {
      method: 'PATCH',
      contentType: 'application/merge-patch+json',
      body: { done: Boolean(done) },
      token,
      baseUrl,
    });
  }

  async function getCurrentUser() {
    const { baseUrl, token } = await getConfig();
    if (!baseUrl || !token) {
      throw new Error('Vikunja is not configured yet.');
    }
    return request('user', { token, baseUrl });
  }

  // The prefix mode the frontend uses for Quick Add Magic, read from the
  // user's frontend settings on the server (no extension setting needed).
  // Values: 'vikunja' | 'todoist' | 'disabled'; anything else → 'vikunja'.
  async function getQuickAddMagicMode() {
    const user = await getCurrentUser();
    const settings = (user && user.settings) || {};
    const frontend = settings.frontend_settings || {};
    const mode = frontend.quick_add_magic_mode;
    if (mode === 'todoist' || mode === 'disabled') {
      return mode;
    }
    return 'vikunja';
  }

  async function listLabels() {
    const { baseUrl, token } = await getConfig();
    if (!baseUrl || !token) {
      throw new Error('Vikunja is not configured yet.');
    }
    return paginate('labels', {
      token,
      baseUrl,
      baseParams: new URLSearchParams({ per_page: '50' }),
    });
  }

  async function createLabel({ title, hexColor } = {}) {
    const { baseUrl, token } = await getConfig();
    if (!baseUrl || !token) {
      throw new Error('Vikunja is not configured yet.');
    }
    return request('labels', {
      method: 'POST',
      body: { title, hex_color: hexColor },
      token,
      baseUrl,
    });
  }

  async function addLabelToTask(taskId, labelId) {
    const { baseUrl, token } = await getConfig();
    if (!baseUrl || !token) {
      throw new Error('Vikunja is not configured yet.');
    }
    return request(`tasks/${taskId}/labels`, {
      method: 'POST',
      body: { label_id: labelId },
      token,
      baseUrl,
    });
  }

  async function addAssigneeToTask(taskId, userId) {
    const { baseUrl, token } = await getConfig();
    if (!baseUrl || !token) {
      throw new Error('Vikunja is not configured yet.');
    }
    return request(`tasks/${taskId}/assignees`, {
      method: 'POST',
      body: { user_id: userId },
      token,
      baseUrl,
    });
  }

  async function searchProjectUsers(projectId, query) {
    const { baseUrl, token } = await getConfig();
    if (!baseUrl || !token) {
      throw new Error('Vikunja is not configured yet.');
    }
    const params = new URLSearchParams();
    if (query) {
      params.set('q', query);
    }
    const { data } = await rawRequest(`projects/${projectId}/users?${params}`, {
      token,
      baseUrl,
    });
    return parseItems(data);
  }

  // Build a task from a context menu click and/or tab, Todoist-style:
  // selected text or the page title becomes the title, the URL goes into the
  // description as `[title](url)` markdown.
  function buildTaskContent(info = {}, tab = {}) {
    const selectionText = info.selectionText ? String(info.selectionText) : '';
    const tabUrl = info.linkUrl || tab.url || '';
    const url = String(tabUrl || '').trim();
    let title = selectionText || tab.title || '';
    title = title
      .replace(/(?:https?:\/\/)?(?:www\.)?[^\s]+\.[a-z]{2,}(?:\/[^\s]*)?/gi, '')
      .replace(/\(/g, '[')
      .replace(/\)/g, ']')
      .replace(/\s+/g, ' ')
      .trim();
    if (!title) {
      title = String(tab.title || '').trim();
    }
    if (!title) {
      title = 'Add task';
    }
    const description = url ? `[${title}](${url})` : '';
    return { title, description, url };
  }

  // Mirror the Vikunja frontend's "nearest hour" behaviour so a "today" due
  // date lands on the same rounded time the web app would produce.
  // Shared with lib/quick-add.js so the "due today" default rounds to the same
  // hour as a date the user types explicitly (e.g. "today").
  function calculateNearestHours(currentDate = new Date()) {
    const hours = currentDate.getHours();
    const minutes = currentDate.getMinutes();
    const isBeforeOrAt = (breakpoint) =>
      hours < breakpoint || (hours === breakpoint && minutes === 0);

    if (isBeforeOrAt(9) || hours > 21) return 9;
    if (isBeforeOrAt(12)) return 12;
    if (isBeforeOrAt(15)) return 15;
    if (isBeforeOrAt(18)) return 18;
    if (isBeforeOrAt(21)) return 21;
    return 9;
  }

  function dueTodayISO(now = new Date()) {
    const date = new Date(now);
    date.setHours(calculateNearestHours(date), 0, 0, 0);
    return date.toISOString();
  }

  function getActiveTab() {
    return api.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => tabs && tabs[0])
      .catch(() => null);
  }

  function buildCaptureUrl(content = {}) {
    const params = new URLSearchParams();
    if (content.title) params.set('title', content.title);
    if (content.description) params.set('description', content.description);
    if (content.url) params.set('url', content.url);
    return api.runtime.getURL(`capture/capture.html?${params.toString()}`);
  }

  function openCapture(content = {}) {
    return api.windows.create({
      url: buildCaptureUrl(content),
      type: 'popup',
      width: 560,
      height: 520,
      focused: true,
    });
  }

  globalThis.VikunjaLib = {
    api,
    normalizeBaseUrl,
    getConfig,
    getPrefs,
    hostPermissionPatterns,
    hasHostPermissions,
    requestHostPermissions,
    request,
    listProjects,
    listTasks,
    listProjectViews,
    createTask,
    completeTask,
    getCurrentUser,
    getQuickAddMagicMode,
    listLabels,
    createLabel,
    addLabelToTask,
    addAssigneeToTask,
    searchProjectUsers,
    buildTaskContent,
    calculateNearestHours,
    dueTodayISO,
    getActiveTab,
    buildCaptureUrl,
    openCapture,
  };
})();
