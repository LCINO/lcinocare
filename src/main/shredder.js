'use strict';

// LcinoCare — Shredder.
// Overwrites file contents with random bytes, truncates, then unlinks. The
// UI states the honest APFS caveat: copy-on-write snapshots and SSD wear
// leveling mean shredding is best-effort, not a guarantee. Files must be
// picked explicitly by the user (folder picker, multi-select) — the shredder
// never browses or suggests anything on its own.

const fs = require('fs');
const fsp = fs.promises;

async function shredOne(p, { passes = 1 } = {}) {
  let st;
  try { st = await fsp.stat(p); } catch (e) { return { path: p, ok: false, reason: 'File not found.' }; }
  if (st.isDirectory()) return { path: p, ok: false, reason: 'Folders are not shreddable — pick individual files.' };

  const handle = await fsp.open(p, 'r+');
  try {
    const CHUNK = 512 * 1024;
    const chunk = Buffer.alloc(CHUNK);
    for (let pass = 0; pass < passes; pass++) {
      let written = 0;
      while (written < st.size) {
        const len = Math.min(CHUNK, st.size - written);
        for (let i = 0; i < len; i += 256) require('crypto').randomFillSync(chunk, i, Math.min(256, len - i));
        await handle.write(chunk, 0, len, written);
        written += len;
      }
    }
    await handle.truncate(0);
  } finally {
    await handle.close();
  }
  try { await fsp.unlink(p); } catch (e) { return { path: p, ok: false, reason: String(e.message || e) }; }
  return { path: p, ok: true, bytes: st.size };
}

async function shred(paths, { onProgress = () => {} } = {}) {
  const results = [];
  let totalBytes = 0;
  for (let i = 0; i < paths.length; i++) {
    onProgress({ stage: 'shredding', done: i, total: paths.length, detail: paths[i] });
    const r = await shredOne(paths[i]);
    if (r.ok) totalBytes += r.bytes || 0;
    results.push(r);
  }
  return { ok: results.every((r) => r.ok), results, totalBytes };
}

module.exports = { shred };
