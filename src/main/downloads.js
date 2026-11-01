'use strict';

// LcinoCare — Downloads review.
// Walks ~/Downloads (shallow, hidden folders skipped) and returns reviewable
// files with sizes and modified dates. Deletion always goes through the
// Trash-only cleaner, never direct removal.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const ROOT = () => path.join(os.homedir(), 'Downloads');
const SKIP = new Set(['.DS_Store', 'node_modules']);
const MAX_DEPTH = 2;
const MIN_BYTES = 256 * 1024; // list files ≥ 256 KB — crumbs are noise

const KINDS = [
  { test: /\.(dmg|pkg|zip|tar|gz|7z|rar|iso)$/i, kind: 'installer' },
  { test: /\.(mp4|mov|mkv|avi|webm)$/i, kind: 'video' },
  { test: /\.(mp3|wav|m4a|aac|flac)$/i, kind: 'audio' },
  { test: /\.(png|jpe?g|gif|webp|heic|svg|psd|ai|fig|sketch)$/i, kind: 'image' },
  { test: /\.(pdf|docx?|xlsx?|pptx?|key|pages|numbers|txt|md|epub)$/i, kind: 'document' },
  { test: /\.(js|ts|jsx|tsx|py|rb|go|rs|java|c|cpp|json|html|css|sh)$/i, kind: 'code' }
];

async function walk(dir, depth, out) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < MAX_DEPTH) await walk(full, depth + 1, out);
      continue;
    }
    if (!entry.isFile()) continue;
    let stat;
    try { stat = await fsp.stat(full); } catch { continue; }
    if (stat.size < MIN_BYTES) continue;
    const kind = (KINDS.find((k) => k.test.test(entry.name)) || { kind: 'other' }).kind;
    out.push({
      id: `dl-${Buffer.from(full).toString('base64url').slice(0, 24)}`,
      label: entry.name,
      path: full,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      kind
    });
  }
}

async function scan() {
  const out = [];
  await walk(ROOT(), 0, out);
  out.sort((a, b) => b.sizeBytes - a.sizeBytes);
  return { ok: true, root: ROOT(), items: out, totalBytes: out.reduce((s, i) => s + i.sizeBytes, 0) };
}

module.exports = { scan, ROOT };
