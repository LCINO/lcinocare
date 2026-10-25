'use strict';

// LcinoCare — scan engine.
// Measures every path defined in rules.js, discovers node_modules folders,
// large files, duplicate runtime bundles, and sizes the Trash. All sizes come
// from `du -sk` (fast native code) instead of a JS walk.

const { spawn } = require('child_process');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { GROUPS, RULES } = require('./rules');

const HOME = os.homedir();
const DU = '/usr/bin/du';

const expandHome = (p) => (p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);

// ── du sizing ─────────────────────────────────────────────────────────────

function duK(pathArg, { fullListing = false, timeoutMs = 180000 } = {}) {
  return new Promise((resolve) => {
    const args = ['-k'];
    if (fullListing) args.push('-a');
    args.push(pathArg);
    const child = spawn(DU, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) return resolve(null);
      resolve(out);
    });
  });
}

async function duSize(p) {
  const out = await duK(p);
  if (!out) return null;
  const m = out.match(/^(\d+)\t/);
  return m ? parseInt(m[1], 10) * 1024 : null;
}

// Run tasks with limited concurrency, reporting progress.
async function pool(jobs, limit, onEach) {
  let done = 0;
  const total = jobs.length;
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (jobs.length) {
      const job = jobs.shift();
      if (!job) break;
      await job();
      done += 1;
      if (onEach) onEach(done, total);
    }
  });
  await Promise.all(workers);
}

// ── glob expansion (basename patterns like *-updater) ─────────────────────

async function expandPath(p) {
  if (!p.includes('*')) {
    try { await fsp.stat(expandHome(p)); return [expandHome(p)]; } catch { return []; }
  }
  const abs = expandHome(p);
  const dir = path.dirname(abs);
  const pattern = path.basename(abs)
    .replace(/[.+^${}()[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*');
  const re = new RegExp(`^${pattern}$`, 'i');
  try {
    const entries = await fsp.readdir(dir);
    return entries.filter((e) => re.test(e)).map((e) => path.join(dir, e));
  } catch {
    return [];
  }
}

// ── directory walking ─────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules_placeholder']);

async function* walk(root, { maxDepth = 5, skip = [], skipSuffixes = [], onSkipDir = null } = {}) {
  const skipSet = new Set(skip);
  const queue = [{ dir: root, depth: 0 }];
  let visited = 0;
  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (depth > maxDepth || visited > 60000) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      visited += 1;
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (skipSuffixes.some((sfx) => e.name.endsWith(sfx))) continue;
        if (skipSet.has(e.name)) { if (onSkipDir) onSkipDir(full, e.name); continue; }
        yield { type: 'dir', path: full, name: e.name, depth };
        queue.push({ dir: full, depth: depth + 1 });
      }
      // files are yielded by the caller via readdir where needed
      yield { type: 'entry', path: full, name: e.name, depth, isDirectory: e.isDirectory() };
    }
  }
}

// ── finders ───────────────────────────────────────────────────────────────

async function findNodeModules(onFound) {
  const found = [];
  for await (const node of walk(HOME, {
    maxDepth: 6,
    skip: ['node_modules', '.git', 'Library', '.Trash', '.cache'],
    skipSuffixes: ['.app', '.bundle'],
    onSkipDir: (p, name) => {
      if (name !== 'node_modules') return; // .git/.Trash/.cache are skipped silently
      found.push({ path: p, sizeBytes: 0 });
      onFound(p);
    }
  })) {
    if (node.type === 'entry' && node.isDirectory && node.name === 'node_modules') {
      found.push({ path: node.path, sizeBytes: 0 });
      onFound(node.path);
    }
  }
  return found;
}

const FILE_KINDS = [
  ['video', ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v']],
  ['image', ['jpg', 'jpeg', 'png', 'gif', 'heic', 'webp', 'tiff', 'psd']],
  ['audio', ['mp3', 'wav', 'aac', 'm4a', 'flac']],
  ['archive', ['zip', 'rar', '7z', 'tar', 'gz', 'dmg', 'pkg']],
  ['document', ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'key']]
];

