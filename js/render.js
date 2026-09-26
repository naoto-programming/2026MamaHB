// 描画: state の内容を画面に反映する

// 目的の数のバッジ（1 は朱、8 は若竹）
const badge = (choice, extra = '') =>
  `<span class="badge t${choice}${extra}" aria-label="目的の数 ${choice}">${choice}</span>`;
const labeledBadge = choice =>
  `<span class="target"><span class="target-label">目的の数</span>${badge(choice)}</span>`;

// ===== メッセージと行動履歴 =====
// 最新の1件を大きく、それより前の数件を履歴として小さく出す
const feed = [];
const FEED_SIZE = 5;

// replace: 最新の1件を書き換える（同じ出来事に一言足すとき）
function say(msg, { replace = false } = {}) {
  if (msg && replace && feed.length) {
    feed[0] = msg;
  } else if (msg) {
    feed.unshift(msg);
    feed.length = Math.min(feed.length, FEED_SIZE);
  } else {
    feed.length = 0;
  }
  const m = $('message');
  m.textContent = feed[0] ?? '';
  m.classList.remove('show');
  void m.offsetWidth;  // アニメーションを再生し直す
  m.classList.add('show');
  $('log').innerHTML = feed.slice(1).map(t => `<li>${t}</li>`).join('');
}

// ===== ヘッダー =====
function renderRoundInfo() {
  const pips = Array.from({ length: CONFIG.TURNS_PER_ROUND }, (_, i) =>
    `<span class="pip${i < state.turn ? ' on' : ''}"></span>`).join('');
  $('roundDisplay').innerHTML = `
    <span>ラウンド <b>${state.round}</b> / ${CONFIG.TOTAL_ROUNDS}</span>
    <span class="turn" aria-label="ターン ${state.turn} / ${CONFIG.TURNS_PER_ROUND}">ターン ${pips}</span>`;
}

// ===== 場のサイコロ =====
function renderTableHead() {
  const rolled = state.dice.every(d => d.face) && state.phase !== 'rolling';
  if (rolled) {
    const results = state.dice.map(d => d.face);
    const ones = results.filter(r => r === 1).length;
    $('tableHead').innerHTML = `
      <span class="table-title">場のサイコロ <b>${state.dice.length}</b> / ${CONFIG.MAX_DICE}</span>
      <span class="expect">出目
        <span class="n1">1</span> が ${ones}個
        <span class="n8">8</span> が ${results.length - ones}個
        <span class="sum">合計 ${sumOf(results)}</span></span>`;
    return;
  }
  const expect1 = state.dice.reduce((s, d) => s + d.p1, 0);
  const expect8 = state.dice.length - expect1;
  $('tableHead').innerHTML = `
    <span class="table-title">場のサイコロ <b>${state.dice.length}</b> / ${CONFIG.MAX_DICE}</span>
    <span class="expect">今振ったら平均
      <span class="n1">1</span> が ${expect1.toFixed(1)}個
      <span class="n8">8</span> が ${expect8.toFixed(1)}個</span>`;
}

// 振る前は「1」と「8」の確率を2色の帯で、振った後は出目を大きく表示する
function dieFace(d, landed) {
  if (d.face) {
    return `<div class="die-face rolled is-${d.face}${landed ? ' landed' : ''}">${d.face}</div>`;
  }
  const p1 = Math.round(d.p1 * 100);
  const part = (n, pct) => `<span class="odd odd-${n}">${pct >= 25 ? `<b>${n}</b>${pct}%` : ''}</span>`;
  return `
    <div class="die-face odds" style="grid-template-rows:minmax(0,${p1}fr) minmax(0,${100 - p1}fr)"
         aria-label="1 が ${p1}%、8 が ${100 - p1}%">
      ${part(1, p1)}${part(8, 100 - p1)}
    </div>`;
}

// 帯が細すぎて中に書けない側の確率（無ければ空）
function hiddenOdds(d) {
  const p1 = Math.round(d.p1 * 100);
  if (d.face || d.fixed) return '';
  if (p1 > 0 && p1 < 25) return `<span class="die-note">1 は${p1}%</span>`;
  if (p1 < 100 && p1 > 75) return `<span class="die-note">8 は${100 - p1}%</span>`;
  return '';
}

