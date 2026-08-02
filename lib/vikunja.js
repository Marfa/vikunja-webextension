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

  function apiError(url, status, body) {
    const msg = (body && body.message) ? body.message : `Request failed with status ${status}`;
    const err = new Error(msg);
    err.status = status;
    err.url = url;
    return err;
  }

  async function rawRequest(path, { method = 'GET', body, token, baseUrl } = {}) {
    const url = `${baseUrl}/api/v1/${path}`;
    const headers = { Accept: 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
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
    if (data && Array.isArray(data.projects)) {
      return data.projects;
    }
    if (data && Array.isArray(data.result)) {
      return data.result;
    }
    return [];
  }

  async function listProjects() {
    const { baseUrl, token } = await getConfig();
    if (!baseUrl || !token) {
      throw new Error('Vikunja is not configured yet.');
    }
    const projects = [];
    let page = 1;
    let totalPages = 1;
    do {
      const { data, headers } = await rawRequest(`projects?page=${page}&per_page=50`, {
        token,
        baseUrl,
      });
      projects.push(...parseItems(data));
      const headerPages = headers.get('x-pagination-total-pages');
      if (headerPages !== null) {
        totalPages = parseInt(headerPages, 10) || 1;
      }
      page += 1;
    } while (page <= totalPages && page <= 50);
    return projects;
  }

  async function createTask(projectId, task) {
    const { baseUrl, token } = await getConfig();
    if (!baseUrl || !token) {
      throw new Error('Vikunja is not configured yet.');
    }
    return request(`projects/${projectId}/tasks`, {
      method: 'PUT',
      body: task,
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

  window.VikunjaLib = {
    api,
    normalizeBaseUrl,
    getConfig,
    request,
    listProjects,
    createTask,
    getCurrentUser,
  };
})();
