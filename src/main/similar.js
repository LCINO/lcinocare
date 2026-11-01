'use strict';

// LcinoCare — Similar Images.
// Scans ~/Pictures for images, computes a 64-bit dHash (difference hash) of
// each via Electron's nativeImage (decodes through macOS ImageIO, so JPEG,
// PNG, TIFF and HEIC all work), then groups images whose hashes sit within a
// small Hamming distance of each other. Pure measurement — deletion always
// goes through the Trash-only cleaner.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.tif', '.tiff', '.webp']);
const MIN_BYTES = 30 * 1024;      // tiny thumbnails are noise
const MAX_FILES = 4000;           // hard cap so a huge library can't run away
const HAMMING_MAX = 8;            // ≤8 differing bits of 64 ⇒ "similar"

function collectImages(dir, depth, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < 5 && !/thumbnails|\.lproj$/i.test(entry.name)) collectImages(full, depth + 1, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!EXTS.has(path.extname(entry.name).toLowerCase())) continue;
    try {
      const st = fs.statSync(full);
      if (st.size < MIN_BYTES) continue;
      out.push({ path: full, sizeBytes: st.size, mtimeMs: st.mtimeMs });
    } catch { /* unreadable */ }
  }
}

function dHash(img) {
  // 9×8 grayscale → 64-bit difference hash
  let small;
  try {
    small = img.resize({ width: 9, height: 8, quality: 'good' });
  } catch { return null; }
  let bitmap;
  try { bitmap = small.getBitmap(); } catch { return null; }
  if (!bitmap || bitmap.length < 9 * 8 * 4) return null;
  const gray = new Float32Array(9 * 8);
  for (let i = 0; i < 9 * 8; i++) {
    gray[i] = 0.299 * bitmap[i * 4 + 2] + 0.587 * bitmap[i * 4 + 1] + 0.114 * bitmap[i * 4];
  }
  let hash = 0n;
  let bit = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (gray[y * 9 + x] > gray[y * 9 + x + 1]) hash |= 1n << bit;
      bit++;
    }
  }
  return hash;
}

function hamming(a, b) {
  let x = a ^ b;
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

function thumbOf(img) {
  try {
    const t = img.resize({ width: 96, height: 96, quality: 'good' });
    return `data:image/jpeg;base64,${t.toJPEG(72).toString('base64')}`;
  } catch { return null; }
}

async function scan({ onProgress = () => {} } = {}) {
  const root = path.join(os.homedir(), 'Pictures');
  const files = [];
  try { collectImages(root, 0, files); } catch { /* no Pictures dir */ }

  const { nativeImage } = require('electron');
  const hashed = [];
  let scanned = 0;
  for (const file of files) {
    let img;
    try { img = nativeImage.createFromPath(file.path); } catch { img = null; }
    scanned += 1;
    if (img && !img.isEmpty()) {
      const hash = dHash(img);
      if (hash !== null) hashed.push({ ...file, hash });
    }
    if (scanned % 20 === 0) {
      onProgress({ stage: 'similar', done: scanned, total: files.length, detail: `Hashing images… ${scanned}/${files.length}` });
      await new Promise((r) => setImmediate(r)); // keep the event loop breathing
    }
  }

  // group: compare each image against existing group representatives
  const groups = [];
  for (const item of hashed) {
    let placed = false;
    for (const g of groups) {
      if (hamming(item.hash, g.repHash) <= HAMMING_MAX) { g.items.push(item); placed = true; break; }
    }
    if (!placed) groups.push({ repHash: item.hash, items: [item] });
  }

  const real = groups
    .filter((g) => g.items.length >= 2)
    .map((g, gi) => {
      const items = [...g.items].sort((a, b) => b.mtimeMs - a.mtimeMs || b.sizeBytes - a.sizeBytes);
      return {
        id: `sg-${gi}`,
        items: items.map((i) => ({ id: `si-${gi}-${items.indexOf(i)}`, path: i.path, sizeBytes: i.sizeBytes, mtimeMs: i.mtimeMs, thumb: thumbOf(nativeImage.createFromPath(i.path)) }))
      };
    });

  return {
    ok: true,
    scanned,
    totalFiles: files.length,
    groups: real,
    groupCount: real.length
  };
}

module.exports = { scan };
