'use strict';

// LcinoCare — system health: CPU, memory, disk, battery + the Quick Health
// Score. Everything is read-only measurement, no admin rights needed.

const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const HOME = os.homedir();
let lastCpuSample = os.cpus();

function sampleCpu() {
  const before = lastCpuSample;
  const after = os.cpus();
  lastCpuSample = after;
  let idle = 0;
  let total = 0;
  for (let i = 0; i < after.length; i++) {
    const a = before[i].times;
    const b = after[i].times;
    idle += b.idle - a.idle;
    total += (b.user - a.user) + (b.nice - a.nice) + (b.sys - a.sys) + (b.idle - a.idle) + (b.irq - a.irq);
  }
  return total > 0 ? Math.min(100, Math.round(((total - idle) / total) * 100)) : 0;
}

// Warm up a first sample so the next call reports a real delta.
sampleCpu();

function cpuPercent() {
  return sampleCpu();
}

function memory() {
  const total = os.totalmem();
  const free = os.freemem();
  const usedPct = Math.round(((total - free) / total) * 100);
  let swapBytes = 0;
  try {
    for (const f of fs.readdirSync('/System/Volumes/VM')) {
      if (f.startsWith('swapfile')) {
        try { swapBytes += fs.statSync(path.join('/System/Volumes/VM', f)).size; } catch { /* gone */ }
      }
    }
  } catch { /* unreadable */ }
  return { usedPct, totalBytes: total, freeBytes: free, swapBytes };
}

function disk() {
  return new Promise((resolve) => {
    const child = spawn('/bin/df', ['-k', '/System/Volumes/Data']);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve({ usedPct: 0, totalBytes: 0, freeBytes: 0 }));
    child.on('close', () => {
      const cols = out.trim().split('\n').pop().split(/\s+/);
      const totalBytes = parseInt(cols[1], 10) * 1024;
      const freeBytes = parseInt(cols[3], 10) * 1024;
      resolve({
        totalBytes,
        freeBytes,
        usedBytes: Math.max(0, totalBytes - freeBytes),
        usedPct: totalBytes ? Math.round(((totalBytes - freeBytes) / totalBytes) * 100) : 0,
        freePct: totalBytes ? freeBytes / totalBytes : 0
      });
    });
  });
}

let batteryCache = { at: 0, data: null };

function pmsetBatt() {
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/pmset', ['-g', 'batt']);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve(null));
    child.on('close', () => resolve(out));
  });
}

function systemProfilerPower() {
  return new Promise((resolve) => {
    const child = spawn('/usr/sbin/system_profiler', ['SPPowerDataType'], { timeout: 20000 });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve(null));
    child.on('close', () => resolve(out));
  });
}

async function battery() {
  const pmsetOut = await pmsetBatt();
  if (!pmsetOut || !pmsetOut.includes('Battery')) return { hasBattery: false };

  const pctMatch = pmsetOut.match(/(\d+)%/);
  const charging = /AC Power/.test(pmsetOut);

  // Details (cycle count, condition, capacity) — cached for 5 minutes.
  if (!batteryCache.data || Date.now() - batteryCache.at > 5 * 60 * 1000) {
    const sp = await systemProfilerPower();
    const cycle = sp ? (sp.match(/Cycle Count:\s+(\d+)/) || [])[1] : null;
    const condition = sp ? (sp.match(/Condition:\s+(\w+)/) || [])[1] : null;
    const capacity = sp
      ? ((sp.match(/Maximum Capacity:\s+(\d+)%/) || sp.match(/State of Health[^\d]*(\d+)%/) || [])[1])
      : null;
    batteryCache = { at: Date.now(), data: { cycleCount: cycle ? parseInt(cycle, 10) : null, condition, maxCapacityPct: capacity ? parseInt(capacity, 10) : null } };
  }
  return {
    hasBattery: true,
    percent: pctMatch ? parseInt(pctMatch[1], 10) : null,
    charging,
    ...batteryCache.data
  };
}

// ── Quick Health Score ────────────────────────────────────────────────────
// Disk 40 pts, memory 30, battery 15, junk load 15. Deliberately honest.

function healthScore({ disk: d, memory: m, battery: b, safeJunkBytes }) {
  const factors = [];

  const freePct = d.totalBytes ? d.freeBytes / d.totalBytes : 0;
  let diskPts = 6;
  if (freePct >= 0.2) diskPts = 40;
  else if (freePct >= 0.15) diskPts = 32;
  else if (freePct >= 0.1) diskPts = 24;
  else if (freePct >= 0.07) diskPts = 14;
  factors.push({
    label: 'Disk space',
    earned: diskPts,
    max: 40,
    note: `${(d.freeBytes / 1073741824).toFixed(1)} GB free (${Math.round(freePct * 100)}%). macOS stays healthy above 20%.`
  });

  let memPts = 4;
  if (m.usedPct < 70) memPts = 30;
  else if (m.usedPct < 80) memPts = 22;
  else if (m.usedPct < 90) memPts = 12;
  factors.push({
    label: 'Memory pressure',
    earned: memPts,
    max: 30,
    note: `${m.usedPct}% of RAM in use${m.swapBytes > 0 ? `, ${formatGB(m.swapBytes)} swapped to disk` : ''}.`
  });

  let battPts = 15;
  let battNote = 'No battery (desktop Mac).';
  if (b && b.hasBattery) {
    battPts = b.condition === 'Normal' ? 13 : 5;
    if (b.maxCapacityPct !== null && b.maxCapacityPct >= 90) battPts = Math.min(15, battPts + 2);
    battNote = `${b.percent != null ? b.percent + '% charge, ' : ''}${b.cycleCount != null ? b.cycleCount + ' cycles, ' : ''}condition: ${b.condition || 'unknown'}.`;
  }
  factors.push({ label: 'Battery health', earned: battPts, max: 15, note: battNote });

  const gb = safeJunkBytes / 1073741824;
  let junkPts = 15;
  if (gb >= 30) junkPts = 0;
  else if (gb >= 15) junkPts = 3;
  else if (gb >= 5) junkPts = 7;
  else if (gb > 0.5) junkPts = 11;
  factors.push({
    label: 'Junk load',
    earned: junkPts,
    max: 15,
    note: gb >= 0.5 ? `${formatGB(safeJunkBytes)} of caches and leftovers found.` : 'No significant junk found.'
  });

  const score = factors.reduce((s, f) => s + f.earned, 0);
  return { score, factors };
}

function formatGB(bytes) {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

async function snapshot(safeJunkBytes = 0) {
  const d = await disk();
  const m = memory();
  const b = await battery();
  const score = healthScore({ disk: d, memory: m, battery: b, safeJunkBytes });
  return {
    cpu: cpuPercent(),
    memory: m,
    disk: d,
    battery: b,
    score,
    uptimeSeconds: Math.round(os.uptime())
  };
}

module.exports = { snapshot };
