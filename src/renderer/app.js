'use strict';

/* LcinoCare renderer — views, search, and interactions.
   All privileged work happens in the main process; this file only renders
   and calls the window.lcino bridge. */

// ── utilities ─────────────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const Icons = window.LcinoIcons;

// Animate a number counting up (for scores, GB figures).
// Falls back to the final value instantly when the tab is hidden (rAF pauses).
function countUp(el, target, fmt = (v) => String(v), duration = 900) {
  if (!el) return;
  if (document.hidden || typeof requestAnimationFrame !== 'function') {
    el.textContent = fmt(target);
    return;
  }
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(target * eased);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setTimeout(() => { el.textContent = fmt(target); }, duration + 100);
}

// Run a one-shot visual update on the next frame, with a hidden-tab fallback.
function onNextFrame(fn) {
  let done = false;
  const run = () => { if (!done) { done = true; fn(); } };
  requestAnimationFrame(run);
  setTimeout(run, 150);
}

// Unique id generator for SVG gradient defs.
let gradSeq = 0;
const nextGradId = () => `grad${++gradSeq}`;

function fmtBytes(b) {
  if (b == null || isNaN(b)) return '—';
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
  if (b >= 1048576) return `${(b / 1048576).toFixed(0)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${b} B`;
}
function fmtDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function baseName(p) { return p.split('/').pop(); }
function tilt(p) { return p.replace(/^\/Users\/[^/]+/, '~'); }
// Left-truncate long paths for display so the tail (the identifying part) stays visible.
function shortPath(p, max = 58) {
  const t = tilt(p);
  return t.length > max ? '…' + t.slice(-max) : t;
}

function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = `toast${type === 'err' ? ' err' : ''}`;
  t.textContent = msg;
  $('#toast-holder').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 3400);
  setTimeout(() => t.remove(), 3800);
}

function showModal({ title, bodyHtml, confirmText = 'Confirm', danger = false, onConfirm }) {
  const backdrop = $('#modal-backdrop');
  const modal = $('#modal');
  modal.innerHTML = `
    <h3>${esc(title)}</h3>
    <div class="m-body">${bodyHtml}</div>
    <div class="m-actions">
      <button class="btn" id="modal-cancel">Cancel</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" id="modal-ok">${esc(confirmText)}</button>
    </div>`;
  backdrop.classList.remove('hidden');
  $('#modal-cancel').onclick = () => backdrop.classList.add('hidden');
  $('#modal-ok').onclick = async () => {
    backdrop.classList.add('hidden');
    await onConfirm();
  };
  backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.classList.add('hidden'); };
}

// ── state ─────────────────────────────────────────────────────────────────

const state = {
  scan: null,
  scanning: false,
  apps: null,
  inspected: null,        // inspected app for the Apps view
  healthTimer: null,
  speedTimer: null,
  dupes: null,
  selectedClean: new Set(),   // paths
  selectedDupes: new Set(),
  selectedFiles: new Set(),
  filesThresholdMB: 10
};

// Module ownership: every view highlights its parent module in the sidebar
// and inherits its theme. Module ids land on their landing page; the older
// inner pages hang off them (reachable via feature rows, Review chips, My Tools).
const MODS = window.LcinoModules;
const MODULE_PARENT = {
  smart: 'smart',
  cleanup: 'cleanup', 'cleanup-manager': 'cleanup', clean: 'cleanup',
  protection: 'protection', protected: 'protection', 'privacy-tool': 'protection',
  performance: 'performance', speed: 'performance', startup: 'performance', 'perf-manager': 'performance',
  applications: 'applications', apps: 'applications', 'updates-tool': 'applications',
  clutter: 'clutter', files: 'clutter', duplicates: 'clutter', 'similar-images': 'clutter',
  spacelens: 'spacelens', bubble: 'spacelens',
  cloud: 'cloud',
  tools: 'tools', 'downloads-tool': 'tools',
  activity: 'activity', dashboard: 'activity', history: 'activity'
};

const VIEWS = {
  smart: { title: 'Smart Care', render: renderSmart, section: 'view-smart', landing: true },
  cleanup: { title: 'Junk Cleanup', render: () => renderLanding('cleanup'), section: 'view-land-cleanup', landing: true },
  protection: { title: 'Protection', render: () => renderLanding('protection'), section: 'view-land-protection', landing: true },
  performance: { title: 'Performance', render: () => renderLanding('performance'), section: 'view-land-performance', landing: true },
  applications: { title: 'Applications', render: () => renderLanding('applications'), section: 'view-land-applications', landing: true },
  clutter: { title: 'My Clutter', render: () => renderLanding('clutter'), section: 'view-land-clutter', landing: true },
  spacelens: { title: 'Space Lens', render: () => renderLanding('spacelens'), section: 'view-land-spacelens', landing: true },
  cloud: { title: 'Cloud Cleanup', render: () => renderLanding('cloud'), section: 'view-land-cloud', landing: true },
  tools: { title: 'My Tools', render: renderTools, section: 'view-land-tools', landing: true },
  activity: { title: 'My Activity', render: renderActivity, section: 'view-land-activity', landing: true },
  dashboard: { title: 'Dashboard', render: renderDashboard },
  clean: { title: 'Smart Clean', render: renderClean },
  'cleanup-manager': { title: 'Cleanup Manager', render: renderCleanupManager },
  'perf-manager': { title: 'Performance Manager', render: renderPerfManager },
  'downloads-tool': { title: 'Downloads', render: renderDownloads, section: 'view-land-downloads' },
  'privacy-tool': { title: 'Privacy Items', render: renderPrivacyTool, section: 'view-land-privacy' },
  'similar-images': { title: 'Similar Images', render: renderSimilarImages, section: 'view-land-similar' },
  'updates-tool': { title: 'App Updater', render: renderUpdates, section: 'view-land-updates' },
  bubble: { title: 'My Clutter Map', render: renderClutter, section: 'view-clutter' },
  duplicates: { title: 'Duplicates', render: renderDuplicates },
  files: { title: 'Large Files', render: renderFiles },
  apps: { title: 'Applications', render: renderApps },
  speed: { title: 'Speed & Memory', render: renderSpeed },
  startup: { title: 'Startup', render: renderStartup },
  protected: { title: 'Protected Items', render: renderProtected },
  history: { title: 'History', render: renderHistory }
};

// Open a view, optionally deep-linking into a manager pane.
function openView(name, pane) {
  if (name === 'cleanup-manager' && pane) cm.pane = pane;
  if (name === 'perf-manager' && pane) pm.pane = pane;
  showView(name);
}

