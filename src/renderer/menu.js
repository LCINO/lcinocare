'use strict';

/* LcinoCare Menu popover — live metrics + quick actions.
   Falls back to demo data when opened outside Electron (plain-browser QA). */

const $ = (s) => document.querySelector(s);
const fmt = (b) => {
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
  if (b >= 1048576) return `${(b / 1048576).toFixed(0)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
};
const setStatus = (html) => { $('#status').innerHTML = html; };
const lcino = window.lcino || null;

function renderMetrics(s) {
  const mem = s.memory || { usedPct: 0, freeBytes: 0, totalBytes: 0 };
  const disk = s.disk || { freeBytes: 0, totalBytes: 0 };
  $('#m-cpu').textContent = `${s.cpu}%`;
  $('#b-cpu').style.width = `${Math.min(100, s.cpu)}%`;
  $('#m-mem').textContent = `${mem.usedPct}% used`;
  $('#b-mem').style.width = `${mem.usedPct}%`;
  $('#m-disk').textContent = fmt(disk.freeBytes);
  $('#b-disk').style.width = `${100 - Math.round((disk.freeBytes / (disk.totalBytes || 1)) * 100)}%`;
}

async function pollUpdate() {
  if (!lcino || document.visibilityState === 'hidden') return;
  try {
    const r = await lcino.updateCheck();
    const chip = document.getElementById('upd-chip');
    if (!chip) return;
    if (r.hasUpdate) {
      chip.classList.remove('hidden');
      document.getElementById('upd-ver').textContent = 'v' + r.version;
      chip.onclick = () => { lcino.appShow(); lcino.menuHide(); };
    } else {
      chip.classList.add('hidden');
    }
  } catch { /* offline */ }
}

async function poll() {
  if (document.visibilityState === 'hidden') return;
  try {
    if (lcino) renderMetrics(await lcino.menuSnapshot());
    else renderMetrics({ cpu: 7, memory: { usedPct: 62 }, disk: { freeBytes: 20.5e9, totalBytes: 263.2e9 } }); // demo
  } catch { /* transient */ }
}

// quick clean
$('#a-clean').onclick = async () => {
  if (!lcino) { setStatus('Demo mode — run the real app for quick actions.'); return; }
  const btn = $('#a-clean');
  const label = $('#a-clean-t');
  btn.disabled = true;
  label.textContent = 'Scanning…';
  setStatus('Scanning for safe junk, then cleaning…');
  try {
    const r = await lcino.menuQuickClean();
    if (!r.ok) setStatus(`Quick Clean skipped — ${r.reason}`);
    else {
      label.textContent = 'Quick Clean';
      setStatus(`<b>${fmt(r.freedBytes)} freed</b> from ${r.count} item${r.count === 1 ? '' : 's'}${r.skipped ? ` · ${r.skipped} skipped (apps running)` : ''}.`);
    }
  } catch (e) {
    setStatus(`Quick Clean failed — ${String(e).slice(0, 80)}`);
  } finally {
    btn.disabled = false;
    label.textContent = 'Quick Clean';
  }
};

// flush RAM
$('#a-ram').onclick = async () => {
  if (!lcino) { setStatus('Demo mode — run the real app for quick actions.'); return; }
  const btn = $('#a-ram');
  btn.disabled = true;
  setStatus('Asking macOS to purge inactive memory… confirm the password dialog if it appears.');
  try {
    const { results } = await lcino.maintenanceRun(['free-ram']);
    const r = results[0];
    setStatus(r.ok ? 'Inactive memory purged ✓' : `Could not purge — ${r.reason}`);
    poll();
  } finally {
    btn.disabled = false;
  }
};

// empty trash (double-click safety: first click arms it)
let trashArmed = null;
$('#a-trash').onclick = async () => {
  const label = $('#a-trash-t');
  if (!lcino) { setStatus('Demo mode — run the real app for quick actions.'); return; }
  if (!trashArmed) {
    label.textContent = 'Really empty?';
    trashArmed = setTimeout(() => { label.textContent = 'Empty Trash'; trashArmed = null; }, 3200);
    return;
  }
  clearTimeout(trashArmed);
  trashArmed = null;
  label.textContent = 'Emptying…';
  try {
    const r = await lcino.trashEmpty();
    setStatus(r.ok ? 'Trash emptied — space freed for real ✓' : `Could not empty Trash — ${r.reason}`);
    label.textContent = 'Empty Trash';
    poll();
  } catch (e) {
    setStatus(`Could not empty Trash — ${String(e).slice(0, 60)}`);
    label.textContent = 'Empty Trash';
  }
};

// open main app
$('#a-open').onclick = () => {
  if (lcino) { lcino.appShow(); lcino.menuHide(); }
  else setStatus('Demo mode — run the real app.');
};

// esc closes
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && lcino) lcino.menuHide();
});

// version footer
(async () => {
  let v = '1.7.0';
  try { if (lcino) v = (await lcino.appInfo()).version; } catch { /* demo */ }
  $('#ver').textContent = `LcinoCare v${v}`;
})();

// poll while visible
document.addEventListener('visibilitychange', () => { poll(); pollUpdate(); });
setInterval(poll, 3000);
setInterval(pollUpdate, 15000);
poll();
pollUpdate();
