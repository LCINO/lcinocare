'use strict';

// LcinoCare — main process: window lifecycle, IPC wiring, single-flight scan.

const { app, BrowserWindow, Menu, ipcMain, shell, nativeTheme, dialog, nativeImage } = require('electron');
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
const protection = require('./protection');
const shredder = require('./shredder');
const similar = require('./similar');
const menuBar = require('./menu');
const schedule = require('./schedule');
const { cmpVersion } = require('./updates');

app.setName('LcinoCare');

// Single instance: a second launch hands off to the running one. The
// --background-scan flag (scheduled scan via launchd) is forwarded along.
const gotLock = app.requestSingleInstanceLock();
const bgScanArgv = process.argv.includes('--background-scan');
if (!gotLock) {
  if (bgScanArgv) { /* the running instance will scan */ }
  app.quit();
}

let win = null;
let scanning = false;
const HOME_PATH = require('os').homedir();
let lastScan = null;
let appsCache = null;

// Every path the main process has put in front of the user (scan results,
// finder tools, app inspections), mapped to the processes that own it.
// Delete requests may only name these, so a renderer bug or injected script
// cannot ask us to trash an arbitrary path.
const offeredPaths = new Map();
// Browser trace files found by the Privacy scan (History, Cookies, *.sqlite).
// Kept apart: they are cleanable only through privacy:clean.
const privacyPaths = new Map();
function offer(result, into = offeredPaths, depth = 0) {
  if (!result || typeof result !== 'object' || depth > 8) return result;
  if (Array.isArray(result)) {
    result.forEach((r) => offer(r, into, depth + 1));
    return result;
  }
  if (typeof result.path === 'string') {
    const key = path.resolve(result.path);
    const names = Array.isArray(result.processNames) ? result.processNames : [];
    into.set(key, [...new Set([...(into.get(key) || []), ...names])]);
  }
  for (const v of Object.values(result)) if (v && typeof v === 'object') offer(v, into, depth + 1);
  return result;
}

// Files the user picked in the Shredder's own file dialog — the only paths
// the Shredder will ever accept.
const pickedForShred = new Set();

// The window is transparent and OVERHANG px taller than the visible panel, so
// the round Scan / Stop / Run button can sit half on the panel's bottom edge
// and half below it. The renderer draws the panel (rounded corners, background)
// and leaves that strip empty. Must match --overhang in styles.css.
const OVERHANG = 96; // half the 96px button + 48px for its ring and glow, which the window edge would otherwise cut flat

