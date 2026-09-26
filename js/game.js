// 進行: ボタン操作・ターン/ラウンドの流れ（最後に読み込む）

// ===== 手番 =====
// 手番の準備。同じ人が続けて行う（もう一度手番）とき以外は、端末の受け渡しを待つ
function startTurn(samePlayer = false) {
  state.playsLeft = CONFIG.PLAYS_PER_TURN;
  state.extraTurn = false;
  state.phase = samePlayer ? 'play' : 'handover';
  render();
}

function beginTurn() {
  if (state.phase !== 'handover') return;
  state.phase = 'play';  // 前の人の最後の行動メッセージは残しておく
  render();
}

// 手札の index 番目のカードを出す
function playCard(index) {
  if (state.phase !== 'play') return;
  const p = currentPlayer();
  const [card] = p.hand.splice(index, 1);
  if (!card) return;

  if (card.type === 'point') {
    state.field.push({ card, owner: p });
    say(`${p.name} は「${card.name}」を場に出した`);
  } else {
    say(`${p.name} の「${card.name}」: ${card.play(p)}`);
  }
  if (rarityOf(card) === 3) say(`レアカード！ ${feed[0]}`, { replace: true });

  state.playsLeft--;
  if (state.playsLeft === 0) endTurn();
  else render();
}

// 手札を補充して次の手番へ。一巡したらターンを進め、最終ターン後はサイコロを振る
function endTurn() {
  const p = currentPlayer();
  p.hand.push(...drawCards(CONFIG.HAND_SIZE - p.hand.length));

  if (state.extraTurn) {
    say(`${p.name} はもう一度手番`);
    startTurn(true);
    return;
  }

  state.current = (state.current + 1) % state.players.length;
  if (state.current === state.first) {
    addEvent();
    state.turn++;
    if (state.turn > CONFIG.TURNS_PER_ROUND) {
      state.turn = CONFIG.TURNS_PER_ROUND;
      rollDiceRound();
      return;
    }
  }
  startTurn();
}

$('handBar').addEventListener('click', e => {
  if (e.target.closest('button[data-begin]')) return beginTurn();
  if (e.target.closest('button[data-skip]')) return skipJudging();
  if (e.target.closest('button[data-detail]')) return toggleDetail();
  const btn = e.target.closest('button[data-index]');
  if (btn) playCard(Number(btn.dataset.index));
});

// ターンが一巡するたびに全体イベントを1つ公開する（振った後に起きる）
function addEvent() {
  const ev = drawEvent();
  if (!ev) return;
  state.events.push(ev);
  say(`全体イベント「${ev.name}」が追加された: ${ev.desc}`);
}

// ===== ラウンド =====
function startGame() {
  state.players = Array.from({ length: selectedCount }, (_, i) => ({
    id: i + 1,
    name: `プレイヤー${i + 1}`,
    points: CONFIG.START_POINTS,
    bet: CONFIG.BASE_BET,
    choice: null,
    hand: [],
    guard: false,  // 「守り」を出したラウンドは true
  }));
  // サイコロ・手札・目的の数・掛け金・場のカード・全体イベントはゲームの最初に1回だけ用意し、
  // ラウンドが変わっても持ち越す
  state.dice = Array.from({ length: CONFIG.START_DICE }, () => newDie());
  state.field = [];
  state.events = [];
  state.players.forEach(p => { p.hand = drawCards(CONFIG.HAND_SIZE); });
  assignChoices();
  state.round = 0;
  // ラウンド数が人数で割り切れないと、最初の人だけ先手が1回多くなるので、誰から始めるかはランダムにする
  state.firstOffset = Math.floor(Math.random() * state.players.length);
  $('setupPanel').hidden = true;
  $('gamePanel').hidden = false;
  startRound();
}