function kindOf(ext) {
  for (const [kind, exts] of FILE_KINDS) if (exts.includes(ext)) return kind;
  return 'other';
}

async function findLargeFiles(minBytes, onCount) {
  const roots = ['Desktop', 'Downloads', 'Documents', 'Movies'].map((d) => path.join(HOME, d));
  const out = [];
  for (const root of roots) {
    for await (const node of walk(root, { maxDepth: 5, skip: ['node_modules', '.git'], skipSuffixes: ['.app'] })) {
      if (node.type !== 'entry' || node.isDirectory) continue;
      try {
        const st = await fsp.stat(node.path);
        if (st.size >= minBytes) {
          const ext = path.extname(node.name).slice(1).toLowerCase();
          out.push({ path: node.path, sizeBytes: st.size, mtimeMs: st.mtimeMs, kind: kindOf(ext) });
          onCount(out.length);
        }
      } catch { /* unreadable */ }
    }
  }
  // files sitting directly in the home folder (e.g. stray .bak archives)
  try {
    const homeEntries = await fsp.readdir(HOME, { withFileTypes: true });
    for (const e of homeEntries) {
      if (e.name.startsWith('.') || e.isDirectory() || e.isSymbolicLink()) continue;
      try {
        const st = await fsp.stat(path.join(HOME, e.name));
        if (st.size >= minBytes) {
          const ext = path.extname(e.name).slice(1).toLowerCase();
          out.push({ path: path.join(HOME, e.name), sizeBytes: st.size, mtimeMs: st.mtimeMs, kind: kindOf(ext) });
        }
      } catch { /* unreadable */ }
    }
  } catch { /* home unreadable */ }
  out.sort((a, b) => b.sizeBytes - a.sizeBytes);
  return out;
}

// Duplicate runtime bundles: sibling folders of identical size under one
// parent (e.g. 11 copies of the same 557 MB runtime). Detected with a single
// full `du -a` listing per big parent, so the cost is one pass each.
async function findDuplicateBundles(bigChildren, emit) {
  const results = [];
  for (const parent of bigChildren) {
    const listing = await duK(parent.path, { fullListing: true, timeoutMs: 300000 });
    if (!listing) continue;
    const prefix = parent.path.endsWith('/') ? parent.path : parent.path + '/';
    const childSizes = new Map();
    for (const line of listing.split('\n')) {
      const m = line.match(/^(\d+)\t(.+)$/);
      if (!m) continue;
      childSizes.set(m[2], parseInt(m[1], 10) * 1024); // post-order: last wins = total
    }
    const groups = new Map();
    for (const [p, size] of childSizes) {
      if (!p.startsWith(prefix)) continue;
      const rel = p.slice(prefix.length);
      if (rel.includes('/')) continue; // direct children only
      if (size < 100 * 1024 * 1024) continue; // only care about 100 MB+ twins
      if (!groups.has(size)) groups.set(size, []);
      groups.get(size).push(p);
    }
    for (const [size, paths] of groups) {
      if (paths.length < 3) continue;
      const withMtime = [];
      for (const p of paths) {
        try { withMtime.push({ path: p, mtimeMs: (await fsp.stat(p)).mtimeMs }); } catch { /* gone */ }
      }
      withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);
      const keep = withMtime.slice(0, 2).map((x) => x.path);
      const remove = withMtime.slice(2);
      if (!remove.length) continue;
      const parentName = path.basename(parent.path);
      results.push({
        parent: parent.path,
        parentName,
        keep,
        remove: remove.map((x) => x.path),
        copySizeBytes: size
      });
      emit(parentName, remove.length, size * remove.length);
    }
  }
  return results;
}

// ── main scan ─────────────────────────────────────────────────────────────

