'use strict';

// LcinoCare — App Updater (the honest kind).
// Many Mac apps publish their own Sparkle update feed; the URL lives in the
// app's Info.plist (SUFeedURL). For those apps we fetch the feed, read the
// newest advertised version, and compare it with what's installed.
// Apps without a public feed are reported as "manual" — LcinoCare refuses to
// invent version numbers it cannot verify.

const { spawn } = require('child_process');
const path = require('path');
const uninstaller = require('./uninstaller');

function plutilJson(plist) {
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist]);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', (code) => {
      if (code !== 0) return resolve(null);
      try { resolve(JSON.parse(out)); } catch { resolve(null); }
    });
    child.on('error', () => resolve(null));
  });
}

function fetchText(url, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'LcinoCare/1.9' } })
      .then((r) => (r.ok ? r.text() : null))
      .then((t) => { clearTimeout(timer); resolve(t); })
      .catch(() => { clearTimeout(timer); resolve(null); });
  });
}

// "1.2.3" vs "2.0" — numeric per segment; junk stripped per segment.
function cmpVersion(a, b) {
  if (!a || !b) return 0;
  const norm = (v) => String(v).replace(/^v/i, '').split(/[.\-_+]/).map((s) => {
    const n = parseInt(s, 10);
    return isNaN(n) ? s.toLowerCase() : n;
  });
  const A = norm(a), B = norm(b);
  const len = Math.max(A.length, B.length);
  for (let i = 0; i < len; i++) {
    const x = A[i] ?? 0, y = B[i] ?? 0;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x > y ? 1 : -1;
    return String(x) > String(y) ? 1 : -1;
  }
  return 0;
}

function latestFromAppcast(xml) {
  if (!xml) return null;
  const item = (xml.match(/<item[\s\S]*?<\/item>/i) || [])[0];
  if (!item) return null;
  const short = (item.match(/<sparkle:shortVersionString>([^<]+)<\/sparkle:shortVersionString>/i) || [])[1];
  const build = (item.match(/sparkle:version=["']([^"']+)["']/i) || [])[1];
  const enc = (item.match(/<enclosure[^>]*url=["']([^"']+)["']/i) || [])[1];
  if (!short && !build) return null;
  return { shortVersion: short || null, build: build || null, url: enc || null };
}

async function scan({ onProgress = () => {} } = {}) {
  const apps = await uninstaller.listApps();
  const results = [];
  const feedJobs = [];

  // pass 1 — read every Info.plist
  const metas = [];
  for (let i = 0; i < apps.length; i++) {
    const app = apps[i];
    onProgress({ stage: 'updates', done: i, total: apps.length, detail: `Reading ${app.name}…` });
    const meta = await plutilJson(path.join(app.path, 'Contents', 'Info.plist'));
    metas.push({
      id: `up-${i}`,
      name: app.name,
      path: app.path,
      version: meta && (meta.CFBundleShortVersionString || meta.CFBundleVersion) || null,
      build: meta && meta.CFBundleVersion || null,
      feedUrl: meta && meta.SUFeedURL || null
    });
  }

  // pass 2 — fetch feeds concurrently
  const withFeed = metas.filter((m) => m.feedUrl && /^https?:\/\//.test(m.feedUrl));
  const jobs = withFeed.map((m) => async () => {
    const latest = latestFromAppcast(await fetchText(m.feedUrl));
    if (!latest) return;
    m.latest = latest.shortVersion || null;
    m.latestBuild = latest.build || null;
    m.feedEnclosure = latest.url || null;
    const byShort = cmpVersion(latest.shortVersion, m.version);
    const byBuild = cmpVersion(latest.build, m.build);
    m.hasUpdate = byShort > 0 || (byShort === 0 && byBuild > 0);
  });
  const workers = Array.from({ length: Math.min(6, jobs.length) }, async () => {
    while (jobs.length) {
      const j = jobs.shift();
      if (j) await j();
    }
  });
  await Promise.all(workers);

  for (const m of metas) {
    results.push({
      id: m.id,
      name: m.name,
      path: m.path,
      version: m.version || '—',
      latest: m.latest || null,
      hasFeed: !!m.feedUrl,
      hasUpdate: !!m.hasUpdate,
      feedUrl: m.feedUrl || null
    });
  }

  results.sort((a, b) => (b.hasUpdate - a.hasUpdate) || a.name.localeCompare(b.name));
  return {
    ok: true,
    apps: results,
    updates: results.filter((r) => r.hasUpdate).length,
    withFeed: results.filter((r) => r.hasFeed).length,
    noFeed: results.filter((r) => !r.hasFeed).length
  };
}

module.exports = { scan, cmpVersion };
