/* =========================================================
   render.js — 새번역 말씀노트 조판 렌더러
   · 대화: 담화 전체를 하나의 들여쓴 블록으로(여러 절에 걸쳐도 이어짐)
   · 시: 행 · 연 여백
   · 편지·칙령 박스 / 성경 인용 박스
   · 개요 세로 막대 · 각주 칩
   · 예수 어록 빨간 글자 / 신적 발언
   ========================================================= */
(function (global) {
  'use strict';
  const { colorize, esc } = global.FLColor;

  const NT_FROM = 40;
  const RAIL_COLORS = ['#4A6B8A', '#6D5578', '#4E6E5B', '#7A6440', '#4B5275', '#7A4F52'];

  const SPEECH_RE = /([가-힣]{1,10})(이|가|께서)\s+([^"'.!?]{0,45}?)(말하였|말했|말하|물었|물어|대답하|대답했|이르되|이르시|외치|부르짖|여쭈|명하|명령하|일렀|전하|가르치|대답|말씀하)/g;
  const DIVINE_SUBJ = /하나님|하느님|주님|여호와|예수|그리스도|성령|주 하나님/;

  function isNT(bookId) { return Number(bookId) >= NT_FROM; }

  function chip(id, fnTable) {
    const rec = fnTable && fnTable[Number(id)];
    const letter = rec ? rec[0] : String.fromCharCode(97 + (Number(id) % 26));
    return '<button class="fn" data-fn="' + id + '">' + esc(letter) + '</button>';
  }

  /* ---------- 텍스트 → 런(따옴표 상태 유지) ----------
     run.type: 'n'(서사) 'q'(큰따옴표) 's'(작은따옴표) '/'(닫힘)          */
  function parseRuns(text, st) {
    const runs = [];
    let cur = { type: st.dq ? 'q' : (st.sq ? 's' : 'n'), lvl: st.dq ? (st.sq ? 2 : 1) : (st.sq ? 1 : 0), text: '' };
    const flush = () => { if (cur.text) runs.push(cur); };

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '⟦') {
        const j = text.indexOf('⟧', i);
        if (j > i) {
          cur.text += '\u0001' + text.slice(i + 1, j) + '\u0002';
          i = j;
          continue;
        }
      }
      if (ch === '"') {
        if (st.dq) {
          flush();
          runs.push({ type: '/', lvl: st.lvl });
          st.dq = false; st.lvl = 0;
          cur = { type: st.sq ? 's' : 'n', lvl: st.sq ? 1 : 0, text: '' };
        } else {
          flush();
          st.dq = true; st.lvl = st.sq ? 2 : 1;
          cur = { type: 'q', lvl: st.lvl, text: '', open: true };
        }
        continue;
      }
      if (ch === "'") {
        if (st.sq) {
          flush();
          runs.push({ type: '/', lvl: st.dq ? 2 : 1 });
          st.sq = false;
          cur = { type: st.dq ? 'q' : 'n', lvl: st.dq ? 1 : 0, text: '' };
        } else {
          flush();
          st.sq = true;
          cur = { type: 's', lvl: st.dq ? 2 : 1, text: '', open: true };
        }
        continue;
      }
      cur.text += ch;
    }
    flush();
    return runs;
  }

  /* ---------- 화자 추적 ---------- */
  function updateSpeaker(narration, st, bookId) {
    if (!narration) return;
    SPEECH_RE.lastIndex = 0;
    let m, last = null;
    while ((m = SPEECH_RE.exec(narration))) last = m;
    if (!last) return;
    const subj = last[1];
    if (/예수|그리스도|메시아|인자/.test(subj)) { st.speaker = 'jesus'; return; }
    if (DIVINE_SUBJ.test(subj)) {
      st.speaker = (isNT(bookId) && /주님/.test(subj) && !/하나님/.test(subj)) ? 'jesus' : 'divine';
      return;
    }
    st.speaker = 'other';
  }

  function headingHtml(text, ctx) {
    return esc(text).replace(/⟦(\d+)⟧/g, (_, id) => chip(id, ctx.fnTable));
  }

  function inner(r, ctx) {
    let html = colorize(r.text, ctx.opts);
    return html.replace(/\u0001(\d+)\u0002/g, (_, id) => chip(id, ctx.fnTable));
  }

  /* ---------- 절 흐름 → HTML (따옴표 블록은 담화 전체를 감싼다) ---------- */
  function renderStream(vs, ctx, opts) {
    opts = opts || {};
    const inline = !!opts.inline;       // 시 · 편지 박스 안에서는 한 줄 흐름
    const headless = !!opts.headless;   // <p> 태그 없이
    let html = '';
    let prevN = ctx.prevVerse || 0;
    let first = true;

    // 앞 블록에서 열린 담화는 이 블록에서 다시 열어 이어 준다
    if (!ctx.qstack) ctx.qstack = [];
    let emitted = ctx.qstack.length;
    for (const cls of ctx.qstack) html += '<span class="' + cls + '">';

    for (const v of vs) {
      const runs = parseRuns(v.t || '', ctx.state);
      const narration = runs.filter(r => r.type === 'n').map(r => r.text).join(' ');
      updateSpeaker(narration, ctx.state, ctx.bookId);

      let pendingVn = (v.n !== prevN) ? '<sup class="vn">' + v.n + '</sup>' : null;
      if (!pendingVn && !first) html += ' ';
      if (pendingVn && !first && !inline) html += ' ';

      for (const r of runs) {
        if (r.type === '/') {
          if (emitted > 0) { html += '</span>'; emitted--; if (ctx.qstack.length) ctx.qstack.pop(); }
          continue;
        }
        if (r.type === 'n') {
          if (pendingVn) { html += pendingVn; pendingVn = null; }
          html += inner(r, ctx);
          continue;
        }
        if (r.open) {
          let cls;
          if (r.type === 'q') {
            cls = (r.lvl >= 2 ? 'dq dq2' : 'dq') +
              (ctx.state.speaker === 'jesus' ? ' jw' : ctx.state.speaker === 'divine' ? ' dw' : '');
          } else {
            const long = (r.text || '').replace(/\u0001\d+\u0002/g, '').length >= 30;
            cls = (r.lvl >= 2 ? 'dq dq2 sq' : 'dq sq') + (long ? ' sqbox' : '');
          }
          if (inline) cls += ' inl';
          ctx.qstack.push(cls); emitted++;
          html += '<span class="' + cls + '">';
          if (pendingVn && !inline) { html += pendingVn; pendingVn = null; }
          html += '<i class="qm">' + (r.type === 'q' ? '"' : "'") + '</i>';
        }
        if (pendingVn) { html += pendingVn; pendingVn = null; }
        html += inner(r, ctx);
      }
      if (pendingVn) html += pendingVn;
      prevN = v.n;
      first = false;
    }
    while (emitted-- > 0) html += '</span>';
    ctx.prevVerse = prevN;
    return headless ? html : '<p class="v">' + html + '</p>';
  }

  /* ---------- 시 ---------- */
  function renderPoemVerses(vs, ctx) {
    let html = '', prevN = ctx.prevVerse || 0;
    if (!ctx.qstack) ctx.qstack = [];
    let emitted = 0;
    for (const v of vs) {
      const lines = v.l || [];
      const stanza = (v.sb && prevN && v.n !== prevN) ? ' stanza' : '';
      let linesHtml = '';
      lines.forEach((ln) => {
        const runs = parseRuns(ln, ctx.state);
        const narration = runs.filter(r => r.type === 'n').map(r => r.text).join(' ');
        updateSpeaker(narration, ctx.state, ctx.bookId);
        let lh = '';
        for (const r of runs) {
          if (r.type === '/') {
            if (emitted > 0) { lh += '</span>'; emitted--; if (ctx.qstack.length) ctx.qstack.pop(); }
            continue;
          }
          if (r.type === 'n') { lh += inner(r, ctx); continue; }
          if (r.open) {
            const cls = 'dq inl' + (r.lvl >= 2 ? ' dq2' : '') + (r.type === 's' ? ' sq' : '');
            ctx.qstack.push(cls); emitted++;
            lh += '<span class="' + cls + '"><i class="qm">' + (r.type === 'q' ? '"' : "'") + '</i>';
          }
          lh += inner(r, ctx);
        }
        linesHtml += '<span class="ln">' + lh + '</span>';
      });
      const g = (v.n !== prevN) ? v.n : '';
      html += '<div class="st' + stanza + '"><span class="gutter">' + g + '</span>' +
        '<div class="lines">' + linesHtml + '</div></div>';
      prevN = v.n;
    }
    while (emitted-- > 0) html += '</span>';
    ctx.prevVerse = prevN;
    return html;
  }

  /* ---------- 렌더 문맥 ----------
     장 하나를 이어서 그릴 때 쓰는 상태(따옴표·화자·각주표)입니다.
     출력 조판처럼 블록을 잘라 다시 그릴 때도 같은 문맥을 넘겨 씁니다. */
  function makeCtx(book, chObj, opts) {
    return {
      bookId: book.id, opts: opts || { mode: 'all' }, fnTable: (chObj && chObj.fn) || [],
      state: { dq: false, sq: false, lvl: 0, speaker: null }, prevVerse: 0, qstack: []
    };
  }

  /* ---------- 장 ---------- */
  function renderChapter(book, chObj, opts) {
    const ctx = makeCtx(book, chObj, opts);
    const blocks = chObj.b || [];
    let html = '';
    let sec = null;
    let secIdx = -1;

    const openSec = (title) => {
      if (sec !== null) html += '</div></section>';
      secIdx++;
      sec = title;
      const color = RAIL_COLORS[secIdx % RAIL_COLORS.length];
      html += '<section class="sec' + (title ? '' : ' sec-norail') + '" style="--oc:' + color + '">' +
        (title ? '<div class="rail" aria-hidden="true"><span>' + esc(String(title).replace(/⟦\d+⟧/g, '')) + '</span></div>' : '') +
        '<div class="sec-body">';
    };
    openSec('');

    for (const blk of blocks) {
      if (blk.k === 'h') {
        if (blk.l === 2) {
          html += '<p class="h2">' + headingHtml(blk.t, ctx) + '</p>';
        } else {
          openSec(blk.t);
          html += '<h2 class="h1">' + headingHtml(blk.t, ctx) + '</h2>';
        }
        continue;
      }
      if (blk.k === 'p') {
        html += '<div class="p">' + renderStream(blk.vs, ctx) + '</div>';
      } else if (blk.k === 'po') {
        html += '<div class="po">' + renderPoemVerses(blk.vs, ctx) + '</div>';
      } else if (blk.k === 'lt') {
        html += '<div class="box"><div class="box-ttl">' + esc(blk.ttl || '문서') + '</div>' +
          renderStream(blk.vs, ctx, { inline: true }) + '</div>';
      }
    }
    if (sec !== null) html += '</div></section>';
    return html;
  }

  global.FLRender = { renderChapter, makeCtx, renderStream, renderPoemVerses, RAIL_COLORS };
})(window);