function showView(name) {
  currentView = name;
  const meta = VIEWS[name];
  const parent = MODULE_PARENT[name] || name;
  document.body.dataset.view = parent;
  $('#content').dataset.theme = parent;
  document.body.classList.toggle('landing-mode', !!meta.landing);
  // landings show the full labeled sidebar; every focused page uses the rail
  document.body.classList.toggle('rail', !meta.landing && name !== 'smart');
  $('#topbar').classList.toggle('hidden', !!meta.landing);
  $$('#nav .nav-item').forEach((b) => {
    const on = b.dataset.view === parent;
    b.classList.toggle('active', on);
    b.style.background = on ? (MODS.byId(b.dataset.view)?.theme.pill || '') : '';
  });
  $$('.view').forEach((v) => v.classList.add('hidden'));
  const view = $(`#${meta.section || 'view-' + name}`);
  view.classList.remove('hidden');
  // retrigger the entrance animation on every visit
  view.style.animation = 'none';
  void view.offsetWidth;
  view.style.animation = '';
  // gradient-accented title (first word colored like CleanMyMac headlines)
  const title = meta.title;
  const sp = title.indexOf(' ');
  $('#view-title').innerHTML = sp === -1
    ? `<span class="grad-text">${esc(title)}</span>`
    : `<span class="grad-text">${esc(title.slice(0, sp))}</span>${esc(title.slice(sp))}`;
  // back chip on every non-landing page
  const back = $('#back-chip');
  const backMod = parent !== name ? MODS.byId(parent) : null;
  if (backMod) {
    back.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M14.5 5.5L8 12l6.5 6.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>${esc(backMod.nav || backMod.title)}`;
    back.classList.remove('hidden');
    back.onclick = () => showView(parent);
  } else {
    back.classList.add('hidden');
  }
  $('#search-results').classList.add('hidden');
  stopTimers();
  meta.render();
}

function stopTimers() {
  if (state.healthTimer) { clearInterval(state.healthTimer); state.healthTimer = null; }
  if (state.speedTimer) { clearInterval(state.speedTimer); state.speedTimer = null; }
}

// ── scan flow ─────────────────────────────────────────────────────────────

function setOverlay(visible, detail, pct) {
  const ov = $('#scan-overlay');
  ov.classList.toggle('hidden', !visible);
  if (visible) {
    if (detail !== undefined) $('#scan-detail').textContent = detail;
    if (pct !== undefined) $('#scan-bar-fill').style.width = `${Math.min(96, pct)}%`;
  }
}

window.lcino.onScanProgress((e) => {
  if (e.stage === 'home-overview') return; // My Clutter draws its own inline progress
  if (e.stage === 'sizes' && e.total) {
    setOverlay(true, e.detail, (e.done / e.total) * 80);
  } else if (e.detail) {
    const pct = { caches: 5, appdata: 55, duplicates: 65, nodemodules: 75, largefiles: 85, trash: 92, cleaning: 30 }[e.stage];
    setOverlay(true, e.detail, pct || 50);
  }
});

let latestScanResult = null;

async function runScan2({ silent = false } = {}) {
  if (state.scanning) return;
  state.scanning = true;
  state.selectedClean.clear();
  dl.selected.clear();
  if (!silent) setOverlay(true, 'Preparing scan…', 3);
  const { ok, reason } = await window.lcino.scan().then((r) => {
    if (r.ok) latestScanResult = r.result;
    return r;
  });
  state.scanning = false;
  setOverlay(false);
  if (!ok) { toast(`Scan failed: ${reason}`, 'err'); return; }
  state.scan = latestScanResult;
  state.dupes = null;
  if (['dashboard', 'clean', 'duplicates', 'files', 'smart', 'cleanup-manager', 'perf-manager', 'downloads-tool'].includes(currentView)) showView(currentView);
  toast(`Scan complete in ${(state.scan.durationMs / 1000).toFixed(0)}s — ${fmtBytes(state.scan.safeBytes)} safely cleanable`);
}

// ── dashboard ─────────────────────────────────────────────────────────────

let currentView = 'dashboard';

async function renderDashboard() {
  const view = $('#view-dashboard');
  view.innerHTML = '<div class="empty"><div class="spinner"></div></div>';

  const health = await window.lcino.health();

  const score = health.score.score;
  const ringColor = score >= 75 ? 'var(--good)' : score >= 45 ? 'var(--warn)' : 'var(--bad)';
  const ringPair = score >= 75 ? ['#34c759', '#1e9e46'] : score >= 45 ? ['#ffb340', '#e0821a'] : ['#ff6b5e', '#c0261d'];
  const C = 2 * Math.PI * 56;
  const offset = C * (1 - score / 100);

  const factorsHtml = health.score.factors.map((f) => `
    <div class="factor">
      <div class="f-label">${esc(f.label)}</div>
      <div class="f-bar"><div style="width:${(f.earned / f.max) * 100}%"></div></div>
      <div class="f-note">${esc(f.note)}</div>
    </div>`).join('');

  const m = health.memory;
  const d = health.disk;
  const b = health.battery;

  const storage = storageSegments();
  const segHtml = storage.segments.map((s) =>
    `<div style="width:${s.pct}%;background:${s.color}" title="${esc(s.label)}"></div>`).join('');
  const legendHtml = storage.segments.map((s) =>
    `<span><span class="dot" style="background:${s.color}"></span>${esc(s.label)} · ${fmtBytes(s.bytes)}</span>`).join('');

  view.innerHTML = `
    ${state.scan && state.scan.fdaBlocked ? `
      <div class="banner"><b>Limited access.</b> Some folders could not be read. For a complete scan, grant Full Disk Access to the app that launched LcinoCare (e.g. Terminal): System Settings → Privacy &amp; Security → Full Disk Access.</div>` : ''}
    <div class="card">
      <div class="ring-wrap">
        <div class="ring">
          <svg width="132" height="132">
            <defs>
              <linearGradient id="ringGrad${gradSeq}" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" style="stop-color:${ringPair[0]}"/>
                <stop offset="1" style="stop-color:${ringPair[1]}"/>
              </linearGradient>
            </defs>
            <circle class="ring-bg" cx="66" cy="66" r="56"></circle>
            <circle class="ring-fill" cx="66" cy="66" r="56" stroke="url(#ringGrad${gradSeq})"
              style="stroke-dasharray:${C};stroke-dashoffset:${C}"></circle>
          </svg>
          <div class="ring-label">
            <div class="ring-num" id="ring-num">0</div>
            <div class="ring-cap">Health Score</div>
          </div>
        </div>
        <div class="factors">${factorsHtml}</div>
      </div>
    </div>

    <div class="grid-3">
      <div class="card metric">
        <div class="m-label">CPU</div>
        <div class="m-value">${health.cpu}<small>%</small></div>
        <div class="m-bar"><div style="width:${health.cpu}%"></div></div>
        <div class="m-note">All cores combined, updated live.</div>
      </div>
      <div class="card metric">
        <div class="m-label">Memory</div>
        <div class="m-value">${m.usedPct}<small>% used</small></div>
        <div class="m-bar"><div style="width:${m.usedPct}%"></div></div>
        <div class="m-note">${fmtBytes(m.totalBytes - m.freeBytes)} of ${fmtBytes(m.totalBytes)} in use${m.swapBytes > 0 ? ` · ${fmtBytes(m.swapBytes)} swap` : ''}.</div>
      </div>
      <div class="card metric">
        <div class="m-label">Disk</div>
        <div class="m-value">${fmtBytes(d.freeBytes)}<small> free</small></div>
        <div class="m-bar"><div style="width:${d.usedPct}%"></div></div>
        <div class="m-note">${fmtBytes(d.usedBytes)} used of ${fmtBytes(d.totalBytes)} · ${Math.round((d.freeBytes / (d.totalBytes || 1)) * 100)}% free.</div>
      </div>
    </div>

    <div class="card">
      <h3>Battery Health</h3>
      <div class="sub">From the power system — updated on demand.</div>
      ${b.hasBattery ? `
        <div class="grid-3" style="gap:8px">
          <div><b style="font-size:19px">${b.percent != null ? b.percent + '%' : '—'}</b><div class="m-note">${b.charging ? 'Charging' : 'On battery'}</div></div>
          <div><b style="font-size:19px">${b.cycleCount != null ? b.cycleCount : '—'}</b><div class="m-note">Cycles used</div></div>
          <div><b style="font-size:19px">${b.condition || '—'}</b><div class="m-note">${b.maxCapacityPct != null ? b.maxCapacityPct + '% capacity' : 'Condition'}</div></div>
        </div>` : '<div class="m-note" style="margin:0">No battery detected — this Mac runs on AC power.</div>'}
    </div>

    <div class="card">
      <h3>Storage</h3>
      <div class="sub">Where the used space goes — measured, not guessed.</div>
      <div class="storage-wrap">
        <div class="storage-donut">
          <svg width="150" height="150">
            <defs>
              <linearGradient id="donutGrad${gradSeq}" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" style="stop-color:var(--acc)"/>
                <stop offset="1" style="stop-color:var(--acc-deep)"/>
              </linearGradient>
            </defs>
            <circle cx="75" cy="75" r="62" fill="none" stroke="var(--chip)" stroke-width="13"></circle>
            <circle cx="75" cy="75" r="62" fill="none" stroke="url(#donutGrad${gradSeq})" stroke-width="13" stroke-linecap="round"
              transform="rotate(-90 75 75)" stroke-dasharray="${2 * Math.PI * 62}"
              stroke-dashoffset="${2 * Math.PI * 62}" style="transition:stroke-dashoffset 1s cubic-bezier(.3,.9,.4,1)"></circle>
          </svg>
          <div class="d-label"><div class="d-free">${fmtBytes(d.freeBytes)}</div><div class="d-cap">Free</div></div>
        </div>
        <div class="storage-info">
          <div class="seg-strip">${segHtml}</div>
          <div class="seg-legend">${legendHtml}</div>
          ${state.scan ? `
          <div class="free-hero">
            <div class="fh-text">You can safely free <span class="fh-num" id="fh-safe">${fmtBytes(0)}</span>
              <small>Plus ${fmtBytes(state.scan.reviewBytes)} more after a quick review.</small>
            </div>
            <button class="btn primary" id="hero-smart-clean">Smart Clean</button>
          </div>` : `
          <div class="free-hero">
            <div class="fh-text">Run a scan to see what can be freed.</div>
            <button class="btn primary" id="hero-scan">Scan Now</button>
          </div>`}
        </div>
      </div>
    </div>

    <div class="section-head"><h2></h2><div class="actions"><button class="btn small" id="dash-rescan">↻ Rescan</button></div></div>
  `;

  $('#dash-rescan').onclick = () => runScan2();
  const smartBtn = $('#hero-smart-clean');
  if (smartBtn) smartBtn.onclick = smartClean;
  const scanBtn = $('#hero-scan');
  if (scanBtn) scanBtn.onclick = () => runScan2();

  // animate ring + donut + counters in
  const ringFill = view.querySelector('.ring-fill');
  if (ringFill) onNextFrame(() => { ringFill.style.strokeDashoffset = offset; });
  countUp($('#ring-num'), score, (v) => String(Math.round(v)), 1000);
  const donutFill = view.querySelector('.storage-donut circle[stroke-dashoffset]');
  if (donutFill) {
    const dC = 2 * Math.PI * 62;
    donutFill.setAttribute('stroke-dashoffset', dC);
    onNextFrame(() => donutFill.setAttribute('stroke-dashoffset', `${2 * Math.PI * 62 * (1 - (d.usedBytes / (d.totalBytes || 1)))}`));
  }
  const fhSafe = $('#fh-safe');
  if (fhSafe) countUp(fhSafe, state.scan.safeBytes / 1073741824, (v) => fmtBytes(v * 1073741824), 1100);

  state.healthTimer = setInterval(async () => {
    if (currentView !== 'dashboard') return;
    const h = await window.lcino.health();
    const cpuCard = view.querySelectorAll('.metric .m-value')[0];
    if (cpuCard) cpuCard.innerHTML = `${h.cpu}<small>%</small>`;
    const memVal = view.querySelectorAll('.metric .m-value')[1];
    if (memVal) memVal.innerHTML = `${h.memory.usedPct}<small>% used</small>`;
  }, 3000);
}

function storageSegments() {
  const scan = state.scan;
  const used = scan ? scan.disk.usedBytes : 0;
  const safe = scan ? scan.safeBytes : 0;
  const review = scan ? scan.reviewBytes : 0;
  const nm = scan ? (scan.nodeModules || []).reduce((s, n) => s + n.sizeBytes, 0) : 0;
  const trash = scan ? (scan.trash ? scan.trash.sizeBytes : 0) : 0;
  const rest = Math.max(0, used - safe - review - nm - trash);
  const pctOf = (bytes) => (used ? (bytes / used) * 100 : 0);
  const segments = [
    { label: 'Cleanable junk', bytes: safe, color: '#0aa88f' },
    { label: 'Needs review', bytes: review, color: '#ff9f0a' },
    { label: 'node_modules', bytes: nm, color: '#bf5af2' },
    { label: 'Trash', bytes: trash, color: '#8e8e93' },
    { label: 'Apps, macOS & data', bytes: rest, color: '#0a84ff' }
  ].filter((s) => s.bytes > 0).map((s) => ({ ...s, pct: pctOf(s.bytes) }));
  return { segments };
}

// ── smart clean ───────────────────────────────────────────────────────────

function allSafeItems() {
  if (!state.scan) return [];
  return state.scan.groups.flatMap((g) => g.items).filter((i) => i.safety === 'safe');
}

function smartClean() {
  const items = allSafeItems();
  state.selectedClean = new Set(items.map((i) => i.path));
  showView('clean');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function showTrashConfirm(items) {
  const total = items.reduce((s, i) => s + (i.sizeBytes || 0), 0);
  showModal({
    title: 'Move to Trash?',
    bodyHtml: `<b>${items.length} item${items.length > 1 ? 's' : ''} · ${fmtBytes(total)}</b> will be moved to the Trash.<br><br>
      <b>Note:</b> the space is only freed when the Trash is emptied. Right after this, LcinoCare will offer to empty it for you.
      Until then everything stays recoverable — LcinoCare never deletes permanently without asking.`,
    confirmText: `Move ${fmtBytes(total)} to Trash`,
    danger: true,
    onConfirm: async () => {
      setOverlay(true, `Moving ${items.length} items to Trash…`, 30);
      const { results, freedBytes } = await window.lcino.clean(items);
      setOverlay(false);
      const failed = results.filter((r) => !r.ok);
      if (failed.length) toast(`Moved ${fmtBytes(freedBytes)} to Trash · ${failed.length} skipped (${failed[0].reason})`, failed.length === results.length ? 'err' : 'ok');
      else toast(`${fmtBytes(freedBytes)} moved to Trash ✓`);
      await runScan2({ silent: true });
      if (freedBytes > 0) {
        showModal({
          title: 'Empty the Trash now?',
          bodyHtml: `<b>${fmtBytes(freedBytes)}</b> is now sitting in the Trash, still using disk space.
            Emptying the Trash frees the space <b>permanently</b> — after that the files cannot be recovered.
            If you might want them back, choose "Later" and empty the Trash whenever you are sure.`,
          confirmText: `Empty Trash — free ${fmtBytes(freedBytes)}`,
          danger: true,
          onConfirm: async () => {
            const r = await window.lcino.trashEmpty();
            if (r.ok) toast(`${fmtBytes(freedBytes)} permanently freed ✓`);
            else toast(`Could not empty Trash: ${r.reason}`, 'err');
            await runScan2({ silent: true });
          }
        });
      }
    }
  });
}

async function confirmClean(items) {
  if (!items.length) return;
  // Collect the owning apps (processName -> friendly display name).
  const pairs = new Map();
  for (const it of items) {
    (it.processNames || []).forEach((n) => pairs.set(n, it.appDisplayName || n));
  }
  if (pairs.size) {
    const names = [...pairs.keys()];
    const running = await window.lcino.appRunning(names);
    if (running.length) {
      const listHtml = running.map((r) => `<b>${esc(r.display || r.name)}</b>`).join(', ');
      const it = running.length > 1 ? 'them' : 'it';
      showModal({
        title: running.length > 1 ? 'Apps need to quit first' : 'An app needs to quit first',
        bodyHtml: `${listHtml} ${running.length > 1 ? 'are' : 'is'} still running and holding the folders you selected.
          LcinoCare can quit ${it} gracefully — the same as pressing ⌘Q. Unsaved documents may ask the app to confirm first.`,
        confirmText: 'Quit & Continue',
        onConfirm: async () => {
          setOverlay(true, 'Asking the app to quit…', 40);
          await window.lcino.quitApps(running.flatMap((r) => r.pids));
          let still = running;
          for (let i = 0; i < 6; i++) {
            await sleep(1200);
            still = await window.lcino.appRunning(names);
            if (!still.length) break;
          }
          setOverlay(false);
          if (still.length) {
            toast(`Still running: ${still.map((s) => s.display || s.name).join(', ')} — please quit manually, then try again`, 'err');
            return;
          }
          showTrashConfirm(items);
        }
      });
      return;
    }
  }
  showTrashConfirm(items);
}

// ── clean view ────────────────────────────────────────────────────────────

async function renderClean() {
  const view = $('#view-clean');
  if (!state.scan) {
    view.innerHTML = emptyScan();
    bindScanButton(view);
    return;
  }

  const selectedItems = () => state.scan.groups.flatMap((g) => g.items).filter((i) => state.selectedClean.has(i.path));

  const groupHtml = state.scan.groups.map((g) => {
    const total = g.items.reduce((s, i) => s + i.sizeBytes, 0);
    const rows = g.items.sort((a, b) => b.sizeBytes - a.sizeBytes).map((item, idx) => `
      <div class="row" data-path="${esc(item.path)}">
        <input type="checkbox" class="item-check" data-path="${esc(item.path)}" data-size="${item.sizeBytes}"
          ${state.selectedClean.has(item.path) ? 'checked' : ''} />
        <div class="info">
          <div class="name">${esc(item.label)} <button class="detail-toggle" data-detail="d-${g.id}-${idx}">why is this safe?</button></div>
          <div class="path path-link" data-reveal="${esc(item.path)}" title="Click to open in Finder">${esc(shortPath(item.path))}</div>
        </div>
        <span class="badge ${item.safety === 'safe' ? 'safe' : 'review'}">${item.safety === 'safe' ? '✓ Safe' : '⚠ Review'}</span>
        <div class="size">${fmtBytes(item.sizeBytes)}</div>
        <button class="icon-btn" data-reveal="${esc(item.path)}" title="Show in Finder">${Icons.glyph('folder', 15, 'currentColor')}</button>
      </div>
      <div class="item-detail hidden" id="d-${g.id}-${idx}">
        <b>What is this?</b> ${esc(item.whatItIs)}<br>
        <b>If deleted:</b> ${esc(item.appImpact)}
        ${item.requiresAppQuit ? `<div class="warn-line">Quit ${esc(item.appDisplayName || item.processNames.join(', '))} before deleting — LcinoCare will check this for you.</div>` : ''}
      </div>`).join('');
    return `
      <div class="card">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <span class="dot" style="display:inline-block;width:9px;height:9px;border-radius:5px;background:${g.color}"></span>
          <h3 style="margin:0">${esc(g.label)}</h3>
          <span class="badge ${'safe'}" style="margin-left:auto">${fmtBytes(total)}</span>
          <button class="btn small group-select" data-group="${g.id}">Select all</button>
        </div>
        ${rows}
      </div>`;
  }).join('');

  const trashCard = `
    <div class="card">
      <div style="display:flex;align-items:center;gap:10px">
        <h3 style="margin:0">Trash</h3>
        <div class="info" style="flex:1">
          <div class="name">${fmtBytes(state.scan.trash.sizeBytes)} sitting in the Trash</div>
          <div class="path">Trash still occupies disk space. Emptying it frees the space permanently — this runs through Finder, same as Finder → Empty Trash.</div>
        </div>
        <button class="btn small" id="empty-trash">Empty Trash</button>
      </div>
    </div>`;

  view.innerHTML = `
    <div class="section-head">
      <h2>Cleanable items</h2>
      <div class="actions">
        <button class="btn small" id="select-safe">Select all Safe</button>
        <button class="btn small" id="clear-sel">Clear</button>
        <button class="btn small" id="clean-rescan">↻ Rescan</button>
      </div>
    </div>
    ${state.scan.fdaBlocked ? `<div class="banner"><b>Limited access.</b> Grant Full Disk Access to the launching app (Terminal) for a complete scan: System Settings → Privacy &amp; Security → Full Disk Access.</div>` : ''}
    ${groupHtml || '<div class="card empty">Nothing found — this Mac is already clean.</div>'}
    ${trashCard}
    <div class="action-bar">
      <div class="ab-info"><span id="ab-count">0 items</span> · <span id="ab-size">0 B</span> selected
        <small>Moved to Trash — recoverable until the Trash is emptied.</small></div>
      <button class="btn primary" id="ab-clean">Move to Trash</button>
    </div>
  `;

  const refreshBar = () => {
    const items = selectedItems();
    $('#ab-count').textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
    $('#ab-size').textContent = fmtBytes(items.reduce((s, i) => s + (i.sizeBytes || 0), 0));
  };
  refreshBar();

  view.querySelectorAll('.item-check').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) state.selectedClean.add(cb.dataset.path);
      else state.selectedClean.delete(cb.dataset.path);
      refreshBar();
    });
  });
  view.querySelectorAll('.detail-toggle').forEach((b) => {
    b.addEventListener('click', () => $(`#${b.dataset.detail}`).classList.toggle('hidden'));
  });
  view.querySelectorAll('[data-reveal]').forEach((b) => {
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      window.lcino.reveal(b.dataset.reveal);
    });
  });
  view.querySelectorAll('.group-select').forEach((b) => {
    b.addEventListener('click', () => {
      const group = state.scan.groups.find((g) => g.id === b.dataset.group);
      group.items.forEach((i) => state.selectedClean.add(i.path));
      renderClean();
    });
  });
  $('#select-safe').onclick = () => { smartClean(); };
  $('#clear-sel').onclick = () => { state.selectedClean.clear(); renderClean(); };
  $('#clean-rescan').onclick = () => runScan2();
  $('#ab-clean').onclick = () => confirmClean(selectedItems());

  $('#empty-trash').onclick = () => {
    showModal({
      title: 'Empty the Trash?',
      bodyHtml: `Everything currently in the Trash will be <b>permanently deleted</b> (${fmtBytes(state.scan.trash.sizeBytes)}). This cannot be undone.`,
      confirmText: 'Empty Trash',
      danger: true,
      onConfirm: async () => {
        const r = await window.lcino.trashEmpty();
        if (r.ok) { toast('Trash emptied ✓'); await runScan2({ silent: true }); }
        else toast(`Could not empty Trash: ${esc(r.reason)}`, 'err');
      }
    });
  };
}

function emptyScan() {
  return `
    <div class="card empty">
      <div class="e-icon">🔍</div>
      <div class="e-title">No scan yet</div>
      Run a scan first — LcinoCare will measure every cache and leftover on this Mac.
      <div style="margin-top:14px"><button class="btn primary" id="empty-scan-btn">Scan Now</button></div>
    </div>`;
}
function bindScanButton(view) {
  const b = $('#empty-scan-btn');
  if (b) b.onclick = () => runScan2();
}

// ── smart care + managers ─────────────────────────────────────────────────

let scArtSeq = 0;

function scArt(from, to, inner) {
  const uid = `scg${++scArtSeq}`;
  return `
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="${uid}" x1="20" y1="10" x2="105" y2="115" gradientUnits="userSpaceOnUse">
          <stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
        </linearGradient>
      </defs>
      <rect x="16" y="16" width="92" height="92" rx="28" transform="rotate(-9 62 62)" fill="url(#${uid})"/>
      <path d="M30 34 C 44 24 78 22 96 32 C 84 26 48 28 30 34 Z" fill="#fff" opacity=".55"/>
      <ellipse cx="42" cy="36" rx="20" ry="9" fill="rgba(255,255,255,.38)" transform="rotate(-16 42 36)"/>
      ${inner}
    </svg>`;
}

const SC_ART = {
  cleanup: scArt('#5ee07a', '#0f7a3d', '<circle cx="60" cy="66" r="17" fill="rgba(255,255,255,.92)"/><circle cx="84" cy="88" r="9" fill="rgba(255,255,255,.55)"/><path d="M46 96c2.4-5 5.5-8.3 9.4-10" stroke="#fff" stroke-width="4" stroke-linecap="round" fill="none"/>'),
  protection: scArt('#ff5fb0', '#a80b6b', '<path d="M60 38l22 8v15c0 13-8.8 21.8-22 26.6C46.8 82.8 38 74 38 61V46z" fill="#fff" opacity=".95"/><path d="M52 61l6.5 6.5L73 52.5" stroke="#c2157c" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'),
  perf: scArt('#ffb84f', '#d1490f', '<path d="M64 40L46 66h13l-4 20 20-28H61l3-18z" fill="#fff"/>'),
  apps: scArt('#6f97ff', '#2440c8', '<rect x="42" y="42" width="36" height="36" rx="11" fill="none" stroke="#fff" stroke-width="6"/><path d="M55 55l10 10M65 55l-10 10" stroke="#fff" stroke-width="6" stroke-linecap="round"/>'),
  clutter: scArt('#3fe0d0', '#0b7f8f', '<path d="M36 52a6 6 0 0 1 6-6h11l6 6h19a6 6 0 0 1 6 6v22a6 6 0 0 1-6 6H42a6 6 0 0 1-6-6z" fill="#fff" opacity=".95"/>')
};

function shadeHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * 0.68), g = Math.round(((n >> 8) & 255) * 0.68), b = Math.round((n & 255) * 0.68);
  return `rgb(${r},${g},${b})`;
}

function mgrTile(label, color, size = 34) {
  const letter = (String(label).trim()[0] || '?').toUpperCase();
  return `<span class="mgr-letter" style="width:${size}px;height:${size}px;background:linear-gradient(145deg,${color},${shadeHex(color)})">${esc(letter)}</span>`;
}

function selectedCleanItems() {
  if (!state.scan) return [];
  return state.scan.groups.flatMap((g) => g.items).filter((i) => state.selectedClean.has(i.path));
}

