'use strict';

// LcinoCare — Security Status (the honest kind).
// LcinoCare does not ship an antivirus engine. Instead it REPORTS the state of
// the real protection macOS already provides — XProtect signatures, the
// malware removal tools, FileVault, the firewall, and Gatekeeper — plus
// pointers to where each one is managed. Read-only, all of it.

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

function run(cmd, args, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
      resolve({ err: err ? String(err.message || err) : null, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() });
    });
  });
}

async function bundleVersion(plistPath) {
  if (!fs.existsSync(plistPath)) return null;
  const r = await run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plistPath]);
  return r.err ? null : (r.stdout || null);
}

async function xprotect() {
  const core = '/Library/Apple/System/Library/CoreServices';
  const [sig, remediator, mrt, history] = await Promise.all([
    bundleVersion(path.join(core, 'XProtect.bundle', 'Contents', 'Info.plist')),
    bundleVersion(path.join(core, 'XProtect.app', 'Contents', 'Info.plist')),
    bundleVersion(path.join(core, 'MRT.app', 'Contents', 'Info.plist')),
    run('/usr/bin/softwareupdate', ['--history'], 20000)
  ]);
  // last signature update date from softwareupdate history
  let lastUpdate = null;
  if (!history.err) {
    const line = history.stdout.split('\n').find((l) => /XProtect/i.test(l));
    if (line) lastUpdate = line.trim().split(/\s{2,}/).slice(-2)[0] || null;
  }
  const available = sig !== null || mrt !== null || remediator !== null;
  return {
    available,
    signatures: sig,
    remediator,
    mrt,
    lastUpdate,
    readable: available
  };
}

async function filevault() {
  const r = await run('/usr/bin/fdesetup', ['status']);
  if (r.err) return { available: false, on: null, note: r.err };
  return {
    available: true,
    on: /FileVault is On/i.test(r.stdout + r.stderr),
    note: (r.stdout || r.stderr || '').trim()
  };
}

async function firewall() {
  const r = await run('/usr/libexec/ApplicationFirewall/socketfilterfw', ['--getglobalstate']);
  if (r.err) return { available: false, on: null, note: r.err };
  const on = /enabled/i.test(r.stdout);
  return { available: true, on, note: r.stdout.trim() };
}

async function gatekeeper() {
  const r = await run('/usr/sbin/spctl', ['--status']);
  if (r.err) return { available: false, on: null, note: r.err };
  const on = /enabled/i.test(r.stdout) && !/disabled/i.test(r.stdout);
  return { available: true, on, note: r.stdout.trim() };
}

async function status() {
  const [xp, fv, fw, gk] = await Promise.all([xprotect(), filevault(), firewall(), gatekeeper()]);
  return { ok: true, xprotect: xp, filevault: fv, firewall: fw, gatekeeper: gk };
}

module.exports = { status };
