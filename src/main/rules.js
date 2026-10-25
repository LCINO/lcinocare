'use strict';

// LcinoCare — safety knowledge base.
// Every cleanable item surfaced by the app is defined here, with its verdict,
// a plain-English explanation, and what happens to the owning app after deletion.
// Nothing outside this list (plus the structural finders: node_modules, large
// files, duplicates) is ever offered for deletion.

const GROUPS = [
  { id: 'browser-caches', label: 'Browser & App Caches', icon: 'globe', color: '#0a84ff' },
  { id: 'leftover-installers', label: 'Leftover Installers', icon: 'package', color: '#bf5af2' },
  { id: 'app-data-bloat', label: 'App Data Bloat', icon: 'layers', color: '#ff9f0a' },
  { id: 'dev-caches', label: 'Developer Caches', icon: 'code', color: '#30d158' },
  { id: 'mail-attachments', label: 'Mail Attachments', icon: 'files', color: '#c46aff' },
  { id: 'logs', label: 'Logs', icon: 'doc', color: '#8e8e93' }
];

// safety: 'safe'   — regenerable data; the owning app rebuilds or re-downloads it.
//         'review' — safe in principle, but the user should glance before deleting
//                    (re-downloading costs time or bandwidth, or it is user data).
//
// Paths may be literal ('~/Library/Logs') or glob patterns ('~/Library/Caches/*-updater').
// processNames are checked with pgrep before deletion; if any is running the item
// is blocked with a "quit the app first" warning in the UI.

