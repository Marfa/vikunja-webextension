(() => {
  'use strict';

  const {
    api,
    getConfig,
    getPrefs,
    listProjects,
    listTasks,
    listProjectViews,
    createTask,
    completeTask,
    getQuickAddMagicMode,
    searchProjectUsers,
    listLabels,
    createLabel,
    addLabelToTask,
    addAssigneeToTask,
    buildTaskContent,
    getActiveTab,
    openCapture,
    dueTodayISO,
    hostPermissionPatterns,
    hasHostPermissions,
    requestHostPermissions,
  } = window.VikunjaLib;

  const { parseTaskText, PrefixMode, PREFIXES, cleanupItemText, analyzeTaskText, removeSpan, repeatTaskFields } = window.QuickAdd;
  const { openOptions: uiOpenOptions, showToast: uiShowToast } = window.UiLib;

  const configPrompt = document.getElementById('config-prompt');
  const loading = document.getElementById('loading');
  const list = document.getElementById('list');
  const searchInput = document.getElementById('search');
  const quickForm = document.getElementById('quick-add');
  const quickTitle = document.getElementById('quick-title');
  const quickChips = document.getElementById('quick-chips');
  const quickAddBtn = document.getElementById('quick-add-btn');
  const quickError = document.getElementById('quick-error');
  const sortBtn = document.getElementById('sort-btn');
  const sortMenu = document.getElementById('sort-menu');
  const addSiteBtn = document.getElementById('add-site');
  const taskList = document.getElementById('task-list');
  const taskEmpty = document.getElementById('task-empty');
  const toastEl = document.getElementById('toast');
  const logo = document.getElementById('logo');
  const openSettingsBtn = document.getElementById('open-settings');
  const goSettingsBtn = document.getElementById('go-settings');
  const grantAccessBtn = document.getElementById('grant-access');

  const SVG_NS = 'http://www.w3.org/2000/svg';

  let baseUrl = '';
  let hostPatterns = [];
  let projectsById = new Map();
  let prefs = { defaultProjectId: null, dueToday: false, customFilter: '' };
  let tasks = [];
  let quickAddMode = PrefixMode.Default;
  let currentProjectId = null;
  let labelOptions = null;
  const usersByProject = new Map();
  let currentSort = { mode: 'created', orderBy: 'desc' };
  let projectViews = null;

  const SORT_MODES = {
    position: { label: 'Manually sorted', sortBy: 'position', orderBy: 'asc', needsView: true },
    title: { label: 'Title', sortBy: 'title', orderBy: 'asc' },
    created: { label: 'Created', sortBy: 'created', orderBy: 'desc' },
    updated: { label: 'Updated', sortBy: 'updated', orderBy: 'desc' },
    due_date: { label: 'Due date', sortBy: 'due_date', orderBy: 'asc' },
    priority: { label: 'Priority', sortBy: 'priority', orderBy: 'desc' },
  };

  const PLACEHOLDERS = {
    [PrefixMode.Default]: 'Add a task: +Project *label !1 @user tomorrow',
    [PrefixMode.Todoist]: 'Add a task: #Project @label !1 +user tomorrow',
    [PrefixMode.Disabled]: 'Add a task…',
  };

  const DATE_PRESETS = ['today', 'tomorrow', 'in 2 days', 'in 3 days', 'in 1 week', 'next monday', 'next week'];
  const REPEAT_PRESETS = ['every day', 'every 2 days', 'every week', 'every 2 weeks', 'every month'];

  function showView(view) {
    [configPrompt, loading, list].forEach((v) => {
      v.hidden = v !== view;
    });
    // If we are in the config stage, also disable the top bar
    searchInput.hidden = view === configPrompt;
    sortBtn.hidden = view === configPrompt;
    addSiteBtn.hidden = view === configPrompt;
    openSettingsBtn.hidden = view === configPrompt;
  }

  function setQuickError(message) {
    quickError.textContent = message || '';
    quickError.hidden = !message;
  }

  function autosize() {
    const el = quickTitle;
    el.style.height = 'auto';
    if (typeof el.scrollHeight === 'number') {
      el.style.height = Math.min(el.scrollHeight, 92) + 'px';
    }
  }

  function afterTokenChange() {
    renderChips();
    autosize();
    quickTitle.focus();
  }

  // Writes `newToken` into the input, replacing an existing token of the same
  // type when one is present (project/priority/date/repeat). The text stays the
  // single source of truth; parseTaskText computes everything at submit.
  function setToken(analyzed, type, newToken) {
    const span =
      type === 'project'
        ? analyzed.project
        : type === 'priority'
          ? analyzed.priority
          : type === 'date'
            ? analyzed.date
            : analyzed.repeats;
    let text = quickTitle.value;
    if (span !== null) {
      const hadTrailingSpace = /\s$/.test(text.slice(span.start, span.end));
      text = removeSpan(text, span.start, span.end);
      const sepBefore = span.start > 0 && text[span.start - 1] !== ' ' ? ' ' : '';
      const sepAfter = hadTrailingSpace ? ' ' : '';
      text = text.slice(0, span.start) + sepBefore + newToken + sepAfter + text.slice(span.start);
    } else {
      const sep = text === '' || /\s$/.test(text) ? '' : ' ';
      text = text + sep + newToken;
    }
    quickTitle.value = text;
  }

  function appendToken(newToken) {
    const text = quickTitle.value;
    const sep = text === '' || /\s$/.test(text) ? '' : ' ';
    quickTitle.value = text + sep + newToken;
  }

  function makeChip(type) {
    const sel = document.createElement('select');
    sel.className = `chip chip-select${type ? ` chip--${type}` : ''}`;
    quickChips.appendChild(sel);
    return sel;
  }

  // Sizes a chip select to its currently displayed text (not its widest
  // option), so the pill hugs the label. No-op without a real layout (e.g. the
  // smoke-test fake DOM).
  function sizeSelectToContent(sel) {
    if (!document.body || typeof document.body.appendChild !== 'function') return;
    const probe = document.createElement('span');
    probe.style.cssText =
      'position:absolute;visibility:hidden;white-space:nowrap;' +
      'font:600 0.75rem system-ui,sans-serif;' +
      'padding-left:0.4rem;padding-right:1.05rem;border:1px solid transparent;';
    probe.textContent = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : '';
    document.body.appendChild(probe);
    const width = probe.offsetWidth;
    probe.remove();
    if (width > 0) sel.style.width = width + 'px';
  }

  function chipOption(value, text) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
    return opt;
  }

  function buildProjectChip(tokens) {
    const P = PREFIXES[quickAddMode];
    const projId = effectiveProjectId(tokens);
    const sel = makeChip('project');
    sel.title = 'Project';
    for (const p of projectsById.values()) {
      sel.appendChild(chipOption(String(p.id), P && P.project ? `${P.project}${p.title}` : p.title));
    }
    sel.value = String(projId);
    sel.addEventListener('change', (e) => {
      const id = Number((e.target && e.target.value) ?? sel.value);
      if (!projectsById.has(id) || id === projId) return;
      if (P && P.project) {
        setToken(tokens, 'project', P.project + projectsById.get(id).title);
      } else {
        currentProjectId = id;
      }
      afterTokenChange();
    });
  }

  function buildPriorityChip(tokens, P) {
    const has = tokens.priority !== null;
    const sel = makeChip(has ? 'priority' : '');
    sel.title = 'Priority';
    sel.appendChild(chipOption('', has ? tokens.priority.text : 'Priority'));
    for (let n = 1; n <= 5; n++) {
      sel.appendChild(chipOption(String(n), `${P.priority}${n}`));
    }
    sel.value = has ? tokens.priority.text.slice(P.priority.length) : '';
    sel.addEventListener('change', (e) => {
      const v = (e.target && e.target.value) ?? sel.value;
      if (!v) return;
      setToken(tokens, 'priority', P.priority + v);
      afterTokenChange();
    });
  }

  function buildLabelChip(tokens, P) {
    if (labelOptions === null) {
      labelOptions = [];
      listLabels()
        .then((labels) => {
          labelOptions = labels || [];
          renderChips();
        })
        .catch(() => {
          labelOptions = [];
        });
    }
    const names = tokens.labels.map((l) => l.text);
    const sel = makeChip(names.length > 0 ? 'label' : '');
    sel.title = 'Label';
    sel.appendChild(chipOption('', names.length > 0 ? `Labels · ${names.length}` : 'Label'));
    for (const lb of labelOptions) {
      sel.appendChild(chipOption(String(lb.id), P.label + (lb.title || lb.name || lb.id)));
    }
    sel.value = '';
    sel.addEventListener('change', (e) => {
      const v = (e.target && e.target.value) ?? sel.value;
      const lb = labelOptions.find((x) => String(x.id) === String(v));
      if (!lb) return;
      const token = P.label + (lb.title || lb.name || lb.id);
      if (names.includes(token)) return;
      appendToken(token);
      afterTokenChange();
    });
  }

  function buildAssigneeChip(tokens, P) {
    const projId = effectiveProjectId(tokens);
    let users;
    if (!usersByProject.has(projId)) {
      usersByProject.set(projId, null);
      searchProjectUsers(projId, '')
        .then((list) => {
          usersByProject.set(projId, list || []);
          renderChips();
        })
        .catch(() => {
          usersByProject.set(projId, []);
        });
      users = null;
    } else {
      users = usersByProject.get(projId);
    }
    const tokensUsed = tokens.assignees.map((a) => a.text);
    const sel = makeChip(tokensUsed.length > 0 ? 'assignee' : '');
    sel.title = 'Assignee';
    sel.appendChild(
      chipOption(
        '',
        tokensUsed.length > 0 ? `Assignees · ${tokensUsed.length}` : users === null ? 'Assignees…' : 'Assignee',
      ),
    );
    if (users !== null) {
      for (const u of users) {
        const name = u.username || u.name || u.email;
        if (!name) continue;
        sel.appendChild(chipOption(String(u.id), P.assignee + name));
      }
      sel.disabled = users.length === 0;
    } else {
      sel.disabled = true;
    }
    sel.value = '';
    sel.addEventListener('change', (e) => {
      const v = (e.target && e.target.value) ?? sel.value;
      const u = (users || []).find((x) => String(x.id) === String(v));
      if (!u) return;
      const token = P.assignee + (u.username || u.name || u.email);
      if (tokensUsed.includes(token)) return;
      appendToken(token);
      afterTokenChange();
    });
  }

  function buildDateChip(tokens) {
    const has = tokens.date !== null;
    const sel = makeChip(has || prefs.dueToday ? 'date' : '');
    sel.title = 'Due Date';
    const placeholder = has ? tokens.date.text : prefs.dueToday ? 'today' : 'Due';
    sel.appendChild(chipOption('', placeholder));
    for (const preset of DATE_PRESETS) {
      // The placeholder already shows the current value (or the dueToday
      // default "today"); don't repeat it as a selectable preset.
      if (preset.toLowerCase() === placeholder.toLowerCase()) continue;
      sel.appendChild(chipOption(preset, preset));
    }
    sel.value = '';
    sel.addEventListener('change', (e) => {
      const v = (e.target && e.target.value) ?? sel.value;
      if (!v) return;
      setToken(tokens, 'date', v);
      afterTokenChange();
    });
  }

  function buildRepeatChip(tokens) {
    const has = tokens.repeats !== null;
    const sel = makeChip(has ? 'repeat' : '');
    sel.title = 'Repeat';
    sel.appendChild(chipOption('', has ? tokens.repeats.text : 'Repeat'));
    for (const preset of REPEAT_PRESETS) {
      sel.appendChild(chipOption(preset, preset));
    }
    sel.value = '';
    sel.addEventListener('change', (e) => {
      const v = (e.target && e.target.value) ?? sel.value;
      if (!v) return;
      setToken(tokens, 'repeat', v);
      afterTokenChange();
    });
  }

  function renderChips() {
    quickChips.textContent = '';
    const hasText = Boolean(quickTitle.value.trim());
    if (!hasText) {
      quickChips.classList.remove('show');
      quickAddBtn.classList.remove('show');
      return;
    }
    const tokens = analyzeTaskText(quickTitle.value, quickAddMode);
    buildProjectChip(tokens);
    const P = PREFIXES[quickAddMode];
    if (P) {
      buildPriorityChip(tokens, P);
      buildLabelChip(tokens, P);
      buildAssigneeChip(tokens, P);
      buildDateChip(tokens);
      buildRepeatChip(tokens);
    }
    quickChips.childNodes.forEach(sizeSelectToContent);
    quickChips.classList.add('show');
    quickAddBtn.classList.add('show');
  }

  async function resolveCurrentProject() {
    let id = prefs.defaultProjectId;
    if (!id) {
      const { lastProjectId } = await api.storage.local.get({ lastProjectId: null });
      id = lastProjectId;
    }
    if (id && projectsById.has(id)) {
      currentProjectId = id;
    } else {
      currentProjectId = projectsById.size ? [...projectsById.keys()][0] : null;
    }
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
      'M1,9 L1,3.5 C1,2 2,1 3.5,1 L14.5,1 C16,1 17,2 17,3.5 L17,14.5 C17,16 16,17 14.5,17 L3.5,17 C2,17 1,16 1,14.5 L1,9 Z',
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
      li.setAttribute('data-task-id', task.id);
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

  // Resolve the sort to use: a remembered local choice wins over the options
  // default, but only when "remember last sort" is enabled.
  async function resolveSort() {
    let mode = prefs.sortBy && SORT_MODES[prefs.sortBy] ? prefs.sortBy : 'position';
    let orderBy = SORT_MODES[mode].orderBy;
    if (prefs.rememberLastSort) {
      try {
        const { lastSort } = await api.storage.local.get({ lastSort: null });
        if (lastSort && SORT_MODES[lastSort.mode]) {
          mode = lastSort.mode;
          orderBy = lastSort.orderBy === 'asc' || lastSort.orderBy === 'desc' ? lastSort.orderBy : SORT_MODES[mode].orderBy;
        }
      } catch (e) {
        // Ignore local-storage failures and use the default.
      }
    }
    currentSort = { mode, orderBy };
  }

  // Vikunja only orders by position through a project view, so manual sorting
  // needs a default project; otherwise fall back to newest first.
  function effectiveSortParams() {
    const mode = SORT_MODES[currentSort.mode];
    if (!mode.needsView) {
      return { sortBy: mode.sortBy, orderBy: currentSort.orderBy };
    }
    if (!prefs.defaultProjectId) {
      return { sortBy: 'created', orderBy: 'desc' };
    }
    return { sortBy: 'position', orderBy: currentSort.orderBy, needsView: true };
  }

  async function resolveManualView(projectId) {
    if (!projectId) return null;
    if (projectViews !== null) return projectViews;
    try {
      const views = await listProjectViews(projectId);
      const listView = views.find((v) => v.type === 'list') || views[0];
      projectViews = listView ? listView.id : null;
    } catch (e) {
      projectViews = null;
    }
    return projectViews;
  }

  async function loadTasks() {
    const opts = { filter: prefs.customFilter || 'done = false' };
    if (prefs.defaultProjectId) {
      opts.projectId = prefs.defaultProjectId;
    }
    const sort = effectiveSortParams();
    opts.sortBy = sort.sortBy;
    opts.orderBy = sort.orderBy;
    if (sort.needsView) {
      const viewId = await resolveManualView(prefs.defaultProjectId);
      if (viewId) {
        opts.viewId = viewId;
      } else {
        opts.sortBy = 'created';
        opts.orderBy = 'desc';
      }
    }
    return listTasks(opts);
  }

  async function refreshTasks() {
    tasks = await loadTasks();
    renderTasks();
  }

  // Adds a one-shot entrance animation to the row of the just-created task and
  // scrolls it into view if it landed outside the visible area.
  function flashNewTask(taskId) {
    const li = Array.from(taskList.childNodes).find(
      (c) =>
        typeof c.getAttribute === 'function' &&
        String(c.getAttribute('data-task-id')) === String(taskId),
    );
    if (!li) return;
    li.classList.add('task--new');
    if (typeof li.scrollIntoView === 'function') {
      li.scrollIntoView({ block: 'nearest' });
    }
  }

  function sortLabel() {
    const def = SORT_MODES[currentSort.mode];
    const dir = currentSort.orderBy === 'asc' ? 'ascending' : 'descending';
    return `Sort: ${def.label} (${dir})`;
  }

  function renderSortMenu() {
    sortMenu.textContent = '';
    for (const [key, def] of Object.entries(SORT_MODES)) {
      const li = document.createElement('li');
      li.textContent = def.label;
      if (currentSort.mode === key) {
        li.classList.add('active');
      }
      li.addEventListener('click', () => {
        return setSort(key, SORT_MODES[key].orderBy);
      });
      sortMenu.appendChild(li);
    }
    const divider = document.createElement('li');
    divider.className = 'menu-divider';
    sortMenu.appendChild(divider);
    const dir = document.createElement('li');
    dir.textContent = currentSort.orderBy === 'asc' ? 'Ascending \u25B2' : 'Descending \u25BC';
    dir.addEventListener('click', () => {
      return setSort(currentSort.mode, currentSort.orderBy === 'asc' ? 'desc' : 'asc');
    });
    sortMenu.appendChild(dir);
  }

  async function setSort(mode, orderBy) {
    if (currentSort.mode === mode && currentSort.orderBy === orderBy) {
      closeSortMenu();
      return;
    }
    currentSort = { mode, orderBy };
    if (prefs.rememberLastSort) {
      try {
        await api.storage.local.set({ lastSort: { mode, orderBy } });
      } catch (e) {
        // Ignore storage failures; the choice still applies for this session.
      }
    }
    sortBtn.title = sortLabel();
    sortBtn.setAttribute('aria-label', sortLabel());
    closeSortMenu();
    try {
      await refreshTasks();
    } catch (e) {
      uiShowToast(toastEl, `Could not reload tasks: ${e.message}`);
    }
  }

  function closeSortMenu() {
    sortMenu.hidden = true;
    sortBtn.setAttribute('aria-expanded', 'false');
  }

  function toggleSortMenu() {
    renderSortMenu();
    sortMenu.hidden = !sortMenu.hidden;
    sortBtn.setAttribute('aria-expanded', String(!sortMenu.hidden));
  }

  async function load() {
    const config = await getConfig();
    baseUrl = config.baseUrl;
    if (!baseUrl) {
      showView(configPrompt);
      return;
    }
    hostPatterns = hostPermissionPatterns(config);
    if (!await hasHostPermissions(hostPatterns)) {
      configPrompt.querySelector('.empty').textContent =
        'Vikunja is configured, but access to your Vikunja server is not granted yet.';
      grantAccessBtn.hidden = false;
      showView(configPrompt);
      return;
    }
    showView(loading);
    try {
      const [projects, p, mode] = await Promise.all([
        listProjects(),
        getPrefs(),
        getQuickAddMagicMode().catch(() => PrefixMode.Default),
      ]);
      prefs = p;
      quickAddMode = mode;
      projectsById = new Map(projects.map((pr) => [pr.id, pr]));
      quickTitle.placeholder = PLACEHOLDERS[quickAddMode] || 'Add a task…';
      await resolveCurrentProject();
      await resolveSort();
      sortBtn.title = sortLabel();
      sortBtn.setAttribute('aria-label', sortLabel());
      tasks = await loadTasks();
      renderTasks();
      renderChips();
      autosize();
      showView(list);
      quickTitle.focus();
    } catch (e) {
      if (!await hasHostPermissions(hostPatterns)) {
        configPrompt.querySelector('.empty').textContent =
          'Vikunja is configured, but access to your Vikunja server is not granted yet.';
        grantAccessBtn.hidden = false;
      } else {
        configPrompt.querySelector('.empty').textContent =
          `Could not load tasks: ${e.message}`;
      }
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

  function effectiveProjectId(tokens) {
    if (tokens.project) {
      const P = PREFIXES[quickAddMode];
      const name = P && P.project ? tokens.project.text.slice(P.project.length) : tokens.project.text;
      const resolved = resolveProject(name);
      if (resolved) return resolved;
    }
    return currentProjectId;
  }

  function resolveProject(parsedProject) {
    if (parsedProject) {
      const exact = [...projectsById.values()].find(
        (p) => p.title.toLowerCase() === parsedProject.toLowerCase(),
      );
      if (exact) return exact.id;
      const byIdentifier = [...projectsById.values()].find(
        (p) =>
          p.identifier && p.identifier.toLowerCase() === parsedProject.toLowerCase(),
      );
      if (byIdentifier) return byIdentifier.id;
    }
    return currentProjectId;
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
        (l) => l.title && l.title.toLowerCase() === title.toLowerCase(),
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
        if (!currentProjectId) {
          setQuickError('Please select a project.');
          quickTitle.focus();
          return;
        }
        const body = { title: rawTitle };
        if (parsed.date === null && prefs.dueToday) {
          body.due_date = dueTodayISO();
        }
        const created = await createTask(currentProjectId, body);
        uiShowToast(toastEl, 'Task added.');
        quickTitle.value = '';
        renderChips();
        await refreshTasks();
        flashNewTask(created.id);
        quickTitle.focus();
        return;
      }

      const projectId = resolveProject(parsed.project);
      if (!projectId) {
        setQuickError('Please select a project.');
        quickTitle.focus();
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
            assigneePrefix,
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
      const repeatFields = repeatTaskFields(parsed.repeats);
      if (repeatFields) {
        body.repeat_after = repeatFields.repeat_after;
        body.repeat_mode = repeatFields.repeat_mode;
      }

      const created = await createTask(projectId, body);
      // Assignees are set after creation: the v2 create body does not accept
      // them (read-only), they go to their own sub-resource.
      for (const user of assignees) {
        await addAssigneeToTask(created.id, user.id);
      }
      await addLabelsToTask(created.id, parsed.labels);
      uiShowToast(toastEl, 'Task added.');
      quickTitle.value = '';
      await api.storage.local.set({ lastProjectId: projectId });
      currentProjectId = projectId;
      renderChips();
      await refreshTasks();
      flashNewTask(created.id);
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
  grantAccessBtn.addEventListener('click', async () => {
    grantAccessBtn.disabled = true;
    try {
      if (await requestHostPermissions(hostPatterns)) {
        grantAccessBtn.hidden = true;
        configPrompt.querySelector('.empty').textContent = 'Vikunja is not configured yet.';
        load();
      } else {
        configPrompt.querySelector('.empty').textContent =
          'Access to your Vikunja server was not granted. You can try again or open the settings.';
      }
    } finally {
      grantAccessBtn.disabled = false;
    }
  });
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
  sortBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSortMenu();
  });
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('click', (e) => {
      if (!sortBtn.contains(e.target) && !sortMenu.contains(e.target)) {
        closeSortMenu();
      }
    });
  }
  sortBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSortMenu();
    }
  });
  quickForm.addEventListener('submit', quickAdd);
  quickTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (typeof quickForm.requestSubmit === 'function') {
        quickForm.requestSubmit();
      } else if (typeof quickForm.submit === 'function') {
        quickForm.submit();
      }
    }
  });
  quickTitle.addEventListener('input', () => {
    setQuickError('');
    autosize();
    renderChips();
  });
  searchInput.addEventListener('input', renderTasks);

  load();
})();
