'use strict';

// LcinoCare — Startup view: what launches with the Mac.
// Sources (read-only except user LaunchAgents toggle):
//   • Login Items — via System Events (AppleScript); may require the user to
//     grant Automation permission once; on failure we degrade gracefully.
//   • User Launch Agents — ~/Library/LaunchAgents/*.plist
//   • System Launch Agents/Daemons — /Library/Launch{Agents,Daemons} (names only)
// Disabling works ONLY for user Launch Agents: the plist is moved into a
// sibling folder launchd never loads — fully reversible.

const { spawn } = require('child_process');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const USER_AGENTS = path.join(HOME, 'Library', 'LaunchAgents');
const DISABLED_DIR = path.join(USER_AGENTS, 'Disabled (by LcinoCare)');

function plutilLabel(plist) {
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/plutil', ['-extract', 'Label', 'raw', plist]);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? out.trim() : null));
  });
}

async function listPlists(dir, scope) {
  let names;
  try { names = await fsp.readdir(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.plist')) continue;
    const p = path.join(dir, n);
    const label = await plutilLabel(p);
    out.push({ name: label || n.replace(/\.plist$/, ''), file: n, path: p, scope, disabled: false });
  }
  return out;
}

async function listDisabled() {
  let names;
  try { names = await fsp.readdir(DISABLED_DIR); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.plist')) continue;
    const p = path.join(DISABLED_DIR, n);
    const label = await plutilLabel(p);
    out.push({ name: label || n.replace(/\.plist$/, ''), file: n, path: p, scope: 'user', disabled: true });
  }
  return out;
}

function loginItems() {
  return new Promise((resolve) => {
    const script = 'tell application "System Events" to get the name of every login item';
    const child = spawn('/usr/bin/osascript', ['-e', script], { timeout: 8000 });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0) return resolve(null); // no Automation permission yet
      resolve(out.split(',').map((s) => s.trim()).filter(Boolean));
    });
  });
}

async function listStartup() {
  const [user, systemAgents, daemons, disabled, login] = await Promise.all([
    listPlists(USER_AGENTS, 'user'),
    listPlists('/Library/LaunchAgents', 'system'),
    listPlists('/Library/LaunchDaemons', 'daemon'),
    listDisabled(),
    loginItems()
  ]);
  return {
    loginItems: login, // null = permission not granted yet; [] = none
    agents: [...user, ...disabled, ...systemAgents, ...daemons]
  };
}

// Move a user Launch Agent plist in/out of the never-loaded folder.
async function setAgentDisabled(p, disabled) {
  const target = path.resolve(p);
  if (!target.startsWith(USER_AGENTS + path.sep) || !target.endsWith('.plist')) {
    return { ok: false, reason: 'Only user Launch Agents can be toggled.' };
  }
  try {
    if (disabled) {
      await fsp.mkdir(DISABLED_DIR, { recursive: true });
      await fsp.rename(target, path.join(DISABLED_DIR, path.basename(target)));
    } else {
      const src = path.join(DISABLED_DIR, path.basename(target));
      await fsp.rename(src, path.join(USER_AGENTS, path.basename(target)));
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err.message || err) };
  }
}

module.exports = { listStartup, setAgentDisabled };
