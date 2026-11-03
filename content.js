/* Pocket — content script
   Watches for hovered images and offers a save button anchored to them.
   All UI lives in a closed-off shadow root so page CSS can never touch it. */

(() => {
  if (window.__pocketInjected) return;
  window.__pocketInjected = true;

  const DEFAULTS = {
    enabled: true,
    minSize: 96,
    detectBackgrounds: false,
    buttonCorner: 'top-right'
  };

  let settings = { ...DEFAULTS };
  let host = null;
  let shadow = null;
  let button = null;
  let currentTarget = null;   // element being hovered (img or bg element)
  let currentSrc = null;
  let rafId = null;
  let hideTimer = null;
  let resetTimer = null;
  let settling = false;      // a save is in flight or its result is on screen

  /* ---------- settings ---------- */

  chrome.storage.sync.get(DEFAULTS, (stored) => {
    settings = { ...DEFAULTS, ...stored };
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in settings) settings[key] = newValue;
    }
    if (!settings.enabled) hide(true);
  });

  /* ---------- UI ---------- */

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; }

    .btn {
      position: fixed;
      top: 0;
      left: 0;
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      padding: 0;
      border: 0;
      border-radius: 8px;
      background: rgba(22, 23, 26, 0.72);
      -webkit-backdrop-filter: blur(8px) saturate(1.4);
      backdrop-filter: blur(8px) saturate(1.4);
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.14) inset,
        0 2px 8px rgba(0, 0, 0, 0.24);
      color: #fff;
      cursor: pointer;
      opacity: 0;
      transform: translate(-999px, -999px) scale(0.92);
      transition:
        opacity 160ms cubic-bezier(0.2, 0.8, 0.2, 1),
        scale 160ms cubic-bezier(0.2, 0.8, 0.2, 1),
        background-color 120ms ease;
      pointer-events: none;
      scale: 0.92;
    }

    .btn.is-visible {
      opacity: 1;
      scale: 1;
      pointer-events: auto;
    }

    .btn:hover { background: rgba(22, 23, 26, 0.88); }
    .btn:active,
    .btn.is-pressed { scale: 0.94; }
    .btn:focus-visible {
      outline: 2px solid #fff;
      outline-offset: 2px;
    }

    .btn.is-busy { pointer-events: none; }
    .btn.is-done { background: rgba(46, 111, 94, 0.92); }
    .btn.is-error { background: rgba(168, 58, 50, 0.92); }

    /* icon stack — one visible at a time */
    .icon {
      grid-area: 1 / 1;
      width: 16px;
      height: 16px;
      opacity: 0;
      scale: 0.7;
      transition:
        opacity 140ms cubic-bezier(0.2, 0.8, 0.2, 1),
        scale 200ms cubic-bezier(0.34, 1.4, 0.64, 1);
    }
    .btn:not(.is-busy):not(.is-done):not(.is-error) .icon--save,
    .btn.is-busy .icon--busy,
    .btn.is-done .icon--done,
    .btn.is-error .icon--error {
      opacity: 1;
      scale: 1;
    }

    .icon--busy { animation: spin 900ms linear infinite; }
    @keyframes spin { to { rotate: 360deg; } }

    .icon--done path { 
      stroke-dasharray: 24;
      stroke-dashoffset: 24;
    }
    .btn.is-done .icon--done path { animation: draw 260ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards; }
    @keyframes draw { to { stroke-dashoffset: 0; } }

    @media (prefers-reduced-motion: reduce) {
      .btn, .icon { transition-duration: 1ms; }
      .icon--busy { animation-duration: 2s; }
      .btn.is-done .icon--done path { animation: none; stroke-dashoffset: 0; }
    }
  `;

  const ICONS = `
    <svg class="icon icon--save" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2v8m0 0 3-3M8 10 5 7" stroke="currentColor" stroke-width="1.6"
            stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M2.5 11v1.5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V11"
            stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </svg>
    <svg class="icon icon--busy" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.6"/>
      <path d="M13.5 8A5.5 5.5 0 0 0 8 2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </svg>
    <svg class="icon icon--done" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m3.5 8.5 3 3 6-6.5" stroke="currentColor" stroke-width="1.8"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <svg class="icon icon--error" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 4.5v4.2M8 11.4v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4" stroke-opacity="0.5"/>
    </svg>
  `;

  function ensureUI() {
    if (host) return;
    host = document.createElement('div');
    host.setAttribute('data-pocket', '');
    host.style.cssText =
      'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
    shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = STYLE;

    button = document.createElement('button');
    button.className = 'btn';
    button.type = 'button';
    button.title = 'Save image';
    button.setAttribute('aria-label', 'Save image');
    button.innerHTML = ICONS;
    // The save runs from pointerdown (see installEventGuards) because pages
    // like Etsy open an overlay on mousedown, which steals the matching mouseup
    // and means no click event is ever produced. Keyboard still uses keydown.
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        save();
      }
    });
    button.addEventListener('pointerenter', () => clearTimeout(hideTimer));
    button.addEventListener('pointerleave', scheduleHide);

    shadow.append(style, button);

    (document.body || document.documentElement).appendChild(host);
  }

  /* ---------- image discovery ---------- */

  function isBigEnough(rect) {
    return rect.width >= settings.minSize && rect.height >= settings.minSize;
  }

  function bestSrc(img) {
    if (img.currentSrc) return img.currentSrc;
    if (img.src) return img.src;
    const srcset = img.getAttribute('srcset');
    if (srcset) {
      const last = srcset.split(',').pop().trim().split(/\s+/)[0];
      if (last) return new URL(last, location.href).href;
    }
    return null;
  }

  function backgroundSrc(el) {
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg === 'none') return null;
    const match = bg.match(/url\((['"]?)(.*?)\1\)/);
    if (!match || !match[2]) return null;
    return new URL(match[2], location.href).href;
  }

  function findImage(el) {
    if (!(el instanceof Element)) return null;
    if (el.closest('[data-pocket]')) return null;

    const img = el.closest('img');
    if (img) {
      const src = bestSrc(img);
      if (src) return { el: img, src };
    }

    if (settings.detectBackgrounds) {
      let node = el;
      for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
        const src = backgroundSrc(node);
        if (src) return { el: node, src };
      }
    }
    return null;
  }

  /* ---------- show / hide / position ---------- */

  function position() {
    if (!currentTarget || settling) return;   // hold still until the save resolves
    const rect = currentTarget.getBoundingClientRect();

    if (
      rect.bottom < 0 || rect.top > innerHeight ||
      rect.right < 0 || rect.left > innerWidth ||
      !isBigEnough(rect)
    ) {
      hide(true);
      return;
    }

    const size = 32;
    const gap = 8;
    const right = settings.buttonCorner.endsWith('right');
    const bottom = settings.buttonCorner.startsWith('bottom');

    let x = right ? rect.right - size - gap : rect.left + gap;
    let y = bottom ? rect.bottom - size - gap : rect.top + gap;

    // keep it on screen for images that run off the viewport
    x = Math.min(Math.max(x, gap), innerWidth - size - gap);
    y = Math.min(Math.max(y, gap), innerHeight - size - gap);

    button.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  function track() {
    position();
    rafId = requestAnimationFrame(track);
  }

  function show(found) {
    if (settling) return;
    clearTimeout(hideTimer);
    ensureUI();

    if (currentTarget === found.el) return;
    currentTarget = found.el;
    currentSrc = found.src;

    resetState();
    position();
    button.classList.add('is-visible');

    if (rafId === null) rafId = requestAnimationFrame(track);
  }

  function hide(immediate = false) {
    if (settling) return;
    clearTimeout(hideTimer);
    const run = () => {
      currentTarget = null;
      currentSrc = null;
      if (button) button.classList.remove('is-visible');
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
    immediate ? run() : (hideTimer = setTimeout(run, 120));
  }

  function scheduleHide() {
    hideTimer = setTimeout(() => hide(true), 160);
  }

  function resetState() {
    clearTimeout(resetTimer);
    button.classList.remove('is-busy', 'is-done', 'is-error', 'is-pressed');
    button.title = 'Save image';
  }

  /* ---------- event guards ---------- */

  /* Pages run their own listeners in the capture phase at document or window
     level, which is above our button in the tree — a host-level listener would
     fire far too late. These run first, take anything aimed at our button out
     of circulation entirely, and perform the save themselves. */

  const GUARDED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click',
                   'dblclick', 'auxclick', 'touchstart', 'touchend', 'dragstart'];

  function installEventGuards() {
    for (const type of GUARDED) {
      window.addEventListener(type, (event) => {
        if (!host) return;
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        if (!path.includes(host)) return;

        event.stopImmediatePropagation();
        event.stopPropagation();
        if (event.cancelable) event.preventDefault();

        if (type === 'pointerdown' && event.isPrimary !== false && event.button === 0) {
          button.classList.add('is-pressed');
          save();
        }
        if (type === 'pointerup' || type === 'dragstart') {
          button.classList.remove('is-pressed');
        }
      }, true);
    }
  }

  /* ---------- saving ---------- */

  async function save() {
    if (!currentSrc || settling) return;

    const src = currentSrc;
    const alt = currentTarget?.getAttribute?.('alt') || '';

    settling = true;
    clearTimeout(hideTimer);
    clearTimeout(resetTimer);
    button.classList.add('is-busy');

    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: 'save',
        src,
        alt,
        pageUrl: location.href
      });
    } catch (err) {
      response = { ok: false, error: err?.message || 'Extension not reachable' };
    }

    button.classList.remove('is-busy');

    let linger;
    if (response?.ok) {
      button.classList.add('is-done');
      button.title = `Saved to ${response.path}`;
      linger = 1400;
    } else {
      button.classList.add('is-error');
      button.title = response?.error ? `Could not save: ${response.error}` : 'Could not save';
      console.warn('[Pocket]', response?.error || 'save failed', '→', src);
      linger = 4000;
    }

    resetTimer = setTimeout(() => {
      settling = false;
      resetState();

      // the pointer may have wandered off while the result was on screen
      const stillHovered =
        button.matches(':hover') || Boolean(currentTarget?.matches?.(':hover'));
      if (!stillHovered) hide(true);
    }, linger);
  }

  /* ---------- fetch helper for the service worker ---------- */
  /* Blob URLs, canvas images and hotlink-protected files can only be read
     from the page's own context, so the worker asks us to do it. */

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'fetchAsDataUrl') return;
    (async () => {
      try {
        const res = await fetch(msg.url, { credentials: 'include', cache: 'force-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Could not read image'));
          reader.readAsDataURL(blob);
        });
        sendResponse({ ok: true, dataUrl, mime: blob.type });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  });

  /* ---------- listeners ---------- */

  document.addEventListener('pointerover', (event) => {
    if (!settings.enabled) return;
    const target = event.target;
    if (target === host) return;              // pointer moved onto our button

    const found = findImage(target);
    if (found) {
      const rect = found.el.getBoundingClientRect();
      if (isBigEnough(rect)) {
        show(found);
        return;
      }
    }
    if (currentTarget) scheduleHide();
  }, true);

  document.addEventListener('pointerleave', () => hide());
  window.addEventListener('blur', () => hide(true));

  installEventGuards();
})();