async function renderSmart() {
  const view = $('#view-smart');
  // landing shows the full labeled sidebar; the results screen uses the icon rail
  document.body.classList.toggle('landing-mode', !state.scan);
  document.body.classList.toggle('rail', !!state.scan);
  const shell = (inner) => {
    view.innerHTML = `
      <div class="sc-top">
        <button class="sc-startover" id="sc-startover"><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4.5 12a7.5 7.5 0 1 1 2.2 5.3M4.5 12V7.2M4.5 12h4.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Start Over</button>
        <div class="sc-title">Smart Care</div>
        <div></div>
      </div>${inner}`;
    $('#sc-startover').onclick = () => runScan2();
  };

  if (!state.scan) {
    const mod = MODS.byId('smart');
    view.innerHTML = landingHtml(mod);
    wireLanding(view, mod, () => runScan2()); // refresh list re-renders smart with results
    return;
  }

  const scan = state.scan;
  const safe = allSafeItems();
  if (!state.selectedClean.size) safe.forEach((i) => state.selectedClean.add(i.path));
  const selCount = safe.filter((i) => state.selectedClean.has(i.path)).length;
  const selBytes = safe.filter((i) => state.selectedClean.has(i.path)).reduce((s, i) => s + (i.sizeBytes || 0), 0);

  const [prot, startup, apps] = await Promise.all([
    window.lcino.protectedList().catch(() => []),
    window.lcino.startupList().catch(() => null),
    window.lcino.listApps().catch(() => null)
  ]);
  const dupItems = (scan.groups.find((g) => g.id === 'duplicate-copies') || { items: [] }).items;
  const perfCount = (Array.isArray(startup?.loginItems) ? startup.loginItems.length : 0) + (startup?.agents?.length || 0);
  const cleanupOn = selCount > 0;

  const card = (cls, art, topHtml, stat, sub, reviewView) => `
    <div class="sc-card ${cls}" data-review="${reviewView}">
      <div class="sc-card-top">${topHtml}</div>
      <div class="sc-art">${art}</div>
      <div class="sc-stat">${stat}</div>
      <div class="sc-sub">${sub}</div>
      <button class="sc-review" data-review="${reviewView}">Review</button>
    </div>`;

  shell(`
    <div class="sc-sheet">
      <div class="sc-headline">Your tasks are ready to run. Look what we found:</div>
      <div class="sc-grid">
        ${card('t-cleanup', SC_ART.cleanup, `
          <span class="sc-check ${cleanupOn ? 'on' : ''}" id="sc-cleanup-check" role="checkbox" aria-checked="${cleanupOn}" tabindex="0">
            <svg width="10" height="8" viewBox="0 0 11 9" fill="none"><path d="M1.5 4.5L4.2 7.2L9.5 1.5" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span> Cleanup`,
          fmtBytes(scan.safeBytes) + ' of junk', 'to clean', 'cleanup-manager')}
        ${card('t-protection', SC_ART.protection, 'Protection', 'Always protected', `${prot.length} system zones locked`, 'protected')}
        ${card('t-perf', SC_ART.perf, 'Performance', perfCount ? `${perfCount} items` : 'All clear', perfCount ? 'to review' : 'nothing launching extra', 'perf-manager')}
        ${card('t-apps wide', SC_ART.apps, 'Applications', apps ? `${apps.length} apps` : '—', 'to manage', 'apps')}
        ${card('t-clutter wide', SC_ART.clutter, 'My Clutter', dupItems.length ? `${dupItems.length} duplicate bundles` : 'No duplicates', dupItems.length ? 'to remove' : 'found so far', 'duplicates')}
      </div>
      <button class="sc-run" id="sc-run" title="Run Smart Care">Run</button>
    </div>`);

  $('#sc-cleanup-check').onclick = (e) => {
    e.stopPropagation();
    if (cleanupOn) safe.forEach((i) => state.selectedClean.delete(i.path));
    else safe.forEach((i) => state.selectedClean.add(i.path));
    renderSmart();
  };

  $('#sc-run').onclick = () => {
    const sel = safe.filter((i) => state.selectedClean.has(i.path));
    if (!sel.length) { toast('Nothing selected — tick Cleanup or review items first.'); return; }
    confirmClean(sel);
  };

  view.querySelectorAll('[data-review]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('#sc-cleanup-check')) return;
      showView(el.dataset.review);
    });
  });
}

// ── module landing template ───────────────────────────────────────────────

function landingHtml(mod) {
  const t = mod.theme;
  return `
    <div class="module-landing" style="--m-from:${t.from};--m-to:${t.to};--m-deep:${t.deep};--m-pill:${t.pill};--m-scan:${t.scan};--m-scan-to:${t.scanTo};--m-tile-a:${t.tile[0]};--m-tile-b:${t.tile[1]}">
      <div class="ml-art">${mod.art()}</div>
      <div class="ml-panel">
        <h1 class="ml-title">${esc(mod.title)}</h1>
        <p class="ml-tagline">${esc(mod.tagline)}</p>
        <div class="ml-rows">
          ${(mod.rows || []).map((r, i) => `
            <button class="ml-row" data-ml-row="${i}">
              <span class="ml-ico" style="background:linear-gradient(145deg,var(--m-tile-a),var(--m-tile-b))">${MODS.glyph(r.icon, 15, '#fff')}</span>
              <span class="ml-row-text">${esc(r.label)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span>
            </button>`).join('')}
        </div>
        ${mod.footnote ? `<div class="ml-footnote">${esc(mod.footnote)}</div>` : ''}
      </div>
      ${mod.scan ? '<button class="ml-scan" data-ml-scan>Scan</button>' : ''}
    </div>`;
}

function defaultLandingScan(mod) {
  return async () => {
    await runScan2();
    if (!state.scan) return;
    showView(mod.scanTo || 'smart');
  };
}

function wireLanding(view, mod, onScan) {
  const runScan = onScan || defaultLandingScan(mod);
  view.querySelectorAll('[data-ml-row]').forEach((btn) => {
    const r = mod.rows[Number(btn.dataset.mlRow)];
    btn.onclick = async () => {
      if (r.action === 'scan') { runScan(); return; }
      if (r.action === 'cloud-later') {
        toast(`${r.label.replace('Connect ', '')} connector arrives in a later update — nothing is connected yet.`);
        return;
      }
      if (r.icloud) {
        const locs = await window.lcino.listLocations().catch(() => []);
        const ic = locs.find((l) => l.id === 'icloud');
        if (!ic) { toast('iCloud Drive is not set up on this Mac.'); return; }
        sl.root = ic.path;
        sl.name = 'iCloud Drive';
        clutterCache = null;
        showView('bubble');
        return;
      }
      openView(r.view, r.pane);
    };
  });
  const scanBtn = view.querySelector('[data-ml-scan]');
  if (scanBtn) scanBtn.onclick = () => runScan();
}

function renderLanding(id) {
  const mod = MODS.byId(id);
  const view = $(`#${VIEWS[id].section}`);
  view.innerHTML = landingHtml(mod);
  wireLanding(view, mod, null);
}

// ── my tools ──────────────────────────────────────────────────────────────

function renderTools() {
  const view = $(`#${VIEWS.tools.section}`);
  const t = MODS.byId('tools').theme;
  view.innerHTML = `
    <div class="tools-wrap" style="--m-from:${t.from};--m-to:${t.to};--m-deep:${t.deep};--m-pill:${t.pill}">
      <h1 class="ml-title">My Tools</h1>
      <p class="ml-tagline">Quick tools for focused tasks — every card runs a real engine, nothing is decoration.</p>
      <div class="tools-grid">
        ${MODS.TOOLS.map((tool, i) => `
          <div class="tool-card" data-tool="${i}" role="button" tabindex="0">
            <span class="tool-ico" style="background:linear-gradient(145deg,${tool.color[0]},${tool.color[1]})">${MODS.glyph(tool.icon, 20, '#fff')}</span>
            <div class="tool-name">${esc(tool.label)}</div>
            <div class="tool-desc">${esc(tool.desc)}</div>
            <button class="tool-scan">Scan</button>
          </div>`).join('')}
      </div>
    </div>`;

  const open = (tool) => {
    if (tool.action === 'snapshots') openSnapshots();
    else openView(tool.view, tool.pane);
  };
  view.querySelectorAll('.tool-card').forEach((card) => {
    const tool = MODS.TOOLS[Number(card.dataset.tool)];
    card.onclick = (e) => { if (!e.target.closest('.tool-scan')) open(tool); };
    card.onkeydown = (e) => { if (e.key === 'Enter') open(tool); };
  });
  view.querySelectorAll('.tool-scan').forEach((btn) => {
    btn.onclick = (e) => open(MODS.TOOLS[Number(e.target.closest('.tool-card').dataset.tool)]);
  });
}

async function openSnapshots() {
  setOverlay(true, 'Checking local snapshots…', 40);
  const r = await window.lcino.snapshotsList();
  setOverlay(false);
  if (!r.ok) { toast(`Could not read snapshots: ${r.reason}`, 'err'); return; }
  const rows = r.snapshots.map((s) => `
    <div class="snap-row">
      <b>${s.date ? fmtDate(s.date) : 'Unknown date'}</b>
      <span>${esc(s.name.replace('com.apple.TimeMachine.', '').replace('.local', ''))}</span>
    </div>`).join('');
  showModal({
    title: 'Local Time Machine Snapshots',
    bodyHtml: `${r.snapshots.length
      ? `<div class="snap-note">APFS keeps these local snapshots on your disk. Purging thins the old ones — macOS keeps whatever it still needs, and your backups on the Time Machine drive are never touched.</div>
         <div class="snap-list">${rows}</div>`
      : '<div class="snap-note">No local snapshots right now — nothing is quietly eating your disk.</div>'}`,
    confirmText: r.snapshots.length ? 'Purge Old Snapshots' : 'Close',
    danger: r.snapshots.length > 0,
    onConfirm: async () => {
      if (!r.snapshots.length) return;
      setOverlay(true, 'Thinning snapshots…', 50);
      const res = await window.lcino.snapshotsPurge();
      setOverlay(false);
      if (res.ok) toast(`Purged ${res.deleted} snapshot${res.deleted === 1 ? '' : 's'} ✓`);
      else toast(`Could not purge: ${res.reason}`, 'err');
    }
  });
}

// ── my activity ───────────────────────────────────────────────────────────

async function renderActivity() {
  const view = $(`#${VIEWS.activity.section}`);
  const t = MODS.byId('activity').theme;
  view.innerHTML = `<div class="act-wrap" style="--m-from:${t.from};--m-to:${t.to};--m-deep:${t.deep};--m-pill:${t.pill}"><div class="sc-loading"><div class="spinner"></div></div></div>`;

  const [health, hist] = await Promise.all([
    window.lcino.health(),
    window.lcino.history().catch(() => [])
  ]);
  const d = health.disk;
  const score = health.score.score;
  const grade = score >= 75 ? 'Excellent' : score >= 45 ? 'Fair' : 'Needs Care';
  const gradeClass = score >= 75 ? 'good' : score >= 45 ? 'mid' : 'low';

  view.innerHTML = `
    <div class="act-wrap" style="--m-from:${t.from};--m-to:${t.to};--m-deep:${t.deep};--m-pill:${t.pill}">
      <div class="act-grid">
        <div class="act-card act-health">
          <div class="act-kicker">Mac Health:</div>
          <div class="act-score ${gradeClass}">${grade}</div>
          <div class="act-sub">Health Score ${score}/100 — your Mac, right now</div>
          <div class="act-disk">
            <div class="act-disk-row"><b>Macintosh HD</b><span>${fmtBytes(d.usedBytes)} of ${fmtBytes(d.totalBytes)} used</span></div>
            <div class="act-bar"><div style="width:${Math.round(d.usedPct)}%"></div></div>
          </div>
        </div>
        <div class="act-card act-cta">
          <span class="act-cta-ico" style="background:linear-gradient(145deg,#5ee07a,#1e9e46)">${MODS.glyph('smart', 22, '#fff')}</span>
          <p>Clean up storage and watch your free gigabytes add up.</p>
          <button class="act-go" data-act-go="smart">Go to Smart Care</button>
        </div>
        <div class="act-card act-cta">
          <span class="act-cta-ico" style="background:linear-gradient(145deg,#a855f7,#6d28d9)">${MODS.glyph('tools', 22, '#fff')}</span>
          <p>Run focused tools for a specific job in seconds.</p>
          <button class="act-go" data-act-go="tools">Open My Tools</button>
        </div>
      </div>

      <div class="act-card act-schedule">
        <div class="as-head">
          <span class="act-cta-ico" style="background:linear-gradient(145deg,#ffd35a,#e0821a)">${MODS.glyph('tm', 20, '#fff')}</span>
          <div>
            <div class="as-title">Care Schedule</div>
            <div class="as-sub">A quiet background scan on a schedule — you get a notification when junk is found. Nothing is cleaned without you.</div>
          </div>
        </div>
        <div class="as-controls">
          <label>Frequency
            <select id="as-freq">
              <option value="off">Off</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </label>
          <label>At
            <select id="as-hour">
              ${[8, 10, 13, 18, 21].map((h) => `<option value="${h}">${String(h).padStart(2, '0')}:00</option>`).join('')}
            </select>
          </label>
          <span class="as-state" id="as-state"></span>
        </div>
      </div>
      <div class="act-recent">
        <div class="act-recent-head">
          <h3>Recent activity</h3>
          <button class="act-viewall" data-act-go="history">View All</button>
        </div>
        ${hist.length ? hist.slice(0, 6).map((h) => `
          <div class="act-row">
            <span class="act-dot ${h.kind === 'clean' ? 'clean' : h.kind === 'trash' ? 'trash' : 'app'}"></span>
            <span class="act-text">${h.kind === 'clean' ? `Moved ${h.count} item${h.count === 1 ? '' : 's'} to Trash`
              : h.kind === 'trash' ? 'Emptied the Trash'
              : h.kind === 'uninstall' ? `Uninstalled ${h.count} app${h.count === 1 ? '' : 's'}` : esc(h.kind)}</span>
            <span class="act-when">${fmtDate(Date.parse(h.at))}</span>
            ${h.freedBytes ? `<span class="act-size">${fmtBytes(h.freedBytes)}</span>` : ''}
          </div>`).join('')
        : '<div class="act-row"><span class="act-text" style="color:var(--text-3)">Nothing yet — your first cleanup will show up here.</span></div>'}
      </div>
    </div>`;

  view.querySelectorAll('[data-act-go]').forEach((b) => b.onclick = () => showView(b.dataset.actGo));

  // care schedule
  const sched = await window.lcino.scheduleGet().catch(() => ({ enabled: false, schedule: 'off', hour: 10 }));
  const freq = view.querySelector('#as-freq');
  const hour = view.querySelector('#as-hour');
  const stateEl = view.querySelector('#as-state');
  freq.value = sched.schedule === 'weekly' ? 'weekly' : sched.schedule === 'daily' ? 'daily' : 'off';
  hour.value = String(sched.hour || 10);
  hour.parentElement.style.display = sched.schedule === 'off' ? 'none' : '';
  const syncState = () => {
    stateEl.textContent = freq.value === 'off' ? 'Schedule is off' : `Scans ${freq.value} at ${String(hour.value).padStart(2, '0')}:00`;
  };
  syncState();
  freq.onchange = () => { hour.parentElement.style.display = freq.value === 'off' ? 'none' : ''; syncState(); };
  hour.onchange = syncState;
  freq.parentElement.parentElement.querySelectorAll('select').forEach((sel) => sel.addEventListener('change', async () => {
    const cfg = { schedule: freq.value, hour: parseInt(hour.value, 10) };
    stateEl.textContent = 'Saving…';
    const r = await window.lcino.scheduleSet(cfg).catch(() => null);
    stateEl.textContent = r && r.ok
      ? (cfg.schedule === 'off' ? 'Schedule is off' : `Saved — scans ${cfg.schedule} at ${String(cfg.hour).padStart(2, '0')}:00 ✓`)
      : 'Could not save — check that LcinoCare can write to your LaunchAgents folder';
  }));
}

// ── cleanup manager (System Junk / Mail Attachments / Trash Bins) ─────────

const cm = { pane: 'system', moduleId: null, sort: 'size' };

function cmSortedItems(items) {
  const list = [...items];
  return cm.sort === 'name' ? list.sort((a, b) => a.label.localeCompare(b.label)) : list.sort((a, b) => b.sizeBytes - a.sizeBytes);
}

function cmMenuHtml(id, options, current) {
  return `
    <button class="mgr-select" id="${id}">Select: <b>${esc(current)}</b> <svg width="10" height="7" viewBox="0 0 10 7" style="color:var(--mgr-accent)"><path d="M1 1.5l4 4 4-4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg></button>
    <div class="mgr-menu hidden" id="${id}-menu">
      ${options.map((o) => `<button data-cmopt="${o.id}">${esc(o.label)}</button>`).join('')}
    </div>`;
}

async function renderCleanupManager() {
  const view = $('#view-cleanup-manager');
  if (!state.scan) {
    view.innerHTML = emptyScan();
    bindScanButton(view);
    return;
  }
  const scan = state.scan;
  const sysGroups = scan.groups.filter((g) => g.id !== 'mail-attachments');
  const mailGroup = scan.groups.find((g) => g.id === 'mail-attachments')
    || { id: 'mail-attachments', label: 'Mail Attachments', color: '#c46aff', items: [] };

  if (!state.selectedClean.size) allSafeItems().forEach((i) => state.selectedClean.add(i.path));
  if (!cm.moduleId || !sysGroups.some((g) => g.id === cm.moduleId)) cm.moduleId = (sysGroups[0] || {}).id;

  const groupById = (id) => id === 'mail-attachments' ? mailGroup : sysGroups.find((g) => g.id === id);
  const activeGroup = cm.pane === 'trash' ? null : groupById(cm.pane === 'mail' ? 'mail-attachments' : cm.moduleId);

  // left nav
  const nav = `
    <div class="mgr-side">
      <button class="mgr-nav ${cm.pane === 'system' ? 'active' : ''}" data-cmpane="system">System Junk</button>
      <button class="mgr-nav ${cm.pane === 'mail' ? 'active' : ''}" data-cmpane="mail">Mail Attachments</button>
      <button class="mgr-nav ${cm.pane === 'trash' ? 'active' : ''}" data-cmpane="trash">Trash Bins</button>
    </div>`;

  // middle: module list
  const modules = cm.pane === 'trash'
    ? [{ id: 'trash', label: 'Trash Bins', color: '#8e8e93', sizeBytes: scan.trash.sizeBytes, badge: scan.trash.sizeBytes > 0 }]
    : cm.pane === 'mail'
      ? [mailGroup]
      : sysGroups;
  const modsHtml = modules.map((g) => {
    const total = g.id === 'trash' ? g.sizeBytes : g.items.reduce((s, i) => s + i.sizeBytes, 0);
    const isActive = (cm.pane === 'trash' && g.id === 'trash') || (activeGroup && activeGroup.id === g.id);
    return `
      <div class="mgr-mod ${isActive ? 'active' : ''}" data-cmmod="${g.id}">
        ${mgrTile(g.label, g.color)}
        <div class="mm-info">
          <div class="mm-name">${esc(g.label)}</div>
          <div class="mm-size">${fmtBytes(total)}</div>
        </div>
        ${total > 0 ? `<span class="mm-badge">${fmtBytes(total)}</span>` : '<span class="mm-badge dim">0 B</span>'}
      </div>`;
  }).join('');

  // right pane content
  let rightHtml = '';
  if (cm.pane === 'trash') {
    rightHtml = scan.trash.sizeBytes > 0
      ? `
        <div class="mgr-pane-title">Trash Bins</div>
        <div class="mgr-pane-desc">Everything you (or LcinoCare) threw away is still on the disk until the Trash is emptied. Emptying it frees the space permanently — this runs through Finder, the same as Finder → Empty Trash.</div>
        <div class="mgr-item">
          ${Icons.icon('trash', 34)}
          <div class="mi-info"><div class="mi-name">Trash</div><div class="mi-sub">Recoverable until emptied</div></div>
          <div class="mi-size">${fmtBytes(scan.trash.sizeBytes)}</div>
        </div>
        <div class="mgr-trash-actions"><button class="mgr-done" id="cm-empty-trash">Empty Trash</button></div>`
      : cmEmptyState('Trash Bins');
  } else if (!activeGroup || !activeGroup.items.length) {
    rightHtml = cmEmptyState(activeGroup ? activeGroup.label : 'This area');
  } else {
    const items = cmSortedItems(activeGroup.items);
    const rows = items.map((item) => `
      <div class="mgr-item" data-path="${esc(item.path)}">
        <input type="checkbox" class="cm-check" data-path="${esc(item.path)}" ${state.selectedClean.has(item.path) ? 'checked' : ''} />
        ${mgrTile(item.label, activeGroup.color)}
        <div class="mi-info"><div class="mi-name">${esc(item.label)}</div></div>
        <button class="mi-sparkle" data-reveal="${esc(item.path)}" title="Show in Finder">${Icons.glyph('folder', 15, 'currentColor')}</button>
        <div class="mi-size">${fmtBytes(item.sizeBytes)}</div>
        <button class="mi-chev" data-detail="cmd-${esc(item.id || item.path)}">›</button>
      </div>
      <div class="item-detail hidden" id="cmd-${esc(item.id || item.path)}">
        <b>What is this?</b> ${esc(item.whatItIs)}<br>
        <b>If deleted:</b> ${esc(item.appImpact)}
        ${item.requiresAppQuit ? `<div class="warn-line">Quit ${esc(item.appDisplayName || item.processNames.join(', '))} before deleting — LcinoCare will check this for you.</div>` : ''}
      </div>`).join('');
    const selOptions = [
      { id: 'smartly', label: 'Smartly' },
      { id: 'all', label: 'All' },
      { id: 'none', label: 'None' }
    ];
    const currentSel = activeGroup.items.every((i) => state.selectedClean.has(i.path))
      ? 'All'
      : activeGroup.items.some((i) => state.selectedClean.has(i.path)) ? 'Smartly' : 'None';
    rightHtml = `
      <div class="mgr-pane-title">${esc(activeGroup.label)}</div>
      <div class="mgr-pane-desc">${esc(activeGroup.items[0].whatItIs || '')}</div>
      <div class="mgr-controls">
        ${cmMenuHtml('cm-select', selOptions, currentSel)}
        <button class="mgr-select" id="cm-sort">Sort by: <b>${cm.sort === 'size' ? 'Size' : 'Name'}</b> <svg width="10" height="7" viewBox="0 0 10 7" style="color:var(--mgr-accent)"><path d="M1 1.5l4 4 4-4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg></button>
      </div>
      ${rows}`;
  }

  const selItems = selectedCleanItems();
  const selBytes = selItems.reduce((s, i) => s + (i.sizeBytes || 0), 0);
  view.innerHTML = `
    <div class="mgr">
      ${nav}
      <div class="mgr-mods">${modsHtml}</div>
      <div class="mgr-items">
        ${rightHtml}
        <div class="mgr-bar">
          <div class="mb-info">${selItems.length ? `${selItems.length} Item${selItems.length > 1 ? 's' : ''} Selected <span>|</span> ${fmtBytes(selBytes)}` : 'No Items Selected'}</div>
          <div class="mb-spacer"></div>
          <button class="mgr-done" id="cm-done" ${cm.pane === 'trash' || !selItems.length ? 'disabled' : ''}>Done</button>
        </div>
      </div>
    </div>`;

  // wiring
  view.querySelectorAll('[data-cmpane]').forEach((b) => b.onclick = () => { cm.pane = b.dataset.cmpane; renderCleanupManager(); });
  view.querySelectorAll('[data-cmmod]').forEach((el) => el.onclick = () => {
    const id = el.dataset.cmmod;
    if (id === 'trash') { cm.pane = 'trash'; }
    else { cm.pane = id === 'mail-attachments' ? 'mail' : 'system'; cm.moduleId = id; }
    renderCleanupManager();
  });
  view.querySelectorAll('.cm-check').forEach((cb) => cb.addEventListener('change', () => {
    if (cb.checked) state.selectedClean.add(cb.dataset.path);
    else state.selectedClean.delete(cb.dataset.path);
    refreshCmBar();
  }));
  view.querySelectorAll('[data-reveal]').forEach((b) => b.onclick = (ev) => { ev.stopPropagation(); window.lcino.reveal(b.dataset.reveal); });
  view.querySelectorAll('.mi-chev').forEach((b) => b.onclick = () => {
    const d = $(`#${CSS.escape(b.dataset.detail)}`);
    if (d) { d.classList.toggle('hidden'); b.classList.toggle('open'); }
  });
  const selBtn = $('#cm-select');
  if (selBtn) {
    const menu = $('#cm-select-menu');
    selBtn.onclick = (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); };
    menu.querySelectorAll('[data-cmopt]').forEach((o) => o.onclick = () => {
      const opt = o.dataset.cmopt;
      if (opt === 'all') activeGroup.items.forEach((i) => state.selectedClean.add(i.path));
      else if (opt === 'none') activeGroup.items.forEach((i) => state.selectedClean.delete(i.path));
      else activeGroup.items.forEach((i) => { if (i.safety === 'safe') state.selectedClean.add(i.path); else state.selectedClean.delete(i.path); });
      renderCleanupManager();
    });
  }
  const sortBtn = $('#cm-sort');
  if (sortBtn) sortBtn.onclick = () => { cm.sort = cm.sort === 'size' ? 'name' : 'size'; renderCleanupManager(); };

  const emptyBtn = $('#cm-empty-trash');
  if (emptyBtn) emptyBtn.onclick = () => {
    showModal({
      title: 'Empty the Trash?',
      bodyHtml: `Everything currently in the Trash will be <b>permanently deleted</b> (${fmtBytes(scan.trash.sizeBytes)}). This cannot be undone.`,
      confirmText: 'Empty Trash',
      danger: true,
      onConfirm: async () => {
        const r = await window.lcino.trashEmpty();
        if (r.ok) { toast('Trash emptied ✓'); await runScan2({ silent: true }); }
        else toast(`Could not empty Trash: ${esc(r.reason)}`, 'err');
      }
    });
  };

  $('#cm-done').onclick = () => confirmClean(selectedCleanItems());

  function refreshCmBar() {
    const items = selectedCleanItems();
    const info = view.querySelector('.mb-info');
    const done = $('#cm-done');
    info.innerHTML = items.length
      ? `${items.length} Item${items.length > 1 ? 's' : ''} Selected <span>|</span> ${fmtBytes(items.reduce((s, i) => s + (i.sizeBytes || 0), 0))}`
      : 'No Items Selected';
    done.disabled = cm.pane === 'trash' || !items.length;
  }
  void refreshCmBar;
}

