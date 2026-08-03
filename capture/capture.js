(() => {
  'use strict';

  const {
    api,
    getConfig,
    getPrefs,
    listProjects,
    createTask,
    dueTodayISO,
    hostPermissionPatterns,
    hasHostPermissions,
    requestHostPermissions,
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
  const grantAccessBtn = document.getElementById('grant-access');

  const params = new URLSearchParams(location.search);
  const initial = {
    title: params.get('title') || '',
    description: params.get('description') || '',
    url: params.get('url') || '',
  };

  let baseUrl = '';

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
    const config = await getConfig();
    baseUrl = config.baseUrl;
    if (!baseUrl) {
      configMsg.textContent = 'Vikunja is not configured yet.';
      configPrompt.hidden = false;
      return;
    }
    const hostPatterns = hostPermissionPatterns(config);
    if (!await hasHostPermissions(hostPatterns)) {
      configMsg.textContent = 'Vikunja is configured, but access to your Vikunja server is not granted yet.';
      grantAccessBtn.hidden = false;
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
      if (!await hasHostPermissions(hostPatterns)) {
        configMsg.textContent = 'Looks like we lost permissions to access your Vikunja. You can grant access below.';
        grantAccessBtn.hidden = false;
      } else {
        configMsg.textContent = `Could not load projects: ${e.message}`;
      }
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
      const created = await createTask(projectSelect.value, body);
      uiShowToast(toastEl, 'Task added.', {
        link: { id: created.id, href: `${baseUrl}/tasks/${created.id}` },
      });
      setTimeout(() => window.close(), 4000);
    } catch (err) {
      setError(err.message);
    } finally {
      addBtn.disabled = false;
    }
  }

  openSettingsBtn.addEventListener('click', () => uiOpenOptions(api));
  grantAccessBtn.addEventListener('click', async () => {
    grantAccessBtn.disabled = true;
    try {
      const config = await getConfig();
      if (await requestHostPermissions(hostPermissionPatterns(config))) {
        init();
      } else {
        configMsg.textContent = 'Access to your Vikunja server was not granted. You can try again or open the settings.';
      }
    } finally {
      grantAccessBtn.disabled = false;
    }
  });
  cancelBtn.addEventListener('click', () => window.close());
  captureForm.addEventListener('submit', submit);
  titleInput.addEventListener('input', () => setError(''));

  init();
})();
