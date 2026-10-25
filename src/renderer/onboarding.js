'use strict';

/* LcinoCare — first-run onboarding.
   Three steps: privacy agreement, notifications, and a ready-to-scan finish.
   Self-contained: builds its own DOM, stores its "done" flag in localStorage,
   and hands control back to app.js via the onDone callback. */

(function () {
  const FLAG = 'lcino.onboarding.v1';

  const CHECK_SVG = '<svg width="11" height="9" viewBox="0 0 11 9" fill="none"><path d="M1.5 4.5L4.2 7.2L9.5 1.5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // ── original artwork (LcinoCare's own illustrations, candy-glass style) ──

  const ART_PRIVACY = `
  <svg viewBox="0 0 340 400" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="obDoc" x1="80" y1="30" x2="290" y2="360" gradientUnits="userSpaceOnUse">
        <stop stop-color="#FF63DF"/><stop offset=".55" stop-color="#D622C9"/><stop offset="1" stop-color="#9C1BC9"/>
      </linearGradient>
      <linearGradient id="obFold" x1="220" y1="30" x2="286" y2="110" gradientUnits="userSpaceOnUse">
        <stop stop-color="#FFC2F1"/><stop offset="1" stop-color="#F06AE2"/>
      </linearGradient>
      <linearGradient id="obCircle" x1="120" y1="200" x2="235" y2="330" gradientUnits="userSpaceOnUse">
        <stop stop-color="#8A5CFF"/><stop offset="1" stop-color="#4C00E0"/>
      </linearGradient>
      <radialGradient id="obGloss" cx=".35" cy=".22" r="1">
        <stop stop-color="#fff" stop-opacity=".5"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <ellipse class="ob-shadow" cx="172" cy="382" rx="118" ry="14" fill="#000" opacity=".28"/>
    <rect x="72" y="26" width="212" height="330" rx="38" fill="url(#obDoc)"/>
    <path d="M214 26 h32 a40 40 0 0 1 40 40 v26 c-44 -6 -68 -30 -72 -66 z" fill="url(#obFold)"/>
    <rect x="72" y="26" width="212" height="330" rx="38" fill="url(#obGloss)"/>
    <rect x="106" y="88" width="132" height="21" rx="10.5" fill="#fff" opacity=".92"/>
    <rect x="106" y="124" width="100" height="21" rx="10.5" fill="#fff" opacity=".62"/>
    <circle cx="178" cy="258" r="62" fill="url(#obCircle)"/>
    <path d="M150 258 l20 20 l38 -40" stroke="#fff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M84 116 C 88 134 92 138 110 142 C 92 146 88 150 84 168 C 80 150 76 146 58 142 C 76 138 80 134 84 116 Z" fill="#C9B4FF" opacity=".95"/>
    <path d="M97 194 C 100 205 103 208 114 211 C 103 214 100 217 97 228 C 94 217 91 214 80 211 C 91 208 94 205 97 194 Z" fill="#E4D6FF" opacity=".9"/>
    <path d="M264 96 C 267 107 270 110 281 113 C 270 116 267 119 264 130 C 261 119 258 116 247 113 C 258 110 261 107 264 96 Z" fill="#E4D6FF" opacity=".75"/>
  </svg>`;

  const ART_BELL = `
  <svg viewBox="0 0 340 400" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="obBell" x1="90" y1="60" x2="260" y2="340" gradientUnits="userSpaceOnUse">
        <stop stop-color="#FF63DF"/><stop offset=".55" stop-color="#D622C9"/><stop offset="1" stop-color="#9C1BC9"/>
      </linearGradient>
      <radialGradient id="obGloss2" cx=".35" cy=".2" r="1">
        <stop stop-color="#fff" stop-opacity=".5"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <ellipse class="ob-shadow" cx="172" cy="382" rx="112" ry="14" fill="#000" opacity=".28"/>
    <path d="M170 52 c58 0 96 44 96 104 v62 c0 26 10 40 24 52 c6 5 3 16 -6 16 H56 c-9 0 -12 -11 -6 -16 c14 -12 24 -26 24 -52 v-62 c0 -60 38 -104 96 -104z" fill="url(#obBell)"/>
    <path d="M170 52 c58 0 96 44 96 104 v62 c0 26 10 40 24 52 c6 5 3 16 -6 16 H56 c-9 0 -12 -11 -6 -16 c14 -12 24 -26 24 -52 v-62 c0 -60 38 -104 96 -104z" fill="url(#obGloss2)"/>
    <path d="M140 296 a30 26 0 0 0 60 0z" fill="#FFB3EF"/>
    <circle cx="248" cy="70" r="26" fill="#4C00E0"/>
    <circle cx="248" cy="70" r="26" fill="url(#obGloss2)"/>
    <text x="248" y="79" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="26" font-weight="800" fill="#fff">1</text>
    <path d="M76 140 c6 15 6 15 0 30 c12 -6 21 -6 30 0 c-6 -15 -6 -15 0 -30 c-12 6 -21 6 -30 0z" fill="#C9B4FF" opacity=".9"/>
    <path d="M256 210 c5 11 5 11 0 22 c8 -4 15 -4 22 0 c-5 -11 -5 -11 0 -22 c-8 4 -15 4 -22 0z" fill="#E4D6FF" opacity=".8"/>
  </svg>`;

  const ART_DONE = `
  <svg viewBox="0 0 340 400" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="obBadge" x1="60" y1="70" x2="290" y2="340" gradientUnits="userSpaceOnUse">
        <stop stop-color="#FF63DF"/><stop offset=".55" stop-color="#C422CF"/><stop offset="1" stop-color="#7E1BD6"/>
      </linearGradient>
      <linearGradient id="obBadgeRing" x1="90" y1="60" x2="260" y2="120" gradientUnits="userSpaceOnUse">
        <stop stop-color="#FFB3EF"/><stop offset="1" stop-color="#E36AE0"/>
      </linearGradient>
      <radialGradient id="obGloss3" cx=".35" cy=".2" r="1">
        <stop stop-color="#fff" stop-opacity=".5"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <ellipse class="ob-shadow" cx="172" cy="382" rx="118" ry="14" fill="#000" opacity=".28"/>
    <circle cx="172" cy="204" r="128" fill="url(#obBadgeRing)" opacity=".55"/>
    <circle cx="172" cy="204" r="108" fill="url(#obBadge)"/>
    <circle cx="172" cy="204" r="108" fill="url(#obGloss3)"/>
    <path d="M124 206 l34 34 l66 -70" stroke="#fff" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M62 106 C 67 124 71 128 89 133 C 71 138 67 142 62 160 C 57 142 53 138 35 133 C 53 128 57 124 62 106 Z" fill="#C9B4FF" opacity=".95"/>
    <path d="M282 132 C 286 146 289 149 303 153 C 289 157 286 160 282 174 C 278 160 275 157 261 153 C 275 149 278 146 282 132 Z" fill="#E4D6FF" opacity=".85"/>
    <path d="M296 236 C 299 246 301 248 311 251 C 301 254 299 256 296 266 C 293 256 291 254 281 251 C 291 248 293 246 296 236 Z" fill="#E4D6FF" opacity=".6"/>
  </svg>`;

  const GLYPH_CLEAN ='<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M11.5 2.5l4 4-7.2 7.2a2.4 2.4 0 0 1-1.4.7l-3.6.5.5-3.6a2.4 2.4 0 0 1 .7-1.4L11.5 2.5z" fill="#fff"/><path d="M14.8 12.6c1 1.6 1 1.6 0 3.2 1.6-.8 2.8-.8 4.4 0-1-1.6-1-1.6 0-3.2-1.6.8-2.8.8-4.4 0z" fill="#fff" opacity=".85"/></svg>';
  const GLYPH_HEART = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 15.5C5 12.6 2 10 2 6.8 2 4.6 3.7 3 5.8 3 7 3 8.2 3.6 9 4.7 9.8 3.6 11 3 12.2 3 14.3 3 16 4.6 16 6.8c0 3.2-3 5.8-7 8.7z" fill="#fff"/></svg>';
  const GLYPH_BOLT = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M10.5 1.5L3.5 10h4l-1 6.5L13.5 8h-4l1-6.5z" fill="#fff"/></svg>';

  // ── copy (LcinoCare's own) ──────────────────────────────────────────────

  const STEPS = [
    {
      id: 'privacy',
      art: ART_PRIVACY,
      heading: "Let's Talk Privacy",
      body: () => `
        LcinoCare runs entirely on your Mac. Your files, your passwords, and your
        browsing never leave this machine — there is no account, no cloud, and
        nothing watching. Review the two notes below and let's get your Mac
        feeling new again.`,
      checks: [
        {
          html: `I agree to the <a data-doc="terms">Terms of Use</a> and acknowledge the <a data-doc="privacy">Privacy Notice</a>.`,
          gate: true
        },
        { html: 'Launch LcinoCare automatically when I log in', pref: 'login' }
      ],
      cta: null
    },
    {
      id: 'notify',
      art: ART_BELL,
      heading: 'Stay in the Loop',
      body: () => `
        LcinoCare can give you a gentle nudge when a scan finds something worth
        cleaning, or when your Health Score takes a dip. Alerts appear on your
        Mac only — nothing is sent anywhere.`,
      checks: [],
      cta: { id: 'ob-enable', label: 'Enable Notifications', action: 'notifications' }
    },
    {
      id: 'done',
      art: ART_DONE,
      heading: "You're All Set",
      body: () => `
        Here's what LcinoCare will take care of, starting right now:`,
      features: [
        { tile: 'magenta', glyph: GLYPH_CLEAN, t: 'Smart Clean', s: 'Finds the junk hiding in caches, logs, and app leftovers.' },
        { tile: '', glyph: GLYPH_HEART, t: 'Health Score', s: 'A live 0–100 read on CPU, memory, disk, and battery.' },
        { tile: 'violet', glyph: GLYPH_BOLT, t: 'One-Click Care', s: 'Review the scan, tick the safe items, and free space in seconds.' }
      ]
    }
  ];

  const DOCS = {
    terms: {
      title: 'Terms of Use',
      html: `
        <p>LcinoCare is provided as-is, under the MIT open-source license, for
        cleaning and maintaining your own Mac.</p>
        <p>The app only moves items you approve to the Trash — nothing is deleted
        permanently without a second, explicit confirmation from you. You stay in
        charge of every action.</p>`
    },
    privacy: {
      title: 'Privacy Notice',
      html: `
        <p>LcinoCare collects nothing. No analytics, no crash reports, no usage
        statistics — there is no server to send them to.</p>
        <p>Scan results, history, and preferences never leave your user folder on
        this Mac.</p>`
    }
  };

  // ── state & DOM ─────────────────────────────────────────────────────────

  let stepIndex = 0;
  let onDone = null;
  let prefs = { login: false };

  const rootEl = () => document.getElementById('onboarding');

  function applyForceTheme() {
    const t = new URLSearchParams(location.search).get('theme');
    if (t === 'dark' || t === 'light') {
      document.documentElement.dataset.forceTheme = t;
    }
  }

  function isDark() {
    const forced = document.documentElement.dataset.forceTheme;
    if (forced) return forced === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function shouldShow() {
    applyForceTheme();
    const q = new URLSearchParams(location.search);
    if (q.has('onboarding')) return true; // QA escape hatch
    try { return localStorage.getItem(FLAG) !== 'done'; } catch { return true; }
  }

  function renderStep() {
    const root = rootEl();
    const step = STEPS[stepIndex];
    const dark = isDark();
    root.classList.toggle('ob-dark', dark);

    const stage = root.querySelector('.ob-stage');
    stage.innerHTML = `
      <div class="ob-art">${step.art || ''}</div>
      <div class="ob-content">
        <div class="ob-step">
          <div class="ob-heading">${step.heading}</div>
          <div class="ob-text">${step.body()}</div>
          ${step.features ? featuresHtml(step.features) : ''}
          ${(step.checks || []).map((c, i) => checkHtml(c, i)).join('')}
          ${step.cta ? ctaHtml(step.cta) : ''}
        </div>
      </div>`;

    wireStep(step);

    const nextBtn = root.querySelector('.ob-next');
    const gate = (step.checks || []).find((c) => c.gate);
    if (nextBtn) {
      nextBtn.disabled = !!gate;
      nextBtn.textContent = stepIndex === STEPS.length - 1 ? 'Done' : 'Next';
      nextBtn.classList.toggle('hidden', step.id === 'done');
    }
    const quitBtn = root.querySelector('.ob-quit');
    quitBtn.classList.toggle('hidden', step.id === 'done');
    root.querySelector('.ob-scan').classList.toggle('hidden', step.id !== 'done');
  }

  function featuresHtml(features) {
    return `<div class="ob-features">${features.map((f) => `
      <div class="ob-feature">
        <span class="ob-tile ${f.tile}">${f.glyph}</span>
        <div><div class="t">${f.t}</div><div class="s">${f.s}</div></div>
      </div>`).join('')}</div>`;
  }

  function checkHtml(check, i) {
    return `
      <label class="ob-check">
        <input type="checkbox" data-check="${i}" />
        <span class="ob-box">${CHECK_SVG}</span>
        <span class="ob-label">${check.html}</span>
      </label>`;
  }

  function ctaHtml(cta) {
    return `<button class="ob-inline-cta" id="${cta.id}" style="margin-top:14px">${cta.label}</button>`;
  }

  function wireStep(step) {
    const root = rootEl();

    root.querySelectorAll('.ob-check input').forEach((input) => {
      input.addEventListener('change', () => {
        const check = (step.checks || [])[Number(input.dataset.check)];
        if (check && check.pref) prefs[check.pref] = input.checked;
        const gate = (step.checks || []).find((c) => c.gate);
        const nextBtn = root.querySelector('.ob-next');
        if (gate && nextBtn) nextBtn.disabled = !gateGatedChecked(step);
      });
    });

    root.querySelectorAll('.ob-label a[data-doc]').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openDoc(a.dataset.doc);
      });
    });

    const cta = step.cta && root.querySelector(`#${step.cta.id}`);
    if (cta) cta.addEventListener('click', () => runCta(step.cta, cta));
  }

  function gateGatedChecked(step) {
    const gate = step.checks.find((c) => c.gate);
    const root = rootEl();
    const input = root.querySelector(`.ob-check input[data-check="${step.checks.indexOf(gate)}"]`);
    return !!(input && input.checked);
  }

  function runCta(cta, btn) {
    if (cta.action === 'notifications') {
      const finish = () => {
        btn.classList.add('done');
        btn.textContent = 'Enabled ✓';
        setTimeout(nextStep, 700);
      };
      if (typeof Notification !== 'undefined' && Notification.requestPermission) {
        Notification.requestPermission().then(finish).catch(finish);
      } else {
        finish();
      }
    }
  }

  function openDoc(key) {
    const doc = DOCS[key];
    if (!doc) return;
    const root = rootEl();
    root.querySelector('.ob-modal-title').textContent = doc.title;
    root.querySelector('.ob-modal-body').innerHTML = doc.html;
    root.querySelector('.ob-modal-backdrop').classList.remove('hidden');
  }

  function nextStep() {
    if (stepIndex < STEPS.length - 1) {
      stepIndex += 1;
      renderStep();
    }
  }

  function finish() {
    try { localStorage.setItem(FLAG, 'done'); } catch { /* private mode */ }
    const root = rootEl();
    root.classList.add('hidden');
    root.innerHTML = '';
    if (prefs.login && window.lcino && window.lcino.setLoginItem) {
      window.lcino.setLoginItem(true).catch(() => {});
    }
    const cb = onDone;
    onDone = null;
    if (cb) cb();
  }

  function build() {
    const root = rootEl();
    root.innerHTML = `
      <div class="ob-top"><div class="ob-wordmark">Lcino<span class="care">Care</span></div></div>
      <div class="ob-stage"></div>
      <div class="ob-footer">
        <button class="ob-quit">Quit</button>
        <button class="ob-next" disabled>Next</button>
      </div>
      <button class="ob-scan hidden">Scan</button>
      <div class="ob-modal-backdrop hidden">
        <div class="ob-modal">
          <h3 class="ob-modal-title"></h3>
          <div class="ob-modal-body"></div>
          <div class="ob-modal-actions"><button class="ob-btn-ghost ob-modal-close">Close</button></div>
        </div>
      </div>`;

    root.querySelector('.ob-quit').addEventListener('click', () => {
      if (window.lcino && window.lcino.quitApp) window.lcino.quitApp();
    });
    root.querySelector('.ob-next').addEventListener('click', nextStep);
    root.querySelector('.ob-scan').addEventListener('click', finish);
    root.querySelector('.ob-modal-close').addEventListener('click', () => {
      root.querySelector('.ob-modal-backdrop').classList.add('hidden');
    });

    // re-render only when the resolved theme actually flips (the event can
    // fire spuriously on repaints, which would restart step animations)
    let lastDark = isDark();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      const d = isDark();
      if (d !== lastDark) { lastDark = d; renderStep(); }
    });
  }

  function show(doneCb) {
    onDone = doneCb || null;
    stepIndex = 0;
    build();
    renderStep();
    rootEl().classList.remove('hidden');
  }

  window.LcinoOnboarding = { shouldShow, show };
})();