function startRound() {
  state.round++;
  state.turn = 1;
  // 後の手番ほど最終的なサイコロを見てから動けて有利なので、最初の手番をラウンドごとにずらす
  state.first = (state.firstOffset + state.round - 1) % state.players.length;
  state.current = state.first;
  // 前のラウンドで振った出目と判定結果だけ消す。「守り」はカードの効果どおりラウンドごとに切れる
  state.dice.forEach(d => { d.face = null; });
  state.field.forEach(f => { delete f.achieved; });
  state.players.forEach(p => { p.guard = false; });
  $('roundResult').hidden = true;
  say(`ラウンド${state.round}開始`);
  startTurn();
}

async function rollDiceRound() {
  state.phase = 'rolling';
  state.dice.forEach(d => { d.face = null; });
  say('全てのサイコロを振ります…');
  render();

  // 全てのサイコロを同時に振る。最後に表示した出目がそのまま結果になる
  const frames = reducedMotion ? 1 : 12;
  for (let f = 0; f < frames; f++) {
    state.dice.forEach(d => { d.face = rollFace(d); });
    renderStage();
    await sleep(60 + f * 10);
  }
  renderStage(true);
  await sleep(600);
  judgeRound();
}

// ===== 判定 =====
// ポイント系カードを出した順に1枚ずつ判定し、誰のポイントがどう動いたかを見せる
const JUDGE_MS = 900;       // 1コマあたりの表示時間（判定が少ないとき）
const JUDGE_MIN_MS = 350;   // 判定が多いときの最短
const JUDGE_TOTAL_MS = 12000; // 判定全体をだいたいこの時間に収める
let cancelWait = null;    // 「結果まで飛ばす」で待ち時間を打ち切る

function waitOrSkip(ms) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    cancelWait = () => { clearTimeout(timer); resolve(); };
  });
}

function skipJudging() {
  state.skipJudge = true;
  cancelWait?.();
}

// 判定の1ステップ。apply() で状態を変え、その結果を1コマ見せる
//   info: { kind: 'event' | 'yaku' | 'owner', owner?, dice? }
//   apply(): { line, achieved, dice? } を返す
// 演出するときだけ待ち時間の Promise を返す。飛ばすときは何も返さない
// （await しなければ判定全体が同期的に終わるので、「結果まで飛ばす」やテストで一気に進む）
function judgeStep(info, apply) {
  const prev = new Map(state.players.map(p => [p, p.points]));
  const out = apply();
  if (state.skipJudge) return null;

  state.judgeNo++;
  state.judgeStep = { ...info, ...out };
  state.stepDeltas = new Map(state.players.map(p => [p, p.points - prev.get(p)]));
  say(out.line);
  render();
  document.querySelector('.chip.judging, .die.hl')
    ?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
  return waitOrSkip(reducedMotion ? JUDGE_MIN_MS : state.stepMs);
}

