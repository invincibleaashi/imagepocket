/* Pocket — service worker
   Turns a save request into a file inside the folder the user picked. */

const DEFAULTS = {
  enabled: true,
  folder: 'Pocket',
  perSiteSubfolder: false,
  saveAs: false,
  minSize: 96,
  detectBackgrounds: false,
  buttonCorner: 'top-right'
};

const KNOWN_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico', 'tif', 'tiff', 'heic'
];

const MIME_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/tiff': 'tiff',
  'image/heic': 'heic'
};

/* ---------- setup ---------- */

const MENU_ID = 'pocket-save';

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(null);
  const missing = Object.fromEntries(
    Object.entries(DEFAULTS).filter(([key]) => !(key in stored))
  );
  if (Object.keys(missing).length) await chrome.storage.sync.set(missing);
  syncContextMenu(stored.folder ?? DEFAULTS.folder);
});

chrome.runtime.onStartup.addListener(async () => {
  const { folder } = await chrome.storage.sync.get({ folder: DEFAULTS.folder });
  syncContextMenu(folder);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.folder) syncContextMenu(changes.folder.newValue);
});

/* The menu survives service worker restarts, and several events can ask for it
   at once, so update first, create only if it isn't there — one at a time. */
let menuQueue = Promise.resolve();

function syncContextMenu(folder) {
  const title = `Save image to ${folder || DEFAULTS.folder}`;
  menuQueue = menuQueue.then(() => new Promise((resolve) => {
    chrome.contextMenus.update(MENU_ID, { title }, () => {
      if (!chrome.runtime.lastError) return resolve();
      chrome.contextMenus.create({ id: MENU_ID, title, contexts: ['image'] }, () => {
        void chrome.runtime.lastError; // already exists: nothing to do
        resolve();
      });
    });
  }));
  return menuQueue;
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.srcUrl) return;
  handleSave(
    { src: info.srcUrl, pageUrl: info.pageUrl || '' },
    { tab, frameId: info.frameId ?? 0 }
  );
});

/* ---------- messaging ---------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'save') return;
  handleSave(msg, sender).then((result) => {
    if (!result.ok) console.warn('[Pocket] save failed:', result.error, '→', msg.src);
    sendResponse(result);
  });
  return true; // keep the channel open for the async reply
});

/* ---------- core ---------- */

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

async function handleSave(msg, sender) {
  try {
    const settings = await getSettings();
    const { src, pageUrl = '' } = msg;
    if (!src) return { ok: false, error: 'No image address' };

    const directory = buildDirectory(settings, pageUrl || sender?.tab?.url || '');
    const named = deriveName(src);

    const needsPageContext =
      src.startsWith('blob:') || src.startsWith('data:') || !named.ext;

    let downloadId;
    let path;

    if (!needsPageContext) {
      path = joinPath(directory, `${named.base}.${named.ext}`);
      downloadId = await startDownload({ url: src, filename: path, saveAs: settings.saveAs });
      const outcome = await settleDownload(downloadId);
      if (outcome.ok) return { ok: true, path };
      // fall through and retry from inside the page
    }

    const fetched = await fetchFromPage(sender, src);
    if (!fetched.ok) return { ok: false, error: fetched.error };

    const ext = named.ext || MIME_EXTENSIONS[fetched.mime] || 'jpg';
    path = joinPath(directory, `${named.base}.${ext}`);
    downloadId = await startDownload({
      url: fetched.dataUrl,
      filename: path,
      saveAs: settings.saveAs
    });
    const outcome = await settleDownload(downloadId);
    return outcome.ok ? { ok: true, path } : { ok: false, error: outcome.error };
  } catch (err) {
    return { ok: false, error: err?.message || 'Unknown error' };
  }
}

function startDownload(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ ...options, conflictAction: 'uniquify' }, (id) => {
      if (chrome.runtime.lastError || id === undefined) {
        reject(new Error(chrome.runtime.lastError?.message || 'Download refused'));
      } else {
        resolve(id);
      }
    });
  });
}

/* Chrome reports server-side failures (403, hotlink blocks) asynchronously.
   Cached images often finish before any listener could attach, so ask the
   downloads list how it went rather than waiting for an event to arrive. */
function settleDownload(downloadId, timeoutMs = 8000) {
  const started = Date.now();

  const look = () => new Promise((resolve) => {
    chrome.downloads.search({ id: downloadId }, (items) => {
      resolve(items && items[0] ? items[0] : null);
    });
  });

  return new Promise((resolve) => {
    const poll = async () => {
      const item = await look();

      if (item?.state === 'complete') return resolve({ ok: true });
      if (item?.state === 'interrupted') {
        return resolve({ ok: false, error: friendlyError(item.error) });
      }
      if (Date.now() - started > timeoutMs) {
        return resolve({ ok: true }); // big file still transferring: let it run
      }
      setTimeout(poll, 200);
    };
    poll();
  });
}

function friendlyError(code) {
  const map = {
    SERVER_FORBIDDEN: 'The site blocked the download',
    SERVER_UNAUTHORIZED: 'The site blocked the download',
    SERVER_BAD_CONTENT: 'The image is no longer at that address',
    SERVER_FAILED: 'The site refused the request',
    NETWORK_FAILED: 'Network dropped',
    FILE_ACCESS_DENIED: 'Chrome could not write to that folder',
    FILE_NO_SPACE: 'No disk space left',
    FILE_NAME_TOO_LONG: 'Filename too long',
    USER_CANCELED: 'Cancelled'
  };
  return map[code] || code || 'Download interrupted';
}

async function fetchFromPage(sender, url) {
  const tabId = sender?.tab?.id;
  if (tabId === undefined) return { ok: false, error: 'No page to read from' };
  try {
    const reply = await chrome.tabs.sendMessage(
      tabId,
      { type: 'fetchAsDataUrl', url },
      { frameId: sender.frameId ?? 0 }
    );
    return reply || { ok: false, error: 'No response from page' };
  } catch (err) {
    return { ok: false, error: err?.message || 'Could not read image' };
  }
}

/* ---------- paths ---------- */

function buildDirectory(settings, pageUrl) {
  const parts = [sanitizeSegment(settings.folder) || 'Pocket'];
  if (settings.perSiteSubfolder) {
    const site = hostOf(pageUrl);
    if (site) parts.push(sanitizeSegment(site));
  }
  return parts;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function joinPath(directory, filename) {
  return [...directory, filename].join('/');
}

function sanitizeSegment(value) {
  return String(value || '')
    .replace(/[\\/:*?"<>|]+/g, '-')     // characters Chrome rejects in paths
    .replace(/[\x00-\x1f]/g, '')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function deriveName(src) {
  let base = '';
  let ext = '';

  if (src.startsWith('data:')) {
    const mime = src.slice(5, src.indexOf(';') > -1 ? src.indexOf(';') : src.indexOf(','));
    ext = MIME_EXTENSIONS[mime] || '';
  } else if (!src.startsWith('blob:')) {
    try {
      const { pathname } = new URL(src);
      const last = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '');
      const dot = last.lastIndexOf('.');
      if (dot > 0) {
        const candidate = last.slice(dot + 1).toLowerCase();
        if (KNOWN_EXTENSIONS.includes(candidate)) {
          ext = candidate === 'jpeg' ? 'jpg' : candidate;
          base = last.slice(0, dot);
        } else {
          base = last;
        }
      } else {
        base = last;
      }
    } catch {
      /* keep the fallback below */
    }
  }

  base = sanitizeSegment(base);
  if (!base) base = `image-${timestamp()}`;
  return { base, ext };
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
