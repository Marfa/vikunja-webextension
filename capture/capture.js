(() => {
  'use strict';

  const {
    api,
    getConfig,
    getPrefs,
    listProjects,
    createTask,
    dueTodayISO,
  } = window.VikunjaLib;
  const { openOptions: uiOpenOptions, showToast: uiShowToast, fillProjectSelect: uiFillProjectSelect } = window.UiLib;

  const configPrompt = document.getElementById('config-prompt');
  const configMsg = document.getElementById('config-msg');
  const captureForm = document.getElementById('capture-form');
  const titleInput = document.getElementById('title');
  const projectSelect = document.getElementById('project');
  const dueTodayInput = document.getElementById('due-today');
  const descriptionInput = document.getElementById('description');
  const addBtn = document.getElementById('add');
  const cancelBtn = document.getElementById('cancel');
  const errorEl = document.getElementById('error');
  const toastEl = document.getElementById('toast');
  const openSettingsBtn = document.getElementById('open-settings');

  const params = new URLSearchParams(location.search);
  const initial = {
    title: params.get('title') || '',
    description: params.get('description') || '',
    url: params.get('url') || '',
  };

  function setError(message) {
    errorEl.textContent = message || '';
    errorEl.hidden = !message;
  }

  function fillProjects(projects, selectedId) {
    uiFillProjectSelect(projectSelect, projects, {
      selectedId,
      placeholder: 'Select a project',
      fallbackToFirst: true,
    });
  }

  async function init() {
    const { baseUrl } = await getConfig();
    if (!baseUrl) {
      configMsg.textContent = 'Vikunja is not configured yet.';
      configPrompt.hidden = false;
      return;
    }
    titleInput.value = initial.title;
    descriptionInput.value = initial.description;
    try {
      const [projects, prefs] = await Promise.all([listProjects(), getPrefs()]);
      if (!projects.length) {
        throw new Error('No projects found — create one in Vikunja first.');
      }
      fillProjects(projects, prefs.defaultProjectId);
      dueTodayInput.checked = prefs.dueToday;
      captureForm.hidden = false;
      titleInput.focus();
      titleInput.select();
    } catch (e) {
      configMsg.textContent = `Could not load projects: ${e.message}`;
      configPrompt.hidden = false;
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
      if (dueTodayInput.checked) {
        body.due_date = dueTodayISO();
      }
      await createTask(projectSelect.value, body);
      uiShowToast(toastEl, 'Task added to Vikunja.');
      setTimeout(() => window.close(), 1200);
    } catch (err) {
      setError(err.message);
    } finally {
      addBtn.disabled = false;
    }
  }

  openSettingsBtn.addEventListener('click', () => uiOpenOptions(api));
  cancelBtn.addEventListener('click', () => window.close());
  captureForm.addEventListener('submit', submit);
  titleInput.addEventListener('input', () => setError(''));

  init();
})();
