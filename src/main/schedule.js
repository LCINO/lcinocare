'use strict';

// LcinoCare — scheduled scan agent.
// Writes a user LaunchAgent (~/Library/LaunchAgents) that runs the app binary
// with --background-scan on a calendar schedule. The background flow scans
// quietly and posts a macOS notification — nothing is cleaned automatically.

const { execFile } = require('child_process');
const { app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const LABEL = 'com.lcino.lcinocare-scan';
const PLIST = () => path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

function launchctl(args) {
  return new Promise((resolve) => {
    execFile('/bin/launchctl', args, { timeout: 15000 }, (err, stdout, stderr) => {
      resolve({ err: err ? String(err.message || err) : null, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() });
    });
  });
}

async function status() {
  const p = PLIST();
  if (!fs.existsSync(p)) return { enabled: false, schedule: 'off', hour: null };
  try {
    const raw = await fsp.readFile(p, 'utf8');
    const hour = (raw.match(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/) || [])[1];
    const weekday = (raw.match(/<key>Weekday<\/key>\s*<integer>(\d+)<\/integer>/) || [])[1];
    return {
      enabled: true,
      schedule: weekday ? 'weekly' : 'daily',
      hour: hour !== undefined ? parseInt(hour, 10) : 10,
      path: p
    };
  } catch {
    return { enabled: false, schedule: 'off', hour: null };
  }
}

// schedule: 'daily' | 'weekly' | 'off'; hour: 0-23 (local time)
async function set(schedule, hour = 10) {
  hour = Math.max(0, Math.min(23, parseInt(hour, 10) || 10));
  const p = PLIST();

  // always bootout any previously loaded job first (ignore errors)
  try { await launchctl(['bootout', `gui/${process.getuid()}/${LABEL}`]); } catch { /* not loaded */ }

  if (schedule === 'off') {
    try { fs.unlinkSync(p); } catch { /* wasn't there */ }
    return { ok: true, enabled: false, schedule: 'off' };
  }

  // inside Electron: execPath IS the app binary (packaged) or the Electron
  // shell (dev — needs the app dir prepended); from plain node: meaningless.
  const inElectron = !!process.versions.electron;
  const args = inElectron
    ? [process.execPath, ...(app.isPackaged ? [] : [process.cwd()]), '--background-scan']
    : [process.execPath, process.cwd(), '--background-scan'];

  const calendar = schedule === 'weekly'
    ? `<key>Weekday</key><integer>6</integer><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>0</integer>`
    : `<key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>0</integer>`;

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>${args.map((a) => `\n    <string>${a.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>`).join('')}\n  </array>
  <key>StartCalendarInterval</key>
  <dict>${calendar}</dict>
</dict>
</plist>
`;

  const dir = path.dirname(p);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
  await fsp.writeFile(p, plist, 'utf8');

  // load the new job
  const load = await launchctl(['bootstrap', `gui/${process.getuid()}`, p]);
  if (load.err) {
    // older macOS fallback
    const legacy = await launchctl(['load', '-w', p]);
    if (legacy.err) return { ok: true, enabled: true, schedule, hour, warn: 'Plist written; job loads at next login.' };
  }
  return { ok: true, enabled: true, schedule, hour, path: p };
}

module.exports = { status, set, LABEL, PLIST };