function cmEmptyState(title) {
  return `
    <div class="mgr-empty">
      <svg viewBox="0 0 92 92" fill="none">
        <rect x="20" y="12" width="52" height="68" rx="10" fill="#efe9f8"/>
        <rect x="28" y="26" width="36" height="8" rx="4" fill="#d9c9f2"/>
        <rect x="28" y="40" width="28" height="8" rx="4" fill="#e6dcf7"/>
        <path d="M58 12 L72 26 L58 26 Z" fill="#d9c9f2"/>
        <rect x="8" y="58" width="22" height="8" rx="4" fill="#e6dcf7" stroke="#fff" stroke-dasharray="3 3"/>
      </svg>
      <div class="me-title">${esc(title)}</div>
      <div class="me-sub">There are no items to clean or fix in this area.<br>Everything is in order.</div>
    </div>`;
}

// ── performance manager (Login Items / Background Items) ──────────────────

const pm = { pane: 'login', selected: new Set(), maint: new Set() };

async function renderPerfManager() {
  const view = $('#view-perf-manager');
  view.innerHTML = '<div class="card empty"><div class="spinner"></div></div>';

  if (pm.pane === 'maintenance') { await renderMaintenancePane(view); return; }

  const data = await window.lcino.startupList();
  const loginItems = data.loginItems;
  const agents = data.agents || [];

  const nav = `
    <div class="mgr-side">
      <button class="mgr-nav ${pm.pane === 'login' ? 'active' : ''}" data-pmpane="login">Login Items</button>
      <button class="mgr-nav ${pm.pane === 'background' ? 'active' : ''}" data-pmpane="background">Background Items</button>
      <button class="mgr-nav ${pm.pane === 'maintenance' ? 'active' : ''}" data-pmpane="maintenance">Maintenance</button>
    </div>`;

  let contentHtml = '';
  if (pm.pane === 'login') {
    contentHtml = `
      <div class="mgr-pane-title">Login Items</div>
      <div class="mgr-pane-desc">Apps that open automatically every time you sign in. Keep the list short and your Mac gets to a usable desktop faster.</div>
      ${loginItems === null
        ? '<div class="mgr-note"><b>One-time permission needed.</b> macOS asks for Automation permission (System Events) to read this list. Grant it when prompted, or manage these in System Settings → General → Login Items.</div>'
        : loginItems.length
          ? loginItems.map((n) => `
            <div class="mgr-item">
              ${mgrTile(n, '#8b5cf6')}
              <div class="mi-info"><div class="mi-name">${esc(n)}</div></div>
              <span class="mm-badge dim">Login Item</span>
            </div>`).join('')
          : '<div class="mgr-note">No login items — nothing extra launches when you sign in.</div>'}
      <div class="mgr-note">macOS keeps this list read-only for cleaning apps — remove items in <b>System Settings → General → Login Items</b>.</div>`;
  } else {
    const userAgents = agents.filter((a) => a.scope === 'user');
    const rows = agents.map((a) => {
      const selectable = a.scope === 'user' && !a.disabled;
      return `
        <div class="mgr-item">
          ${selectable ? `<input type="checkbox" class="pm-check" data-path="${esc(a.path)}" ${pm.selected.has(a.path) ? 'checked' : ''} />` : ''}
          ${mgrTile(a.name, '#22b8cf')}
          <div class="mi-info">
            <div class="mi-name">${esc(a.name)} ${a.disabled ? '<span class="mm-badge dim" style="margin-left:6px">Disabled</span>' : ''}</div>
            <div class="mi-sub" title="${esc(a.path)}">${esc(shortPath(a.path, 64))}</div>
          </div>
          <button class="mi-sparkle" data-reveal="${esc(a.path)}" title="Show in Finder">${Icons.glyph('folder', 15, 'currentColor')}</button>
          ${a.scope !== 'user' ? '<span class="mm-badge dim">System</span>' : ''}
        </div>`;
    }).join('');
    contentHtml = `
      <div class="mgr-pane-title">Background Items</div>
      <div class="mgr-pane-desc">Helpers registered with launchd that run outside the login list. Disabling a user agent moves its plist into a folder macOS never loads — fully reversible.</div>
      <div class="mgr-controls">
        <button class="mgr-select" id="pm-select">Select: <b>${pm.selected.size ? 'Selected' : 'None'}</b> <svg width="10" height="7" viewBox="0 0 10 7" style="color:var(--mgr-accent)"><path d="M1 1.5l4 4 4-4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg></button>
        <div class="mgr-menu hidden" id="pm-select-menu">
          <button data-pmopt="none">None</button>
          <button data-pmopt="all">All enable-able</button>
        </div>
      </div>
      ${rows || '<div class="mgr-note">No launch agents or daemons found.</div>'}`;
  }

  const count = pm.selected.size;
  view.innerHTML = `
    <div class="mgr two">
      ${nav}
      <div class="mgr-items">
        ${contentHtml}
        <div class="mgr-bar">
          <div class="mb-info">${count ? `${count} Item${count > 1 ? 's' : ''} Selected` : 'No Items Selected'}</div>
          <div class="mb-spacer"></div>
          <button class="mgr-done" id="pm-done" ${!count ? 'disabled' : ''}>Done</button>
        </div>
      </div>
    </div>`;

  view.querySelectorAll('[data-pmpane]').forEach((b) => b.onclick = () => { pm.pane = b.dataset.pmpane; renderPerfManager(); });
  view.querySelectorAll('.pm-check').forEach((cb) => cb.addEventListener('change', () => {
    if (cb.checked) pm.selected.add(cb.dataset.path);
    else pm.selected.delete(cb.dataset.path);
    const info = view.querySelector('.mb-info');
    info.textContent = pm.selected.size ? `${pm.selected.size} Item${pm.selected.size > 1 ? 's' : ''} Selected` : 'No Items Selected';
    $('#pm-done').disabled = !pm.selected.size;
  }));
  view.querySelectorAll('[data-reveal]').forEach((b) => b.onclick = (ev) => { ev.stopPropagation(); window.lcino.reveal(b.dataset.reveal); });
  const selBtn = $('#pm-select');
  if (selBtn) {
    const menu = $('#pm-select-menu');
    selBtn.onclick = (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); };
    menu.querySelectorAll('[data-pmopt]').forEach((o) => o.onclick = () => {
      pm.selected.clear();
      if (o.dataset.pmopt === 'all') {
        agents.filter((a) => a.scope === 'user' && !a.disabled).forEach((a) => pm.selected.add(a.path));
      }
      renderPerfManager();
    });
  }
  $('#pm-done').onclick = async () => {
    const paths = [...pm.selected];
    setOverlay(true, 'Disabling background items…', 40);
    let okCount = 0;
    for (const p of paths) {
      const r = await window.lcino.startupSetDisabled({ path: p, disabled: true });
      if (r && r.ok) okCount += 1;
    }
    setOverlay(false);
    pm.selected.clear();
    if (okCount === paths.length) toast(`${okCount} background item${okCount > 1 ? 's' : ''} disabled — takes effect on next sign-in`);
    else toast(`Disabled ${okCount} of ${paths.length} — the rest need manual attention`, 'err');
    renderPerfManager();
  };
}

