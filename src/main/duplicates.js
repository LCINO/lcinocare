'use strict';

// LcinoCare — duplicate file finder.
// Strategy: group files by exact size, then a cheap head+tail hash, then a
// full SHA-256 only for the small set of candidates that survive both.

const fsp = require('fs/promises');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const HOME = os.homedir();

async function* walkFiles(root, { maxDepth = 5 } = {}) {
  const queue = [{ dir: root, depth: 0 }];
  let visited = 0;
  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (depth > maxDepth || visited > 40000) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      visited += 1;
      if (e.name.startsWith('.')) continue;
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        yield { type: 'dir', path: full, depth };
        queue.push({ dir: full, depth: depth + 1 });
      } else {
        yield { type: 'file', path: full };
      }
    }
  }
}

function hashRange(fd, start, length) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.alloc(length);
    fs.read(fd, buf, 0, length, start, (err) => (err ? reject(err) : resolve(crypto.createHash('sha1').update(buf).digest('hex'))));
  });
}

async function quickHash(p, size) {
  let fd;
  try {
    fd = await fsp.open(p, 'r');
    const head = await hashRange(fd.fd, 0, Math.min(65536, size));
    const tailStart = Math.max(0, size - 65536);
    const tail = await hashRange(fd.fd, tailStart, Math.min(65536, size - tailStart));
    return `${head}:${tail}`;
  } catch {
    return null;
  } finally {
    if (fd) await fd.close().catch(() => {});
  }
}

function fullHash(p) {
  return new Promise((resolve) => {
    const h = crypto.createHash('sha256');
    const stream = fs.createReadStream(p, { highWaterMark: 1024 * 1024 });
    stream.on('data', (d) => h.update(d));
    stream.on('error', () => resolve(null));
    stream.on('end', () => resolve(h.digest('hex')));
  });
}

// Returns groups of confirmed duplicates. The newest file is suggested as the
// one to keep; the rest are flagged for the user.
async function findDuplicates({ minSizeMB = 10, roots = null, onProgress = () => {} } = {}) {
  const minBytes = minSizeMB * 1024 * 1024;
  const scanRoots = roots || ['Desktop', 'Downloads', 'Documents', 'Movies', 'Pictures'].map((d) => path.join(HOME, d));

  onProgress({ stage: 'collect', detail: 'Collecting files…' });
  const bySize = new Map();
  let scanned = 0;
  for (const root of scanRoots) {
    for await (const node of walkFiles(root)) {
      if (node.type !== 'file') continue;
      let st;
      try { st = await fsp.stat(node.path); } catch { continue; }
      if (st.size < minBytes) continue;
      if (!bySize.has(st.size)) bySize.set(st.size, []);
      bySize.get(st.size).push({ path: node.path, mtimeMs: st.mtimeMs });
      if (++scanned % 200 === 0) onProgress({ stage: 'collect', detail: `${scanned} files checked…` });
    }
  }

  const sizeCandidates = [...bySize.entries()].filter(([, files]) => files.length > 1);
  onProgress({ stage: 'quickhash', detail: `${sizeCandidates.length} size matches to verify…` });

  // quick hash
  const quickGroups = new Map();
  let qdone = 0;
  for (const [size, files] of sizeCandidates) {
    const hashed = new Map();
    for (const f of files) {
      const h = await quickHash(f.path, size);
      if (!h) continue;
      if (!hashed.has(h)) hashed.set(h, []);
      hashed.get(h).push(f);
    }
    for (const group of hashed.values()) {
      if (group.length > 1) quickGroups.set(`${size}:${group[0].path}`, { size, files: group });
    }
    qdone += 1;
    if (qdone % 5 === 0) onProgress({ stage: 'quickhash', detail: `${qdone}/${sizeCandidates.length} size groups verified…` });
  }

  // full hash for survivors (cap: skip full hashing anything above 2 GB)
  onProgress({ stage: 'fullhash', detail: 'Confirming with full checksum…' });
  const confirmed = [];
  for (const { size, files } of quickGroups.values()) {
    if (size > 2 * 1024 * 1024 * 1024) {
      confirmed.push({ size, files, confirmed: false });
      continue;
    }
    const hashes = new Map();
    for (const f of files) {
      const h = await fullHash(f.path);
      if (!h) continue;
      if (!hashes.has(h)) hashes.set(h, []);
      hashes.get(h).push(f);
    }
    for (const group of hashes.values()) {
      if (group.length > 1) confirmed.push({ size, files: group, confirmed: true });
    }
  }

  const groups = confirmed
    .map(({ size, files, confirmed: c }) => {
      const sorted = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs);
      return {
        id: `dup_${size}_${sorted[0].path.length}_${sorted.length}`,
        sizeBytes: size,
        confirmed: c,
        keep: sorted[0].path,
        duplicates: sorted.slice(1).map((f) => f.path)
      };
    })
    .sort((a, b) => b.sizeBytes * (b.duplicates.length) - a.sizeBytes * a.duplicates.length);

  return { groups, wastedBytes: groups.reduce((s, g) => s + g.sizeBytes * g.duplicates.length, 0) };
}

module.exports = { findDuplicates };