// 振った後の流れ: サイコロが変わるイベント → 役 → ポイント系カード → ポイントが動くイベント
// instant: 演出なしで一気に判定する（「結果まで飛ばす」やテスト用）
async function judgeRound({ instant = false } = {}) {
  state.phase = 'judging';
  state.skipJudge = instant;
  state.halved = new Set();
  state.judgeNo = 0;
  state.revealed = new Set();
  const before = new Map(state.players.map(p => [p, p.points]));
  const byKind = kind => state.events.filter(e => e.kind === kind);
  // コマ数が多いほど1コマを短くする（ポイント系カードは出した人ごとに1コマ、役は多めに2と見積もる）
  const owners = new Set(state.field.map(f => f.owner)).size;
  const steps = state.events.filter(e => e.kind !== 'rule').length + owners + 2;
  state.stepMs = Math.max(JUDGE_MIN_MS, Math.min(JUDGE_MS, JUDGE_TOTAL_MS / steps));

  // 1. サイコロが変わるイベント
  for (const ev of byKind('dice')) {
    const w = judgeStep({ kind: 'event' }, () => {
      const { msg, dice } = ev.apply();
      return { line: `全体イベント「${ev.name}」: ${msg}`, achieved: true, dice };
    });
    if (w) await w;
  }

  // 2. 役（イベントで変わった後の並びで判定）
  const results = state.dice.map(d => d.face);
  const yakuRate = hasEvent('yakuDouble') ? 2 : 1;
  state.yakuHits = findYaku(results);
  for (const y of state.yakuHits) {
    const w = judgeStep({ kind: 'yaku' }, () => {
      const targets = yakuTargets(y);
      const pts = y.yaku.points * yakuRate;
      targets.forEach(p => { p.points += pts; });
      const who = y.yaku.target === 'all' ? '全員' : `目的の数 ${y.face} の人（${targets.length}人）`;
      return { line: `役「${y.yaku.name}」成立！ ${who}に +${pts}`, achieved: true, dice: y.dice };
    });
    if (w) await w;
  }

  // 3. ポイント系カード
  // 判定そのものは出した順（「逆順」なら逆から）に1枚ずつ行う。
  // 場のカードはラウンドごとに増えて1枚ずつ見せると長くなるので、見せるのはカードを出した人ごとにまとめる
  const order = state.field.map((_, i) => i);
  if (hasEvent('reverse')) order.reverse();
  const start = new Map(state.players.map(p => [p, p.points]));
  const byOwner = new Map();  // 出した人 → そのカードで各プレイヤーのポイントがいくつ動いたか
  for (const i of order) {
    const entry = state.field[i];
    const prev = new Map(state.players.map(p => [p, p.points]));
    entry.achieved = entry.card.resolve(entry.owner, results);
    const moved = byOwner.get(entry.owner) ?? new Map();
    state.players.forEach(p => moved.set(p, (moved.get(p) ?? 0) + p.points - prev.get(p)));
    byOwner.set(entry.owner, moved);
  }
  // 見せるときは判定前のポイントから、出した人ごとに増減を足していく（最後は判定後と同じ値になる）
  state.players.forEach(p => { p.points = start.get(p); });
  for (const owner of state.players.filter(p => byOwner.has(p))) {
    const mine = state.field.filter(f => f.owner === owner);
    const hit = mine.filter(f => f.achieved).length;
    const w = judgeStep({ kind: 'owner', owner }, () => {
      state.revealed.add(owner);
      byOwner.get(owner).forEach((d, p) => { p.points += d; });
      const own = byOwner.get(owner).get(owner);
      return { line: `${owner.name} のカード ${mine.length}枚: ${hit}枚達成${own ? `（${own > 0 ? '+' : '−'}${Math.abs(own)}）` : ''}`, achieved: hit > 0 };
    });
    if (w) await w;
  }

  // 4. ポイントが動くイベント
  for (const ev of byKind('points')) {
    const w = judgeStep({ kind: 'event' }, () => ({ line: `全体イベント「${ev.name}」: ${ev.apply()}`, achieved: true }));
    if (w) await w;
  }

  state.judgeStep = null;
  state.stepDeltas = null;
  showRoundResult(results, new Map(state.players.map(p => [p, p.points - before.get(p)])));
}

// gains: Map(player → このラウンドの増減)
function showRoundResult(results, gains) {
  say('');
  const over = state.round >= CONFIG.TOTAL_ROUNDS;
  state.phase = over ? 'over' : 'result';
  renderResult(results, gains, over);
  $('nextRoundBtn').hidden = over;
  $('roundResult').hidden = false;
  if (over) say('ゲーム終了！最終結果を確認してください');
  render();
  $('roundResult').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
}

// ===== 開始画面 =====
let selectedCount = CONFIG.MIN_PLAYERS;

function renderCountPicker() {
  const picker = $('countPicker');
  picker.innerHTML = '';
  for (let n = CONFIG.MIN_PLAYERS; n <= CONFIG.MAX_PLAYERS; n++) {
    const b = document.createElement('button');
    b.textContent = n;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', n === selectedCount);
    b.setAttribute('aria-label', `${n}人`);
    b.addEventListener('click', () => { selectedCount = n; renderCountPicker(); });
    picker.appendChild(b);
  }
}

$('startBtn').addEventListener('click', startGame);
renderYakuList();
$('nextRoundBtn').addEventListener('click', startRound);
renderCountPicker();
