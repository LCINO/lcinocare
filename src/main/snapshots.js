'use strict';

// LcinoCare — local Time Machine snapshots.
// APFS keeps local snapshots that silently eat disk space; `tmutil` can list
// and purge them. Read-only listing, and purging only *thins* old snapshots —
// macOS keeps whatever it still needs.

const { execFile } = require('child_process');

function run(args) {
  return new Promise((resolve) => {
    execFile('tmutil', args, { timeout: 30000 }, (err, stdout, stderr) => {
      resolve({ err: err ? String(err.message || err) : null, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function list() {
  const { err, stdout } = await run(['listlocalsnapshots', '/']);
  if (err) return { ok: false, reason: err, snapshots: [] };
  const snapshots = (stdout.match(/com\.apple\.TimeMachine\.\d{4}-\d{2}-\d{2}-\d{6}\.local/g) || [])
    .map((name) => {
      const m = name.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/);
      return {
        name,
        date: m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null
      };
    })
    .sort((a, b) => b.date - a.date);
  return { ok: true, snapshots };
}

// Purge local snapshots that are older than what macOS strictly needs.
// `thinlocalsnapshots <mount> <purgeable-bytes> <urgency>` — the huge byte
// target with max urgency asks tmutil to thin everything it can.
async function purge() {
  const { err, stdout, stderr } = await run(['thinlocalsnapshots', '/', '999999999999999', '4']);
  if (err && !stdout) return { ok: false, reason: err };
  const deleted = (stdout.match(/com\.apple\.TimeMachine\.[\w.-]+/g) || []).length;
  return { ok: true, deleted, note: (stdout + stderr).trim() };
}

module.exports = { list, purge };
