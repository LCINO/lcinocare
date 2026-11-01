'use strict';

/* Mock bridge for UI development/QA in a plain browser.
   Loaded only by mock.html — the real app uses preload.js instead.
   Data mirrors the real LcinoCare scan of October 4, 2026. */

window.__errs = [];
window.addEventListener('error', (e) => {
  window.__errs.push(`${String(e.message)} @ ${String(e.filename)}:${String(e.lineno)}`);
});
window.addEventListener('unhandledrejection', (e) => {
  window.__errs.push(`REJ: ${String(e.reason && e.reason.stack ? e.reason.stack : e.reason)}`);
});

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

const MOCK_SCAN = {
  at: new Date().toISOString(),
  durationMs: 41230,
  disk: { totalBytes: 263.2e9, usedBytes: 242.7e9, freeBytes: 20.5e9, freePct: 0.078 },
  safeBytes: 30.9 * GB,
  reviewBytes: 7.0 * GB,
  fdaBlocked: false,
  largeThresholdMB: 10,
  groups: [
    {
      id: 'browser-caches', label: 'Browser & App Caches', icon: 'globe', color: '#0a84ff',
      items: [
        { id: 'm1', groupId: 'browser-caches', label: 'Google Chrome Cache', path: '/Users/anamdev/Library/Caches/Google/Chrome', sizeBytes: 13.0 * GB, safety: 'safe', requiresAppQuit: true, processNames: ['Google Chrome'], whatItIs: 'Web page cache. 13 GB means it grew unchecked for months.', appImpact: 'Chrome works normally; cache rebuilds in a day.' },
        { id: 'm2', groupId: 'browser-caches', label: 'WhatsApp Cache', path: '/Users/anamdev/Library/Caches/net.whatsapp.WhatsApp', sizeBytes: 935 * MB, safety: 'safe', requiresAppQuit: true, processNames: ['WhatsApp'], whatItIs: 'Temporary media cache.', appImpact: 'Chats untouched.' },
        { id: 'm3', groupId: 'browser-caches', label: 'Buzz Cache', path: '/Users/anamdev/Library/Caches/Buzz', sizeBytes: 888 * MB, safety: 'safe', requiresAppQuit: true, processNames: ['Buzz'], whatItIs: 'Temporary app cache.', appImpact: 'Rebuilt automatically.' }
      ]
    },
    {
      id: 'leftover-installers', label: 'Leftover Installers', icon: 'package', color: '#bf5af2',
      items: [
        { id: 'm4', groupId: 'leftover-installers', label: 'createstudio4-updater', path: '/Users/anamdev/Library/Caches/createstudio4-updater', sizeBytes: 1.4 * GB, safety: 'safe', requiresAppQuit: false, processNames: [], whatItIs: 'Installer archive from a past update.', appImpact: 'None.' },
        { id: 'm5', groupId: 'leftover-installers', label: 'autoclaw-updater', path: '/Users/anamdev/Library/Caches/autoclaw-updater', sizeBytes: 1.2 * GB, safety: 'safe', requiresAppQuit: false, processNames: [], whatItIs: 'Installer archive from a past update.', appImpact: 'None.' },
        { id: 'm6', groupId: 'leftover-installers', label: 'com.electron.wispr-flow.ShipIt', path: '/Users/anamdev/Library/Caches/com.electron.wispr-flow.ShipIt', sizeBytes: 798 * MB, safety: 'safe', requiresAppQuit: false, processNames: [], whatItIs: 'Installer archive from a past update.', appImpact: 'None.' },
        { id: 'm7', groupId: 'leftover-installers', label: '@zcodedesktop-updater', path: '/Users/anamdev/Library/Caches/@zcodedesktop-updater', sizeBytes: 466 * MB, safety: 'safe', requiresAppQuit: false, processNames: [], whatItIs: 'Installer archive from a past update.', appImpact: 'None.' }
      ]
    },
    {
      id: 'app-data-bloat', label: 'App Data Bloat', icon: 'layers', color: '#ff9f0a',
      items: [
        { id: 'm8', groupId: 'app-data-bloat', label: 'Claude Desktop VM Bundles', path: '/Users/anamdev/Library/Application Support/Claude/vm_bundles', sizeBytes: 9.9 * GB, safety: 'safe', requiresAppQuit: true, processNames: ['Claude'], whatItIs: 'Downloaded Linux VM images for agent mode; old versions pile up.', appImpact: 'Re-downloaded if ever needed.' },
        { id: 'm9', groupId: 'app-data-bloat', label: 'VoiceStudio — App Data', path: '/Users/anamdev/Library/Application Support/VoiceStudio', sizeBytes: 3.6 * GB, safety: 'review', requiresAppQuit: false, processNames: ['VoiceStudio'], whatItIs: 'VoiceStudio keeps 3.6 GB of data here — may include projects or profiles.', appImpact: 'Open the folder before deleting.' },
        { id: 'm10', groupId: 'app-data-bloat', label: 'CreateStudio4 — App Data', path: '/Users/anamdev/Library/Application Support/CreateStudio4', sizeBytes: 3.4 * GB, safety: 'review', requiresAppQuit: false, processNames: ['CreateStudio4'], whatItIs: 'CreateStudio4 keeps 3.4 GB of data here.', appImpact: 'Open the folder before deleting.' }
      ]
    },
    {
      id: 'dev-caches', label: 'Developer Caches', icon: 'code', color: '#30d158',
      items: [
        { id: 'm11', groupId: 'dev-caches', label: 'Playwright Browser Binaries', path: '/Users/anamdev/Library/Caches/ms-playwright', sizeBytes: 1.5 * GB, safety: 'review', requiresAppQuit: false, processNames: [], whatItIs: 'Browser binaries for automation testing.', appImpact: 'Re-download with npx playwright install.' },
        { id: 'm12', groupId: 'dev-caches', label: 'Homebrew Download Cache', path: '/Users/anamdev/Library/Caches/Homebrew', sizeBytes: 237 * MB, safety: 'safe', requiresAppQuit: false, processNames: [], whatItIs: 'Downloaded packages from past brew installs.', appImpact: 'None.' },
        { id: 'm13', groupId: 'dev-caches', label: 'pip Cache (Python)', path: '/Users/anamdev/Library/Caches/pip', sizeBytes: 203 * MB, safety: 'safe', requiresAppQuit: false, processNames: [], whatItIs: 'Python wheels cache.', appImpact: 'Downloads again on next install.' }
      ]
    },
    {
      id: 'duplicate-copies', label: 'Duplicate Copies', icon: 'copy', color: '#ff453a',
      items: [
        { id: 'm14', groupId: 'duplicate-copies', label: 'autoclaw — duplicate copy (e772b12f)', path: '/Users/anamdev/Library/Application Support/autoclaw/embedded-gateway-runtime/e772b12f51d7bbf9', sizeBytes: 557 * MB, safety: 'safe', requiresAppQuit: true, processNames: ['autoclaw'], whatItIs: 'One of 11 identical copies (557 MB each) that autoclaw accumulated. The two newest are kept.', appImpact: 'The app works with the newest copy.' },
        { id: 'm15', groupId: 'duplicate-copies', label: 'autoclaw — duplicate copy (88fd8512)', path: '/Users/anamdev/Library/Application Support/autoclaw/embedded-gateway-runtime/88fd85125766043d', sizeBytes: 557 * MB, safety: 'safe', requiresAppQuit: true, processNames: ['autoclaw'], whatItIs: 'One of 11 identical copies (557 MB each). The two newest are kept.', appImpact: 'The app works with the newest copy.' }
      ]
    },
    {
      id: 'mail-attachments', label: 'Mail Attachments', icon: 'files', color: '#c46aff',
      items: [
        { id: 'm17', groupId: 'mail-attachments', label: 'Invoice bundles (re-downloaded)', path: '/Users/anamdev/Library/Mail Downloads/invoices', sizeBytes: 214 * MB, safety: 'review', requiresAppQuit: true, processNames: ['Mail'], whatItIs: 'Attachments Mail saved to disk when opened. The originals stay on the mail server.', appImpact: 'Mail re-downloads an attachment the next time you open it.' },
        { id: 'm18', groupId: 'mail-attachments', label: 'Large media attachments', path: '/Users/anamdev/Library/Mail Downloads/media', sizeBytes: 96 * MB, safety: 'review', requiresAppQuit: true, processNames: ['Mail'], whatItIs: 'Video and image attachments saved when you previewed them.', appImpact: 'Re-downloaded from the server on demand.' }
      ]
    },
    {
      id: 'logs', label: 'Logs', icon: 'doc', color: '#8e8e93',
      items: [
        { id: 'm16', groupId: 'logs', label: 'Application Logs', path: '/Users/anamdev/Library/Logs', sizeBytes: 17 * MB, safety: 'safe', requiresAppQuit: false, processNames: [], whatItIs: 'Diagnostic text logs.', appImpact: 'None.' }
      ]
    }
  ],
  nodeModules: [
    { path: '/Users/anamdev/LCINO/Lcino Editor/remotion/node_modules', sizeBytes: 734 * MB },
    { path: '/Users/anamdev/LCINO/AnamDev/lcino-vault/node_modules', sizeBytes: 569 * MB },
    { path: '/Users/anamdev/LCINO/Lcino Writer/ContentPilot/node_modules', sizeBytes: 485 * MB },
    { path: '/Users/anamdev/LCINO/LCINO/Lcino Agent/node_modules', sizeBytes: 482 * MB },
    { path: '/Users/anamdev/LCINO/Lcino Outreach/node_modules', sizeBytes: 455 * MB },
    { path: '/Users/anamdev/LCINO/GitHub Projects/LcinoTube/node_modules', sizeBytes: 411 * MB }
  ],
  largeFiles: [
    { path: '/Users/anamdev/Desktop/Screen Recording 2026-09-10 at 4.12.15 PM.mov', sizeBytes: 2.2 * GB, mtimeMs: Date.now() - 20 * 86400000, kind: 'video' },
    { path: '/Users/anamdev/Desktop/Screen Recording 2026-08-24 at 5.36.27 PM.mov', sizeBytes: 1.7 * GB, mtimeMs: Date.now() - 41 * 86400000, kind: 'video' },
    { path: '/Users/anamdev/createstudio4-app.asar.bak', sizeBytes: 314 * MB, mtimeMs: Date.now() - 60 * 86400000, kind: 'other' },
    { path: '/Users/anamdev/Desktop/ui:ux video.mov', sizeBytes: 201 * MB, mtimeMs: Date.now() - 30 * 86400000, kind: 'video' },
    { path: '/Users/anamdev/Downloads/AI ভিডিও তৈরি Class- 5.mp4', sizeBytes: 162 * MB, mtimeMs: Date.now() - 9 * 86400000, kind: 'video' },
    { path: '/Users/anamdev/Downloads/Leads-gorilla-2.1-1.mp4', sizeBytes: 116 * MB, mtimeMs: Date.now() - 15 * 86400000, kind: 'video' }
  ],
  trash: { sizeBytes: 1.2 * GB, unreadable: false }
};

