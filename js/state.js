// 状態: ゲーム全体の状態と、共通の小さな関数
// phase: 'setup' | 'handover' | 'play' | 'rolling' | 'judging' | 'result' | 'over'
//   handover: 端末を次の人に渡す待ち。押すまで手札を見せない
const state = {
  players: [],
  dice: [],
  field: [],        // 場に出たポイント系カード [{ card, owner }]（出した順）。ラウンドをまたいで残り、毎ラウンド判定される
  round: 1,
  turn: 1,
  current: 0,
  first: 0,         // このラウンドの最初の手番の人（ラウンドごとに1人ずつずれる）
  firstOffset: 0,   // ラウンド1の最初の手番の人（ゲーム開始時にランダムに決める）
  playsLeft: 0,     // この手番であと何枚出すか
  extraTurn: false, // 手番の後にもう一度同じ人の手番になるか
  phase: 'setup',
  halved: new Set(), // このラウンドの判定で、すでに半分にされた人
  events: [],         // 公開された全体イベント（公開された順）。ラウンドをまたいで残り、毎ラウンド起きる
  yakuHits: [],       // 直近の判定で成立した役
  judgeStep: null,    // 判定中に表示している1コマ { kind, owner?, dice?, line, achieved }
  judgeNo: 0,         // 判定の何コマ目か
  stepDeltas: null,   // 直前に判定した1枚で、各プレイヤーのポイントがいくつ動いたか
  skipJudge: false,   // 「結果まで飛ばす」が押された
  stepMs: 900,        // このラウンドの判定1コマの表示時間
  revealed: new Set(), // 判定中、カードの結果をもう見せた人
};

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const currentPlayer = () => state.players[state.current];

// p1 は「1」が出る確率。fixed のサイコロは確率系カードの影響を受けない
const newDie = (p1 = 0.5, fixed = false) => ({ p1, fixed, face: null });

const clamp01 = x => Math.min(1, Math.max(0, Math.round(x * 100) / 100));
const sumOf = results => results.reduce((a, b) => a + b, 0);
const countOwn = (player, results) => results.filter(r => r === player.choice).length;
const othersOf = player => state.players.filter(q => q !== player);

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const pickRandom = (arr, n) => shuffle([...arr]).slice(0, n);

// 目的の数を「1」と「8」に半々で割り振る（奇数人数なら8が1人多い）
function assignChoices() {
  const n = state.players.length;
  const half = Math.floor(n / 2);
  const choices = shuffle([...Array(half).fill(1), ...Array(n - half).fill(8)]);
  state.players.forEach((p, i) => { p.choice = choices[i]; });
}

function rollFace(die) {
  return Math.random() < die.p1 ? 1 : 8;
}
