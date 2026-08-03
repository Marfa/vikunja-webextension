(() => {
  'use strict';

  if (typeof importScripts === 'function') {
    importScripts('../lib/vikunja.js');
  }

  const {
    api,
    buildTaskContent,
    getActiveTab,
    openCapture,
    getElementInstances,
    elementInstancePatterns,
    getPrefs,
    listProjects,
    createTask,
    dueTodayISO,
  } = globalThis.VikunjaLib;

  const MENU_ID = 'vikunja-add-task';
  const ELEMENT_SCRIPT_ID = 'vikunja-element';

  async function addFromContext(info, tab) {
    const content = buildTaskContent(info, tab);
    await openCapture(content);
  }

  function createMenus() {
    if (!api.contextMenus) {
      return;
    }
    api.contextMenus.removeAll(() => {
      api.contextMenus.create({
        id: MENU_ID,
        title: 'Add to Vikunja',
        contexts: ['page', 'selection', 'link'],
      });
    });
  }

  // Keep the dynamically registered Matrix Element content script in sync with
  // the stored instances. Registering requires both the "scripting" permission
  // and host permission for the target origin; the options page requests the
  // latter before saving an instance.
  async function syncContentScripts() {
    if (!api.scripting) {
      return;
    }
    const patterns = elementInstancePatterns(await getElementInstances());
    const script = {
      id: ELEMENT_SCRIPT_ID,
      matches: patterns,
      js: ['content/element.js'],
      css: ['content/element.css'],
    };
    try {
      if (patterns.length === 0) {
        await api.scripting.unregisterContentScripts({ ids: [ELEMENT_SCRIPT_ID] }).catch(() => {});
        return;
      }
      try {
        await api.scripting.updateContentScripts([script]);
      } catch (e) {
        await api.scripting.unregisterContentScripts({ ids: [ELEMENT_SCRIPT_ID] }).catch(() => {});
        await api.scripting.registerContentScripts([script]);
      }
    } catch (e) {
      console.error('Could not sync Element content script:', e);
    }
  }

  async function resolveProjectId(defaultProjectId) {
    if (defaultProjectId) {
      return String(defaultProjectId);
    }
    const projects = await listProjects();
    if (projects && projects.length) {
      return String(projects[0].id);
    }
    throw new Error('No projects found — create one in Vikunja first.');
  }

  // Only accept requests from pages that actually run our Element content
  // script (a registered instance origin), never from arbitrary web pages.
  async function handleCreateTask(message, sender) {
    try {
      let origin = '';
      try {
        origin = sender && sender.url ? new URL(sender.url).origin : '';
      } catch (e) {
        origin = '';
      }
      const patterns = elementInstancePatterns(await getElementInstances());
      if (!origin || !patterns.includes(`${origin}/*`)) {
        throw new Error('Request did not come from a registered Element instance.');
      }
      const title = String(message.title || '').replace(/\s+/g, ' ').trim();
      if (!title) {
        throw new Error('No message text to add.');
      }
      const prefs = await getPrefs();
      const projectId = await resolveProjectId(prefs.defaultProjectId);
      const body = { title };
      const description = String(message.description || '').trim();
      if (description) {
        body.description = description;
      }
      if (prefs.dueToday) {
        body.due_date = dueTodayISO();
      }
      const task = await createTask(projectId, body);
      return { ok: true, task };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Runs in the page's MAIN world via scripting.executeScript so it can reach
  // element-web's own MatrixClient and send the reaction with the user's
  // normal session — no tokens and no dependency on element-web's storage
  // layout. Best-effort: any failure just means no reaction.
  function matrixReactionFn(roomId, eventId, key) {
    const peg = typeof window !== 'undefined' && window.mxMatrixClientPeg;
    const client = peg && typeof peg.safeGet === 'function' ? peg.safeGet() : null;
    if (!client) {
      return Promise.reject(new Error('Element is not logged in.'));
    }
    return client.sendEvent(roomId, 'm.reaction', {
      'm.relates_to': { rel_type: 'm.annotation', event_id: eventId, key },
    });
  }

  // Mirrors handleCreateTask's origin check: reactions are only accepted from
  // pages that actually run our Element content script.
  async function handleMatrixReact(message, sender) {
    try {
      let origin = '';
      try {
        origin = sender && sender.url ? new URL(sender.url).origin : '';
      } catch (e) {
        origin = '';
      }
      const patterns = elementInstancePatterns(await getElementInstances());
      if (!origin || !patterns.includes(`${origin}/*`)) {
        throw new Error('Request did not come from a registered Element instance.');
      }
      if (!api.scripting || typeof api.scripting.executeScript !== 'function') {
        throw new Error('Scripting API unavailable.');
      }
      const tabId = sender && sender.tab && sender.tab.id;
      if (typeof tabId !== 'number') {
        throw new Error('No tab to react in.');
      }
      const roomId = String(message.roomId || '').trim();
      const eventId = String(message.eventId || '').trim();
      const key = String(message.emoji || '📝');
      if (!roomId || !eventId) {
        throw new Error('Missing room or event id.');
      }
      await api.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: matrixReactionFn,
        args: [roomId, eventId, key],
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  api.runtime.onInstalled.addListener(() => {
    createMenus();
    syncContentScripts();
  });
  api.runtime.onStartup.addListener(() => {
    createMenus();
    syncContentScripts();
  });

  if (api.storage) {
    api.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.elementInstances) {
        syncContentScripts();
      }
    });
  }

  if (api.permissions) {
    api.permissions.onAdded.addListener(syncContentScripts);
    api.permissions.onRemoved.addListener(syncContentScripts);
  }

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'vikunja.create-task') {
      handleCreateTask(message, sender).then(sendResponse);
      return true;
    }
    if (message && message.type === 'vikunja.matrix-react') {
      handleMatrixReact(message, sender).then(sendResponse);
      return true;
    }
  });

  if (api.contextMenus) {
    api.contextMenus.onClicked.addListener((info, tab) => {
      if (info.menuItemId === MENU_ID) {
        addFromContext(info, tab);
      }
    });
  }

  if (api.commands) {
    api.commands.onCommand.addListener((command) => {
      if (command !== 'add-current-site') {
        return;
      }
      getActiveTab().then((tab) => addFromContext({}, tab));
    });
  }
})();
