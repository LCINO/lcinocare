'use strict';

// LcinoCare — app inventory, leftover detection, and clean uninstall.

const { spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { isProtected } = require('./cleaner');

const HOME = os.homedir();
const APP_DIRS = ['/Applications', path.join(HOME, 'Applications')];
const GENERIC_ICON = '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns';
const iconCache = new Map();

async function readdirSafe(dir) {
  try { return await fsp.readdir(dir, { withFileTypes: true }); } catch { return []; }
}

async function listApps() {
  const apps = [];
  for (const dir of APP_DIRS) {
    for (const e of await readdirSafe(dir)) {
      if (!e.name.endsWith('.app') || e.isSymbolicLink()) continue;
      apps.push({
        name: e.name.replace(/\.app$/, ''),
        path: path.join(dir, e.name),
        location: dir === APP_DIRS[0] ? 'Applications' : 'User Applications'
      });
    }
  }
  apps.sort((a, b) => a.name.localeCompare(b.name));
  return apps;
}

function plutilExtract(plist, key) {
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/plutil', ['-extract', key, 'raw', plist]);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? out.trim() : null));
  });
}

function duSize(p) {
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/du', ['-sk', p], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve(null));
    child.on('close', () => {
      const m = out.match(/^(\d+)\t/);
      resolve(m ? parseInt(m[1], 10) * 1024 : null);
    });
  });
}

function runningPids(appName) {
  return new Promise((resolve) => {
    const child = spawn('/bin/ps', ['-Ao', 'pid=,comm=']);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve([]));
    child.on('close', () => {
      const pids = [];
      for (const line of out.split('\n')) {
        const m = line.trim().match(/^(\d+)\s+(.*)$/);
        if (!m) continue;
        const command = m[2];
        if (command.includes(`${appName}.app/`)) pids.push(parseInt(m[1], 10));
      }
      resolve(pids);
    });
  });
}

// Leftovers = files/dirs in Library locations whose name matches the app's
// bundle id or its display name. Container paths are matched only by exact
// bundle id and are flagged review (they can hold user data).
async function findLeftovers(bundleId, appName) {
  const lib = path.join(HOME, 'Library');
  const candidates = [];
  const push = (p, caution) => candidates.push({ path: p, caution });

  if (bundleId) {
    push(path.join(lib, 'Preferences', `${bundleId}.plist`));
    push(path.join(lib, 'Application Support', bundleId));
    push(path.join(lib, 'Caches', bundleId));
    push(path.join(lib, 'Logs', bundleId));
    push(path.join(lib, 'HTTPStorages', bundleId));
    push(path.join(lib, 'WebKit', bundleId));
    push(path.join(lib, 'Saved Application State', `${bundleId}.savedState`));
    push(path.join(lib, 'Containers', bundleId), true);
  }
  if (appName) {
    push(path.join(lib, 'Application Support', appName));
    push(path.join(lib, 'Caches', appName));
    push(path.join(lib, 'Logs', appName));
  }

  const seen = new Set();
  const found = [];
  for (const { path: p, caution } of candidates) {
    if (seen.has(p)) continue;
    seen.add(p);
    try {
      await fsp.access(p);
      if (isProtected(p)) continue; // never suggest protected paths
      const sizeBytes = await duSize(p);
      found.push({ path: p, sizeBytes: sizeBytes || 0, caution: !!caution });
    } catch { /* doesn't exist — good */ }
  }
  return found;
}

async function inspect(appPath) {
  if (!appPath.endsWith('.app')) return { error: 'Not an app bundle.' };
  const name = path.basename(appPath).replace(/\.app$/, '');
  const infoPlist = path.join(appPath, 'Contents', 'Info.plist');
  const bundleId = await plutilExtract(infoPlist, 'CFBundleIdentifier');
  const version = await plutilExtract(infoPlist, 'CFBundleShortVersionString');
  const [sizeBytes, icon] = await Promise.all([duSize(appPath), appIconDataUrl(appPath)]);
  const pids = await runningPids(name);
  const leftovers = await findLeftovers(bundleId, name);
  return { name, path: appPath, bundleId, version, sizeBytes, icon, running: pids.length > 0, pids, leftovers };
}

// Extract the app's real icon as a PNG data URL (sips converts .icns → png).
async function appIconDataUrl(appPath) {
  if (iconCache.has(appPath)) return iconCache.get(appPath);
  let dataUrl = null;
  try {
    const infoPlist = path.join(appPath, 'Contents', 'Info.plist');
    let iconName = await plutilExtract(infoPlist, 'CFBundleIconFile');
    if (!iconName) iconName = await plutilExtract(infoPlist, 'CFBundleIconName');
    const resDir = path.join(appPath, 'Contents', 'Resources');
    let icns = null;
    if (iconName) {
      const name = iconName.endsWith('.icns') ? iconName : `${iconName}.icns`;
      const cand = path.join(resDir, name);
      try { fs.accessSync(cand); icns = cand; } catch { /* fall through */ }
    }
    if (!icns) {
      try {
        const files = fs.readdirSync(resDir).filter((f) => f.endsWith('.icns'));
        if (files.length) icns = path.join(resDir, files[0]);
      } catch { /* unreadable */ }
    }
    if (!icns) icns = GENERIC_ICON;
    const tmp = path.join(os.tmpdir(), `lcinocare-ico-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    const ok = await new Promise((resolve) => {
      const child = spawn('/usr/bin/sips', ['-s', 'format', 'png', icns, '--out', tmp], { stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    });
    if (ok) {
      dataUrl = `data:image/png;base64,${fs.readFileSync(tmp).toString('base64')}`;
      fs.unlink(tmp, () => {});
    }
  } catch { dataUrl = null; }
  iconCache.set(appPath, dataUrl);
  return dataUrl;
}

// Fast metadata for a list row: real icon, version, install (birth) date.
async function appMeta(appPath) {
  if (!appPath.endsWith('.app')) return { icon: null, version: null, addedMs: null };
  const infoPlist = path.join(appPath, 'Contents', 'Info.plist');
  const [icon, version] = await Promise.all([
    appIconDataUrl(appPath),
    plutilExtract(infoPlist, 'CFBundleShortVersionString')
  ]);
  let addedMs = null;
  try { addedMs = (await fsp.stat(appPath)).birthtimeMs; } catch { /* unreadable */ }
  return { icon, version, addedMs };
}

module.exports = { listApps, inspect, findLeftovers, runningPids, duSize, appMeta };
