'use strict';

// LcinoCare — main process: window lifecycle, IPC wiring, single-flight scan.

const { app, BrowserWindow, Menu, ipcMain, shell, nativeTheme, dialog } = require('electron');
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
const updates = require('./updates');
const privacy = require('./privacy');
const similar = require('./similar');
const menuBar = require('./menu');
const { cmpVersion } = require('./updates');

app.setName('LcinoCare');

let win = null;
let scanning = false;
const HOME_PATH = require('os').homedir();
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
        { label: 'Check for Updates…', click: () => {
            const w = BrowserWindow.getAllWindows()[0];
            if (w && !w.isDestroyed()) w.webContents.send('lcino:check-updates');
          } },
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


// ── app self-update (Phase C) ─────────────────────────────────────────────
// Two layers, both honest:
//   1. electron-updater (Squirrel.Mac) — download + in-place install + relaunch.
//      Enabled when available; on unsigned builds Squirrel skips signature
//      validation, and any failure falls back to layer 2.
//   2. GitHub Releases check — always works: detect a newer release and point
//      the user at the stable DMG download.

let updaterState = { status: 'idle', version: null, pct: null, error: null };

function sendUpdateEvent(ev) {
  updaterState = { ...updaterState, ...ev };
  if (win && !win.isDestroyed()) win.webContents.send('lcino:update-event', ev);
}

function setupAutoUpdater() {
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = false; // user decides — our promise is no silent changes
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => sendUpdateEvent({ status: 'checking' }));
    autoUpdater.on('update-available', (i) => sendUpdateEvent({ status: 'available', version: i.version }));
    autoUpdater.on('update-not-available', () => sendUpdateEvent({ status: 'none' }));
    autoUpdater.on('download-progress', (p) => sendUpdateEvent({ status: 'downloading', pct: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (i) => sendUpdateEvent({ status: 'downloaded', version: i.version }));
    autoUpdater.on('error', (e) => sendUpdateEvent({ status: 'error', error: String(e).slice(0, 140) }));
    return autoUpdater;
  } catch (e) {
    console.warn('[updater] electron-updater unavailable — GitHub fallback only:', String(e).slice(0, 100));
    return null;
  }
}

let autoUpdaterRef = null;

async function githubUpdateCheck() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch('https://api.github.com/repos/LCINO/lcinocare/releases/latest', {
      headers: { 'User-Agent': 'LcinoCare' }, signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!r.ok) return { hasUpdate: false, error: 'GitHub returned ' + r.status };
    const j = await r.json();
    const version = String(j.tag_name || '').replace(/^v/, '');
    return {
      hasUpdate: cmpVersion(version, app.getVersion()) > 0,
      version,
      url: 'https://github.com/LCINO/lcinocare/releases/latest/download/LcinoCare-arm64.dmg',
      notes: j.name || '',
      page: j.html_url
    };
  } catch (e) {
    return { hasUpdate: false, error: String(e).slice(0, 120) };
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

  ipcMain.handle('home:overview', (_e, root) => {
    if (root && root !== HOME_PATH) {
      const oneFs = root === '/';
      return scanner.overview(root, emitProgress, { oneFilesystem: oneFs });
    }
    return scanner.homeOverview(emitProgress);
  });
  ipcMain.handle('volumes:list', () => scanner.listLocations());
  ipcMain.handle('dialog:choose-folder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('startup:list', () => startup.listStartup());
  ipcMain.handle('startup:disable', (_e, { path: p, disabled }) => startup.setAgentDisabled(p, disabled));

  ipcMain.handle('history:get', () => cleaner.readHistory(app.getPath('userData')));

  ipcMain.handle('item:reveal', (_e, p) => shell.showItemInFolder(p));

  ipcMain.handle('update:check', async () => {
    if (autoUpdaterRef) {
      try {
        const r = await autoUpdaterRef.checkForUpdates();
        const v = r && r.updateInfo ? r.updateInfo.version : null;
        const has = v ? cmpVersion(v, app.getVersion()) > 0 : false;
        if (has) sendUpdateEvent({ status: 'available', version: v });
        return { hasUpdate: has, version: v, engine: 'electron-updater', url: 'https://github.com/LCINO/lcinocare/releases/latest/download/LcinoCare-arm64.dmg' };
      } catch (e) {
        sendUpdateEvent({ status: 'error', error: String(e).slice(0, 140) });
        // fall through to GitHub check
      }
    }
    const gh = await githubUpdateCheck();
    if (gh.hasUpdate) sendUpdateEvent({ status: 'available', version: gh.version });
    return { hasUpdate: gh.hasUpdate, version: gh.version, engine: 'github', url: gh.url, notes: gh.notes };
  });
  ipcMain.handle('update:download', async () => {
    if (!autoUpdaterRef) return { ok: false, fallback: true };
    try { await autoUpdaterRef.downloadUpdate(); return { ok: true }; }
    catch (e) { return { ok: false, fallback: true, reason: String(e).slice(0, 120) }; }
  });
  ipcMain.handle('update:install', () => {
    if (!autoUpdaterRef) return { ok: false };
    try { autoUpdaterRef.quitAndInstall(); return { ok: true }; }
    catch (e) { return { ok: false, reason: String(e).slice(0, 120) }; }
  });
  ipcMain.handle('update:state', () => updaterState);
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
  ipcMain.handle('updates:scan', (_e) => {
    scanning = true;
    try {
      return updates.scan({ onProgress: emitProgress });
    } finally {
      scanning = false;
    }
  });
  ipcMain.handle('open:external', (_e, url) => {
    if (!/^https?:\/\//.test(String(url))) return { ok: false, reason: 'Only http(s) links can be opened.' };
    shell.openExternal(String(url));
    return { ok: true };
  });

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
  autoUpdaterRef = setupAutoUpdater();
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
