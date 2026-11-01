'use strict';

/* LcinoCare — module registry for the Smart Shell.
   Every top-level navigation module declares its own theme (measured from the
   reference design), its landing art (original SVG, drawn for LcinoCare), and
   the feature rows that deep-link into the real engines. */

(function () {
  // 24x24 glyph paths reused by nav tiles and landing rows.
  const G = {
    smart: '<path d="M4 5.6A1.6 1.6 0 0 1 5.6 4h12.8A1.6 1.6 0 0 1 20 5.6v9.8a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 15.4z" fill="#fff"/><rect x="9" y="19" width="6" height="1.8" rx=".9" fill="#fff"/><path d="M7.2 8.4l4.4 5.2" stroke="#c66bff" stroke-width="1.7" stroke-linecap="round"/>',
    cleanup: '<circle cx="12" cy="12" r="8.2" fill="#fff"/><circle cx="12" cy="12" r="3.1" fill="#2f9e44"/><rect x="10.7" y="7.6" width="2.6" height="1.9" rx=".9" fill="#2f9e44"/>',
    protection: '<path d="M8.2 11V6.4a1.15 1.15 0 0 1 2.3 0V10m0-4.4V4.8a1.15 1.15 0 0 1 2.3 0V10m0-4.6a1.15 1.15 0 0 1 2.3 0V11m0-4a1.15 1.15 0 0 1 2.3 0v5.4c0 3.6-2.4 6.4-5.8 6.4-2.8 0-4.1-1.4-5.3-3.4L4.6 12.6c-.6-1-.2-2 .8-2.4.8-.3 1.7 0 2.2.8z" fill="#fff"/>',
    performance: '<path d="M13.4 3.4L5.8 13.6h4.6l-.8 7 7.6-10.2h-4.7z" fill="#fff"/>',
    applications: '<path d="M12 3.6l6.4 3.7v7.4L12 18.4l-6.4-3.7V7.3z" fill="#fff"/><path d="M9.7 9.7l4.6 4.6m0-4.6l-4.6 4.6" stroke="#1d4ed8" stroke-width="1.8" stroke-linecap="round"/>',
    clutter: '<path d="M3.8 7a2 2 0 0 1 2-2h3.6l2 2h6.8a2 2 0 0 1 2 2v8.4a2 2 0 0 1-2 2H5.8a2 2 0 0 1-2-2z" fill="#fff"/><rect x="12.6" y="12.6" width="5" height="1.6" rx=".8" fill="#0f766e"/>',
    spacelens: '<circle cx="12" cy="12" r="8.4" fill="#fff"/><circle cx="12" cy="12" r="4.4" fill="#4c1d95"/><circle cx="17.6" cy="17" r="1.5" fill="#fff"/>',
    cloud: '<path d="M7.4 18a3.9 3.9 0 0 1-.6-7.8A5.2 5.2 0 0 1 17 8.6 3.7 3.7 0 0 1 16.6 18z" fill="#fff"/>',
    tools: '<path d="M12 3.4l8.4 4.3L12 12 3.6 7.7z" fill="#fff"/><path d="M4.4 11.4L12 15.3l7.6-3.9M4.4 15.2L12 19.1l7.6-3.9" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    activity: '<path d="M3.5 12h3.4l2-4.6 3.6 9.2 2-4.6h6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    trash: '<path d="M5.5 7h13M10 7V5.2A1.2 1.2 0 0 1 11.2 4h1.6A1.2 1.2 0 0 1 14 5.2V7m3.5 0l-.8 11.2a2 2 0 0 1-2 1.8H9.3a2 2 0 0 1-2-1.8L6.5 7" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
    files: '<path d="M13.6 3.5H8a2.4 2.4 0 0 0-2.4 2.4v12.2A2.4 2.4 0 0 0 8 20.5h8a2.4 2.4 0 0 0 2.4-2.4V8.3z" fill="none" stroke="#fff" stroke-width="1.9" stroke-linejoin="round"/><path d="M13.6 3.5v4.8h4.8" fill="none" stroke="#fff" stroke-width="1.9" stroke-linejoin="round"/>',
    duplicates: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.6" fill="none" stroke="#fff" stroke-width="1.9"/><path d="M15.5 4.5h-8a3 3 0 0 0-3 3v8" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/>',
    mail: '<path d="M4 6.8A1.8 1.8 0 0 1 5.8 5h12.4A1.8 1.8 0 0 1 20 6.8v10.4a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 17.2z" fill="#fff"/><path d="M4.6 7.4L12 13l7.4-5.6" fill="none" stroke="#7c3aed" stroke-width="1.7" stroke-linejoin="round"/>',
    shield: '<path d="M12 3.4l7 2.6v5.2c0 4.6-2.9 7.7-7 9.4-4.1-1.7-7-4.8-7-9.4V6z" fill="#fff"/><path d="M9 11.6l2.2 2.2 4-4.4" stroke="#be185d" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    speed: '<circle cx="12" cy="12" r="8.4" fill="none" stroke="#fff" stroke-width="1.9"/><path d="M12 12l3.4-3.8" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="1.5" fill="#fff"/>',
    tm: '<circle cx="12" cy="12" r="8.4" fill="none" stroke="#fff" stroke-width="1.9"/><path d="M12 7.4V12l3.2 2.6" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>'
  };

  // Large glossy landing illustration. Original artwork, parametric per module.
  function art(from, to, deep, shape, glyph, glyphScale = 1) {
    const uid = `ml${Math.random().toString(36).slice(2, 8)}`;
    const cx = 150, cy = 150;
    return `
    <svg viewBox="0 0 300 300" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="${uid}a" x1="40" y1="26" x2="268" y2="282" gradientUnits="userSpaceOnUse">
          <stop stop-color="${from}"/><stop offset=".62" stop-color="${to}"/><stop offset="1" stop-color="${deep}"/>
        </linearGradient>
        <linearGradient id="${uid}g" x1="60" y1="30" x2="150" y2="120" gradientUnits="userSpaceOnUse">
          <stop stop-color="#fff" stop-opacity=".65"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <ellipse cx="150" cy="278" rx="104" ry="13" fill="#000" opacity=".22"/>
      <g transform="rotate(-6 ${cx} ${cy})">${shape(uid + 'a', cx, cy)}</g>
      <g transform="rotate(-6 ${cx} ${cy})" opacity=".8"><path d="M62 66 C 100 40 200 38 240 64 C 196 52 106 54 62 66 Z" fill="#fff" opacity=".5"/></g>
      <ellipse cx="106" cy="72" rx="52" ry="20" fill="url(#${uid}g)" transform="rotate(-14 106 72)"/>
      <g transform="translate(${cx - 36 * glyphScale} ${cy - 36 * glyphScale}) scale(${72 * glyphScale / 24})">${glyph}</g>
    </svg>`;
  }

  const squircle = (fill) => (id) => `<rect x="42" y="42" width="216" height="216" rx="62" fill="url(#${id})"/>`;
  const disc = (fill) => (id) => `<circle cx="150" cy="150" r="106" fill="url(#${id})"/>`;
  const shield = (fill) => (id) => `<path d="M150 34l98 36v72c0 62-40 104-98 126-58-22-98-64-98-126V70z" fill="url(#${id})"/>`;
  const hexagon = (fill) => (id) => `<path d="M150 36l94 54v108l-94 54-94-54V90z" fill="url(#${id})"/>`;
  const wave = (fill) => (id) => `<path d="M96 48c34-16 74-16 108 0 16 8 30 20 38 36 14 30 14 70-2 100-26 50-96 66-146 40-44-24-58-84-34-128 8-18 20-38 36-48z" fill="url(#${id})"/>`;
  const lens = (fill) => (id) => `<circle cx="150" cy="150" r="104" fill="url(#${id})"/><circle cx="150" cy="150" r="56" fill="#0f0a2e" opacity=".55"/><circle cx="150" cy="150" r="56" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="3"/><circle cx="212" cy="206" r="13" fill="#fff" opacity=".9"/>`;

  const glyphSvg = (key, stroke = null) => `<svg width="72" height="72" viewBox="0 0 24 24" aria-hidden="true">${G[key]}</svg>`;

  const MODULES = [
    {
      id: 'smart',
      title: 'Smart Care',
      tagline: 'Quick maintenance that takes care of the essentials.',
      scan: true,
      scanTo: null, // stays on smart — results replace the landing
      theme: { from: '#380069', to: '#6d0097', deep: '#2a0146', pill: 'rgba(232,2,158,.28)', scan: '#a416e8', scanTo: '#7a06b8', tile: ['#e14ff2', '#8b0bd8'] },
      art: () => art('#ff4fd8', '#c422cf', '#6d1097', squircle(),
        '<rect x="4" y="5.4" width="16" height="10.4" rx="1.8" fill="#fff"/><rect x="9" y="17.6" width="6" height="1.6" rx=".8" fill="#fff" opacity=".85"/><path d="M7.4 8l4 5" stroke="#e879f9" stroke-width="1.6" stroke-linecap="round"/>'),
      rows: [
        { icon: 'smart', label: 'Quick Scan', sub: null, action: 'scan' },
        { icon: 'performance', label: 'System Tune-up', view: 'performance' },
        { icon: 'protection', label: 'Security Check', view: 'protection' }
      ]
    },
    {
      id: 'cleanup',
      nav: 'Cleanup',
      title: 'Junk Cleanup',
      tagline: 'Clean your system to achieve maximum performance and reclaim more free space.',
      scan: true,
      scanTo: 'cleanup-manager',
      theme: { from: '#2ea023', to: '#1d6b17', deep: '#124209', pill: 'rgba(80,220,90,.30)', scan: '#2fae4a', scanTo: '#1b7a2e', tile: ['#5ee07a', '#1e9e46'] },
      art: () => art('#4ade60', '#1d9e3f', '#0c5c22', disc(),
        '<circle cx="12" cy="12" r="8.4" fill="#fff"/><circle cx="12" cy="12" r="3.4" fill="#22a04c"/><rect x="10.6" y="7.2" width="2.8" height="2" rx="1" fill="#22a04c"/>'),
      rows: [
        { icon: 'trash', label: 'System Junk', view: 'cleanup-manager' },
        { icon: 'mail', label: 'Mail Attachments', view: 'cleanup-manager', pane: 'mail' },
        { icon: 'trash', label: 'Trash Bins', view: 'cleanup-manager', pane: 'trash' }
      ]
    },
    {
      id: 'protection',
      title: 'Protection',
      tagline: 'Your Mac stays safe by design — a hard blocklist guards every sensitive zone.',
      scan: false,
      theme: { from: '#9c0b76', to: '#5c0238', deep: '#3d011f', pill: 'rgba(255,80,180,.30)', scan: '#d4148c', scanTo: '#8e0658', tile: ['#ff5fb0', '#a80b6b'] },
      art: () => art('#ff4fae', '#b00b6e', '#5c0238', hexagon(),
        '<path d="M8.2 11V6.4a1.15 1.15 0 0 1 2.3 0V10m0-4.4V4.8a1.15 1.15 0 0 1 2.3 0V10m0-4.6a1.15 1.15 0 0 1 2.3 0V11m0-4a1.15 1.15 0 0 1 2.3 0v5.4c0 3.6-2.4 6.4-5.8 6.4-2.8 0-4.1-1.4-5.3-3.4L4.6 12.6c-.6-1-.2-2 .8-2.4.8-.3 1.7 0 2.2.8z" fill="#fff"/>'),
      rows: [
        { icon: 'shield', label: 'Safety Blocklist', sub: 'System zones that can never be touched', view: 'protected' },
        { icon: 'trash', label: 'Trash-Only Deletion', sub: 'Nothing is erased without a second confirm', view: 'protected' },
        { icon: 'smart', label: 'App Quit Checks', sub: 'Apps quit gracefully before any cleanup', view: 'protected' }
      ]
    },
    {
      id: 'performance',
      title: 'Performance',
      tagline: 'Keep your Mac in top shape with recommended maintenance.',
      scan: true,
      scanTo: 'perf-manager',
      theme: { from: '#c2410c', to: '#7c2d12', deep: '#4a1505', pill: 'rgba(255,150,60,.30)', scan: '#ea7a1c', scanTo: '#a8480c', tile: ['#ff9f5a', '#e0442a'] },
      art: () => art('#ffab4f', '#d1490f', '#6b1e05', shield(),
        '<path d="M13.4 3.4L5.8 13.6h4.6l-.8 7 7.6-10.2h-4.7z" fill="#fff"/>'),
      rows: [
        { icon: 'speed', label: 'Speed & Memory', sub: 'Live CPU and memory usage, honest numbers', view: 'speed' },
        { icon: 'smart', label: 'Maintenance Tasks', sub: 'Real macOS housekeeping: DNS, RAM, Spotlight, Mail', view: 'perf-manager', pane: 'maintenance' },
        { icon: 'smart', label: 'Login Items', sub: 'Apps that open when you sign in', view: 'perf-manager', pane: 'login' },
        { icon: 'tools', label: 'Background Items', sub: 'Launch agents and daemons', view: 'perf-manager', pane: 'background' }
      ]
    },
    {
      id: 'applications',
      title: 'Applications',
      tagline: 'Take control of your applications. Uninstall cleanly or remove old leftovers.',
      scan: true,
      scanTo: 'apps',
      theme: { from: '#1d3fb8', to: '#250a7d', deep: '#150650', pill: 'rgba(90,130,255,.30)', scan: '#2a5cd8', scanTo: '#1a3a9c', tile: ['#6f97ff', '#2440c8'] },
      art: () => art('#5b8bff', '#2440c8', '#120a52', hexagon(),
        '<path d="M12 3.6l6.4 3.7v7.4L12 18.4l-6.4-3.7V7.3z" fill="#fff"/><path d="M9.7 9.7l4.6 4.6m0-4.6l-4.6 4.6" stroke="#1d4ed8" stroke-width="1.8" stroke-linecap="round"/>'),
      rows: [
        { icon: 'applications', label: 'App Uninstaller', sub: 'Remove apps with all of their leftovers', view: 'apps' },
        { icon: 'files', label: 'File Leftovers', sub: 'Cast-off files from apps already deleted', view: 'apps' }
      ]
    },
    {
      id: 'clutter',
      title: 'My Clutter',
      tagline: 'Sort through your files and reduce the mess in just a few clicks.',
      scan: true,
      scanTo: 'files',
      theme: { from: '#177f6f', to: '#0d4a52', deep: '#062e34', pill: 'rgba(50,220,190,.28)', scan: '#1fae94', scanTo: '#0e7a68', tile: ['#3fe0d0', '#0b7f8f'] },
      art: () => art('#3fe0d0', '#128f86', '#083f46', wave(),
        '<path d="M3.8 7a2 2 0 0 1 2-2h3.6l2 2h6.8a2 2 0 0 1 2 2v8.4a2 2 0 0 1-2 2H5.8a2 2 0 0 1-2-2z" fill="#fff"/><rect x="12.6" y="12.6" width="5" height="1.6" rx=".8" fill="#0f766e"/>'),
      rows: [
        { icon: 'files', label: 'Large Files', sub: 'Every file over 10 MB, biggest first', view: 'files' },
        { icon: 'duplicates', label: 'Duplicates', sub: 'Identical copies you can safely drop', view: 'duplicates' }
      ]
    },
    {
      id: 'spacelens',
      title: 'Space Lens',
      tagline: "Visualize what's taking up the most disk space and clean up your storage quickly.",
      scan: true,
      scanTo: 'clutter',
      theme: { from: '#4c1d95', to: '#2a0a80', deep: '#170545', pill: 'rgba(150,90,255,.32)', scan: '#7c3aed', scanTo: '#4c1d95', tile: ['#a855f7', '#6d28d9'] },
      art: () => art('#a855f7', '#5b21b6', '#26065e', lens(),
        '<circle cx="12" cy="12" r="6" fill="none" stroke="#fff" stroke-width="2.6"/><circle cx="18.4" cy="17.6" r="1.6" fill="#fff"/>'),
      rows: [
        { icon: 'clutter', label: 'Visual Storage Map', sub: 'Your home folder as living bubbles', view: 'bubble' },
        { icon: 'files', label: 'Large Folders Overview', sub: 'Where the gigabytes hide', view: 'files' }
      ]
    },
    {
      id: 'cloud',
      title: 'Cloud Cleanup',
      tagline: 'Tidy up your cloud files to save space and keep your storage in check.',
      scan: false,
      theme: { from: '#2265a4', to: '#123a6e', deep: '#0a2246', pill: 'rgba(90,170,240,.30)', scan: '#2f7cc4', scanTo: '#1a4c87', tile: ['#4f9ef0', '#17549c'] },
      art: () => art('#4f9ef0', '#1d5fa8', '#0c2f58', wave(),
        '<path d="M7.4 18a3.9 3.9 0 0 1-.6-7.8A5.2 5.2 0 0 1 17 8.6 3.7 3.7 0 0 1 16.6 18z" fill="#fff"/>'),
      rows: [
        { icon: 'cloud', label: 'Connect iCloud', action: 'cloud-later' },
        { icon: 'cloud', label: 'Connect Google Drive', action: 'cloud-later' },
        { icon: 'cloud', label: 'Connect OneDrive', action: 'cloud-later' },
        { icon: 'cloud', label: 'Connect Dropbox', action: 'cloud-later' }
      ],
      footnote: 'Cloud connectors arrive in a later update — nothing is connected yet, and LcinoCare will say so clearly when you click.'
    },
    {
      id: 'tools',
      title: 'My Tools',
      tagline: 'Quick tools for focused tasks — clean up, protect, and maintain your Mac in a few clicks.',
      scan: false,
      theme: { from: '#3a1a6e', to: '#21093f', deep: '#140528', pill: 'rgba(180,110,255,.30)', scan: '#8b5cf6', scanTo: '#5b21b6', tile: ['#a855f7', '#6d28d9'] }
    },
    {
      id: 'activity',
      title: 'My Activity',
      tagline: 'Your Mac health and everything LcinoCare has done for you, in one place.',
      scan: false,
      theme: { from: '#232358', to: '#141430', deep: '#0b0b1e', pill: 'rgba(110,110,255,.30)', scan: '#4c4ce0', scanTo: '#2c2c9c', tile: ['#7d9bff', '#3b3bd9'] }
    }
  ];

  // My Tools grid — only tools backed by a real engine today.
  const TOOLS = [
    { icon: 'trash', label: 'System Junk', desc: 'Caches, logs and leftovers that clog up storage.', view: 'cleanup-manager', color: ['#5ee07a', '#1e9e46'] },
    { icon: 'applications', label: 'Uninstaller', desc: 'Correctly remove apps with all related files.', view: 'apps', color: ['#6f97ff', '#2440c8'] },
    { icon: 'duplicates', label: 'Duplicate Finder', desc: 'Remove duplicate files stored in different locations.', view: 'duplicates', color: ['#4fd8ea', '#128fa8'] },
    { icon: 'files', label: 'Large and Old Files', desc: 'Find and remove large, unused files that take up space.', view: 'files', color: ['#3fe0d0', '#0b7f8f'] },
    { icon: 'smart', label: 'Login Items', desc: 'Manage apps that open automatically when you start your Mac.', view: 'perf-manager', pane: 'login', color: ['#ff9f5a', '#e0442a'] },
    { icon: 'tools', label: 'Background Items', desc: 'Manage background apps and processes running on your Mac.', view: 'perf-manager', pane: 'background', color: ['#a855f7', '#6d28d9'] },
    { icon: 'mail', label: 'Mail Attachments', desc: 'Remove locally stored email attachments to free space.', view: 'cleanup-manager', pane: 'mail', color: ['#c46aff', '#7c3aed'] },
    { icon: 'trash', label: 'Trash Bins', desc: 'Empty all of the available Trash Bins on your Mac.', view: 'cleanup-manager', pane: 'trash', color: ['#a5c9ff', '#3e6fd9'] },
    { icon: 'tm', label: 'Time Machine Snapshots', desc: 'Review and purge local Time Machine snapshots.', action: 'snapshots', color: ['#ffd35a', '#e0821a'] },
    { icon: 'speed', label: 'Maintenance Tasks', desc: 'Flush DNS, free RAM, run macOS scripts, reindex Spotlight and more.', view: 'perf-manager', pane: 'maintenance', color: ['#ff6b35', '#c2410c'] },
    { icon: 'files', label: 'Downloads', desc: 'Review and clean one-time files piling up in Downloads.', view: 'downloads-tool', color: ['#0a84ff', '#0a4fa8'] }
  ];

  function glyph(key, size = 18, color = '#fff') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" style="color:${color}">${(G[key] || G.smart).replace(/#fff/g, color).replace(/stroke="#[0-9a-f]+"/g, `stroke="${color}"`).replace(/fill="#[0-9a-f]+"/g, `fill="${color}"`)}</svg>`;
  }

  function navTile(mod, size = 28) {
    const [from, to] = mod.theme.tile;
    return `
      <span class="ico-tile" style="width:${size}px;height:${size}px;background:linear-gradient(145deg,${from},${to});box-shadow:inset 0 1px 1px rgba(255,255,255,.4), inset 0 -2px 4px rgba(0,0,0,.18), 0 3px 8px ${to}55;">
        <svg width="${Math.round(size * 0.58)}" height="${Math.round(size * 0.58)}" viewBox="0 0 24 24" aria-hidden="true">${G[mod.id] || G.smart}</svg>
      </span>`;
  }

  window.LcinoModules = { MODULES, TOOLS, glyph, navTile, byId: (id) => MODULES.find((m) => m.id === id) };
})();
