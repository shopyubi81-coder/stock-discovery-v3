// 오늘의 발굴 — 원페이지 리스트
// 데이터: /data/discover.json (+ 종목 클릭 시 /data/detail/{ticker}.json)

const $ = (s) => document.querySelector(s);
const state = { data: null, dataKr: null, dataUs: null, scope: 'kr', market: null, news: null, tab: 'supply' };

const fmtP = (v, us) => us
  ? '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })
  : Number(v).toLocaleString();

const TAB_DESC = {
  supply: '외국인·기관 매집 — 바닥권/초입/⚠고점 추격을 자동 분류 · A=신뢰 높음, C=주의',
  trend: '추세 전환 — A: 전환+지지 확인·눌림목(확실) / B: 전환 시도(확인 필요) / C·⚠: 과열 추격 위험',
  volume: '거래 폭발 — 투매성 폭발은 자동 제외 · 주도 주체(외인·기관 vs 개인)를 분류',
  steady: '외국인·기관이 10일 이상 꾸준히 사 모은 종목 — 조용한 장기 매집',
  track: '최근 2주 발굴 종목의 그 후 — 처음 포착일 종가 기준 수익률 · ● = 오늘도 리스트에 있음',
};
const REGIME_LABEL = { strong: '🟢 시장 강세', neutral: '🟡 시장 중립', weak: '🔴 시장 약세' };

async function load() {
  const res = await fetch('/data/discover.json');
  if (!res.ok) {
    $('#list').innerHTML = '<div class="empty-list">데이터 없음 — 터미널에서 npm run build 를 먼저 실행하세요.</div>';
    return;
  }
  state.dataKr = await res.json();
  try {
    const r2 = await fetch('/data/discover-us.json');
    if (r2.ok) {
      state.dataUs = await r2.json();
      for (const rows of Object.values(state.dataUs.lists)) rows.forEach((r) => { r.us = true; });
      (state.dataUs.focus || []).forEach((r) => { r.us = true; });
      (state.dataUs.tracking || []).forEach((r) => { r.us = true; });
    }
  } catch {}
  renderScope();
  loadMarket();
}

// ── 스코프 전환: 국내 / 해외 / 전체 ──────────────────────────────────────────
function renderScope() {
  document.querySelectorAll('.sc').forEach((b) => b.classList.toggle('on', b.dataset.s === state.scope));
  const all = state.scope === 'all';
  state.data = state.scope === 'us' && state.dataUs ? state.dataUs : state.dataKr;

  $('#filter-strip').hidden = all;
  $('#tabs').hidden = all;
  $('#tab-desc').hidden = all;
  if (all) {
    $('#list').hidden = true; $('#track-sec').hidden = true;
    $('#record').hidden = true; $('#list-warn').hidden = true;
  }

  if (state.scope === 'us' && !state.dataUs) {
    $('#focus-sec').hidden = true;
    $('#list').hidden = false;
    $('#list').innerHTML = '<div class="empty-list">미국 데이터가 아직 없습니다 — 수집이 끝나면 자동으로 채워집니다 (npm run us → npm run score:us)</div>';
    renderHead(); renderSignal();
    return;
  }

  renderHead();
  renderSignal();
  renderFocus();
  renderIndexCards();
  if (!all) { renderTabs(); renderList(); renderTracking(); renderRecord(); }
}

// ── 시장 신호등 — 시장폭 + 공포지수 + 지수 흐름 종합 ─────────────────────────
function renderSignal() {
  const d = state.data, m = state.market;
  const fg = m?.feargreed?.score;
  const kospi = m?.indices?.kospi;
  let level = d.market.regime === 'strong' ? 'green' : d.market.regime === 'weak' ? 'red' : 'yellow';
  if (level === 'green' && fg != null && fg < 30) level = 'yellow'; // 시장폭은 좋아도 심리가 공포면 한 단계 보수적으로

  const TITLE = { green: '매수 우호 환경', yellow: '중립 — 선별 접근', red: '약세 — 관망 우선' };
  const MSG = {
    green: '추세와 수급이 받쳐주는 환경입니다. 계획한 종목은 분할로 접근해볼 만합니다.',
    yellow: '방향이 불분명한 구간입니다. 수급이 확실한 종목만 소액·분할로 접근하세요.',
    red: '지금은 지키는 구간입니다. 신규 매수보다 관망 — 아래 리스트는 반등 대비 관찰용으로 쓰세요.',
  };
  $('#signal').className = `signal ${level}`;
  $('#signal-title').textContent = TITLE[level];
  const subs = [`${d.scope === 'us' ? 'S&P500 ' : ''}20일선 위 종목 ${d.market.breadth}%`];
  if (fg != null) subs.push(`공포지수 ${fg}`);
  if (kospi && d.scope !== 'us') subs.push(`KOSPI ${kospi.ratio > 0 ? '+' : ''}${kospi.ratio}%`);
  $('#signal-sub').textContent = subs.join(' · ');
  $('#signal-msg').textContent = MSG[level];
}