// ── maintenance pane (real macOS tasks) ──────────────────────────────────

async function renderMaintenancePane(view) {
  view.innerHTML = '<div class="card empty"><div class="spinner"></div></div>';
  const tasks = await window.lcino.maintenanceList();
  const rows = tasks.map((t) => `
    <div class="mgr-item maint-item">
      <input type="checkbox" class="mt-check" data-mt="${esc(t.id)}" ${pm.maint.has(t.id) ? 'checked' : ''} />
      <div class="mi-info">
        <div class="mi-name">${esc(t.label)}
          ${t.needsAdmin ? '<span class="mm-badge dim" title="macOS will ask for your password once" style="margin-left:6px">🔑 Admin</span>' : ''}
          ${t.requiresAppQuit ? `<span class="mm-badge dim" style="margin-left:6px">Quits ${esc(t.requiresAppQuit.join(', '))}</span>` : ''}
        </div>
        <div class="mi-sub">${esc(t.description)}</div>
      </div>
    </div>`).join('');

  view.innerHTML = `
    <div class="mgr two">
      <div class="mgr-side">
        <button class="mgr-nav ${pm.pane === 'login' ? 'active' : ''}" data-pmpane="login">Login Items</button>
        <button class="mgr-nav ${pm.pane === 'background' ? 'active' : ''}" data-pmpane="background">Background Items</button>
        <button class="mgr-nav active" data-pmpane="maintenance">Maintenance</button>
      </div>
      <div class="mgr-items">
        <div class="mgr-pane-title">Maintenance Tasks</div>
        <div class="mgr-pane-desc">Genuine macOS housekeeping, straight from the system toolbox. Tasks marked 🔑 ask for your administrator password once — the same dialog an installer shows. Nothing runs without you ticking it.</div>
        ${rows}
        <div class="mgr-bar">
          <div class="mb-info" id="mt-info">${pm.maint.size ? `${pm.maint.size} task${pm.maint.size > 1 ? 's' : ''} selected` : 'No Tasks Selected'}</div>
          <div class="mb-spacer"></div>
          <button class="mgr-done" id="mt-run" ${pm.maint.size ? '' : 'disabled'}>Run Tasks</button>
        </div>
      </div>
    </div>`;

  view.querySelectorAll('.mt-check').forEach((cb) => cb.addEventListener('change', () => {
    if (cb.checked) pm.maint.add(cb.dataset.mt);
    else pm.maint.delete(cb.dataset.mt);
    const info = view.querySelector('#mt-info');
    info.textContent = pm.maint.size ? `${pm.maint.size} task${pm.maint.size > 1 ? 's' : ''} selected` : 'No Tasks Selected';
    $('#mt-run').disabled = !pm.maint.size;
  }));
  view.querySelectorAll('[data-pmpane]').forEach((b) => b.onclick = () => { pm.pane = b.dataset.pmpane; renderPerfManager(); });
  $('#mt-run').onclick = () => runMaintenance([...pm.maint]);
}

async function runMaintenance(ids) {
  if (!ids.length) return;
  // Mail task quits Mail — check first, same courtesy as cleanup
  const tasks = await window.lcino.maintenanceList();
  const quitApps = [...new Set(tasks.filter((t) => ids.includes(t.id) && t.requiresAppQuit).flatMap((t) => t.requiresAppQuit))];
  const proceed = async () => {
    setOverlay(true, 'Running maintenance tasks…', 10);
    const { results } = await window.lcino.maintenanceRun(ids);
    setOverlay(false);
    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    showModal({
      title: 'Maintenance report',
      bodyHtml: `${ok.map((r) => `<div class="mt-line ok">✓ <b>${esc(r.label)}</b> — ${esc(r.detail || 'Completed.')}</div>`).join('')}
        ${failed.map((r) => `<div class="mt-line err">✕ <b>${esc(r.label)}</b> — ${esc(r.reason)}</div>`).join('')}`,
      confirmText: 'Done',
      onConfirm: async () => { pm.maint.clear(); renderPerfManager(); }
    });
  };
  if (quitApps.length) {
    const running = await window.lcino.appRunning(quitApps);
    if (running.length) {
      showModal({
        title: 'An app needs to quit first',
        bodyHtml: `<b>${esc(running.map((r) => r.display || r.name).join(', '))}</b> is holding files that maintenance needs. Quit it gracefully and continue?`,
        confirmText: 'Quit & Continue',
        onConfirm: async () => {
          await window.lcino.quitApps(running.flatMap((r) => r.pids));
          for (let i = 0; i < 6; i++) { await sleep(1000); if (!(await window.lcino.appRunning(quitApps)).length) break; }
          proceed();
        }
      });
      return;
    }
  }
  proceed();
}

// ── downloads tool ───────────────────────────────────────────────────────

const dl = { sort: 'size', items: null, selected: new Set() };

function renderDownloads() {
  const view = $('#view-land-downloads');
  view.innerHTML = '<div class="card empty"><div class="spinner"></div></div>';
  if (dl.items === null) { refreshDownloads(); return; }

  const items = [...dl.items].sort(dl.sort === 'size'
    ? (a, b) => b.sizeBytes - a.sizeBytes
    : (a, b) => b.mtimeMs - a.mtimeMs);
  const kindColor = { installer: '#bf5af2', video: '#ff453a', audio: '#30d158', image: '#0a84ff', document: '#ff9f0a', code: '#22b8cf', other: '#8e8e93' };
  const sel = items.filter((i) => dl.selected.has(i.path));
  const selBytes = sel.reduce((s, i) => s + (i.sizeBytes || 0), 0);

  view.innerHTML = `
    <div class="mgr two">
      <div class="mgr-side">
        <button class="mgr-nav active">Downloads</button>
        <button class="mgr-nav" data-dl-view="files">Large Files</button>
        <button class="mgr-nav" data-dl-view="duplicates">Duplicates</button>
      </div>
      <div class="mgr-items">
        <div class="mgr-pane-title">Downloads</div>
        <div class="mgr-pane-desc">Everything in your Downloads folder, oldest habits first. Select the one-time files and send them to the Trash — recoverable, as always.</div>
        <div class="mgr-controls">
          <button class="mgr-select" id="dl-select">Select: <b>${dl.selected.size ? 'Selected' : 'None'}</b> <svg width="10" height="7" viewBox="0 0 10 7" style="color:var(--mgr-accent)"><path d="M1 1.5l4 4 4-4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg></button>
          <div class="mgr-menu hidden" id="dl-select-menu">
            <button data-dlopt="none">None</button>
            <button data-dlopt="all">All</button>
            <button data-dlopt="installers">All installers</button>
          </div>
          <button class="mgr-select" id="dl-sort">Sort by: <b>${dl.sort === 'size' ? 'Size' : 'Date'}</b> <svg width="10" height="7" viewBox="0 0 10 7" style="color:var(--mgr-accent)"><path d="M1 1.5l4 4 4-4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg></button>
          <button class="mgr-select" id="dl-rescan">↻ Rescan</button>
        </div>
        ${items.length ? items.map((i) => `
          <div class="mgr-item">
            <input type="checkbox" class="dl-check" data-path="${esc(i.path)}" ${dl.selected.has(i.path) ? 'checked' : ''} />
            ${mgrTile(i.label, kindColor[i.kind] || '#8e8e93')}
            <div class="mi-info">
              <div class="mi-name">${esc(i.label)}</div>
              <div class="mi-sub">${esc(tilt(i.path))}</div>
            </div>
            <button class="mi-sparkle" data-reveal="${esc(i.path)}" title="Show in Finder">${Icons.glyph('folder', 15, 'currentColor')}</button>
            <div class="mi-size">${fmtBytes(i.sizeBytes)}</div>
          </div>`).join('')
        : '<div class="mgr-empty"><div class="me-title">Downloads is tidy</div><div class="me-sub">No files over 256 KB to review. Everything is in order.</div></div>'}
        <div class="mgr-bar">
          <div class="mb-info">${sel.length ? `${sel.length} Item${sel.length > 1 ? 's' : ''} Selected <span>|</span> ${fmtBytes(selBytes)}` : 'No Items Selected'}</div>
          <div class="mb-spacer"></div>
          <button class="mgr-done" id="dl-clean" ${sel.length ? '' : 'disabled'}>Move to Trash</button>
        </div>
      </div>
    </div>`;

  view.querySelectorAll('.dl-check').forEach((cb) => cb.addEventListener('change', () => {
    if (cb.checked) dl.selected.add(cb.dataset.path);
    else dl.selected.delete(cb.dataset.path);
    const s2 = items.filter((i) => dl.selected.has(i.path));
    view.querySelector('.mb-info').innerHTML = s2.length
      ? `${s2.length} Item${s2.length > 1 ? 's' : ''} Selected <span>|</span> ${fmtBytes(s2.reduce((s, i) => s + (i.sizeBytes || 0), 0))}`
      : 'No Items Selected';
    $('#dl-clean').disabled = !s2.length;
  }));
  view.querySelectorAll('[data-reveal]').forEach((b) => b.onclick = (ev) => { ev.stopPropagation(); window.lcino.reveal(b.dataset.reveal); });
  view.querySelectorAll('[data-dl-view]').forEach((b) => b.onclick = () => showView(b.dataset.dlView));
  $('#dl-sort').onclick = () => { dl.sort = dl.sort === 'size' ? 'date' : 'size'; renderDownloads(); };
  $('#dl-rescan').onclick = () => refreshDownloads();
  const selBtn = $('#dl-select');
  const menu = $('#dl-select-menu');
  selBtn.onclick = (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); };
  menu.querySelectorAll('[data-dlopt]').forEach((o) => o.onclick = () => {
    const opt = o.dataset.dlopt;
    dl.selected.clear();
    if (opt === 'all') items.forEach((i) => dl.selected.add(i.path));
    if (opt === 'installers') items.filter((i) => i.kind === 'installer').forEach((i) => dl.selected.add(i.path));
    renderDownloads();
  });
  $('#dl-clean').onclick = () => {
    const chosen = items.filter((i) => dl.selected.has(i.path)).map((i) => ({ id: i.id, path: i.path, sizeBytes: i.sizeBytes }));
    // showTrashConfirm handles the whole chain: confirm → clean → rescan → empty-trash offer
    showTrashConfirm(chosen);
  };
}

async function refreshDownloads() {
  const view = $('#view-land-downloads');
  view.innerHTML = '<div class="card empty"><div class="spinner"></div></div>';
  const r = await window.lcino.downloadsScan();
  dl.items = r.ok ? r.items : [];
  dl.selected.clear();
  renderDownloads();
}

// ── privacy items tool ───────────────────────────────────────────────────

const pv = { data: null, active: null, selected: new Set() };

const BROWSER_APP = {
  chrome: 'Google Chrome', edge: 'Microsoft Edge', brave: 'Brave',
  arc: 'Arc', safari: 'Safari', firefox: 'Firefox'
};

async function renderPrivacyTool() {
  const view = $('#view-land-privacy');
  if (!pv.data) { await refreshPrivacy(); return; }
  const { browsers } = pv.data;
  if (!browsers.length) {
    view.innerHTML = `
      <div class="mgr two">
        <div class="mgr-side"><button class="mgr-nav active">Privacy</button></div>
        <div class="mgr-items">
          <div class="mgr-empty">
            <svg viewBox="0 0 92 92" fill="none"><path d="M46 10l30 11v22c0 19-12 31-30 38-18-7-30-19-30-38V21z" fill="#efe9f8"/><path d="M33 46l9 9 17-19" stroke="#b9a3e6" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <div class="me-title">Browsers are tidy</div>
            <div class="me-sub">No browsing history, cookies, or storage leftovers found<br>in the browsers installed on this Mac.</div>
          </div>
        </div>
      </div>`;
    return;
  }
  if (!pv.active || !browsers.some((b) => b.id === pv.active)) pv.active = browsers[0].id;
  const b = browsers.find((x) => x.id === pv.active);
  const cats = b.categories;
  const selectedCats = cats.filter((c) => pv.selected.has(c.id));
  const selItems = selectedCats.flatMap((c) => c.items);
  const selBytes = selectedCats.reduce((s, c) => s + c.sizeBytes, 0);

  view.innerHTML = `
    <div class="mgr two">
      <div class="mgr-side">
        ${browsers.map((x) => `<button class="mgr-nav ${x.id === pv.active ? 'active' : ''}" data-pv-nav="${x.id}">${esc(x.name)}</button>`).join('')}
      </div>
      <div class="mgr-items">
        <div class="mgr-pane-title">${esc(b.name)} Privacy</div>
        <div class="mgr-pane-desc">Traces ${esc(b.name)} keeps about what you did online. Cleaning sends them to the Trash — the browser simply starts a fresh history. ${esc(b.name)} must quit first; LcinoCare will check.</div>
        ${b.blocked ? '<div class="mgr-note"><b>macOS is guarding this data.</b> Grant LcinoCare\'s host app Full Disk Access (System Settings → Privacy &amp; Security) to read Safari\'s sizes — cleaning stays blocked until then.</div>' : ''}
        ${cats.map((c) => `
          <div class="mgr-item">
            <input type="checkbox" class="pv-check" data-pv="${esc(c.id)}" ${pv.selected.has(c.id) ? 'checked' : ''} />
            <div class="mi-info"><div class="mi-name">${esc(c.label)}</div><div class="mi-sub">${c.items.length} file${c.items.length > 1 ? 's' : ''} across profiles</div></div>
            <div class="mi-size">${fmtBytes(c.sizeBytes)}</div>
          </div>`).join('')}
        <div class="mgr-bar">
          <div class="mb-info">${selItems.length ? `${selItems.length} item${selItems.length > 1 ? 's' : ''} · ${fmtBytes(selBytes)}` : 'Nothing Selected'}</div>
          <div class="mb-spacer"></div>
          <button class="mgr-done" id="pv-clean" ${selItems.length && !b.blocked ? '' : 'disabled'}>Clean Selected</button>
        </div>
      </div>
    </div>`;

  view.querySelectorAll('[data-pv-nav]').forEach((btn) => btn.onclick = () => { pv.active = btn.dataset.pvNav; pv.selected.clear(); renderPrivacyTool(); });
  view.querySelectorAll('.pv-check').forEach((cb) => cb.addEventListener('change', () => {
    if (cb.checked) pv.selected.add(cb.dataset.pv);
    else pv.selected.delete(cb.dataset.pv);
    const s2 = cats.filter((c) => pv.selected.has(c.id));
    const it2 = s2.flatMap((c) => c.items);
    view.querySelector('.mb-info').innerHTML = it2.length
      ? `${it2.length} item${it2.length > 1 ? 's' : ''} · ${fmtBytes(s2.reduce((s, c) => s + c.sizeBytes, 0))}`
      : 'Nothing Selected';
    $('#pv-clean').disabled = !it2.length || b.blocked;
  }));
  $('#pv-clean').onclick = async () => {
    const items = selectedCats.flatMap((c) => c.items.map((i, idx) => ({
      id: i.id, path: i.path, sizeBytes: idx === 0 ? c.sizeBytes : 0
    })));
    const appName = BROWSER_APP[b.id] || b.name;
    const running = await window.lcino.appRunning([appName]);
    const doClean = async () => {
      setOverlay(true, `Cleaning ${appName} privacy items…`, 40);
      const { results, freedBytes } = await window.lcino.privacyClean(items);
      setOverlay(false);
      const failed = results.filter((r) => !r.ok);
      if (failed.length === results.length) toast(`Could not clean: ${failed[0].reason}`, 'err');
      else toast(`${fmtBytes(freedBytes)} of privacy traces moved to Trash ✓`);
      pv.selected.clear();
      await refreshPrivacy();
    };
    if (running.length) {
      showModal({
        title: `${appName} needs to quit first`,
        bodyHtml: `<b>${esc(appName)}</b> is running and locking the files you selected. Quit it gracefully and continue? Unsaved tabs may ask to confirm.`,
        confirmText: 'Quit & Continue',
        onConfirm: async () => {
          await window.lcino.quitApps(running.flatMap((r) => r.pids));
          for (let i = 0; i < 6; i++) { await sleep(1000); if (!(await window.lcino.appRunning([appName])).length) break; }
          await doClean();
        }
      });
    } else {
      await doClean();
    }
  };
}

