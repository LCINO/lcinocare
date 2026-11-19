'use strict';

// LcinoCare — deletion engine.
// Four layers of safety:
//   1. A hard blocklist: protected paths are refused no matter what the UI
//      asks for. It is checked last-second, inside the delete call, on the
//      symlink-resolved path and case-insensitively.
//   2. Offered paths only: the main process passes the set of paths it handed
//      out in scan results; anything else the renderer names is refused.
//   3. App-running checks: if the owning app of an item is running, the item
//      is refused until the user quits the app — enforced here, not just in UI.
//   4. Deletion is always move-to-Trash (shell.trashItem) — recoverable —
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

const fs = require('fs');

const HOME = os.homedir();

// The home folder with symlinks resolved, so it compares against realpath()s.
const HOME_REAL = (() => {
  try { return fs.realpathSync.native(HOME); } catch { return HOME; }
})();

// Everything outside the home folder is protected. LcinoCare only ever cleans
// the user's own data; system zones (/System, /Library, /private, /Volumes,
// /Applications, …) and other users' homes are refused wholesale.

// Paths relative to the home folder that must never be touched.
// The home folder and ~/Library are protected as exact matches, and inside
// ~/Library only the sensitive, data-bearing folders are locked. Regular clean
// targets like ~/Library/Caches and ~/Library/Logs stay deletable.
// All comparisons are case-insensitive: APFS on macOS is case-insensitive by
// default, so "library/keychains" names the same folder as "Library/Keychains".
const HOME_BLOCK_EXACT = ['', 'library'];
const HOME_BLOCK_PREFIXES = [
  // credentials and developer identity
  '.ssh',
  '.gnupg',
  '.aws',
  '.kube',
  '.docker',
  '.config',
  '.claude',
  'Library/Keychains',
  // app and system data
  'Library/Preferences',
  'Library/Mail',
  'Library/Containers',
  'Library/Group Containers',
  'Library/Messages',
  'Library/HomeKit',
  'Library/Metadata',
  'Library/Safari',
  'Library/Cookies',
  'Library/Application Support/AddressBook',
  'Library/Application Support/MobileSync',
  'Library/Application Support/CloudDocs',
  'Library/Application Support/SyncServices'
].map((p) => p.toLowerCase());

// Any path segment matching these is protected, wherever it sits: version
// control internals and media libraries whose insides must stay intact.
const SEGMENT_BLOCK = [
  (s) => s === '.git',
  (s) => s.endsWith('.photoslibrary'),
  (s) => s.endsWith('.musiclibrary'),
  (s) => s.endsWith('.tvlibrary')
];

// File names that are secrets or local databases. Never trashed.
const NAME_BLOCK = [
  (n) => n === '.env' || n.startsWith('.env.'),
  (n) => /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/.test(n),
  (n) => /\.(pem|key|p12|pfx|keychain|keychain-db)$/.test(n),
  (n) => /\.(sqlite|sqlite3|db)$/.test(n),
  (n) => n === 'credentials' || /^(secrets?|tokens?)(\.|$)/.test(n)
];

// A folder that directly holds one of these is a project or repository root:
// trashing it would take source code or secrets with it.
const ROOT_MARKERS = ['.git', '.env'];

const TRASH_PATH = path.join(HOME, '.Trash');

// Absolute path with "~" expanded, "." / ".." collapsed, and every symlink
// resolved — through the deepest part of the path that exists — so a link
// such as ~/Library/Caches/x -> ~/.ssh is judged by where it really points.
function normalize(p) {
  const abs = path.resolve(p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);
  let head = abs;
  const tail = [];
  while (true) {
    try {
      return path.join(fs.realpathSync.native(head), ...tail);
    } catch {
      const parent = path.dirname(head);
      if (parent === head) return abs;
      tail.unshift(path.basename(head));
      head = parent;
    }
  }
}

function isUnderHome(abs) {
  const a = abs.toLowerCase();
  const h = HOME_REAL.toLowerCase();
  return a === h || a.startsWith(h + path.sep);
}

// Location-only check: outside home, sensitive home folders, .git internals
// and media libraries. Used on its own by the Shredder, where the user has
// deliberately picked individual files (secrets included) to destroy.
function isProtectedLocation(p) {
  if (typeof p !== 'string' || !p) return true;
  const abs = normalize(p);
  if (!isUnderHome(abs)) return true;
  const rel = path.relative(HOME_REAL, abs).toLowerCase();
  if (HOME_BLOCK_EXACT.includes(rel)) return true;
  if (HOME_BLOCK_PREFIXES.some((pre) => rel === pre || rel.startsWith(pre + path.sep))) return true;
  return rel.split(path.sep).some((seg) => SEGMENT_BLOCK.some((test) => test(seg)));
}

// Full check used by every delete: location rules, plus secret and database
// file names, plus folders that are the root of a repository or project.
function isProtected(p) {
  if (isProtectedLocation(p)) return true;
  const abs = normalize(p);
  const name = path.basename(abs).toLowerCase();
  if (NAME_BLOCK.some((test) => test(name))) return true;
  return ROOT_MARKERS.some((m) => fs.existsSync(path.join(abs, m)));
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

async function clean(items, { onProgress = () => {}, allowPaths = [], offered = null } = {}) {
  // allowPaths — a very narrow, caller-justified exception to the blocklist.
  // Used ONLY by the Privacy tool for two exact Safari files (History.db,
  // Cookies.binarycookies): the blocklist protects users from catastrophic
  // deletes, while these two specific files are what any real privacy cleaner
  // must be able to clear — and they still go through the Trash-first flow.
  // offered — Map(resolved path -> owning process names) of everything the
  // main process put in front of the user. When given, nothing else is cleaned.
  const allowed = new Set(allowPaths.map((p) => path.resolve(p)));
  items = Array.isArray(items) ? items.filter((it) => it && typeof it.path === 'string') : [];

  // One ps pass for every owning app named by the items or by our own records.
  const namesOf = (item) => [
    ...(Array.isArray(item.processNames) ? item.processNames : []),
    ...((offered && offered.get(path.resolve(item.path))) || [])
  ];
  const running = await findRunningApps([...new Set(items.flatMap(namesOf))]);
  const runningByName = new Map(running.map((r) => [r.name, r.display || r.name]));

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
    if (offered && !offered.has(path.resolve(item.path))) {
      results.push({ ...base, ok: false, reason: 'This item was not part of a LcinoCare scan. Rescan and try again.' });
      continue;
    }
    const busy = namesOf(item).filter((n) => runningByName.has(n));
    if (busy.length) {
      results.push({ ...base, ok: false, reason: `${runningByName.get(busy[0])} is running — quit it first.` });
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

module.exports = { isProtected, isProtectedLocation, findRunningApps, clean, emptyTrash, readHistory, appendHistory, TRASH_PATH };
