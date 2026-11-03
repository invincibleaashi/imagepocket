const DEFAULTS = {
  enabled: true,
  folder: 'Pocket',
  perSiteSubfolder: false,
  saveAs: false,
  minSize: 96,
  detectBackgrounds: false,
  buttonCorner: 'top-right'
};

const checkboxes = ['enabled', 'perSiteSubfolder', 'saveAs', 'detectBackgrounds'];
const folder = document.getElementById('folder');
const minSize = document.getElementById('minSize');
const saved = document.getElementById('saved');
const hint = document.getElementById('hint');

let savedTimer;

function flashSaved() {
  clearTimeout(savedTimer);
  saved.classList.add('is-on');
  savedTimer = setTimeout(() => saved.classList.remove('is-on'), 1400);
}

function updateHint() {
  const name = folder.value.trim() || DEFAULTS.folder;
  hint.textContent = `Images land in Downloads / ${name}.`;
}

async function load() {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  checkboxes.forEach((key) => {
    document.getElementById(key).checked = Boolean(settings[key]);
  });
  folder.value = settings.folder ?? DEFAULTS.folder;
  minSize.value = String(settings.minSize ?? DEFAULTS.minSize);
  updateHint();
}

function bind() {
  checkboxes.forEach((key) => {
    document.getElementById(key).addEventListener('change', (event) => {
      chrome.storage.sync.set({ [key]: event.target.checked });
      flashSaved();
    });
  });

  let folderTimer;
  folder.addEventListener('input', () => {
    updateHint();
    clearTimeout(folderTimer);
    folderTimer = setTimeout(() => {
      const value = folder.value.trim() || DEFAULTS.folder;
      chrome.storage.sync.set({ folder: value });
      flashSaved();
    }, 400);
  });

  folder.addEventListener('blur', () => {
    if (!folder.value.trim()) {
      folder.value = DEFAULTS.folder;
      updateHint();
    }
  });

  minSize.addEventListener('change', () => {
    chrome.storage.sync.set({ minSize: Number(minSize.value) });
    flashSaved();
  });

  document.getElementById('open').addEventListener('click', () => {
    chrome.downloads.showDefaultFolder();
  });
}

load();
bind();