// ── 오늘의 집중 후보 TOP 3 ───────────────────────────────────────────────────
const HIT_BADGE = {
  supply: ['수급', '#23295c', '#818cf8'], steady: ['매집', '#0f2e33', '#5eead4'],
  trend: ['추세', '#3a2a10', '#fbbf24'], volume: ['거래', '#113227', '#34d399'],
};

async function renderFocus() {
  const picks = state.scope === 'all'
    ? [...(state.dataKr.focus || []), ...(state.dataUs?.focus || [])]
    : state.data.focus || [];
  if (!picks.length) { $('#focus-sec').hidden = true; return; }
  $('#focus-sec').hidden = false;

  $('#focus-grid').innerHTML = picks.map((p, i) => `
    <div class="fcard" data-t="${p.ticker}">
      <div class="fc-top">
        <div><b>${state.scope === 'all' ? (p.us ? '🇺🇸 ' : '🇰🇷 ') : ''}${p.name}</b>
          <small>${p.ticker} · ${p.sector || p.market} · ${p.freshDays === 1 ? '오늘 진입' : p.freshDays + '일째 포착'}</small></div>
        <div class="fc-chg ${p.change > 0 ? 'up' : p.change < 0 ? 'down' : 'flat'}">${p.change > 0 ? '+' : ''}${p.change}%
          <small>대금 ${p.amountEok.toLocaleString()}억</small></div>
      </div>
      <div class="fc-hits">${p.hits.map((h) =>
        `<span style="background:${HIT_BADGE[h][1]};color:${HIT_BADGE[h][2]}">${HIT_BADGE[h][0]}</span>`).join('')}</div>
      <div class="fc-spark" id="fspark-${p.ticker}"></div>
      <div class="fc-why">${p.reasons.slice(0, 3).join(' · ')}</div>
      <div class="fc-levels">
        <div><label>현재가 (진입 참고)</label><b>${fmtP(p.entry, p.us)}</b></div>
        <div class="lv-stop"><label>손절 참고 ${p.stopPct}%</label><b>${fmtP(p.stop, p.us)}</b></div>
        <div class="lv-target"><label>목표 참고 +${p.targetPct}%</label><b>${fmtP(p.target, p.us)}</b></div>
      </div>
      <div class="fc-news" id="fnews-${p.ticker}"></div>
    </div>`).join('');

  // 스파크라인 (30일) + 뉴스 1건 — 비동기 로드
  for (const p of picks) {
    fetch(`/data/${p.us ? 'detail-us' : 'detail'}/${p.ticker}.json`).then((r) => r.json()).then((d) => {
      const el = document.getElementById(`fspark-${p.ticker}`);
      if (!el) return;
      const vals = d.quotes.slice(-30).map((r) => r.close);
      const lo = Math.min(...vals), hi = Math.max(...vals);
      const w = 250, h = 40;
      const pts = vals.map((v, i) =>
        `${(i / (vals.length - 1) * w).toFixed(1)},${(h - 4 - (v - lo) / (hi - lo || 1) * (h - 8)).toFixed(1)}`).join(' ');
      const up = vals.at(-1) >= vals[0];
      el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:40px">
        <polyline points="${pts}" fill="none" stroke="${up ? '#ff5d73' : '#4d8dff'}" stroke-width="1.6"/></svg>`;
    }).catch(() => {});
  }
  ensureNews().then(() => {
    for (const p of picks) {
      const el = document.getElementById(`fnews-${p.ticker}`);
      const n = state.news.get(p.ticker);
      if (el && n?.articles?.[0]) el.textContent = '📰 ' + n.articles[0].title;
    }
  });
}

// ── 지수 카드 (국내: KOSPI/KOSDAQ · 해외: 다우/나스닥/러셀2000) — 스코프에 따라 전환 ──
function renderIndexCards() {
  const m = state.market;
  if (!m) return;
  const isUs = state.scope === 'us';
  const defs = isUs
    ? [['#mw-idx1', '다우존스', m.indicesUs?.dow], ['#mw-idx2', '나스닥', m.indicesUs?.nasdaq], ['#mw-idx3', '러셀2000', m.indicesUs?.russell]]
    : [['#mw-idx1', 'KOSPI', m.indices?.kospi], ['#mw-idx2', 'KOSDAQ', m.indices?.kosdaq]];

  document.querySelectorAll('.mw.idx').forEach((el) => { el.hidden = true; });
  for (const [sel, label, v] of defs) {
    const el = document.querySelector(sel);
    el.hidden = false;
    const lab = el.querySelector('label'), b = el.querySelector('b'), s = el.querySelector('small');
    lab.textContent = label;
    if (!v) { b.textContent = '—'; s.textContent = '데이터 없음'; el.querySelector('.spark').innerHTML = ''; continue; }
    b.textContent = v.value.toLocaleString(isUs ? 'en-US' : 'ko-KR');
    b.className = v.change > 0 ? 'up' : v.change < 0 ? 'down' : '';
    s.textContent = `${v.change > 0 ? '▲ +' : v.change < 0 ? '▼ ' : ''}${Math.abs(v.change).toLocaleString()} (${v.ratio > 0 ? '+' : ''}${v.ratio}%)`;
    s.className = v.change > 0 ? 'up' : v.change < 0 ? 'down' : 'muted';
    const hist = v.history.map((x) => x.v);
    const lo = Math.min(...hist), hi = Math.max(...hist);
    const pts = hist.map((x, i) =>
      `${(i / (hist.length - 1) * 92 + 2).toFixed(1)},${(30 - (x - lo) / (hi - lo || 1) * 26 + 2).toFixed(1)}`).join(' ');
    el.querySelector('.spark').innerHTML = `<svg width="96" height="36" viewBox="0 0 96 36">
      <polyline points="${pts}" fill="none" stroke="${v.change >= 0 ? '#ff5d73' : '#4d8dff'}" stroke-width="1.6"/></svg>`;
  }
}

// ── 시장 위젯 (공포지수 · 환율 · 연기금 뉴스) ────────────────────────────────
async function loadMarket() {
  try {
    const res = await fetch('/data/market-extra.json');
    if (!res.ok) return;
    state.market = await res.json();
  } catch { return; }
  $('#market-strip').hidden = false;
  renderSignal(); // 공포지수·지수 반영해 신호등 갱신
  renderIndexCards();

  const m = state.market;
  // 공포지수 도넛
  if (m.feargreed) {
    const fg = m.feargreed;
    const color = fg.score < 25 ? 'var(--up)' : fg.score < 45 ? '#fb923c'
      : fg.score < 55 ? 'var(--gold)' : fg.score < 75 ? '#a3e635' : 'var(--green)';
    const r = 24, c = 2 * Math.PI * r;
    $('#fg-donut').innerHTML = `<svg width="62" height="62" viewBox="0 0 62 62">
      <circle cx="31" cy="31" r="${r}" fill="none" stroke="var(--line)" stroke-width="7"/>
      <circle cx="31" cy="31" r="${r}" fill="none" stroke="${color}" stroke-width="7"
        stroke-linecap="round" stroke-dasharray="${(fg.score / 100 * c).toFixed(1)} ${c.toFixed(1)}"
        transform="rotate(-90 31 31)"/>
      <text x="31" y="36" text-anchor="middle" fill="${color}" font-size="16" font-weight="800">${fg.score}</text>
    </svg>`;
    $('#fg-rating').textContent = fg.rating;
    $('#fg-rating').style.color = color;
    $('#fg-sub').textContent = `전일 ${fg.prevClose} · 1주전 ${fg.prev1w} · CNN`;
  }

  // 환율
  if (m.fx) {
    const fx = m.fx;
    $('#fx-rate').textContent = fx.rate.toLocaleString('ko-KR', { minimumFractionDigits: 1 });
    const sub = $('#fx-sub');
    sub.textContent = `${fx.change > 0 ? '▲ +' : fx.change < 0 ? '▼ ' : ''}${fx.change}원 (${fx.ratio > 0 ? '+' : ''}${fx.ratio}%)`;
    sub.className = fx.change > 0 ? 'up' : fx.change < 0 ? 'down' : 'muted';
    // 미니 스파크라인
    const h = fx.history.slice(-30).map((x) => x.v);
    const lo = Math.min(...h), hi = Math.max(...h);
    const pts = h.map((v, i) => `${(i / (h.length - 1) * 92 + 2).toFixed(1)},${(30 - (v - lo) / (hi - lo || 1) * 26 + 2).toFixed(1)}`).join(' ');
    $('#fx-spark').innerHTML = `<svg width="96" height="36" viewBox="0 0 96 36">
      <polyline points="${pts}" fill="none" stroke="var(--indigo2)" stroke-width="1.6"/></svg>`;
  }

  // 연기금 뉴스 — 한 줄 배너
  if (m.pensionNews?.length) {
    const el = $('#news-line');
    el.hidden = false;
    el.innerHTML = '<b>📰 연기금·리밸런싱</b>' + m.pensionNews.slice(0, 2).map((n) =>
      `<a href="${n.link}" target="_blank" rel="noopener">${n.title}</a>`).join('<span class="sep">|</span>');
  }
}

// 환율 모달 — 60일 라인 차트
function openFxModal() {
  const fx = state.market?.fx;
  if (!fx) return;
  $('#fxm-rate').textContent = fx.rate.toLocaleString('ko-KR', { minimumFractionDigits: 1 });
  const chg = $('#fxm-chg');
  chg.textContent = `${fx.change > 0 ? '▲ +' : fx.change < 0 ? '▼ ' : ''}${fx.change}원`;
  chg.className = fx.change > 0 ? 'up' : fx.change < 0 ? 'down' : 'flat';

  const W = 600, H = 230, PH = 200, padR = 62;
  const vals = fx.history.map((x) => x.v);
  const lo = Math.min(...vals) * 0.998, hi = Math.max(...vals) * 1.002;
  const x = (i) => 8 + (i / (vals.length - 1)) * (W - 8 - padR);
  const y = (v) => 10 + (1 - (v - lo) / (hi - lo)) * (PH - 10);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const grid = [0.25, 0.5, 0.75].map((p) => {
    const v = lo + (hi - lo) * p, yy = y(v);
    return `<line x1="8" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="var(--line)" stroke-dasharray="3 4"/>
      <text x="${W - padR + 5}" y="${yy + 3}" fill="var(--muted)" font-size="10">${v.toFixed(1)}</text>`;
  }).join('');
  const ticks = [0, Math.floor(vals.length / 2), vals.length - 1].map((i) =>
    `<text x="${x(i)}" y="${H - 6}" fill="var(--muted)" font-size="9.5" text-anchor="middle">${fx.history[i].d.slice(5)}</text>`).join('');
  $('#fx-chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    ${grid}
    <polyline points="${pts}" fill="none" stroke="var(--indigo2)" stroke-width="1.8"/>
    <circle cx="${x(vals.length - 1)}" cy="${y(vals.at(-1))}" r="3" fill="var(--indigo2)"/>
    <text x="${W - padR + 5}" y="${y(vals.at(-1)) + 3}" fill="var(--indigo2)" font-size="10.5" font-weight="700">${vals.at(-1).toFixed(1)}</text>
    ${ticks}
  </svg>`;
  $('#fx-modal').hidden = false;
}

function renderHead() {
  const d = state.data;
  const dt = new Date(d.date + 'T00:00:00');
  const day = ['일', '월', '화', '수', '목', '금', '토'][dt.getDay()];
  $('#asof').textContent = `${dt.getMonth() + 1}월 ${dt.getDate()}일 (${day}) ${d.scope === 'us' ? '미국 종가 기준' : '장마감 기준'}`;
  // 테마 쏠림
  const tf = $('#theme-focus');
  if (d.themeFocus) {
    tf.hidden = false;
    tf.innerHTML = `🔥 오늘 발굴 종목의 <b>${d.themeFocus.share}%가 ${d.themeFocus.name}</b> (${d.themeFocus.count}종목) — 시장 관심이 이 테마에 몰려 있습니다.`;
  } else tf.hidden = true;

  $('#f-amount').textContent = `거래대금 ${d.filter.minAmountEok}억↑${d.scope === 'us' ? '(원화 환산)' : ''}`;
  $('#f-cap').textContent = d.filter.minMarketCapEok
    ? `시총 ${d.filter.minMarketCapEok.toLocaleString()}억↑` : 'S&P500 대형주';
  $('#f-loss').textContent = d.filter.excludeLoss ? '적자 제외' : d.scope === 'us' ? '펀더 필터 없음' : '적자 포함';
  $('#f-pass').innerHTML = `${d.filter.universe.toLocaleString()}종목 → <b>${d.filter.passed.toLocaleString()}종목 통과</b>`;
}

function renderTabs() {
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('on', t.dataset.k === state.tab);
    t.querySelector('b').textContent = t.dataset.k === 'track'
      ? (state.data.tracking || []).length
      : (state.data.lists[t.dataset.k] || []).length;
  });
  $('#tab-desc').textContent = TAB_DESC[state.tab];

  // 추적 관찰 탭이면 리스트 대신 추적 섹션 + 성적표 표시 (성적표는 추적의 요약본)
  const isTrack = state.tab === 'track';
  $('#list').hidden = isTrack;
  $('#track-sec').hidden = !isTrack;
  $('#record').hidden = !isTrack;
  if (isTrack) $('#list-warn').hidden = true;
}

function renderList() {
  // 약세장에서 거래 폭발 추격 경고 — 실제 성적 데이터를 근거로 제시
  const lw = $('#list-warn');
  const vRec = state.data.record?.byList?.volume;
  if (state.tab === 'volume' && state.data.market.regime === 'weak') {
    lw.hidden = false;
    lw.innerHTML = `⚠ <b>약세장에서 거래량 급증 추격은 위험합니다.</b>`
      + (vRec?.samples ? ` 실제로 최근 이 리스트의 D+5 평균은 <b>${vRec.avgReturn}%</b>, 적중률 ${vRec.hitRate}%였습니다.` : '')
      + ` 지금은 "무슨 일이 벌어졌나" 확인용으로만 쓰세요.`;
  } else lw.hidden = true;

  const rows = state.data.lists[state.tab] || [];
  if (!rows.length) {
    const usNoSupply = state.scope === 'us' && (state.tab === 'supply' || state.tab === 'steady');
    $('#list').innerHTML = `<div class="empty-list">${
      usNoSupply
        ? '미국 주식은 투자자별(외국인·기관) 수급 데이터가 제공되지 않아 이 관점은 비어 있습니다 — 추세 전환·거래 폭발 탭을 이용하세요.'
        : state.tab === 'steady'
          ? '아직 10일 이상 연속 매수 종목이 없습니다 — 수급 이력이 매일 쌓이면서 자동으로 채워집니다.'
          : '오늘은 이 조건을 만족하는 종목이 없습니다 — 무리해서 살 필요 없다는 뜻이기도 합니다.'
    }</div>`;
    return;
  }
  const rowHTML = rows.map((r, i) => `
    <div class="row" data-t="${r.ticker}">
      <span class="no">${i + 1}</span>
      <div class="mid">
        <div class="nm">
          <span class="grade g${r.grade || 'B'}">${r.grade || 'B'}</span>
          <b>${r.name}</b>
          <small>${r.ticker} · ${r.sector || r.market}</small>
          ${r.freshDays === 1
            ? '<span class="fresh new">오늘 진입</span>'
            : `<span class="fresh old">${r.freshDays}일째 포착</span>`}
        </div>
        <div class="why">${r.reasons.join(' · ')}</div>
      </div>
      <div class="rt">
        <div class="chg ${r.change > 0 ? 'up' : r.change < 0 ? 'down' : 'flat'}">${r.change > 0 ? '+' : ''}${r.change}%</div>
        <div class="amt">대금 ${r.amountEok.toLocaleString()}억</div>
      </div>
    </div>`).join('');

  // 10개 이상이면 내부 스크롤
  $('#list').innerHTML = rows.length >= 10
    ? `<div class="list-body scroll">${rowHTML}</div><div class="list-more">총 ${rows.length}종목 — 스크롤해서 더 보기</div>`
    : `<div class="list-body">${rowHTML}</div>`;
}

const SRC_LABEL = { supply: '수급', trend: '추세', volume: '거래', steady: '매집' };

function renderTracking() {
  const rows = state.data.tracking || [];
  if (!rows.length) {
    $('#track').innerHTML = '<div class="empty-list">오늘 발굴된 종목이 내일부터 여기서 추적됩니다.</div>';
    return;
  }
  const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
  const tracked = rows.filter((r) => r.tradingDays > 0);
  const wins = tracked.filter((r) => r.ret > 0).length;
  const summary = tracked.length
    ? ` · 총 ${tracked.length}종목 중 ${wins}개 상승 (${Math.round((wins / tracked.length) * 100)}%)`
    : '';
  $('#track').innerHTML = `<div class="t-scroll">` + rows.map((r) => `
    <div class="trow" data-t="${r.ticker}">
      <span class="t-date">${md(r.pickedAt)}</span>
      <span class="t-src ${r.list}">${SRC_LABEL[r.list]}</span>
      <span class="t-nm"><b>${r.name}</b>${r.stillListed ? '<span class="t-live" title="오늘도 리스트에 있음"></span>' : ''}</span>
      <span class="t-price">${r.pickClose.toLocaleString()} → ${r.curClose.toLocaleString()}</span>
      <span class="t-ret ${r.ret > 0 ? 'up' : r.ret < 0 ? 'down' : 'flat'}">${
        r.tradingDays === 0 ? '<small>오늘 포착</small>' : `${r.ret > 0 ? '+' : ''}${r.ret}%`
      }</span>
    </div>`).join('') + `</div>`
    + `<div class="t-legend">● 초록점 = 오늘도 리스트에 있음 · 수익률은 처음 포착일 종가 기준${summary}</div>`;
}

function renderRecord() {
  const r = state.data.record;
  if (!r.samples) return; // 기본 안내문 유지
  const cls = (v) => v > 0 ? 'pos' : 'neg';
  const sign = (v) => `${v > 0 ? '+' : ''}${v}%`;
  const byList = r.byList
    ? `<div class="r-bylist">` + Object.entries(r.byList).map(([k, v]) => v.samples
        ? `<span class="r-pill">${SRC_LABEL[k]} <b class="${cls(v.avgReturn)}">${sign(v.avgReturn)}</b> · 적중 ${v.hitRate}% (${v.samples}건)</span>`
        : `<span class="r-pill">${SRC_LABEL[k]} 데이터 없음</span>`).join('') + `</div>`
    : '';
  $('#record-body').innerHTML =
    `최근 ${r.samples}건 · D+${r.horizon} 평균 <span class="${cls(r.avgReturn)}">${sign(r.avgReturn)}</span>`
    + ` · 같은 기간 유니버스 평균 ${sign(r.benchReturn)} · 적중률 ${r.hitRate}%` + byList;
}

// ── 상세 모달 ────────────────────────────────────────────────────────────────
async function openDetail(ticker) {
  // 국내·해외 데이터 모두에서 탐색 (전체 스코프의 카드 클릭 대응)
  const pools = [state.data, state.dataKr, state.dataUs].filter(Boolean);
  let item = null, src = null;
  for (const d of pools) {
    item = Object.values(d.lists).flat().find((x) => x.ticker === ticker)
      || (d.focus || []).find((x) => x.ticker === ticker);
    if (item) { src = d; break; }
  }

  // 오늘 리스트엔 없는 추적 관찰 종목 — 포착 정보로 근거 구성
  if (!item) {
    src = state.data;
    const tr = (state.data.tracking || []).find((x) => x.ticker === ticker);
    if (!tr) return;
    const md = `${+tr.pickedAt.slice(5, 7)}/${+tr.pickedAt.slice(8, 10)}`;
    item = {
      ticker: tr.ticker, name: tr.name, sector: null, market: '', change: null, us: tr.us,
      reasons: [
        `${md} "${SRC_LABEL[tr.list]}" 리스트에서 처음 포착`,
        tr.tradingDays > 0
          ? `포착 후 ${tr.tradingDays}거래일 · ${tr.ret > 0 ? '+' : ''}${tr.ret}% (${tr.pickClose.toLocaleString()} → ${tr.curClose.toLocaleString()})`
          : '오늘 포착 — 내일부터 수익률 추적',
      ],
    };
  }

  $('#m-name').textContent = item.name;
  $('#m-sub').textContent = `${item.ticker}${item.sector || item.market ? ' · ' + (item.sector || item.market) : ''}`;
  const ch = $('#m-change');
  if (item.change != null) {
    ch.textContent = `${item.change > 0 ? '▲ +' : item.change < 0 ? '▼ ' : ''}${item.change}%`;
    ch.className = item.change > 0 ? 'up' : item.change < 0 ? 'down' : 'flat';
  } else { ch.textContent = ''; }
  $('#m-reasons').innerHTML = item.reasons.map((x) => `<li>${x}</li>`).join('');
  $('#m-chart').innerHTML = '<div class="empty-list">불러오는 중…</div>';
  $('#m-supply').innerHTML = '';
  renderNews(ticker);
  $('#modal').hidden = false;

  try {
    const d = await (await fetch(`/data/${item.us ? 'detail-us' : 'detail'}/${ticker}.json`)).json();
    $('#m-close').textContent = fmtP(d.quotes.at(-1).close, item.us);
    drawPrice(d.quotes);
    drawSupply(d.supply, d.quotes);
  } catch {
    $('#m-chart').innerHTML = '<div class="empty-list">차트 데이터 없음</div>';
  }
}

// 뉴스 — 첫 사용 때 news.json 을 한 번만 로드해 캐시
async function ensureNews() {
  if (state.news !== null) return;
  try {
    const res = await fetch('/data/news.json');
    state.news = res.ok
      ? new Map((await res.json()).items.map((n) => [n.ticker, n]))
      : new Map();
  } catch { state.news = new Map(); }
}

async function renderNews(ticker) {
  const ul = $('#m-news');
  await ensureNews();
  const n = state.news.get(ticker);
  if (!n?.articles?.length) {
    ul.innerHTML = '<li><span class="muted">수집된 뉴스 없음</span></li>';
    return;
  }
  ul.innerHTML = n.articles.map((a) => {
    const chip = a.score >= 15 ? '<span class="n-sent pos">호재</span>'
      : a.score <= -15 ? '<span class="n-sent neg">악재</span>' : '';
    return `<li>${chip}<a href="${a.url}" target="_blank" rel="noopener">${a.title}</a>
      <span class="n-meta">${a.source || ''}${a.date ? ' · ' + a.date.slice(5) : ''}</span></li>`;
  }).join('');
}

function drawPrice(qAll) {
  // 이평선은 전체 데이터(최대 120일)로 계산하고, 화면엔 최근 60일만 표시
  const VIEW = 60;
  const closesAll = qAll.map((r) => r.close);
  const maAt = (n, i) => i >= n - 1
    ? closesAll.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n : null;
  const start = Math.max(0, qAll.length - VIEW);
  const q = qAll.slice(start);
  const closes = closesAll.slice(start);
  const ma20 = q.map((_, k) => maAt(20, start + k));
  const ma60 = q.map((_, k) => maAt(60, start + k));

  const W = 640, H = 218, PH = 150, VB = H - 16, padR = 54;
  const shown = [...closes, ...ma20, ...ma60].filter((v) => v != null);
  const lo = Math.min(...shown) * 0.99, hi = Math.max(...shown) * 1.01;
  const maxV = Math.max(...q.map((r) => r.volume));
  const x = (i) => 8 + (i / (q.length - 1)) * (W - 8 - padR);
  const y = (v) => 8 + (1 - (v - lo) / (hi - lo)) * (PH - 8);
  const line = (arr) => arr.map((v, i) => v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean).join(' ');

  const vols = q.map((r, i) => {
    const h = (r.volume / maxV) * (VB - PH - 8);
    const up = i > 0 && r.close >= q[i - 1].close;
    return `<rect x="${(x(i) - 2).toFixed(1)}" y="${(VB - h).toFixed(1)}" width="4" height="${h.toFixed(1)}" fill="${up ? 'var(--up)' : 'var(--down)'}" opacity="0.5"/>`;
  }).join('');
  const grid = [0.25, 0.5, 0.75].map((p) => {
    const v = lo + (hi - lo) * p, yy = y(v);
    return `<line x1="8" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="var(--line)" stroke-dasharray="3 4"/>
            <text x="${W - padR + 5}" y="${yy + 3}" fill="var(--muted)" font-size="10">${Math.round(v).toLocaleString()}</text>`;
  }).join('');
  // 하단 날짜축 — 5거래일 주기 (최신일 기준 역산)
  const dates = q.map((r, i) => (q.length - 1 - i) % 5 === 0
    ? `<text x="${x(i).toFixed(1)}" y="${H - 4}" fill="var(--muted)" font-size="9" text-anchor="middle">${+r.date.slice(5, 7)}/${+r.date.slice(8, 10)}</text>` : '').join('');
  const last = closes.at(-1);

  $('#m-chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    ${grid}${vols}${dates}
    <polyline points="${line(ma60)}" fill="none" stroke="#5eead4" stroke-width="1.2" opacity="0.85"/>
    <polyline points="${line(ma20)}" fill="none" stroke="var(--gold)" stroke-width="1.2" opacity="0.85"/>
    <polyline points="${line(closes)}" fill="none" stroke="var(--indigo2)" stroke-width="1.8"/>
    <circle cx="${x(q.length - 1)}" cy="${y(last)}" r="3" fill="var(--indigo2)"/>
    <text x="${W - padR + 5}" y="${y(last) + 3}" fill="var(--indigo2)" font-size="10.5" font-weight="700">${last.toLocaleString()}</text>
    <text x="12" y="18" fill="var(--muted)" font-size="10.5">종가 <tspan fill="var(--gold)">— 20일선</tspan> <tspan fill="#5eead4">— 60일선</tspan></text>
  </svg>`;
}

// 수급 차트 — 외국인 / 기관 / 개인 3단 + 거래량 밴드 + 날짜축
function drawSupply(sup, quotes) {
  if (!sup?.length) { $('#m-supply').innerHTML = '<div class="empty-list">수급 데이터 없음</div>'; return; }
  const SERIES = [
    ['외국인', 'foreign_net', '#818cf8'],
    ['기관', 'inst_net', '#fbbf24'],
    ['개인', 'retail_net', '#f472b6'],
  ];
  const W = 640, ROW = 62, PAD_TOP = 20, VROW = 52;
  const H = PAD_TOP + ROW * SERIES.length + VROW + 16;
  const bw = Math.max(4, Math.min(16, (W - 160) / sup.length - 3));
  const x = (i) => 128 + (i / sup.length) * (W - 160);
  const fmt = (v) => Math.abs(v) >= 1e4 ? `${(v / 1e4).toFixed(0)}만주` : `${v}주`;

  let g = `<text x="${W - 14}" y="13" fill="var(--muted)" font-size="10" text-anchor="end">기준선 위 = 순매수 · 아래(흐림) = 순매도</text>`;

  SERIES.forEach(([label, key, color], si) => {
    const top = PAD_TOP + ROW * si;
    const mid = top + ROW / 2 + 4;
    const vals = sup.map((r) => r[key] ?? null);
    const has = vals.some((v) => v != null && v !== 0);
    const total = vals.reduce((a, v) => a + (v || 0), 0);

    g += `<line x1="128" y1="${mid}" x2="${W - 14}" y2="${mid}" stroke="var(--line)"/>`;
    g += `<text x="12" y="${mid - 6}" fill="${color}" font-size="11.5" font-weight="700">■ ${label}</text>`;
    if (has) {
      g += `<text x="12" y="${mid + 10}" fill="${total >= 0 ? 'var(--up)' : 'var(--down)'}" font-size="10.5" font-weight="700">${sup.length}일 누적 ${total >= 0 ? '+' : ''}${fmt(total)}</text>`;
    } else {
      g += `<text x="12" y="${mid + 10}" fill="var(--muted)" font-size="10">데이터 없음</text>`;
    }
    if (has) {
      const maxAbs = Math.max(1, ...vals.map((v) => Math.abs(v || 0)));
      const h = (v) => (Math.abs(v) / maxAbs) * (ROW / 2 - 7);
      sup.forEach((r, i) => {
        const v = r[key] ?? 0;
        g += `<rect x="${x(i).toFixed(1)}" y="${(v >= 0 ? mid - h(v) : mid).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h(v), .5).toFixed(1)}" fill="${color}" opacity="${v >= 0 ? .95 : .35}"/>`;
      });
    }
    g += `<line x1="8" y1="${top + ROW}" x2="${W - 8}" y2="${top + ROW}" stroke="#1c214a"/>`;
  });

  // 거래량 밴드 — 같은 날짜의 거래량을 아래에 함께 표시
  const volByDate = new Map((quotes || []).map((r) => [r.date, r.volume]));
  const vTop = PAD_TOP + ROW * SERIES.length;
  const vBase = vTop + VROW - 10;
  const vVals = sup.map((r) => volByDate.get(r.date) ?? 0);
  const vMax = Math.max(1, ...vVals);
  g += `<text x="12" y="${vTop + 20}" fill="#94a3b8" font-size="11.5" font-weight="700">■ 거래량</text>`;
  g += `<text x="12" y="${vTop + 34}" fill="var(--muted)" font-size="10">최대 ${fmt(vMax)}</text>`;
  g += `<line x1="128" y1="${vBase}" x2="${W - 14}" y2="${vBase}" stroke="var(--line)"/>`;
  sup.forEach((r, i) => {
    const h = (vVals[i] / vMax) * (VROW - 16);
    g += `<rect x="${x(i).toFixed(1)}" y="${(vBase - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, .5).toFixed(1)}" fill="#94a3b8" opacity="0.7"/>`;
  });

  // 날짜축 — 5일 주기 (최신일 기준 역산)
  sup.forEach((r, i) => {
    if ((sup.length - 1 - i) % 5 !== 0) return;
    g += `<text x="${(x(i) + bw / 2).toFixed(1)}" y="${H - 4}" fill="var(--muted)" font-size="9" text-anchor="middle">${+r.date.slice(5, 7)}/${+r.date.slice(8, 10)}</text>`;
  });

  $('#m-supply').innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
}

// ── 이벤트 ───────────────────────────────────────────────────────────────────
$('#tabs').addEventListener('click', (e) => {
  const t = e.target.closest('.tab'); if (!t) return;
  state.tab = t.dataset.k;
  renderTabs(); renderList();
});
$('#scope').addEventListener('click', (e) => {
  const b = e.target.closest('.sc'); if (!b) return;
  state.scope = b.dataset.s;
  renderScope();
});
$('#list').addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (row) openDetail(row.dataset.t);
});
$('#track').addEventListener('click', (e) => {
  const row = e.target.closest('.trow');
  if (row) openDetail(row.dataset.t);
});
$('#focus-grid').addEventListener('click', (e) => {
  const card = e.target.closest('.fcard');
  if (card) openDetail(card.dataset.t);
});
$('#m-x').addEventListener('click', () => { $('#modal').hidden = true; });
$('#modal-bg').addEventListener('click', () => { $('#modal').hidden = true; });
$('#mw-fx').addEventListener('click', openFxModal);
$('#fx-x').addEventListener('click', () => { $('#fx-modal').hidden = true; });
$('#fx-modal-bg').addEventListener('click', () => { $('#fx-modal').hidden = true; });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { $('#modal').hidden = true; $('#fx-modal').hidden = true; }
});

load();
