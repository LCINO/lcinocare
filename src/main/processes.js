'use strict';

// LcinoCare — Speed view: top CPU/RAM consumers and graceful quit.
// Only processes owned by the current user are ever shown or acted on.
// System daemons (root) are invisible here by design; quitting is always
// SIGTERM (the same as choosing Quit in an app), never kill -9.

const { spawn } = require('child_process');
const os = require('os');

const MY_UID = process.getuid();
const SELF_PIDS = new Set([process.pid]);
if (process.ppid) SELF_PIDS.add(process.ppid);

function psList() {
  return new Promise((resolve) => {
    const child = spawn('/bin/ps', ['-Ao', 'uid=,pid=,pcpu=,pmem=,rss=,comm=']);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve(''));
    child.on('close', () => resolve(out));
  });
}

// Group user processes into "apps" (anything running from an .app bundle)
// and plain binaries (node, pnpm, ffmpeg…). Helper processes of an app are
// merged into the app's entry.
async function listTop(limitPerMetric = 12) {
  const out = await psList();
  const apps = new Map();
  const bins = new Map();
  for (const line of out.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 6) continue;
    const [uid, pid, cpu, pmem, rss] = cols;
    const command = cols.slice(5).join(' ');
    if (parseInt(uid, 10) !== MY_UID) continue;
    const pidN = parseInt(pid, 10);
    if (SELF_PIDS.has(pidN)) continue;
    const rssBytes = parseInt(rss, 10) * 1024;
    const cpuN = parseFloat(cpu);

    const appMatch = command.match(/\/([^/]+)\.app\/Contents\//);
    if (appMatch) {
      const name = appMatch[1];
      if (!apps.has(name)) apps.set(name, { name, type: 'app', cpu: 0, rssBytes: 0, pids: [] });
      const entry = apps.get(name);
      entry.cpu = Math.max(entry.cpu, cpuN); // app %CPU: take the busiest helper
      entry.rssBytes += rssBytes;
      entry.pids.push(pidN);
    } else {
      const name = command.split('/').pop() || command;
      if (name === 'ps') continue;
      if (!bins.has(name)) bins.set(name, { name, type: 'process', cpu: 0, rssBytes: 0, pids: [] });
      const entry = bins.get(name);
      entry.cpu = Math.max(entry.cpu, cpuN);
      entry.rssBytes += rssBytes;
      entry.pids.push(pidN);
    }
  }
  const all = [...apps.values(), ...bins.values()];
  const byCpu = [...all].sort((a, b) => b.cpu - a.cpu).slice(0, limitPerMetric);
  const byMem = [...all].sort((a, b) => b.rssBytes - a.rssBytes).slice(0, limitPerMetric);
  return { byCpu, byMem, myUid: MY_UID };
}

// Graceful quit: SIGTERM to the collected pids (all owned by this user, never
// our own app). Returns per-request outcome.
async function quitProcesses(pids) {
  const valid = (pids || []).filter((pid) => Number.isInteger(pid) && !SELF_PIDS.has(pid));
  const results = [];
  for (const pid of valid) {
    try {
      process.kill(pid, 'SIGTERM');
      results.push({ pid, ok: true });
    } catch (err) {
      results.push({ pid, ok: false, reason: String(err.message || err) });
    }
  }
  return results;
}

module.exports = { listTop, quitProcesses };