const MOCK_HEALTH = {
  cpu: 8,
  memory: { usedPct: 71, totalBytes: 16 * GB, freeBytes: 4.6 * GB, swapBytes: 3 * GB },
  disk: { totalBytes: 263.2e9, usedBytes: 242.7e9, freeBytes: 20.5e9, usedPct: 92, freePct: 0.078 },
  battery: { hasBattery: true, percent: 82, charging: true, cycleCount: 87, condition: 'Normal', maxCapacityPct: 100 },
  score: {
    score: 42,
    factors: [
      { label: 'Disk space', earned: 14, max: 40, note: '20.5 GB free (8%). macOS stays healthy above 20%.' },
      { label: 'Memory pressure', earned: 12, max: 30, note: '71% of RAM in use, 3.0 GB swapped to disk.' },
      { label: 'Battery health', earned: 15, max: 15, note: '82% charge, 87 cycles, condition: Normal.' },
      { label: 'Junk load', earned: 0, max: 15, note: '30.9 GB of caches and leftovers found.' }
    ]
  },
  uptimeSeconds: 86400 * 2 + 7300
};

const MOCK_APPS = [
  { name: 'Adobe After Effects 2026', path: '/Applications/Adobe After Effects 2026', location: 'Applications' },
  { name: 'AutoClaw', path: '/Applications/AutoClaw.app', location: 'Applications' },
  { name: 'Google Chrome', path: '/Applications/Google Chrome.app', location: 'Applications' },
  { name: 'Claude', path: '/Applications/Claude.app', location: 'Applications' },
  { name: 'Visual Studio Code', path: '/Applications/Visual Studio Code.app', location: 'Applications' },
  { name: 'CreateStudio4-Test', path: '/Users/anamdev/Applications/CreateStudio4-Test.app', location: 'User Applications' },
  { name: 'ZCode', path: '/Applications/ZCode.app', location: 'Applications' },
  { name: 'Telegram', path: '/Applications/Telegram.app', location: 'Applications' }
];