function createWindow() {
  win = new BrowserWindow({
    width: 1220,
    height: 800 + OVERHANG,
    minWidth: 1000,
    minHeight: 640 + OVERHANG,
    title: 'LcinoCare',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // macOS draws a transparent window's shadow from its painted pixels; refresh
  // it once the panel is on screen so the shadow follows the panel's shape.
  win.webContents.on('did-finish-load', () => setTimeout(() => win && win.invalidateShadow(), 300));
  // Full screen has no room for an overhang: tell the panel to fill the screen.
  const sendFullscreen = (on) => win && win.webContents.send('lcino:fullscreen', on);
  win.on('enter-full-screen', () => sendFullscreen(true));
  win.on('leave-full-screen', () => { sendFullscreen(false); setTimeout(() => win && win.invalidateShadow(), 300); });
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
    const result = offer(await scanner.scan(emitProgress));
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


// ── scheduled background scan ─────────────────────────────────────────────

let bgQuitTimer = null;

function runBackgroundScan() {
  if (scanning) return;
  scanning = true;
  const finish = (summary) => {
    scanning = false;
    try { new Notification(summary).show(); } catch { /* notifications blocked */ }
    // a background scan process has nothing left to do — leave shortly so a
    // notification click can still surface the app
    bgQuitTimer = setTimeout(() => { if (!win || win.isDestroyed()) app.quit(); }, 15000);
  };
  try {
    scanner.scan(() => {}).then((result) => {
      const gb = result.safeBytes / 1073741824;
      finish({
        title: 'LcinoCare — scheduled scan done',
        body: gb >= 0.5
          ? `${gb.toFixed(1)} GB of junk found. Click to review and clean it up.`
          : `All tidy — only ${(result.safeBytes / 1048576).toFixed(0)} MB of safely cleanable junk.`
      });
    }).catch((e) => finish({ title: 'LcinoCare — scan failed', body: String(e).slice(0, 120) }));
  } catch (e) {
    finish({ title: 'LcinoCare — scan failed', body: String(e).slice(0, 120) });
  }
}

function wireIpc() {
  ipcMain.handle('scan:run', () => runScan());

  ipcMain.handle('scan:clean', async (_e, items) => {
    const { results, freedBytes } = await cleaner.clean(items, {
      offered: offeredPaths,
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
    return offer(result);
  });

  ipcMain.handle('processes:list', () => processesMod.listTop());
  ipcMain.handle('processes:quit', (_e, pids) => processesMod.quitProcesses(pids));

  ipcMain.handle('apps:list', async () => {
    if (!appsCache) appsCache = await uninstaller.listApps();
    search.buildFrom(lastScan, appsCache);
    return offer(appsCache);
  });

  ipcMain.handle('apps:inspect', async (_e, appPath) => {
    const info = await uninstaller.inspect(appPath);
    if (!info.error) {
      // merge any leftovers not yet in the cache so search finds them
    }
    return offer(info);
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
      if (!offeredPaths.has(path.resolve(target.path))) {
        results.push({ path: target.path, ok: false, reason: 'Not part of this app’s inspection. Inspect the app again.' });
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
  ipcMain.handle('protection:status', () => protection.status());
  ipcMain.handle('shredder:run', async (_e, paths) => {
    // Only files the user picked in our own dialog, each picked once.
    const picked = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && pickedForShred.delete(p));
    scanning = true;
    try {
      return await shredder.shred(picked, { onProgress: emitProgress });
    } finally {
      scanning = false;
    }
  });
  ipcMain.handle('dialog:choose-files', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      buttonLabel: 'Shred These'
    });
    if (r.canceled) return null;
    r.filePaths.forEach((p) => pickedForShred.add(p));
    return r.filePaths;
  });
  ipcMain.handle('schedule:get', () => schedule.status());
  ipcMain.handle('schedule:set', (_e, { schedule, hour }) => schedule.set(schedule, hour));

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
      // processNames go along so the cleaner skips anything whose app is open —
      // there is no "quit first" dialog in the menu bar.
      const { results, freedBytes } = await cleaner.clean(items.map((i) => ({
        id: i.id, path: i.path, sizeBytes: i.sizeBytes, processNames: i.processNames
      })));
      const moved = results.filter((r) => r.ok);
      cleaner.appendHistory(app.getPath('userData'), {
        at: new Date().toISOString(),
        kind: 'clean',
        count: moved.length,
        freedBytes,
        paths: moved.map((m) => m.path) // only what actually went to the Trash
      });
      return { ok: true, freedBytes, count: moved.length, skipped: results.length - moved.length };
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

  ipcMain.handle('downloads:scan', async () => offer(await downloads.scan()));
  ipcMain.handle('updates:scan', (_e) => {
    scanning = true;
    try {
      return updates.scan({ onProgress: emitProgress });
    } finally {
      scanning = false;
    }
  });
  ipcMain.handle('open:external', (_e, url) => {
    if (!/^(https?:\/\/|x-apple\.systempreferences:)/.test(String(url))) return { ok: false, reason: 'Only http(s) and System Settings links can be opened.' };
    shell.openExternal(String(url));
    return { ok: true };
  });

  ipcMain.handle('privacy:scan', async () => offer(await privacy.scan(), privacyPaths));
  // Browser trace files (Safari History.db, Firefox places.sqlite, …) match the
  // database-name block, so the exact files the Privacy scan reported are
  // allowed through — and nothing else.
  ipcMain.handle('privacy:clean', (_e, items) =>
    cleaner.clean(items, {
      offered: privacyPaths,
      allowPaths: [...privacy.SAFARI_ALLOW, ...privacyPaths.keys()]
    }));

  ipcMain.handle('similar:scan', async () => {
    scanning = true;
    try {
      return offer(await similar.scan({ onProgress: emitProgress }));
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
  // `npm start` runs inside the stock Electron.app, so the Dock would show the
  // Electron atom. Packaged builds get the real icon from the .icns; dev runs
  // borrow it here.
  // nativeImage can't decode .icns directly, so ask Quick Look for a render.
  if (!app.isPackaged && app.dock) {
    nativeImage.createThumbnailFromPath(path.join(__dirname, '..', '..', 'build', 'icon.icns'), { width: 512, height: 512 })
      .then((icon) => { if (!icon.isEmpty()) app.dock.setIcon(icon); })
      .catch(() => { /* keep Electron's icon in dev */ });
  }
  autoUpdaterRef = setupAutoUpdater();

  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--background-scan')) runBackgroundScan();
    else if (win && !win.isDestroyed()) { win.show(); win.focus(); }
  });

  // Scheduled run via launchd: no window, no tray — scan, notify, and leave.
  if (bgScanArgv) {
    runBackgroundScan();
    return;
  }

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
