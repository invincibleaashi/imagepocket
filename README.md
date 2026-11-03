# ImagePocket

A Chrome extension that adds a small save button to any image you hover over. Click it and the image goes straight into a folder you choose, with no "Save image as…" dialog and no hunting through Downloads.

- One-click saving from any website
- Every image goes into one folder, with optional subfolders for each site
- Works on lazy-loaded, `blob:` and hotlink-protected images
- A right-click menu option as a backup
- No account, no tracking, and no network calls of its own

---

## Install

ImagePocket isn't on the Chrome Web Store yet, so you load it as an unpacked extension.

1. **Get the code.** Pick one:
   ```bash
   git clone https://github.com/invincibleaashi/imagepocket.git
   ```
   or click **Code → Download ZIP** on GitHub and unzip it.
   Keep the folder somewhere permanent: Chrome reads it from disk every time it starts, and the extension stops working if the folder is moved or deleted.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (the switch in the top-right corner).
4. Click **Load unpacked** and select the `imagepocket` folder (the one that contains `manifest.json`).
5. Click the puzzle-piece icon in the toolbar and **pin** ImagePocket so its icon is always visible.

It also works in other Chromium browsers, such as Edge, Brave, Arc and Opera, through their own extensions page.

---

## How to use it

### Save an image

1. Open any web page.
2. Hover over an image. A round save button fades in at the image's top-right corner.
3. Click it. The button shows:
   - **a spinner** while the file is downloading
   - **a green check** once it's saved (hover over it to see the exact path)
   - **a red mark** if the save failed (hover over it to see why)

By default, images are saved to `~/Downloads/Pocket/`.

The button also works from the keyboard: Tab to it, then press **Enter** or **Space**.

### Save from the right-click menu

Right-click any image and choose **Save image to Pocket** (the menu shows the folder name you've set). This is handy when a site covers its images with an invisible layer and the hover button can't reach them.

### Change the settings

Click the ImagePocket icon in the toolbar to open the settings popup. Changes save automatically, and a small "Saved" message confirms each one.

| Setting | What it does | Default |
| --- | --- | --- |
| **Hover button** | Shows or hides the on-page button. Right-click saving still works when it's off. | On |
| **Folder** | Subfolder inside Downloads where images are saved | `Pocket` |
| **Group by website** | Adds a subfolder for each site, e.g. `Pocket/unsplash.com/` | Off |
| **Ask every time** | Opens the system save dialog for each image | Off |
| **Include background images** | Also detects images set through CSS backgrounds, not just `<img>` tags | Off |
| **Skip images smaller than** | Keeps the button off icons, avatars and spacers (48 / 96 / 160 / 320 px) | 96 px |

**Open Downloads** opens your Downloads folder in Finder or Explorer.

### Choosing a folder

Chrome only lets extensions save inside your Downloads folder, so the folder name is always relative to it:

| You type | Files are saved to |
| --- | --- |
| `Pocket` | `~/Downloads/Pocket/` |
| `Reference/Textures` | `~/Downloads/Reference/Textures/` |
| `Moodboard` + **Group by website** | `~/Downloads/Moodboard/pinterest.com/` |

To save somewhere outside Downloads, either:
- change Chrome's download location at `chrome://settings/downloads`, or
- turn on **Ask every time** and choose a location for each image.

When a file with the same name already exists, Chrome adds a number (`photo (1).jpg`) instead of overwriting it.

---

## Troubleshooting

**The button doesn't appear on a page.**
- Pages that were already open when you installed the extension need a reload.
- The image may be smaller than your **Skip images smaller than** setting.
- If the image is a CSS background, turn on **Include background images**.
- Chrome blocks extensions on its own pages (`chrome://…`) and on the Chrome Web Store.

**The button turns red.**
Hover over it to read the reason. The common ones are:
- *The site blocked the download*: the site refuses outside requests. ImagePocket automatically retries from inside the page, but some sites still refuse.
- *The image is no longer at that address*: the image link is broken or has expired.
- *Chrome could not write to that folder*: check that the folder name is valid and that the disk isn't full.

**Files have odd names like `image-20261103-142210.jpg`.**
The image URL didn't contain a usable filename (common with CDNs and generated images), so ImagePocket names the file after the date and time it was saved.

**I changed the code and nothing happened.**
Go to `chrome://extensions`, click the reload icon on the ImagePocket card, then reload the web page.

---

## Permissions

| Permission | Why it's needed |
| --- | --- |
| `downloads` | To save files into your chosen folder |
| `storage` | To remember your settings and sync them across your Chrome profile |
| `contextMenus` | For the right-click "Save image to…" option |
| Access to all sites | So the hover button can appear on any page you visit |

ImagePocket has no server and collects no data. The only network requests it makes are for the images you choose to save.

---

## For developers

### Files

| File | Role |
| --- | --- |
| `manifest.json` | Manifest V3 configuration and permissions |
| `content.js` | Detects hovered images and draws the save button inside a shadow root |
| `background.js` | Service worker: builds filenames and folders, runs downloads, handles the right-click menu |
| `popup.html` / `popup.css` / `popup.js` | The settings popup |
| `icons/` | Toolbar and store icons (16, 32, 48 and 128 px) |

There's no build step. Edit the files, then reload the extension at `chrome://extensions`.

### How a save works

1. `content.js` finds the image's real source, preferring `currentSrc` and then the largest `srcset` candidate, and sends it to the service worker.
2. `background.js` builds the target path (folder, then the site subfolder if enabled, then the filename) and downloads directly from the URL.
3. If that fails (hotlink protection, a `blob:` or `data:` URL, or a URL with no file extension), the service worker asks the content script to fetch the image from inside the page, where the site's cookies and referrer still apply. The content script returns the image as a data URL, which is then saved.
4. The result goes back to the button, which shows the check or the error.

The button sits in a shadow DOM with `all: initial`, so a site's CSS can't restyle or hide it.

### Ideas for extending it

- **Button corner:** the `buttonCorner` setting already accepts `top-right`, `top-left`, `bottom-right` or `bottom-left`, but there's no control for it in the popup yet.
- **Filename format:** edit `deriveName()` in `background.js` to add a date or the site name to filenames.
- **Keyboard shortcut:** add a `commands` entry to the manifest so a hotkey saves the image currently under the cursor.
