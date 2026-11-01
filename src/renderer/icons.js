'use strict';

(() => {

/* LcinoCare — gradient "3D" icon tiles.
   Each icon is a squircle tile with a colored gradient, a white glyph, and a
   glass gloss highlight applied by CSS (.ico-tile::after). No external assets. */

let icoSeq = 0;

const GLYPHS = {
  smart: '<path d="M12 3.2l1.7 4.6 4.6 1.7-4.6 1.7L12 15.8l-1.7-4.6-4.6-1.7 4.6-1.7zM18.6 14.2l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9zM5.4 15.4l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" fill="#fff"/>',
  dashboard: '<path d="M12 20.4C7.4 16.5 4 13.6 4 10.1 4 7.6 5.9 5.6 8.3 5.6c1.4 0 2.7.7 3.7 1.9 1-1.2 2.3-1.9 3.7-1.9 2.4 0 4.3 2 4.3 4.5 0 3.5-3.4 6.4-8 10.3z" fill="none" stroke="#fff" stroke-width="1.9" stroke-linejoin="round"/><path d="M6.5 11.5h2.4l1.3-2.6 2.2 4.8 1.7-3.4.8 1.2h2.6" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  clean: '<path d="M13.5 3.5l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1zM6.9 9.3l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8zM17.2 13.4l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7z" fill="#fff"/><path d="M5 20.5c2.2-4.5 5-7.5 8.5-9" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/>',
  duplicates: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.6" fill="none" stroke="#fff" stroke-width="1.9"/><path d="M15.5 4.5h-8a3 3 0 0 0-3 3v8" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/>',
  files: '<path d="M13.6 3.5H8a2.4 2.4 0 0 0-2.4 2.4v12.2A2.4 2.4 0 0 0 8 20.5h8a2.4 2.4 0 0 0 2.4-2.4V8.3z" fill="none" stroke="#fff" stroke-width="1.9" stroke-linejoin="round"/><path d="M13.6 3.5v4.8h4.8" fill="none" stroke="#fff" stroke-width="1.9" stroke-linejoin="round"/><path d="M12 11v5M9.7 13.7L12 16l2.3-2.3" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  clutter: '<circle cx="9" cy="14.5" r="5.2" fill="none" stroke="#fff" stroke-width="1.9"/><circle cx="16.8" cy="8" r="3.4" fill="none" stroke="#fff" stroke-width="1.9"/><circle cx="17.5" cy="16.8" r="2.2" fill="#fff"/>',
  apps: '<rect x="4" y="4" width="7" height="7" rx="2" fill="none" stroke="#fff" stroke-width="1.9"/><rect x="13" y="4" width="7" height="7" rx="2" fill="none" stroke="#fff" stroke-width="1.9"/><rect x="4" y="13" width="7" height="7" rx="2" fill="none" stroke="#fff" stroke-width="1.9"/><rect x="13" y="13" width="7" height="7" rx="2" fill="none" stroke="#fff" stroke-width="1.9"/>',
  speed: '<path d="M13.2 3.2L5.8 13.4h4.6l-.8 7.4 7.6-10.4h-4.7z" fill="#fff"/>',
  startup: '<path d="M12 3.5c3.2 2 4.8 5.1 4.8 8.9 0 2.5-.6 4.6-1.7 6.4l-2.4-1.5h-1.4l-2.4 1.5c-1.1-1.8-1.7-3.9-1.7-6.4 0-3.8 1.6-6.9 4.8-8.9z" fill="none" stroke="#fff" stroke-width="1.9" stroke-linejoin="round"/><circle cx="12" cy="10.5" r="2" fill="#fff"/><path d="M9.6 19.5c.8 1 1.6 1.6 2.4 2 .8-.4 1.6-1 2.4-2" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/>',
  protected: '<path d="M12 3.4l7 2.6v5.2c0 4.6-2.9 7.7-7 9.4-4.1-1.7-7-4.8-7-9.4V6z" fill="none" stroke="#fff" stroke-width="1.9" stroke-linejoin="round"/><rect x="9.4" y="11" width="5.2" height="4.4" rx="1.1" fill="#fff"/><path d="M10.4 11V9.8a1.6 1.6 0 0 1 3.2 0V11" fill="none" stroke="#fff" stroke-width="1.6"/>',
  history: '<circle cx="12" cy="12" r="8.4" fill="none" stroke="#fff" stroke-width="1.9"/><path d="M12 7.4V12l3.2 2.6" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  trash: '<path d="M5.5 7h13M10 7V5.2A1.2 1.2 0 0 1 11.2 4h1.6A1.2 1.2 0 0 1 14 5.2V7m3.5 0l-.8 11.2a2 2 0 0 1-2 1.8H9.3a2 2 0 0 1-2-1.8L6.5 7" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  folder: '<path d="M3.5 6.6a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" fill="none" stroke="#fff" stroke-width="1.9" stroke-linejoin="round"/>'
};

const TILES = {
  smart: { from: '#e14ff2', to: '#8b0bd8' },
  dashboard: { from: '#2fd4b5', to: '#0a8f8f' },
  clean: { from: '#5ee07a', to: '#1e9e46' },
  duplicates: { from: '#4fd8ea', to: '#128fa8' },
  files: { from: '#a78bfa', to: '#6d28d9' },
  clutter: { from: '#c084fc', to: '#8b2fd6' },
  apps: { from: '#7d9bff', to: '#3b56d9' },
  speed: { from: '#ff9f5a', to: '#e0442a' },
  startup: { from: '#ffd35a', to: '#e0821a' },
  protected: { from: '#ff6cb5', to: '#d6177f' },
  history: { from: '#b5b5bc', to: '#6f6f76' },
  trash: { from: '#a5c9ff', to: '#3e6fd9' }
};

// Render a gradient squircle tile with a glyph. size in px.
function icon(name, size = 22) {
  const tile = TILES[name] || TILES.dashboard;
  const glyph = GLYPHS[name] || GLYPHS.dashboard;
  const uid = `icg${icoSeq++}`;
  const pad = size * 0.16;
  const inner = size - pad * 2;
  return `
    <span class="ico-tile" style="width:${size}px;height:${size}px;background:linear-gradient(145deg,${tile.from},${tile.to});box-shadow:inset 0 1px 1px rgba(255,255,255,.4), inset 0 -2px 4px rgba(0,0,0,.18), 0 3px 8px ${hexA(tile.to, 0.45)};">
      <svg width="${inner}" height="${inner}" viewBox="0 0 24 24" aria-hidden="true">${glyph}</svg>
    </span>`;
}

// plain glyph only (no tile) for inline use
function glyph(name, size = 16, color = '#fff') {
  const g = GLYPHS[name] || GLYPHS.dashboard;
  const uid = `gl${icoSeq++}`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" style="color:${color}">${g.replace(/#fff/g, color)}</svg>`;
}

function hexA(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// Brand logo mark — MacBook frame with therapy pulse, magenta gradient.
// Matches the landing page (care.lcino.com) branding 1:1.
function brandLogo(size = 30) {
  const uid = `brand${icoSeq++}`;
  return `
  <svg class="brand-mark" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
    <defs>
      <linearGradient id="${uid}" x1="4.2" y1="3.2" x2="19.8" y2="14.4" gradientUnits="userSpaceOnUse">
        <stop stop-color="#f22fc0"/><stop offset="1" stop-color="#8d0670"/>
      </linearGradient>
    </defs>
    <rect x="4.2" y="3.2" width="15.6" height="11.2" rx="1.8" fill="url(#${uid})"/>
    <path d="M6.8 9.6h2.2l1.1-2 1.8 4.2 1.3-2.7.9 1.2h2.3" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <ellipse cx="8.6" cy="5.5" rx="4" ry="1.3" fill="rgba(255,255,255,.35)" transform="rotate(-10 8.6 5.5)"/>
    <path d="M3.4 15.2h17.2l.9 1.5a1.5 1.5 0 0 1-1.4 2.1H3.9a1.5 1.5 0 0 1-1.4-2.1z" fill="#8d0670"/>
    <rect x="10" y="15.9" width="4" height=".85" rx=".42" fill="#5c0146"/>
  </svg>`;
}

window.LcinoIcons = { icon, glyph, brandLogo };
})();
