'use strict';

// LcinoCare — Privacy scan.
// Finds browser privacy leftovers (browsing history, cookies, local/session
// storage) across installed browsers and sizes them. Cleaning happens through
// the Trash-only cleaner; for Safari's two cleanable files the cleaner is
// given an explicit allowPaths exception (see cleaner.js).

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const APP_SUPPORT = path.join(HOME, 'Library', 'Application Support');

// Exact Safari files the cleaner may trash despite the blocklist.
const SAFARI_ALLOW = [
  path.join(HOME, 'Library', 'Safari', 'History.db'),
  path.join(HOME, 'Library', 'Safari', 'Cookies.binarycookies')
];

async function pathSize(p) {
  try {
    const st = await fsp.stat(p);
    if (st.isFile()) return st.size;
    // directory — shallow recursive du (storage dirs are small)
    let total = 0;
    const stack = [p];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        try {
          const st2 = await fsp.stat(full);
          if (st2.isDirectory()) stack.push(full);
          else total += st2.size;
        } catch { /* unreadable */ }
      }
    }
    return total;
  } catch { return 0; }
}

function chromiumProfiles(base) {
  // Default + Profile N dirs that actually exist
  const profiles = [];
  for (const name of fs.readdirSync(base)) {
    if (name === 'Default' || /^Profile \d+$/.test(name)) {
      const p = path.join(base, name);
      if (fs.statSync(p).isDirectory()) profiles.push({ label: name === 'Default' ? 'Default profile' : name, dir: p });
    }
  }
  return profiles;
}

const CATS = [
  { id: 'history', label: 'Browsing History', chromium: ['History'], firefox: ['places.sqlite'] },
  { id: 'cookies', label: 'Cookies', chromium: ['Cookies'], firefox: ['cookies.sqlite'] },
  { id: 'localstorage', label: 'Local Storage', chromium: ['Local Storage'], firefox: ['storage'] },
  { id: 'sessions', label: 'Session Data', chromium: ['Sessions', 'Session Storage'], firefox: ['sessionstore-backups'] }
];

function collectChromium(base, id, name) {
  let profiles;
  try { profiles = chromiumProfiles(base); } catch { return null; }
  if (!profiles.length) return null;
  const categories = [];
  for (const cat of CATS) {
    const items = [];
    for (const prof of profiles) {
      for (const sub of cat.chromium) {
        const p = path.join(prof.dir, sub);
        if (fs.existsSync(p)) items.push({ id: `${id}-${cat.id}-${items.length}`, path: p });
      }
    }
    if (!items.length) continue;
    categories.push({ ...cat, items });
  }
  if (!categories.length) return null;
  return { id, name, categories };
}

async function finalize(browser) {
  let total = 0;
  for (const cat of browser.categories) {
    let size = 0;
    for (const item of cat.items) size += await pathSize(item.path);
    cat.sizeBytes = size;
    cat.items = cat.items.map((i) => ({ ...i, sizeBytes: 0, category: cat.id })); // size lives on the category
    total += size;
  }
  browser.categories = browser.categories.filter((c) => c.sizeBytes > 0);
  browser.totalBytes = browser.categories.reduce((s, c) => s + c.sizeBytes, 0);
  return browser;
}

async function scan() {
  const browsers = [];

  // Chromium family
  const chromiumApps = [
    ['chrome', 'Google Chrome', path.join(APP_SUPPORT, 'Google', 'Chrome')],
    ['edge', 'Microsoft Edge', path.join(APP_SUPPORT, 'Microsoft Edge')],
    ['brave', 'Brave', path.join(APP_SUPPORT, 'BraveSoftware', 'Brave-Browser')],
    ['arc', 'Arc', path.join(APP_SUPPORT, 'Arc', 'User Data')]
  ];
  for (const [id, name, base] of chromiumApps) {
    if (!fs.existsSync(base)) continue;
    const b = collectChromium(base, id, name);
    if (b) browsers.push(await finalize(b));
  }

  // Safari — data lives in ~/Library/Safari (macOS-protected; needs Full Disk Access)
  {
    const categories = [
      { id: 'history', label: 'Browsing History', items: [{ id: 'safari-history', path: SAFARI_ALLOW[0] }] },
      { id: 'cookies', label: 'Cookies', items: [{ id: 'safari-cookies', path: SAFARI_ALLOW[1] }] }
    ].filter((c) => fs.existsSync(c.items[0].path));
    if (categories.length) {
      const b = { id: 'safari', name: 'Safari', categories, blocked: !canRead(SAFARI_ALLOW[0]) };
      browsers.push(await finalize(b));
    }
  }

  // Firefox
  {
    const ffRoot = path.join(APP_SUPPORT, 'Firefox', 'Profiles');
    if (fs.existsSync(ffRoot)) {
      const profiles = fs.readdirSync(ffRoot).filter((n) => !n.startsWith('.')).map((n) => path.join(ffRoot, n));
      const categories = [];
      for (const cat of CATS) {
        const items = [];
        for (const prof of profiles) {
          for (const sub of cat.firefox) {
            const p = path.join(prof, sub);
            if (fs.existsSync(p)) items.push({ id: `firefox-${cat.id}-${items.length}`, path: p });
          }
        }
        if (items.length) categories.push({ ...cat, items });
      }
      if (categories.length) browsers.push(await finalize({ id: 'firefox', name: 'Firefox', categories }));
    }
  }

  return {
    ok: true,
    browsers: browsers.filter((b) => b.totalBytes > 0),
    grandTotal: browsers.reduce((s, b) => s + b.totalBytes, 0)
  };
}

function canRead(p) {
  try { fs.accessSync(p, fs.constants.R_OK); return true; } catch { return false; }
}

module.exports = { scan, SAFARI_ALLOW };
