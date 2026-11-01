'use strict';

// LcinoCare — preload bridge.
// The renderer never touches Node or Electron directly; it only calls the
// small, explicit API below via contextBridge.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lcino', {
  scan: () => ipcRenderer.invoke('scan:run'),
  onScanProgress: (cb) => ipcRenderer.on('lcino:scan-progress', (_e, event) => cb(event)),
  // My Clutter progress — returns an unsubscribe function.
  onOverviewProgress: (cb) => {
    const handler = (_e, ev) => { if (ev && ev.stage === 'home-overview') cb(ev); };
    ipcRenderer.on('lcino:scan-progress', handler);
    return () => ipcRenderer.removeListener('lcino:scan-progress', handler);
  },

  clean: (items) => ipcRenderer.invoke('scan:clean', items),
  trashInfo: () => ipcRenderer.invoke('trash:info'),
  trashEmpty: () => ipcRenderer.invoke('trash:empty'),

  health: () => ipcRenderer.invoke('health:snapshot'),
  findDuplicates: (opts) => ipcRenderer.invoke('duplicates:find', opts),

  listProcesses: () => ipcRenderer.invoke('processes:list'),
  quitProcesses: (pids) => ipcRenderer.invoke('processes:quit', pids),

  listApps: () => ipcRenderer.invoke('apps:list'),
  inspectApp: (appPath) => ipcRenderer.invoke('apps:inspect', appPath),
  uninstallApp: (payload) => ipcRenderer.invoke('apps:uninstall', payload),
  appMeta: (appPath) => ipcRenderer.invoke('app:meta', appPath),
  appSize: (appPath) => ipcRenderer.invoke('app:size', appPath),

  search: (q) => ipcRenderer.invoke('search:query', q),
  history: () => ipcRenderer.invoke('history:get'),
  reveal: (p) => ipcRenderer.invoke('item:reveal', p),
  appInfo: () => ipcRenderer.invoke('app:info'),
  appRunning: (names) => ipcRenderer.invoke('util:app-running', names),
  quitApps: (pids) => ipcRenderer.invoke('util:quit-apps', pids),
  protectedList: () => ipcRenderer.invoke('protected:list'),
  homeOverview: () => ipcRenderer.invoke('home:overview'),
  startupList: () => ipcRenderer.invoke('startup:list'),
  startupSetDisabled: (payload) => ipcRenderer.invoke('startup:disable', payload),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  setLoginItem: (open) => ipcRenderer.invoke('app:set-login-item', open),
  snapshotsList: () => ipcRenderer.invoke('snapshots:list'),
  snapshotsPurge: () => ipcRenderer.invoke('snapshots:purge'),
  maintenanceList: () => ipcRenderer.invoke('maintenance:list'),
  maintenanceRun: (ids) => ipcRenderer.invoke('maintenance:run', ids),
  downloadsScan: () => ipcRenderer.invoke('downloads:scan')
});