const RULES = [
  // ── Browser & app caches ────────────────────────────────────────────────
  {
    id: 'chrome-cache',
    group: 'browser-caches',
    label: 'Google Chrome Cache',
    safety: 'safe',
    paths: ['~/Library/Caches/Google/Chrome'],
    processNames: ['Google Chrome'],
    appDisplayName: 'Google Chrome',
    requiresAppQuit: true,
    whatItIs: 'Web page cache (images, scripts, site data). A healthy size is 0.5–2 GB; more means it has been growing unchecked.',
    appImpact: 'Chrome keeps working normally. Passwords, history, extensions and bookmarks live elsewhere. Pages load slightly slower for a day while the cache rebuilds.'
  },
  {
    id: 'whatsapp-cache',
    group: 'browser-caches',
    label: 'WhatsApp Cache',
    safety: 'safe',
    paths: ['~/Library/Caches/net.whatsapp.WhatsApp'],
    processNames: ['WhatsApp'],
    appDisplayName: 'WhatsApp',
    requiresAppQuit: true,
    whatItIs: 'Temporary media and thumbnail cache of the WhatsApp desktop app.',
    appImpact: 'Chats and received media are stored in a different folder and are not touched.'
  },
  {
    id: 'buzz-cache',
    group: 'browser-caches',
    label: 'Buzz Cache',
    safety: 'safe',
    paths: ['~/Library/Caches/Buzz'],
    processNames: ['Buzz'],
    appDisplayName: 'Buzz',
    requiresAppQuit: true,
    whatItIs: 'Temporary cache of the Buzz desktop app.',
    appImpact: 'Buzz rebuilds the cache automatically as you use it.'
  },
  {
    id: 'telegram-cache',
    group: 'browser-caches',
    label: 'Telegram Cache',
    safety: 'safe',
    paths: ['~/Library/Caches/ru.keepcoder.Telegram'],
    processNames: ['Telegram'],
    appDisplayName: 'Telegram',
    requiresAppQuit: true,
    whatItIs: 'Downloaded-media and preview cache of Telegram Desktop.',
    appImpact: 'Chats stay intact; media is re-downloaded on demand from Telegram cloud.'
  },
  {
    id: 'browser-cache-generic',
    group: 'browser-caches',
    label: '1Browser Cache',
    safety: 'safe',
    paths: ['~/Library/Caches/1browser'],
    processNames: ['1browser'],
    appDisplayName: '1browser',
    requiresAppQuit: true,
    whatItIs: 'Temporary browsing cache of the 1browser app.',
    appImpact: 'Rebuilt automatically on next launch.'
  },
  {
    id: 'geoservices-cache',
    group: 'browser-caches',
    label: 'Apple Maps Cache (GeoServices)',
    safety: 'safe',
    paths: ['~/Library/Caches/GeoServices'],
    processNames: [],
    requiresAppQuit: false,
    whatItIs: 'Map tiles and place data cached by Apple Maps.',
    appImpact: 'Maps re-downloads tiles the next time you look at them.'
  },

  // ── Leftover installers (matched by glob) ───────────────────────────────
  {
    id: 'updater-leftovers',
    group: 'leftover-installers',
    label: 'App Updater Leftovers',
    safety: 'safe',
    paths: ['~/Library/Caches/*-updater*', '~/Library/Caches/*ShipIt*'],
    processNames: [],
    requiresAppQuit: false,
    whatItIs: 'Full installer archives that desktop apps (CreateStudio, AutoClaw, Wispr, ZCode, …) downloaded for past updates and never cleaned up.',
    appImpact: 'None. The installed apps themselves are not touched; they have already been updated.'
  },

  // ── App data bloat ──────────────────────────────────────────────────────
  {
    id: 'claude-vm-bundles',
    group: 'app-data-bloat',
    label: 'Claude Desktop VM Bundles',
    safety: 'safe',
    paths: ['~/Library/Application Support/Claude/vm_bundles'],
    processNames: ['Claude'],
    appDisplayName: 'Claude',
    requiresAppQuit: true,
    whatItIs: 'Downloaded Linux VM images used by the Claude desktop app for its VM/agent mode. New versions pile up next to old ones.',
    appImpact: 'Claude works normally; if a VM bundle is ever needed again it is downloaded automatically.'
  },
  {
    id: 'claude-electron-caches',
    group: 'app-data-bloat',
    label: 'Claude Desktop Internal Caches',
    safety: 'safe',
    paths: [
      '~/Library/Application Support/Claude/Cache',
      '~/Library/Application Support/Claude/Code Cache',
      '~/Library/Application Support/Claude/GPUCache'
    ],
    processNames: ['Claude'],
    appDisplayName: 'Claude',
    requiresAppQuit: true,
    whatItIs: 'Internal HTTP/GPU caches of the Claude desktop app (it is built on Electron).',
    appImpact: 'Rebuilt automatically on next launch.'
  },
  {
    id: 'vscode-caches',
    group: 'app-data-bloat',
    label: 'VS Code Internal Caches',
    safety: 'safe',
    paths: [
      '~/Library/Application Support/Code/Cache',
      '~/Library/Application Support/Code/Code Cache',
      '~/Library/Application Support/Code/GPUCache'
    ],
    processNames: ['Visual Studio Code', 'Code', 'Electron'],
    appDisplayName: 'Visual Studio Code',
    requiresAppQuit: true,
    whatItIs: 'Internal HTTP/GPU caches of Visual Studio Code.',
    appImpact: 'Settings, extensions and projects are untouched; caches rebuild on next launch.'
  },

  // ── Developer caches ────────────────────────────────────────────────────
  {
    id: 'pip-cache',
    group: 'dev-caches',
    label: 'pip Cache (Python)',
    safety: 'safe',
    paths: ['~/Library/Caches/pip'],
    processNames: [],
    requiresAppQuit: false,
    whatItIs: 'Downloaded Python package wheels kept by pip to speed up reinstalls.',
    appImpact: 'Next `pip install` simply downloads again.'
  },
  {
    id: 'pnpm-cache',
    group: 'dev-caches',
    label: 'pnpm Cache',
    safety: 'safe',
    paths: ['~/Library/Caches/pnpm'],
    processNames: [],
    requiresAppQuit: false,
    whatItIs: 'Package metadata cache of the pnpm package manager.',
    appImpact: 'Rebuilt as you install packages. (Project folders are not touched.)'
  },
  {
    id: 'homebrew-cache',
    group: 'dev-caches',
    label: 'Homebrew Download Cache',
    safety: 'safe',
    paths: ['~/Library/Caches/Homebrew'],
    processNames: [],
    requiresAppQuit: false,
    whatItIs: 'Downloaded bottles/source archives Homebrew kept after installing formulae. Same as running `brew cleanup -s`.',
    appImpact: 'None — installed formulae stay installed.'
  },
  {
    id: 'playwright-browsers',
    group: 'dev-caches',
    label: 'Playwright Browser Binaries',
    safety: 'review',
    paths: ['~/Library/Caches/ms-playwright'],
    processNames: [],
    requiresAppQuit: false,
    whatItIs: 'Chromium/Firefox/WebKit binaries for browser automation testing.',
    appImpact: 'If a project needs Playwright again, one command re-downloads them: `npx playwright install`. Skip this if you do browser automation regularly.'
  },
  {
    id: 'node-gyp-cache',
    group: 'dev-caches',
    label: 'node-gyp Headers Cache',
    safety: 'safe',
    paths: ['~/Library/Caches/node-gyp'],
    processNames: [],
    requiresAppQuit: false,
    whatItIs: 'Node.js headers downloaded for compiling native modules.',
    appImpact: 'Re-downloaded automatically on the next native-module build.'
  },
  {
    id: 'typescript-cache',
    group: 'dev-caches',
    label: 'TypeScript Server Cache',
    safety: 'safe',
    paths: ['~/Library/Caches/typescript'],
    processNames: [],
    requiresAppQuit: false,
    whatItIs: 'Downloads kept by the TypeScript tooling (e.g. tsserver updates).',
    appImpact: 'Editors fetch them again when needed.'
  },
  {
    id: 'ffmpeg-static-cache',
    group: 'dev-caches',
    label: 'ffmpeg-static Cache',
    safety: 'safe',
    paths: ['~/Library/Caches/ffmpeg-static-nodejs'],
    processNames: [],
    requiresAppQuit: false,
    whatItIs: 'ffmpeg binaries downloaded by the ffmpeg-static npm package.',
    appImpact: 'Re-downloaded on the next `npm install` of a project that uses it.'
  },

  // ── Logs ────────────────────────────────────────────────────────────────
  {
    id: 'user-logs',
    group: 'logs',
    label: 'Application Logs',
    safety: 'safe',
    paths: ['~/Library/Logs'],
    processNames: [],
    requiresAppQuit: false,
    whatItIs: 'Diagnostic text logs written by apps. Useful only for debugging; they are rewritten as apps run.',
    appImpact: 'None. Apps create fresh log files as needed.'
  },
  {
    id: 'system-logs',
    group: 'logs',
    label: 'System-wide Logs',
    safety: 'review',
    paths: ['/Library/Logs'],
    processNames: [],
    requiresAppQuit: false,
    whatItIs: 'Logs written by system-level installers and daemons.',
    appImpact: 'None for installed apps; macOS writes fresh entries as needed.'
  },

  // ── Mail attachments ────────────────────────────────────────────────────
  {
    id: 'mail-downloads',
    group: 'mail-attachments',
    label: 'Mail Downloads',
    safety: 'review',
    paths: ['~/Library/Mail Downloads'],
    processNames: ['Mail'],
    appDisplayName: 'Mail',
    requiresAppQuit: true,
    whatItIs: 'Files Mail saved to disk when you opened or re-downloaded attachments. The originals stay on the mail server.',
    appImpact: 'Mail re-downloads an attachment the next time you open it. Anything you saved elsewhere with "Save As" is not touched.'
  }
];

// Informational rows for the Protected view — never deletable, shown locked.
const PROTECTED = [
  { label: 'macOS System', detail: 'The operating system itself. Deleting anything here breaks the Mac.' },
  { label: 'System Databases (/private/var/db)', detail: 'Security and system databases (Gatekeeper, accounts, etc.).' },
  { label: 'Keychains', detail: 'Your saved passwords and certificates.' },
  { label: 'Preferences', detail: 'Every app\u2019s settings live here.' },
  { label: 'Mail Data', detail: 'Your email, until synced back from the server — risky to remove.' },
  { label: 'App Containers', detail: 'Sandboxed app data that may hold irreplaceable documents and state.' },
  { label: 'Swap Files', detail: 'Virtual memory in use right now. Restarting the Mac resets them safely.' },
  { label: 'Temp Folders (/private/var/folders)', detail: 'Managed by macOS itself; it cleans these automatically.' }
];

module.exports = { GROUPS, RULES, PROTECTED };