function renderStage(landed = false) {
  const hl = new Set(state.judgeStep?.dice ?? []);
  $('stage').innerHTML = state.dice.map((d, i) => `
    <div class="die${d.fixed ? ' fixed' : ''}${hl.has(i) ? ' hl' : ''}">
      ${dieFace(d, landed)}
      <div class="die-label">サイコロ${i + 1}${d.fixed ? '<span class="lock">確定</span>' : ''}${hiddenOdds(d)}</div>
    </div>`).join('');
  renderTableHead();
  renderTableFoot();
}

// ===== 全体イベントと役の一覧 =====

function renderTableFoot() {
  const events = state.events.length === 0
    ? '<li class="event-empty">ターンが一巡するたびに1つずつ公開されます</li>'
    : state.events.map((e, i) => `
        <li class="event kind-${e.kind}">
          <span class="event-no">${i + 1}</span>
          <span><b>${e.name}</b> ${e.desc}</span>
        </li>`).join('');
  $('eventList').innerHTML = events;
}

// 役の一覧（内容は変わらないので最初に1回だけ作る）
function renderYakuList() {
  $('yakuList').innerHTML = YAKU.map(y => `
    <li><b>${y.name}</b><span>${y.desc}</span>
      <span class="yaku-pts">${y.target === 'all' ? '全員' : 'その目の人'} +${y.points}</span></li>`).join('');
}

// ===== プレイヤー =====
// 場に出したポイント系カード。番号は判定の順番（場全体での出した順）
function chips(player, withHead = true) {
  const entries = state.field
    .map((f, i) => ({ ...f, order: i + 1 }))
    .filter(f => f.owner === player);
  if (entries.length === 0) return '';
  const head = withHead ? '<p class="chips-head">場に出したカード<small>（数字は判定の順番）</small></p>' : '';
  return `${head}
  <ol class="chips">${entries.map(f => `
    <li class="chip ${resultMark(f)}${isJudgingCard(f.order - 1) ? ' judging' : ''}" title="${f.card.cond ? `${f.card.cond}: ` : ''}${f.card.text}">
      <span class="chip-no">${f.order}</span>
      <span class="chip-body"><b>${f.card.name}</b><span class="chip-eff">${f.card.effect}</span></span>
    </li>`).join('')}
  </ol>`;
}

// 判定中の人が出したカードを目立たせる
const isJudgingCard = i => state.judgeStep?.kind === 'owner' && state.field[i]?.owner === state.judgeStep.owner;

// 結果表示中は、ポイント系カードの達成・不発を色分けする
function resultMark(entry) {
  if (entry.achieved === undefined) return '';
  // 判定中は、まだ順番が来ていない人の結果を伏せておく
  if (state.phase === 'judging' && !state.revealed.has(entry.owner)) return '';
  return entry.achieved ? 'done' : 'miss';
}

// 判定中、直前の1枚でポイントが動いた人に「+20」「−13」を出す
function deltaTag(p) {
  const d = state.stepDeltas?.get(p);
  if (!d) return '';
  return `<span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${Math.abs(d)}</span>`;
}

function renderPlayers() {
  const myTurn = state.phase === 'play' || state.phase === 'handover';
  $('players').innerHTML = state.players.map((p, i) => `
    <article class="seat t${p.choice}${myTurn && i === state.current ? ' active' : ''}">
      <header class="seat-head">
        <span class="seat-name">${p.name}${p.guard ? '<span class="guard-tag">守り</span>' : ''}</span>
        ${labeledBadge(p.choice)}
      </header>
      <div class="seat-points">${p.points}<small>ポイント</small>${deltaTag(p)}</div>
      <dl class="seat-stats">
        <div><dt>掛け金</dt><dd>${p.bet}</dd></div>
        <div><dt>手札</dt><dd>${p.hand.length}枚</dd></div>
      </dl>
      ${chips(p)}
    </article>`).join('');
}

// ===== 手札 =====
// 「説明を表示」ボタンで詳しい説明文の表示を切り替える（画面の設定なので state には入れない）
let showDetail = false;

function toggleDetail() {
  showDetail = !showDetail;
  renderHand();
}

const RARITY_LABEL = ['', 'ふつう', 'ちょっとレア', 'レア'];

