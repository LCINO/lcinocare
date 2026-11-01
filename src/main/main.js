'use strict';

// LcinoCare — main process: window lifecycle, IPC wiring, single-flight scan.

const { app, BrowserWindow, Menu, ipcMain, shell, nativeTheme } = require('electron');
const path = require('path');

const scanner = require('./scanner');
const cleaner = require('./cleaner');
const duplicates = require('./duplicates');
const health = require('./health');
const processesMod = require('./processes');
const uninstaller = require('./uninstaller');
const startup = require('./startup');
const search = require('./search');
const snapshots = require('./snapshots');
const maintenance = require('./maintenance');
const downloads = require('./downloads');
const privacy = require('./privacy');
const similar = require('./similar');
const menuBar = require('./menu');

app.setName('LcinoCare');

let win = null;
let scanning = false;
let lastScan = null;
let appsCache = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1220,
    height: 800,
    minWidth: 1000,
    minHeight: 640,
    title: 'LcinoCare',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#120016' : '#f4f4f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('closed', () => (win = null));
}

function menu() {
  const template = [
    {
      label: 'LcinoCare',
      submenu: [
        { label: 'About LcinoCare', role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }
      ]
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function emitProgress(event) {
  if (win && !win.isDestroyed()) win.webContents.send('lcino:scan-progress', event);
}

async function runScan() {
  if (scanning) return { ok: false, reason: 'busy' };
  scanning = true;
  try {
    const result = await scanner.scan(emitProgress);
    lastScan = result;
    if (!appsCache) {
      appsCache = await uninstaller.listApps();
    }
    search.buildFrom(lastScan, appsCache);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, reason: String(err && err.message ? err.message : err) };
  } finally {
    scanning = false;
  }
}

function wireIpc() {
  ipcMain.handle('scan:run', () => runScan());

  ipcMain.handle('scan:clean', async (_e, items) => {
    const { results, freedBytes } = await cleaner.clean(items, {
      onProgress: (done, total, p) => emitProgress({ stage: 'cleaning', done, total, detail: p })
    });
    const moved = results.filter((r) => r.ok);
    cleaner.appendHistory(app.getPath('userData'), {
      at: new Date().toISOString(),
      kind: 'clean',
      count: moved.length,
      freedBytes,
      paths: moved.map((m) => m.path)
    });
    lastScan = null; // stale after deletion — rescan needed
    return { results, freedBytes };
  });

  ipcMain.handle('trash:info', async () => {
    const size = await scanner.duSize(cleaner.TRASH_PATH);
    return { sizeBytes: size || 0, unreadable: size === null };
  });

  ipcMain.handle('trash:empty', async () => {
    const result = await cleaner.emptyTrash();
    if (result.ok) {
      cleaner.appendHistory(app.getPath('userData'), {
        at: new Date().toISOString(), kind: 'trash', count: 0, freedBytes: null, paths: []
      });
    }
    return result;
  });

  ipcMain.handle('health:snapshot', async () => health.snapshot(lastScan ? lastScan.safeBytes : 0));

  ipcMain.handle('duplicates:find', async (_e, opts) => {
    emitProgress({ stage: 'duplicates', detail: 'Scanning for duplicate files…' });
    const result = await duplicates.findDuplicates(opts || {}, emitProgress);
    return result;
  });

  ipcMain.handle('processes:list', () => processesMod.listTop());
  ipcMain.handle('processes:quit', (_e, pids) => processesMod.quitProcesses(pids));

  ipcMain.handle('apps:list', async () => {
    if (!appsCache) appsCache = await uninstaller.listApps();
    search.buildFrom(lastScan, appsCache);
    return appsCache;
  });

  ipcMain.handle('apps:inspect', async (_e, appPath) => {
    const info = await uninstaller.inspect(appPath);
    if (!info.error) {
      // merge any leftovers not yet in the cache so search finds them
    }
    return info;
  });

  const appMetaCache = new Map();
  ipcMain.handle('app:meta', async (_e, appPath) => {
    if (appMetaCache.has(appPath)) return appMetaCache.get(appPath);
    const meta = await uninstaller.appMeta(appPath);
    appMetaCache.set(appPath, meta);
    return meta;
  });

  const appSizeCache = new Map();
  ipcMain.handle('app:size', async (_e, appPath) => {
    if (appSizeCache.has(appPath)) return appSizeCache.get(appPath);
    const sizeBytes = await uninstaller.duSize(appPath);
    if (sizeBytes !== null) appSizeCache.set(appPath, sizeBytes);
    return sizeBytes;
  });

  ipcMain.handle('apps:uninstall', async (_e, { appPath, leftovers }) => {
    const results = [];
    const targets = [{ path: appPath, sizeBytes: 0 }, ...(leftovers || [])];
    for (const target of targets) {
      if (cleaner.isProtected(target.path)) {
        results.push({ path: target.path, ok: false, reason: 'Protected path.' });
        continue;
      }
      try {
        await shell.trashItem(target.path);
        results.push({ path: target.path, ok: true });
      } catch (err) {
        results.push({ path: target.path, ok: false, reason: String(err.message || err) });
      }
    }
    appsCache = await uninstaller.listApps();
    search.buildFrom(lastScan, appsCache);
    cleaner.appendHistory(app.getPath('userData'), {
      at: new Date().toISOString(),
      kind: 'uninstall',
      count: results.filter((r) => r.ok).length,
      freedBytes: (leftovers || []).reduce((s, l) => s + (l.sizeBytes || 0), 0),
      paths: [appPath, ...(leftovers || []).map((l) => l.path)]
    });
    return { results };
  });

  ipcMain.handle('search:query', (_e, q) => search.query(q));

  ipcMain.handle('util:app-running', (_e, names) => cleaner.findRunningApps(names));
  ipcMain.handle('util:quit-apps', (_e, pids) => processesMod.quitProcesses(pids));

  ipcMain.handle('protected:list', () => require('./rules').PROTECTED);

  ipcMain.handle('home:overview', () => scanner.homeOverview(emitProgress));

  ipcMain.handle('startup:list', () => startup.listStartup());
  ipcMain.handle('startup:disable', (_e, { path: p, disabled }) => startup.setAgentDisabled(p, disabled));

  ipcMain.handle('history:get', () => cleaner.readHistory(app.getPath('userData')));

  ipcMain.handle('item:reveal', (_e, p) => shell.showItemInFolder(p));

  ipcMain.handle('app:quit', () => app.quit());
  ipcMain.handle('app:show', () => {
    if (!win || win.isDestroyed()) createWindow();
    else {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  ipcMain.handle('menu:hide', () => menuBar.hidePopover());
  ipcMain.handle('menu:snapshot', async () => health.snapshot(lastScan ? lastScan.safeBytes : 0));
  ipcMain.handle('menu:quick-clean', async () => {
    if (scanning) return { ok: false, reason: 'A scan is already running.' };
    scanning = true;
    try {
      const result = await scanner.scan(() => {}); // silent — no overlay in the main window
      lastScan = null;
      const items = result.groups.flatMap((g) => g.items).filter((i) => i.safety === 'safe');
      const { results, freedBytes } = await cleaner.clean(items.map((i) => ({ id: i.id, path: i.path, sizeBytes: i.sizeBytes })));
      const okCount = results.filter((r) => r.ok).length;
      cleaner.appendHistory(app.getPath('userData'), {
        at: new Date().toISOString(),
        kind: 'clean',
        count: okCount,
        freedBytes,
        paths: items.map((i) => i.path)
      });
      return { ok: true, freedBytes, count: okCount, skipped: results.length - okCount };
    } finally {
      scanning = false;
    }
  });
  ipcMain.handle('app:set-login-item', (_e, open) => {
    app.setLoginItemSettings({ openAtLogin: !!open });
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle('snapshots:list', () => snapshots.list());
  ipcMain.handle('snapshots:purge', () => snapshots.purge());

  ipcMain.handle('maintenance:list', () => maintenance.TASKS.map(({ run, ...meta }) => meta));
  ipcMain.handle('maintenance:run', async (_e, ids) => {
    const results = [];
    for (let i = 0; i < ids.length; i++) {
      const task = maintenance.TASKS.find((t) => t.id === ids[i]);
      if (!task) { results.push({ id: ids[i], ok: false, reason: 'Unknown task.' }); continue; }
      emitProgress({ stage: 'maintenance', done: i, total: ids.length, detail: task.label });
      try {
        results.push({ id: task.id, label: task.label, ...(await task.run()) });
      } catch (err) {
        results.push({ id: task.id, label: task.label, ok: false, reason: String(err.message || err) });
      }
    }
    return { results };
  });

  ipcMain.handle('downloads:scan', () => downloads.scan());

  ipcMain.handle('privacy:scan', () => privacy.scan());
  ipcMain.handle('privacy:clean', (_e, items) =>
    cleaner.clean(items, { allowPaths: privacy.SAFARI_ALLOW }));

  ipcMain.handle('similar:scan', async () => {
    scanning = true;
    try {
      return await similar.scan({ onProgress: emitProgress });
    } finally {
      scanning = false;
    }
  });

  ipcMain.handle('app:info', () => ({
    name: 'LcinoCare',
    slogan: 'Therapy for Your Mac',
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`
  }));
}

app.whenReady().then(() => {
  menu();
  wireIpc();
  createWindow();
  menuBar.createMenu({
    showMain: () => {
      if (!win || win.isDestroyed()) createWindow();
      else {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    },
    quit: () => app.quit()
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // the menu bar companion keeps LcinoCare alive on macOS
  if (process.platform !== 'darwin' && !menuBar.isTrayAlive()) app.quit();
});
