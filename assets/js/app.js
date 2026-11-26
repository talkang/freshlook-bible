/* =========================================================
   app.js — 새번역 말씀노트 PWA (셸 전용 배포판)
   ========================================================= */
(function () {
  'use strict';

  const LS_SET = 'fl.settings.v1';
  const LS_THEME = 'fl.theme.v1';
  const LS_POS = 'fl.pos.v1';
  const LS_CUSTOM = 'fl.custom.v1';
  const DB_NAME = 'fl-bible';
  const DB_STORE = 'docs';

  const S = {
    index: null,
    books: {},          // id → book (내장 데이터 캐시)
    bookId: '01',
    chap: 1,
    opts: { mode: 'all', fs: 17, fam: 'serif', lh: 1.95, fn: 1 },
    custom: null,       // {index, books}
    hasBuiltin: false,  // 서버에 내장 본문(data/)이 있는가
    installEvent: null
  };

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /* ---------------- 저장소 ---------------- */
  function saveSettings() {
    try { localStorage.setItem(LS_SET, JSON.stringify(S.opts)); } catch (e) {}
  }
  function loadSettings() {
    try {
      const raw = localStorage.getItem(LS_SET);
      if (raw) Object.assign(S.opts, JSON.parse(raw));
    } catch (e) {}
  }
  function savePos() {
    try {
      localStorage.setItem(LS_POS, JSON.stringify({ b: S.bookId, c: S.chap, y: window.scrollY }));
    } catch (e) {}
  }

  /* ---------------- 테마 (다크 / 화이트) ---------------- */
  function readTheme() {
    try {
      const t = localStorage.getItem(LS_THEME);
      if (t === 'light' || t === 'dark') return t;
    } catch (e) {}
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function applyTheme(t, save) {
    const light = t === 'light';
    document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');

    const btn = $('#btn-theme');
    if (btn) {
      const glyph = btn.querySelector('.tglyph');
      const tx = $('#btn-theme-tx');
      if (glyph) glyph.textContent = light ? '☾' : '☀';
      if (tx) tx.textContent = light ? '다크' : '화이트';
      const label = light ? '다크 모드로 전환' : '화이트 모드로 전환';
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
      btn.setAttribute('aria-pressed', String(light));
    }

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', light ? '#FFFFFF' : '#000000');
    const sub = $('#themeSub');
    if (sub) sub.textContent = light ? 'White Mode' : 'Dark Mode';
    const splash = $('#splashSub');
    if (splash) splash.textContent = '표준새번역 · ' + (light ? 'WHITE MODE' : 'DARK MODE');
    $$('#seg-theme button').forEach(b =>
      b.classList.toggle('on', b.dataset.v === (light ? 'light' : 'dark')));

    if (save) {
      try { localStorage.setItem(LS_THEME, light ? 'light' : 'dark'); } catch (e) {}
    }
  }

  function toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next, true);
    toast(next === 'light' ? '화이트 모드' : '다크 모드');
  }

  /* IndexedDB (불러온 본문 보관) */
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(DB_STORE); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbSet(key, val) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(val, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  async function idbGet(key) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  async function idbDel(key) {
    const db = await idb();
    return new Promise((res) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(key);
      tx.oncomplete = () => res();
    });
  }

  /* ---------------- 데이터 ---------------- */
  async function loadIndex() {
    if (S.custom) { S.index = S.custom.index; return; }
    const r = await fetch('data/index.json');
    if (!r.ok) throw new Error('index ' + r.status);
    S.index = await r.json();
  }

  /* 서버에 내장 본문(data/)이 실려 있는지 확인합니다.
     본문 없이 앱 껍데기만 배포된 경우(공개 저장소)에는 조용히 false 를 돌려줍니다. */
  async function detectBuiltin() {
    try {
      const r = await fetch('data/index.json', { cache: 'no-store' });
      if (!r.ok) return false;
      const idx = await r.json();
      if (!idx || !Array.isArray(idx.books) || !idx.books.length) return false;
      const first = idx.books[0].id;
      const b = await fetch('data/books/' + first + '.json', { cache: 'no-store' });
      if (!b.ok) return false;
      S.index = idx;
      return true;
    } catch (e) { return false; }
  }

  async function getBook(id) {
    if (S.custom) return S.custom.books[id];
    if (S.books[id]) return S.books[id];
    const r = await fetch('data/books/' + id + '.json');
    if (!r.ok) throw new Error('book ' + r.status);
    const b = await r.json();
    S.books[id] = b;
    return b;
  }

  function bookMeta(id) {
    return (S.index.books || []).find(b => b.id === id);
  }

  /* ---------------- 화면 ---------------- */
  function applyOptions() {
    const o = S.opts;
    const root = document.documentElement.style;
    root.setProperty('--fs', o.fs + 'px');
    root.setProperty('--lh', String(o.lh));
    root.setProperty('--fam', o.fam === 'sans'
      ? '"Noto Sans KR","Apple SD Gothic Neo",system-ui,sans-serif'
      : '"Noto Serif KR","Nanum Myeongjo","Noto Serif CJK KR","Apple SD Gothic Neo",serif');
    document.body.classList.toggle('hide-fn', !o.fn);
    const modeName = { all: '전체 색상', essential: '핵심 색상', plain: '기본 흑백' }[o.mode];
    $('#btn-mode').textContent = modeName;
    $('#btn-mode').dataset.mode = o.mode;
    $$('#seg-mode button').forEach(b => b.classList.toggle('on', b.dataset.v === o.mode));
    $$('#seg-fam button').forEach(b => b.classList.toggle('on', b.dataset.v === o.fam));
    $$('#seg-lh button').forEach(b => b.classList.toggle('on', String(b.dataset.v) === String(o.lh)));
    $$('#seg-fn button').forEach(b => b.classList.toggle('on', String(b.dataset.v) === String(o.fn)));
    $('#fs-val').textContent = o.fs;
  }

  async function go(bookId, chap, opts) {
    opts = opts || {};
    if (!S.index) return;
    S.bookId = bookId;
    S.chap = chap;
    let book;
    try { book = await getBook(bookId); } catch (e) { book = null; }
    if (!book) { toast('본문을 불러오지 못했습니다'); return; }
    S.book = book;
    $('#topBook').textContent = book.name;
    $('#topChap').textContent = chap;

    const chObj = book.ch[chap - 1];
    const body = chObj ? FLRender.renderChapter(book, chObj, { mode: S.opts.mode }) : '<p class="empty">본문이 없습니다</p>';

    const secCount = (chObj && chObj.b || []).filter(b => b.k === 'h' && b.l !== 2).length;
    const html =
      '<div class="chap-head">' +
        '<div class="eyebrow">' + esc(book.name) + '</div>' +
        '<h1>' + chap + '</h1>' +
        '<div class="meta">총 ' + book.nc + '장' +
          (secCount ? ' · 소제목 ' + secCount + '개' : '') + '</div>' +
      '</div>' + body;

    $('#chapter').innerHTML = html;
    if (!opts.keepScroll) window.scrollTo(0, opts.y || 0);
    savePos();
    prefetchNeighbors();
  }

  function prefetchNeighbors() {
    const i = S.index.books.findIndex(b => b.id === S.bookId);
    if (i < 0) return;
    [i - 1, i + 1].forEach(k => {
      const b = S.index.books[k];
      if (b && !S.custom && !S.books[b.id]) getBook(b.id).catch(() => {});
    });
  }

  function nextChapter(dir) {
    const idx = S.index.books.findIndex(b => b.id === S.bookId);
    let bi = idx, c = S.chap + dir;
    const cur = S.index.books[bi];
    if (c < 1) {
      bi--; if (bi < 0) { toast('첫 장입니다'); return; }
      c = S.index.books[bi].nc;
    } else if (c > cur.nc) {
      bi++; if (bi >= S.index.books.length) { toast('마지막 장입니다'); return; }
      c = 1;
    }
    go(S.index.books[bi].id, c);
  }

  /* ---------------- 시트 ---------------- */
  let sheetOpen = false;
  function openSheet(id) {
    $$('.sheet').forEach(s => s.classList.remove('on'));
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('on');
    $('#veil').classList.add('on');
    if (!sheetOpen) {
      sheetOpen = true;
      try { history.pushState({ fl: 'sheet' }, ''); } catch (e) {}
    }
  }
  function closeSheets(fromPop) {
    $$('.sheet').forEach(s => s.classList.remove('on'));
    $('#veil').classList.remove('on');
    if (sheetOpen && !fromPop) {
      sheetOpen = false;
      try { history.back(); } catch (e) {}
    } else {
      sheetOpen = false;
    }
  }

  /* ---------------- 목차 ---------------- */
  function renderBookGrid(testament) {
    const books = S.index.books.filter(b => (testament === 'ot' ? +b.id <= 39 : +b.id >= 40));
    $('#bookgrid').innerHTML = books.map(b =>
      '<button data-book="' + b.id + '" class="' + (b.id === S.bookId ? 'on' : '') + '">' +
      esc(b.name) + '</button>').join('');
    $$('#bookgrid button').forEach(btn => {
      btn.onclick = () => showChapters(btn.dataset.book);
    });
  }

  function showChapters(bookId) {
    const b = bookMeta(bookId);
    $('#chapterpick').style.display = 'block';
    $('#pickTitle').textContent = b.name;
    let html = '';
    for (let c = 1; c <= b.nc; c++) {
      html += '<button data-ch="' + c + '" class="' + (bookId === S.bookId && c === S.chap ? 'on' : '') + '">' + c + '</button>';
    }
    $('#chgrid').innerHTML = html;
    $$('#chgrid button').forEach(btn => {
      btn.onclick = () => { closeSheets(); go(bookId, +btn.dataset.ch); };
    });
    $('#chapterpick').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ---------------- 색상 범례 ---------------- */
  function renderLegend() {
    let html = '';
    for (const grp of FLColor.LEGEND) {
      html += '<div class="grp">' + grp.grp + '</div>';
      for (const it of grp.items) {
        html += '<div class="item"><span class="dot" style="background:' + it.color + '"></span>' +
          '<span class="name">' + it.name + '</span>' +
          '<span class="ex ' + it.cls + '">' + it.ex + '</span></div>';
      }
    }
    $('#legendBody').innerHTML = html;
  }

  /* ---------------- 책 개요 ---------------- */
  async function openOverview() {
    const meta = bookMeta(S.bookId);
    const book = S.book || await getBook(S.bookId);
    if (!meta || !book) return;
    $('#ovName').textContent = meta.name;
    $('#ovGenre').textContent = (meta.g || '') + ' · ' + meta.nc + '장';
    $('#ovText').textContent = meta.ov || '';
    $('#ovStats').innerHTML =
      '<span>장 ' + meta.nc + '</span>' +
      '<span>절 ' + meta.vs.toLocaleString() + '</span>' +
      '<span>소제목 ' + (book.outline || []).length + '</span>' +
      '<span>' + (meta.g || '') + '</span>';
    const ov = (book.outline || []);
    $('#ovOutline').innerHTML = ov.length
      ? ov.map(o => '<button data-c="' + o.c + '" data-v="' + o.v + '">' +
          '<span class="oc">' + o.c + ':' + o.v + '</span>' +
          '<span class="ot">' + esc(o.t) + '</span></button>').join('')
      : '<div class="empty">이 책에는 소제목이 없습니다</div>';
    $$('#ovOutline button').forEach(btn => {
      btn.onclick = () => {
        closeSheets();
        go(S.bookId, +btn.dataset.c).then(() => {
          const el = $('#v' + btn.dataset.v);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      };
    });
    openSheet('sheet-overview');
  }

  /* ---------------- 각주 ---------------- */
  let fnCache = { table: [], chap: 0 };
  function openFootnotes(id) {
    const book = S.book;
    const ch = book.ch[S.chap - 1];
    const table = (ch && ch.fn) || [];
    fnCache = { table, chap: S.chap };
    $('#fnSub').textContent = book.name + ' ' + S.chap + '장';
    $('#fnBody').innerHTML = table.length
      ? table.map((f, i) =>
        '<div class="fnitem" id="fni' + i + '"><span class="letter">' + esc(f[0]) + '</span>' +
        '<span class="fnbody">' + esc(f[1]) + '</span></div>').join('')
      : '<div class="empty">이 장에는 각주가 없습니다</div>';
    openSheet('sheet-fn');
    if (id !== undefined) {
      const target = $('#fni' + id);
      if (target) setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 320);
    }
  }

  /* ---------------- 검색 ---------------- */
  let searchToken = 0;
  async function runSearch(q) {
    q = q.trim();
    if (!q) return;
    const token = ++searchToken;
    const box = $('#searchResults');
    box.innerHTML = '<div class="empty">검색 중…</div>';
    const hits = [];
    const books = S.index.books;
    for (let i = 0; i < books.length; i++) {
      if (token !== searchToken) return;
      const meta = books[i];
      let book;
      try { book = await getBook(meta.id); } catch (e) { continue; }
      if (!book) continue;
      for (const ch of book.ch) {
        for (const blk of ch.b) {
          const vs = blk.vs || [];
          for (const v of vs) {
            const text = v.t !== undefined ? v.t : (v.l || []).join(' ');
            if (text.indexOf(q) >= 0) {
              hits.push({ book: meta.name, bid: meta.id, c: ch.n, v: v.n, t: text });
              if (hits.length >= 240) break;
            }
          }
          if (hits.length >= 240) break;
        }
        if (hits.length >= 240) break;
      }
      if (hits.length >= 240) break;
      if (i % 6 === 0) box.innerHTML = '<div class="empty">검색 중… ' + (i + 1) + '/' + books.length + '</div>';
    }
    if (token !== searchToken) return;
    if (!hits.length) {
      box.innerHTML = '<div class="empty">“' + esc(q) + '” 를 찾지 못했습니다</div>';
      return;
    }
    box.innerHTML = hits.map((h, i) => {
      const clean = h.t.replace(/⟦\d+⟧/g, '');
      const at = clean.indexOf(q);
      const s = Math.max(0, at - 24);
      const snippet = (s > 0 ? '…' : '') + clean.slice(s, at + q.length + 34) + '…';
      const marked = esc(snippet).split(esc(q)).join('<mark>' + esc(q) + '</mark>');
      return '<div class="res" data-bid="' + h.bid + '" data-c="' + h.c + '" data-v="' + h.v + '" data-i="' + i + '">' +
        '<div class="r-top">' + h.book + ' ' + h.c + ':' + h.v + '</div>' +
        '<div class="r-tx">' + marked + '</div></div>';
    }).join('') + '<div class="empty">' + hits.length + '곳' + (hits.length >= 240 ? ' (일부만 표시)' : '') + '</div>';
    $$('#searchResults .res').forEach(el => {
      el.onclick = () => {
        closeSheets();
        go(el.dataset.bid, +el.dataset.c).then(() => {
          const v = $('#v' + el.dataset.v);
          if (v) {
            v.scrollIntoView({ behavior: 'smooth', block: 'center' });
            v.classList.add('cur');
            setTimeout(() => v.classList.remove('cur'), 2600);
          }
        });
      };
    });
  }

  /* ---------------- TXT 불러오기 ---------------- */
  async function importTxt(file) {
    const text = await file.text();
    toast('본문을 읽는 중…');
    let parsed;
    try { parsed = FLParse.parse(text); } catch (e) { toast('파일을 해석하지 못했습니다'); return; }
    const n = parsed.index.books.length;
    if (n < 20) { toast('성경 TXT 형식이 아닌 것 같습니다 (책 ' + n + '권)'); return; }
    const total = parsed.index.books.reduce((a, b) => a + b.vs, 0);
    S.custom = parsed;
    try {
      await idbSet('custom', parsed);
      localStorage.setItem(LS_CUSTOM, JSON.stringify({ name: file.name, books: n, verses: total, at: Date.now() }));
    } catch (e) { toast('저장 공간이 부족합니다'); }
    $('#row-reset').style.display = 'flex';
    $('#customName').textContent = file.name + ' · ' + n + '권 ' + total.toLocaleString() + '절';
    await loadIndex();
    hideWelcome();
    renderBookGrid('ot');
    await go('01', 1);
    toast(n + '권 ' + total.toLocaleString() + '절을 불러왔습니다');
  }

  async function resetCustom() {
    S.custom = null;
    try { await idbDel('custom'); } catch (e) {}
    try { localStorage.removeItem(LS_CUSTOM); } catch (e) {}
    $('#row-reset').style.display = 'none';
    if (!S.hasBuiltin) {
      S.index = null;
      S.books = {};
      try { localStorage.removeItem(LS_POS); } catch (e) {}
      showWelcome();
      toast('불러온 본문을 지웠습니다');
      return;
    }
    await loadIndex();
    await go('01', 1);
    toast('내장 본문으로 되돌렸습니다');
  }

  /* ---------------- 기타 ---------------- */
  function esc(s) { return FLColor.esc(String(s == null ? '' : s)); }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
  }

  function tickProgress() {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    const p = h > 0 ? Math.min(1, window.scrollY / h) : 0;
    $('#progressbar').style.width = (p * 100).toFixed(1) + '%';
  }

  /* ---------------- 시작 화면 (본문 없이 배포된 경우) ---------------- */
  function showWelcome() {
    document.body.classList.add('no-text');
    const w = $('#welcome');
    if (w) w.hidden = false;
    const ch = $('#chapter');
    if (ch) ch.innerHTML = '';
    const tb = $('#topBook');
    if (tb) tb.textContent = '새번역';
    const tc = $('#topChap');
    if (tc) tc.textContent = '말씀노트';
  }

  function hideWelcome() {
    document.body.classList.remove('no-text');
    const w = $('#welcome');
    if (w) w.hidden = true;
  }

  /* ---------------- 초기화 ---------------- */
  async function init() {
    loadSettings();
    applyOptions();
    applyTheme(readTheme(), false);
    renderLegend();

    // 불러온 본문 복원
    try {
      const saved = localStorage.getItem(LS_CUSTOM);
      if (saved) {
        const custom = await idbGet('custom');
        if (custom && custom.index && custom.books) {
          S.custom = custom;
          $('#row-reset').style.display = 'flex';
          const info = JSON.parse(saved);
          $('#customName').textContent = info.name + ' · ' + info.books + '권 ' + info.verses.toLocaleString() + '절';
        }
      }
    } catch (e) {}

    if (S.custom) {
      S.hasBuiltin = false;
      try { await loadIndex(); } catch (e) {}
    } else {
      S.hasBuiltin = await detectBuiltin();
    }

    // ‘내장 본문으로 되돌리기’ 문구 — 내장 본문이 없으면 ‘지우기’
    const resetLab = $('#row-reset .lab');
    if (resetLab) resetLab.textContent = S.hasBuiltin ? '내장 본문으로 되돌리기' : '불러온 본문 지우기';

    if (!S.index) {
      showWelcome();
    } else {
      let pos = null;
      try { pos = JSON.parse(localStorage.getItem(LS_POS) || 'null'); } catch (e) {}
      const first = (S.index.books && S.index.books[0]) || { id: '01', nc: 50 };
      const bid = pos && bookMeta(pos.b) ? pos.b : first.id;
      const c = pos && pos.c ? pos.c : 1;
      await go(bid, c, { y: pos ? pos.y : 0 });
      renderBookGrid('ot');
    }

    setTimeout(() => $('#splash').classList.add('off'), 260);

    // 이벤트
    $('#btn-menu').onclick = $('#btn-menu2').onclick = () => { renderBookGrid('ot'); $('#chapterpick').style.display = 'none'; openSheet('sheet-menu'); };
    $('#veil').onclick = closeSheets;
    $('#pickBack').onclick = () => { $('#chapterpick').style.display = 'none'; };
    $$('.tabs button').forEach(b => {
      b.onclick = () => {
        $$('.tabs button').forEach(x => x.classList.toggle('on', x === b));
        $('#chapterpick').style.display = 'none';
        renderBookGrid(b.dataset.testament);
      };
    });
    $('#btn-prev').onclick = () => nextChapter(-1);
    $('#btn-next').onclick = () => nextChapter(1);
    $('#btn-search').onclick = () => { openSheet('sheet-search'); setTimeout(() => $('#searchInput').focus(), 300); };
    $('#btn-legend').onclick = () => openSheet('sheet-legend');
    $('#btn-overview').onclick = openOverview;
    $('#btn-settings').onclick = () => openSheet('sheet-settings');
    $('#btn-theme').onclick = toggleTheme;
    $$('#seg-theme button').forEach(b => b.onclick = () => applyTheme(b.dataset.v, true));
    $('#btn-mode').onclick = () => {
      const order = ['all', 'essential', 'plain'];
      S.opts.mode = order[(order.indexOf(S.opts.mode) + 1) % 3];
      saveSettings(); applyOptions(); go(S.bookId, S.chap, { keepScroll: true });
      toast({ all: '전체 색상', essential: '핵심 색상 (하나님·예수·성령·화자)', plain: '기본 흑백' }[S.opts.mode]);
    };

    // 설정
    $$('#seg-mode button').forEach(b => b.onclick = () => {
      S.opts.mode = b.dataset.v; saveSettings(); applyOptions();
      go(S.bookId, S.chap, { keepScroll: true });
    });
    $$('#seg-fam button').forEach(b => b.onclick = () => { S.opts.fam = b.dataset.v; saveSettings(); applyOptions(); });
    $$('#seg-lh button').forEach(b => b.onclick = () => { S.opts.lh = parseFloat(b.dataset.v); saveSettings(); applyOptions(); });
    $$('#seg-fn button').forEach(b => b.onclick = () => { S.opts.fn = +b.dataset.v; saveSettings(); applyOptions(); });
    $('#fs-up').onclick = () => { S.opts.fs = Math.min(26, S.opts.fs + 1); saveSettings(); applyOptions(); };
    $('#fs-down').onclick = () => { S.opts.fs = Math.max(13, S.opts.fs - 1); saveSettings(); applyOptions(); };

    // 각주 클릭
    $('#chapter').addEventListener('click', (e) => {
      const chip = e.target.closest('.fn');
      if (chip) { openFootnotes(Number(chip.dataset.fn)); }
    });

    // 검색
    const si = $('#searchInput');
    $('#searchGo').onclick = () => runSearch(si.value);
    si.addEventListener('keydown', e => { if (e.key === 'Enter') { si.blur(); runSearch(si.value); } });

    // 파일 불러오기
    $('#btn-import').onclick = () => $('#file-input').click();
    const btnImportMain = $('#btn-import-main');
    if (btnImportMain) btnImportMain.onclick = () => $('#file-input').click();
    $('#file-input').onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) importTxt(f);
      e.target.value = '';
    };
    $('#btn-reset').onclick = resetCustom;

    // 출력 / PDF (여백성경 조판)
    $('#btn-print').onclick = () => {
      closeSheets();
      if (!window.FLPrint) { toast('출력 기능을 불러오지 못했습니다'); return; }
      window.FLPrint.open({
        index: S.index, getBook: getBook, bookId: S.bookId, chap: S.chap, fam: S.opts.fam
      });
    };

    // 스크롤 진행률 / 위치 저장
    let saveTimer;
    window.addEventListener('scroll', () => {
      tickProgress();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(savePos, 400);
    }, { passive: true });

    // 좌우 스와이프
    let tx = 0, ty = 0;
    $('#reader').addEventListener('touchstart', e => {
      tx = e.touches[0].clientX; ty = e.touches[0].clientY;
    }, { passive: true });
    $('#reader').addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - tx;
      const dy = e.changedTouches[0].clientY - ty;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) nextChapter(dx < 0 ? 1 : -1);
    }, { passive: true });

    // 뒤로 가기 → 열린 시트 닫기
    window.addEventListener('popstate', () => {
      if (sheetOpen) closeSheets(true);
    });

    // 키보드
    window.addEventListener('keydown', e => {
      if (e.target.matches('input,textarea')) return;
      if (e.key === 'ArrowRight') nextChapter(1);
      if (e.key === 'ArrowLeft') nextChapter(-1);
      if (e.key === 'Escape') closeSheets();
    });

    // 설치 안내
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      S.installEvent = e;
      $('#row-install').style.display = 'flex';
    });
    $('#btn-install').onclick = async () => {
      if (!S.installEvent) return;
      S.installEvent.prompt();
      await S.installEvent.userChoice;
      S.installEvent = null;
      $('#row-install').style.display = 'none';
    };

    // 서비스 워커
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    tickProgress();
  }

  window.FLApp = { go, S, openSheet, closeSheets, toast, applyTheme, readTheme };

  document.addEventListener('DOMContentLoaded', init);
})();