async function diskUsage() {
  const out = await new Promise((resolve) => {
    const child = spawn('/bin/df', ['-k', '/System/Volumes/Data']);
    let s = '';
    child.stdout.on('data', (d) => (s += d));
    child.on('error', () => resolve(null));
    child.on('close', () => resolve(s));
  });
  if (!out) return { totalBytes: 0, usedBytes: 0, freeBytes: 0, freePct: 0 };
  const lines = out.trim().split('\n');
  const cols = lines[lines.length - 1].split(/\s+/);
  const totalBytes = parseInt(cols[1], 10) * 1024;
  const freeBytes = parseInt(cols[3], 10) * 1024;
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  return { totalBytes, usedBytes, freeBytes, freePct: totalBytes ? freeBytes / totalBytes : 0 };
}

let idCounter = 0;
const nextId = () => `item_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

function makeItem(rule, p, sizeBytes) {
  return {
    id: nextId(),
    groupId: rule.group,
    ruleId: rule.id,
    label: rule.label === 'App Updater Leftovers' ? path.basename(p) : rule.label,
    path: p,
    sizeBytes,
    safety: rule.safety,
    requiresAppQuit: rule.requiresAppQuit,
    processNames: rule.processNames,
    appDisplayName: rule.appDisplayName || rule.processNames[0] || null,
    whatItIs: rule.whatItIs,
    appImpact: rule.appImpact
  };
}

async function scan(emit = () => {}) {
  const t0 = Date.now();
  const disk = await diskUsage();

  emit({ stage: 'caches', detail: 'Measuring cache and app-data folders…' });

  // 1) Rule-based items.
  const expanded = []; // {rule, path}
  for (const rule of RULES) {
    for (const p of rule.paths) {
      const hits = await expandPath(p);
      for (const h of hits) expanded.push({ rule, path: h });
    }
  }
  return measureAndAssemble(expanded, disk, emit, t0);
}

async function measureAndAssemble(expanded, disk, emit, t0) {
  emit({ stage: 'sizes', detail: 'Sizing locations…' });
  const results = [];
  const jobs = expanded.map(({ rule, path: p }) => async () => {
    const sizeBytes = await duSize(p);
    results.push(sizeBytes === null ? { unreadable: true, rule, path: p } : { item: makeItem(rule, p, sizeBytes) });
  });
  let done = 0;
  const total = jobs.length;
  const workers = Array.from({ length: Math.min(6, jobs.length) || 1 }, async () => {
    while (jobs.length) {
      const job = jobs.shift();
      if (!job) break;
      await job();
      done += 1;
      if (done % 3 === 0 || done === total) emit({ stage: 'sizes', done, total, detail: `Sizing ${done}/${total} locations…` });
    }
  });
  await Promise.all(workers);

  let fdaBlocked = false;
  const byGroup = new Map();
  for (const r of results) {
    if (r.unreadable) {
      if (r.path.startsWith(HOME)) fdaBlocked = true;
      continue;
    }
    if (!byGroup.has(r.item.groupId)) byGroup.set(r.item.groupId, []);
    byGroup.get(r.item.groupId).push(r.item);
  }

  // 2) App Data Bloat: big Application Support folders with no rule coverage.
  emit({ stage: 'appdata', detail: 'Checking app data folders…' });
  const appSupport = path.join(HOME, 'Library', 'Application Support');
  let bigChildren = [];
  const ruledPaths = new Set(expanded.map((e) => e.path));
  const coveredParents = new Set(expanded.map((e) => path.dirname(e.path)));
  try {
    const entries = await fsp.readdir(appSupport, { withFileTypes: true });
    const candidates = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => path.join(appSupport, e.name))
      .filter((p) => !ruledPaths.has(p));
    const sizes = [];
    await pool(candidates.map((p) => async () => {
      const s = await duSize(p);
      if (s !== null) sizes.push({ path: p, sizeBytes: s });
    }), 6);
    bigChildren = sizes.filter((x) => x.sizeBytes >= 500 * 1024 * 1024);
    for (const big of bigChildren) {
      if (coveredParents.has(big.path)) continue; // specific rules already handle this folder
      const name = path.basename(big.path);
      byGroupDefaultAdd(byGroup, 'app-data-bloat', {
        id: nextId(),
        groupId: 'app-data-bloat',
        ruleId: 'generic-app-data',
        label: `${name} — App Data`,
        path: big.path,
        sizeBytes: big.sizeBytes,
        safety: 'review',
        requiresAppQuit: false,
        processNames: [name],
        whatItIs: `${name} keeps ${(big.sizeBytes / 1073741824).toFixed(1)} GB of data here. This may include projects, profiles or documents the app owns — not just cache.`,
        appImpact: 'Open the folder before deleting. If you no longer use this app, removing the folder is usually fine; otherwise leave it alone.'
      });
    }
  } catch { /* Application Support unreadable */ }

  // 3) Duplicate runtime bundles inside the big folders.
  emit({ stage: 'duplicates', detail: 'Detecting duplicate copies…' });
  const dupBundles = await findDuplicateBundles(bigChildren, (parentName, count, bytes) => {
    emit({ stage: 'duplicates', detail: `${parentName}: found ${count} duplicate copies` });
  });
  for (const dup of dupBundles) {
    const pretty = dup.parentName === 'autoclaw' ? 'AutoClaw'
      : dup.parentName.charAt(0).toUpperCase() + dup.parentName.slice(1);
    for (const p of dup.remove) {
      byGroupDefaultAdd(byGroup, 'duplicate-copies', {
        id: nextId(),
        groupId: 'duplicate-copies',
        ruleId: 'duplicate-bundle',
        label: `${dup.parentName} — duplicate copy (${shortHash(p)})`,
        path: p,
        sizeBytes: dup.copySizeBytes,
        safety: 'safe',
        requiresAppQuit: true,
        processNames: [dup.parentName],
        appDisplayName: pretty,
        whatItIs: `One of ${dup.keep.length + dup.remove.length} identical copies (${formatGB(dup.copySizeBytes)} each) that ${dup.parentName} accumulated. The two newest copies are kept.`,
        appImpact: 'The app keeps working with the newest copy. If it ever needs an older one, it re-extracts it.'
      });
    }
  }

  // 4) node_modules discovery (never list our own project's dependencies).
  emit({ stage: 'nodemodules', detail: 'Finding node_modules folders…' });
  const ownDir = path.resolve(__dirname, '..', '..');
  const nodeModules = (await findNodeModules((p) => emit({ stage: 'nodemodules', detail: shorten(p) })))
    .filter((n) => !n.path.startsWith(ownDir));
  const nmJobs = nodeModules.map((n) => async () => { n.sizeBytes = (await duSize(n.path)) || 0; });
  await pool(nmJobs, 6);
  nodeModules.sort((a, b) => b.sizeBytes - a.sizeBytes);

  // 5) Large files.
  emit({ stage: 'largefiles', detail: 'Finding large files…' });
  const largeThresholdMB = 10;
  const largeFiles = await findLargeFiles(largeThresholdMB * 1024 * 1024, () => {});

  // 6) Trash.
  emit({ stage: 'trash', detail: 'Measuring Trash…' });
  const trashSize = await duSize(path.join(HOME, '.Trash'));

  const groups = GROUPS.map((g) => ({
    ...g,
    items: byGroup.get(g.id) || []
  })).filter((g) => g.items.length);

  const dupGroup = byGroup.get('duplicate-copies') || [];
  if (dupGroup.length) {
    groups.push({ id: 'duplicate-copies', label: 'Duplicate Copies', icon: 'copy', color: '#ff453a', items: dupGroup });
  }

  const safeBytes = groups
    .flatMap((g) => g.items)
    .filter((i) => i.safety === 'safe')
    .reduce((s, i) => s + i.sizeBytes, 0);
  const reviewBytes = groups
    .flatMap((g) => g.items)
    .filter((i) => i.safety === 'review')
    .reduce((s, i) => s + i.sizeBytes, 0);

  return {
    at: new Date().toISOString(),
    durationMs: Date.now() - t0,
    disk,
    groups,
    safeBytes,
    reviewBytes,
    nodeModules,
    largeFiles,
    largeThresholdMB,
    duplicateBundles: dupBundles,
    trash: { sizeBytes: trashSize || 0, unreadable: trashSize === null },
    fdaBlocked
  };
}

function byGroupDefaultAdd(map, groupId, item) {
  if (!map.has(groupId)) map.set(groupId, []);
  map.get(groupId).push(item);
}

// ── formatting helpers (shared with CLI output) ───────────────────────────

function formatGB(bytes) {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}
function shortHash(p) {
  return path.basename(p).slice(0, 8);
}
function shorten(p) {
  return p.replace(HOME, '~');
}

// ── My Clutter: one-level size map of the home folder ────────────────────
// Emits a 'home-overview' progress event per completed entry so the renderer
// can draw the bubble map progressively while measuring continues.

async function homeOverview(emit = () => {}) {
  const entries = [];
  let names;
  try {
    names = await fsp.readdir(HOME, { withFileTypes: true });
  } catch {
    return [];
  }
  const jobs = [];
  for (const e of names) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(HOME, e.name);
    if (e.isDirectory() && !e.isSymbolicLink()) {
      jobs.push(async () => {
        emit({ stage: 'home-overview', detail: `Measuring ${shorten(full)}…` });
        const sizeBytes = await duSize(full);
        if (sizeBytes !== null) {
          const entry = { name: e.name, path: full, sizeBytes, isDir: true };
          entries.push(entry);
          emit({ stage: 'home-overview', detail: `${e.name}: ${formatGB(sizeBytes)} measured`, entry });
        }
      });
    } else if (e.isFile()) {
      jobs.push(async () => {
        try {
          const st = await fsp.stat(full);
          const entry = { name: e.name, path: full, sizeBytes: st.size, isDir: false };
          entries.push(entry);
          emit({ stage: 'home-overview', detail: `${e.name}: ${formatGB(st.size)} measured`, entry });
        } catch { /* unreadable */ }
      });
    }
  }
  await pool(jobs, 6);
  entries.sort((a, b) => b.sizeBytes - a.sizeBytes);
  return entries;
}

module.exports = { scan, duSize, diskUsage, findDuplicateBundles, homeOverview, formatGB, shorten };

// ── CLI mode: npm run scan ────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    console.log('LcinoCare scan — this matches what the app will show.\n');
    const emit = (e) => {
      if (e.detail) process.stdout.write(`\r\x1b[2K${e.detail}`);
    };
    const result = await scan(emit);
    process.stdout.write('\r\x1b[2K');
    console.log(`Disk: ${formatGB(result.disk.usedBytes)} used, ${formatGB(result.disk.freeBytes)} free of ${formatGB(result.disk.totalBytes)}\n`);
    for (const g of result.groups) {
      const total = g.items.reduce((s, i) => s + i.sizeBytes, 0);
      console.log(`\n${g.label} — ${formatGB(total)}`);
      for (const item of g.items.sort((a, b) => b.sizeBytes - a.sizeBytes)) {
        console.log(`  ${formatGB(item.sizeBytes).padStart(8)}  [${item.safety}] ${shorten(item.path)}`);
      }
    }
    if (result.nodeModules.length) {
      console.log(`\nnode_modules — ${formatGB(result.nodeModules.reduce((s, n) => s + n.sizeBytes, 0))}`);
      for (const n of result.nodeModules.slice(0, 15)) console.log(`  ${formatGB(n.sizeBytes).padStart(8)}  ${shorten(n.path)}`);
      if (result.nodeModules.length > 15) console.log(`  … and ${result.nodeModules.length - 15} more`);
    }
    console.log(`\nLarge files (>10 MB): ${result.largeFiles.length}`);
    for (const f of result.largeFiles.slice(0, 10)) console.log(`  ${formatGB(f.sizeBytes).padStart(8)}  ${shorten(f.path)}`);
    console.log(`\nTrash: ${formatGB(result.trash.sizeBytes)}${result.trash.unreadable ? ' (unreadable — grant Full Disk Access)' : ''}`);
    console.log(`\nSAFE to clean total:   ${formatGB(result.safeBytes)}`);
    console.log(`REVIEW before delete:  ${formatGB(result.reviewBytes)}`);
    console.log(`Scan took ${(result.durationMs / 1000).toFixed(1)}s`);
  })();
}