async function refreshPrivacy() {
  const view = $('#view-land-privacy');
  view.innerHTML = '<div class="card empty"><div class="spinner"></div></div>';
  pv.data = await window.lcino.privacyScan();
  pv.selected.clear();
  renderPrivacyTool();
}

// ── similar images tool ──────────────────────────────────────────────────

const si = { groups: null, scanned: 0, selected: new Set() };

function renderSimilarImages() {
  const view = $('#view-land-similar');
  if (si.groups === null) {
    view.innerHTML = `
      <div class="mgr two">
        <div class="mgr-side"><button class="mgr-nav active">Similar Images</button></div>
        <div class="mgr-items">
          <div class="mgr-empty">
            <svg viewBox="0 0 92 92" fill="none"><rect x="14" y="18" width="46" height="46" rx="9" fill="#e2f4f6" transform="rotate(-6 37 41)"/><rect x="32" y="26" width="46" height="46" rx="9" fill="#cdeaf0" transform="rotate(5 55 49)"/><circle cx="55" cy="49" r="9" fill="#8fd0dc"/></svg>
            <div class="me-title">Find near-duplicate photos</div>
            <div class="me-sub">LcinoCare hashes every image in Pictures and groups the ones that<br>look almost identical — bursts, exports, and copies. Trash-only cleanup.</div>
            <div style="margin-top:16px"><button class="btn primary" id="si-scan">Scan Pictures</button></div>
          </div>
        </div>
      </div>`;
    $('#si-scan').onclick = () => runSimilarScan();
    return;
  }

  const all = si.groups.flatMap((g) => g.items);
  const sel = all.filter((i) => si.selected.has(i.path));
  const selBytes = sel.reduce((s, i) => s + (i.sizeBytes || 0), 0);

  view.innerHTML = `
    <div class="mgr two">
      <div class="mgr-side">
        <button class="mgr-nav active">Similar Images</button>
        <button class="mgr-nav" id="si-rescan">↻ Rescan</button>
      </div>
      <div class="mgr-items">
        <div class="mgr-pane-title">Similar Images</div>
        <div class="mgr-pane-desc">${si.groups.length} similar group${si.groups.length === 1 ? '' : 's'} found in Pictures (${si.scanned} images hashed). The newest copy is suggested to keep — click any thumbnail to change what gets removed.</div>
        ${si.groups.length ? si.groups.map((g) => `
          <div class="si-group">
            <div class="si-group-head">
              <b>${g.items.length} similar</b>
              <span>${fmtBytes(g.items.reduce((s, i) => s + i.sizeBytes, 0))} total · potential save ${fmtBytes(g.items.slice(1).reduce((s, i) => s + i.sizeBytes, 0))}</span>
            </div>
            <div class="si-thumbs">
              ${g.items.map((i, idx) => `
                <div class="si-thumb ${idx === 0 ? 'keep' : ''} ${si.selected.has(i.path) ? 'selected' : ''}" data-si-path="${esc(i.path)}" title="${esc(tilt(i.path))}">
                  ${i.thumb ? `<img src="${i.thumb}" alt="" />` : '<span class="si-noimg">🖼</span>'}
                  ${idx === 0 ? '<span class="si-keep">Keep</span>' : ''}
                  ${si.selected.has(i.path) ? '<span class="si-sel">✕</span>' : ''}
                </div>`).join('')}
            </div>
          </div>`).join('')
        : '<div class="mgr-note">No similar images found — Pictures is tidy.</div>'}
        <div class="mgr-bar">
          <div class="mb-info">${sel.length ? `${sel.length} selected <span>|</span> ${fmtBytes(selBytes)}` : 'Nothing Selected'}</div>
          <div class="mb-spacer"></div>
          <button class="mgr-done" id="si-clean" ${sel.length ? '' : 'disabled'}>Move to Trash</button>
        </div>
      </div>
    </div>`;

  view.querySelectorAll('.si-thumb').forEach((t) => t.onclick = () => {
    const p = t.dataset.siPath;
    if (si.selected.has(p)) si.selected.delete(p);
    else si.selected.add(p);
    renderSimilarImages();
  });
  $('#si-rescan').onclick = () => { si.groups = null; si.selected.clear(); renderSimilarImages(); };
  $('#si-clean').onclick = () => {
    const items = sel.map((i) => ({ id: `si-${i.path}`, path: i.path, sizeBytes: i.sizeBytes }));
    showTrashConfirm(items);
  };
}

async function runSimilarScan() {
  setOverlay(true, 'Hashing images…', 40);
  const r = await window.lcino.similarScan();
  setOverlay(false);
  if (!r.ok) { toast('Similar-image scan failed.', 'err'); return; }
  si.groups = r.groups;
  si.scanned = r.scanned || 0;
  si.selected.clear();
  // auto-select everything except each group's suggested keeper (first = newest)
  si.groups.forEach((g) => g.items.slice(1).forEach((i) => si.selected.add(i.path)));
  renderSimilarImages();
  if (!r.groups.length) toast(`${r.scanned} images hashed — no similar groups found.`);
  else toast(`${r.groupCount} similar group${r.groupCount === 1 ? '' : 's'} found in ${r.scanned} images.`);
}


// ── app updater tool ─────────────────────────────────────────────────────

const ut = { data: null };

function renderUpdates() {
  const view = $('#view-land-updates');
  if (!ut.data) { runUpdatesScan(); return; }
  const { apps, updates, withFeed, noFeed } = ut.data;

  const row = (a, dim = false) => `
    <div class="mgr-item" style="${dim ? 'opacity:.62' : ''}">
      ${mgrTile(a.name, a.hasUpdate ? '#ff9f0a' : '#30d158')}
      <div class="mi-info">
        <div class="mi-name">${esc(a.name)} <span class="app-ver">${esc(a.version)}${a.hasUpdate ? ' → ' + esc(a.latest) : ''}</span></div>
        <div class="mi-sub">${a.hasUpdate ? 'New version advertised by the app\'s own update feed' : a.hasFeed ? 'Up to date with its update feed' : 'No public update feed — updates manually'}</div>
      </div>
      ${a.hasUpdate && a.feedUrl ? `<button class="btn small primary" data-open="${esc(a.feedUrl)}">Get Update</button>` : ''}
    </div>`;

  const outdated = apps.filter((a) => a.hasUpdate);
  const fresh = apps.filter((a) => a.hasFeed && !a.hasUpdate);

  view.innerHTML = `
    <div class="mgr two">
      <div class="mgr-side">
        <button class="mgr-nav active">App Updater</button>
        <button class="mgr-nav" data-ut-view="apps">Applications</button>
        <button class="mgr-nav" data-ut-view="downloads-tool">Downloads</button>
      </div>
      <div class="mgr-items">
        <div class="mgr-pane-title">App Updater</div>
        <div class="mgr-pane-desc">LcinoCare checks the update feed each app publishes about itself (Sparkle). No invented version numbers, no fake alerts — what the developer advertises is what you see.</div>
        <div class="mgr-controls">
          <span class="mgr-note" style="margin:0">${withFeed} app${withFeed === 1 ? '' : 's'} with a public feed · ${noFeed} update manually</span>
          <button class="mgr-select" id="ut-rescan">↻ Rescan</button>
        </div>
        ${outdated.length ? `
          <div class="section-head" style="margin:6px 2px 8px"><h3 style="font-size:14px">Update available (${outdated.length})</h3></div>
          ${outdated.map((a) => row(a)).join('')}` : `
          <div class="mgr-note" style="margin-bottom:14px">✓ Everything with a public feed is up to date.</div>`}
        ${fresh.length ? `
          <div class="section-head" style="margin:14px 2px 8px"><h3 style="font-size:14px">Up to date (${fresh.length})</h3></div>
          ${fresh.map((a) => row(a, true)).join('')}` : ''}
        ${noFeed ? `<div class="mgr-note" style="margin-top:14px">${noFeed} app${noFeed === 1 ? '' : 's'} don't publish a checkable feed — they update themselves or through the App Store. LcinoCare won't guess for them.</div>` : ''}
      </div>
    </div>`;

  view.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => window.lcino.openExternal(b.dataset.open));
  view.querySelectorAll('[data-ut-view]').forEach((b) => b.onclick = () => showView(b.dataset.utView));
  $('#ut-rescan').onclick = () => runUpdatesScan();
}

async function runUpdatesScan() {
  const view = $('#view-land-updates');
  view.innerHTML = '<div class="card empty"><div class="spinner"></div></div>';
  ut.data = await window.lcino.updatesScan();
  renderUpdates();
}

// ── my clutter (bubble map) ───────────────────────────────────────────────

let clutterCache = null;
const sl = { root: null, name: 'Home Folder' }; // Space Lens location (null = home)
let clutterPartial = [];

// Greedy golden-angle spiral packing — organic, no overlaps, area-proportional.
// Radii are capped so two giants can always coexist inside the box.
function packBubbles(items, box) {
  const total = items.reduce((s, v) => s + v.sizeBytes, 0) || 1;
  const cap = box * 0.27;
  const baseR = Math.sqrt((0.5 * box * box) / Math.PI);
  const placed = [];
  const overlaps = (x, y, r) => placed.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + r + 3);
  items.forEach((v, i) => {
    const r = Math.max(16, Math.min(cap, Math.sqrt(v.sizeBytes / total) * baseR));
    if (i === 0) { placed.push({ ...v, x: box / 2, y: box / 2, r, rank: i }); return; }
    let angle = i * 2.399963;
    let rad = r + 6;
    let x = box / 2, y = box / 2, found = false;
    for (let step = 0; step < 8000 && !found; step++) {
      x = box / 2 + Math.cos(angle) * rad;
      y = box / 2 + Math.sin(angle) * rad;
      if (x - r > -2 && x + r < box + 2 && y - r > -2 && y + r < box + 2 && !overlaps(x, y, r)) found = true;
      angle += 0.35;
      rad += 0.9;
    }
    if (!found) { x = 20 + Math.random() * (box - 40); y = 20 + Math.random() * (box - 40); }
    placed.push({ ...v, x, y, r, rank: i });
  });
  return placed;
}


// Space Lens location selector (Home / Macintosh HD / iCloud Drive / volumes / Choose Folder…)
async function wireClutterLocation(view) {
  const btn = view.querySelector('#clutter-loc');
  if (!btn) return;
  const locs = await window.lcino.listLocations().catch(() => []);
  let menu = view.querySelector('#clutter-loc-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.className = 'mgr-menu hidden';
    menu.id = 'clutter-loc-menu';
    btn.parentElement.style.position = 'relative';
    btn.parentElement.appendChild(menu);
  }
  menu.innerHTML = `
    ${locs.map((l) => `<button data-loc="${esc(l.path)}" data-name="${esc(l.name)}">${esc(l.name)}${l.fullDisk ? ' (full disk)' : ''}</button>`).join('')}
    <button data-loc="choose">Choose Folder…</button>`;
  btn.onclick = (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); };
  menu.querySelectorAll('[data-loc]').forEach((o) => o.onclick = async () => {
    menu.classList.add('hidden');
    if (o.dataset.loc === 'choose') {
      const picked = await window.lcino.chooseFolder();
      if (!picked) return;
      sl.root = picked;
      sl.name = picked.split('/').pop() || picked;
    } else {
      sl.root = o.dataset.loc === locs[0]?.path ? null : o.dataset.loc; // home uses the default engine path
      sl.name = o.dataset.name;
    }
    clutterCache = null;
    renderClutter();
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && e.target !== btn) menu.classList.add('hidden');
  }, { once: true });
}
async function renderClutter() {
  const view = $('#view-clutter');

  const drawMap = (entries, { partial = false, detail = '' } = {}) => {
    const top = entries.filter((e) => e.sizeBytes > 1024 * 1024).slice(0, 18);
    const box = 620;
    const bubbles = packBubbles(top, box);
    const hueBase = 272;
    const svg = bubbles.length ? `
      <svg width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">
        ${bubbles.map((b) => {
          const hue = hueBase + (b.rank % 6) * 14;
          const light = 60 - Math.min(18, b.rank * 1.4);
          const label = b.r > 34 ? `<text x="${b.x}" y="${b.y + (b.r > 48 ? -2 : 4)}" text-anchor="middle" fill="rgba(255,255,255,.95)" font-size="${Math.min(15, Math.max(10, b.r / 4.4))}" font-weight="700" font-family="-apple-system">${esc(b.name.length > Math.floor(b.r / 5.2) ? b.name.slice(0, Math.max(3, Math.floor(b.r / 5.2)) - 1) + '…' : b.name)}</text>` : '';
          const sizeLbl = b.r > 52 ? `<text x="${b.x}" y="${b.y + 15}" text-anchor="middle" fill="rgba(255,255,255,.75)" font-size="11" font-weight="600" font-family="-apple-system">${fmtBytes(b.sizeBytes)}</text>` : '';
          return `<g class="bubble" data-path="${esc(b.path)}" data-name="${esc(b.name)}" data-size="${b.sizeBytes}">
            <circle cx="${b.x}" cy="${b.y}" r="${b.r}" fill="hsl(${hue} 72% ${light}%)" opacity="0.92">
              <title>${esc(b.name)} — ${fmtBytes(b.sizeBytes)}</title>
            </circle>
            ${label}${sizeLbl}
          </g>`;
        }).join('')}
      </svg>` : '';
    const progressLine = partial ? `
      <div style="position:absolute;left:0;right:0;bottom:14px;display:flex;justify-content:center">
        <span class="badge acc" style="font-size:12px;padding:6px 14px">
          <span class="mini-spinner"></span>&nbsp; ${esc(detail || 'Measuring…')}
        </span>
      </div>` : '';
    const emptyNote = (!partial && !entries.length) ? `
      <div class="mgr-note" style="position:absolute;left:10%;right:10%;bottom:20px;text-align:center">
        Nothing measurable here — the folder may be empty, or macOS is guarding it.
        For protected locations (iCloud Drive, other Library areas) grant LcinoCare's host app
        <b>Full Disk Access</b> in System Settings → Privacy &amp; Security.
      </div>` : '';
    const residentsCard = partial ? '' : `
      <div class="card" style="margin-top:14px">
        <h3>Biggest residents</h3>
        <div class="sub">Click any bubble for details, or open it straight in Finder.</div>
        ${top.slice(0, 6).map((e) => `
          <div class="row">
            ${Icons.icon(e.isDir ? 'clutter' : 'files', 26)}
            <div class="info"><div class="name">${esc(e.name)}</div><div class="path">${esc(shortPath(e.path))}</div></div>
            <div class="size">${fmtBytes(e.sizeBytes)}</div>
            <button class="btn small" data-reveal="${esc(e.path)}">Show</button>
          </div>`).join('')}
      </div>`;
    view.innerHTML = `
      <div class="section-head">
        <h2>My Clutter — what's eating <span id="clutter-loc-name">${esc(sl.name)}</span></h2>
        <div class="actions">
          <button class="mgr-select" id="clutter-loc" style="border:1px solid var(--card-border);border-radius:9px">📁 <b>${esc(sl.name)}</b> <svg width="10" height="7" viewBox="0 0 10 7" style="color:var(--acc)"><path d="M1 1.5l4 4 4-4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg></button>
          <button class="btn small" id="clutter-rescan">↻ Remap</button>
        </div>
      </div>
      <div class="clutter-stage" id="clutter-stage">${svg}${progressLine}${emptyNote}</div>
      ${residentsCard}`;
    $('#clutter-rescan').onclick = () => { clutterCache = null; renderClutter(); };
    wireClutterLocation(view);
    view.querySelectorAll('[data-reveal]').forEach((b) => b.onclick = () => window.lcino.reveal(b.dataset.reveal));
    const stage = $('#clutter-stage');
    stage.querySelectorAll('.bubble').forEach((g) => {
      g.addEventListener('click', (ev) => {
        stage.querySelector('.bubble-pop')?.remove();
        const rect = stage.getBoundingClientRect();
        const pop = document.createElement('div');
        pop.className = 'bubble-pop';
        pop.style.left = `${Math.min(rect.width - 330, Math.max(8, ev.clientX - rect.left + 12))}px`;
        pop.style.top = `${Math.max(8, ev.clientY - rect.top - 10)}px`;
        pop.innerHTML = `
          <div class="bp-name">${esc(g.dataset.name)}</div>
          <div class="bp-path" title="${esc(g.dataset.path)}">${esc(shortPath(g.dataset.path))}</div>
          <div class="bp-size">${fmtBytes(parseInt(g.dataset.size, 10))}</div>
          <div style="margin-top:8px;display:flex;gap:6px">
            <button class="btn small" id="bp-reveal">Show in Finder</button>
            <button class="btn small ghost" id="bp-close">Close</button>
          </div>`;
        stage.appendChild(pop);
        $('#bp-reveal').onclick = () => window.lcino.reveal(g.dataset.path);
        $('#bp-close').onclick = () => pop.remove();
      });
    });
  };

  if (clutterCache) { drawMap(clutterCache); return; }

  // Fresh mapping: draw bubbles progressively as sizes arrive — no blocking
  // overlay, the rest of the app stays usable while ~/Library etc. measure.
  clutterPartial = [];
  view.innerHTML = `
    <div class="section-head">
      <h2>My Clutter — what's eating <span id="clutter-loc-name">${esc(sl.name)}</span></h2>
      <div class="actions">
        <button class="mgr-select" id="clutter-loc" style="border:1px solid var(--card-border);border-radius:9px">📁 <b>${esc(sl.name)}</b> <svg width="10" height="7" viewBox="0 0 10 7" style="color:var(--acc)"><path d="M1 1.5l4 4 4-4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg></button>
        <button class="btn small" id="clutter-rescan">↻ Remap</button>
      </div>
    </div>
    <div class="clutter-stage" id="clutter-stage">
      <div style="display:flex;flex-direction:column;align-items:center;gap:12px">
        <div class="spinner"></div>
        <div style="color:var(--text-2);font-size:12px" id="clutter-progress">Starting measurement…</div>
      </div>
    </div>`;
  $('#clutter-rescan').onclick = () => { clutterCache = null; renderClutter(); };
  wireClutterLocation(view);

  const off = window.lcino.onOverviewProgress((ev) => {
    if (currentView !== 'bubble') return;
    if (ev.entry) {
      clutterPartial = [...clutterPartial.filter((x) => x.path !== ev.entry.path), ev.entry]
        .sort((a, b) => b.sizeBytes - a.sizeBytes);
    }
    const detail = ev.detail || 'Measuring…';
    if (clutterPartial.length >= 2) {
      drawMap(clutterPartial, { partial: true, detail });
    } else {
      const p = $('#clutter-progress');
      if (p) p.textContent = detail;
    }
  });

  const entries = sl.root ? await window.lcino.homeOverview(sl.root) : await window.lcino.homeOverview();
  off();
  if (!sl.root) clutterCache = entries; else clutterCache = null; // cache only the home map
  if (currentView === 'bubble') drawMap(entries);
}

