/* =========================================================
   colorize.js — 사용자 색상 코드 엔진 (규칙 기반)
   모드: 'all' | 'essential' | 'plain'
   ========================================================= */
(function (global) {
  'use strict';

  const NUM = '일이삼사오육칠팔구십백천만억';
  const NUM_ONLY_RE = /[일이삼사오육칠팔구십백천만억]{2,}/;
  const NUMWORD_RE = /(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스물|서른|마흔|쉰|예순|일흔|여든|아흔|몇|여러)/;

  /* ---------- 지명 사전 (성경에 자주 나오는 이름) ---------- */
  const PLACES = [
    '예루살렘','갈릴리','사마리아','유대','베들레헴','나사렛','가나안','에덴','이집트','애굽',
    '바빌론','바빌로니아','니느웨','다마스쿠스','유프라테스','티그리스','요단','홍해','시내 산',
    '시온','헤브론','세겜','벧엘','베델','여리고','기브온','아스글론','가사','에크론','아스돗',
    '블레셋','모압','암몬','에돔','시돈','두로','라오디게아','에베소','빌립보','데살로니가','고린도',
    '아덴',
    '마게도냐',
    '아가야','로마','안디옥','다소','가이사랴','막달라','벳새다','가버나움','겟세마네','골고다','감람 산',
    '시리아','앗시리아','메대','페르시아','엘람','구스','하윌라','소돔','고모라','아라랏','시날',
    '우르','하란','네겝','길르앗','바산','사해','갈멜','헤르몬','다볼','수르','기드론','실로암',
    '베다니','엠마오','아리마대','고센','비손','기혼','아라비아','길리기아','비시디아','루스드라',
    '더베','드로아','미레','살라미','무라','베니게','앗소',
    '히에라폴리스','골로새','니고볼리','그레데','말타','부드라','시라쿠사','보디올',
    '스바','드단','오빌','엘바란','가데스',
    '르호봇','바알스본','비하히롯','엘림','르비딤','호렙','세일','바란','신 광야',
    '가데스바네아','아르논','헤스본','바산','길보아','이스르엘','므깃도','요르단','브엘세바',
    '라기스','아세가','소고','아둘람','엔게디','맛스바','길갈','보김','미스바','라마','기브아',
    '아벡','에벤에셀','벧산','벧엘','길르갈','가나','나인','수넴','에브라임','므낫세'
  ].sort((a, b) => b.length - a.length);

  const placeRe = new RegExp('(' + PLACES.join('|') + ')(?=[^가-힣]|$)', 'g');

  const RULES = [
    // 예수님 (호칭 포함)
    { cls: 'c-jesus', re: /(예수 그리스도|예수께서|예수님|예수|그리스도|메시아|인자(?!하)|하나님의 아들|다윗의 자손|주 예수|나사렛 예수)/g },
    // 성령님
    { cls: 'c-spirit', re: /(성령님|성령|하나님의 영|주님의 영|보혜사|진리의 영)/g },
    // 하나님
    { cls: 'c-god', re: /(주 하나님|하나님|하느님|여호와|전능하신 하나님|전능자|만군의 주|지극히 높으신 분|지극히 높으신|주님|주께서)/g },
    // 나이 (예: 백 살, 서른 살, 아흔아홉 살)
    {
      cls: 'c-age',
      re: /([가-힣]{1,7})\s?살(?=[이가을에쯤도]|[\s,.)]|$)/g,
      test: (m) => isNumeral(m.replace(/\s?살$/, ''))
    },
    // 기간 · 시기 (예: 사백 년, 사십 일, 이레)
    {
      cls: 'c-dur',
      re: /([가-힣]{1,7})(년|개월|주일|시간|세대|이레|사흘|나흘|닷새|엿새|이틀|하루|열흘|보름|달)(?=[\s,.)가-힣]|$)/g,
      test: (m, g) => isNumeral(g[1])
    },
    {
      cls: 'c-dur',
      re: /([가-힣]{1,7})\s(일)(?=\s*(?:동안|만|후|뒤|째|이나|이|을|에|,|\.|$))/g,
      test: (m, g) => isNumeral(g[1])
    }
  ];

  const SPEECH = /([가-힣]{1,10})(이|가|께서)\s+([^"'.!?]{0,45}?)(말하였|말했|말하|물었|물어|대답하|대답했|이르되|이르시|외치|부르짖|여쭈|명하|명령하|일렀|전하|가르치|대답|말씀하)/g;
  const DATIVE = /([가-힣]{1,10})(에게서|에게|더러|께(?!서))\s*[^"'.!?]{0,30}?(말하였|말했|물었|물어|대답하|대답했|이르렀|이르되|이르시|외치|부르짖|여쭈|명하|명령하|일렀|전하|가르치|말씀하)/g;

  const DIVINE = /^(하나님|하느님|주님|여호와|예수|그리스도|예수님|성령|성령님|주|만군의 주|나|우리|너|당신|그|그들|그분)$/;

  const NUMERAL_CHARS = /^[일이삼사오육칠팔구십백천만억한두세네다섯여섯일곱여덟아홉열스물서른마흔쉰예순일흔여든아흔몇여러]+$/;
  function isNumeral(prefix) {
    if (!prefix) return false;
    const core = prefix.trim();
    return !!core && NUMERAL_CHARS.test(core);
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function overlaps(marks, s, e) {
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      if (s < m.e && e > m.s) return true;
    }
    return false;
  }

  /**
   * @param {string} raw  본문(각주 토큰·따옴표 포함하지 않는 순수 텍스트)
   * @param {{mode?:string}} opts
   */
  function colorize(raw, opts) {
    opts = opts || {};
    const mode = opts.mode || 'all';
    if (!raw) return '';
    if (mode === 'plain') return esc(raw);

    const marks = [];

    // 1) 화자 · 청자
    let m;
    DATIVE.lastIndex = 0;
    while ((m = DATIVE.exec(raw))) {
      const name = m[1];
      if (DIVINE.test(name)) continue;
      const s = m.index, e = m.index + name.length;
      if (!overlaps(marks, s, e)) marks.push({ s, e, cls: 'c-listener' });
    }
    SPEECH.lastIndex = 0;
    while ((m = SPEECH.exec(raw))) {
      const name = m[1];
      if (DIVINE.test(name)) continue;
      const s = m.index, e = m.index + name.length;
      if (!overlaps(marks, s, e)) marks.push({ s, e, cls: 'c-speaker' });
    }

    // 2) 어휘 규칙
    const essentialOnly = mode === 'essential';
    for (const rule of RULES) {
      if (essentialOnly && rule.cls !== 'c-god' && rule.cls !== 'c-jesus' &&
          rule.cls !== 'c-spirit') continue;
      rule.re.lastIndex = 0;
      while ((m = rule.re.exec(raw))) {
        const text = m[0];
        const s = m.index, e = s + text.length;
        if (rule.test && !rule.test(text, m)) continue;
        if (overlaps(marks, s, e)) continue;
        marks.push({ s, e, cls: rule.cls });
      }
    }
    // 지명
    if (!essentialOnly) {
      placeRe.lastIndex = 0;
      while ((m = placeRe.exec(raw))) {
        const s = m.index, e = s + m[0].length;
        if (overlaps(marks, s, e)) continue;
        marks.push({ s, e, cls: 'c-place' });
      }
    }

    if (!marks.length) return esc(raw);

    marks.sort((a, b) => a.s - b.s || (b.e - b.s) - (a.e - a.s));
    let out = '', pos = 0;
    for (const mk of marks) {
      if (mk.s < pos) continue;
      out += esc(raw.slice(pos, mk.s));
      out += '<span class="' + mk.cls + '">' + esc(raw.slice(mk.s, mk.e)) + '</span>';
      pos = mk.e;
    }
    out += esc(raw.slice(pos));
    return out;
  }

  const LEGEND = [
    { grp: '인물 · 관계', items: [
      { cls: 'c-god', name: '하나님', ex: '하나님, 주님, 여호와', color: 'var(--c-god)' },
      { cls: 'c-jesus', name: '예수님', ex: '예수, 그리스도, 인자 · 신약의 예수 어록 전체', color: 'var(--c-jesus)' },
      { cls: 'c-spirit', name: '성령님', ex: '성령, 하나님의 영', color: 'var(--c-spirit)' },
      { cls: 'c-speaker', name: '말하는 사람', ex: '베드로가 … 말하였다', color: 'var(--c-speaker)' },
      { cls: 'c-listener', name: '듣는 대상', ex: '뱀이 여자에게 …', color: 'var(--c-listener)' }
    ]},
    { grp: '때 · 수', items: [
      { cls: 'c-age', name: '나이', ex: '백 살, 서른 살', color: 'var(--c-age)' },
      { cls: 'c-dur', name: '기간 · 시기', ex: '사백 년, 사십 일', color: 'var(--c-dur)' }
    ]},
    { grp: '장소', items: [
      { cls: 'c-place', name: '지명', ex: '예루살렘, 갈릴리', color: 'var(--c-place)' }
    ]}
  ];

  global.FLColor = { colorize, LEGEND, esc };
})(window);
