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
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save — storage may be full or blocked.'); }
  }
  // Ask the browser not to evict our data (helps on iOS/Android).
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

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
  function saveUi() { state.ui = ui; save(); }
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
      if (navigator.vibrate) navigator.vibrate(8);
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
      if (navigator.vibrate) navigator.vibrate(5);
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
      year: (a, b) => (bookYear(b) || 0) - (bookYear(a) || 0) || cmpStr(b.dateFinished, a.dateFinished) || (b.addedAt || 0) - (a.addedAt || 0),
    };
    return [...list].sort(by[mode] || by.title);
  }
  function matches(b, q) {
    if (!q) return true;
    q = q.toLowerCase();
    return (b.title || '').toLowerCase().includes(q) || (b.author || '').toLowerCase().includes(q) || (b.notes || '').toLowerCase().includes(q)
      || (b.series || '').toLowerCase().includes(q) || (b.tags || []).some((tg) => tg.toLowerCase().includes(q));
  }

  function readCard(b) {
    const meta = [
      b.format === 'listen' ? '🎧 Listened' : '📖 Read',
      b.dateFinished ? fmtDate(b.dateFinished) : (b.year ? String(b.year) : ''),
      b.format === 'listen' && b.audioMinutes ? fmtDuration(b.audioMinutes) : (b.pages ? `${fmt(b.pages)} pp` : ''),
    ].filter(Boolean).map((m) => `<span>${esc(m)}</span>`).join('');
    return `<article class="card">
      <button class="card-main" data-edit="${b.id}" aria-label="Edit ${esc(b.title)}">
        ${coverHTML(b)}
        <div class="card-text">
          <h3>${esc(b.title)}</h3>
          ${b.author ? `<p class="by">${esc(b.author)}</p>` : ''}
          <div class="meta">${meta}${b.rating ? `<span class="stars" aria-label="${b.rating} stars">${starStr(b.rating)}</span>` : ''}${b.spice ? `<span class="spice" aria-label="Spice ${b.spice} of 5">${spiceStr(b.spice)}</span>` : ''}</div>
          ${b.tags?.length ? `<div class="card-tags">${b.tags.slice(0, 3).map((tg) => `<span>${esc(tg)}</span>`).join('')}</div>` : ''}
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
    const list = sortBooks(all.filter((b) => (ui.readFormat === 'all' || (b.format || 'read') === ui.readFormat) && matches(b, q)), ui.readSort);
    const el = $('#read-list');
    if (!all.length) {
      el.innerHTML = `<div class="empty"><div class="big">📖</div><h3>Your shelf is waiting</h3><p>Log a book you've finished — even old favorites count.</p><button class="btn primary" data-add="read">Log a book</button></div>`;
      return;
    }
    if (!list.length) { el.innerHTML = `<div class="empty"><div class="big">🔎</div><p>No books match.</p></div>`; return; }
    if (ui.readSort === 'year') {
      let html = '', cur;
      const counts = {};
      list.forEach((b) => { const y = bookYear(b) || 'Unknown'; counts[y] = (counts[y] || 0) + 1; });
      for (const b of list) {
        const y = bookYear(b) || 'Unknown';
        if (y !== cur) { cur = y; html += `<h2 class="group-head">${y === 'Unknown' ? 'Year unknown' : y} <small>${counts[y]} book${counts[y] === 1 ? '' : 's'}</small></h2>`; }
        html += readCard(b);
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
            <div class="meta">${b.spice ? `<span class="spice">${spiceStr(b.spice)}</span>` : ''}${b.pages ? `<span>${fmt(b.pages)} pp</span>` : ''}${b.notes ? `<span class="note">${/^recommended by/i.test(b.notes) ? '🌀' : '📝'} ${esc(b.notes.split('\n')[0].slice(0, 40))}</span>` : ''}</div>
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

  function renderTbr() {
    $('#tbr-sort').value = ui.tbrSort;
    const q = $('#tbr-search').value.trim();
    const all = tbrBooks();
    // Mood filter: tropes plus a few spice/priority shortcuts
    const moodSel = $('#tbr-mood');
    const usedTags = [...new Set(all.flatMap((b) => b.tags || []))].sort(cmpStr);
    const moods = [['', 'Mood: Anything'], ['@top', '⭐ Top of the list'], ['@spicy', '🌶️ Spicy (3+)'], ['@mild', '🍵 Low spice (0–1)'], ...usedTags.map((tg) => [tg, '💘 ' + tg])];
    if (!moods.some(([v]) => v === ui.tbrMood)) ui.tbrMood = '';
    moodSel.innerHTML = moods.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    moodSel.value = ui.tbrMood || '';
    const moodOk = (b) => !ui.tbrMood || (ui.tbrMood === '@top' ? b.priority : ui.tbrMood === '@spicy' ? (b.spice || 0) >= 3
      : ui.tbrMood === '@mild' ? (b.spice || 0) <= 1 : (b.tags || []).includes(ui.tbrMood));
    const list = sortBooks(all.filter((b) => matches(b, q) && moodOk(b)), ui.tbrSort);
    const el = $('#tbr-list');
    if (!all.length) {
      el.innerHTML = `<div class="empty"><div class="big">🔖</div><h3>Nothing on deck</h3><p>Add books you want to read next. Tap the circle when you finish one!</p><button class="btn primary" data-add="tbr">Add to TBR</button></div>`;
      return;
    }
    if (!list.length) { el.innerHTML = `<div class="empty"><div class="big">🔎</div><p>No books match.</p></div>`; return; }
    let html = `<p class="hint" style="margin:0 2px 2px">${all.length} book${all.length === 1 ? '' : 's'} waiting · tap ◯ when you finish one</p>`;
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
      <div class="tile"><div class="k">Books</div><div class="v">${sel.length}</div><div class="s">${reads} read · ${listens} listened</div></div>
      <div class="tile"><div class="k">Pages</div><div class="v">${fmt(allPages)}</div><div class="s">${fmt(pages)} read with eyes</div></div>
      <div class="tile"><div class="k">Time</div><div class="v">${hours >= 10 ? fmt(hours) : hours.toFixed(1)}h</div><div class="s">≈ ${(hours / 24).toFixed(1)} days, est.</div></div>
      <div class="tile"><div class="k">Avg rating</div><div class="v">${avgRating ? avgRating.toFixed(1) : '–'}</div><div class="s">${avgRating ? `<span class="stars">${starStr(Math.round(avgRating))}</span>` : 'Rate books to see'}</div></div>
    </div>`;

    if (sel.length) html += `<button type="button" class="wrapped-btn" id="wrapped-btn">🎁 ${ui.statsYear === 'all' ? 'My reading, wrapped' : `My ${ui.statsYear}, wrapped`}<span>Make a shareable card →</span></button>`;

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
      if (facts.length) html += `<div class="panel"><h3>Fun facts</h3><ul class="facts">${facts.map(([e, t]) => `<li><span>${e}</span><span>${t}</span></li>`).join('')}</ul></div>`;
    }

    html += moreStats(sel);

    // Badges (always all-time)
    const earned = new Set(earnedBadges());
    html += `<div class="panel"><h3>Badges · ${earned.size}/${BADGES.length}</h3><div class="badges">${BADGES.map((b) =>
      `<div class="badge ${earned.has(b.id) ? '' : 'locked'}" title="${esc(b.d)}"><div class="e">${b.e}</div><div class="t">${b.t}</div><div class="d">${b.d}</div></div>`).join('')}</div></div>`;

    // Cover wall
    if (sel.length) {
      const wall = sortBooks(sel, 'year');
      html += `<div class="panel"><h3>Cover wall</h3><div class="wall">${wall.map((b) => `<button class="card-main" style="display:block" data-edit="${b.id}" aria-label="${esc(b.title)}">${coverHTML(b)}</button>`).join('')}</div></div>`;
    }
    body.innerHTML = html;
    $('#wrapped-btn')?.addEventListener('click', () => makeWrapped(sel));
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

  // ---------- Wrapped: a shareable summary image ----------
  let wrappedBlob = null;
  async function makeWrapped(sel) {
    const W = 1080, H = 1920, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    try { await document.fonts.load('700 80px Fraunces'); } catch (_) {}
    const serif = 'Fraunces, Georgia, serif', sans = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#2b1a14'); g.addColorStop(0.55, '#7a2f22'); g.addColorStop(1, '#c4553a');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // sparkle dots
    x.fillStyle = 'rgba(255,255,255,.08)';
    for (let i = 0; i < 60; i++) { x.beginPath(); x.arc((i * 197) % W, (i * 331) % H, (i % 4) + 2, 0, 7); x.fill(); }

    const label = ui.statsYear === 'all' ? 'All time' : String(ui.statsYear);
    const listens = sel.filter((b) => b.format === 'listen').length;
    const pages = sel.reduce((n, b) => n + num(b.pages), 0);
    const hours = sel.reduce((n, b) => n + minutesFor(b), 0) / 60;
    const byAuthor = {}; sel.forEach((b) => { if (b.author) byAuthor[b.author] = (byAuthor[b.author] || 0) + 1; });
    const topAuthor = Object.entries(byAuthor).sort((a, b) => b[1] - a[1])[0];
    const longest = [...sel].sort((a, b) => num(b.pages) - num(a.pages))[0];
    const finished = seriesProgress().filter((s) => s.complete).length;
    const tagCount = {}; sel.forEach((b) => (b.tags || []).forEach((tg) => (tagCount[tg] = (tagCount[tg] || 0) + 1)));
    const topTrope = Object.entries(tagCount).sort((a, b) => b[1] - a[1])[0];
    const spiced = sel.filter((b) => b.spice);
    const avgSpice = spiced.length ? spiced.reduce((n, b) => n + b.spice, 0) / spiced.length : 0;

    x.fillStyle = '#fff'; x.textAlign = 'left';
    x.font = `600 44px ${sans}`; x.globalAlpha = .8; x.fillText('📚 BOOKLOG', 90, 170); x.globalAlpha = 1;
    x.font = `700 120px ${serif}`; x.fillText(`My ${label}`, 90, 320);
    x.font = `700 120px ${serif}`; x.fillText('in books', 90, 450);

    x.font = `700 300px ${serif}`; x.fillStyle = '#ffd38a'; x.fillText(String(sel.length), 80, 790);
    x.fillStyle = '#fff'; x.font = `600 56px ${sans}`; x.fillText(`books · ${sel.length - listens} read · ${listens} listened`, 90, 880);

    const rows = [
      ['📄', `${fmt(pages)} pages`],
      ['⏳', `~${fmt(hours)} hours of story`],
      topAuthor && ['✍️', `Top author: ${topAuthor[0]} (${topAuthor[1]})`],
      longest && num(longest.pages) && ['🧱', `Biggest brick: ${longest.title}`],
      finished && ['✅', `${finished} series finished`],
      topTrope && ['💘', `Favorite trope: ${topTrope[0]}`],
      avgSpice && ['🌶️', `Average spice: ${avgSpice.toFixed(1)} / 5`],
    ].filter(Boolean).slice(0, 6);
    let y = 1040;
    for (const [e, txt] of rows) {
      x.font = `64px ${sans}`; x.fillText(e, 90, y);
      x.font = `600 54px ${sans}`;
      let t = txt; while (x.measureText(t).width > W - 280 && t.length > 4) t = t.slice(0, -2);
      x.fillText(t === txt ? t : t + '…', 190, y);
      y += 118;
    }
    x.globalAlpha = .7; x.font = `500 38px ${sans}`; x.fillText(`${earnedBadges().length} badges earned · made with Booklog`, 90, H - 110); x.globalAlpha = 1;

    c.toBlob((blob) => {
      wrappedBlob = blob;
      $('#wrapped-img').src = URL.createObjectURL(blob);
      $('#wrapped-title').textContent = `${label === 'All time' ? 'Your reading' : 'Your ' + label}, wrapped 🎁`;
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
    if (ui.tab === 'read') renderRead();
    else if (ui.tab === 'tbr') renderTbr();
    else renderStats();
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
    if (navigator.vibrate) navigator.vibrate(b.priority ? [8, 30, 12] : 6);
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
    $('#save-book').textContent = editing ? 'Save' : isRead ? 'Add to Read 🎉' : 'Add to TBR';
  }
  bindSeg(fStatus, syncFormVisibility);
  bindSeg(fFormat, syncFormVisibility);

  function updateCoverPreview() {
    const b = { title: F.title.value || 'Title', coverUrl: F.coverUrl.value.trim(), isbn: F.isbn.value.trim() };
    $('#cover-preview').innerHTML = coverHTML(b);
  }
  ['title', 'coverUrl', 'isbn'].forEach((n) => F[n].addEventListener('change', updateCoverPreview));

  function openBookDialog(book, presetStatus) {
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
    fRating.set(b.rating || 0);
    fSpice.set(b.spice || 0);
    fTags.set(b.tags);
    syncFormVisibility();
    updateCoverPreview();
    bookDlg.showModal();
    // Focus search on desktop only (on phones the keyboard popping up is jarring).
    if (!book && window.matchMedia('(hover: hover)').matches) setTimeout(() => $('#lookup-q').focus(), 50);
  }
  $('#add-btn').addEventListener('click', () => openBookDialog(null));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = F.title.value.trim();
    if (!title) { F.title.focus(); toast('Add a title first'); return; }
    const status = segValue(fStatus);
    const wasTbr = editing && editing.status === 'tbr';
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
    const before = earnedBadges();
    let book;
    if (editing) {
      Object.assign(editing, data);
      if (wasTbr && status === 'read') editing.fromTbr = true;
      book = editing;
    } else {
      book = { id: uid(), addedAt: Date.now(), ...data };
      state.books.push(book);
    }
    save();
    bookDlg.close();
    if (!book.coverUrl && !book.isbn) autoCover(book);
    if (status === 'read' && (!editing || wasTbr)) {
      celebrate(book, newBadges(before));
      if (ui.tab !== 'read') setTab('read'); else render();
    } else {
      render();
      if (!editing) toast(`Added “${book.title}” to your TBR 🔖`);
    }
  });

  $('#delete-book').addEventListener('click', () => {
    if (!editing) return;
    const book = editing, idx = state.books.indexOf(book);
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
      const res = await fetch(`https://openlibrary.org/search.json?${params}`, { signal: lookupCtrl.signal });
      const json = await res.json();
      const docs = json.docs || [];
      if (!docs.length) { out.innerHTML = `<div class="lookup-status">No matches — just type the details below.</div>`; return; }
      out.innerHTML = docs.map((d, i) => {
        const fake = { title: d.title, coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-S.jpg` : '' };
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
    F.coverUrl.value = d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '';
    const isbns = d.isbn || [];
    F.isbn.value = isbns.find((x) => x.length === 13 && x.startsWith('978')) || isbns[0] || '';
    $('#lookup-results').innerHTML = '';
    $('#lookup-q').value = '';
    updateCoverPreview();
    syncFormVisibility();
    $('#save-book').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (navigator.vibrate) navigator.vibrate(10);
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
    if (navigator.vibrate) navigator.vibrate(12);
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
      status: 'read', fromTbr: true,
      format: segValue(finFormat),
      dateFinished: date, year: +date.slice(0, 4),
      rating: finRating.value || 0,
      spice: finSpice.value || finishing.spice || 0,
      audioMinutes: segValue(finFormat) === 'listen' ? Math.round(num(finForm.audioH.value) * 60 + num(finForm.audioM.value)) : 0,
    });
    save();
    finishing = null;
    finDlg.close();
    openBuy.delete(b.id);
    render();
    celebrate(b, newBadges(before));
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
        if (navigator.vibrate) navigator.vibrate([10, 40, 20]);
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
    $('#celebrate-badges').innerHTML = badges.map((b) => `<span>${b.e} ${esc(b.t)} unlocked!</span>`).join('');
    el.hidden = false;
    if (navigator.vibrate) navigator.vibrate([15, 60, 25, 60, 40]);
    confetti(badges.length ? 260 : 160);
    $('#celebrate-close').focus({ preventScroll: true });
  }
  function closeCelebrate() { $('#celebrate').hidden = true; stopConfetti(); }
  $('#celebrate-close').addEventListener('click', closeCelebrate);
  $('#celebrate').addEventListener('click', (e) => { if (e.target.id === 'celebrate' || e.target.id === 'confetti') closeCelebrate(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#celebrate').hidden) closeCelebrate(); });

  // Hand-rolled confetti: no libraries needed.
  let confettiRaf = 0;
  function confetti(n) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = $('#confetti'), ctx = c.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = (c.width = innerWidth * dpr), H = (c.height = innerHeight * dpr);
    const colors = ['#c4553a', '#e0a526', '#2f6f62', '#5b4a8a', '#3b6ea5', '#f28cb1', '#ffffff'];
    const shapes = ['rect', 'rect', 'circle', 'book'];
    const parts = Array.from({ length: n }, (_, i) => {
      const fromLeft = i % 2 === 0;
      return {
        x: fromLeft ? 0 : W, y: H * 0.7,
        vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 10) * dpr,
        vy: -(14 + Math.random() * 14) * dpr,
        s: (5 + Math.random() * 6) * dpr,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
        c: colors[i % colors.length], shape: shapes[i % shapes.length],
        life: 0,
      };
    });
    const start = performance.now();
    cancelAnimationFrame(confettiRaf);
    const tick = (t) => {
      ctx.clearRect(0, 0, W, H);
      let alive = 0;
      for (const p of parts) {
        p.vy += 0.45 * dpr; p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        if (p.y > H + 20) continue;
        alive++;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
        if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, p.s / 2, 0, Math.PI * 2); ctx.fill(); }
        else if (p.shape === 'book') { ctx.font = `${p.s * 2.2}px serif`; ctx.fillText('📖', -p.s, p.s); }
        else ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      }
      if (alive && t - start < 6000) confettiRaf = requestAnimationFrame(tick);
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
    $('#install-hint').textContent = installHint();
    const lb = state.settings.lastBackup;
    $('#last-backup').textContent = lb ? `Last backup: ${new Date(lb).toLocaleDateString()}` : 'No backup yet.';
    setDlg.showModal();
  });
  setForm.addEventListener('submit', (e) => {
    e.preventDefault();
    state.settings.goal = Math.round(num(setForm.goal.value));
    state.settings.minPerPage = num(setForm.minPerPage.value) || 1.5;
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

  // ---------- Boot ----------
  setTab(ui.tab);
  loadPublishedOnFirstVisit();
  maybeNudgeBackup();
  if (state.books.some((b) => !b.coverUrl && !b.isbn && !b.coverTried)) setTimeout(fillMissingCovers, 2000);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  // Re-render when returning to the app (e.g. new day → hero pace updates).
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
})();
