(() => {
  'use strict';

  if (typeof importScripts === 'function') {
    importScripts('../lib/vikunja.js');
  }

  const { api, buildTaskContent, getActiveTab, openCapture } = globalThis.VikunjaLib;

  const MENU_ID = 'vikunja-add-task';

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

  api.runtime.onInstalled.addListener(createMenus);
  api.runtime.onStartup.addListener(createMenus);

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
