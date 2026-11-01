'use strict';

// LcinoCare Menu — the menu bar companion.
// A template heart in the menu bar; clicking it opens a small popover with
// live health metrics and quick actions. The popover is a frameless window
// positioned under the tray icon; it hides on blur. Main-process work
// (snapshot, quick clean, empty trash) is injected by main.js as `ctx`.

const { Tray, Menu, BrowserWindow, nativeImage, screen } = require('electron');
const path = require('path');

let tray = null;
let pop = null;
let lastTrayClick = 0;

function trayIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', 'renderer', 'assets', 'trayTemplate.png'));
  img.setTemplateImage(true); // macOS picks black/white automatically
  return img;
}

function ensurePopover() {
  if (pop) return pop;
  pop = new BrowserWindow({
    width: 324,
    height: 470,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    transparent: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  pop.loadFile(path.join(__dirname, '..', 'renderer', 'menu.html'));
  // hide when the user clicks anywhere else — except right after a tray click
  pop.on('blur', () => {
    if (Date.now() - lastTrayClick < 250) return;
    hidePopover();
  });
  return pop;
}

function positionPopover() {
  if (!tray || !pop) return;
  const tb = tray.getBounds();
  const pb = pop.getBounds();
  const display = screen.getDisplayNearestPoint({ x: tb.x + Math.round(tb.width / 2), y: tb.y });
  const wa = display.workArea;
  let x = Math.round(tb.x + tb.width / 2 - pb.width / 2);
  let y = Math.round(tb.y + tb.height + 5);
  x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - pb.width - 8));
  y = Math.max(wa.y + 8, Math.min(y, wa.y + wa.height - pb.height - 8));
  pop.setPosition(x, y);
}

function showPopover() {
  const p = ensurePopover();
  positionPopover();
  p.show();
  p.focus();
}

function hidePopover() {
  if (pop && pop.isVisible()) pop.hide();
}

function togglePopover() {
  if (pop && pop.isVisible()) { hidePopover(); return; }
  lastTrayClick = Date.now();
  showPopover();
}

function isTrayAlive() {
  return !!tray;
}

function createMenu(ctx) {
  tray = new Tray(trayIcon());
  tray.setToolTip('LcinoCare — Therapy for Your Mac');
  tray.on('click', () => togglePopover());
  tray.on('right-click', () => {
    tray.popUpContextMenu(Menu.buildFromTemplate([
      { label: 'Open LcinoCare', click: () => ctx.showMain() },
      { type: 'separator' },
      { label: 'Quit LcinoCare', click: () => ctx.quit() }
    ]));
  });
}

module.exports = { createMenu, togglePopover, hidePopover, isTrayAlive };
