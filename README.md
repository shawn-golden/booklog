# 📚 Booklog

A mobile-first reading tracker: books you've read, books you want to read next, and a stats dashboard. Plain HTML/CSS/JS with no build step, hosted free on GitHub Pages, and installable on your phone like an app.

**Live:** https://shawn-golden.github.io/booklog/ (marked `noindex`, so search engines skip it)

## Features
- **Read list:** sort by year read, title, author, rating, or recently added. Filter 📖 Read / 🎧 Listened. Search.
- **TBR:** A→Z with letter headers. Tap ◯ to mark read (with confetti). Tap ☆ to pin to ⭐ Top of the list. 🛒 Buy links. Mood filter (⭐, 🌀 recommendations by person, 🌶️ spice, tropes). Search `🌀` for recommended books.
- **Book details:** covers (Open Library, Apple Books, Google Books), series, spice 🌶️ (0–5), trope tags, notes.
- **Stats:** totals, goal ring, read vs. listen, series tracker, top authors, re-reads, page-count personality, TBR health, spice meter, favorite tropes, recommendation scoreboard, badges, cover wall, and a shareable 🎁 Wrapped card.
- **Autosave:** edits save as you make them, with a ✓ Saved status.
- **Sync:** connect each device to GitHub once and every change syncs everywhere.

## Your library
Your books live in `data/books.json`, published with the site. Any device that opens Booklog for the first time loads them automatically.

### Syncing between devices (recommended)
Connect each device once, and every change saves to the website on its own. Other devices pick changes up when you open them.

1. **Create a token** (one time, on any computer or phone):
   1. Open https://github.com/settings/personal-access-tokens/new and sign in.
   2. **Token name:** `Booklog`. **Expiration:** pick the longest option you're comfortable with (you'll make a new token when it expires).
   3. **Repository access:** *Only select repositories* → choose **booklog**.
   4. **Permissions → Repository permissions → Contents:** **Read and write**.
   5. Tap **Generate token** and copy it (it starts with `github_pat_`). GitHub only shows it once.
2. **On each device:** open Booklog → ⚙️ Settings → **Sync with the website** → paste the token → **Connect**.

The status shows **☁️ Synced** after each change. If anything goes wrong (offline, expired token), you'll see **⚠️ Saved on this device only**. Your changes stay safe on the device and sync next time.

The token is stored only on that device, never in your library, backups, or the website. It can only touch the `booklog` repo.

> Each sync is a small commit to the repo, and GitHub Pages republishes in about a minute. If you also edit the app's code on your computer, run `git pull` before you push.

## Backups
Your library is protected in several places at once:

1. **Every sync is saved in Git history.** Every version of `data/books.json` is kept in the repo forever, so you can go back to any day. To restore an old version, open the file on GitHub → **History** → pick a version → copy it into `data/books.json`, or ask Claude to restore it.
2. **Each device has a full copy.** If GitHub had a problem, your phone and computer would still have everything.
3. **Your computer's copy of the repo.** Run `git pull` in this folder now and then to bring the latest library down to your Mac. Time Machine then backs it up too.
4. **Export backup (belt and braces):** once a month, ⚙️ Settings → **Export backup**, and save the file to iCloud Drive. The app reminds you monthly.

To restore from a backup file: ⚙️ Settings → **Import backup** → pick the file.

## Install on your iPhone
1. Open the live link in **Safari**.
2. Tap **Share** ⬆️ (on newer iOS: tap **•••** first, then Share).
3. Tap **Add to Home Screen** → **Add**.
4. Open Booklog from the new icon from now on. It has its own storage, separate from Safari, so connect sync there.

**Android (Chrome):** ⋮ → **Add to Home screen** / **Install app**.

## Run it locally
```bash
cd ~/Booklog && python3 -m http.server 8765
```
Then open http://localhost:8765.

## Releasing app changes
When you change `index.html`, `styles.css` or `app.js`:
1. Bump `VERSION` in `sw.js` and the `?v=` numbers in `index.html` (and the matching `SHELL` entries in `sw.js`), so every device gets the update.
2. `git pull`, then commit and push. GitHub Pages republishes in about a minute.

## Files
| File | What it does |
|---|---|
| `index.html` | Layout, dialogs, tab bar |
| `styles.css` | Mobile-first styles, light/dark mode |
| `app.js` | All app logic (storage, sync, lists, stats, covers, celebrations) |
| `data/books.json` | Your library, published with the site |
| `manifest.json`, `sw.js` | Home-screen install + offline support |
| `icons/` | App icons (regenerate with `python3 tools/make_icons.py`) |
