(() => {
  'use strict';

  const {
    api,
    getConfig,
    getPrefs,
    listProjects,
    listTasks,
    createTask,
    completeTask,
    getQuickAddMagicMode,
    searchProjectUsers,
    listLabels,
    createLabel,
    addLabelToTask,
    buildTaskContent,
    getActiveTab,
    openCapture,
    dueTodayISO,
  } = window.VikunjaLib;

  const { parseTaskText, PrefixMode, PREFIXES, cleanupItemText } = window.QuickAdd;
  const { openOptions: uiOpenOptions, showToast: uiShowToast, fillProjectSelect: uiFillProjectSelect } = window.UiLib;

  const configPrompt = document.getElementById('config-prompt');
  const loading = document.getElementById('loading');
  const list = document.getElementById('list');
  const searchInput = document.getElementById('search');
  const quickForm = document.getElementById('quick-add');
  const quickTitle = document.getElementById('quick-title');
  const quickProject = document.getElementById('quick-project');
  const quickAddBtn = document.getElementById('quick-add-btn');
  const quickError = document.getElementById('quick-error');
  const addSiteBtn = document.getElementById('add-site');
  const taskList = document.getElementById('task-list');
  const taskEmpty = document.getElementById('task-empty');
  const toastEl = document.getElementById('toast');
  const logo = document.getElementById('logo');
  const openSettingsBtn = document.getElementById('open-settings');
  const goSettingsBtn = document.getElementById('go-settings');

  const SVG_NS = 'http://www.w3.org/2000/svg';

  let baseUrl = '';
  let projectsById = new Map();
  let prefs = { defaultProjectId: null, dueToday: false, customFilter: '' };
  let tasks = [];
  let quickAddMode = PrefixMode.Default;

  function showView(view) {
    [configPrompt, loading, list].forEach((v) => {
      v.hidden = v !== view;
    });
  }

  function setQuickError(message) {
    quickError.textContent = message || '';
    quickError.hidden = !message;
  }

  async function restoreProject() {
    let selected = prefs.defaultProjectId;
    if (!selected) {
      const { lastProjectId } = await api.storage.local.get({ lastProjectId: null });
      selected = lastProjectId;
    }
    uiFillProjectSelect(quickProject, [...projectsById.values()], {
      selectedId: selected,
      placeholder: 'Project',
      fallbackToFirst: true,
    });
  }

  function hasDueDate(dateStr) {
    if (!dateStr) return false;
    const due = new Date(dateStr);
    if (isNaN(due.getTime())) return false;
    if (due.getFullYear() < 1000) return false;
    return true;
  }

  function formatDue(dateStr) {
    if (!hasDueDate(dateStr)) return '';
    const due = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setDate(end.getDate() + 1);
    const dueDay = new Date(due.getTime());
    dueDay.setHours(0, 0, 0, 0);
    if (dueDay >= today && dueDay < end) return 'Today';
    return due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // Vikunja-style checkbox: a visually hidden input + a drawn rounded-square
  // SVG (mirrors the frontend's FancyCheckbox/checkbox.svg).
  function makeCheckbox(task, onChange) {
    const label = document.createElement('label');
    label.className = 'task-check';
    label.title = task.done ? 'Mark as not done' : 'Mark as done';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(task.done);
    input.addEventListener('change', () => onChange(input));

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 18 18');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute(
      'd',
      'M1,9 L1,3.5 C1,2 2,1 3.5,1 L14.5,1 C16,1 17,2 17,3.5 L17,14.5 C17,16 16,17 14.5,17 L3.5,17 C2,17 1,16 1,14.5 L1,9 Z'
    );
    const polyline = document.createElementNS(SVG_NS, 'polyline');
    polyline.setAttribute('points', '1 9 7 14 15 4');
    svg.appendChild(path);
    svg.appendChild(polyline);

    label.appendChild(input);
    label.appendChild(svg);
    return label;
  }

  function renderTasks() {
    taskList.textContent = '';
    const query = searchInput.value.trim().toLowerCase();
    const visible = query
      ? tasks.filter((t) => {
          const hay = `${t.title || ''} ${t.description || ''}`.toLowerCase();
          return hay.includes(query);
        })
      : tasks;
    taskEmpty.hidden = visible.length > 0;
    taskEmpty.textContent = query ? 'No matching tasks.' : 'No tasks here yet.';

    const now = Date.now();
    const showProject = !prefs.defaultProjectId;
    visible.forEach((task) => {
      const li = document.createElement('li');
      li.className = 'task';
      if (task.done) {
        li.classList.add('done');
      }

      li.appendChild(makeCheckbox(task, (input) => toggleTask(task, input)));

      const body = document.createElement('div');
      body.className = 'task-body';

      const top = document.createElement('div');
      top.className = 'task-top';

      const title = document.createElement('span');
      title.className = 'task-title';
      title.textContent = task.title || 'Untitled';
      title.title = task.title || 'Untitled';
      title.addEventListener('click', () => {
        window.open(`${baseUrl}/tasks/${task.id}`, '_blank');
      });
      top.appendChild(title);

      if (showProject && projectsById.has(task.project_id)) {
        const project = document.createElement('span');
        project.className = 'task-project';
        project.textContent = projectsById.get(task.project_id).title;
        project.title = project.textContent;
        top.appendChild(project);
      }
      body.appendChild(top);

      const meta = document.createElement('div');
      meta.className = 'task-meta';

      const due = formatDue(task.due_date);
      if (due) {
        const dueEl = document.createElement('span');
        dueEl.className = 'task-due';
        if (!task.done && new Date(task.due_date).getTime() < now) {
          dueEl.classList.add('overdue');
          dueEl.textContent = 'Overdue';
        } else if (due === 'Today') {
          dueEl.classList.add('today');
          dueEl.textContent = 'Today';
        } else {
          dueEl.textContent = due;
        }
        meta.appendChild(dueEl);
      }

      (Array.isArray(task.labels) ? task.labels : []).forEach((label) => {
        const tag = document.createElement('span');
        tag.className = 'task-tag';
        tag.textContent = label.title || 'tag';
        tag.title = tag.textContent;
        if (label.hex_color) {
          tag.style.background = `#${label.hex_color}26`;
          tag.style.color = `#${label.hex_color}`;
        }
        meta.appendChild(tag);
      });

      if (meta.childNodes.length) {
        body.appendChild(meta);
      }

      li.appendChild(body);
      taskList.appendChild(li);
    });
  }

  async function loadTasks() {
    const opts = { filter: prefs.customFilter || 'done = false' };
    if (prefs.defaultProjectId) {
      opts.projectId = prefs.defaultProjectId;
    }
    return listTasks(opts);
  }

  async function load() {
    const config = await getConfig();
    baseUrl = config.baseUrl;
    if (!baseUrl) {
      showView(configPrompt);
      return;
    }
    showView(loading);
    try {
      const [projects, t, p, mode] = await Promise.all([
        listProjects(),
        loadTasks(),
        getPrefs(),
        getQuickAddMagicMode().catch(() => PrefixMode.Default),
      ]);
      prefs = p;
      quickAddMode = mode;
      projectsById = new Map(projects.map((pr) => [pr.id, pr]));
      tasks = t;
      await restoreProject();
      renderTasks();
      showView(list);
      quickTitle.focus();
    } catch (e) {
      configPrompt.querySelector('.empty').textContent =
        `Could not load tasks: ${e.message}`;
      showView(configPrompt);
    }
  }

  async function toggleTask(task, input) {
    input.disabled = true;
    const next = input.checked;
    try {
      await completeTask(task.id, next);
      task.done = next;
      uiShowToast(toastEl, next ? 'Task completed.' : 'Task reopened.');
      renderTasks();
    } catch (e) {
      input.checked = !next;
      uiShowToast(toastEl, `Could not update task: ${e.message}`);
    } finally {
      input.disabled = false;
    }
  }

  function resolveProject(parsedProject) {
    if (parsedProject) {
      const exact = [...projectsById.values()].find(
        (p) => p.title.toLowerCase() === parsedProject.toLowerCase()
      );
      if (exact) return exact.id;
      const byIdentifier = [...projectsById.values()].find(
        (p) =>
          p.identifier && p.identifier.toLowerCase() === parsedProject.toLowerCase()
      );
      if (byIdentifier) return byIdentifier.id;
    }
    return quickProject.value ? Number(quickProject.value) : null;
  }

  // Mirrors the frontend's validateUser: with a single search result use a
  // fuzzy match, otherwise an exact match, against username/name/email.
  function matchProjectUser(users, query) {
    const match = (fuzzy) => {
      for (const key of ['username', 'name', 'email']) {
        const found = users.find((u) => {
          const value = u && u[key];
          if (value === undefined || value === null) return false;
          const hay = String(value).toLowerCase();
          const needle = String(query).toLowerCase();
          return fuzzy ? hay.includes(needle) : hay === needle;
        });
        if (found) return found;
      }
      return undefined;
    };
    return users.length === 1 ? match(true) : match(false);
  }

  async function findAssignees(parsedAssignees, projectId) {
    if (!Array.isArray(parsedAssignees) || parsedAssignees.length === 0) {
      return [];
    }
    const results = [];
    for (const a of parsedAssignees) {
      try {
        const users = await searchProjectUsers(projectId, a);
        const matched = matchProjectUser(users, a);
        if (matched) {
          results.push({ id: matched.id, match: a });
        }
      } catch (e) {
        // Ignore assignee lookup failures; the @mention stays in the title.
      }
    }
    return results;
  }

  async function addLabelsToTask(taskId, parsedLabels) {
    if (!Array.isArray(parsedLabels) || parsedLabels.length === 0) {
      return;
    }
    const uniqueLabels = Array.from(new Set(parsedLabels));
    const existing = await listLabels();
    for (const title of uniqueLabels) {
      let label = existing.find(
        (l) => l.title && l.title.toLowerCase() === title.toLowerCase()
      );
      if (!label) {
        try {
          label = await createLabel({ title, hexColor: randomLabelColor() });
        } catch (e) {
          // Token may lack label permissions; skip instead of failing the add.
          continue;
        }
      }
      if (label && label.id) {
        try {
          await addLabelToTask(taskId, label.id);
        } catch (e) {
          // Skip if attaching failed (e.g. missing tasks_labels permission).
        }
      }
    }
  }

  function randomLabelColor() {
    const colors = [
      '#ffbe0b', '#fd8a09', '#fb5607', '#ff006e', '#efbdeb', '#8338ec',
      '#5f5ff6', '#3a86ff', '#4c91ff', '#0ead69', '#25be8b', '#073b4c', '#373f47',
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  async function quickAdd(e) {
    e.preventDefault();
    const rawTitle = quickTitle.value.trim();
    if (!rawTitle) {
      setQuickError('Please enter a task title.');
      quickTitle.focus();
      return;
    }
    setQuickError('');
    quickAddBtn.disabled = true;
    try {
      const parsed = parseTaskText(rawTitle, quickAddMode);

      // If the whole input was magic, the frontend creates the task with the
      // raw title instead (no intents to act on).
      if (parsed.text === '') {
        await createTask(quickProject.value, { title: rawTitle });
        uiShowToast(toastEl, 'Task added.');
        quickTitle.value = '';
        renderTasks();
        quickTitle.focus();
        return;
      }

      const projectId = resolveProject(parsed.project);
      if (!projectId) {
        setQuickError('Please select a project.');
        quickProject.focus();
        return;
      }

      const assignees = await findAssignees(parsed.assignees, projectId);

      // Only clean up those assignees from the task title which actually exist
      let cleanedTitle = parsed.text;
      if (assignees.length > 0) {
        const assigneePrefix = PREFIXES[quickAddMode]?.assignee;
        if (assigneePrefix) {
          cleanedTitle = cleanupItemText(
            cleanedTitle,
            assignees.map((a) => a.match),
            assigneePrefix
          );
        }
      }

      const body = { title: cleanedTitle, project_id: projectId };
      if (parsed.date !== null) {
        body.due_date = new Date(parsed.date).toISOString();
      } else if (prefs.dueToday) {
        body.due_date = dueTodayISO();
      }
      if (parsed.priority !== null) {
        body.priority = parsed.priority;
      }
      if (Array.isArray(parsed.assignees) && parsed.assignees.length > 0) {
        body.assignees = assignees.map((a) => ({ id: a.id }));
      }
      if (parsed.repeats !== null) {
        body.repeat_after = { amount: parsed.repeats.amount, type: parsed.repeats.type };
        if (parsed.repeats.type === 'months' && parsed.repeats.amount === 1) {
          body.repeat_mode = 1;
        }
      }

      const created = await createTask(projectId, body);
      await addLabelsToTask(created.id, parsed.labels);
      tasks.push(created);
      uiShowToast(toastEl, 'Task added.');
      quickTitle.value = '';
      await api.storage.local.set({ lastProjectId: projectId });
      renderTasks();
      quickTitle.focus();
    } catch (err) {
      setQuickError(err.message);
    } finally {
      quickAddBtn.disabled = false;
    }
  }

  async function addCurrentSite() {
    addSiteBtn.disabled = true;
    try {
      const tab = await getActiveTab();
      const content = buildTaskContent({}, tab || {});
      await openCapture(content);
    } catch (err) {
      uiShowToast(toastEl, `Could not open capture: ${err.message}`);
    } finally {
      addSiteBtn.disabled = false;
    }
  }

  openSettingsBtn.addEventListener('click', () => uiOpenOptions(api));
  goSettingsBtn.addEventListener('click', () => uiOpenOptions(api));
  function openVikunja() {
    if (baseUrl) {
      window.open(baseUrl, '_blank');
    }
  }
  logo.addEventListener('click', openVikunja);
  logo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openVikunja();
    }
  });
  addSiteBtn.addEventListener('click', addCurrentSite);
  quickForm.addEventListener('submit', quickAdd);
  quickTitle.addEventListener('input', () => setQuickError(''));
  searchInput.addEventListener('input', renderTasks);

  load();
})();