// ── startup items ─────────────────────────────────────────────────────────

async function renderStartup() {
  const view = $('#view-startup');
  view.innerHTML = '<div class="card empty"><div class="spinner"></div></div>';
  const data = await window.lcino.startupList();

  const loginHtml = data.loginItems === null ? `
    <div class="banner"><b>One-time permission needed.</b> To read your Login Items, macOS asks for Automation permission (System Events). Grant it when prompted, or manage these in System Settings → General → Login Items.</div>`
    : `
    <div style="display:flex;flex-wrap:wrap;gap:8px">
      ${data.loginItems.length ? data.loginItems.map((n) => `
        <span class="badge acc" style="font-size:12px;padding:6px 12px">${esc(n)}</span>`).join('')
        : '<div class="m-note">No login items — nothing extra launches when you sign in.</div>'}
    </div>
    <div class="m-note" style="margin-top:10px">Add or remove these in System Settings → General → Login Items (macOS keeps this list read-only for cleaner apps, and that is a good thing).</div>`;

  const scopeBadge = (s) => s === 'user' ? '<span class="badge safe">User</span>'
    : s === 'daemon' ? '<span class="badge locked">System Daemon</span>'
    : '<span class="badge locked">System</span>';

  const agentsHtml = data.agents.length ? data.agents.map((a) => `
    <div class="startup-row">
      ${Icons.icon(a.scope === 'user' ? 'startup' : 'protected', 26)}
      <div class="info">
        <div class="s-name">${esc(a.name)} ${a.disabled ? '<span class="badge review">Disabled</span>' : ''}</div>
        <div class="s-path" title="${esc(a.path)}">${esc(shortPath(a.path))}</div>
      </div>
      ${scopeBadge(a.scope)}
      ${a.scope === 'user' ? `<button class="btn small" data-toggle="${esc(a.path)}" data-disabled="${a.disabled ? '1' : ''}">${a.disabled ? 'Enable' : 'Disable'}</button>` : ''}
      <button class="btn small" data-reveal="${esc(a.path)}">Show</button>
    </div>`).join('')
    : '<div class="m-note">No launch agents or daemons found.</div>';

  view.innerHTML = `
    <div class="card">
      <h3>Login Items</h3>
      <div class="sub">Apps that open automatically when you sign in.</div>
      ${loginHtml}
    </div>
    <div class="card">
      <h3>Launch Agents &amp; Daemons</h3>
      <div class="sub">Background helpers registered with launchd. Disabling a user agent moves its plist into a folder macOS never loads — fully reversible.</div>
      ${agentsHtml}
    </div>`;

  view.querySelectorAll('[data-reveal]').forEach((b) => b.onclick = () => window.lcino.reveal(b.dataset.reveal));
  view.querySelectorAll('[data-toggle]').forEach((b) => {
    b.onclick = async () => {
      const wantDisabled = !b.dataset.disabled;
      b.disabled = true;
      const r = await window.lcino.startupSetDisabled({ path: b.dataset.toggle, disabled: wantDisabled });
      if (r.ok) {
        toast(wantDisabled ? 'Disabled — takes effect on next sign-in' : 'Enabled — takes effect on next sign-in');
        renderStartup();
      } else {
        toast(r.reason, 'err');
        b.disabled = false;
      }
    };
  });
}

// ── duplicates view ───────────────────────────────────────────────────────

async function renderDuplicates() {
  const view = $('#view-duplicates');
  if (!state.dupes) {
    view.innerHTML = `
      <div class="card">
        <h3>Find duplicate files</h3>
        <div class="sub">Exact matches only — verified by checksum, never guesswork. Photos, videos, archives: anything ≥ the size below.</div>
        <div style="display:flex;gap:10px;align-items:center">
          <label>Minimum size (MB): <input id="dup-min" type="number" value="10" min="1" style="width:70px;padding:5px 8px;border:1px solid var(--card-border);border-radius:7px;background:var(--input-bg);color:var(--text);font:inherit"></label>
          <button class="btn primary" id="dup-scan">Scan for Duplicates</button>
        </div>
        <div class="m-note" style="margin-top:10px">Runtime copies kept by apps (the identical-folder kind) live in <b>Smart Clean → Duplicate Copies</b>.</div>
      </div>`;
    $('#dup-scan').onclick = async () => {
      const minSizeMB = Math.max(1, parseInt($('#dup-min').value, 10) || 10);
      setOverlay(true, 'Collecting files…', 20);
      const result = await window.lcino.findDuplicates({ minSizeMB });
      setOverlay(false);
      state.dupes = result;
      renderDuplicates();
    };
    return;
  }

  const { groups, wastedBytes } = state.dupes;
  const selectedItems = () => {
    const items = [];
    for (const g of groups) for (const p of g.duplicates) {
      if (state.selectedDupes.has(p)) items.push({ id: `dup-${p}`, path: p, sizeBytes: g.sizeBytes, processNames: [] });
    }
    return items;
  };

  view.innerHTML = `
    <div class="section-head">
      <h2>Duplicate files — ${groups.length} groups · ${fmtBytes(wastedBytes)} wasted</h2>
      <div class="actions"><button class="btn small" id="dup-rescan">↻ New Scan</button></div>
    </div>
    ${groups.length ? `
      <div id="dup-list">
        ${groups.map((g, gi) => `
          <div class="dup-group">
            <div class="dup-head">📌 ${esc(baseName(g.keep))} <span class="size">${fmtBytes(g.sizeBytes)} × ${g.duplicates.length + 1}${g.confirmed ? '' : ' · likely (too large to checksum)'}</span></div>
            <div class="dup-keep">✓ Keeping (newest) <span class="path" title="${esc(tilt(g.keep))}">${esc(shortPath(g.keep))}</span></div>
            ${g.duplicates.map((p) => `
              <div class="row" style="padding:6px 14px">
                <input type="checkbox" class="dup-check" data-path="${esc(p)}" data-size="${g.sizeBytes}" ${state.selectedDupes.has(p) ? 'checked' : ''}>
                <div class="info"><div class="path" title="${esc(tilt(p))}">${esc(shortPath(p))}</div></div>
                <button class="btn small" data-reveal="${esc(p)}">Show</button>
              </div>`).join('')}
          </div>`).join('')}
      </div>
      <div class="action-bar">
        <div class="ab-info"><span id="dup-count">0</span> selected · <span id="dup-size">0 B</span>
          <small>Duplicates go to Trash — the kept original is never touched.</small></div>
        <button class="btn primary" id="dup-clean">Move Duplicates to Trash</button>
      </div>` : `
      <div class="card empty"><div class="e-icon">✨</div>
        <div class="e-title">No duplicates found</div>Every file in your Documents, Desktop, Downloads, Movies and Pictures is unique.</div>`}
  `;

  $('#dup-rescan') && ($('#dup-rescan').onclick = () => { state.dupes = null; renderDuplicates(); });
  view.querySelectorAll('.dup-check').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) state.selectedDupes.add(cb.dataset.path);
      else state.selectedDupes.delete(cb.dataset.path);
      const items = selectedItems();
      $('#dup-count').textContent = `${items.length}`;
      $('#dup-size').textContent = fmtBytes(items.reduce((s, i) => s + i.sizeBytes, 0));
    });
  });
  view.querySelectorAll('[data-reveal]').forEach((b) => b.onclick = () => window.lcino.reveal(b.dataset.reveal));
  const dupCleanBtn = $('#dup-clean');
  if (dupCleanBtn) dupCleanBtn.onclick = () => {
    const items = selectedItems();
    if (!items.length) return toast('Select duplicates first', 'err');
    confirmClean(items);
  };
}

// ── large files view ──────────────────────────────────────────────────────

async function renderFiles() {
  const view = $('#view-files');
  if (!state.scan) { view.innerHTML = emptyScan(); bindScanButton(view); return; }
  const threshold = state.filesThresholdMB;
  const files = state.scan.largeFiles.filter((f) => f.sizeBytes >= threshold * 1048576);

  view.innerHTML = `
    <div class="section-head">
      <h2>Large files ≥ ${threshold} MB</h2>
      <div class="actions">
        <label style="font-size:12px;color:var(--text-2)">Min size (MB)
          <input id="files-threshold" type="number" value="${threshold}" min="1" style="width:64px;padding:4px 8px;border:1px solid var(--card-border);border-radius:7px;background:var(--input-bg);color:var(--text);font:inherit;margin-left:6px">
        </label>
      </div>
    </div>
    <div class="card">
      ${files.length ? `
      <table class="tbl">
        <thead><tr><th style="width:30px"></th><th>File</th><th>Type</th><th>Size</th><th>Modified</th><th></th></tr></thead>
        <tbody>
          ${files.map((f) => `
            <tr>
              <td><input type="checkbox" class="file-check" data-path="${esc(f.path)}" data-size="${f.sizeBytes}" ${state.selectedFiles.has(f.path) ? 'checked' : ''}></td>
              <td style="font-weight:500">${esc(baseName(f.path))}<div class="path" style="color:var(--text-3);font-size:11px" title="${esc(tilt(f.path))}">${esc(shortPath(f.path, 70))}</div></td>
              <td>${f.kind}</td>
              <td>${fmtBytes(f.sizeBytes)}</td>
              <td>${fmtDate(f.mtimeMs)}</td>
              <td><button class="btn small" data-reveal="${esc(f.path)}">Show</button></td>
            </tr>`).join('')}
        </tbody>
      </table>` : `<div class="empty"><div class="e-icon">📦</div><div class="e-title">Nothing over ${threshold} MB</div></div>`}
    </div>
    <div class="action-bar">
      <div class="ab-info"><span id="files-count">0</span> selected · <span id="files-size">0 B</span>
        <small>Check the file in Finder (Show) before deleting — LcinoCare only moves to Trash.</small></div>
      <button class="btn primary" id="files-clean">Move to Trash</button>
    </div>
  `;

  const refresh = () => {
    const sel = files.filter((f) => state.selectedFiles.has(f.path));
    $('#files-count').textContent = `${sel.length}`;
    $('#files-size').textContent = fmtBytes(sel.reduce((s, f) => s + f.sizeBytes, 0));
  };
  refresh();
  view.querySelectorAll('.file-check').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) state.selectedFiles.add(cb.dataset.path);
      else state.selectedFiles.delete(cb.dataset.path);
      refresh();
    });
  });
  view.querySelectorAll('[data-reveal]').forEach((b) => b.onclick = () => window.lcino.reveal(b.dataset.reveal));
  $('#files-threshold').addEventListener('change', (e) => {
    state.filesThresholdMB = Math.max(1, parseInt(e.target.value, 10) || 10);
    renderFiles();
  });
  $('#files-clean').onclick = () => {
    const items = files.filter((f) => state.selectedFiles.has(f.path))
      .map((f) => ({ id: `file-${f.path}`, path: f.path, sizeBytes: f.sizeBytes, processNames: [] }));
    if (!items.length) return toast('Select files first', 'err');
    confirmClean(items);
  };
}

// ── apps view ─────────────────────────────────────────────────────────────

function appInitialTile(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
  const hue = h % 360;
  return `<span class="app-ico" style="background:linear-gradient(145deg, hsl(${hue} 78% 62%), hsl(${(hue + 24) % 360} 74% 44%))">${esc(name.charAt(0).toUpperCase())}</span>`;
}

async function renderApps() {
  const view = $('#view-apps');
  if (!state.apps) {
    view.innerHTML = '<div class="card empty"><div class="spinner"></div><div style="margin-top:10px">Loading app inventory…</div></div>';
    state.apps = await window.lcino.listApps();
    renderApps();
    return;
  }
  const insp = state.inspected;
  view.innerHTML = `
    <div class="card">
      <h3>Installed applications — ${state.apps.length}</h3>
      <div class="sub">Icons, sizes and install dates load in as they are measured. Click <b>Inspect</b> to see whether an app is running and every leftover it left in Library folders.</div>
      <div id="app-list">
        ${state.apps.map((a) => `
          <div class="app-row" data-app="${esc(a.path)}">
            ${appInitialTile(a.name)}
            <div class="info">
              <div class="app-name">${esc(a.name)} <span class="app-ver" data-ver="${esc(a.path)}"></span></div>
              <div class="path"><span class="loc-badge">${esc(a.location)}</span> <span class="app-added" data-added="${esc(a.path)}" style="color:var(--text-3);font-size:11px"></span></div>
            </div>
            <div class="size" data-size="${esc(a.path)}"><span class="skel" style="width:52px"></span></div>
            <button class="btn small" data-inspect="${esc(a.path)}">Inspect</button>
          </div>`).join('')}
      </div>
    </div>
    <div id="inspect-holder">${insp ? inspectHtml(insp) : ''}</div>
  `;

  // 1) fast metadata: real icon, version, install date (parallel, gentle)
  const metaJobs = [...state.apps];
  const metaWorkers = Array.from({ length: 5 }, async () => {
    while (metaJobs.length) {
      const app = metaJobs.shift();
      if (!app || currentView !== 'apps') return;
      try {
        const meta = await window.lcino.appMeta(app.path);
        const row = view.querySelector(`.app-row[data-app="${CSS.escape(app.path)}"]`);
        if (!row) continue;
        if (meta.icon) {
          const ico = row.querySelector('.app-ico');
          if (ico) ico.innerHTML = `<img src="${meta.icon}" alt="">`;
        }
        if (meta.version) {
          const ver = row.querySelector(`[data-ver="${CSS.escape(app.path)}"]`);
          if (ver) ver.textContent = `v${meta.version}`;
        }
        if (meta.addedMs) {
          const added = row.querySelector(`[data-added="${CSS.escape(app.path)}"]`);
          if (added) added.textContent = `· Added ${fmtDate(meta.addedMs)}`;
        }
      } catch { /* skip */ }
    }
  });
  await Promise.all(metaWorkers);

  // 2) sizes (du — slower, fills in progressively)
  const sizeJobs = [...state.apps];
  const sizeWorkers = Array.from({ length: 4 }, async () => {
    while (sizeJobs.length) {
      const app = sizeJobs.shift();
      if (!app || currentView !== 'apps') return;
      try {
        const sizeBytes = await window.lcino.appSize(app.path);
        if (sizeBytes == null) continue;
        const cell = view.querySelector(`[data-size="${CSS.escape(app.path)}"]`);
        if (cell) cell.textContent = fmtBytes(sizeBytes);
      } catch { /* skip */ }
    }
  });
  await Promise.all(sizeWorkers);

  view.querySelectorAll('[data-inspect]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true; b.textContent = 'Measuring…';
      state.inspected = await window.lcino.inspectApp(b.dataset.inspect);
      renderApps();
      const holder = $('#inspect-holder');
      if (holder) holder.scrollIntoView({ behavior: 'smooth' });
    };
  });

  const bindInspect = () => {
    const holder = $('#inspect-holder');
    if (!holder) return;
    holder.querySelectorAll('.leftover-check').forEach((cb) => {
      cb.addEventListener('change', () => {});
    });
    const btn = holder.querySelector('#uninstall-btn');
    if (btn) btn.onclick = () => {
      const insp2 = state.inspected;
      const checked = [...holder.querySelectorAll('.leftover-check:checked')].map((cb) => cb.dataset.path);
      const allPaths = [insp2.path, ...checked];
      if (insp2.running) return toast(`Quit ${insp2.name} first — it is running right now.`, 'err');
      showModal({
        title: `Uninstall ${insp2.name}?`,
        bodyHtml: `The app <b>${esc(insp2.name)}</b>${insp2.sizeBytes ? ` (${fmtBytes(insp2.sizeBytes)})` : ''} and <b>${checked.length} leftover${checked.length === 1 ? '' : 's'}</b> will be moved to the Trash. Recoverable via Finder → Put Back.`,
        confirmText: 'Uninstall',
        danger: true,
        onConfirm: async () => {
          const leftovers = checked.map((p) => ({ path: p, sizeBytes: 0 }));
          const { results } = await window.lcino.uninstallApp({ appPath: insp2.path, leftovers });
          const failed = results.filter((r) => !r.ok);
          if (failed.length) toast(`Uninstalled with ${failed.length} skipped (${esc(failed[0].reason)})`, 'err');
          else toast(`${insp2.name} uninstalled ✓`);
          state.inspected = null;
          state.apps = await window.lcino.listApps();
          renderApps();
        }
      });
    };
  };
  bindInspect();
}

