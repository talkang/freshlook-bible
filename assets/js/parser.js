/* =========================================================
   parser.js — 사용자가 불러온 새번역 TXT 파서 (브라우저)
   tools/parse_bible.py 와 같은 규칙
   ========================================================= */
(function (global) {
  'use strict';

  const VERSE_RE = /^(\d\d) (\d+):(\d+)(?: (.*))?$/;
  const BOOK_RE = /^(\d\d) 0:0 ([^,]+),([^,]+),(\d+)\s*$/;
  const TITLE_RE = /0:0 ([^,]+),([^,]+),(\d+)/;

  const POETRY_CHAPTERS = {
    '18': [3, 41], '19': [1, 150], '20': [1, 31], '21': [1, 12],
    '22': [1, 8], '25': [1, 5], '23': [40, 66]
  };
  const POETRY_RANGES = {
    '02': [[15, 1, 19]], '04': [[23, 1, 30], [24, 1, 25]],
    '05': [[32, 1, 52], [33, 1, 29]], '07': [[5, 1, 31]],
    '09': [[2, 1, 10]], '10': [[22, 1, 51]], '35': [[3, 1, 19]],
    '42': [[1, 46, 55], [1, 68, 79]]
  };
  const EPISTLES = {};
  for (let i = 45; i <= 66; i++) EPISTLES[String(i).padStart(2, '0')] = 1;

  const DOC_NOUN = '(편지|칙령|조서|회신|글|금령|증서|비문|문서|상소문)';
  const DOC_INTRO = new RegExp(DOC_NOUN + '[^."]{0,24}?(썼|써서|쓰고|써|보냈|보낸|보내|내렸|내린|내리|전했|전하|씁니|기록|적혀|적어|반포|올렸|올리)');
  const DOC_FOLLOW = new RegExp(DOC_NOUN + '[^.]{0,20}?다음과 같');
  const DOC_TITLE = [
    [/칙령/, '칙령'], [/조서/, '조서'], [/회신/, '회신'], [/금령/, '금령'],
    [/증서|계약서/, '문서'], [/편지|글|문서|비문/, '편지']
  ];
  const HEAD_RE = /<([^<>]{1,120})>/g;
  const SENT_END = ['.', '?', '!', '다', '요', '니', '오', '까', '죠', '"', "'", ')', ':'];

  function norm(s) {
    return s.replace(/\u00a0/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
  }

  function splitTrailingParen(text) {
    const t = text.replace(/\s+$/, '');
    if (!t.endsWith(')')) return [t, ''];
    let depth = 0;
    for (let i = t.length - 1; i >= 0; i--) {
      const c = t[i];
      if (c === ')') depth++;
      else if (c === '(') {
        depth--;
        if (depth === 0) return [t.slice(0, i).trim(), t.slice(i)];
      }
    }
    return [t, ''];
  }

  function parseFootnotes(block) {
    const inner = block.slice(1, -1);
    const parts = inner.split(/(?:^|(?<=\s))([a-z])(?=\s)/);
    if (!parts || parts[0].trim() !== '' || parts.length < 3) return null;
    const fns = [];
    for (let i = 1; i < parts.length; i += 2) {
      const letter = parts[i];
      const body = (parts[i + 1] || '').trim();
      if (body) fns.push([letter, body]);
    }
    const letters = fns.map(f => f[0]);
    if (new Set(letters).size !== letters.length) return null;
    return fns.length ? fns : null;
  }

  function stripMarkers(text, letters) {
    if (!letters.size) return text;
    let out = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (letters.has(ch)) {
        const prev = i > 0 ? text[i - 1] : '';
        const nxt = i + 1 < text.length ? text[i + 1] : '';
        const prevOk = i === 0 || ' ○<>"\'([{·•.”’'.includes(prev) || /\s/.test(prev);
        const nxtOk = !!nxt && (!/[\x00-\x7F]/.test(nxt) || '"\'<“‘'.includes(nxt));
        if (prevOk && nxtOk) { out += '⟦' + ch + '⟧'; continue; }
      }
      out += ch;
    }
    return out;
  }

  function segmentVerse(text) {
    const segs = [];
    let pos = 0;
    HEAD_RE.lastIndex = 0;
    let m;
    while ((m = HEAD_RE.exec(text))) {
      const before = text.slice(pos, m.index);
      const heading = m[1].trim();
      const b = before.replace(/\s+$/, '');
      const isBlock = !b || SENT_END.includes(b.slice(-1)) || b.endsWith('○') || !b.replace(/[ ○]/g, '');
      if (isBlock) {
        if (before.replace(/[ ○]/g, '')) segs.push(['t', before]);
        else if (before.includes('○')) segs.push(['para', '']);
        segs.push(['h', heading]);
      } else {
        segs.push(['t', before + heading]);
      }
      pos = m.index + m[0].length;
    }
    if (pos < text.length) segs.push(['t', text.slice(pos)]);
    return segs;
  }

  function splitParagraphs(segs) {
    const out = [];
    for (const [kind, text] of segs) {
      if (kind !== 't') { out.push([kind, text]); continue; }
      const pieces = text.split('○');
      pieces.forEach((piece, i) => {
        if (i > 0) out.push(['para', '']);
        const p = norm(piece).replace(/</g, '').replace(/>/g, '');
        if (p) out.push(['t', p]);
      });
    }
    return out;
  }

  function splitLines(text, minLen) {
    minLen = minLen || 10;
    const lines = [];
    let buf = '', inQ = false, i = 0;
    while (i < text.length) {
      const ch = text[i];
      buf += ch;
      if (ch === '"') inQ = !inQ;
      if (!inQ && ',.;?!'.includes(ch) && text[i + 1] === ' ') {
        if (buf.trim().length >= minLen && text.slice(i + 2).trim()) {
          lines.push(buf.trim()); buf = ''; i += 2; continue;
        }
      }
      i++;
    }
    if (buf.trim()) lines.push(buf.trim());
    if (lines.length > 1 && lines[lines.length - 1].length < 6) {
      lines[lines.length - 2] += ' ' + lines.pop();
    }
    return lines;
  }

  function isPoetry(bid, ch, v) {
    let r = POETRY_CHAPTERS[bid];
    if (r && ch >= r[0] && ch <= r[1]) return true;
    const rs = POETRY_RANGES[bid] || [];
    for (const [c, v1, v2] of rs) if (c === ch && v >= v1 && v <= v2) return true;
    return false;
  }

  function findLetterGroups(verses) {
    const groups = {};
    let i = 0;
    while (i < verses.length) {
      const [n, t] = verses[i];
      const head = t.replace(/^[○\s]+/, '');
      const c1 = DOC_INTRO.exec(head), c2 = DOC_FOLLOW.exec(head);
      const mo = (c1 && c2) ? (c1.index <= c2.index ? c1 : c2) : (c1 || c2);
      const qpos = head.indexOf('"');
      const okDoc = mo && (qpos < 0 || mo.index < qpos) &&
        !/(서판|율법책|책에|예언자들이)/.test(head.slice(0, mo.index + 1));
      if (okDoc && !head.includes('"') && i + 1 < verses.length &&
          verses[i + 1][1].replace(/^[○\s]+/, '').startsWith('"')) {
        let title = '편지';
        for (const [rx, name] of DOC_TITLE) if (rx.test(t)) { title = name; break; }
        let j = i + 1, collected = [], depth = 0;
        while (j < verses.length && collected.length < 30) {
          const s = verses[j][1];
          collected.push(verses[j][0]);
          depth += (s.match(/"/g) || []).length;
          if (depth % 2 === 0 && s.replace(/\s+$/, '').endsWith('"')) break;
          j++;
        }
        if (collected.length >= 2) {
          groups[collected[0]] = [title, collected];
          i = j + 1; continue;
        }
      }
      i++;
    }
    return groups;
  }

  function epistleSections(cleaned) {
    let head = [], close = [];
    let startIdx = null;
    cleaned.forEach((rec, i) => {
      HEAD_RE.lastIndex = 0;
      let m; const hs = [];
      while ((m = HEAD_RE.exec(rec[1]))) hs.push(m[1]);
      if (startIdx === null && hs.some(h => /인사|인사말|서론/.test(h))) startIdx = i;
    });
    if (startIdx !== null) {
      let endIdx = cleaned.length;
      for (let j = startIdx + 1; j < cleaned.length; j++) {
        HEAD_RE.lastIndex = 0;
        let m; const hs = [];
        while ((m = HEAD_RE.exec(cleaned[j][1]))) hs.push(m[1]);
        if (hs.some(h => !/인사|인사말/.test(h) && !h.startsWith('인사'))) { endIdx = j; break; }
      }
      head = cleaned.slice(startIdx, endIdx).map(r => r[0]);
    }
    for (const rec of cleaned) {
      HEAD_RE.lastIndex = 0;
      let m;
      while ((m = HEAD_RE.exec(rec[1]))) {
        if (/맺음|마지막 인사|끝인사|작별|축도|마지막 당부/.test(m[1])) close.push(rec[0]);
      }
    }
    return [head, close];
  }

  function boxText(text) {
    const parts = [];
    for (const [kind, seg] of splitParagraphs(segmentVerse(text))) {
      if (kind === 't') parts.push(seg);
      else if (kind === 'para' && parts.length) parts.push('');
    }
    let out = '';
    for (const p of parts) {
      if (p === '') out = out.replace(/\s+$/, '') + '\n';
      else if (!out || out.endsWith('\n')) out += p;
      else if (',.;:!?)]}'.includes(p[0])) out = out.replace(/\s+$/, '') + p;
      else out += ' ' + p;
    }
    return out.trim();
  }

  function addText(verse, seg) {
    if (seg && ',.;:!?)]}'.includes(seg[0])) verse.t = verse.t.replace(/\s+$/, '') + seg;
    else verse.t = verse.t.replace(/\s+$/, '') + ' ' + seg;
  }

  /* ---------- 메인 ---------- */
  function parse(raw) {
    const lines = raw.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
    const books = [];
    let cur = null;
    for (const ln of lines) {
      if (!ln.trim()) continue;
      let m = BOOK_RE.exec(ln);
      if (m) {
        cur = { id: m[1], abbr: m[2], name: m[3], nc: +m[4], ch: {} };
        books.push(cur); continue;
      }
      if (/^\s*'/.test(ln) && /0:0 /.test(ln) && !BOOK_RE.test(ln)) {
        const t = TITLE_RE.exec(ln);
        if (t) {
          cur = { id: '01', abbr: t[1], name: t[2], nc: +t[3], ch: {} };
          books.push(cur); continue;
        }
      }
      m = VERSE_RE.exec(ln);
      if (m && cur) {
        const c = +m[2], v = +m[3];
        if (v === 0) continue;
        (cur.ch[c] = cur.ch[c] || []).push([v, m[4] || '']);
      }
    }

    const index = { version: 1, translation: '표준새번역', books: [] };
    for (const b of books) {
      const bid = b.id;
      const outChapters = [], outline = [];
      let totalV = 0;
      const chapNums = Object.keys(b.ch).map(Number).sort((a, z) => a - z);
      for (const c of chapNums) {
        const vsRaw = b.ch[c];
        totalV += vsRaw.length;

        // 각주 분리
        const rawVerses = vsRaw.map(([v, text]) => {
          const [body, paren] = splitTrailingParen(norm(text));
          const fns = paren ? parseFootnotes(paren) : null;
          return [v, body, fns || []];
        });
        const fnTable = [];
        const defs = {};
        for (const [v, , fns] of rawVerses) {
          for (const [letter, t] of fns) {
            fnTable.push([letter, t]);
            (defs[letter] = defs[letter] || []).push([v, fnTable.length - 1]);
          }
        }
        const letters = new Set(Object.keys(defs));
        const cleaned = rawVerses.map(([v, body, fns]) => {
          body = stripMarkers(body, letters).replace(/⟦([a-z])⟧/g, (mm, letter) => {
            const cands = defs[letter];
            if (!cands) return '';
            let best = null;
            for (const [dv, idx] of cands) { if (dv <= v) best = idx; else break; }
            if (best === null) best = cands[0][1];
            return '⟦' + best + '⟧';
          });
          return [v, body, fns];
        });

        const plain = cleaned.map(r => [r[0], r[1]]);
        const groups = EPISTLES[bid] ? {} : findLetterGroups(plain);
        const inLetter = {}, letterTitle = {};
        for (const hv of Object.keys(groups)) {
          letterTitle[hv] = groups[hv][0];
          for (const n of groups[hv][1]) inLetter[n] = hv;
        }
        let epiHead = [], epiClose = [];
        if (EPISTLES[bid]) {
          [epiHead, epiClose] = epistleSections(cleaned);
          if (c !== 1) epiHead = [];
        }

        const blocks = [];
        let curBlock = null, curVerse = null;
        let firstHeadingDone = false, pendingStanza = false;

        const newBlock = (kind, kw) => {
          curBlock = Object.assign({ k: kind }, kw || {}, { vs: [] });
          blocks.push(curBlock); curVerse = null; return curBlock;
        };

        for (const [v, text, fns] of cleaned) {
          if (epiHead.length && v === epiHead[0]) newBlock('lt', { ttl: '서신 · 인사' });
          else if (epiClose.length && v === epiClose[0]) newBlock('lt', { ttl: '서신 · 맺음' });

          if (inLetter[v] !== undefined) {
            const h = inLetter[v];
            if (!curBlock || curBlock.lid !== h) newBlock('lt', { ttl: letterTitle[h], lid: h });
            const bt = boxText(text);
            const last = curBlock.vs[curBlock.vs.length - 1];
            if (last && last.n === v) last.t += ' ' + bt;
            else curBlock.vs.push({ n: v, t: bt });
            continue;
          }
          if ((epiHead.length && epiHead.indexOf(v) >= 0) || (epiClose.length && epiClose.indexOf(v) >= 0)) {
            if (!curBlock || curBlock.k !== 'lt') newBlock('lt', { ttl: '서신' });
            const bt = boxText(text);
            const last = curBlock.vs[curBlock.vs.length - 1];
            if (last && last.n === v) last.t += ' ' + bt;
            else curBlock.vs.push({ n: v, t: bt });
            continue;
          }

          for (const [kind, seg] of splitParagraphs(segmentVerse(text))) {
            if (kind === 'h') {
              let lvl = 1;
              if (!firstHeadingDone && isPoetry(bid, c, v) && !/^제\d권/.test(seg)) lvl = 2;
              firstHeadingDone = true;
              blocks.push({ k: 'h', l: lvl, t: seg, v });
              outline.push({ c, v, t: seg });
              curBlock = null; curVerse = null; pendingStanza = true;
              continue;
            }
            if (kind === 'para') { curBlock = null; curVerse = null; pendingStanza = true; continue; }
            if (!seg) continue;
            if (isPoetry(bid, c, v)) {
              if (!curBlock || curBlock.k !== 'po') { newBlock('po'); pendingStanza = true; }
              const verse = { n: v, l: splitLines(seg) };
              if (pendingStanza) { verse.sb = 1; pendingStanza = false; }
              curBlock.vs.push(verse); curVerse = verse;
            } else {
              if (!curBlock || curBlock.k !== 'p') newBlock('p');
              if (curVerse && curVerse.n === v) addText(curVerse, seg);
              else { curVerse = { n: v, t: seg }; curBlock.vs.push(curVerse); }
            }
          }
        }

        for (const bl of blocks) delete bl.lid;
        outChapters.push({ n: c, b: blocks.filter(bl => (bl.vs && bl.vs.length) || bl.k === 'h'), fn: fnTable });
      }
      index.books.push({ id: bid, name: b.name, abbr: b.abbr, nc: b.nc, vs: totalV });
      // 메모리 절약: 필요한 형태만 유지
      b.out = { id: bid, name: b.name, abbr: b.abbr, nc: b.nc, outline, ch: outChapters };
    }

    const outBooks = {};
    for (const b of books) outBooks[b.id] = b.out;
    return { index, books: outBooks };
  }

  global.FLParse = { parse };
})(window);
