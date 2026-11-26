/* =========================================================
   print.js — FreshLook 여백성경 조판 · 출력 / PDF
   · 책별(또는 장 범위)을 종이 쪽으로 나누어 조판하고,
     브라우저 인쇄 대화상자로 PDF 저장 / 인쇄합니다.
   · 단면 / 양면(바깥쪽 여백 교대) · A4·B5·A5 · 필기 여백(무지·줄·점·모눈)
     · 컬러(8색) / 흑백 · 각주 포함 / 제외
   · 조판은 모두 브라우저 안에서 이루어지고 어디로도 보내지 않습니다.
   ========================================================= */
(function (global) {
  'use strict';

  const esc = (s) => global.FLColor.esc(String(s == null ? '' : s));
  const MM = 96 / 25.4;                  // 1mm → CSS px
  const LS = 'fl.print.v1';
  const RAIL = ['#4A6B8A', '#6D5578', '#4E6E5B', '#7A6440', '#4B5275', '#7A4F52'];

  const PAPER = {
    a4: { id: 'a4', label: 'A4', note: '210 × 297 mm', w: 210, h: 297, fs: 10.4 },
    b5: { id: 'b5', label: 'B5', note: '176 × 250 mm', w: 176, h: 250, fs: 9.8 },
    a5: { id: 'a5', label: 'A5', note: '148 × 210 mm', w: 148, h: 210, fs: 8.9 }
  };

  const NOTE = {
    blank: { id: 'blank', label: '무지', step: 0 },
    line: { id: 'line', label: '줄노트', step: 7 },
    dot: { id: 'dot', label: '점', step: 6 },
    grid: { id: 'grid', label: '모눈', step: 5 }
  };

  const MODES = {
    single: {
      id: 'single', label: '단면인쇄',
      hint: '한 면씩 찍습니다. 필기 공간이 모든 쪽에서 같은 자리에 놓입니다.'
    },
    duplex: {
      id: 'duplex', label: '양면인쇄',
      hint: '펼쳤을 때 필기 공간이 바깥쪽으로 번갈아 놓입니다. 쪽수는 짝수로 맞춥니다.'
    }
  };

  const CFG0 = {
    bookId: '', mode: 'single', paper: 'a4', noteStyle: 'line', noteRatio: 35,
    noteSide: 'right', color: 'color', fns: true, range: 'book',
    from: 1, to: 1, size: 0
  };

  const st = {
    cfg: Object.assign({}, CFG0),
    host: null,          // { index, getBook, bookId, chap, fam }
    book: null, bookId: '',
    flow: null,          // { key, items }
    pages: [], els: {}, spread: 0,
    token: 0, busy: false
  };

  const dom = {};

  const fx = (v) => Math.round(v * 1000) / 1000;

  /* ---------------- 설정 저장 ---------------- */
  function loadCfg() {
    let raw = null;
    try { raw = localStorage.getItem(LS); } catch (e) {}
    st.cfg = Object.assign({}, CFG0);
    if (raw) {
      try {
        const o = JSON.parse(raw) || {};
        Object.keys(CFG0).forEach((k) => {
          if (o[k] === undefined || o[k] === null) return;
          st.cfg[k] = o[k];
        });
      } catch (e) {}
    }
    if (!PAPER[st.cfg.paper]) st.cfg.paper = 'a4';
    if (!NOTE[st.cfg.noteStyle]) st.cfg.noteStyle = 'line';
    if (!MODES[st.cfg.mode]) st.cfg.mode = 'single';
    st.cfg.noteRatio = Math.max(0, Math.min(50, Number(st.cfg.noteRatio) || 0));
    st.cfg.fns = !!st.cfg.fns;
    st.cfg.color = st.cfg.color === 'mono' ? 'mono' : 'color';
    st.cfg.noteSide = st.cfg.noteSide === 'left' ? 'left' : 'right';
    if (['book', 'current', 'range'].indexOf(st.cfg.range) < 0) st.cfg.range = 'book';
  }

  function saveCfg() {
    try { localStorage.setItem(LS, JSON.stringify(st.cfg)); } catch (e) {}
  }

  /* ---------------- 치수 ---------------- */
  function geom() {
    const p = PAPER[st.cfg.paper] || PAPER.a4;
    const s = Math.max(0.8, Math.min(1.45, Math.min(p.w, p.h) / 148));
    const m = { top: 11 * s, bottom: 13 * s, inner: 12 * s, outer: 10.5 * s, gutter: 4.6 * s };
    const contentW = p.w - m.inner - m.outer - m.gutter;
    const noteW = contentW * (st.cfg.noteRatio / 100);
    const textW = contentW - noteW;
    const fs = Number(st.cfg.size) > 0 ? Number(st.cfg.size) : p.fs;
    const headH = fs * 0.352778 * 1.9;      // 머리말 한 줄 높이(mm)
    return { p, m, contentW, noteW, textW, fs, headH };
  }

  function famCss() {
    return (st.host && st.host.fam === 'sans')
      ? '"Noto Sans KR","Apple SD Gothic Neo",system-ui,sans-serif'
      : '"Noto Serif KR","Nanum Myeongjo","Noto Serif CJK KR","Apple SD Gothic Neo",serif';
  }

  function metaOf(id) {
    const books = (st.host && st.host.index && st.host.index.books) || [];
    for (let i = 0; i < books.length; i++) if (books[i].id === id) return books[i];
    return null;
  }

  function ncOf(id) {
    const m = metaOf(id);
    return m ? (m.nc || 1) : 1;
  }

  function rangeOf() {
    const nc = ncOf(st.cfg.bookId);
    if (st.cfg.range === 'current') {
      const mine = st.host && st.cfg.bookId === st.host.bookId;
      const ch = Math.min(Math.max(1, mine ? (st.host.chap || 1) : 1), nc);
      return [ch, ch];
    }
    if (st.cfg.range === 'range') {
      let a = Math.max(1, Math.min(nc, parseInt(st.cfg.from, 10) || 1));
      let b = Math.max(1, Math.min(nc, parseInt(st.cfg.to, 10) || nc));
      if (b < a) { const t = a; a = b; b = t; }
      return [a, b];
    }
    return [1, nc];
  }

  /* ---------------- 조판 내용 ---------------- */
  function chipHtml(id, table) {
    const rec = table && table[Number(id)];
    const letter = rec ? rec[0] : String.fromCharCode(97 + (Number(id) % 26));
    return '<button class="fn" type="button" tabindex="-1" data-fn="' + id + '">' + esc(letter) + '</button>';
  }

  function headingHtml(t, ctx) {
    return esc(t).replace(/⟦(\d+)⟧/g, (_, id) => chipHtml(id, ctx.fnTable));
  }

  function chapHeadHtml(book, chObj, cn) {
    const secs = (chObj.b || []).filter((b) => b.k === 'h' && b.l !== 2).length;
    return '<div class="fl-chaphead">' +
      '<h1>' + cn + '</h1>' +
      '<div class="meta">표준새번역' + (secs ? ' · 소제목 ' + secs + '개' : '') + '</div>' +
      '</div>';
  }

  function fnItemHtml(f) {
    return '<div class="fl-fnitem"><span class="fl-fnlet">' + esc(f[0]) +
      '</span><span>' + esc(f[1]) + '</span></div>';
  }

  /** 선택한 장들을 블록 목록으로 폅니다 (쪽 높이는 나중에 잽니다). */
  function buildFlow(book, from, to) {
    const items = [];
    const withFns = !!st.cfg.fns;

    for (let cn = from; cn <= to; cn++) {
      const chObj = (book.ch || [])[cn - 1];
      if (!chObj) continue;

      items.push({ kind: 'chap', ch: cn, sec: null, html: chapHeadHtml(book, chObj, cn) });

      const ctx = global.FLRender.makeCtx(book, chObj, { mode: 'all' });
      let sec = null, secIdx = -1;

      (chObj.b || []).forEach((blk) => {
        if (blk.k === 'h') {
          const t = String(blk.t || '');
          if (blk.l === 2) {
            items.push({ kind: 'h2', ch: cn, sec: sec, html: '<p class="h2">' + headingHtml(t, ctx) + '</p>' });
          } else {
            secIdx++;
            sec = { i: secIdx, color: RAIL[secIdx % RAIL.length], title: t.replace(/⟦\d+⟧/g, '') };
            items.push({
              kind: 'h1', ch: cn, sec: sec, railTitle: sec.title,
              html: '<h2 class="h1">' + headingHtml(t, ctx) + '</h2>'
            });
          }
          return;
        }
        const vs = blk.vs || [];
        if (blk.k === 'p') {
          items.push({
            kind: 'p', ch: cn, sec: sec, wrap: 'p', sep: ' ',
            units: vs.map((v) => global.FLRender.renderStream([v], ctx, { headless: true }))
          });
        } else if (blk.k === 'po') {
          items.push({
            kind: 'po', ch: cn, sec: sec, wrap: 'po', sep: '',
            units: vs.map((v) => global.FLRender.renderPoemVerses([v], ctx))
          });
        } else if (blk.k === 'lt') {
          items.push({
            kind: 'lt', ch: cn, sec: sec, wrap: 'lt', sep: ' ', ttl: blk.ttl || '문서',
            units: vs.map((v) => global.FLRender.renderStream([v], ctx, { headless: true }))
          });
        }
      });

      if (withFns && chObj.fn && chObj.fn.length) {
        items.push({ kind: 'fnhead', ch: cn, sec: null, html: '<div class="fl-fnh">이 장의 각주</div>' });
        chObj.fn.forEach((f) => {
          items.push({ kind: 'fn', ch: cn, sec: null, html: fnItemHtml(f) });
        });
      }
    }
    return items;
  }

  function blockInner(it) {
    if (!it.units) return it.html || '';
    const body = it.units.join(it.sep);
    if (it.wrap === 'p') return '<div class="p"><p class="v">' + body + '</p></div>';
    if (it.wrap === 'po') return '<div class="po">' + body + '</div>';
    if (it.wrap === 'lt') {
      return '<div class="box"><div class="box-ttl">' + esc(it.ttl) +
        (it.part ? ' · 이어짐' : '') + '</div>' + body + '</div>';
    }
    return body;
  }

  function blockHtml(it) {
    const railCls = it.sec ? ' flr' : '';
    const oc = it.sec ? ' style="--oc:' + it.sec.color + '"' : '';
    // 소제목이 시작되는 블록에만 세로 이름표를 답니다 (블록 밖으로 조금 넘어가도 됩니다)
    const lbl = it.railTitle
      ? '<div class="fl-rail"><span>' + esc(it.railTitle) + '</span></div>' : '';
    return '<div class="fl-blk' + railCls + '"' + oc + '>' + lbl + blockInner(it) + '</div>';
  }

  /* ---------------- 잼 / 나눔 / 쪽 묶기 ---------------- */
  function measureDoc(g) {
    const doc = document.createElement('div');
    doc.className = 'fl-doc fl-measure';
    doc.setAttribute('data-theme', 'light');
    doc.style.width = fx(g.textW) + 'mm';
    doc.style.setProperty('--fs', g.fs + 'pt');
    doc.style.setProperty('--lh', '1.78');
    doc.style.setProperty('--fam', famCss());
    return doc;
  }

  function sliceItem(it, a, b) {
    return {
      kind: it.kind, ch: it.ch, sec: it.sec, wrap: it.wrap, sep: it.sep, ttl: it.ttl,
      units: it.units.slice(a, b),
      railTitle: a === 0 ? it.railTitle : null,
      part: a > 0
    };
  }

  /** 한 쪽에 담기지 않는 블록을 절 단위로 나눕니다. */
  function splitItem(doc, it, limit) {
    const n = it.units.length;
    const out = [];
    const H = (a, b) => {
      doc.innerHTML = blockHtml(sliceItem(it, a, b));
      const el = doc.firstElementChild;
      return el ? el.getBoundingClientRect().height : 0;
    };
    let start = 0;
    while (start < n) {
      const firstH = H(start, start + 1);
      let best = start + 1, bestH = firstH;
      if (firstH <= limit) {
        let lo = start + 1, hi = n;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const h = H(start, mid);
          if (h <= limit) { best = mid; bestH = h; lo = mid + 1; } else { hi = mid - 1; }
        }
      }
      out.push(Object.assign(sliceItem(it, start, best), { h: bestH }));
      start = best;
    }
    return out;
  }

  const isHead = (it) => it.kind === 'chap' || it.kind === 'h1' ||
    it.kind === 'h2' || it.kind === 'fnhead';

  /** 자투리 자리에 들어갈 만큼만 앞에서 잘라 냅니다 (절 경계). */
  function splitFit(doc, it, room, minH) {
    const n = it.units.length;
    const H = (b) => {
      doc.innerHTML = blockHtml(sliceItem(it, 0, b));
      const el = doc.firstElementChild;
      return el ? el.getBoundingClientRect().height : 0;
    };
    let lo = 1, hi = n - 1, best = 0, bestH = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const h = H(mid);
      if (h <= room) { best = mid; bestH = h; lo = mid + 1; } else { hi = mid - 1; }
    }
    if (!best || bestH < minH) return null;
    return {
      head: Object.assign(sliceItem(it, 0, best), { h: bestH }),
      rest: Object.assign(sliceItem(it, best, n), { h: 0, part: true })
    };
  }

  /** 블록 높이를 재고(긴 블록은 나누고) 쪽에 담습니다. */
  function paginate(baseItems, g, limit) {
    const doc = measureDoc(g);
    document.body.appendChild(doc);

    // 한 번에 붙이고 한 번에 읽습니다 (블록마다 되짚지 않도록)
    let html = '';
    for (let i = 0; i < baseItems.length; i++) html += blockHtml(baseItems[i]);
    doc.innerHTML = html;
    const kids = doc.children;
    // 높이는 먼저 모두 읽어 둡니다 (아래에서 doc 을 다시 쓰기 때문)
    const heights = new Array(baseItems.length);
    for (let i = 0; i < baseItems.length; i++) {
      heights[i] = kids[i] ? kids[i].getBoundingClientRect().height : 0;
    }

    const items = [];
    for (let i = 0; i < baseItems.length; i++) {
      const it = baseItems[i];
      const h = heights[i];
      if (!it.units || h <= limit) {
        items.push(Object.assign({}, it, { h: h }));
      } else {
        const chunks = splitItem(doc, it, limit);
        for (let k = 0; k < chunks.length; k++) items.push(chunks[k]);
      }
    }

    const lineH = g.fs * 0.352778 * 1.78 * MM;      // 한 줄 높이(px)
    const pages = [];
    let cur = [], y = 0;
    const flush = () => { if (cur.length) { pages.push(cur); cur = []; y = 0; } };

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const nx = items[i + 1];
      const head = isHead(it);
      // 머리말만 쪽 끝에 남지 않도록, 뒤따르는 소제목과 본문 몇 줄을 함께 봅니다
      let need = it.h;
      if (head) {
        let j = i + 1, add = 0;
        while (j < items.length && isHead(items[j])) { add += items[j].h; j++; }
        const nxt = items[j];
        // 소제목 아래에 최소 몇 줄은 함께 있어야 쪽 끝에 홀로 남지 않습니다
        const lines = it.kind === 'chap' ? 7 : 4;
        need += add + (nxt ? Math.min(nxt.h, lineH * lines) : 0);
      }

      if (cur.length && y + need > limit) {
        // 쪽 아래가 비면, 다음 블록을 절 경계에서 나눠 채웁니다
        const room = limit - y;
        if (!head && it.units && it.units.length > 2 && room > lineH * 3.2) {
          const fit = splitFit(doc, it, room, lineH * 2.2);
          if (fit) {
            cur.push(fit.head);
            flush();
            items.splice(i + 1, 0, fit.rest);
            continue;
          }
        }
        flush();
      }
      cur.push(it);
      y += it.h;
    }
    flush();

    document.body.removeChild(doc);
    return pages;
  }

  function pageMetas(groups, book) {
    const duplex = st.cfg.mode === 'duplex';
    if (duplex && groups.length % 2) groups.push([]);      // 양면은 짝수 쪽으로
    return groups.map((blocks, i) => {
      const no = i + 1;
      const chs = blocks.map((b) => b.ch).filter(Boolean);
      let label = '';
      if (chs.length) {
        const a = Math.min.apply(null, chs), b = Math.max.apply(null, chs);
        label = (a === b ? a + '장' : a + '–' + b + '장');
      }
      return {
        no: no, blocks: blocks,
        noteRight: duplex ? (no % 2 === 1) : (st.cfg.noteSide !== 'left'),
        chapLabel: label,
        bookName: book.name || ''
      };
    });
  }

  /* ---------------- 종이 쪽 ---------------- */
  let patSeq = 0;

  /* 필기 공간의 줄·점·모눈은 SVG 무늬로 그립니다.
     (CSS 그라디언트 배경은 PDF로 인쇄할 때 빠지는 경우가 있습니다.) */
  function noteHtml(g) {
    const s = NOTE[st.cfg.noteStyle] || NOTE.blank;
    if (g.noteW <= 0.5) {
      return '<div class="fl-note" style="width:' + fx(Math.max(0, g.noteW)) + 'mm;border:0"></div>';
    }
    if (!s.step) return '<div class="fl-note" style="width:' + fx(g.noteW) + 'mm"></div>';

    const step = s.step * MM;                    // mm → CSS px
    const mid = step / 2;
    let shape = '';
    if (s.id === 'line') {
      shape = '<line x1="0" y1="0" x2="' + fx(step) + '" y2="0" stroke="#DBD4C3" stroke-width=".7"/>';
    } else if (s.id === 'dot') {
      shape = '<circle cx="' + fx(mid) + '" cy="' + fx(mid) + '" r=".55" fill="#D3CCBB"/>';
    } else if (s.id === 'grid') {
      shape = '<path d="M0 0H' + fx(step) + 'M0 0V' + fx(step) + '" fill="none" stroke="#DED8C8" stroke-width=".5"/>';
    }
    const pid = 'flp' + (++patSeq);
    return '<div class="fl-note" style="width:' + fx(g.noteW) + 'mm">' +
      '<svg class="fl-noteg" width="100%" height="100%" aria-hidden="true">' +
        '<defs><pattern id="' + pid + '" width="' + fx(step) + '" height="' + fx(step) +
          '" patternUnits="userSpaceOnUse">' + shape + '</pattern></defs>' +
        '<rect width="100%" height="100%" fill="url(#' + pid + ')"/>' +
      '</svg></div>';
  }

  function pageEl(pg) {
    const g = geom(), P = g.p;
    const el = document.createElement('div');
    el.className = 'fl-page fl-doc' + (pg.noteRight ? ' nr' : ' nl') +
      (st.cfg.color === 'mono' ? ' fl-mono' : '') + (st.cfg.fns ? '' : ' fl-nofn');
    el.setAttribute('data-theme', 'light');
    el.dataset.no = pg.no;
    el.style.width = fx(P.w) + 'mm';
    el.style.height = fx(P.h) + 'mm';
    el.style.setProperty('--fs', g.fs + 'pt');
    el.style.setProperty('--lh', '1.78');
    el.style.setProperty('--fam', famCss());

    const L = pg.noteRight ? g.m.inner : g.m.outer;
    const R = pg.noteRight ? g.m.outer : g.m.inner;

    const inner = document.createElement('div');
    inner.className = 'fl-in';
    inner.style.left = fx(L) + 'mm';
    inner.style.right = fx(R) + 'mm';
    inner.style.top = fx(g.m.top) + 'mm';
    inner.innerHTML =
      '<div class="fl-ph" style="height:' + fx(g.headH) + 'mm">' +
        '<span class="fl-phb">' + esc(pg.bookName) + '</span>' +
        '<span class="fl-phc">' + esc(pg.chapLabel) + '</span>' +
      '</div>' +
      '<div class="fl-cols" style="gap:' + fx(g.m.gutter) + 'mm">' +
        '<div class="fl-text" style="width:' + fx(g.textW) + 'mm"></div>' +
        noteHtml(g) +
      '</div>' +
      '<div class="fl-pf" style="height:' + fx(g.m.bottom) + 'mm">' +
        '<div class="fl-pfw" style="width:' + fx(g.textW) + 'mm">' +
          '<i></i><span class="fl-pn">' + pg.no + '</span>' +
        '</div>' +
      '</div>';
    el.appendChild(inner);

    const text = inner.querySelector('.fl-text');
    let body = '';
    for (let i = 0; i < pg.blocks.length; i++) body += blockHtml(pg.blocks[i]);
    text.innerHTML = body;

    return el;
  }


  function skeletonLimit(g) {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-30000px;top:0;visibility:hidden;pointer-events:none';
    host.appendChild(pageEl({ no: 1, blocks: [], noteRight: true, chapLabel: '', bookName: '' }));
    document.body.appendChild(host);
    const t = host.querySelector('.fl-text');
    const h = t ? t.getBoundingClientRect().height : 0;
    document.body.removeChild(host);
    return Math.max(80, Math.floor(h) - 1);
  }

  /* ---------------- 조판 실행 ---------------- */
  async function loadBook() {
    const id = st.cfg.bookId;
    if (st.book && st.bookId === id) return st.book;
    let b = null;
    try {
      b = st.host && st.host.getBook ? await st.host.getBook(id) : null;
    } catch (e) { b = null; }
    if (!b || !b.ch) return null;
    st.book = b;
    st.bookId = id;
    return b;
  }

  function setWhat(msg) { if (dom.what) dom.what.textContent = msg; }

  async function relayout() {
    const tok = ++st.token;
    st.busy = true;
    if (dom.err) dom.err.style.display = 'none';
    setWhat('조판 중…');

    const book = await loadBook();
    if (tok !== st.token) return;
    if (!book) {
      st.busy = false;
      if (dom.err) { dom.err.textContent = '본문을 불러오지 못했습니다.'; dom.err.style.display = ''; }
      setWhat('조판하지 못했습니다');
      return;
    }

    const rng = rangeOf();
    const key = [st.bookId, rng[0], rng[1], st.cfg.fns ? 1 : 0].join('|');
    if (!st.flow || st.flow.key !== key) {
      st.flow = { key: key, items: buildFlow(book, rng[0], rng[1]) };
      st.els = {};
    }

    const g = geom();
    const limit = skeletonLimit(g);
    const groups = paginate(st.flow.items, g, limit);
    if (tok !== st.token) return;

    st.pages = pageMetas(groups, book);
    st.els = {};
    const per = st.cfg.mode === 'duplex' ? 2 : 1;
    const maxSpread = Math.max(0, Math.ceil(st.pages.length / per) - 1);
    if (st.spread > maxSpread) st.spread = maxSpread;

    st.busy = false;
    setWhat(st.pages.length + '쪽으로 조판했습니다');
    paint();
  }

  let relayoutTimer = null;
  function relayoutSoon(ms) {
    clearTimeout(relayoutTimer);
    relayoutTimer = setTimeout(relayout, ms == null ? 160 : ms);
  }

  /* ---------------- 미리보기 ---------------- */
  function pageElFor(i) {
    if (!st.els[i]) st.els[i] = pageEl(st.pages[i]);
    return st.els[i];
  }

  function paint() {
    if (!dom.spread) return;
    const g = geom();
    const per = st.cfg.mode === 'duplex' ? 2 : 1;
    const total = Math.max(1, Math.ceil(st.pages.length / per));
    st.spread = Math.max(0, Math.min(st.spread, total - 1));

    const idx = [];
    for (let k = 0; k < per; k++) {
      const i = st.spread * per + k;
      if (i < st.pages.length) idx.push(i);
    }
    dom.spread.innerHTML = '';
    idx.forEach((i) => dom.spread.appendChild(pageElFor(i)));

    const first = idx.length ? idx[0] + 1 : 0;
    const last = idx.length ? idx[idx.length - 1] + 1 : 0;
    dom.cnt.textContent = st.pages.length
      ? (first === last ? first + ' / ' + st.pages.length + '쪽' : first + '–' + last + ' / ' + st.pages.length + '쪽')
      : '쪽 없음';
    dom.prev.disabled = st.spread <= 0;
    dom.next.disabled = st.spread >= total - 1;

    dom.trim.textContent = g.p.label + ' · ' + g.p.note;
    dom.sum.textContent = summaryText();
    dom.specs.innerHTML = specsHtml(g);
    requestAnimationFrame(fit);
  }

  function fit() {
    if (!dom.frame || !dom.spread) return;
    const canvas = dom.canvas;
    const availW = Math.max(120, canvas.clientWidth - 20);
    const availH = Math.max(120, canvas.clientHeight - 20);
    const n = Math.max(1, dom.spread.children.length);
    const g = geom();
    const gap = 4;
    const wPx = (g.p.w * n + gap * (n - 1)) * MM;
    const hPx = g.p.h * MM;
    const k = Math.min(1, availW / wPx, availH / hPx);
    dom.frame.style.width = Math.round(wPx * k) + 'px';
    dom.frame.style.height = Math.round(hPx * k) + 'px';
    dom.spread.style.transform = 'scale(' + k + ')';
  }

  function goSpread(dir) {
    const per = st.cfg.mode === 'duplex' ? 2 : 1;
    const total = Math.max(1, Math.ceil(st.pages.length / per));
    const next = Math.max(0, Math.min(total - 1, st.spread + dir));
    if (next === st.spread) return;
    st.spread = next;
    paint();
  }

  function summaryText() {
    const g = geom(), m = metaOf(st.cfg.bookId) || {};
    const rng = rangeOf();
    const n = NOTE[st.cfg.noteStyle].label;
    return (m.name || '') +
      (rng[0] === rng[1] ? ' ' + rng[0] + '장' : ' ' + rng[0] + '–' + rng[1] + '장') +
      ' · ' + MODES[st.cfg.mode].label + ' ' + g.p.label +
      ' · 필기 ' + st.cfg.noteRatio + '% ' + n +
      ' · ' + (st.cfg.color === 'mono' ? '흑백' : '컬러') +
      ' · ' + st.pages.length + '쪽';
  }

  function specsHtml(g) {
    const chars = Math.max(1, Math.floor(g.textW / (g.fs * 0.352778)));
    return '' +
      '<div><dt>판면 폭</dt><dd>' + fx(g.textW) + ' mm</dd></div>' +
      '<div><dt>필기 폭</dt><dd>' + fx(g.noteW) + ' mm</dd></div>' +
      '<div><dt>한 줄 글자</dt><dd>약 ' + chars + '자</dd></div>' +
      '<div><dt>전체 쪽수</dt><dd>' + st.pages.length + '쪽</dd></div>';
  }

  /* ---------------- 인쇄 ---------------- */
  function ensureRoot() {
    let r = document.getElementById('fl-print-root');
    if (!r) {
      r = document.createElement('div');
      r.id = 'fl-print-root';
      r.setAttribute('aria-hidden', 'true');
      document.body.appendChild(r);
    }
    return r;
  }

  function pageCssEl() {
    let s = document.getElementById('fl-pagecss');
    if (!s) {
      s = document.createElement('style');
      s.id = 'fl-pagecss';
      document.head.appendChild(s);
    }
    return s;
  }

  /** 조판한 모든 쪽을 인쇄용 자리에 채웁니다 (window.print / page.pdf 직전). */
  function preparePrint() {
    if (!st.pages.length) return false;
    const g = geom();
    const root = ensureRoot();
    root.innerHTML = '';
    for (let i = 0; i < st.pages.length; i++) root.appendChild(pageEl(st.pages[i]));
    pageCssEl().textContent = '@page{size:' + fx(g.p.w) + 'mm ' + fx(g.p.h) + 'mm;margin:0}';
    return true;
  }

  function restorePrint() {
    const root = document.getElementById('fl-print-root');
    if (root) root.innerHTML = '';
  }

  function doPrint() {
    if (!st.pages.length || st.busy) return;
    preparePrint();
    try {
      window.print();
    } finally {
      setTimeout(restorePrint, 400);
    }
  }

  /* ---------------- 모달 ---------------- */
  function chips(list, cur) {
    return list.map((it) =>
      '<button type="button" data-v="' + it[0] + '"' +
      (String(it[0]) === String(cur) ? ' class="on"' : '') + '>' + it[1] + '</button>').join('');
  }

  function ensureDom() {
    if (dom.modal) return;
    const el = document.createElement('div');
    el.className = 'fl-modal';
    el.id = 'fl-modal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', '출력 / PDF');
    el.innerHTML =
      '<div class="fl-mh">' +
        '<div><span class="fl-eyebrow">여백성경 조판</span><h2>출력 / PDF</h2></div>' +
        '<span class="fl-sum" id="flSum">–</span>' +
        '<button class="fl-x" id="flClose" type="button" aria-label="닫기">✕</button>' +
      '</div>' +
      '<div class="fl-mb">' +
        '<section class="fl-stage" aria-label="쪽 미리보기">' +
          '<div class="fl-sbar"><span class="dot"></span><span id="flWhat">조판 준비 중</span>' +
            '<span class="trim" id="flTrim"></span></div>' +
          '<div class="fl-canvas" id="flCanvas">' +
            '<div class="fl-frame" id="flFrame"><div class="fl-spread" id="flSpread"></div></div>' +
          '</div>' +
          '<div class="fl-pager">' +
            '<button type="button" id="flPrev" aria-label="이전 쪽">‹</button>' +
            '<span class="cnt" id="flCnt">–</span>' +
            '<button type="button" id="flNext" aria-label="다음 쪽">›</button>' +
          '</div>' +
        '</section>' +
        '<aside class="fl-set" aria-label="조판 설정">' +
          '<p class="fl-err" id="flErr" style="display:none"></p>' +
          '<div class="fl-group">' +
            '<h3>범위 <span>무엇을 찍을까</span></h3>' +
            '<div class="fl-field"><select class="fl-select" id="flBook" aria-label="책 선택"></select></div>' +
            '<div class="fl-field">' +
              '<div class="fl-chips" id="flRange">' +
                '<button type="button" data-v="book">이 책 전체</button>' +
                '<button type="button" data-v="current">현재 장</button>' +
                '<button type="button" data-v="range">장 범위</button>' +
              '</div>' +
              '<div class="fl-range">' +
                '<input type="number" id="flFrom" min="1" value="1" aria-label="시작 장">' +
                '<span>장</span><span>~</span>' +
                '<input type="number" id="flTo" min="1" value="1" aria-label="끝 장">' +
                '<span>장</span>' +
              '</div>' +
              '<p class="hint" id="flRangeHint"></p>' +
            '</div>' +
          '</div>' +
          '<div class="fl-group">' +
            '<h3>판형 <span>인쇄와 제본</span></h3>' +
            '<div class="fl-chips" id="flMode"></div>' +
            '<p class="hint" id="flModeHint"></p>' +
          '</div>' +
          '<div class="fl-group">' +
            '<h3>용지 <span>종이 크기</span></h3>' +
            '<div class="fl-chips" id="flPaper"></div>' +
            '<p class="hint" id="flPaperHint"></p>' +
          '</div>' +
          '<div class="fl-group">' +
            '<h3>필기 공간 <span>여백의 성격</span></h3>' +
            '<div class="fl-field">' +
              '<span class="lab">스타일</span>' +
              '<div class="fl-chips" id="flNoteStyle"></div>' +
            '</div>' +
            '<div class="fl-field">' +
              '<div class="fl-rowval"><span class="lab" style="margin:0">여백 비율</span>' +
                '<b id="flRatioVal">35%</b></div>' +
              '<input class="fl-slider" type="range" id="flRatio" min="0" max="50" step="1" value="35" aria-label="필기 여백 비율">' +
            '</div>' +
            '<div class="fl-field" id="flSideField">' +
              '<span class="lab">필기 위치</span>' +
              '<div class="fl-chips" id="flSide">' +
                '<button type="button" data-v="right">오른쪽</button>' +
                '<button type="button" data-v="left">왼쪽</button>' +
              '</div>' +
            '</div>' +
            '<div class="fl-field">' +
              '<div class="fl-rowval"><span class="lab" style="margin:0">본문 글자</span>' +
                '<b id="flSizeVal">10.4pt</b></div>' +
              '<input class="fl-slider" type="range" id="flSize" min="7.5" max="13" step="0.2" aria-label="본문 글자 크기">' +
            '</div>' +
          '</div>' +
          '<div class="fl-group">' +
            '<h3>마감 <span>색과 각주</span></h3>' +
            '<div class="fl-field">' +
              '<span class="lab">색상</span>' +
              '<div class="fl-chips" id="flColor">' +
                '<button type="button" data-v="color">컬러 (8색)</button>' +
                '<button type="button" data-v="mono">흑백</button>' +
              '</div>' +
            '</div>' +
            '<div class="fl-field">' +
              '<span class="lab">각주</span>' +
              '<div class="fl-chips" id="flFns">' +
                '<button type="button" data-v="1">포함</button>' +
                '<button type="button" data-v="0">제외</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<dl class="fl-specs" id="flSpecs"></dl>' +
          '<button class="fl-make" id="flMake" type="button">PDF로 저장 / 인쇄</button>' +
          '<p class="fl-note">인쇄 대화상자에서 <b>PDF로 저장</b>을 고르면 이 조판 그대로 저장됩니다. ' +
            '여백은 ‘기본’, 배율은 100%로 두세요.</p>' +
        '</aside>' +
      '</div>';
    document.body.appendChild(el);

    dom.modal = el;
    dom.sum = el.querySelector('#flSum');
    dom.what = el.querySelector('#flWhat');
    dom.trim = el.querySelector('#flTrim');
    dom.canvas = el.querySelector('#flCanvas');
    dom.frame = el.querySelector('#flFrame');
    dom.spread = el.querySelector('#flSpread');
    dom.cnt = el.querySelector('#flCnt');
    dom.prev = el.querySelector('#flPrev');
    dom.next = el.querySelector('#flNext');
    dom.specs = el.querySelector('#flSpecs');
    dom.err = el.querySelector('#flErr');
    dom.book = el.querySelector('#flBook');
    dom.range = el.querySelector('#flRange');
    dom.rangeHint = el.querySelector('#flRangeHint');
    dom.from = el.querySelector('#flFrom');
    dom.to = el.querySelector('#flTo');
    dom.mode = el.querySelector('#flMode');
    dom.modeHint = el.querySelector('#flModeHint');
    dom.paper = el.querySelector('#flPaper');
    dom.paperHint = el.querySelector('#flPaperHint');
    dom.noteStyle = el.querySelector('#flNoteStyle');
    dom.ratio = el.querySelector('#flRatio');
    dom.ratioVal = el.querySelector('#flRatioVal');
    dom.side = el.querySelector('#flSide');
    dom.sideField = el.querySelector('#flSideField');
    dom.size = el.querySelector('#flSize');
    dom.sizeVal = el.querySelector('#flSizeVal');
    dom.color = el.querySelector('#flColor');
    dom.fns = el.querySelector('#flFns');
    dom.make = el.querySelector('#flMake');

    el.querySelector('#flClose').onclick = close;
    dom.prev.onclick = () => goSpread(-1);
    dom.next.onclick = () => goSpread(1);
    dom.make.onclick = doPrint;

    dom.book.onchange = () => {
      st.cfg.bookId = dom.book.value;
      st.cfg.from = 1; st.cfg.to = ncOf(st.cfg.bookId);
      st.book = null; st.flow = null;
      saveCfg(); syncControls(); relayout();
    };

    dom.range.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      st.cfg.range = b.dataset.v;
      if (st.cfg.range === 'range') {
        const rng = rangeOf();
        st.cfg.from = rng[0];
        st.cfg.to = Math.min(ncOf(st.cfg.bookId), rng[0] + 4);
      }
      saveCfg(); syncControls(); relayout();
    });

    const num = () => {
      st.cfg.from = parseInt(dom.from.value, 10) || 1;
      st.cfg.to = parseInt(dom.to.value, 10) || st.cfg.from;
      saveCfg(); relayoutSoon(220);
    };
    dom.from.onchange = num;
    dom.to.onchange = num;

    dom.mode.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b || b.dataset.v === st.cfg.mode) return;
      st.cfg.mode = b.dataset.v;
      saveCfg(); syncControls(); relayout();
    });

    dom.paper.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b || b.dataset.v === st.cfg.paper) return;
      st.cfg.paper = b.dataset.v;
      st.cfg.size = 0;
      saveCfg(); syncControls(); relayout();
    });

    dom.noteStyle.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b || b.dataset.v === st.cfg.noteStyle) return;
      st.cfg.noteStyle = b.dataset.v;
      saveCfg(); syncControls();
      st.els = {}; paint();          // 배경 무늬만 바뀝니다 — 다시 재지 않고 그립니다
    });

    dom.side.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b || b.dataset.v === st.cfg.noteSide) return;
      st.cfg.noteSide = b.dataset.v;
      saveCfg(); syncControls(); relayoutSoon(60);
    });

    dom.color.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b || b.dataset.v === st.cfg.color) return;
      st.cfg.color = b.dataset.v;
      saveCfg(); syncControls();
      st.els = {}; paint();
    });

    dom.fns.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      const on = b.dataset.v === '1';
      if (on === !!st.cfg.fns) return;
      st.cfg.fns = on;
      saveCfg(); syncControls(); relayout();
    });

    dom.ratio.addEventListener('input', () => {
      st.cfg.noteRatio = parseInt(dom.ratio.value, 10);
      dom.ratioVal.textContent = st.cfg.noteRatio + '%';
      relayoutSoon(200);
    });
    dom.ratio.addEventListener('change', () => { saveCfg(); relayoutSoon(60); });

    dom.size.addEventListener('input', () => {
      st.cfg.size = parseFloat(dom.size.value);
      dom.sizeVal.textContent = st.cfg.size.toFixed(1) + 'pt';
      relayoutSoon(200);
    });
    dom.size.addEventListener('change', () => { saveCfg(); relayoutSoon(60); });

    window.addEventListener('resize', () => { if (isOpen()) fit(); });
    window.addEventListener('beforeprint', () => { if (isOpen()) preparePrint(); });
    window.addEventListener('afterprint', restorePrint);

    document.addEventListener('keydown', (e) => {
      if (!isOpen()) return;
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); return; }
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
      if (typing) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.stopPropagation(); e.preventDefault(); goSpread(1); return; }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.stopPropagation(); e.preventDefault(); goSpread(-1); return; }
      if (e.key === '/' || ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K'))) {
        e.stopPropagation(); e.preventDefault();
      }
    }, true);
  }

  function fillBooks() {
    const books = (st.host && st.host.index && st.host.index.books) || [];
    dom.book.innerHTML = books.map((b) =>
      '<option value="' + b.id + '">' + esc(b.name) + '</option>').join('');
  }

  function syncControls() {
    const c = st.cfg;
    dom.book.value = c.bookId;
    dom.range.innerHTML = chips([['book', '이 책 전체'], ['current', '현재 장'], ['range', '장 범위']], c.range);
    dom.mode.innerHTML = chips(Object.keys(MODES).map((k) => [k, MODES[k].label]), c.mode);
    dom.paper.innerHTML = chips(Object.keys(PAPER).map((k) => [k, PAPER[k].label]), c.paper);
    dom.noteStyle.innerHTML = chips(Object.keys(NOTE).map((k) => [k, NOTE[k].label]), c.noteStyle);
    dom.side.innerHTML = chips([['right', '오른쪽'], ['left', '왼쪽']], c.noteSide);
    dom.color.innerHTML = chips([['color', '컬러 (8색)'], ['mono', '흑백']], c.color);
    dom.fns.innerHTML = chips([['1', '포함'], ['0', '제외']], c.fns ? '1' : '0');

    const nc = ncOf(c.bookId);
    const rng = rangeOf();
    dom.from.max = nc; dom.to.max = nc;
    dom.from.value = rng[0]; dom.to.value = rng[1];
    dom.from.disabled = dom.to.disabled = (c.range !== 'range');

    dom.rangeHint.textContent = c.range === 'book'
      ? '1–' + nc + '장 전체를 조판합니다.'
      : c.range === 'current'
        ? rng[0] + '장 한 장만 조판합니다.'
        : rng[0] + '–' + rng[1] + '장을 조판합니다.';

    dom.modeHint.textContent = MODES[c.mode].hint;
    dom.paperHint.textContent = PAPER[c.paper].note;
    dom.sideField.style.display = c.mode === 'single' ? '' : 'none';

    dom.ratio.value = c.noteRatio;
    dom.ratioVal.textContent = c.noteRatio + '%';
    const fs = Number(c.size) > 0 ? Number(c.size) : PAPER[c.paper].fs;
    dom.size.value = fs;
    dom.sizeVal.textContent = fs.toFixed(1) + 'pt';
  }

  function isOpen() { return !!(dom.modal && dom.modal.classList.contains('on')); }

  function open(opts) {
    st.host = opts || {};
    loadCfg();
    // 지금 읽고 있는 책으로 시작합니다 (설정은 그대로 기억)
    if (st.host.bookId && metaOf(st.host.bookId)) st.cfg.bookId = st.host.bookId;
    if (!st.cfg.bookId || !metaOf(st.cfg.bookId)) {
      st.cfg.bookId = ((st.host.index && st.host.index.books[0]) || {}).id || '01';
    }
    st.cfg.from = Math.min(Math.max(1, st.cfg.from || 1), ncOf(st.cfg.bookId));
    st.cfg.to = Math.min(Math.max(st.cfg.from, st.cfg.to || 1), ncOf(st.cfg.bookId));
    ensureDom();
    fillBooks();
    syncControls();
    st.book = null;
    st.flow = null;
    st.pages = [];
    st.els = {};
    st.spread = 0;
    dom.modal.classList.add('on');
    document.body.classList.add('fl-open');
    dom.spread.innerHTML = '';
    dom.cnt.textContent = '–';
    dom.specs.innerHTML = '';
    setWhat('조판 준비 중');
    if (dom.canvas) dom.canvas.scrollTop = 0;
    relayout();
  }

  function close() {
    st.token++;
    if (dom.modal) dom.modal.classList.remove('on');
    document.body.classList.remove('fl-open');
    restorePrint();
  }

  global.FLPrint = {
    open: open,
    close: close,
    isOpen: isOpen,
    preparePrint: preparePrint,
    restorePrint: restorePrint,
    print: doPrint,
    state: function () {
      return {
        open: isOpen(),
        pages: st.pages.length,
        cfg: Object.assign({}, st.cfg),
        spread: st.spread,
        flowItems: st.flow ? st.flow.items.length : 0,
        pageBlocks: st.pages.map(function (p) { return p.blocks.length; }),
        pageCss: (document.getElementById('fl-pagecss') || {}).textContent || ''
      };
    }
  };
})(window);