const MOCK_PROCESSES = {
  byCpu: [
    { name: 'Google Chrome', type: 'app', cpu: 23.4, rssBytes: 1.2 * GB, pids: [401] },
    { name: 'node', type: 'process', cpu: 12.1, rssBytes: 320 * MB, pids: [502] },
    { name: 'Claude', type: 'app', cpu: 6.8, rssBytes: 890 * MB, pids: [603] }
  ],
  byMem: [
    { name: 'Google Chrome', type: 'app', cpu: 23.4, rssBytes: 2.1 * GB, pids: [401] },
    { name: 'Claude', type: 'app', cpu: 6.8, rssBytes: 890 * MB, pids: [603] },
    { name: 'ZCode', type: 'app', cpu: 3.1, rssBytes: 720 * MB, pids: [704] }
  ]
};

window.lcino = {
  scan: () => new Promise((r) => setTimeout(() => r({ ok: true, result: MOCK_SCAN }), 400)),
  onScanProgress: () => {},
  onOverviewProgress: () => () => {},
  clean: (items) => new Promise((r) => setTimeout(() => r({ results: items.map((i) => ({ ...i, ok: true })), freedBytes: items.reduce((s, i) => s + (i.sizeBytes || 0), 0) }), 500)),
  trashInfo: () => Promise.resolve(MOCK_SCAN.trash),
  trashEmpty: () => Promise.resolve({ ok: true }),
  health: () => new Promise((r) => setTimeout(() => r(MOCK_HEALTH), 120)),
  findDuplicates: () => Promise.resolve({ groups: [], wastedBytes: 0 }),
  listProcesses: () => Promise.resolve(MOCK_PROCESSES),
  quitProcesses: () => Promise.resolve([]),
  listApps: () => Promise.resolve(MOCK_APPS),
  inspectApp: (p) => Promise.resolve({
    name: p.split('/').pop().replace('.app', ''), path: p, bundleId: 'com.example.' + p.split('/').pop().replace('.app', '').toLowerCase().replace(/\s+/g, ''),
    version: '4.2.1', sizeBytes: 2.3 * GB, running: false, pids: [],
    leftovers: [
      { path: `/Users/anamdev/Library/Application Support/${p.split('/').pop()}`, sizeBytes: 640 * MB, caution: false },
      { path: `/Users/anamdev/Library/Caches/${p.split('/').pop()}`, sizeBytes: 128 * MB, caution: false },
      { path: `/Users/anamdev/Library/Containers/com.example.test`, sizeBytes: 42 * MB, caution: true }
    ]
  }),
  uninstallApp: () => Promise.resolve({ results: [{ ok: true }] }),
  search: (q) => {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    const entries = [];
    for (const g of MOCK_SCAN.groups) {
      for (const item of g.items) {
        const hay = `${item.label} ${item.path}`.toLowerCase();
        if (tokens.every((t) => hay.includes(t))) {
          entries.push({ type: 'cleaner', title: item.label, subtitle: item.path, sizeBytes: item.sizeBytes, path: item.path, keywords: '' });
        }
      }
    }
    const features = [
      { view: 'dashboard', title: 'Dashboard', keywords: 'health score cpu memory ram disk battery' },
      { view: 'clean', title: 'Smart Clean', keywords: 'clean junk cache trash' },
      { view: 'duplicates', title: 'Duplicates', keywords: 'duplicate same copy clone photo video' },
      { view: 'files', title: 'Large Files', keywords: 'large big huge file video movie' },
      { view: 'apps', title: 'Applications', keywords: 'app uninstall remove leftover' },
      { view: 'speed', title: 'Speed & Memory', keywords: 'speed memory booster slow process cpu' },
      { view: 'protected', title: 'Protected Items', keywords: 'protected never delete safe system' },
      { view: 'history', title: 'History', keywords: 'history log cleaned' }
    ];
    for (const f of features) {
      if (tokens.some((t) => `${f.title} ${f.keywords}`.toLowerCase().includes(t))) {
        entries.push({ type: 'feature', title: f.title, subtitle: 'Go to view', view: f.view, keywords: '' });
      }
    }
    const grouped = {};
    for (const e of entries) {
      grouped[e.type] = grouped[e.type] || [];
      if (grouped[e.type].length < 6) grouped[e.type].push(e);
    }
    return Promise.resolve(grouped);
  },
  history: () => Promise.resolve([
    { at: new Date(Date.now() - 3600000).toISOString(), kind: 'clean', count: 9, freedBytes: 14.2 * GB, paths: [] },
    { at: new Date(Date.now() - 86400000).toISOString(), kind: 'trash', count: 0, freedBytes: null, paths: [] }
  ]),
  reveal: () => {},
  appInfo: () => Promise.resolve({ name: 'LcinoCare', slogan: 'Therapy for Your Mac', version: '1.0.0', electron: '44.5.1', node: '22.20.0', platform: 'darwin arm64' }),
  appRunning: () => Promise.resolve([]),
  quitApps: () => Promise.resolve([]),
  protectedList: () => Promise.resolve([
    { label: 'macOS System', detail: 'The operating system itself. Deleting anything here breaks the Mac.' },
    { label: 'System Databases (/private/var/db)', detail: 'Security and system databases (Gatekeeper, accounts, etc.).' },
    { label: 'Keychains', detail: 'Your saved passwords and certificates.' },
    { label: 'Preferences', detail: 'Every app\u2019s settings live here.' },
    { label: 'Mail Data', detail: 'Your email, until synced back from the server — risky to remove.' },
    { label: 'App Containers', detail: 'Sandboxed app data that may hold irreplaceable documents and state.' },
    { label: 'Swap Files', detail: 'Virtual memory in use right now. Restarting the Mac resets them safely.' },
    { label: 'Temp Folders (/private/var/folders)', detail: 'Managed by macOS itself; it cleans these automatically.' }
  ]),
  appMeta: (p) => Promise.resolve({ icon: null, version: '4.2.1', addedMs: Date.now() - 90 * 86400000 }),
  appSize: (p) => Promise.resolve(Math.round((0.2 + (p.length % 30) / 10) * 1024 * 1024 * 1024)),
  homeOverview: () => Promise.resolve([
    { name: 'Library', path: '/Users/anamdev/Library', sizeBytes: 52 * GB, isDir: true },
    { name: 'LCINO', path: '/Users/anamdev/LCINO', sizeBytes: 9.7 * GB, isDir: true },
    { name: 'Desktop', path: '/Users/anamdev/Desktop', sizeBytes: 5.1 * GB, isDir: true },
    { name: 'Applications', path: '/Users/anamdev/Applications', sizeBytes: 2.3 * GB, isDir: true },
    { name: 'Downloads', path: '/Users/anamdev/Downloads', sizeBytes: 702 * MB, isDir: true },
    { name: 'ahbd', path: '/Users/anamdev/ahbd', sizeBytes: 526 * MB, isDir: true },
    { name: 'createstudio4-app.asar.bak', path: '/Users/anamdev/createstudio4-app.asar.bak', sizeBytes: 314 * MB, isDir: false },
    { name: 'node_modules', path: '/Users/anamdev/node_modules', sizeBytes: 278 * MB, isDir: true },
    { name: 'Documents', path: '/Users/anamdev/Documents', sizeBytes: 121 * MB, isDir: true },
    { name: 'ContentPilot', path: '/Users/anamdev/ContentPilot', sizeBytes: 29 * MB, isDir: true }
  ]),
  startupList: () => Promise.resolve({
    loginItems: ['Google Chrome', 'WhatsApp', 'Buzz', 'AutoClaw'],
    agents: [
      { name: 'com.google.keystone.user.agent', file: 'com.google.keystone.user.agent.plist', path: '/Users/anamdev/Library/LaunchAgents/com.google.keystone.user.agent.plist', scope: 'user', disabled: false },
      { name: 'com.whatsapp.WhatsApp.agent', file: 'com.whatsapp.WhatsApp.agent.plist', path: '/Users/anamdev/Library/LaunchAgents/com.whatsapp.WhatsApp.agent.plist', scope: 'user', disabled: false },
      { name: 'com.apple.FolderActions.enabled', file: 'com.apple.FolderActions.enabled.plist', path: '/Library/LaunchAgents/com.apple.FolderActions.enabled.plist', scope: 'system', disabled: false },
      { name: 'com.adobe.ARM.dc522e1e', file: 'com.adobe.ARM.dc522e1e.plist', path: '/Library/LaunchAgents/com.adobe.ARM.dc522e1e.plist', scope: 'system', disabled: false }
    ]
  }),
  startupSetDisabled: () => Promise.resolve({ ok: true }),
  snapshotsList: () => Promise.resolve({
    ok: true,
    snapshots: [
      { name: 'com.apple.TimeMachine.2026-10-05-091412.local', date: Date.now() - 5 * 3600000 },
      { name: 'com.apple.TimeMachine.2026-10-04-211022.local', date: Date.now() - 20 * 3600000 },
      { name: 'com.apple.TimeMachine.2026-10-03-184531.local', date: Date.now() - 44 * 3600000 }
    ]
  }),
  snapshotsPurge: () => Promise.resolve({ ok: true, deleted: 3 }),
  maintenanceList: () => Promise.resolve([
    { id: 'flush-dns', label: 'Flush DNS Cache', needsAdmin: true, description: 'Clears the local DNS lookup cache.' },
    { id: 'free-ram', label: 'Free Up RAM', needsAdmin: true, description: 'Purges inactive memory and purgeable caches.' },
    { id: 'maintenance-scripts', label: 'Run Maintenance Scripts', needsAdmin: true, description: 'Runs daily/weekly/monthly housekeeping scripts.' },
    { id: 'reindex-spotlight', label: 'Reindex Spotlight', needsAdmin: true, description: 'Rebuilds the Spotlight index.' },
    { id: 'speed-up-mail', label: 'Speed Up Mail', needsAdmin: false, description: 'Compacts the local Mail database.', requiresAppQuit: ['Mail'] },
    { id: 'verify-disk', label: 'Verify Startup Disk', needsAdmin: false, description: 'Read-only integrity check of the startup volume.' }
  ]),
  maintenanceRun: (ids) => Promise.resolve({
    results: ids.map((id) => ({ id, ok: true, detail: 'Completed.' }))
  }),
  downloadsScan: () => Promise.resolve({
    ok: true,
    root: '/Users/anamdev/Downloads',
    totalBytes: 1.24 * GB,
    items: [
      { id: 'dl-1', label: 'Leads-gorilla-2.1-1.mp4', path: '/Users/anamdev/Downloads/Leads-gorilla-2.1-1.mp4', sizeBytes: 116 * MB, mtimeMs: Date.now() - 15 * 86400000, kind: 'video' },
      { id: 'dl-2', label: 'LcinoCare-1.4.0-arm64.dmg', path: '/Users/anamdev/Downloads/LcinoCare-1.4.0-arm64.dmg', sizeBytes: 124 * MB, mtimeMs: Date.now() - 3 * 86400000, kind: 'installer' },
      { id: 'dl-3', label: 'AI Video Making Class- 5.mp4', path: '/Users/anamdev/Downloads/AI Video Making Class- 5.mp4', sizeBytes: 157 * MB, mtimeMs: Date.now() - 30 * 86400000, kind: 'video' },
      { id: 'dl-4', label: 'contract-2026.pdf', path: '/Users/anamdev/Downloads/docs/contract-2026.pdf', sizeBytes: 2.2 * MB, mtimeMs: Date.now() - 9 * 86400000, kind: 'document' }
    ]
  }),
  privacyScan: () => Promise.resolve({
    ok: true,
    browsers: [
      {
        id: 'chrome', name: 'Google Chrome', totalBytes: 412 * MB,
        categories: [
          { id: 'chrome-history', label: 'Browsing History', sizeBytes: 48 * MB, items: [{ id: 'c-h', path: '~/Library/Application Support/Google/Chrome/Default/History' }] },
          { id: 'chrome-cookies', label: 'Cookies', sizeBytes: 12 * MB, items: [{ id: 'c-c', path: '~/Library/Application Support/Google/Chrome/Default/Cookies' }] },
          { id: 'chrome-localstorage', label: 'Local Storage', sizeBytes: 352 * MB, items: [{ id: 'c-l', path: '~/Library/Application Support/Google/Chrome/Default/Local Storage' }] }
        ]
      },
      {
        id: 'safari', name: 'Safari', totalBytes: 9 * MB, blocked: false,
        categories: [
          { id: 'safari-history', label: 'Browsing History', sizeBytes: 6 * MB, items: [{ id: 's-h', path: '~/Library/Safari/History.db' }] },
          { id: 'safari-cookies', label: 'Cookies', sizeBytes: 3 * MB, items: [{ id: 's-c', path: '~/Library/Safari/Cookies.binarycookies' }] }
        ]
      }
    ],
    grandTotal: 421 * MB
  }),
  privacyClean: (items) => Promise.resolve({ results: items.map((i) => ({ ...i, ok: true })), freedBytes: items.length * 1000 }),
  similarScan: () => Promise.resolve({
    ok: true, scanned: 342, totalFiles: 342, groupCount: 2,
    groups: [
      {
        id: 'sg-0',
        items: [
          { id: 'si-0-0', path: '/Users/anamdev/Pictures/shoot-2026/IMG_2041.jpg', sizeBytes: 3.4 * MB, mtimeMs: Date.now() - 40 * 86400000, thumb: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=AAAAAA==' },
          { id: 'si-0-1', path: '/Users/anamdev/Pictures/shoot-2026/IMG_2042.jpg', sizeBytes: 3.1 * MB, mtimeMs: Date.now() - 40 * 86400000, thumb: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=AAAAAA==' },
          { id: 'si-0-2', path: '/Users/anamdev/Pictures/shoot-2026/IMG_2043.jpg', sizeBytes: 2.8 * MB, mtimeMs: Date.now() - 40 * 86400000, thumb: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=AAAAAA==' }
        ]
      },
      {
        id: 'sg-1',
        items: [
          { id: 'si-1-0', path: '/Users/anamdev/Pictures/moodboard.png', sizeBytes: 820 * 1024, mtimeMs: Date.now() - 90 * 86400000, thumb: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=AAAAAA==' },
          { id: 'si-1-1', path: '/Users/anamdev/Pictures/moodboard (copy).png', sizeBytes: 810 * 1024, mtimeMs: Date.now() - 88 * 86400000, thumb: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=AAAAAA==' }
        ]
      }
    ]
  }),
  quitApp: () => { window.__mockQuit = (window.__mockQuit || 0) + 1; },
  setLoginItem: (open) => Promise.resolve(!!open)
};