function cardFace(c, i) {
  const rarity = rarityOf(c);
  const chance = `引く確率 約${Math.max(1, Math.round(drawChance(c) * 100))}%`;
  const detail = `${c.text}${c.type === 'point' ? '（サイコロを振った後に判定）' : ''}。${chance}`;
  return `
    <button class="card type-${c.type} rarity-${rarity}" data-index="${i}" title="${c.text}">
      <span class="card-top">
        <span class="card-type">${CARD_TYPES[c.type]}</span>
        <span class="stars" aria-label="レア度 ${RARITY_LABEL[rarity]}" title="レア度: ${RARITY_LABEL[rarity]}">${'★'.repeat(rarity)}</span>
      </span>
      <span class="card-name">${c.name}</span>
      <span class="card-effect">${c.effect}</span>
      ${c.cond ? `<span class="card-cond">${c.cond}</span>` : ''}
      ${showDetail ? `<span class="card-desc">${detail}</span>` : ''}
    </button>`;
}

function renderHand() {
  const { phase } = state;
  $('handBar').hidden = !['play', 'handover', 'judging'].includes(phase);
  $('handBar').classList.toggle('handover', phase === 'handover' || phase === 'judging');
  const p = currentPlayer();

  if (phase === 'judging') {
    // スマホでは判定中のカードへスクロールするので、何の判定かをここにも出す
    const step = state.judgeStep;
    $('handHead').innerHTML = `
      <span class="hand-next">判定中</span>
      <span class="judge-line ${step?.achieved ? 'ok' : 'ng'}">${step?.line ?? ''}</span>`;
    $('hand').innerHTML = `<button class="btn-secondary begin" data-skip>結果まで飛ばす</button>`;
    return;
  }

  if (phase === 'handover') {
    $('handHead').innerHTML = `<span class="hand-next">次は <b>${p.name}</b> ${labeledBadge(p.choice)}</span>`;
    $('hand').innerHTML = `<button class="btn-primary begin" data-begin>手番を始める</button>`;
    return;
  }
  if (phase !== 'play') return;

  const pips = Array.from({ length: CONFIG.PLAYS_PER_TURN }, (_, i) =>
    `<span class="pip${i < state.playsLeft ? ' on' : ''}"></span>`).join('');
  $('handHead').innerHTML = `
    <span class="hand-name"><b>${p.name}</b> の手番 ${labeledBadge(p.choice)}</span>
    <span class="hand-tools">
      <span class="hand-note">ポイント系は振った後に判定</span>
      <span class="hand-left" aria-label="あと ${state.playsLeft} 枚">${pips} あと ${state.playsLeft} 枚出す</span>
      <button class="detail-toggle" data-detail aria-pressed="${showDetail}">${showDetail ? '説明を隠す' : '説明を表示'}</button>
    </span>`;
  $('hand').innerHTML = p.hand.map(cardFace).join('');
}

// ===== ラウンド結果 =====
// gains: Map(player → このラウンドの増減)
function renderResult(results, gains, over) {
  $('resultTitle').textContent = over ? '最終結果' : `ラウンド ${state.round} 結果`;
  $('resultDice').innerHTML = results.map(r => `<span class="mini is-${r}">${r}</span>`).join('');

  const ones = results.filter(r => r === 1).length;
  $('resultSummary').innerHTML = `
    <span><span class="n1">1</span> が ${ones}個</span>
    <span><span class="n8">8</span> が ${results.length - ones}個</span>
    <span>合計 ${sumOf(results)}</span>`;

  const yaku = state.yakuHits.map(y => y.yaku.name).join('、') || 'なし';
  const events = state.events.map(e => e.name).join('、') || 'なし';
  $('resultExtra').innerHTML = `<span>成立した役: <b>${yaku}</b></span><span>全体イベント: <b>${events}</b></span>`;

  // 同点は同じ順位にする（例: 1位, 1位, 3位）
  const ranking = [...state.players].sort((a, b) => b.points - a.points);
  $('resultRows').innerHTML = ranking.map(p => {
    const rank = ranking.findIndex(q => q.points === p.points) + 1;
    const diff = gains.get(p);
    return `
      <li class="result-row${rank === 1 ? ' lead' : ''}">
        <span class="rank">${rank}<small>位</small></span>
        <div class="row-main">
          <div class="row-head">
            <span class="row-name">${p.name}</span>${badge(p.choice)}
            <span class="gain ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">このラウンド ${diff > 0 ? '+' : ''}${diff}</span>
            <span class="total">${p.points}<small>ポイント</small></span>
          </div>
          ${chips(p, false) || '<p class="no-cards">ポイント系カードなし</p>'}
        </div>
      </li>`;
  }).join('');
}

function render() {
  renderRoundInfo();
  renderStage();
  renderPlayers();
  renderHand();
}
