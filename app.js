/* Booklog — a tiny, offline-friendly reading tracker.
   All data lives in localStorage on this device. Export a backup from Settings. */
(() => {
  'use strict';

  // ---------- Storage ----------
  const STORE_KEY = 'booklog.v1';
  const DEFAULT_SETTINGS = { goal: 24, minPerPage: 1.5, lastBackup: null };

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY));
      if (raw && Array.isArray(raw.books)) {
        return { books: raw.books, settings: { ...DEFAULT_SETTINGS, ...raw.settings }, ui: raw.ui || {} };
      }
    } catch (_) { /* fall through */ }
    return { books: [], settings: { ...DEFAULT_SETTINGS }, ui: {} };
  }
  let state = load();
  let pillTimer;

  // Change tracking: every save stamps edited books with updatedAt and records deletions,
  // so devices can merge their libraries when syncing through GitHub.
  const SYNC_KEY = 'booklog.sync'; // kept apart from the library so the token is never exported or published
  let sync = (() => { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (_) { return {}; } })();
  const bookSig = ({ updatedAt, coverTried, ...rest }) => JSON.stringify(rest);
  let snapshot = new Map();
  const snap = () => { snapshot = new Map(state.books.map((b) => [b.id, bookSig(b)])); };
  snap();
  function stampChanges() {
    const now = Date.now();
    let changed = false;
    state.deleted ||= {};
    const ids = new Set();
    for (const b of state.books) {
      ids.add(b.id);
      if (snapshot.get(b.id) !== bookSig(b)) { b.updatedAt = now; changed = true; }
    }
    for (const id of snapshot.keys()) if (!ids.has(id)) { state.deleted[id] = now; changed = true; }
    snap();
    return changed;
  }
  function save(quiet = false) {
    try {
      const changed = stampChanges();
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      if (!quiet) showSavedPill(sync.token ? '✓ Saved · syncing…' : '✓ Saved');
      if (changed) schedulePush();
    } catch (e) { toast('Could not save — storage may be full or blocked.'); }
  }
  function showSavedPill(text = '✓ Saved') {
    const p = document.getElementById('save-pill');
    if (!p) return;
    p.textContent = text;
    p.classList.add('show');
    clearTimeout(pillTimer);
    pillTimer = setTimeout(() => p.classList.remove('show'), 1600);
  }
  // Ask the browser not to evict our data (helps on iOS/Android).
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // ---------- Haptics ----------
  // iOS Safari has no vibrate API, but toggling a native switch control gives a light haptic tick (iOS 18+).
  let hapticLabel = null;
  function haptic(kind = 'light') {
    try {
      if (navigator.vibrate) { navigator.vibrate(kind === 'success' ? [12, 40, 20] : kind === 'heavy' ? 25 : 8); return; }
      if (!hapticLabel) {
        hapticLabel = document.createElement('label');
        hapticLabel.setAttribute('aria-hidden', 'true');
        hapticLabel.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none';
        const i = document.createElement('input'); i.type = 'checkbox'; i.setAttribute('switch', ''); i.tabIndex = -1;
        hapticLabel.appendChild(i); document.body.appendChild(hapticLabel);
      }
      hapticLabel.click();
      if (kind === 'success') { setTimeout(() => hapticLabel.click(), 110); setTimeout(() => hapticLabel.click(), 240); }
      if (kind === 'heavy') setTimeout(() => hapticLabel.click(), 60);
    } catch (_) {}
  }

  // ---------- Helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  const thisYear = () => new Date().getFullYear();
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const fmt = (n) => Math.round(n).toLocaleString();
  const cmpStr = (a, b) => (a || '').localeCompare(b || '', undefined, { sensitivity: 'base', ignorePunctuation: true });
  // Ignore leading "The", "A", "An" when alphabetizing titles.
  const sortTitle = (t) => (t || '').replace(/^(the|a|an)\s+/i, '');
  const authorLast = (a) => { const first = (a || '').split(/,|&| and /)[0].trim(); const parts = first.split(/\s+/); return parts[parts.length - 1] + ' ' + first; };
  const bookYear = (b) => (b.dateFinished ? +b.dateFinished.slice(0, 4) : (b.year ? +b.year : null));
  const readBooks = () => state.books.filter((b) => b.status === 'read');
  const tbrBooks = () => state.books.filter((b) => b.status === 'tbr');
  const starStr = (r) => (r ? '★'.repeat(r) + '☆'.repeat(5 - r) : '');
  const monthName = (m) => new Date(2000, m, 1).toLocaleString(undefined, { month: 'short' });

  function minutesFor(b) {
    if (b.format === 'listen') return b.audioMinutes || num(b.pages) * 2;
    return num(b.pages) * (state.settings.minPerPage || 1.5);
  }
  function fmtDuration(min) {
    if (!min) return '';
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return h ? `${h}h${m ? ' ' + m + 'm' : ''}` : `${m}m`;
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ---------- Covers ----------
  const PALETTE = ['#c4553a', '#2f6f62', '#5b4a8a', '#b5832a', '#3b6ea5', '#8a3b5b', '#4f7a3a', '#7a5230'];
  function hash(s) { let h = 0; for (const c of s || '') h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
  function coverSrc(b) {
    if (b.coverUrl) return b.coverUrl;
    if (b.isbn) return `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(b.isbn)}-M.jpg?default=false`;
    return '';
  }
  function placeholderHTML(b) {
    const bg = PALETTE[hash(b.title) % PALETTE.length];
    return `<div class="cover placeholder" style="background:${bg}">${esc((b.title || '?').slice(0, 40))}</div>`;
  }
  function coverHTML(b) {
    const src = coverSrc(b);
    if (!src) return placeholderHTML(b);
    return `<div class="cover" data-ph="${esc(b.title || '?')}"><img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></div>`;
  }
  // Covers shimmer until their image arrives, then fade in.
  document.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') e.target.closest('.cover')?.classList.add('loaded'); }, true);
  function markLoaded(rootEl = document) {
    rootEl.querySelectorAll('.cover:not(.loaded) img').forEach((img) => { if (img.complete && img.naturalWidth) img.closest('.cover').classList.add('loaded'); });
  }
  new MutationObserver(() => markLoaded()).observe(document.body, { childList: true, subtree: true });
  // Cards cascade in, numbers count up
  function stagger(el) {
    if (!el) return;
    [...el.children].slice(0, 16).forEach((c, i) => c.style.setProperty('--i', i));
  }
  function countUp(rootEl) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    rootEl.querySelectorAll('[data-count]').forEach((el) => {
      const target = parseFloat(el.dataset.count), suffix = el.dataset.suffix || '', dec = +(el.dataset.dec || 0);
      const t0 = performance.now(), dur = 900;
      const step = (t) => {
        const p = Math.min(1, (t - t0) / dur), v = target * (1 - Math.pow(1 - p, 3));
        el.textContent = (dec ? v.toFixed(dec) : fmt(v)) + suffix;
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  // If a cover fails to load, swap in a colored placeholder.
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG') return;
    const wrap = img.closest('.cover');
    if (!wrap) return;
    const title = wrap.dataset.ph || '?';
    wrap.classList.add('placeholder');
    wrap.style.background = PALETTE[hash(title) % PALETTE.length];
    wrap.textContent = title.slice(0, 40);
  }, true);

  // ---------- Cover-color theme: the app's accent follows your latest book ----------
  const COLOR_KEY = 'booklog.colors';
  let colorCache = (() => { try { return JSON.parse(localStorage.getItem(COLOR_KEY)) || {}; } catch (_) { return {}; } })();
  function latestRead() {
    return readBooks().filter((b) => coverSrc(b)).sort((a, b) => cmpStr(b.dateFinished || '', a.dateFinished || '') || (b.finishedAt || 0) - (a.finishedAt || 0) || (b.updatedAt || 0) - (a.updatedAt || 0) || (b.addedAt || 0) - (a.addedAt || 0))[0];
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  function coverColor(url) {
    return new Promise((resolve) => {
      if (url in colorCache) return resolve(colorCache[url]);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas'); c.width = 24; c.height = 36;
          const x = c.getContext('2d'); x.drawImage(img, 0, 0, 24, 36);
          const d = x.getImageData(0, 0, 24, 36).data, buckets = {};
          for (let i = 0; i < d.length; i += 4) {
            const [h, sat, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
            if (sat < 0.25 || l < 0.12 || l > 0.88) continue; // skip greys, blacks, whites
            const k = Math.round(h / 20) % 18, w = sat * (1 - Math.abs(l - 0.5));
            const bk = (buckets[k] ||= { w: 0, h: 0, s: 0 });
            bk.w += w; bk.h += h * w; bk.s += sat * w;
          }
          const best = Object.values(buckets).sort((p, q) => q.w - p.w)[0];
          const out = best && best.w > 1 ? { h: Math.round(best.h / best.w), s: best.s / best.w } : null;
          colorCache[url] = out;
          try { localStorage.setItem(COLOR_KEY, JSON.stringify(colorCache)); } catch (_) {}
          resolve(out);
        } catch (_) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      // A separate URL keeps this colour-sampling copy apart from the normal (non-CORS) cover image
      img.src = url + (url.includes('?') ? '&' : '?') + 'bl-color=1';
    });
  }
  let colorsRunning = false;
  async function ensureColors(books, onDone) {
    const todo = books.filter((b) => coverSrc(b) && !(coverSrc(b) in colorCache));
    if (!todo.length || colorsRunning) return false;
    colorsRunning = true;
    const queue = [...todo];
    await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await coverColor(coverSrc(queue.shift())); }));
    colorsRunning = false;
    onDone && onDone();
    return true;
  }
  const hueOf = (b) => { const c = colorCache[coverSrc(b)]; return c ? c.h : 999; };
  function byColor(books) { return [...books].sort((x, y) => hueOf(x) - hueOf(y)); }

  async function applyCoverTheme() {
    const rootEl = document.documentElement;
    const b = state.settings.coverTheme === false ? null : latestRead();
    const hsl = b ? await coverColor(coverSrc(b)) : null;
    if (!hsl) { rootEl.style.removeProperty('--accent'); return; }
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const sat = Math.round(Math.min(72, Math.max(42, hsl.s * 100)));
    const yellowish = hsl.h >= 35 && hsl.h <= 85; // white text needs a darker shade of yellow/gold
    rootEl.style.setProperty('--accent', `hsl(${hsl.h} ${sat}% ${(dark ? 52 : 42) - (yellowish ? 10 : 0)}%)`);
    const meta = document.getElementById('theme-from');
    if (meta) meta.textContent = `Colors from “${b.title}”`;
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyCoverTheme);

  // ---------- Buy links ----------
  function buyLinks(b) {
    const q = encodeURIComponent(`${b.title} ${b.author || ''}`.trim());
    const key = b.isbn ? encodeURIComponent(b.isbn) : q;
    return [
      ['🏪', 'Bookshop.org', `https://bookshop.org/search?keywords=${key}`],
      ['📦', 'Amazon', `https://www.amazon.com/s?k=${key}&i=stripbooks`],
      ['📗', 'Barnes & Noble', `https://www.barnesandnoble.com/s/${q}`],
      ['♻️', 'ThriftBooks (used)', `https://www.thriftbooks.com/browse/?b.search=${q}`],
      ['🎧', 'Libro.fm', `https://libro.fm/search?q=${q}`],
      ['🎧', 'Audible', `https://www.audible.com/search?keywords=${q}`],
      ['🏛️', 'Find at a library', `https://search.worldcat.org/search?q=${q}`],
    ].map(([i, label, url]) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${i} ${label}</a>`).join('');
  }

  // ---------- Badges (fun goals that keep you coming back) ----------
  const BADGES = [
    { id: 'first', e: '🌱', t: 'First Page', d: 'Log 1 book', test: (s) => s.count >= 1 },
    { id: 'b5', e: '📚', t: 'Stack of 5', d: 'Log 5 books', test: (s) => s.count >= 5 },
    { id: 'b10', e: '🔟', t: 'Double Digits', d: 'Log 10 books', test: (s) => s.count >= 10 },
    { id: 'b25', e: '🏅', t: 'Quarter Century', d: 'Log 25 books', test: (s) => s.count >= 25 },
    { id: 'b50', e: '🏆', t: 'Fifty Club', d: 'Log 50 books', test: (s) => s.count >= 50 },
    { id: 'b100', e: '👑', t: 'Centurion', d: 'Log 100 books', test: (s) => s.count >= 100 },
    { id: 'p1k', e: '📄', t: '1,000 Pages', d: 'Read 1k pages', test: (s) => s.pages >= 1000 },
    { id: 'p10k', e: '🗻', t: '10,000 Pages', d: 'Read 10k pages', test: (s) => s.pages >= 10000 },
    { id: 'chonk', e: '🧱', t: 'Brick Lifter', d: 'A 500+ page book', test: (s) => s.maxPages >= 500 },
    { id: 'ears', e: '🎧', t: 'All Ears', d: 'Finish an audiobook', test: (s) => s.listens >= 1 },
    { id: 'ears10', e: '🎶', t: 'Podcast Who?', d: '10 audiobooks', test: (s) => s.listens >= 10 },
    { id: 'five', e: '💖', t: 'Instant Fave', d: 'Give a 5★ rating', test: (s) => s.fiveStars >= 1 },
    { id: 'binge', e: '🔥', t: 'On a Roll', d: '3 books in a month', test: (s) => s.bestMonth >= 3 },
    { id: 'goal', e: '🎯', t: 'Goal Crusher', d: 'Hit your yearly goal', test: (s) => s.goalHit },
    { id: 'tbr', e: '✅', t: 'Pile Shrinker', d: 'Finish 5 from TBR', test: (s) => s.fromTbr >= 5 },
  ];
  function badgeStats() {
    const books = readBooks();
    const months = {};
    let pages = 0, maxPages = 0, listens = 0, fiveStars = 0, fromTbr = 0;
    for (const b of books) {
      const p = num(b.pages);
      pages += p; maxPages = Math.max(maxPages, p);
      if (b.format === 'listen') listens++;
      if (b.rating === 5) fiveStars++;
      if (b.fromTbr) fromTbr++;
      if (b.dateFinished) { const k = b.dateFinished.slice(0, 7); months[k] = (months[k] || 0) + 1; }
    }
    const goal = state.settings.goal;
    const yearCounts = {};
    books.forEach((b) => { const y = bookYear(b); if (y) yearCounts[y] = (yearCounts[y] || 0) + 1; });
    return {
      count: books.length, pages, maxPages, listens, fiveStars, fromTbr,
      bestMonth: Math.max(0, ...Object.values(months)),
      goalHit: goal > 0 && Object.values(yearCounts).some((c) => c >= goal),
    };
  }
  const earnedBadges = () => { const s = badgeStats(); return BADGES.filter((b) => b.test(s)).map((b) => b.id); };

  // ---------- UI state ----------
  const ui = Object.assign({ tab: 'read', readSort: 'year', readFormat: 'all', tbrSort: 'title', statsYear: null }, state.ui);
  function saveUi() { state.ui = ui; save(true); }
  const openBuy = new Set();

  // ---------- Tabs ----------
  const TITLES = { read: 'Read', tbr: 'To Be Read', stats: 'My Stats' };
  function setTab(tab) {
    ui.tab = tab; saveUi();
    $$('.view').forEach((v) => (v.hidden = v.dataset.view !== tab));
    $$('.tab[data-tab]').forEach((t) => {
      const on = t.dataset.tab === tab;
      t.classList.toggle('active', on);
      on ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current');
    });
    $('#view-title').textContent = TITLES[tab];
    render();
    window.scrollTo({ top: 0 });
  }
  $$('.tab[data-tab]').forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));

  // ---------- Segmented controls & stars ----------
  function segValue(el) { return $('[aria-checked="true"]', el)?.dataset.value; }
  function setSeg(el, val) { $$('button', el).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === val))); }
  function bindSeg(el, onChange) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-value]');
      if (!b) return;
      setSeg(el, b.dataset.value);
      onChange && onChange(b.dataset.value);
    });
  }
  function makeStars(el, char = '★', noun = 'star') {
    el.innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-label="${n} ${noun}${n > 1 ? 's' : ''}" data-n="${n}">${char}</button>`).join('');
    el.value = 0;
    const paint = () => $$('button', el).forEach((b) => { b.classList.toggle('on', +b.dataset.n <= el.value); b.setAttribute('aria-checked', String(+b.dataset.n === el.value)); });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const n = +b.dataset.n;
      el.value = el.value === n ? 0 : n; // tap again to clear
      paint();
      if (el.value) { b.classList.remove('bounce'); void b.offsetWidth; b.classList.add('bounce'); if (char === '★') sparkle(b); }
      haptic();
    });
    el.set = (v) => { el.value = v || 0; paint(); };
  }

  // ---------- Trope tags ----------
  const PRESET_TAGS = ['Enemies to lovers', 'Fated mates', 'Fae', 'Dragons', 'Vampires', 'Shifters', 'Morally grey', 'Slow burn',
    'Forced proximity', 'Found family', 'Grumpy × sunshine', 'Why choose', 'Dark', 'Cozy', 'Academy', 'Retelling', 'Touch her and die', 'Villain gets the girl'];
  const allTags = () => [...new Set([...PRESET_TAGS, ...state.books.flatMap((b) => b.tags || [])])];
  function makeTagPicker(el) {
    el.value = new Set();
    const paint = () => {
      const tags = [...new Set([...allTags(), ...el.value])];
      el.innerHTML = tags.map((tg) => `<button type="button" class="tag-chip" aria-pressed="${el.value.has(tg)}" data-tag="${esc(tg)}">${esc(tg)}</button>`).join('')
        + `<input class="tag-add" placeholder="+ Add your own" aria-label="Add a trope tag" enterkeyhint="done" />`;
    };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tag]'); if (!b) return;
      const tg = b.dataset.tag;
      el.value.has(tg) ? el.value.delete(tg) : el.value.add(tg);
      b.setAttribute('aria-pressed', String(el.value.has(tg)));
      b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
      haptic();
    });
    el.addEventListener('keydown', (e) => {
      if (!e.target.classList.contains('tag-add') || e.key !== 'Enter') return;
      e.preventDefault();
      const tg = e.target.value.trim().replace(/\s+/g, ' ');
      if (tg) { el.value.add(tg.charAt(0).toUpperCase() + tg.slice(1)); paint(); el.querySelector('.tag-add').focus(); }
    });
    el.addEventListener('focusout', (e) => {
      if (!e.target.classList.contains('tag-add') || !e.target.value.trim()) return;
      el.value.add(e.target.value.trim()); paint();
    });
    el.set = (tags) => { el.value = new Set(tags || []); paint(); };
  }
  const spiceStr = (n) => (n ? '🌶️'.repeat(n) : '');

  // ---------- READ view ----------
  bindSeg($('#read-format'), (v) => { ui.readFormat = v; saveUi(); renderRead(); });
  $('#read-sort').addEventListener('change', (e) => { ui.readSort = e.target.value; saveUi(); renderRead(); });
  $('#read-search').addEventListener('input', () => renderRead());

  function sortBooks(list, mode) {
    const by = {
      title: (a, b) => cmpStr(sortTitle(a.title), sortTitle(b.title)),
      author: (a, b) => cmpStr(authorLast(a.author), authorLast(b.author)) || cmpStr(sortTitle(a.title), sortTitle(b.title)),
      added: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
      rating: (a, b) => (b.rating || 0) - (a.rating || 0) || cmpStr(sortTitle(a.title), sortTitle(b.title)),
      series: (a, b) => (!a.series - !b.series) || cmpStr(sortTitle(a.series), sortTitle(b.series)) || (+a.seriesNo || 0) - (+b.seriesNo || 0) || cmpStr(sortTitle(a.title), sortTitle(b.title)),
      year: (a, b) => (bookYear(b) || 0) - (bookYear(a) || 0) || cmpStr(b.dateFinished, a.dateFinished) || (b.addedAt || 0) - (a.addedAt || 0),
    };
    return [...list].sort(by[mode] || by.title);
  }
  const recBy = (b) => (/recommended by\s+([^\n,.;]+)/i.exec(b.notes || '') || [])[1]?.trim() || '';
  function matches(b, q) {
    if (!q) return true;
    q = q.toLowerCase();
    // 🌀 = books someone recommended to you ("🌀 liz" narrows it to one person)
    if (/🌀|\brecs?\b|recommended/.test(q)) {
      const who = recBy(b);
      if (!who) return false;
      const rest = q.replace(/🌀|\brecs?\b|recommended( by)?/g, '').trim();
      return !rest || who.toLowerCase().includes(rest) || (b.title || '').toLowerCase().includes(rest);
    }
    return (b.title || '').toLowerCase().includes(q) || (b.author || '').toLowerCase().includes(q) || (b.notes || '').toLowerCase().includes(q)
      || (b.series || '').toLowerCase().includes(q) || (b.tags || []).some((tg) => tg.toLowerCase().includes(q));
  }

  // One card per book: reading it, listening to it and re-reads are grouped together.
  const newestFirst = (a, b) => (bookYear(b) || 0) - (bookYear(a) || 0) || cmpStr(b.dateFinished, a.dateFinished) || (b.addedAt || 0) - (a.addedAt || 0);
  function groupReads(list) {
    const map = new Map();
    for (const b of list) { const k = workKey(b); (map.get(k) || map.set(k, []).get(k)).push(b); }
    return [...map.values()].map((logs) => {
      logs.sort(newestFirst);
      const rep = logs[0];
      // Show the best info across all the logs of this book
      const pick = (f) => logs.map((x) => x[f]).find(Boolean);
      return { ...rep, logs, coverUrl: pick('coverUrl') || rep.coverUrl, pages: pick('pages') || rep.pages, author: rep.author || pick('author'),
        rating: Math.max(0, ...logs.map((x) => x.rating || 0)), spice: Math.max(0, ...logs.map((x) => x.spice || 0)),
        tags: [...new Set(logs.flatMap((x) => x.tags || []))], audioMinutes: pick('audioMinutes') };
    });
  }
  function readCard(g) {
    const logs = g.logs || [g];
    const reads = logs.filter((x) => x.format !== 'listen').length, listens = logs.length - reads;
    const how = reads && listens ? '📖🎧 Read & listened' : listens ? '🎧 Listened' : '📖 Read';
    const meta = [
      ui.readSort === 'series' && g.seriesNo ? `#${g.seriesNo}` : '',
      how,
      g.dateFinished ? fmtDate(g.dateFinished) : (g.year ? String(g.year) : ''),
      g.pages ? `${fmt(g.pages)} pp` : (g.audioMinutes ? fmtDuration(g.audioMinutes) : ''),
    ].filter(Boolean).map((m) => `<span>${esc(m)}</span>`).join('');
    const times = logs.length > 1 ? `<span class="times-badge" aria-label="Logged ${logs.length} times">×${logs.length}</span>` : '';
    return `<article class="card">
      <button class="card-main" data-edit="${g.id}" aria-label="Edit ${esc(g.title)}">
        <span class="cover-wrap">${coverHTML(g)}${times}</span>
        <div class="card-text">
          <h3>${esc(g.title)}</h3>
          ${g.author ? `<p class="by">${esc(g.author)}</p>` : ''}
          <div class="meta">${meta}${g.rating ? `<span class="stars" aria-label="${g.rating} stars">${starStr(g.rating)}</span>` : ''}${g.spice ? `<span class="spice" aria-label="Spice ${g.spice} of 5">${spiceStr(g.spice)}</span>` : ''}</div>
          ${g.tags?.length ? `<div class="card-tags">${g.tags.slice(0, 3).map((tg) => `<span>${esc(tg)}</span>`).join('')}</div>` : ''}
        </div>
      </button>
    </article>`;
  }

  function renderHero() {
    const y = thisYear();
    const goal = state.settings.goal;
    const count = readBooks().filter((b) => bookYear(b) === y).length;
    const el = $('#read-hero');
    if (!readBooks().length) { el.innerHTML = ''; return; }
    if (!goal) {
      el.innerHTML = `<div class="hero"><div><h2>${count} book${count === 1 ? '' : 's'} in ${y}</h2><p>Set a yearly goal in Settings to track your pace.</p></div></div>`;
      return;
    }
    const start = new Date(y, 0, 1), end = new Date(y + 1, 0, 1);
    const frac = (Date.now() - start) / (end - start);
    const expected = goal * frac;
    const diff = Math.round(count - expected);
    const pct = Math.min(100, Math.round((count / goal) * 100));
    let msg;
    if (count >= goal) msg = `Goal smashed! ${count - goal > 0 ? `+${count - goal} bonus 🎉` : 'Every one from here is a bonus 🎉'}`;
    else if (diff > 0) msg = `${diff} ahead of pace 🔥 Keep it up!`;
    else if (diff === 0) msg = `Right on pace 👌`;
    else if (diff >= -2) msg = `Just ${-diff} behind pace — a short one would help 😉`;
    else msg = `${goal - count} to go. Every page counts 📖`;
    el.innerHTML = `<div class="hero">
      <div class="ring" style="--p:${pct}"><div>${count}/${goal}</div></div>
      <div><h2>${y} reading goal</h2><p>${msg}</p>${tbrBooks().length ? '<button type="button" id="hero-pick">🎲 Pick my next read</button>' : ''}</div>
    </div>`;
    $('#hero-pick')?.addEventListener('click', openPick);
  }

  function renderRead() {
    renderHero();
    setSeg($('#read-format'), ui.readFormat);
    $('#read-sort').value = ui.readSort;
    const q = $('#read-search').value.trim();
    const all = readBooks();
    const matching = all.filter((b) => matches(b, q));
    // Group every log of a book together, then keep groups that fit the Read/Listened filter
    const groups = groupReads(matching).filter((g) => ui.readFormat === 'all' || g.logs.some((x) => (x.format || 'read') === ui.readFormat));
    const list = sortBooks(groups, ui.readSort);
    const el = $('#read-list');
    if (!all.length) {
      el.innerHTML = `<div class="empty"><div class="big">📖</div><h3>Your shelf is waiting</h3><p>Log a book you've finished — even old favorites count.</p><button class="btn primary" data-add="read">Log a book</button></div>`;
      return;
    }
    if (!list.length) { el.innerHTML = `<div class="empty"><div class="big">🔎</div><p>No books match.</p></div>`; return; }
    if (ui.readSort === 'series') {
      const prog = new Map(seriesProgress().map((x) => [x.name, x]));
      let html = '', cur = null;
      const standalones = list.filter((g) => !g.series).length;
      for (const g of list) {
        const key = g.series || '';
        if (key !== cur) {
          cur = key;
          if (key) {
            const p = prog.get(key);
            html += `<h2 class="group-head series-head">${esc(key)} <small>${p ? `${p.complete ? '✓ ' : ''}${p.done}/${p.total}` : ''}${g.author ? ` · ${esc(g.author)}` : ''}</small></h2>`;
          } else {
            html += `<h2 class="group-head series-head">Standalones <small>${standalones} book${standalones === 1 ? '' : 's'}</small></h2>`;
          }
        }
        html += readCard(g);
      }
      el.innerHTML = html;
    } else if (ui.readSort === 'year') {
      let html = '', cur;
      const counts = {}, logCounts = {};
      list.forEach((g) => { const y = bookYear(g) || 'Unknown'; counts[y] = (counts[y] || 0) + 1; logCounts[y] = (logCounts[y] || 0) + g.logs.length; });
      for (const g of list) {
        const y = bookYear(g) || 'Unknown';
        if (y !== cur) {
          cur = y;
          const extra = logCounts[y] !== counts[y] ? ` · ${logCounts[y]} reads & listens` : '';
          html += `<h2 class="group-head">${y === 'Unknown' ? 'Year unknown' : y} <small>${counts[y]} book${counts[y] === 1 ? '' : 's'}${extra}</small></h2>`;
        }
        html += readCard(g);
      }
      el.innerHTML = html;
    } else {
      el.innerHTML = list.map(readCard).join('');
    }
  }

  // ---------- TBR view ----------
  $('#tbr-sort').addEventListener('change', (e) => { ui.tbrSort = e.target.value; saveUi(); renderTbr(); });
  $('#tbr-mood').addEventListener('change', (e) => { ui.tbrMood = e.target.value; saveUi(); renderTbr(); });
  $('#tbr-search').addEventListener('input', () => renderTbr());

  function tbrCard(b) {
    const open = openBuy.has(b.id);
    return `<div class="tbr-item">
      <article class="card">
        <button class="check" data-finish="${b.id}" aria-label="Mark ${esc(b.title)} as read"><span></span></button>
        <button class="card-main" data-edit="${b.id}" aria-label="Edit ${esc(b.title)}">
          ${coverHTML(b)}
          <div class="card-text">
            <h3>${esc(b.title)}</h3>
            ${b.author ? `<p class="by">${esc(b.author)}</p>` : ''}
            <div class="meta">${b.spice ? `<span class="spice">${spiceStr(b.spice)}</span>` : ''}${b.pages ? `<span>${fmt(b.pages)} pp</span>` : ''}${recBy(b) ? `<span class="note rec">🌀 from ${esc(recBy(b))}</span>` : b.notes ? `<span class="note">📝 ${esc(b.notes.split('\n')[0].slice(0, 40))}</span>` : ''}</div>
            ${b.tags?.length ? `<div class="card-tags">${b.tags.slice(0, 3).map((tg) => `<span>${esc(tg)}</span>`).join('')}</div>` : ''}
          </div>
        </button>
        <div class="card-actions">
          <button class="star-btn${b.priority ? ' on' : ''}" data-star="${b.id}" aria-pressed="${!!b.priority}" aria-label="${b.priority ? 'Remove from' : 'Add to'} top of the list">${b.priority ? '★' : '☆'}</button>
          <button class="buy-btn" data-buy="${b.id}" aria-expanded="${open}">${open ? 'Hide' : '🛒 Buy'}</button>
        </div>
      </article>
      ${open ? `<div class="buy-links">${buyLinks(b)}</div>` : ''}
    </div>`;
  }

  const hiddenSeries = () => new Set(state.settings.hiddenSeries || []);
  // A TBR book you've already read (same title, ignoring "(Series)" notes) never counts as a recommendation
  const titleKey = (t) => norm(String(t || '').replace(/\s*\(.*?\)\s*/g, ' '));
  function alreadyRead(b) {
    const k = titleKey(b.title), ln = lastName(b.author);
    return readBooks().some((r) => titleKey(r.title) === k && (!ln || !r.author || lastName(r.author) === ln));
  }
  function recommendations() {
    const tbr = tbrBooks().filter((b) => !alreadyRead(b));
    const visible = tbr.filter((b) => !b.recHidden);
    const hs = hiddenSeries();
    const allUpNext = seriesUpNext();
    const upNext = allUpNext.filter((u) => !hs.has(u.name));
    const fromFriends = visible.filter((b) => recBy(b));
    const readAuthors = new Set(readBooks().map((b) => lastName(b.author)).filter(Boolean));
    const fromLoved = visible.filter((b) => !recBy(b) && b.author && readAuthors.has(lastName(b.author)));
    const hidden = { series: allUpNext.filter((u) => hs.has(u.name)), books: tbr.filter((b) => b.recHidden && (recBy(b) || (b.author && readAuthors.has(lastName(b.author))))) };
    return { upNext, fromFriends, fromLoved, hidden, count: upNext.filter((u) => !u.onTbr).length + fromFriends.length + fromLoved.length };
  }
  function upNextCard(u) {
    return `<div class="upnext-card"><button type="button" class="rec-x" data-hide-series="${esc(u.name)}" aria-label="Hide ${esc(u.name)} from recommendations">✕</button>${miniCovers(u.books.slice(-1), 1)}
      <div class="un-info"><b>${esc(u.name)}</b><small>Book ${u.next} of ${u.total}${u.author ? ' · ' + esc(u.author) : ''} · you've read ${u.done}</small>
        ${u.onTbr ? `<button type="button" class="un-btn on" data-edit="${u.onTbr.id}">✓ On your TBR: ${esc(u.onTbr.title)}</button>` : `<button type="button" class="un-btn" data-upnext="${esc(u.name)}">+ Add book ${u.next}</button>`}
      </div></div>`;
  }
  let showHiddenRecs = false;
  function recBookCard(b) {
    return `<div class="rec-wrap">${tbrCard(b)}<button type="button" class="rec-hide" data-hide-book="${b.id}">✕ Hide from recommendations</button></div>`;
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-hide-series],[data-unhide-series],[data-hide-book],[data-unhide-book]');
    if (!t) return;
    const set = hiddenSeries();
    if (t.dataset.hideSeries) {
      const name = t.dataset.hideSeries;
      set.add(name); state.settings.hiddenSeries = [...set]; save(); schedulePush(); renderTbr();
      toast(`Hid ${name} from recommendations`, 'Undo', () => { const s2 = hiddenSeries(); s2.delete(name); state.settings.hiddenSeries = [...s2]; save(); schedulePush(); renderTbr(); });
    } else if (t.dataset.unhideSeries) {
      set.delete(t.dataset.unhideSeries); state.settings.hiddenSeries = [...set]; save(); schedulePush(); renderTbr();
    } else {
      const b = state.books.find((x) => x.id === (t.dataset.hideBook || t.dataset.unhideBook));
      if (!b) return;
      if (t.dataset.hideBook) {
        b.recHidden = true; save(); renderTbr();
        toast(`Hid “${b.title}” from recommendations (still on your TBR)`, 'Undo', () => { delete b.recHidden; save(); renderTbr(); });
      } else { delete b.recHidden; save(); renderTbr(); }
    }
  });
  function renderRecs() {
    const el = $('#tbr-list');
    const { upNext, fromFriends, fromLoved } = recommendations();
    let html = '';
    html += `<h2 class="group-head">⏭️ Up next in your series <small>${upNext.length}</small></h2>`;
    html += upNext.length ? `<div class="upnext-list">${upNext.map(upNextCard).join('')}</div>`
      : `<p class="hint rec-empty">You're caught up on every series you've started 🎉</p>`;
    html += `<h2 class="group-head">🌀 Recommended by friends <small>${fromFriends.length}</small></h2>`;
    if (fromFriends.length) {
      const people = {};
      fromFriends.forEach((b) => (people[recBy(b)] ||= []).push(b));
      for (const [who, list] of Object.entries(people).sort((x, y) => y[1].length - x[1].length || cmpStr(x[0], y[0]))) {
        html += `<h3 class="rec-person">From ${esc(who)} <small>${list.length}</small></h3>` + sortBooks(list, 'title').map(recBookCard).join('');
      }
    } else html += `<p class="hint rec-empty">Write “Recommended by Name” in a TBR book's notes and it shows up here.</p>`;
    if (fromLoved.length) {
      html += `<h2 class="group-head">💛 More from authors you love <small>${fromLoved.length}</small></h2>`
        + sortBooks(fromLoved, 'author').map(recBookCard).join('');
    }
    const { hidden } = recommendations();
    const nHidden = hidden.series.length + hidden.books.length;
    if (nHidden) {
      html += `<details class="rec-hidden"${showHiddenRecs ? ' open' : ''}><summary>Hidden from recommendations (${nHidden})</summary><div class="rec-hidden-list">
        ${hidden.series.map((u) => `<div class="rec-hidden-row"><span>⏭️ ${esc(u.name)} <small>series</small></span><button type="button" class="un-btn on" data-unhide-series="${esc(u.name)}">Show again</button></div>`).join('')}
        ${hidden.books.map((b) => `<div class="rec-hidden-row"><span>📕 ${esc(b.title)}${b.author ? ` <small>${esc(b.author)}</small>` : ''}</span><button type="button" class="un-btn on" data-unhide-book="${b.id}">Show again</button></div>`).join('')}
      </div></details>`;
    }
    el.innerHTML = html;
    el.querySelector('.rec-hidden')?.addEventListener('toggle', (e) => { showHiddenRecs = e.target.open; });
  }
  bindSeg($('#tbr-view'), (v) => { ui.tbrView = v; saveUi(); renderTbr(); window.scrollTo({ top: 0 }); });

  function renderTbr() {
    const recsMode = ui.tbrView === 'recs';
    setSeg($('#tbr-view'), recsMode ? 'recs' : 'list');
    const rc = recommendations().count;
    $('#recs-count').textContent = rc ? String(rc) : '';
    $('#tbr-tools').hidden = recsMode;
    if (recsMode) { renderRecs(); return; }
    $('#tbr-sort').value = ui.tbrSort;
    const q = $('#tbr-search').value.trim();
    const all = tbrBooks();
    // Mood filter: tropes plus a few spice/priority shortcuts
    const moodSel = $('#tbr-mood');
    const usedTags = [...new Set(all.flatMap((b) => b.tags || []))].sort(cmpStr);
    const recPeople = [...new Set(all.map(recBy).filter(Boolean))].sort(cmpStr);
    const moods = [['', 'Mood: Anything'], ['@top', '⭐ Top of the list'],
      ...(recPeople.length ? [['@rec', '🌀 Recommended to me'], ...recPeople.map((p) => ['@rec:' + p, `🌀 From ${p}`])] : []),
      ['@spicy', '🌶️ Spicy (3+)'], ['@mild', '🍵 Low spice (0–1)'], ...usedTags.map((tg) => [tg, '💘 ' + tg])];
    if (!moods.some(([v]) => v === ui.tbrMood)) ui.tbrMood = '';
    moodSel.innerHTML = moods.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    moodSel.value = ui.tbrMood || '';
    const moodOk = (b) => !ui.tbrMood || (ui.tbrMood === '@top' ? b.priority : ui.tbrMood === '@rec' ? !!recBy(b)
      : ui.tbrMood.startsWith('@rec:') ? recBy(b) === ui.tbrMood.slice(5) : ui.tbrMood === '@spicy' ? (b.spice || 0) >= 3
      : ui.tbrMood === '@mild' ? (b.spice || 0) <= 1 : (b.tags || []).includes(ui.tbrMood));
    const list = sortBooks(all.filter((b) => matches(b, q) && moodOk(b)), ui.tbrSort);
    const el = $('#tbr-list');
    if (!all.length) {
      el.innerHTML = `<div class="empty"><div class="big">🔖</div><h3>Nothing on deck</h3><p>Add books you want to read next. Tap the circle when you finish one!</p><button class="btn primary" data-add="tbr">Add to TBR</button></div>`;
      return;
    }
    if (!list.length) { el.innerHTML = `<div class="empty"><div class="big">🔎</div><p>No books match.</p></div>`; return; }
    const filtered = list.length !== all.length;
    let html = `<p class="hint" style="margin:0 2px 2px">${filtered ? `${list.length} of ${all.length} books` : `${all.length} book${all.length === 1 ? '' : 's'} waiting`} · tap ◯ when you finish one</p>`;
    const top = list.filter((b) => b.priority);
    const rest = list.filter((b) => !b.priority);
    if (top.length) html += `<h2 class="group-head top">⭐ Top of the list <small>${top.length}</small></h2>` + top.map(tbrCard).join('');
    if (top.length && rest.length && ui.tbrSort !== 'title') html += `<h2 class="group-head">Everything else</h2>`;
    if (ui.tbrSort === 'title') {
      let cur;
      for (const b of rest) {
        const L = (sortTitle(b.title)[0] || '#').toUpperCase();
        const letter = /[A-Z]/.test(L) ? L : '#';
        if (letter !== cur) { cur = letter; html += `<h2 class="group-head">${letter}</h2>`; }
        html += tbrCard(b);
      }
    } else html += rest.map(tbrCard).join('');
    el.innerHTML = html;
  }

  // ---------- STATS view ----------
  function renderStats() {
    const books = readBooks();
    const years = [...new Set(books.map(bookYear).filter(Boolean))].sort((a, b) => b - a);
    if (ui.statsYear === null) ui.statsYear = years.includes(thisYear()) ? thisYear() : 'all';
    if (ui.statsYear !== 'all' && !years.includes(ui.statsYear) && ui.statsYear !== thisYear()) ui.statsYear = 'all';
    const chipYears = [...new Set([thisYear(), ...years])].sort((a, b) => b - a);
    $('#stats-years').innerHTML = [`<button class="chip" role="tab" aria-selected="${ui.statsYear === 'all'}" data-year="all">All time</button>`]
      .concat(chipYears.map((y) => `<button class="chip" role="tab" aria-selected="${ui.statsYear === y}" data-year="${y}">${y}</button>`)).join('');

    const sel = ui.statsYear === 'all' ? books : books.filter((b) => bookYear(b) === ui.statsYear);
    const body = $('#stats-body');
    if (!books.length) {
      body.innerHTML = `<div class="empty"><div class="big">📊</div><h3>Stats appear as you read</h3><p>Log your first book to start your dashboard.</p><button class="btn primary" data-add="read">Log a book</button></div>`;
      return;
    }

    const pages = sel.reduce((s, b) => s + (b.format === 'listen' ? 0 : num(b.pages)), 0);
    const allPages = sel.reduce((s, b) => s + num(b.pages), 0);
    const mins = sel.reduce((s, b) => s + minutesFor(b), 0);
    const listens = sel.filter((b) => b.format === 'listen').length;
    const reads = sel.length - listens;
    const rated = sel.filter((b) => b.rating);
    const avgRating = rated.length ? (rated.reduce((s, b) => s + b.rating, 0) / rated.length) : 0;
    const hours = mins / 60;

    let html = `<div class="tiles">
      <div class="tile"><div class="k">Books</div><div class="v" data-count="${sel.length}">${sel.length}</div><div class="s">${reads} read · ${listens} listened</div></div>
      <div class="tile"><div class="k">Pages</div><div class="v" data-count="${allPages}">${fmt(allPages)}</div><div class="s">${fmt(pages)} read with eyes</div></div>
      <div class="tile"><div class="k">Time</div><div class="v">${hours >= 10 ? fmt(hours) : hours.toFixed(1)}h</div><div class="s">≈ ${(hours / 24).toFixed(1)} days, est.</div></div>
      <div class="tile"><div class="k">Avg rating</div><div class="v">${avgRating ? avgRating.toFixed(1) : '–'}</div><div class="s">${avgRating ? `<span class="stars">${starStr(Math.round(avgRating))}</span>` : 'Rate books to see'}</div></div>
    </div>`;

    if (sel.length) html += `<button type="button" class="wrapped-btn" id="wrapped-btn">🎁 ${ui.statsYear === 'all' ? 'My reading, wrapped' : `My ${ui.statsYear}, wrapped`}<span>Watch your story →</span></button>`;

    if (ui.statsYear !== 'all' && state.settings.goal) {
      const g = state.settings.goal, pct = Math.min(100, Math.round((sel.length / g) * 100));
      const left = Math.max(0, g - sel.length);
      html += `<div class="panel"><div class="goal"><div class="ring" style="--p:${pct}"><div>${pct}%</div></div>
        <div><strong>${sel.length} of ${g} books</strong><p>${left ? `${left} to go in ${ui.statsYear}` : 'Goal complete! 🎯'}</p></div></div></div>`;
    }

    if (sel.length) {
      const rp = Math.round((reads / sel.length) * 100);
      html += `<div class="panel"><h3>Reading vs. listening</h3>
        <div class="split"><div class="a" style="width:${rp}%"></div><div class="b" style="width:${100 - rp}%"></div></div>
        <div class="legend"><span><i style="background:var(--accent)"></i>📖 ${reads} read</span><span><i style="background:var(--green)"></i>🎧 ${listens} listened</span></div></div>`;
    }

    // Bars: months for a year, years for all time
    let bars;
    if (ui.statsYear === 'all') {
      const ys = years.slice(0, 10).reverse();
      bars = ys.map((y) => ({ l: String(y).slice(2).padStart(3, "'"), n: books.filter((b) => bookYear(b) === y).length }));
      html += `<div class="panel"><h3>Books per year</h3>`;
    } else {
      bars = Array.from({ length: 12 }, (_, m) => ({ l: monthName(m)[0], n: sel.filter((b) => b.dateFinished && +b.dateFinished.slice(5, 7) === m + 1).length }));
      html += `<div class="panel"><h3>Books per month</h3>`;
    }
    const max = Math.max(1, ...bars.map((b) => b.n));
    const undated = ui.statsYear !== 'all' ? sel.filter((b) => !b.dateFinished).length : 0;
    if (ui.statsYear !== 'all' && !bars.some((b) => b.n)) html += `<p class="hint">Add a “finished on” date to books to see your months. ${undated} book${undated === 1 ? ' has' : 's have'} only a year.</p></div>`;
    else html += `${undated ? `<p class="hint" style="margin:-6px 0 10px">${undated} book${undated === 1 ? '' : 's'} without a date aren’t shown.</p>` : ''}<div class="bars">${bars.map((b) => `<div class="bar"><span class="n">${b.n || ''}</span><div class="col ${b.n ? '' : 'zero'}" style="height:${(b.n / max) * 100}%"></div><span class="l">${b.l}</span></div>`).join('')}</div></div>`;

    // Fun facts
    if (sel.length) {
      const withPages = sel.filter((b) => num(b.pages));
      const longest = withPages.sort((a, b) => num(b.pages) - num(a.pages))[0];
      const authors = {};
      sel.forEach((b) => { if (b.author) authors[b.author] = (authors[b.author] || 0) + 1; });
      const topAuthor = Object.entries(authors).sort((a, b) => b[1] - a[1])[0];
      const fav = rated.sort((a, b) => b.rating - a.rating || (b.addedAt || 0) - (a.addedAt || 0))[0];
      const avgPages = withPages.length ? allPages / withPages.length : 0;
      const facts = [];
      if (longest) facts.push(['🧱', `Longest: <b>${esc(longest.title)}</b> (${fmt(longest.pages)} pp)`]);
      if (topAuthor && topAuthor[1] > 1) facts.push(['✍️', `Most-read author: <b>${esc(topAuthor[0])}</b> (${topAuthor[1]} books)`]);
      if (fav && fav.rating >= 4) facts.push(['💖', `A favorite: <b>${esc(fav.title)}</b> ${starStr(fav.rating)}`]);
      if (avgPages) facts.push(['📏', `Average length: <b>${fmt(avgPages)}</b> pages`]);
      if (allPages) facts.push(['🗼', `Stacked up, that's about <b>${(allPages * 0.1 / 100).toFixed(1)} m</b> of paper`]);
      if (allPages >= 1225) facts.push(['📜', `That's <b>War and Peace ${(allPages / 1225).toFixed(1)}×</b> over`]);
      if (hours >= 40) facts.push(['💼', `Like <b>${(hours / 40).toFixed(1)} full work weeks</b> of nothing but books`]);
      if (allPages >= 500) {
        // ~1 g per printed page (paperback)
        const lbs = allPages / 453.6, kg = allPages / 1000;
        const things = [[10, 'a house cat 🐈'], [20, 'a Thanksgiving turkey 🦃'], [35, 'a car tire 🛞'], [70, 'a golden retriever 🐕'], [130, 'a kangaroo 🦘'], [250, 'a giant panda 🐼'], [600, 'a grand piano 🎹'], [1e9, 'a small car 🚗']];
        const like = things.reduce((best, t) => Math.abs(Math.log(lbs / t[0])) < Math.abs(Math.log(lbs / best[0])) ? t : best)[1];
        facts.push(['⚖️', `Printed out, that's about <b>${fmt(lbs)} lbs</b> (${fmt(kg)} kg) of books — roughly ${like}`]);
      }
      if (facts.length) html += `<div class="panel"><h3>Fun facts</h3><ul class="facts">${facts.map(([e, t]) => `<li><span>${e}</span><span>${t}</span></li>`).join('')}</ul></div>`;
    }

    html += moreStats(sel);

    // Year in covers: every cover, sorted into a rainbow
    if (sel.length) {
      const uniq = groupReads(sel).filter((g) => coverSrc(g));
      const missing = uniq.some((g) => !(coverSrc(g) in colorCache));
      if (missing) ensureColors(uniq, () => { if (ui.tab === 'stats') renderStats(); });
      const sorted = byColor(uniq);
      const strip = sorted.filter((g) => colorCache[coverSrc(g)]).map((g) => { const c = colorCache[coverSrc(g)]; return `hsl(${c.h} ${Math.round(c.s * 80)}% 50%)`; });
      html += `<div class="panel"><h3>${ui.statsYear === 'all' ? 'Your books' : ui.statsYear} in covers 🎨</h3>
        ${strip.length > 2 ? `<div class="color-strip" style="background:linear-gradient(90deg, ${strip.join(', ')})"></div>` : ''}
        <div class="mosaic">${sorted.map((g) => `<button class="card-main" data-edit="${g.id}" aria-label="${esc(g.title)}">${coverHTML(g)}</button>`).join('')}</div>
        ${missing ? '<p class="hint" style="margin-top:8px">Sorting by color…</p>' : ''}</div>`;
    }

    // Badges (always all-time)
    const earned = new Set(earnedBadges());
    html += `<div class="panel"><h3>Badges · ${earned.size}/${BADGES.length}</h3><div class="badges">${BADGES.map((b) =>
      `<div class="badge ${earned.has(b.id) ? '' : 'locked'}" title="${esc(b.d)}"><div class="e">${b.e}</div><div class="t">${b.t}</div><div class="d">${b.d}</div></div>`).join('')}</div></div>`;

    body.innerHTML = html;
    countUp(body);
    $('#wrapped-btn')?.addEventListener('click', () => openStories(sel));
  }

  // ---------- More stats (no extra input needed) ----------
  const workKey = (b) => norm(b.title) + '|' + lastName(b.author);
  function miniCovers(list, n = 3) {
    return `<div class="mini-stack">${list.slice(0, n).map((b) => coverHTML(b)).join('')}</div>`;
  }
  function seriesProgress() {
    const map = {};
    for (const b of readBooks()) {
      if (!b.series) continue;
      const m = (map[b.series] ||= { name: b.series, author: b.author, nums: new Set(), total: 0, books: [] });
      m.nums.add(b.seriesNo || workKey(b));
      m.total = Math.max(m.total, +b.seriesTotal || 0);
      if (!m.books.some((x) => workKey(x) === workKey(b))) m.books.push(b);
    }
    return Object.values(map).map((m) => {
      const done = m.nums.size, total = Math.max(m.total, done);
      m.books.sort((a, b) => (a.seriesNo || 0) - (b.seriesNo || 0));
      return { ...m, done, total, complete: m.total && done >= m.total };
    }).sort((a, b) => (b.complete - a.complete) || (b.done / b.total - a.done / a.total) || b.done - a.done);
  }
  function seriesUpNext() {
    const tbr = tbrBooks();
    return seriesProgress().filter((x) => !x.complete && x.total > x.done).map((x) => {
      const nums = new Set([...x.nums].filter((n) => typeof n === 'number'));
      let next = 1;
      while (nums.has(next)) next++;
      if (next > x.total) return null;
      const onTbr = tbr.find((b) => b.series === x.name && +b.seriesNo === next);
      return { ...x, next, onTbr };
    }).filter(Boolean);
  }
  function addUpNext(name) {
    const u = seriesUpNext().find((x) => x.name === name);
    if (!u) return;
    openBookDialog(null, 'tbr', { series: u.name, seriesNo: u.next, seriesTotal: u.total, author: u.author || '', query: u.author || u.name });
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-upnext]');
    if (!b) return;
    if (!$('#celebrate').hidden) closeCelebrate();
    addUpNext(b.dataset.upnext);
  });
  function moreStats(sel) {
    let html = '';

    // Series tracker (all time)
    const series = seriesProgress();
    if (series.length) {
      const finished = series.filter((x) => x.complete).length;
      const rows = series.map((x) => `<li class="series-row">
          ${miniCovers(x.books, 1)}
          <div class="series-info">
            <div class="series-top"><b>${esc(x.name)}</b><span>${x.complete ? '✓ ' : ''}${x.done}/${x.total}</span></div>
            <div class="progress"><i style="width:${Math.round((x.done / x.total) * 100)}%" class="${x.complete ? 'done' : ''}"></i></div>
            <small>${esc(x.author || '')}</small>
          </div></li>`);
      const shown = rows.slice(0, 6).join(''), rest = rows.slice(6).join('');
      html += `<div class="panel"><h3>Series tracker <small class="h3-sub">${finished} finished · ${series.length - finished} in progress</small></h3>
        <ul class="series-list">${shown}</ul>
        ${rest ? `<details class="more-list"><summary>Show all ${series.length} series</summary><ul class="series-list">${rest}</ul></details>` : ''}</div>`;
    }

    // Most-read authors with read/listen split
    if (sel.length) {
      const byAuthor = {};
      for (const b of sel) { if (!b.author) continue; (byAuthor[b.author] ||= []).push(b); }
      const top = Object.entries(byAuthor).sort((a, b) => b[1].length - a[1].length).slice(0, 5);
      if (top.length) {
        html += `<div class="panel"><h3>Most-read authors</h3><ol class="author-list">${top.map(([name, list], i) => {
          const l = list.filter((b) => b.format === 'listen').length, r = list.length - l;
          const unique = [...new Map(list.map((b) => [workKey(b), b])).values()];
          const lean = l > r ? '🎧 mostly listened' : r > l ? '📖 mostly read' : '📖🎧 half and half';
          return `<li><span class="rank">${i + 1}</span>${miniCovers(unique)}<div class="author-info"><b>${esc(name)}</b>
            <small>${list.length} book${list.length === 1 ? '' : 's'} · ${lean}</small>
            <div class="split thin"><div class="a" style="width:${(r / list.length) * 100}%"></div><div class="b" style="width:${(l / list.length) * 100}%"></div></div></div></li>`;
        }).join('')}</ol></div>`;
      }
    }

    // Re-read corner
    const groups = {};
    for (const b of sel) (groups[workKey(b)] ||= []).push(b);
    const again = Object.values(groups).filter((g) => g.length > 1).sort((a, b) => b.length - a.length);
    if (again.length) {
      html += `<div class="panel"><h3>Re-read corner 🔁</h3><p class="hint" style="margin:-6px 0 10px">Books you came back to — reading and listening both count.</p>
        <div class="reread-grid">${again.slice(0, 8).map((g) => {
          const l = g.filter((b) => b.format === 'listen').length, r = g.length - l;
          return `<button class="reread card-main" data-edit="${g[0].id}">${coverHTML(g[0])}<span class="times">×${g.length}</span><small>${esc(g[0].title)}</small><small class="muted">${r ? `📖${r}` : ''} ${l ? `🎧${l}` : ''}</small></button>`;
        }).join('')}</div></div>`;
    }

    // Page-count personality
    const withPages = sel.filter((b) => num(b.pages));
    if (withPages.length >= 3) {
      const buckets = [['Quick reads', '< 300', (p) => p < 300, '🍃'], ['Standard', '300–449', (p) => p >= 300 && p < 450, '📘'],
        ['Hefty', '450–599', (p) => p >= 450 && p < 600, '📚'], ['Doorstoppers', '600+', (p) => p >= 600, '🧱']];
      const counts = buckets.map(([, , f]) => withPages.filter((b) => f(num(b.pages))).length);
      const maxC = Math.max(...counts), top = buckets[counts.indexOf(maxC)];
      const persona = { 'Quick reads': 'Sprinter 🏃', Standard: 'Steady page-turner 📘', Hefty: 'Hefty-book lover 💪', Doorstoppers: 'Brick collector 🧱' }[top[0]];
      html += `<div class="panel"><h3>Page-count personality</h3><p class="persona">You're a <b>${persona}</b></p>
        <div class="hbars">${buckets.map(([name, range, , e], i) => `<div class="hbar"><span class="hl">${e} ${name}<small>${range}</small></span>
          <span class="htrack"><i style="width:${(counts[i] / maxC) * 100}%"></i></span><span class="hn">${counts[i]}</span></div>`).join('')}</div></div>`;
    }

    // TBR health + conversion
    const tbr = tbrBooks();
    if (tbr.length) {
      const tbrPages = tbr.reduce((sum, b) => sum + num(b.pages), 0);
      const known = tbr.filter((b) => num(b.pages)).length;
      const estPages = known ? tbrPages / known * tbr.length : 0;
      const y = thisYear(), weeks = Math.max(1, (Date.now() - new Date(y, 0, 1)) / (7 * 864e5));
      const pace = readBooks().filter((b) => bookYear(b) === y).length / weeks;
      const weeksLeft = pace ? tbr.length / pace : 0;
      const starred = tbr.filter((b) => b.priority).length;
      const converted = readBooks().filter((b) => b.fromTbr).length;
      const when = weeksLeft ? (weeksLeft < 9 ? `${Math.ceil(weeksLeft)} weeks` : `${(weeksLeft / 4.35).toFixed(1)} months`) : '–';
      html += `<div class="panel"><h3>TBR health 🔖</h3><div class="tiles small">
          <div class="tile"><div class="k">Waiting</div><div class="v">${tbr.length}</div><div class="s">⭐ ${starred} top of the list</div></div>
          <div class="tile"><div class="k">Pile size</div><div class="v">${estPages ? `~${fmt(estPages / 1000)}k` : '–'}</div><div class="s">pages, est.</div></div>
          <div class="tile"><div class="k">To clear it</div><div class="v">${when}</div><div class="s">at ${pace ? pace.toFixed(1) : 0} books/week</div></div>
          <div class="tile"><div class="k">Checked off</div><div class="v">${converted}</div><div class="s">TBR → read</div></div>
        </div></div>`;
    }

    // Spice meter
    const spiced = sel.filter((b) => b.spice);
    if (sel.length) {
      if (spiced.length) {
        const avg = spiced.reduce((n, b) => n + b.spice, 0) / spiced.length;
        const dist = [1, 2, 3, 4, 5].map((n) => spiced.filter((b) => b.spice === n).length);
        const maxD = Math.max(1, ...dist);
        const byA = {};
        spiced.forEach((b) => { if (b.author) (byA[b.author] ||= []).push(b.spice); });
        const hot = Object.entries(byA).filter(([, v]) => v.length >= 2).map(([a, v]) => [a, v.reduce((x, y) => x + y, 0) / v.length]).sort((a, b) => b[1] - a[1])[0];
        const vibe = avg >= 4 ? 'Scorching 🔥' : avg >= 3 ? 'Steamy ♨️' : avg >= 2 ? 'Warm ☀️' : 'Sweet 🍯';
        html += `<div class="panel"><h3>Spice meter 🌶️</h3>
          <div class="spice-head"><div class="spice-avg">${avg.toFixed(1)}<small>/5</small></div><div><b>${vibe}</b><p class="hint" style="margin:2px 0 0">${spiced.length} of ${sel.length} books rated${hot ? ` · spiciest author: ${esc(hot[0])}` : ''}</p></div></div>
          <div class="hbars">${dist.map((n, i) => `<div class="hbar"><span class="hl">${'🌶️'.repeat(i + 1)}</span><span class="htrack hot"><i style="width:${(n / maxD) * 100}%"></i></span><span class="hn">${n}</span></div>`).join('')}</div></div>`;
      } else {
        html += `<div class="panel"><h3>Spice meter 🌶️</h3><p class="hint">Tap a book and give it 🌶️ peppers (0–5) to see your spice stats.</p></div>`;
      }
    }

    // Favorite tropes
    const tagCount = {};
    sel.forEach((b) => (b.tags || []).forEach((tg) => (tagCount[tg] = (tagCount[tg] || 0) + 1)));
    const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (sel.length) {
      if (topTags.length) {
        const maxT = topTags[0][1];
        const tagged = sel.filter((b) => b.tags?.length).length;
        html += `<div class="panel"><h3>Favorite tropes 💘</h3><p class="hint" style="margin:-6px 0 10px">From ${tagged} tagged book${tagged === 1 ? '' : 's'}</p>
          <div class="hbars">${topTags.map(([tg, n]) => `<div class="hbar"><span class="hl">${esc(tg)}</span><span class="htrack love"><i style="width:${(n / maxT) * 100}%"></i></span><span class="hn">${n}</span></div>`).join('')}</div></div>`;
      } else {
        html += `<div class="panel"><h3>Favorite tropes 💘</h3><p class="hint">Tag tropes like “Fae” or “Enemies to lovers” when you edit a book, and your favorites show up here.</p></div>`;
      }
    }

    // Biggest sagas: series by total pages (each book counted once)
    const sagas = seriesProgress().map((x) => ({ ...x, pages: x.books.reduce((n, b) => n + num(b.pages), 0) })).filter((x) => x.pages).sort((a, b) => b.pages - a.pages).slice(0, 5);
    if (sagas.length) {
      const maxP = sagas[0].pages;
      html += `<div class="panel"><h3>Biggest sagas 🏔️</h3><p class="hint" style="margin:-6px 0 10px">Your longest series by total pages</p>
        <div class="hbars wide-n">${sagas.map((x) => `<div class="hbar"><span class="hl">${esc(x.name)}<small>${x.done}/${x.total} books${x.complete ? ' ✓' : ''}</small></span><span class="htrack"><i style="width:${(x.pages / maxP) * 100}%"></i></span><span class="hn">${fmt(x.pages)}</span></div>`).join('')}</div></div>`;
    }

    // Pages per author (every read & listen counts, like your totals)
    const pa = {};
    sel.forEach((b) => { if (b.author && num(b.pages)) pa[b.author] = (pa[b.author] || 0) + num(b.pages); });
    const topPa = Object.entries(pa).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (topPa.length) {
      const maxA = topPa[0][1];
      html += `<div class="panel"><h3>Pages per author ✍️</h3>
        <div class="hbars wide-n">${topPa.map(([name, p]) => `<div class="hbar"><span class="hl">${esc(name)}</span><span class="htrack love"><i style="width:${(p / maxA) * 100}%"></i></span><span class="hn">${fmt(p)}</span></div>`).join('')}</div></div>`;
    }

    // Recommendation scoreboard
    const recs = {};
    for (const b of state.books) {
      const m = /recommended by\s+([^\n,.;]+)/i.exec(b.notes || '');
      if (!m) continue;
      const who = m[1].trim();
      const r = (recs[who] ||= { read: 0, total: 0 });
      r.total++; if (b.status === 'read') r.read++;
    }
    const recRows = Object.entries(recs).sort((a, b) => b[1].total - a[1].total);
    if (recRows.length) {
      html += `<div class="panel"><h3>Recommendation scoreboard 🌀</h3><ul class="rec-list">${recRows.map(([who, r]) =>
        `<li><span class="rec-who">${esc(who)}</span><span class="htrack"><i style="width:${(r.read / r.total) * 100}%"></i></span><span class="hn">${r.read}/${r.total}</span></li>`).join('')}</ul>
        <p class="hint" style="margin-top:8px">Read / recommended. Tap “🌀 Recommended by…” books in your TBR to see who's waiting on you 😉</p></div>`;
    }
    return html;
  }

  function readerArchetype(sel) {
    const n = sel.length || 1, uniq = groupReads(sel).length;
    const seriesShare = sel.filter((b) => b.series).length / n;
    const listenShare = sel.filter((b) => b.format === 'listen').length / n;
    const brickShare = sel.filter((b) => num(b.pages) >= 600).length / n;
    const rereads = sel.length - uniq, rereadShare = rereads / n;
    const noun = seriesShare >= 0.6 ? 'Saga Devourer' : brickShare >= 0.4 ? 'Brick Collector' : listenShare >= 0.5 ? 'Audio Adventurer' : 'Story Wanderer';
    const adj = rereadShare >= 0.1 ? 'Loyal' : listenShare >= 0.2 && listenShare < 0.5 ? 'Ears-and-Eyes' : brickShare >= 0.3 ? 'Fearless' : 'Curious';
    const lines = [`${Math.round(seriesShare * 100)}% of your reads were part of a series`];
    if (listenShare) lines.push(`${Math.round(listenShare * 100)}% you listened to`);
    if (rereads) lines.push(`you went back to ${rereads} favorite${rereads === 1 ? '' : 's'}`);
    if (brickShare) lines.push(`${Math.round(brickShare * 100)}% were 600+ page bricks`);
    return { title: `The ${adj} ${noun}`, lines };
  }
  function wrappedData(sel) {
    const listens = sel.filter((b) => b.format === 'listen').length;
    const pages = sel.reduce((n, b) => n + num(b.pages), 0);
    const hours = sel.reduce((n, b) => n + minutesFor(b), 0) / 60;
    const byAuthor = {};
    sel.forEach((b) => { if (b.author) (byAuthor[b.author] ||= []).push(b); });
    const [topAuthor, topList] = Object.entries(byAuthor).sort((x, y) => y[1].length - x[1].length)[0] || [];
    const authorPages = (topList || []).reduce((n, b) => n + num(b.pages), 0);
    const saga = seriesProgress().map((x) => ({ ...x, pages: x.books.reduce((n, b) => n + num(b.pages), 0) })).sort((x, y) => y.pages - x.pages)[0];
    const finished = seriesProgress().filter((x) => x.complete).length;
    const lbs = pages / 453.6;
    const covers = byColor(groupReads(sel).filter((g) => coverSrc(g)));
    return { n: sel.length, listens, reads: sel.length - listens, pages, hours, topAuthor, topList: topList || [], authorPages, saga, finished, lbs, covers, arch: readerArchetype(sel),
      label: ui.statsYear === 'all' ? 'All time' : String(ui.statsYear) };
  }

  // ---------- Wrapped stories ----------
  let storyIdx = 0, storyTimer = null, storySel = [];
  const STORY_MS = 6500;
  function openStories(sel) {
    storySel = sel;
    const d = wrappedData(sel);
    ensureColors(d.covers.map((g) => g), () => { if (!$('#stories').hidden) buildStories(); });
    buildStories();
    $('#stories').hidden = false;
    document.body.classList.add('no-scroll');
    haptic();
    goStory(0);
  }
  const FLOAT_SPOTS = [[-4, 6, -12], [56, 3, 9], [76, 24, 14], [-6, 66, -8], [68, 70, 10], [30, 84, -5], [84, 88, 6]];
  function buildStories() {
    const d = wrappedData(storySel);
    const fan = (list) => `<div class="st-fan">${list.slice(0, 3).map((b, i) => `<div class="st-fan-item" style="--k:${i}">${coverHTML(b)}</div>`).join('')}</div>`;
    const rp = d.n ? Math.round((d.reads / d.n) * 100) : 0;
    const cards = [
      `<section class="st-card st-intro">
        <div class="st-floaters">${d.covers.slice(0, 7).map((b, i) => { const [l, tp, r] = FLOAT_SPOTS[i]; return `<div class="st-float" style="--k:${i};left:${l}%;top:${tp}%;--r:${r}deg">${coverHTML(b)}</div>`; }).join('')}</div>
        <p class="st-kicker">Booklog Wrapped</p>
        <h2 class="st-huge">Your<br>${esc(d.label === 'All time' ? 'reading' : d.label)}<br><em>in books</em></h2>
        <p class="st-hint">Tap to begin →</p></section>`,
      `<section class="st-card st-count">
        <p class="st-kicker">You finished</p>
        <div class="st-mega" data-count="${d.n}">${d.n}</div>
        <p class="st-big">books</p>
        <div class="st-pills"><span>📖 ${d.reads} read</span><span>🎧 ${d.listens} listened</span></div></section>`,
      `<section class="st-card st-pages">
        <p class="st-kicker">That's</p>
        <div class="st-mega sm" data-count="${d.pages}">${fmt(d.pages)}</div>
        <p class="st-big">pages</p>
        <div class="st-stack">
          <div><b data-count="${Math.round(d.hours)}">${fmt(d.hours)}</b><span>hours of story</span></div>
          <div><b data-count="${Math.round(d.lbs)}" data-suffix=" lbs">${fmt(d.lbs)} lbs</b><span>of paper, if printed</span></div>
        </div></section>`,
      d.topAuthor ? `<section class="st-card st-author">
        <p class="st-kicker">You couldn't put down</p>
        <h2 class="st-name">${esc(d.topAuthor)}</h2>
        ${fan(groupReads(d.topList))}
        <p class="st-sub"><b>${d.topList.length}</b> books · <b>${fmt(d.authorPages)}</b> pages</p></section>` : '',
      d.saga && d.saga.pages ? `<section class="st-card st-saga">
        <p class="st-kicker">Your biggest saga</p>
        <h2 class="st-name">${esc(d.saga.name)}</h2>
        <div class="st-mountain"><span style="--h:${Math.min(100, 30 + d.saga.done * 9)}%"></span></div>
        <p class="st-sub"><b>${fmt(d.saga.pages)}</b> pages · ${d.saga.complete ? 'all' : d.saga.done} of ${d.saga.total} books${d.saga.complete ? ' ✓' : ''}</p>
        <p class="st-sub small">${d.finished} series finished in total</p></section>` : '',
      `<section class="st-card st-format">
        <p class="st-kicker">Eyes or ears?</p>
        <div class="st-donut" style="--rp:${rp}"><div><b>${rp}%</b><span>read</span></div></div>
        <p class="st-sub">📖 ${d.reads} on the page · 🎧 ${d.listens} by ear</p></section>`,
      d.covers.length ? `<section class="st-card st-colors">
        <p class="st-kicker">Your year in color</p>
        <div class="st-mosaic">${d.covers.map((b) => coverHTML(b)).join('')}</div></section>` : '',
      `<section class="st-card st-arch">
        <p class="st-kicker">Your reader type</p>
        <h2 class="st-name">${esc(d.arch.title)}</h2>
        <ul class="st-lines">${d.arch.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`,
      `<section class="st-card st-end">
        <p class="st-kicker">That's a wrap</p>
        <h2 class="st-huge sm">${d.n} books.<br><em>${esc(d.arch.title.replace(/^The /, ''))}.</em></h2>
        <div class="st-actions">
          <button type="button" class="btn primary big" id="st-share">✨ Make my share card</button>
          <button type="button" class="btn ghost" id="st-replay">↺ Watch again</button>
        </div></section>`,
    ].filter(Boolean);
    $('#st-track').innerHTML = cards.join('');
    $('#st-bars').innerHTML = cards.map(() => '<i><b></b></i>').join('');
    $('#st-share').addEventListener('click', (e) => { e.stopPropagation(); makePoster(storySel); });
    $('#st-replay').addEventListener('click', (e) => { e.stopPropagation(); goStory(0); });
    goStory(Math.min(storyIdx, cards.length - 1), true);
  }
  function goStory(i, silent = false) {
    const cards = $$('#st-track .st-card'), bars = $$('#st-bars i');
    if (i < 0) i = 0;
    if (i >= cards.length) { closeStories(); return; }
    storyIdx = i;
    cards.forEach((c, k) => c.classList.toggle('active', k === i));
    bars.forEach((b, k) => { b.className = k < i ? 'done' : k === i ? 'now' : ''; });
    if (!silent) { countUp(cards[i]); haptic(); }
    clearTimeout(storyTimer);
    if (i < cards.length - 1) storyTimer = setTimeout(() => goStory(storyIdx + 1), STORY_MS);
  }
  function closeStories() {
    clearTimeout(storyTimer);
    $('#stories').hidden = true;
    document.body.classList.remove('no-scroll');
  }
  $('#stories').addEventListener('click', (e) => {
    if (e.target.closest('#st-close')) { closeStories(); return; }
    if (e.target.closest('button')) return;
    const x = e.clientX / innerWidth;
    goStory(storyIdx + (x < 0.3 ? -1 : 1));
  });
  document.addEventListener('keydown', (e) => {
    if ($('#stories').hidden) return;
    if (e.key === 'Escape') closeStories();
    if (e.key === 'ArrowRight') goStory(storyIdx + 1);
    if (e.key === 'ArrowLeft') goStory(storyIdx - 1);
  });

  // ---------- Wrapped: a shareable summary image ----------
  let wrappedBlob = null;
  const loadImg = (url) => new Promise((res) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => res(img); img.onerror = () => res(null);
    img.src = url + (url.includes('?') ? '&' : '?') + 'bl-color=1';
  });
  async function makePoster(sel) {
    const d = wrappedData(sel);
    const W = 1080, H = 1920, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    try { await document.fonts.load('700 80px Fraunces'); await document.fonts.load('italic 500 80px Fraunces'); } catch (_) {}
    const serif = 'Fraunces, Georgia, serif', sans = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    // Mesh-gradient background tinted by your covers
    x.fillStyle = '#120c09'; x.fillRect(0, 0, W, H);
    const hues = d.covers.map((b) => colorCache[coverSrc(b)]?.h).filter((h) => h !== undefined);
    const pick = (k, fb) => hues.length ? hues[Math.floor((k / 4) * hues.length)] : fb;
    [[200, 300, 700, pick(0, 12)], [900, 700, 650, pick(1, 280)], [300, 1300, 750, pick(2, 40)], [950, 1650, 600, pick(3, 330)]].forEach(([cx, cy, r, h]) => {
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `hsla(${h}, 75%, 50%, .55)`); g.addColorStop(1, 'hsla(0,0%,0%,0)');
      x.fillStyle = g; x.fillRect(0, 0, W, H);
    });
    // grain
    const grain = x.getImageData(0, 0, W, H), gd = grain.data;
    for (let i = 0; i < gd.length; i += 4) { const n = (Math.random() - 0.5) * 18; gd[i] += n; gd[i + 1] += n; gd[i + 2] += n; }
    x.putImageData(grain, 0, 0);

    x.fillStyle = '#fff';
    x.font = `700 34px ${sans}`; x.globalAlpha = 0.75;
    x.fillText(`BOOKLOG  ·  ${d.label.toUpperCase()} WRAPPED`, 80, 140); x.globalAlpha = 1;

    x.font = `700 400px ${serif}`; x.fillText(String(d.n), 64, 520);
    x.font = `italic 500 96px ${serif}`; x.fillText('books finished', 80, 640);

    // pills
    let px = 80;
    for (const t of [`📖 ${d.reads} read`, `🎧 ${d.listens} listened`]) {
      x.font = `600 40px ${sans}`;
      const w = x.measureText(t).width + 56;
      x.fillStyle = 'rgba(255,255,255,.14)'; x.beginPath(); x.roundRect(px, 690, w, 76, 38); x.fill();
      x.fillStyle = '#fff'; x.fillText(t, px + 28, 742); px += w + 18;
    }

    // stat boxes (2 x 3)
    const boxes = [['Pages', fmt(d.pages)], ['Hours', `~${fmt(d.hours)}`], ['Weight', `${fmt(d.lbs)} lbs`],
      ['Series done', String(d.finished)], ['Top author', d.topAuthor || '–'], ['Biggest saga', d.saga?.name || '–']];
    boxes.forEach(([k, v], i) => {
      const bx = 80 + (i % 2) * 470, by = 830 + Math.floor(i / 2) * 190;
      x.fillStyle = 'rgba(255,255,255,.10)'; x.beginPath(); x.roundRect(bx, by, 450, 170, 28); x.fill();
      x.fillStyle = 'rgba(255,255,255,.7)'; x.font = `600 30px ${sans}`; x.fillText(k.toUpperCase(), bx + 32, by + 56);
      x.fillStyle = '#fff';
      let fs = 60; x.font = `700 ${fs}px ${serif}`;
      while (x.measureText(v).width > 390 && fs > 32) { fs -= 2; x.font = `700 ${fs}px ${serif}`; } // shrink to fit first
      let t = v; while (x.measureText(t).width > 390 && t.length > 3) t = t.slice(0, -2);
      x.fillText(t === v ? t : t + '…', bx + 32, by + 128);
    });

    // reader type
    x.fillStyle = 'rgba(255,255,255,.7)'; x.font = `600 30px ${sans}`; x.fillText('READER TYPE', 80, 1450);
    x.fillStyle = '#fff'; x.font = `italic 600 64px ${serif}`;
    let at = d.arch.title; while (x.measureText(at).width > W - 160) at = at.slice(0, -2);
    x.fillText(at, 80, 1530);

    // cover strip
    const strip = d.covers.slice(0, 7);
    const imgs = await Promise.all(strip.map((b) => loadImg(coverSrc(b))));
    const cw = 128, ch = 192;
    imgs.forEach((img, i) => {
      const cx = 80 + i * (cw + 14), cy = 1600 + (i % 2) * 14;
      x.save(); x.translate(cx + cw / 2, cy + ch / 2); x.rotate((i % 2 ? 1 : -1) * 0.03);
      x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 24; x.shadowOffsetY = 10;
      if (img) x.drawImage(img, -cw / 2, -ch / 2, cw, ch);
      else { x.fillStyle = PALETTE[i % PALETTE.length]; x.fillRect(-cw / 2, -ch / 2, cw, ch); }
      x.restore();
    });

    c.toBlob((blob) => {
      wrappedBlob = blob;
      $('#wrapped-img').src = URL.createObjectURL(blob);
      $('#wrapped-title').textContent = 'Your share card ✨';
      const canShare = navigator.canShare && navigator.canShare({ files: [new File([blob], 'x.png', { type: 'image/png' })] });
      $('#wrapped-share').hidden = !canShare;
      $('#wrapped-dialog').showModal();
    }, 'image/png');
  }
  $('#wrapped-save').addEventListener('click', () => {
    if (!wrappedBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(wrappedBlob); a.download = `booklog-wrapped-${ui.statsYear}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  });
  $('#wrapped-share').addEventListener('click', async () => {
    if (!wrappedBlob) return;
    try { await navigator.share({ files: [new File([wrappedBlob], `booklog-wrapped-${ui.statsYear}.png`, { type: 'image/png' })], title: 'My reading, wrapped' }); } catch (_) {}
  });

  $('#stats-years').addEventListener('click', (e) => {
    const c = e.target.closest('[data-year]'); if (!c) return;
    ui.statsYear = c.dataset.year === 'all' ? 'all' : +c.dataset.year; saveUi(); renderStats();
  });

  function render() {
    if (ui.tab === 'read') { renderRead(); stagger($('#read-list')); }
    else if (ui.tab === 'tbr') { renderTbr(); stagger($('#tbr-list')); }
    else renderStats();
    if (!$('#shelf-view').hidden) renderShelf();
  }

  // ---------- Global click delegation ----------
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-edit],[data-finish],[data-buy],[data-star],[data-add],[data-close]');
    if (!t) return;
    if (t.dataset.edit) openBookDialog(state.books.find((b) => b.id === t.dataset.edit));
    else if (t.dataset.finish) openFinish(t.dataset.finish, t);
    else if (t.dataset.star) toggleStar(t.dataset.star);
    else if (t.dataset.buy) { openBuy.has(t.dataset.buy) ? openBuy.delete(t.dataset.buy) : openBuy.add(t.dataset.buy); renderTbr(); }
    else if (t.dataset.add) openBookDialog(null, t.dataset.add);
    else if ('close' in t.dataset) t.closest('dialog')?.close();
  });
  // One-tap ⭐: pin a TBR book to the top of the list (tap again to unpin).
  function toggleStar(id) {
    const b = state.books.find((x) => x.id === id);
    if (!b) return;
    b.priority = !b.priority;
    save();
    renderTbr();
    haptic(b.priority ? 'success' : 'light');
    const btn = $(`[data-star="${id}"]`);
    if (btn && b.priority) {
      btn.classList.add('pop');
      btn.closest('.card')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      sparkle(btn);
    }
    toast(b.priority ? `⭐ “${b.title}” is top of the list!` : `Unpinned “${b.title}”`);
  }
  function sparkle(el) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = el.getBoundingClientRect();
    for (let i = 0; i < 8; i++) {
      const s = document.createElement('span');
      s.className = 'sparkle';
      s.textContent = i % 2 ? '✦' : '★';
      const a = (i / 8) * Math.PI * 2;
      s.style.left = `${r.left + r.width / 2}px`;
      s.style.top = `${r.top + r.height / 2}px`;
      s.style.setProperty('--dx', `${Math.cos(a) * 34}px`);
      s.style.setProperty('--dy', `${Math.sin(a) * 34}px`);
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 700);
    }
  }

  // Tap on the dim backdrop closes a sheet.
  $$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

  // ---------- Add / edit dialog ----------
  const bookDlg = $('#book-dialog');
  const form = $('#book-form');
  const F = form.elements;
  const fStatus = $('#f-status'), fFormat = $('#f-format'), fRating = $('#f-rating'), fSpice = $('#f-spice'), fTags = $('#f-tags');
  makeStars(fRating);
  makeStars(fSpice, '🌶️', 'pepper');
  makeTagPicker(fTags);
  let editing = null; // book being edited, or null for new
  let picked = {};    // data from lookup (cover id, isbn)

  function syncFormVisibility() {
    const isRead = segValue(fStatus) === 'read';
    $('#read-fields').hidden = !isRead;
    $('#priority-field').hidden = isRead;
    $('#audio-field').hidden = !(isRead && segValue(fFormat) === 'listen');
    $('#save-book').textContent = editing ? 'Done' : isRead ? 'Add to Read 🎉' : 'Add to TBR';
  }
  bindSeg(fStatus, syncFormVisibility);
  bindSeg(fFormat, syncFormVisibility);

  function updateCoverPreview() {
    const b = { title: F.title.value || 'Title', coverUrl: F.coverUrl.value.trim(), isbn: F.isbn.value.trim() };
    $('#cover-preview').innerHTML = coverHTML(b);
  }
  ['title', 'coverUrl', 'isbn'].forEach((n) => F[n].addEventListener('change', updateCoverPreview));

  function renderSiblings(book) {
    const box = $('#f-siblings');
    const logs = book && book.status === 'read' ? readBooks().filter((x) => workKey(x) === workKey(book)).sort(newestFirst) : [];
    if (logs.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = `<div class="field-label">You've logged this ${logs.length} times</div><div class="sib-list">${logs.map((x, i) => {
      const when = x.dateFinished ? fmtDate(x.dateFinished) : (x.year || 'Year unknown');
      return `<button type="button" class="sib${x.id === book.id ? ' current' : ''}" data-sib="${x.id}">${x.format === 'listen' ? '🎧 Listened' : '📖 Read'} · ${esc(String(when))}${x.notes === 'Re-read' ? ' · re-read' : ''}</button>`;
    }).join('')}</div><p class="hint" style="margin-top:6px">Tap one to edit it. To log another read or listen, tap + and add the book again.</p>`;
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sib]');
    if (!b || b.classList.contains('current')) return;
    const target = state.books.find((x) => x.id === b.dataset.sib);
    if (!target) return;
    bookDlg.close();
    setTimeout(() => openBookDialog(target), 120);
  });
  function openBookDialog(book, presetStatus, prefill = null) {
    editing = book || null;
    picked = {};
    form.reset();
    $('#lookup-results').innerHTML = '';
    $('#lookup').hidden = !!book;
    $('#book-dialog-title').textContent = book ? 'Edit book' : 'Add a book';
    $('#delete-book').hidden = !book;
    const b = book || { status: presetStatus || (ui.tab === 'tbr' ? 'tbr' : 'read'), format: 'read' };
    setSeg(fStatus, b.status);
    setSeg(fFormat, b.format || 'read');
    F.title.value = b.title || '';
    F.author.value = b.author || '';
    F.pages.value = b.pages || '';
    F.dateFinished.value = b.dateFinished || (book ? '' : today());
    F.year.value = !b.dateFinished && b.year ? b.year : '';
    F.audioH.value = b.audioMinutes ? Math.floor(b.audioMinutes / 60) : '';
    F.audioM.value = b.audioMinutes ? b.audioMinutes % 60 : '';
    F.notes.value = b.notes || '';
    F.priority.checked = !!b.priority;
    F.coverUrl.value = b.coverUrl || '';
    F.isbn.value = b.isbn || '';
    F.series.value = b.series || '';
    F.seriesNo.value = b.seriesNo || '';
    F.seriesTotal.value = b.seriesTotal || '';
    if (prefill) {
      if (prefill.author) F.author.value = prefill.author;
      if (prefill.series) { F.series.value = prefill.series; F.seriesNo.value = prefill.seriesNo || ''; F.seriesTotal.value = prefill.seriesTotal || ''; }
      if (prefill.query) { $('#lookup-q').value = prefill.query; setTimeout(() => lookup(prefill.query), 50); }
    }

    fRating.set(b.rating || 0);
    fSpice.set(b.spice || 0);
    fTags.set(b.tags);
    syncFormVisibility();
    updateCoverPreview();
    editStart = book ? { status: book.status, badges: earnedBadges() } : null;
    renderSiblings(book);
    clearTimeout(autosaveTimer); autosaveTimer = null;
    autosaveEl.hidden = !book;
    if (book) setAutosave('idle');
    $('#book-cancel').hidden = !!book;
    bookDlg.showModal();
    // Focus search on desktop only (on phones the keyboard popping up is jarring).
    if (!book && window.matchMedia('(hover: hover)').matches) setTimeout(() => $('#lookup-q').focus(), 50);
  }
  $('#add-btn').addEventListener('click', () => openBookDialog(null));

  function collectData() {
    const title = F.title.value.trim();
    if (!title) return null;
    const status = segValue(fStatus);
    const audioMinutes = Math.round(num(F.audioH.value) * 60 + num(F.audioM.value));
    const date = F.dateFinished.value;
    const data = {
      title,
      author: F.author.value.trim(),
      status,
      pages: Math.round(num(F.pages.value)) || '',
      notes: F.notes.value.trim(),
      coverUrl: F.coverUrl.value.trim(),
      isbn: F.isbn.value.trim(),
      series: F.series.value.trim(),
      seriesNo: num(F.seriesNo.value) || '',
      seriesTotal: Math.round(num(F.seriesTotal.value)) || '',
      priority: status === 'tbr' && F.priority.checked,
      spice: fSpice.value || 0,
      tags: [...fTags.value],
    };
    if (status === 'read') {
      Object.assign(data, {
        format: segValue(fFormat),
        dateFinished: date,
        year: date ? +date.slice(0, 4) : (+F.year.value || ''),
        rating: fRating.value || 0,
        audioMinutes: segValue(fFormat) === 'listen' ? audioMinutes : 0,
      });
    }
    return data;
  }

  // Autosave: when editing an existing book, every change saves on its own.
  let autosaveTimer = null, editStart = null;
  const autosaveEl = $('#autosave-status');
  function setAutosave(st) {
    autosaveEl.dataset.state = st;
    autosaveEl.textContent = { idle: 'Changes save automatically', saving: 'Saving…', saved: '✓ Saved', notitle: '⚠️ Add a title to save' }[st];
  }
  function autosaveNow() {
    clearTimeout(autosaveTimer); autosaveTimer = null;
    if (!editing) return;
    const data = collectData();
    if (!data) { setAutosave('notitle'); return; }
    Object.assign(editing, data);
    if (editStart && editStart.status === 'tbr' && data.status === 'read') { editing.fromTbr = true; editing.finishedAt ||= Date.now(); }
    save();
    setAutosave('saved');
  }
  function scheduleAutosave() {
    if (!editing) return;
    setAutosave('saving');
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(autosaveNow, 500);
  }
  form.addEventListener('input', scheduleAutosave);
  form.addEventListener('change', scheduleAutosave);
  // Taps on toggles, stars, peppers and trope chips don't fire input events
  form.addEventListener('click', (e) => { if (e.target.closest('[data-value],[data-n],[data-tag]')) scheduleAutosave(); });

  bookDlg.addEventListener('close', () => {
    if (!editing) return;
    if (autosaveTimer) autosaveNow();
    const book = editing, start = editStart;
    editing = null; editStart = null;
    if (!book.coverUrl && !book.isbn) autoCover(book);
    if (start && start.status === 'tbr' && book.status === 'read') {
      finishWithFlair(book, newBadges(start.badges));
      if (ui.tab !== 'read') setTab('read'); else render();
    } else render();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (editing) { bookDlg.close(); return; } // "Done": changes are already saved
    const data = collectData();
    if (!data) { F.title.focus(); toast('Add a title first'); return; }
    const before = earnedBadges();
    const book = { id: uid(), addedAt: Date.now(), ...data, ...(data.status === 'read' ? { finishedAt: Date.now() } : {}) };
    state.books.push(book);
    save();
    bookDlg.close();
    if (!book.coverUrl && !book.isbn) autoCover(book);
    if (data.status === 'read') {
      celebrate(book, newBadges(before));
      if (ui.tab !== 'read') setTab('read'); else render();
    } else {
      render();
      toast(`Added “${book.title}” to your TBR 🔖`);
    }
  });

  $('#delete-book').addEventListener('click', () => {
    if (!editing) return;
    const book = editing, idx = state.books.indexOf(book);
    clearTimeout(autosaveTimer); autosaveTimer = null;
    editing = null; editStart = null;
    state.books.splice(idx, 1);
    save(); bookDlg.close(); render();
    toast(`Deleted “${book.title}”`, 'Undo', () => { state.books.splice(idx, 0, book); save(); render(); });
  });

  // ---------- Book lookup (Open Library — free, no key needed) ----------
  let lookupTimer, lookupCtrl;
  $('#lookup-q').addEventListener('input', (e) => {
    clearTimeout(lookupTimer);
    const q = e.target.value.trim();
    if (q.length < 3) { $('#lookup-results').innerHTML = ''; return; }
    lookupTimer = setTimeout(() => lookup(q), 350);
  });
  $('#lookup-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(lookupTimer); lookup(e.target.value.trim()); } });

  async function lookup(q) {
    if (!q) return;
    const out = $('#lookup-results');
    out.innerHTML = `<div class="lookup-status">Searching…</div>`;
    lookupCtrl?.abort();
    lookupCtrl = new AbortController();
    const isIsbn = /^[\d\-xX ]{10,17}$/.test(q);
    const params = new URLSearchParams({ [isIsbn ? 'isbn' : 'q']: q.replace(/[- ]/g, isIsbn ? '' : ' '), limit: '8', fields: 'key,title,author_name,first_publish_year,number_of_pages_median,cover_i,isbn' });
    try {
      const signal = lookupCtrl.signal;
      const [olDocs, appleDocs] = await Promise.all([
        fetch(`https://openlibrary.org/search.json?${params}`, { signal }).then((r) => r.json()).then((j) => j.docs || []).catch((e) => { if (e.name === 'AbortError') throw e; return []; }),
        isIsbn ? [] : fetch(`https://itunes.apple.com/search?${new URLSearchParams({ term: q, media: 'ebook', limit: '10', country: 'us' })}`, { signal })
          .then((r) => r.json()).then((j) => (j.results || []).map((r) => ({ title: r.trackName, author_name: [r.artistName], first_publish_year: (r.releaseDate || '').slice(0, 4), coverUrl: (r.artworkUrl100 || '').replace('100x100bb', '600x600bb') })))
          .catch((e) => { if (e.name === 'AbortError') throw e; return []; }),
      ]);
      // Open Library first (it knows page counts), then Apple titles it didn't have
      const seenTitles = new Set(olDocs.map((d) => norm(d.title)));
      const docs = [...olDocs.slice(0, 6), ...appleDocs.filter((d) => d.title && !seenTitles.has(norm(d.title)))].slice(0, 10);
      if (!docs.length) { out.innerHTML = `<div class="lookup-status">No matches — just type the details below.</div>`; return; }
      out.innerHTML = docs.map((d, i) => {
        const fake = { title: d.title, coverUrl: d.coverUrl || (d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-S.jpg` : '') };
        return `<button type="button" class="result" data-i="${i}">${coverHTML(fake)}<div><strong>${esc(d.title)}</strong><span>${esc((d.author_name || []).slice(0, 2).join(', '))}${d.first_publish_year ? ' · ' + d.first_publish_year : ''}${d.number_of_pages_median ? ' · ' + d.number_of_pages_median + ' pp' : ''}</span></div></button>`;
      }).join('');
      $$('.result', out).forEach((btn) => btn.addEventListener('click', () => fillFromLookup(docs[+btn.dataset.i])));
    } catch (err) {
      if (err.name === 'AbortError') return;
      out.innerHTML = `<div class="lookup-status">Couldn't search right now (offline?). You can type the details below.</div>`;
    }
  }
  // ---------- Cover finder ----------
  // Tries several free sources in turn and only accepts a result whose title (and author, if known) line up.
  const norm = (t) => (t || '').toLowerCase().replace(/^(the|a|an)\s+/, '').replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  const lastName = (a) => norm((a || '').split(/,|&| and /)[0].trim().split(/\s+/).pop());
  const coverCache = {};
  function cleanTitle(t) {
    return (t || '')
      .replace(/ — Book \d+$/, '')
      .replace(/\s*\(.*?\)\s*/g, ' ')
      .replace(/\s*[—-]\s*book \d+.*$/i, '')
      .replace(/\b(series|trilogy|saga|duology|books)$/i, '')
      .split(' / ')[0]
      .trim();
  }
  function titleMatches(found, wanted, hasAuthor) {
    const a = norm(found), b = norm(wanted);
    if (!a || !b) return false;
    if (a === b) return true;
    // "Title: A Novel" / "Title (Series #1)" style subtitles
    if (a.startsWith(b) && b.length >= 6) return true;
    // Looser match only when an author confirms it
    return hasAuthor && (a.startsWith(b.slice(0, 10)) || b.startsWith(a.slice(0, 10)));
  }
  function authorMatches(foundAuthors, wanted) {
    if (!wanted) return true;
    const ln = lastName(wanted);
    return [].concat(foundAuthors || []).some((x) => norm(x).includes(ln));
  }
  async function cached(key, fn) {
    if (key in coverCache) return coverCache[key];
    try { coverCache[key] = await fn(); } catch (_) { coverCache[key] = null; }
    return coverCache[key];
  }
  const sources = {
    openLibrary: (q, author) => cached(`ol|${q}|${author}`, async () => {
      const params = new URLSearchParams({ title: q, limit: '8', fields: 'title,author_name,number_of_pages_median,cover_i' });
      if (author) params.set('author', author);
      const docs = (await (await fetch(`https://openlibrary.org/search.json?${params}`)).json()).docs || [];
      return docs.map((d) => ({ title: d.title, authors: d.author_name, pages: d.number_of_pages_median, cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '' }));
    }),
    apple: (q, author, media) => cached(`ap|${media}|${q}|${author}`, async () => {
      const params = new URLSearchParams({ term: `${q} ${author || ''}`.trim(), media, limit: '15', country: 'us' });
      const res = (await (await fetch(`https://itunes.apple.com/search?${params}`)).json()).results || [];
      return res.map((r) => ({ title: (r.trackName || r.collectionName || '').replace(/\s*\(Unabridged\)\s*$/i, ''), authors: [r.artistName], cover: (r.artworkUrl100 || '').replace('100x100bb', '600x600bb') }));
    }),
    google: (q, author) => cached(`g|${q}|${author}`, async () => {
      const query = `intitle:${q}` + (author ? ` inauthor:${author}` : '');
      const items = (await (await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=8&printType=books`)).json()).items || [];
      return items.map(({ volumeInfo: v }) => ({ title: v.title, authors: v.authors, pages: v.pageCount, cover: (v.imageLinks?.thumbnail || '').replace(/^http:/, 'https:').replace('&edge=curl', '') }));
    }),
  };
  async function findCover(title, author) {
    const q = cleanTitle(title);
    if (!q) return null;
    const pick = (list) => (list || []).find((r) => r.cover && titleMatches(r.title, q, !!author) && authorMatches(r.authors, author));
    let pages = 0;
    const ol = await sources.openLibrary(q, author);
    const olHit = pick(ol);
    pages = (olHit || (ol || []).find((r) => titleMatches(r.title, q, !!author) && authorMatches(r.authors, author)))?.pages || 0;
    if (olHit) return { ...olHit, pages };
    for (const media of ['ebook', 'audiobook']) {
      const hit = pick(await sources.apple(q, author, media));
      if (hit) return { ...hit, pages };
    }
    const g = pick(await sources.google(q, author));
    return g ? { ...g, pages: pages || g.pages } : null;
  }
  async function autoCover(book, doRender = true) {
    if (/ — Book \d+$/.test(book.title)) return false; // unknown title: don't guess a cover
    try {
      const hit = await findCover(book.title, book.author);
      if (!hit) return false;
      let changed = false;
      if (hit.cover && !book.coverUrl) { book.coverUrl = hit.cover; changed = true; }
      if (hit.pages && !book.pages) { book.pages = hit.pages; changed = true; }
      if (!book.author && hit.authors?.[0]) { book.author = hit.authors[0]; changed = true; }
      if (changed) { save(); if (doRender) render(); }
      return changed;
    } catch (_) { return false; /* offline — placeholder stays */ }
  }

  // After an import, look up covers one at a time (gentle on the free API).
  let filling = false;
  async function fillMissingCovers() {
    if (filling) return;
    filling = true;
    const todo = state.books.filter((b) => !b.coverUrl && !b.isbn && !b.coverTried && !b.noAutoCover);
    let found = 0;
    for (let i = 0; i < todo.length; i++) {
      if (await autoCover(todo[i], false)) found++;
      todo[i].coverTried = true;
      if (i % 8 === 7) { save(); render(); }
      await new Promise((r) => setTimeout(r, 250));
    }
    save(); render();
    filling = false;
    if (todo.length) toast(`Found details for ${found} of ${todo.length} books 🖼️`);
  }

  function fillFromLookup(d) {
    F.title.value = d.title || '';
    F.author.value = (d.author_name || []).slice(0, 2).join(', ');
    F.pages.value = d.number_of_pages_median || '';
    F.coverUrl.value = d.coverUrl || (d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '');
    const isbns = d.isbn || [];
    F.isbn.value = isbns.find((x) => x.length === 13 && x.startsWith('978')) || isbns[0] || '';
    $('#lookup-results').innerHTML = '';
    $('#lookup-q').value = '';
    updateCoverPreview();
    syncFormVisibility();
    $('#save-book').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    haptic();
  }

  // ---------- Finish a TBR ----------
  const finDlg = $('#finish-dialog'), finForm = $('#finish-form'), finFormat = $('#fin-format'), finRating = $('#fin-rating'), finSpice = $('#fin-spice');
  makeStars(finRating);
  makeStars(finSpice, '🌶️', 'pepper');
  let finishing = null, finishBtn = null;
  bindSeg(finFormat, () => ($('#fin-audio').hidden = segValue(finFormat) !== 'listen'));
  function openFinish(id, btn) {
    finishing = state.books.find((b) => b.id === id);
    if (!finishing) return;
    finishBtn = btn;
    btn.classList.add('done');
    haptic();
    finForm.reset();
    finForm.dateFinished.value = today();
    setSeg(finFormat, 'read');
    $('#fin-audio').hidden = true;
    finRating.set(0);
    finSpice.set(finishing.spice || 0);
    $('#finish-book').innerHTML = `<b>${esc(finishing.title)}</b>${finishing.author ? ' · ' + esc(finishing.author) : ''}`;
    setTimeout(() => finDlg.showModal(), 180); // let the check animate first
  }
  finDlg.addEventListener('close', () => { if (finishing && finishBtn) finishBtn.classList.remove('done'); });
  finForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const b = finishing; if (!b) return;
    const before = earnedBadges();
    const date = finForm.dateFinished.value || today();
    Object.assign(b, {
      status: 'read', fromTbr: true, finishedAt: Date.now(),
      format: segValue(finFormat),
      dateFinished: date, year: +date.slice(0, 4),
      rating: finRating.value || 0,
      spice: finSpice.value || finishing.spice || 0,
      audioMinutes: segValue(finFormat) === 'listen' ? Math.round(num(finForm.audioH.value) * 60 + num(finForm.audioM.value)) : 0,
    });
    save();
    const badgesNow = newBadges(before);
    const leaving = document.querySelector(`[data-finish="${b.id}"]`)?.closest('.tbr-item');
    finishing = null;
    finDlg.close();
    openBuy.delete(b.id);
    if (leaving) leaving.classList.add('leaving');
    setTimeout(() => { render(); finishWithFlair(b, badgesNow); }, leaving ? 330 : 0);
  });

  // ---------- Pick my next read ----------
  const pickDlg = $('#pick-dialog');
  function openPick() {
    const moody = ui.tab === 'tbr' && ui.tbrMood ? $$('#tbr-list [data-star]').map((el) => state.books.find((b) => b.id === el.dataset.star)).filter(Boolean) : [];
    const list = moody.length ? moody : tbrBooks();
    if (!list.length) { toast('Add some books to your TBR first 🔖'); setTab('tbr'); return; }
    pickDlg.open || pickDlg.showModal();
    spin(list);
  }
  function spin(list) {
    const stage = $('#pick-stage');
    $('#pick-links').innerHTML = '';
    stage.classList.add('spinning');
    let i = 0, delay = 60;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const final = list[Math.floor(Math.random() * list.length)];
    const show = (b) => { stage.innerHTML = `${coverHTML(b)}<h3>${esc(b.title)}</h3><p>${esc(b.author || '')}</p>`; };
    const step = () => {
      if (reduce || delay > 320) {
        stage.classList.remove('spinning');
        show(final);
        $('#pick-links').innerHTML = buyLinks(final);
        haptic('success');
        return;
      }
      show(list[i++ % list.length]);
      delay *= 1.18;
      setTimeout(step, delay);
    };
    step();
  }
  $('#random-btn').addEventListener('click', openPick);
  $('#pick-again').addEventListener('click', () => { pickDlg.close(); openPick(); });

  // ---------- Finishing flair: card shrinks away, pages flip, cover closes, then confetti ----------
  function bookCloseAnim(book) {
    return new Promise((resolve) => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return resolve();
      const o = document.createElement('div');
      o.className = 'book-anim';
      o.innerHTML = `<div class="ba-book"><div class="ba-pages"></div><div class="ba-page p1"></div><div class="ba-page p2"></div><div class="ba-page p3"></div><div class="ba-cover">${coverHTML(book)}</div></div><p class="ba-label">The end.</p>`;
      document.body.appendChild(o);
      setTimeout(() => haptic(), 180); setTimeout(() => haptic(), 330); setTimeout(() => haptic(), 480);
      setTimeout(() => haptic('heavy'), 900); // the thud
      setTimeout(() => o.classList.add('out'), 1250);
      setTimeout(() => { o.remove(); resolve(); }, 1500);
    });
  }
  function finishWithFlair(book, badges) {
    bookCloseAnim(book).then(() => celebrate(book, badges));
  }
  const THEMES = {
    embers: { label: '🔥 Dragon fire', test: /dragon|wing|flame|fire|ember|burn|ash\b|blaze|spark|brimstone|smoke|onyx/ },
    bubbles: { label: '🫧 Sea spray', test: /\bsea\b|tide|ocean|water|mermaid|siren|wave|thunder/ },
    stars: { label: '✨ Starlight', test: /night|star|moon|shadow|dark|dusk|midnight|stardust|eclipse|raven/ },
    petals: { label: '🌸 Fae petals', test: /\bfae\b|court|rose|thorn|bloom|flower|petal|garden|briar|fairy|wild|crystal/ },
  };
  function celebrationTheme(b) {
    const text = `${b.title} ${b.series || ''} ${(b.tags || []).join(' ')}`.toLowerCase();
    for (const [k, t] of Object.entries(THEMES)) if (t.test.test(text)) return k;
    return 'confetti';
  }

  // ---------- Milestones ----------
  const MILESTONES = [
    ['logs', [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500], (n) => `${n} books logged!`, '📚'],
    ['pages', [5000, 10000, 25000, 50000, 75000, 100000, 150000, 200000], (n) => `${fmt(n)} pages read!`, '📄'],
    ['series', [1, 5, 10, 15, 20, 25, 30, 40, 50], (n) => `${n} series finished!`, '✅'],
    ['authors', [10, 25, 50, 75, 100], (n) => `${n} different authors!`, '✍️'],
    ['hours', [100, 250, 500, 750, 1000, 1500, 2000], (n) => `${fmt(n)} hours of stories!`, '⏳'],
  ];
  function milestoneMetrics() {
    const r = readBooks();
    return { logs: r.length, pages: r.reduce((n, b) => n + num(b.pages), 0), series: seriesProgress().filter((x) => x.complete).length,
      authors: new Set(r.map((b) => b.author).filter(Boolean)).size, hours: r.reduce((n, b) => n + minutesFor(b), 0) / 60 };
  }
  function reachedMilestones() {
    const m = milestoneMetrics(), out = [];
    for (const [k, steps, label, e] of MILESTONES) for (const n of steps) if (m[k] >= n) out.push({ id: `${k}-${n}`, text: label(n), e });
    return out;
  }
  function initMilestones() {
    // Don't throw a parade for milestones you'd already passed before this feature existed
    if (!state.settings.milestonesSeen) { state.settings.milestonesSeen = reachedMilestones().map((x) => x.id); save(true); }
  }
  function newMilestones() {
    const seen = new Set(state.settings.milestonesSeen || []);
    const fresh = reachedMilestones().filter((x) => !seen.has(x.id));
    if (fresh.length) { state.settings.milestonesSeen = [...seen, ...fresh.map((x) => x.id)]; save(true); }
    return fresh;
  }

  // ---------- Celebration ----------
  const CHEERS = [
    ['Another one for the shelf!', 'Look at you go 📚'],
    ['Book finished!', 'That deserves a snack.'],
    ['The end! 🎬', 'On to the next adventure.'],
    ['Nailed it!', 'Your future self says thanks.'],
    ['Page-turner energy ⚡', 'Keep that streak alive.'],
    ['Chapter closed ✨', 'What’s next on the pile?'],
  ];
  function newBadges(before) {
    const set = new Set(before);
    return BADGES.filter((b) => earnedBadges().includes(b.id) && !set.has(b.id));
  }
  function celebrate(book, badges = []) {
    const el = $('#celebrate');
    const count = readBooks().length;
    const yearCount = readBooks().filter((b) => bookYear(b) === thisYear()).length;
    const [title, sub] = CHEERS[Math.floor(Math.random() * CHEERS.length)];
    $('#celebrate-cover').innerHTML = coverHTML(book);
    $('#celebrate-title').textContent = title;
    const goal = state.settings.goal;
    let line = `That's book #${count} on your shelf.`;
    if (bookYear(book) === thisYear()) {
      line = goal && yearCount === goal ? `You hit your ${thisYear()} goal of ${goal}! 🎯` : `Book #${yearCount} of ${thisYear()}${goal && yearCount < goal ? ` — ${goal - yearCount} to go` : ''}.`;
    }
    $('#celebrate-sub').textContent = `${line} ${sub}`;
    const ms = newMilestones();
    const card = $('.celebrate-card');
    card.classList.toggle('milestone', ms.length > 0);
    if (ms.length) {
      const top = ms[ms.length - 1];
      $('#celebrate-title').textContent = `🏆 ${top.text}`;
      $('#celebrate-sub').textContent = `Milestone unlocked with “${book.title}”. ${sub}`;
    }
    $('#celebrate-badges').innerHTML = ms.map((m) => `<span class="ms-chip">${m.e} ${esc(m.text)}</span>`).join('') + badges.map((b) => `<span>${b.e} ${esc(b.t)} unlocked!</span>`).join('');
    const u = book.series ? seriesUpNext().find((x) => x.name === book.series && !x.onTbr) : null;
    $('#celebrate-next').innerHTML = u ? `<button type="button" class="btn" data-upnext="${esc(u.name)}">⏭️ Add book ${u.next} of ${esc(u.name)} to TBR</button>` : '';
    el.hidden = false;
    haptic('success');
    const theme = celebrationTheme(book);
    $('#celebrate-theme').textContent = THEMES[theme]?.label || '';
    confetti(ms.length ? 340 : badges.length ? 260 : 170, ms.length ? 'confetti' : theme);
    applyCoverTheme();
    $('#celebrate-close').focus({ preventScroll: true });
  }
  function closeCelebrate() { $('#celebrate').hidden = true; stopConfetti(); }
  $('#celebrate-close').addEventListener('click', closeCelebrate);
  $('#celebrate').addEventListener('click', (e) => { if (e.target.id === 'celebrate' || e.target.id === 'confetti') closeCelebrate(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#celebrate').hidden) closeCelebrate(); });

  // Hand-rolled confetti: no libraries needed.
  let confettiRaf = 0;
  function confetti(n, theme = 'confetti') {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = $('#confetti'), ctx = c.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = (c.width = innerWidth * dpr), H = (c.height = innerHeight * dpr);
    const R = Math.random;
    const make = {
      confetti: (i) => {
        const fromLeft = i % 2 === 0;
        const colors = ['#c4553a', '#e0a526', '#2f6f62', '#5b4a8a', '#3b6ea5', '#f28cb1', '#ffffff'];
        return { x: fromLeft ? 0 : W, y: H * 0.7, vx: (fromLeft ? 1 : -1) * (6 + R() * 10) * dpr, vy: -(14 + R() * 14) * dpr, g: 0.45,
          s: (5 + R() * 6) * dpr, r: R() * Math.PI, vr: (R() - 0.5) * 0.3, c: colors[i % colors.length], shape: ['rect', 'rect', 'circle', '📖'][i % 4] };
      },
      embers: (i) => ({ x: R() * W, y: H + R() * H * 0.3, vx: (R() - 0.5) * 1.5 * dpr, vy: -(3 + R() * 6) * dpr, g: -0.02, s: (2 + R() * 4) * dpr,
        c: ['#ffb347', '#ff7a1a', '#ff3d00', '#ffd27a'][i % 4], shape: i % 14 === 0 ? '🔥' : 'glow', flick: R() * 6 }),
      petals: (i) => ({ x: R() * W, y: -R() * H * 0.6, vx: (R() - 0.5) * 1.2 * dpr, vy: (1.5 + R() * 2.5) * dpr, g: 0.01, s: (6 + R() * 7) * dpr,
        r: R() * Math.PI, vr: (R() - 0.5) * 0.08, sway: R() * 6, c: ['#f7a8c4', '#f28cb1', '#ffd1e0', '#e45b8f', '#fff0f5'][i % 5], shape: i % 12 === 0 ? (i % 24 ? '🌸' : '🌹') : 'petal' }),
      stars: (i) => ({ x: R() * W, y: R() * H, vx: (R() - 0.5) * 0.4 * dpr, vy: (R() - 0.5) * 0.4 * dpr, g: 0, s: (4 + R() * 8) * dpr,
        tw: R() * 6, c: ['#ffe9a8', '#ffffff', '#e0a526', '#c9d8ff'][i % 4], shape: i % 15 === 0 ? '✨' : 'star', born: R() * 1200 }),
      bubbles: (i) => ({ x: R() * W, y: H + R() * H * 0.4, vx: 0, vy: -(1.5 + R() * 3) * dpr, g: -0.01, s: (5 + R() * 12) * dpr,
        sway: R() * 6, c: 'rgba(170,220,255,.85)', shape: i % 16 === 0 ? '🫧' : 'bubble' }),
    };
    const gen = make[theme] || make.confetti;
    const parts = Array.from({ length: theme === 'confetti' ? n : Math.round(n * 0.8) }, (_, i) => gen(i));
    const start = performance.now();
    cancelAnimationFrame(confettiRaf);
    const star = (x, y, r) => { ctx.beginPath(); for (let k = 0; k < 8; k++) { const rr = k % 2 ? r * 0.38 : r, a = (k * Math.PI) / 4; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); };
    const tick = (t) => {
      const el = t - start;
      ctx.clearRect(0, 0, W, H);
      let alive = 0;
      for (const p of parts) {
        p.vy += p.g * dpr;
        if (theme === 'confetti') { p.vx *= 0.985; p.vy *= 0.985; }
        p.x += p.vx + (p.sway ? Math.sin(el / 400 + p.sway) * 0.8 * dpr : 0);
        p.y += p.vy;
        if (p.r !== undefined) p.r += p.vr || 0;
        if (p.y > H + 40 || p.y < -H) continue;
        alive++;
        ctx.save();
        if (p.shape.length <= 2) { ctx.font = `${p.s * 2.2}px serif`; ctx.fillText(p.shape, p.x - p.s, p.y + p.s); ctx.restore(); continue; }
        ctx.fillStyle = p.c;
        if (p.shape === 'glow') {
          ctx.globalAlpha = 0.55 + 0.45 * Math.sin(el / 90 + p.flick);
          ctx.shadowColor = p.c; ctx.shadowBlur = 12 * dpr;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2); ctx.fill();
        } else if (p.shape === 'petal') {
          ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.beginPath(); ctx.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, Math.PI * 2); ctx.fill();
        } else if (p.shape === 'star') {
          const life = Math.max(0, el - p.born);
          ctx.globalAlpha = Math.max(0, Math.min(1, life / 300)) * (0.5 + 0.5 * Math.sin(el / 160 + p.tw)) * Math.max(0, 1 - el / 5200);
          ctx.shadowColor = p.c; ctx.shadowBlur = 10 * dpr; star(p.x, p.y, p.s);
          if (el > 5200) alive--;
        } else if (p.shape === 'bubble') {
          ctx.strokeStyle = p.c; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.arc(p.x - p.s * 0.35, p.y - p.s * 0.35, p.s * 0.22, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.translate(p.x, p.y); ctx.rotate(p.r);
          if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, p.s / 2, 0, Math.PI * 2); ctx.fill(); }
          else ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        }
        ctx.restore();
      }
      if (alive > 0 && el < 6500) confettiRaf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, W, H);
    };
    confettiRaf = requestAnimationFrame(tick);
  }
  function stopConfetti() { cancelAnimationFrame(confettiRaf); const c = $('#confetti'); c.getContext('2d').clearRect(0, 0, c.width, c.height); }

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg, actionLabel, action) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ''}`;
    t.hidden = false;
    if (actionLabel) $('button', t).onclick = () => { action(); t.hidden = true; };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), actionLabel ? 6000 : 2600);
  }

  // ---------- Settings, backup, import ----------
  const setDlg = $('#settings-dialog'), setForm = $('#settings-form');
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  function installHint() {
    if (isStandalone()) return "You're using Booklog as an app. Nice! 📱";
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua)) return 'iPhone: tap the Share button (□↑) in Safari → “Add to Home Screen” → Add.';
    if (/Android/.test(ua)) return 'Android: tap ⋮ in Chrome → “Add to Home screen” (or “Install app”).';
    return 'Open this page on your phone, then use “Add to Home Screen” from the browser’s share/menu button.';
  }
  $('#settings-btn').addEventListener('click', () => {
    setForm.goal.value = state.settings.goal;
    setForm.minPerPage.value = state.settings.minPerPage;
    setForm.coverTheme.checked = state.settings.coverTheme !== false;
    $('#install-hint').textContent = installHint();
    setSyncStatus(sync.status || (sync.token ? 'synced' : 'idle'));
    const lb = state.settings.lastBackup;
    $('#last-backup').textContent = lb ? `Last backup: ${new Date(lb).toLocaleDateString()}` : 'No backup yet.';
    setDlg.showModal();
  });
  setForm.addEventListener('submit', (e) => {
    e.preventDefault();
    state.settings.goal = Math.round(num(setForm.goal.value));
    state.settings.minPerPage = num(setForm.minPerPage.value) || 1.5;
    state.settings.coverTheme = setForm.coverTheme.checked;
    applyCoverTheme();
    save(); setDlg.close(); render();
  });
  $('#export-btn').addEventListener('click', () => {
    state.settings.lastBackup = Date.now(); save();
    const blob = new Blob([JSON.stringify({ app: 'booklog', version: 1, exportedAt: new Date().toISOString(), books: state.books, settings: state.settings }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `booklog-backup-${today()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $('#last-backup').textContent = `Last backup: ${new Date().toLocaleDateString()}`;
    toast('Backup saved ✅');
  });
  function importText(text, name = '', opts = {}) {
    try {
      let incoming, isCsv = false;
      if (/\.csv$/i.test(name) || text.startsWith('Book Id')) { incoming = fromGoodreads(text); isCsv = true; }
      else {
        const j = JSON.parse(text);
        incoming = j.books;
        if (j.settings && !opts.quiet) state.settings = { ...state.settings, ...j.settings };
        else if (j.settings && !state.books.length) state.settings = { ...state.settings, ...j.settings, lastBackup: state.settings.lastBackup };
      }
      if (!Array.isArray(incoming)) throw new Error('bad file');
      // Merge: skip duplicates by id or by title+author.
      const key = (b) => `${(b.title || '').toLowerCase()}|${(b.author || '').toLowerCase()}`;
      const ids = new Set(state.books.map((b) => b.id)), keys = new Set(state.books.map(key));
      let added = 0;
      for (const b of incoming) {
        if (!b || !b.title || (isCsv && keys.has(key(b)))) continue;
        let id = b.id || uid();
        if (ids.has(id)) {
          const existing = state.books.find((x) => x.id === id);
          if (existing && key(existing) === key(b) && existing.format === b.format) continue; // same book already here
          id = uid(); // different book that happens to share an id
        }
        const nb = { ...b, id, addedAt: b.addedAt || Date.now() };
        state.books.push(nb); ids.add(nb.id);
        added++;
      }
      save(); if (setDlg.open) setDlg.close(); render();
      const needCovers = state.books.some((b) => !b.coverUrl && !b.coverTried && !b.noAutoCover);
      if (!opts.quiet) toast(`Imported ${added} book${added === 1 ? '' : 's'} 📚${needCovers ? ' Finding covers…' : ''}`);
      if (needCovers) fillMissingCovers();
      return added;
    } catch (err) {
      toast("That file didn't look like a Booklog or Goodreads export.");
      return 0;
    }
  }
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    importText(await file.text(), file.name);
  });

  // ---------- Published library (data/books.json on the website) ----------
  // First visit on any device: load the published books automatically.
  // Later: Settings → "Get latest books" adds anything new from the website.
  const PUBLISHED_URL = 'data/books.json';
  async function fetchPublished() {
    const res = await fetch(PUBLISHED_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('no published library');
    return res.text();
  }
  async function loadPublishedOnFirstVisit() {
    if (state.books.length || state.settings.publishedLoaded) return;
    try {
      const text = await fetchPublished();
      const added = importText(text, 'books.json', { quiet: true });
      state.settings.publishedLoaded = true;
      state.settings.lastBackup = Date.now(); // the website copy counts as a fresh backup
      save();
      if (added) celebrateImport(added);
    } catch (_) { /* offline or no published file: start empty */ }
  }
  $('#sync-btn').addEventListener('click', async () => {
    try {
      const before = state.books.length;
      importText(await fetchPublished(), 'books.json', { quiet: true });
      const added = state.books.length - before;
      toast(added ? `Added ${added} new book${added === 1 ? '' : 's'} from the website 📚` : 'You’re up to date ✅');
    } catch (_) { toast('Couldn’t reach the website — are you offline?'); }
  });
  // ---------- Sync with GitHub (data/books.json in your repo) ----------
  const defaultRepo = () => location.hostname.endsWith('.github.io')
    ? `${location.hostname.split('.')[0]}/${location.pathname.split('/')[1] || ''}`.replace(/\/$/, '')
    : 'shawn-golden/booklog';
  const saveSync = () => { try { localStorage.setItem(SYNC_KEY, JSON.stringify(sync)); } catch (_) {} };
  const b64enc = (str) => { const bytes = new TextEncoder().encode(str); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
  const b64dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
  const DATA_PATH = 'data/books.json';
  function gh(path, opts = {}) {
    return fetch(`https://api.github.com/repos/${sync.repo}/${path}`, {
      cache: 'no-store', ...opts,
      headers: { Authorization: `Bearer ${sync.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    });
  }
  function mergeLibraries(local, remote) {
    const deleted = { ...(remote.deleted || {}) };
    for (const [id, t] of Object.entries(local.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, t);
    const remoteById = new Map((remote.books || []).map((b) => [b.id, b]));
    let localNewer = false, remoteNewer = false;
    const out = [];
    for (const b of local.books) {
      const r = remoteById.get(b.id);
      remoteById.delete(b.id);
      if (!r) { out.push(b); localNewer = true; continue; }
      const lt = b.updatedAt || 0, rt = r.updatedAt || 0;
      if (lt > rt) { out.push(b); localNewer = true; } else { out.push(lt === rt ? { ...r, coverTried: b.coverTried } : r); if (rt > lt) remoteNewer = true; }
    }
    for (const r of remoteById.values()) { out.push(r); remoteNewer = true; }
    const books = out.filter((b) => !(deleted[b.id] && deleted[b.id] >= (b.updatedAt || 0)));
    if (books.length !== out.length) remoteNewer = true;
    const remoteIds = new Set((remote.books || []).map((b) => b.id));
    if (Object.keys(local.deleted || {}).some((id) => remoteIds.has(id) && deleted[id] >= ((remote.books || []).find((b) => b.id === id)?.updatedAt || 0))) localNewer = true;
    return { books, deleted, localNewer, remoteNewer };
  }
  function buildPayload() {
    return {
      app: 'booklog', version: 1, updatedAt: new Date().toISOString(),
      books: state.books.map(({ coverTried, ...b }) => b),
      deleted: state.deleted || {},
      settings: { goal: state.settings.goal, minPerPage: state.settings.minPerPage, hiddenSeries: state.settings.hiddenSeries || [] },
    };
  }
  async function pullAndMerge() {
    const res = await gh(`contents/${DATA_PATH}?ref=main`);
    if (res.status === 401 || res.status === 403) throw new Error('auth');
    if (!res.ok) throw new Error(`GitHub said ${res.status}`);
    const j = await res.json();
    sync.sha = j.sha; saveSync();
    const remote = JSON.parse(b64dec(j.content));
    const m = mergeLibraries({ books: state.books, deleted: state.deleted }, remote);
    // Hidden series: keep the union of what any device hid
    const rh = remote.settings?.hiddenSeries || [], lh = state.settings.hiddenSeries || [];
    const unionHidden = [...new Set([...lh, ...rh])];
    if (unionHidden.length !== lh.length) { state.settings.hiddenSeries = unionHidden; save(true); render(); }
    if (rh.length !== unionHidden.length) m.localNewer = true;
    if (m.remoteNewer) {
      state.books = m.books;
      state.deleted = m.deleted;
      snap();                 // these changes came from the website: don't re-stamp them
      save(true);
      render();
    } else if (Object.keys(m.deleted).length !== Object.keys(state.deleted || {}).length) {
      state.deleted = m.deleted; save(true);
    }
    return m;
  }
  let pushTimer = null, pushing = false, pushAgain = false;
  function schedulePush() {
    if (!sync.token) return;
    if (pushing) { pushAgain = true; return; }
    clearTimeout(pushTimer);
    setSyncStatus('pending');
    pushTimer = setTimeout(pushNow, 2500);
  }
  async function pushNow() {
    clearTimeout(pushTimer); pushTimer = null;
    if (!sync.token || pushing) return;
    pushing = true; pushAgain = false;
    setSyncStatus('syncing');
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!sync.sha) await pullAndMerge();
        const res = await gh(`contents/${DATA_PATH}`, {
          method: 'PUT',
          body: JSON.stringify({ message: 'Update books from the Booklog app', content: b64enc(JSON.stringify(buildPayload(), null, 1)), sha: sync.sha, branch: 'main' }),
        });
        if (res.ok) {
          sync.sha = (await res.json()).content.sha; sync.lastSyncAt = Date.now(); saveSync();
          setSyncStatus('synced'); showSavedPill('☁️ Synced');
          return;
        }
        if (res.status === 409 || res.status === 422) { await pullAndMerge(); continue; } // someone else saved first: merge and retry
        if (res.status === 401 || res.status === 403) throw new Error('auth');
        throw new Error(`GitHub said ${res.status}`);
      }
      throw new Error('kept conflicting — try Sync now');
    } catch (e) {
      setSyncStatus('error', e.message);
      showSavedPill('⚠️ Saved on this device only');
    } finally {
      pushing = false;
      if (pushAgain) schedulePush();
    }
  }
  let lastPull = 0;
  async function syncFromWebsite({ force = false } = {}) {
    if (!sync.token || pushing) return;
    if (!force && Date.now() - lastPull < 30000) return;
    lastPull = Date.now();
    setSyncStatus('syncing');
    try {
      const m = await pullAndMerge();
      if (m.localNewer) await pushNow();
      else { sync.lastSyncAt = Date.now(); saveSync(); setSyncStatus('synced'); }
      return m;
    } catch (e) { setSyncStatus('error', e.message); }
  }
  function ago(t) {
    if (!t) return 'never';
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
  }
  function setSyncStatus(st, msg = '') {
    sync.status = st;
    if (st === 'error') { if (msg) sync.statusMsg = msg; else msg = sync.statusMsg || 'unknown error'; }
    const el = document.getElementById('sync-status');
    if (!el) return;
    el.dataset.state = st;
    el.textContent = st === 'error' ? (msg === 'auth' ? '⚠️ GitHub rejected the token — check it hasn’t expired and has Contents: Read and write.' : `⚠️ Couldn’t sync (${msg}). Your changes are safe on this device.`)
      : !sync.token ? 'Not connected — changes stay on this device.'
      : st === 'syncing' ? '☁️ Syncing with the website…'
      : st === 'pending' ? '☁️ Changes waiting to sync…'
      : `☁️ Connected to ${sync.repo} · last synced ${ago(sync.lastSyncAt)}`;
    $('#sync-connect').hidden = !!sync.token;
    $('#sync-connected').hidden = !sync.token;
    $('#sync-btn').closest('.btn-row').hidden = !!sync.token;
  }
  $('#sync-connect-btn').addEventListener('click', async () => {
    const token = $('#sync-token').value.trim();
    const repo = ($('#sync-repo').value.trim() || defaultRepo()).replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
    if (!token) { toast('Paste your GitHub token first'); return; }
    sync = { token, repo }; saveSync();
    setSyncStatus('syncing');
    try {
      const res = await gh('');
      if (res.status === 401 || res.status === 403 || res.status === 404) throw new Error(res.status === 404 ? 'repo not found — check the name' : 'auth');
      const info = await res.json();
      if (info.permissions && !info.permissions.push) throw new Error('auth');
      $('#sync-token').value = '';
      await syncFromWebsite({ force: true });
      if (sync.status !== 'error') toast('☁️ Connected! Changes now sync to the website.');
    } catch (e) {
      sync = {}; saveSync();
      setSyncStatus('error', e.message);
      toast(e.message === 'auth' ? 'That token didn’t work — check its permissions.' : `Couldn’t connect: ${e.message}`);
    }
  });
  $('#sync-now').addEventListener('click', async () => {
    const m = await syncFromWebsite({ force: true });
    if (sync.status === 'synced') toast(m && m.remoteNewer ? 'Got the latest from your other devices ☁️' : 'All synced ✅');
  });
  $('#sync-disconnect').addEventListener('click', () => {
    if (!confirm('Disconnect this device? Your books stay here, but changes will stop syncing.')) return;
    sync = {}; saveSync(); setSyncStatus('idle'); toast('Disconnected. Changes stay on this device.');
  });
  function startSync() {
    $('#sync-repo').placeholder = defaultRepo();
    setSyncStatus(sync.token ? 'synced' : 'idle');
    if (sync.token) syncFromWebsite({ force: true });
  }

  function celebrateImport(n) {
    confetti(200);
    setTimeout(stopConfetti, 4000);
    toast(`Your library is here — ${n} books 📚`);
  }
  $('#covers-btn').addEventListener('click', () => {
    const missing = state.books.filter((b) => !b.coverUrl && !b.noAutoCover);
    if (!missing.length) { toast('Every book has a cover already 🎉'); return; }
    missing.forEach((b) => delete b.coverTried);
    save(); setDlg.close();
    toast(`Looking for ${missing.length} cover${missing.length === 1 ? '' : 's'}…`);
    fillMissingCovers();
  });
  // Handy for checking covers from the browser console.
  window.booklog = { findCover };
  $('#clear-btn').addEventListener('click', () => {
    if (!confirm('Erase all books on this device? Export a backup first if you want to keep them.')) return;
    if (!confirm('Really erase everything? This cannot be undone.')) return;
    state.books = []; save(); setDlg.close(); render();
  });

  function parseCSV(text) {
    const rows = []; let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') q = false;
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  function fromGoodreads(text) {
    const [head, ...rows] = parseCSV(text);
    const idx = (n) => head.indexOf(n);
    const col = (r, n) => (idx(n) >= 0 ? (r[idx(n)] || '').trim() : '');
    return rows.filter((r) => r.length > 3).map((r) => {
      const shelf = col(r, 'Exclusive Shelf');
      const dr = col(r, 'Date Read').replace(/\//g, '-');
      const isbn = (col(r, 'ISBN13') || col(r, 'ISBN')).replace(/[="]/g, '');
      const binding = col(r, 'Binding').toLowerCase();
      const added = Date.parse(col(r, 'Date Added').replace(/\//g, '-')) || Date.now();
      const status = shelf === 'read' ? 'read' : 'tbr';
      const b = { id: uid(), addedAt: added, title: col(r, 'Title'), author: col(r, 'Author'), status, pages: +col(r, 'Number of Pages') || '', isbn, notes: col(r, 'My Review').replace(/<br\s*\/?>/g, '\n') };
      if (status === 'read') Object.assign(b, {
        format: /audio/.test(binding) ? 'listen' : 'read',
        dateFinished: /^\d{4}-\d{2}-\d{2}$/.test(dr) ? dr : '',
        year: dr ? +dr.slice(0, 4) : '',
        rating: +col(r, 'My Rating') || 0,
        audioMinutes: 0,
      });
      return b;
    });
  }

  // ---------- Backup nudge (once a month if you have books) ----------
  function maybeNudgeBackup() {
    const lb = state.settings.lastBackup;
    if (readBooks().length + tbrBooks().length < 5) return;
    if (lb && Date.now() - lb < 30 * 864e5) return;
    setTimeout(() => toast('Tip: export a backup in Settings 💾', 'Open', () => $('#settings-btn').click()), 1500);
  }

  // ---------- Siri / Shortcuts: open Booklog with ?log=Title (finished it) or ?add=Title (TBR) ----------
  function handleUrlActions() {
    const p = new URLSearchParams(location.search);
    const log = p.get('log'), add = p.get('add');
    if (log === null && add === null) return;
    history.replaceState(null, '', location.pathname);
    const q = (log ?? add).trim();
    if (log !== null && q) {
      const n = norm(q);
      const tbr = tbrBooks();
      const match = tbr.find((b) => norm(b.title) === n) || (n.length >= 4 && tbr.find((b) => norm(b.title).includes(n) || n.includes(norm(b.title))));
      if (match) {
        setTab('tbr');
        openFinish(match.id, document.querySelector(`[data-finish="${match.id}"]`) || document.createElement('span'));
        return;
      }
    }
    openBookDialog(null, log !== null ? 'read' : 'tbr', q ? { query: q } : null);
  }
  $('#siri-copy').addEventListener('click', async () => {
    const link = `${location.origin}${location.pathname}?log=`;
    try { await navigator.clipboard.writeText(link); toast('Link copied — paste it into your Shortcut 📋'); }
    catch (_) { prompt('Copy this link:', link); }
  });

  // ---------- Bookshelf: its own special room ----------
  function openShelf() {
    $('#shelf-view').hidden = false;
    document.body.classList.add('no-scroll');
    renderShelf();
    haptic();
  }
  function closeShelf() {
    $('#shelf-view').classList.add('closing');
    setTimeout(() => { $('#shelf-view').hidden = true; $('#shelf-view').classList.remove('closing'); document.body.classList.remove('no-scroll'); }, 220);
  }
  function shelfBook(g) {
    const lean = hash(g.title) % 9 === 0 ? (hash(g.title) % 2 ? 4 : -4) : 0;
    return `<button type="button" class="shelf-book" data-shelf="${g.id}" style="--lean:${lean}deg" aria-label="${esc(g.title)}">${coverHTML(g)}${g.logs?.length > 1 ? `<span class="sb-times">×${g.logs.length}</span>` : ''}</button>`;
  }
  function renderShelf() {
    const mode = ui.shelfMode || 'series';
    $$('#shelf-modes .chip').forEach((c) => c.setAttribute('aria-selected', String(c.dataset.mode === mode)));
    const books = groupReads(readBooks());
    const prog = new Map(seriesProgress().map((x) => [x.name, x]));
    let groups = [];
    if (mode === 'series') {
      const map = new Map();
      sortBooks(books, 'series').forEach((g) => { const k = g.series || ''; (map.get(k) || map.set(k, []).get(k)).push(g); });
      groups = [...map.entries()].map(([k, list]) => {
        const p = prog.get(k);
        return { name: k || 'Standalones', meta: k ? `${p?.complete ? '✓ ' : ''}${p ? `${p.done}/${p.total}` : ''}` : `${list.length}`, list };
      });
    } else if (mode === 'color') {
      ensureColors(books, () => { if (!$('#shelf-view').hidden) renderShelf(); });
      groups = [{ name: 'A rainbow of reads', meta: '', list: byColor(books) }];
    } else if (mode === 'recent') {
      groups = [{ name: 'Most recent first', meta: '', list: [...books].sort(newestFirst) }];
    } else {
      groups = [{ name: 'A → Z', meta: '', list: sortBooks(books, 'title') }];
    }
    $('#shelf-stats').textContent = `${books.length} books · ${seriesProgress().filter((x) => x.complete).length} series finished`;
    $('#shelf-body').innerHTML = groups.map((gr) => `<div class="shelf-group">
        <div class="plaque"><span>${esc(gr.name)}</span>${gr.meta ? `<small>${gr.meta}</small>` : ''}</div>
        <div class="shelf-row">${gr.list.map(shelfBook).join('')}</div></div>`).join('');
  }
  function showShelfBook(id) {
    const g = groupReads(readBooks()).find((x) => x.id === id || x.logs.some((l) => l.id === id));
    if (!g) return;
    const reads = g.logs.filter((x) => x.format !== 'listen').length, listens = g.logs.length - reads;
    const how = reads && listens ? '📖🎧 Read & listened' : listens ? '🎧 Listened' : '📖 Read';
    const p = g.series ? seriesProgress().find((x) => x.name === g.series) : null;
    $('#shelf-detail').innerHTML = `<div class="sd-cover">${coverHTML(g)}</div>
      <div class="sd-info">
        <h3>${esc(g.title)}</h3>
        ${g.author ? `<p class="sd-by">${esc(g.author)}</p>` : ''}
        ${g.series ? `<p class="sd-series">${esc(g.series)}${g.seriesNo ? ` · Book ${g.seriesNo}` : ''}${p ? ` of ${p.total}` : ''}</p>` : ''}
        <p class="sd-meta">${how}${g.logs.length > 1 ? ` · ×${g.logs.length}` : ''}${g.pages ? ` · ${fmt(g.pages)} pp` : ''}</p>
        ${g.rating ? `<p class="stars">${starStr(g.rating)}</p>` : ''}${g.spice ? `<p class="spice">${spiceStr(g.spice)}</p>` : ''}
        <div class="sd-actions"><button type="button" class="btn primary" data-edit="${g.id}">✏️ Open</button><button type="button" class="btn ghost" id="sd-back">Put it back</button></div>
      </div>`;
    $('#shelf-detail').hidden = false;
    $('#shelf-scrim').hidden = false;
    haptic();
  }
  function hideShelfBook() { $('#shelf-detail').hidden = true; $('#shelf-scrim').hidden = true; }
  $('#shelf-btn').addEventListener('click', openShelf);
  $('#shelf-close').addEventListener('click', closeShelf);
  $('#shelf-scrim').addEventListener('click', hideShelfBook);
  $('#shelf-view').addEventListener('click', (e) => {
    const b = e.target.closest('[data-shelf]');
    if (b) { b.classList.add('pulled'); setTimeout(() => b.classList.remove('pulled'), 400); showShelfBook(b.dataset.shelf); return; }
    if (e.target.closest('#sd-back')) { hideShelfBook(); return; }
    if (e.target.closest('[data-edit]')) hideShelfBook();
    const m = e.target.closest('[data-mode]');
    if (m) { ui.shelfMode = m.dataset.mode; saveUi(); renderShelf(); $('#shelf-body').scrollTop = 0; haptic(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || $('#shelf-view').hidden || document.querySelector('dialog[open]')) return;
    if (!$('#shelf-detail').hidden) hideShelfBook(); else closeShelf();
  });

  // ---------- Pull to refresh (every tab) ----------
  async function refreshAll() {
    const t0 = Date.now();
    let msg;
    if (sync.token) {
      const m = await syncFromWebsite({ force: true });
      msg = sync.status === 'error' ? '⚠️ Couldn’t sync — your changes are safe here' : m && m.remoteNewer ? 'Got your latest changes ☁️' : 'All up to date ✅';
    } else {
      try {
        const before = state.books.length;
        importText(await fetchPublished(), 'books.json', { quiet: true });
        const added = state.books.length - before;
        msg = added ? `Added ${added} new book${added === 1 ? '' : 's'} 📚` : 'All up to date ✅';
      } catch (_) { msg = 'Couldn’t reach the website — are you offline?'; }
    }
    await new Promise((r) => setTimeout(r, Math.max(0, 700 - (Date.now() - t0)))); // let the spinner flip a little
    render(); applyCoverTheme();
    toast(msg);
  }
  (function pullToRefresh() {
    const ind = document.createElement('div');
    ind.className = 'ptr';
    ind.innerHTML = '<div class="ptr-book"><i></i><i></i><i></i></div><small>Pull to refresh</small>';
    document.body.appendChild(ind);
    let startY = null, busy = false, pulled = 0;
    const blocked = () => busy || document.querySelector('dialog[open]') || !$('#shelf-view').hidden || !$('#stories').hidden || !$('#celebrate').hidden;
    const reset = () => { ind.classList.remove('ready', 'spinning', 'show'); ind.style.removeProperty('--pull'); ind.querySelector('small').textContent = 'Pull to refresh'; pulled = 0; };
    addEventListener('touchstart', (e) => { startY = scrollY <= 0 && !blocked() ? e.touches[0].clientY : null; }, { passive: true });
    addEventListener('touchmove', (e) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || scrollY > 0) { if (pulled) reset(); return; }
      pulled = Math.min(120, dy * 0.5);
      ind.classList.add('show');
      ind.style.setProperty('--pull', pulled);
      const ready = pulled >= 70;
      if (ready && !ind.classList.contains('ready')) haptic();
      ind.classList.toggle('ready', ready);
      ind.querySelector('small').textContent = ready ? 'Release to refresh' : 'Pull to refresh';
    }, { passive: true });
    addEventListener('touchend', async () => {
      if (startY === null) return;
      startY = null;
      if (!ind.classList.contains('ready')) { reset(); return; }
      busy = true;
      ind.classList.add('spinning');
      ind.querySelector('small').textContent = sync.token ? 'Syncing…' : 'Checking the website…';
      try { await refreshAll(); } finally { busy = false; reset(); }
    });
  })();

  // ---------- Boot ----------
  setTab(ui.tab);
  loadPublishedOnFirstVisit().finally(() => { startSync(); initMilestones(); handleUrlActions(); applyCoverTheme(); });
  maybeNudgeBackup();
  if (state.books.some((b) => !b.coverUrl && !b.isbn && !b.coverTried)) setTimeout(fillMissingCovers, 2000);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  // Re-render when returning to the app (e.g. new day → hero pace updates).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { render(); syncFromWebsite(); }
    else if (pushTimer) pushNow(); // leaving the app: send pending changes right away
  });
})();
