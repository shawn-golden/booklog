# 📚 Booklog

A small, mobile-first reading tracker: the books you've read, the ones you want to read next, and a stats dashboard. It's plain HTML/CSS/JS with no build step, so it runs free on GitHub Pages and works offline once installed on your phone.

## Features
- **Read list**: sort by year read (grouped by year), title A→Z, author, rating, or recently added. Filter by 📖 Read / 🎧 Listened. Search.
- **TBR list**: alphabetical with letter headers (ignores "The/A/An"). Tap ◯ to mark a book read, and it moves to your Read list with a celebration.
- **🛒 Buy links** for each TBR: Bookshop.org, Amazon, Barnes & Noble, ThriftBooks (used), Libro.fm, Audible, and a library search (WorldCat).
- **Book lookup**: search by title, author, or ISBN (Open Library, free, no API key). It fills in the cover, author, and pages. Books you type in by hand get a cover found for them in the background.
- **Stats dashboard**: books, pages, estimated time, average rating, yearly goal ring, read vs. listen split, books per month/year, fun facts, badges, and a cover wall.
- **Fun stuff**: confetti and a cheer when you finish a book, 15 unlockable badges, a goal-pace banner, and a 🎲 "Pick my next read" spinner.
- **Backup**: export/import JSON from Settings, plus **Goodreads CSV import**.

## Run it locally
```bash
cd ~/Booklog && python3 -m http.server 8765
```
Then open http://localhost:8765. To try it on your phone, use the same Wi‑Fi and open `http://<your-mac's-IP>:8765` (offline mode and install need HTTPS, so test those on GitHub Pages).

## Put it on GitHub Pages (free)
1. Create a new **public** repo on GitHub, e.g. `booklog`.
2. From this folder:
   ```bash
   git init && git add . && git commit -m "Booklog" && git branch -M main
   git remote add origin https://github.com/<you>/booklog.git && git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save**.
4. After a minute, your app is at `https://<you>.github.io/booklog/`.

> Your book data is **not** in the repo. It stays on each device, so a public repo is fine.

**Releasing changes:** bump `VERSION` in `sw.js` and the `?v=` numbers in `index.html` whenever you edit the app, so every device picks up the update.

## Make it feel like an app on your phone
**iPhone (Safari):** open your GitHub Pages URL → tap **Share** (□↑) → **Add to Home Screen** → **Add**. It opens full-screen with its own icon, no browser bars.

**Android (Chrome):** open the URL → **⋮** → **Add to Home screen** / **Install app**.

⚠️ On iPhone, the home-screen app keeps **separate storage from Safari**. Add it to your home screen *first* and log books there. If you already logged some in Safari, export a backup there and import it into the home-screen app.

## Your library on the website
Your books are published with the site in `data/books.json`. The first time you open Booklog on any device, it loads them automatically.

The site asks search engines not to index it (`noindex` tags), but anyone with the link can still open it.

**Edits stay on the device you make them on.** To publish changes so every device gets them:
1. In the app: ⚙️ Settings → **Export backup** (saves `booklog-backup-YYYY-MM-DD.json`).
2. Replace `data/books.json` in this folder with that file (keep the name `books.json`).
3. Commit and push. On your other devices: ⚙️ Settings → **🔄 Get latest books from the website**.

## Things to know
- **Data lives on one device.** There's no account or cloud sync. Export a backup now and then (the app reminds you monthly). To sync across devices you'd need a backend; see ideas below.
- **Time is estimated** for books you read with your eyes (pages × minutes-per-page, adjustable in Settings). Audiobooks use the length you enter, or ~2 min/page if you leave it blank.
- Covers come from Open Library. If one is missing, paste any image URL in *More details → Cover image URL*.

## Ideas for later
- **Cloud sync** across phone and laptop (e.g. Supabase or Firebase free tier, or saving the backup to a private GitHub Gist).
- **Currently reading** shelf with a progress bar.
- **Genres/tags**, so stats can show genre breakdowns.
- **Year-in-review** shareable card (Spotify Wrapped style).
- **Re-reads** (log the same book more than once).

## Files
| File | What it does |
|---|---|
| `index.html` | Layout, dialogs, tab bar |
| `styles.css` | Mobile-first styles, light/dark mode |
| `app.js` | All app logic (storage, lists, stats, lookup, celebrations) |
| `manifest.json`, `sw.js` | Home-screen install + offline support |
| `icons/` | App icons (regenerate with `python3 tools/make_icons.py`) |