function inspectHtml(insp) {
  const headIcon = insp.icon
    ? `<span class="app-ico"><img src="${insp.icon}" alt=""></span>`
    : appInitialTile(insp.name || 'App');
  return `
    <div class="card">
      <h3 style="gap:10px">${headIcon} ${esc(insp.name)} ${insp.version ? `<span style="color:var(--text-3);font-weight:400">v${esc(insp.version)}</span>` : ''}</h3>
      <div class="inspect">
        <div class="kv"><b>Bundle ID</b><span>${esc(insp.bundleId || 'unknown')}</span></div>
        <div class="kv"><b>Size</b><span>${fmtBytes(insp.sizeBytes)}</span></div>
        <div class="kv"><b>Running</b><span>${insp.running ? '⚠ Yes — quit before uninstalling' : 'No'}</span></div>
        <div class="kv"><b>Path</b><span>${esc(tilt(insp.path))}</span></div>
      </div>
      <h3 style="margin-bottom:6px">Leftovers in Library</h3>
      ${insp.leftovers.length ? insp.leftovers.map((l) => `
        <div class="row">
          <input type="checkbox" class="leftover-check" data-path="${esc(l.path)}" checked ${l.caution ? 'title="May contain user data"' : ''}>
          <div class="info">
            <div class="name">${esc(baseName(l.path))} ${l.caution ? '<span class="badge review">may hold user data</span>' : ''}</div>
            <div class="path path-link" data-reveal="${esc(l.path)}" title="Click to open in Finder">${esc(shortPath(l.path))}</div>
          </div>
          <div class="size">${fmtBytes(l.sizeBytes)}</div>
          <button class="icon-btn" data-reveal="${esc(l.path)}" title="Show in Finder">${Icons.glyph('folder', 15, 'currentColor')}</button>
        </div>`).join('') : '<div class="m-note">No leftovers found — a clean app.</div>'}
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn danger" id="uninstall-btn">Uninstall (to Trash)</button>
        <button class="btn" id="close-inspect">Close</button>
      </div>
    </div>`;
}

// ── speed view ────────────────────────────────────────────────────────────

async function renderSpeed() {
  const view = $('#view-speed');
  view.innerHTML = '<div class="card empty"><div class="spinner"></div></div>';
  const render = async () => {
    const { byCpu, byMem } = await window.lcino.listProcesses();
    const maxCpu = Math.max(0.1, ...byCpu.map((p) => p.cpu));
    const maxMem = Math.max(1, ...byMem.map((p) => p.rssBytes));
    const row = (p, metric) => {
      const pct = metric === 'cpu'
        ? Math.min(100, (p.cpu / maxCpu) * 100)
        : Math.min(100, (p.rssBytes / maxMem) * 100);
      return `
      <div class="proc-row">
        <div class="p-bg" style="width:${pct}%"></div>
        <div class="p-name" title="${esc(p.name)}">${esc(p.name)}${p.type === 'app' ? '' : ' · proc'}</div>
        <div class="p-val">${metric === 'cpu' ? p.cpu.toFixed(1) + '%' : fmtBytes(p.rssBytes)}</div>
        <button class="btn small" data-quit-pids="${esc(p.pids.join(','))}" data-name="${esc(p.name)}">Quit</button>
      </div>`;
    };
    if (currentView !== 'speed') return;
    view.innerHTML = `
      <div class="speed-note">
        <b>The honest speed story:</b> macOS manages RAM expertly — "RAM boosting" apps are placebo.
        What actually slows a Mac down is a heavy app hogging CPU or memory. Find it below and quit it properly.
        System processes are never shown or touched.
      </div>
      <div class="card" style="margin-bottom:14px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <h3 style="margin-bottom:2px">Auto-refresh</h3>
            <div class="sub" style="margin:0">Live every 3 seconds while this view is open.</div>
          </div>
          <button class="btn small" id="speed-refresh">↻ Refresh now</button>
        </div>
      </div>
      <div class="speed-cols">
        <div class="card">
          <h3>Top CPU consumers</h3>
          <div class="sub">%CPU right now</div>
          ${byCpu.map((p) => row(p, 'cpu')).join('') || '<div class="m-note">All quiet.</div>'}
        </div>
        <div class="card">
          <h3>Top memory consumers</h3>
          <div class="sub">RAM held by each app (helpers merged)</div>
          ${byMem.map((p) => row(p, 'mem')).join('') || '<div class="m-note">All quiet.</div>'}
        </div>
      </div>`;
    view.querySelectorAll('[data-quit-pids]').forEach((b) => {
      b.onclick = () => {
        const pids = b.dataset.quitPids.split(',').map(Number).filter(Boolean);
        showModal({
          title: `Quit ${b.dataset.name}?`,
          bodyHtml: 'This sends a normal quit signal (same as ⌘Q). <b>Unsaved work in that app may be lost.</b>',
          confirmText: 'Quit',
          danger: true,
          onConfirm: async () => {
            await window.lcino.quitProcesses(pids);
            toast(`Quit signal sent to ${b.dataset.name}`);
            setTimeout(render, 700);
          }
        });
      };
    });
    $('#speed-refresh').onclick = render;
  };
  await render();
  state.speedTimer = setInterval(render, 3000);
}

// ── protected view ────────────────────────────────────────────────────────

async function renderProtected() {
  const view = $('#view-protected');
  const items = await window.lcino.protectedList();
  view.innerHTML = `
    <div class="card">
      <h3>Places LcinoCare will never touch</h3>
      <div class="sub">These are locked out at the engine level — not just hidden in the interface. Even a bug could not make LcinoCare delete them.</div>
      ${items.map((i) => `
        <div class="row">
          <svg viewBox="0 0 24 24" width="15" height="15" style="color:var(--text-3);flex-shrink:0"><rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>
          <div class="info"><div class="name">${esc(i.label)}</div><div class="path" style="white-space:normal">${esc(i.detail)}</div></div>
          <span class="badge locked">Protected</span>
        </div>`).join('')}
    </div>`;
}

// ── history view ──────────────────────────────────────────────────────────

async function renderHistory() {
  const view = $('#view-history');
  const entries = await window.lcino.history();
  view.innerHTML = entries.length ? `
    <div class="card">
      <table class="tbl">
        <thead><tr><th>When</th><th>Action</th><th>Items</th><th>Freed</th></tr></thead>
        <tbody>
          ${entries.map((e) => `
            <tr>
              <td>${new Date(e.at).toLocaleString()}</td>
              <td>${e.kind === 'clean' ? 'Smart Clean' : e.kind === 'trash' ? 'Emptied Trash' : 'App uninstalled'}</td>
              <td>${e.count}</td>
              <td>${e.freedBytes == null ? '—' : fmtBytes(e.freedBytes)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : `
    <div class="card empty"><div class="e-icon">🗂</div>
      <div class="e-title">Nothing cleaned yet</div>Every cleanup LcinoCare performs is recorded here.</div>`;
}

// ── search ────────────────────────────────────────────────────────────────

let searchSeq = 0;

async function onSearchInput() {
  const q = $('#search-input').value.trim();
  const holder = $('#search-results');
  if (q.length < 2) { holder.classList.add('hidden'); return; }
  const seq = ++searchSeq;
  const grouped = await window.lcino.search(q);
  if (seq !== searchSeq) return;

  const sections = [
    ['feature', 'Features'],
    ['cleaner', 'Cleanable items'],
    ['file', 'Files'],
    ['app', 'Applications']
  ];
  let html = '';
  for (const [type, label] of sections) {
    const entries = grouped[type] || [];
    if (!entries.length) continue;
    html += `<div class="sr-section">${label}</div>`;
    for (const e of entries) {
      html += `
        <div class="sr-item" data-search-view="${e.view || ''}" data-search-path="${esc(e.path || '')}">
          <div style="min-width:0"><div class="sr-title">${esc(e.title)}</div><div class="sr-sub">${esc(e.subtitle || '')}</div></div>
          ${e.sizeBytes ? `<span class="sr-size">${fmtBytes(e.sizeBytes)}</span>` : ''}
        </div>`;
    }
  }
  holder.innerHTML = html || '<div class="sr-item"><div class="sr-sub">No matches. Try "cache", "video", "duplicate", or an app name.</div></div>';
  holder.classList.remove('hidden');

  holder.querySelectorAll('.sr-item').forEach((item) => {
    item.onclick = () => {
      holder.classList.add('hidden');
      $('#search-input').value = '';
      const viewName = item.dataset.searchView;
      const path = item.dataset.searchPath;
      if (viewName) { showView(viewName); return; }
      if (path) {
        if (state.scan && state.scan.groups.some((g) => g.items.some((i) => i.path === path))) {
          state.selectedClean.add(path);
          showView('clean');
        } else {
          window.lcino.reveal(path);
        }
      }
    };
  });
}

// ── boot ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // inject brand + build the module sidebar from the registry
  $('#brand-logo-holder').innerHTML = Icons.brandLogo(30);
  $('#scan-logo').innerHTML = Icons.brandLogo(40);
  const nav = $('#nav');
  nav.innerHTML = MODS.MODULES.map((m) => `
    <button class="nav-item" data-view="${m.id}" title="${esc(m.nav || m.title)}">
      <span class="nav-ico"></span><span class="nav-label">${esc(m.nav || m.title)}</span>
    </button>`).join('');
  $$('#nav .nav-item').forEach((b) => {
    b.querySelector('.nav-ico').innerHTML = MODS.navTile(MODS.byId(b.dataset.view), 28);
    b.addEventListener('click', () => showView(b.dataset.view));
  });

  $('#search-input').addEventListener('input', onSearchInput);
  $('#search-input').addEventListener('focus', onSearchInput);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      $('#search-input').focus();
      $('#search-input').select();
    }
    if (e.key === 'Escape') {
      $('#search-results').classList.add('hidden');
      $('#modal-backdrop').classList.add('hidden');
    }
  });
  document.addEventListener('click', (e) => {
    if (!$('#search-wrap').contains(e.target)) $('#search-results').classList.add('hidden');
  });

  const info = await window.lcino.appInfo();
  $('#sidebar-version').innerHTML = `LcinoCare v${esc(info.version)}<br>${esc(info.slogan)}`;

  showView('smart');
  // No automatic scan on launch — Smart Care's landing invites the first Scan.
  if (window.LcinoOnboarding && window.LcinoOnboarding.shouldShow()) {
    window.LcinoOnboarding.show(() => runScan2());
  } else {
    setTimeout(doUpdateCheck, 6000); // quiet update check after launch
  }
  if (window.lcino.onCheckUpdates) {
    window.lcino.onCheckUpdates(() => doUpdateCheck(true));
  }
  if (window.lcino.onUpdateEvent) {
    window.lcino.onUpdateEvent((ev) => renderUpdateBanner(ev));
  }
});

// ── self-update banner (Phase C) ─────────────────────────────────────────

const UB = { dismissedFor: null, downloading: false, downloaded: false };

function renderUpdateBanner(ev) {
  if (!ev) return;
  if (ev.status === 'available') {
    UB.version = ev.version;
    if (UB.dismissedFor === ev.version) return;
    drawUpdateBanner({ mode: 'available', version: ev.version });
  } else if (ev.status === 'downloading') {
    drawUpdateBanner({ mode: 'downloading', pct: ev.pct });
  } else if (ev.status === 'downloaded') {
    drawUpdateBanner({ mode: 'downloaded', version: ev.version });
  } else if (ev.status === 'error') {
    drawUpdateBanner({ mode: 'error', message: ev.error });
  } else if (ev.status === 'none') {
    const el = document.getElementById('update-banner');
    if (el) el.remove();
    if (UB.silentCheck) toast('LcinoCare is up to date ✓');
  }
}

function drawUpdateBanner({ mode, version, pct, message }) {
  const main = $('#main');
  let el = document.getElementById('update-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'update-banner';
    el.className = 'update-banner';
    main.insertBefore(el, main.querySelector('#content'));
  }
  if (mode === 'available') {
    el.classList.remove('err');
    el.innerHTML = `
      <span class="ub-dot"></span>
      <span class="ub-text"><b>LcinoCare ${esc(version)}</b> is out — your Mac deserves the latest care.</span>
      <button class="btn small primary" id="ub-download">Download Update</button>
      <button class="btn small ghost ub-x" id="ub-dismiss" title="Hide until next version">✕</button>`;
    $('#ub-download').onclick = async () => {
      const r = await window.lcino.updateDownload();
      if (r && r.fallback) { await window.lcino.openExternal('https://github.com/LCINO/lcinocare/releases/latest/download/LcinoCare-arm64.dmg'); }
    };
    $('#ub-dismiss').onclick = () => { UB.dismissedFor = UB.version; el.remove(); };
  } else if (mode === 'downloading') {
    el.classList.remove('err');
    el.innerHTML = `<span class="ub-dot dl"></span><span class="ub-text">Downloading update… <b>${pct || 0}%</b></span>`;
  } else if (mode === 'downloaded') {
    el.classList.remove('err');
    el.innerHTML = `
      <span class="ub-dot dl"></span>
      <span class="ub-text"><b>Update downloaded.</b> Relaunch to install — it takes two seconds.</span>
      <button class="btn small primary" id="ub-install">Install & Relaunch</button>`;
    $('#ub-install').onclick = async () => {
      const r = await window.lcino.updateInstall();
      if (r && !r.ok) await window.lcino.openExternal('https://github.com/LCINO/lcinocare/releases/latest/download/LcinoCare-arm64.dmg');
    };
  } else if (mode === 'error') {
    el.classList.add('err');
    el.innerHTML = `<span class="ub-text">Update check failed — <span style="opacity:.7">${esc(message || 'unknown error')}</span>. You can always download the latest DMG from <a href="#" id="ub-fallback" style="color:var(--acc);text-decoration:underline">GitHub</a>.</span><button class="btn small ghost ub-x" id="ub-dismiss">✕</button>`;
    $('#ub-fallback').onclick = () => window.lcino.openExternal('https://github.com/LCINO/lcinocare/releases/latest');
    $('#ub-dismiss').onclick = () => el.remove();
  }
}

async function doUpdateCheck(manual = false) {
  try {
    UB.silentCheck = !manual;
    const r = await window.lcino.updateCheck();
    if (r.hasUpdate) {
      renderUpdateBanner({ status: 'available', version: r.version });
      if (manual) toast(`LcinoCare ${r.version} is available!`);
    } else if (manual) {
      toast('LcinoCare is up to date ✓');
      document.getElementById('update-banner')?.remove();
    } else if (r.error && manual) {
      toast(`Update check failed — ${r.error}`, 'err');
    }
    UB.silentCheck = false;
  } catch { /* offline — stay quiet */ }
}

// ── my clutter (bubble map) ───────────────────────────────────────────────
