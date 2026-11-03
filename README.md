# Pocket

A Chrome extension that puts a small save button on any image you hover, and files it into a folder you choose.

## Install

1. Unzip this folder somewhere permanent (Chrome reads it from disk every launch).
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick this folder.
5. Pin the icon, open the popup, and set your folder name.

## How it works

Hover an image → a 32 px button fades in at its top-right corner → click it. The button shows a spinner while the file transfers, then a green check, then returns to idle. A red state with a tooltip explains anything that failed.

Right-clicking an image also gives you **Save image to [your folder]**.

## About the folder

Chrome extensions cannot write anywhere on your disk. The `downloads` API only accepts paths *relative to your Downloads folder*, so "Pocket" means `~/Downloads/Pocket`. Nested names work too — type `Reference/Textures` and you get `~/Downloads/Reference/Textures`.

If you want files elsewhere, either point Chrome's download location at that place (`chrome://settings/downloads`) or turn on **Ask every time** in the popup, which opens the system save dialog instead.

## Settings

| Setting | What it does |
| --- | --- |
| Hover button | Turns the on-page button off without disabling the extension |
| Folder | Subfolder of Downloads that receives every save |
| Group by website | Adds a subfolder named after the site the image came from |
| Ask every time | Opens the file dialog on each save |
| Include background images | Also catches images set through CSS, not just `<img>` |
| Skip images smaller than | Keeps the button away from icons, avatars and spacers |

## Files

- `manifest.json` — Manifest V3 config and permissions
- `content.js` — hover detection and the button, isolated in a shadow root so no site's CSS can reach it
- `background.js` — filename and folder logic, downloads, right-click menu
- `popup.html` / `popup.css` / `popup.js` — settings

## Two details worth knowing

**Why the shadow root.** The button lives in a shadow DOM with `all: initial`, so aggressive page stylesheets can't restyle or hide it.

**Why there are two download paths.** Most images download straight from their URL. When that's blocked (hotlink protection, `blob:` URLs from canvas or lazy-loaders, or a URL with no file extension), the service worker asks the content script to fetch the bytes from inside the page — where cookies and referrer still apply — and hands back a data URL instead. Failures surface on the button rather than silently.

## Tweaks you might want

- Button corner: `buttonCorner` in storage accepts `top-right`, `top-left`, `bottom-right`, `bottom-left`. There's no UI for it yet; add a select in the popup or set it from the console.
- Filename shape: see `deriveName()` in `background.js` if you want dates or the site name prefixed.
- Keyboard shortcut: add a `commands` block to the manifest and save the last hovered image on a hotkey.
