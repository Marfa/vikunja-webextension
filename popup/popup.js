(() => {
  'use strict';

  const { api, getConfig, listProjects, createTask } = window.VikunjaLib;

  const configPrompt = document.getElementById('config-prompt');
  const loading = document.getElementById('loading');
  const taskForm = document.getElementById('task-form');
  const done = document.getElementById('done');
  const titleInput = document.getElementById('title');
  const descriptionInput = document.getElementById('description');
  const projectSelect = document.getElementById('project');
  const addBtn = document.getElementById('add');
  const errorEl = document.getElementById('error');
  const doneMsg = document.getElementById('done-msg');
  const openSettingsBtn = document.getElementById('open-settings');
  const goSettingsBtn = document.getElementById('go-settings');
  const addAnotherBtn = document.getElementById('add-another');
  const openVikunjaBtn = document.getElementById('open-vikunja');

  function showView(view) {
    [configPrompt, loading, taskForm, done].forEach((v) => {
      v.hidden = v !== view;
    });
  }

  function setError(message) {
    errorEl.textContent = message || '';
    errorEl.hidden = !message;
  }

  function openOptions() {
    if (api.runtime && api.runtime.openOptionsPage) {
      api.runtime.openOptionsPage();
    } else {
      window.open(api.runtime.getURL('options/options.html'));
    }
  }

  function fillProjects(projects) {
    projectSelect.textContent = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a project';
    placeholder.disabled = true;
    placeholder.selected = true;
    projectSelect.appendChild(placeholder);
    projects.forEach((p) => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.title;
      projectSelect.appendChild(option);
    });
  }

  async function rememberProject() {
    if (!projectSelect.value) return;
    await api.storage.local.set({ lastProjectId: Number(projectSelect.value) });
  }

  async function restoreProject() {
    const { lastProjectId } = await api.storage.local.get({ lastProjectId: null });
    if (lastProjectId && [...projectSelect.options].some((o) => o.value === String(lastProjectId))) {
      projectSelect.value = String(lastProjectId);
    }
  }

  async function load() {
    const { baseUrl } = await getConfig();
    if (!baseUrl) {
      showView(configPrompt);
      return;
    }
    showView(loading);
    try {
      const projects = await listProjects();
      if (!projects.length) {
        throw new Error('No projects found — create one in Vikunja first.');
      }
      fillProjects(projects);
      await restoreProject();
      showView(taskForm);
      titleInput.focus();
    } catch (e) {
      showView(configPrompt);
      configPrompt.querySelector('.empty').textContent =
        `Could not load projects: ${e.message}`;
    }
  }

  async function submit(e) {
    e.preventDefault();
    const title = titleInput.value.trim();
    if (!title) {
      setError('Please enter a task title.');
      titleInput.focus();
      return;
    }
    if (!projectSelect.value) {
      setError('Please select a project.');
      projectSelect.focus();
      return;
    }
    setError('');
    addBtn.disabled = true;
    try {
      const body = { title };
      const description = descriptionInput.value.trim();
      if (description) {
        body.description = description;
      }
      const task = await createTask(projectSelect.value, body);
      await rememberProject();
      const { baseUrl } = await getConfig();
      doneMsg.textContent = task && task.title
        ? `Task "${task.title}" created.`
        : 'Task created.';
      openVikunjaBtn.onclick = () => {
        window.open(baseUrl, '_blank');
      };
      showView(done);
    } catch (e) {
      setError(e.message);
    } finally {
      addBtn.disabled = false;
    }
  }

  openSettingsBtn.addEventListener('click', openOptions);
  goSettingsBtn.addEventListener('click', openOptions);
  addAnotherBtn.addEventListener('click', () => {
    titleInput.value = '';
    descriptionInput.value = '';
    showView(taskForm);
    titleInput.focus();
  });

  taskForm.addEventListener('submit', submit);
  titleInput.addEventListener('input', () => setError(''));

  load();
})();
