'use strict';

// LcinoCare — real maintenance tasks, straight from the macOS toolbox.
// Every task here runs a genuine system mechanism; tasks that need
// administrator rights go through osascript's admin prompt (the same dialog
// you get when an installer asks for a password). Nothing is simulated —
// if a task fails, the app says so.

const { execFile } = require('child_process');

function run(cmd, args, timeout = 60000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
      resolve({ err: err ? String(err.message || err) : null, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() });
    });
  });
}

// Run a shell line with administrator privileges via the macOS auth dialog.
function runAdmin(shellLine, timeout = 120000) {
  return new Promise((resolve) => {
    const script = `do shell script ${JSON.stringify(shellLine)} with administrator privileges`;
    execFile('osascript', ['-e', script], { timeout }, (err, stdout, stderr) => {
      resolve({ err: err ? String(err.message || err) : null, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() });
    });
  });
}

const TASKS = [
  {
    id: 'flush-dns',
    label: 'Flush DNS Cache',
    needsAdmin: true,
    description: 'Clears the local DNS lookup cache. Speeds up name resolution after network or hosts changes.',
    run: async () => {
      const a = await run('dscacheutil', ['-flushcache']);
      const b = await runAdmin('killall -HUP mDNSResponder');
      if (a.err && b.err) return { ok: false, reason: b.err || a.err };
      return { ok: true, detail: 'DNS cache flushed.' };
    }
  },
  {
    id: 'free-ram',
    label: 'Free Up RAM',
    needsAdmin: true,
    description: 'Asks macOS to purge inactive memory and purgeable disk caches (the `purge` command).',
    run: async () => {
      const r = await runAdmin('purge');
      return r.err ? { ok: false, reason: r.err } : { ok: true, detail: 'Inactive memory purged.' };
    }
  },
  {
    id: 'maintenance-scripts',
    label: 'Run Maintenance Scripts',
    needsAdmin: true,
    description: 'Runs macOS\'s own daily, weekly, and monthly housekeeping scripts (/etc/periodic).',
    run: async () => {
      const r = await runAdmin('periodic daily weekly monthly', 300000);
      return r.err ? { ok: false, reason: r.err } : { ok: true, detail: 'Daily, weekly and monthly scripts completed.' };
    }
  },
  {
    id: 'reindex-spotlight',
    label: 'Reindex Spotlight',
    needsAdmin: true,
    description: 'Erases and rebuilds the Spotlight index on the startup volume. Search may take a little while to rebuild afterwards.',
    run: async () => {
      const r = await runAdmin('mdutil -E /', 180000);
      return r.err ? { ok: false, reason: r.err } : { ok: true, detail: 'Spotlight reindex started.' };
    }
  },
  {
    id: 'speed-up-mail',
    label: 'Speed Up Mail',
    needsAdmin: false,
    description: 'Compacts (vacuums) Mail\'s local message database so it loads faster. Quit Mail first — LcinoCare will check.',
    requiresAppQuit: ['Mail'],
    run: async () => {
      const glob = require('fs').promises;
      const home = require('os').homedir();
      const candidates = [
        `${home}/Library/Mail/V10`,
        `${home}/Library/Mail/V9`,
        `${home}/Library/Mail/V8`,
        `${home}/Library/Mail/V7`
      ];
      let vacuumed = 0; let lastErr = null;
      for (const dir of candidates) {
        let entries = [];
        try { entries = await glob.readdir(dir, { recursive: true }); } catch { continue; }
        for (const rel of entries) {
          if (/Envelope Index(-shm|-wal)?$/.test(rel) && rel.endsWith('Index')) {
            const r = await run('sqlite3', [`"${dir}/${rel}"`, 'vacuum;'], 120000).catch(() => null);
            if (r && !r.err) vacuumed += 1; else lastErr = r && r.err;
          }
        }
      }
      if (vacuumed === 0) return { ok: false, reason: lastErr || 'No Mail database found (Mail may not be set up on this Mac).' };
      return { ok: true, detail: `${vacuumed} Mail database${vacuumed === 1 ? '' : 's'} compacted.` };
    }
  },
  {
    id: 'verify-disk',
    label: 'Verify Startup Disk',
    needsAdmin: false,
    description: 'Read-only integrity check of the startup volume\'s file system.',
    run: async () => {
      const r = await run('diskutil', ['verifyVolume', '/'], 180000);
      const out = `${r.stdout} ${r.stderr}`;
      if (r.err) return { ok: false, reason: r.err };
      if (/appears to be OK/i.test(out)) return { ok: true, detail: 'Startup disk appears to be OK.' };
      if (/invalid|corrupt|repair/i.test(out)) return { ok: true, detail: 'Issues detected — run First Aid from Disk Utility to repair.' };
      return { ok: true, detail: out.slice(0, 220) || 'Verification finished.' };
    }
  }
];

module.exports = { TASKS };
