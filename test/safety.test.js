'use strict';

// Adversarial tests for the delete guards. Run with: npm test
// Everything happens inside a throwaway fake home folder; the real home is
// never read or written.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'lcinocare-home-'));
process.env.HOME = FAKE_HOME; // os.homedir() honours $HOME; set before requiring the cleaner

const { isProtected, isProtectedLocation, clean } = require('../src/main/cleaner');
const { shred } = require('../src/main/shredder');

const H = (...p) => path.join(FAKE_HOME, ...p);
function mk(rel, content) {
  const p = H(rel);
  fs.mkdirSync(content === undefined ? p : path.dirname(p), { recursive: true });
  if (content !== undefined) fs.writeFileSync(p, content);
  return p;
}

mk('Library/Caches/com.example.app');
mk('Library/Keychains/login.keychain-db', 'secret');
mk('.ssh/id_ed25519', 'key');
mk('projects/app/.git/HEAD', 'ref');
mk('projects/app/node_modules/pkg/index.js', 'x');
mk('projects/app/.env.local', 'API_KEY=1');
mk('projects/site/package.json', '{}');
mk('Downloads/movie.mp4', 'x');
mk('Downloads/data.sqlite', 'x');
mk('Pictures/Photos Library.photoslibrary/originals/a.jpg', 'x');
fs.symlinkSync(H('.ssh'), H('Library/Caches/innocent-looking'));
fs.symlinkSync('/System', H('Library/Caches/system-link'));

test('regular clean targets stay deletable', () => {
  assert.equal(isProtected(H('Library/Caches/com.example.app')), false);
  assert.equal(isProtected(H('projects/app/node_modules')), false);
  assert.equal(isProtected(H('Downloads/movie.mp4')), false);
  assert.equal(isProtected('~/Library/Caches/com.example.app'), false);
});

test('home, ~/Library and everything outside home are protected', () => {
  for (const p of [FAKE_HOME, H('Library'), '/', '/System', '/Applications/Safari.app',
    '/Library/Logs', '/Users/Shared', '/private/tmp', '/Volumes/Backup', '']) {
    assert.equal(isProtected(p), true, p);
  }
});

test('sensitive folders are protected, case-insensitively', () => {
  for (const p of ['Library/Keychains', 'library/keychains', 'LIBRARY/KEYCHAINS/login.keychain-db',
    '.ssh', '.SSH/id_ed25519', '.gnupg', '.aws/credentials', '.config/gh/hosts.yml',
    '.claude/settings.json', 'Library/Mail', 'Library/Safari/History.db']) {
    assert.equal(isProtected(H(p)), true, p);
  }
});

test('".." cannot climb into a protected folder', () => {
  assert.equal(isProtected(H('Library/Caches/../Keychains')), true);
  assert.equal(isProtected(H('Downloads/../.ssh/id_ed25519')), true);
});

test('symlinks are judged by where they point', () => {
  assert.equal(isProtected(H('Library/Caches/innocent-looking')), true);
  assert.equal(isProtected(H('Library/Caches/innocent-looking/id_ed25519')), true);
  assert.equal(isProtected(H('Library/Caches/system-link')), true);
});

test('.git internals, repository roots and media libraries are protected', () => {
  assert.equal(isProtected(H('projects/app/.git')), true);
  assert.equal(isProtected(H('projects/app/.git/HEAD')), true);
  assert.equal(isProtected(H('projects/app')), true, 'folder holding .git');
  assert.equal(isProtected(H('Pictures/Photos Library.photoslibrary')), true);
  assert.equal(isProtected(H('Pictures/Photos Library.photoslibrary/originals/a.jpg')), true);
});

test('secret and database file names are protected', () => {
  for (const p of ['projects/app/.env.local', 'projects/x/.env', 'Downloads/server.pem',
    'Downloads/id_rsa', 'Downloads/data.sqlite', 'Downloads/app.db', 'Downloads/credentials',
    'Downloads/secrets.json', 'Downloads/token.txt']) {
    assert.equal(isProtected(H(p)), true, p);
  }
  // look-alikes that are ordinary files
  assert.equal(isProtected(H('Downloads/Secret Garden.mp4')), false);
  assert.equal(isProtected(H('Downloads/tokenizer.json')), false);
});

test('clean() refuses paths that were never offered, and protected ones, without touching them', async () => {
  const offered = new Map([[H('Library/Caches/com.example.app'), []]]);
  const { results, freedBytes } = await clean([
    { id: 'a', path: H('Downloads/movie.mp4'), sizeBytes: 5 }, // not offered
    { id: 'b', path: H('Library/Keychains'), sizeBytes: 5 }, // protected
    { id: 'c', path: H('Library/Caches/innocent-looking'), sizeBytes: 5 }, // symlink to .ssh
    { id: 'd', path: 42 } // malformed
  ], { offered });
  assert.equal(freedBytes, 0);
  assert.equal(results.length, 3);
  assert.ok(results.every((r) => r.ok === false));
  assert.match(results[0].reason, /not part of a LcinoCare scan/);
  assert.match(results[1].reason, /protected/);
  assert.ok(fs.existsSync(H('Downloads/movie.mp4')));
  assert.ok(fs.existsSync(H('.ssh/id_ed25519')));
});

test('shredder refuses symlinks, hard links and protected locations', async () => {
  const target = mk('Documents/keep.txt', 'precious');
  fs.symlinkSync(target, H('Documents/link.txt'));
  fs.linkSync(target, H('Documents/hardlink.txt'));
  const { results } = await shred([
    H('Documents/link.txt'),
    H('Documents/hardlink.txt'),
    H('Library/Keychains/login.keychain-db')
  ]);
  assert.ok(results.every((r) => r.ok === false));
  assert.equal(fs.readFileSync(target, 'utf8'), 'precious');
  assert.equal(fs.readFileSync(H('Library/Keychains/login.keychain-db'), 'utf8'), 'secret');
});

test('shredder still destroys an ordinary picked file, secrets included', async () => {
  const p = mk('Documents/old-api.pem', 'bytes');
  assert.equal(isProtectedLocation(p), false);
  const { results } = await shred([p]);
  assert.equal(results[0].ok, true);
  assert.equal(fs.existsSync(p), false);
});

test.after(() => fs.rmSync(FAKE_HOME, { recursive: true, force: true }));
