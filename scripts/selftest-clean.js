// Temporary end-to-end self-test for the cleaner (run with: npx electron scripts/selftest-clean.js)
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

app.whenReady().then(async () => {
  const cleaner = require('../src/main/cleaner');
  const dir = path.join(os.homedir(), 'Library', 'Caches', 'lcinocare-selftest');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'x.txt'), 'test');
  fs.writeFileSync(path.join(dir, 'y.txt'), 'test2');

  const r = await cleaner.clean([
    { id: 't1', path: dir, sizeBytes: 9 },
    { id: 't2', path: path.join(os.homedir(), 'Library', 'Keychains'), sizeBytes: 1 } // must be refused
  ]);
  console.log(JSON.stringify(r, null, 2));
  const ok = r.results[0].ok === true && r.results[1].ok === false && r.freedBytes === 9;
  console.log(ok ? 'SELFTEST PASS' : 'SELFTEST FAIL');
  app.exit(ok ? 0 : 1);
});
