'use strict';

// LcinoCare — deletion engine.
// Three layers of safety:
//   1. A hard blocklist: paths under these prefixes are refused no matter what
//      the UI asks for. This is checked last-second, inside the delete call.
//   2. App-running checks: if a rule lists process names and any is running,
//      the item is blocked until the user quits the app.
//   3. Deletion is always move-to-Trash (shell.trashItem) — recoverable —
//      never rm. The only exception is "Empty Trash", which is explicitly
//      confirmed and performed by Finder itself.

const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

// Electron's shell is required lazily so this module stays testable in plain Node.
let _shell = null;
function shell() {
  if (!_shell) _shell = require('electron').shell;
  return _shell;
}

const HOME = os.homedir();

// Absolute prefixes that must never be touched.
const BLOCK_PREFIXES = [
  '/System', '/private', '/usr', '/bin', '/sbin', '/etc', '/var',
  '/Library', '/Volumes', '/opt', '/Applications', '/dev', '/cores'
];

// Paths relative to the home folder that must never be touched.
// ~/Library itself is protected as an exact match, and inside it only the
// sensitive, data-bearing folders are locked. Regular clean targets like
// ~/Library/Caches and ~/Library/Logs stay deletable.
const HOME_BLOCK_EXACT = ['Library'];
const HOME_BLOCK_PREFIXES = [
  'Library/Keychains',
  'Library/Preferences',
  'Library/Mail',
  'Library/Containers',
  'Library/Group Containers',
  'Library/Messages',
  'Library/HomeKit',
  'Library/Metadata',
  'Library/Safari',
  'Library/Cookies',
  'Library/Application Support/MobileSync',
  'Library/Application Support/CloudDocs',
  'Library/Application Support/SyncServices'
];

const TRASH_PATH = path.join(HOME, '.Trash');

function normalize(p) {
  return path.resolve(p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);
}

function isProtected(p) {
  const abs = normalize(p);
  if (abs !== HOME && !abs.startsWith(HOME + path.sep)) {
    return BLOCK_PREFIXES.some((pre) => abs === pre || abs.startsWith(pre + path.sep));
  }
  const rel = path.relative(HOME, abs);
  if (HOME_BLOCK_EXACT.includes(rel)) return true;
  return HOME_BLOCK_PREFIXES.some((pre) => rel === pre || rel.startsWith(pre + path.sep));
}

// Which of these apps are currently running? Strict matching only:
//   • the process lives inside an app bundle named like the app (`/X.app/`),
//   • or the executable basename equals the name exactly.
// This avoids the old substring matching that flagged unrelated processes
// (e.g. anything merely containing "code") as "running".
// Returns [{ name, display, pids }] — names are the caller's identifiers,
// display is the human-friendly app name when we could see a bundle.
function findRunningApps(processNames) {
  return new Promise((resolve) => {
    if (!processNames || !processNames.length) return resolve([]);
    const child = spawn('/bin/ps', ['-Ao', 'pid=,comm=']);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve([]));
    child.on('close', () => {
      const selfBundle = (process.execPath || '').split('.app/')[0] + '.app/';
      const lowerNames = processNames.map((n) => n.toLowerCase());
      const found = new Map(); // name -> { name, display, pids: [] }
      for (const line of out.split('\n')) {
        const m = line.trim().match(/^(\d+)\s+(\/.*)$/);
        if (!m) continue;
        const pid = parseInt(m[1], 10);
        const comm = m[2];
        if (pid === process.pid || pid === (process.ppid || -1)) continue;
        if (selfBundle && comm.startsWith(selfBundle)) continue; // never match ourselves
        const lowerComm = comm.toLowerCase();
        for (let i = 0; i < lowerNames.length; i++) {
          const n = lowerNames[i];
          const orig = processNames[i];
          const bundleIdx = lowerComm.indexOf(`/${n}.app/`);
          const base = comm.substring(comm.lastIndexOf('/') + 1).toLowerCase();
          let display = null;
          if (bundleIdx !== -1) {
            // friendly name from the bundle folder: ".../Visual Studio Code.app/..."
            const seg = comm.slice(0, bundleIdx + 1).split('/');
            display = seg[seg.length - 2] || orig;
          } else if (base === n) {
            display = orig;
          } else {
            continue;
          }
          if (!found.has(orig)) found.set(orig, { name: orig, display, pids: [] });
          found.get(orig).pids.push(pid);
        }
      }
      resolve([...found.values()]);
    });
  });
}

async function clean(items, { onProgress = () => {}, allowPaths = [] } = {}) {
  // allowPaths — a very narrow, caller-justified exception to the blocklist.
  // Used ONLY by the Privacy tool for two exact Safari files (History.db,
  // Cookies.binarycookies): the blocklist protects users from catastrophic
  // deletes, while these two specific files are what any real privacy cleaner
  // must be able to clear — and they still go through the Trash-first flow.
  const allowed = new Set(allowPaths.map((p) => path.resolve(p)));
  const results = [];
  let freedBytes = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress(i + 1, items.length, item.path);
    const base = { id: item.id, path: item.path, sizeBytes: item.sizeBytes || 0 };
    if (isProtected(item.path) && !allowed.has(path.resolve(item.path))) {
      results.push({ ...base, ok: false, reason: 'This location is protected and cannot be deleted.' });
      continue;
    }
    try {
      await fspAccess(item.path);
      await shell().trashItem(item.path);
      freedBytes += item.sizeBytes || 0;
      results.push({ ...base, ok: true });
    } catch (err) {
      const missing = err && (err.code === 'ENOENT' || String(err).includes('non-existent'));
      results.push({ ...base, ok: false, reason: missing ? 'Already gone.' : String(err.message || err) });
    }
  }
  return { results, freedBytes };
}

function fspAccess(p) {
  return new Promise((resolve, reject) => {
    require('fs').access(p, (err) => (err ? reject(err) : resolve()));
  });
}

// "Empty Trash" — performed by Finder, exactly like the user clicking
// Finder > Empty Trash. Requires explicit confirmation in the UI beforehand.
function emptyTrash() {
  return new Promise((resolve) => {
    const script = 'tell application "Finder" to empty trash';
    const child = spawn('/usr/bin/osascript', ['-e', script]);
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => resolve({ ok: false, reason: String(e) }));
    child.on('close', (code) => resolve({ ok: code === 0, reason: code === 0 ? '' : err.trim() }));
  });
}

// ── cleanup history (persisted in the app's userData folder) ─────────────

const fs = require('fs');

function historyFile(userDataPath) {
  return path.join(userDataPath, 'history.json');
}

function readHistory(userDataPath) {
  try {
    return JSON.parse(fs.readFileSync(historyFile(userDataPath), 'utf8'));
  } catch {
    return [];
  }
}

function appendHistory(userDataPath, entry) {
  const list = readHistory(userDataPath);
  list.unshift(entry);
  try {
    fs.writeFileSync(historyFile(userDataPath), JSON.stringify(list.slice(0, 200), null, 2));
  } catch { /* best effort */ }
}

module.exports = { isProtected, findRunningApps, clean, emptyTrash, readHistory, appendHistory, TRASH_PATH };
