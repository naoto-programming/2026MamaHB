// カード: 手札として配られるカードの一覧
//
// 表示用の項目。カードは「名前 → 効果（大きく）→ 条件（小さく）」の順に読ませる
//   name   : カード名
//   effect : 効果。一番大きく出す。主語と単位は省かない（「+15」ではなく「+15ポイント」）
//   cond   : 条件・対象（無ければ null）。「〜なら」などの言い回しは省く
//   text   : 詳しい説明（「説明を表示」のときだけ出す）
//
// type が 'point' のカードは、出すと場に置かれ、サイコロを振った後に resolve が呼ばれる
//   resolve(owner, results) : 条件を満たしたら効果を適用して true を返す
// それ以外のカードは、出した瞬間に play が呼ばれる
//   play(player) : 効果を適用し、画面に出すメッセージを返す
// weight : 引かれやすさ（省略時 1）。強いカード（もう一回・守り・掛け金アップなど）は低めにしている
//          掛け金アップは、増えた掛け金が以降のラウンドの「×掛け金」全部に効くので特に低い
//
// 「出目」は4ターン目終了時に振った全サイコロの出目（results 配列）

const CARD_TYPES = {
  point: 'ポイント',
  prob: '確率',
  special: '特殊',
  dice: 'サイコロ',
};

const B = BALANCE;
// 「掛け金×k」の表示（k が 1 なら「掛け金」だけ）
const betText = k => (k === 1 ? '掛け金' : `掛け金×${k}`);
const pct = share => `${Math.round(share * 100)}%`;
const shareOf = (n, results) => results.filter(r => r === n).length / results.length;

// 目的の数の側へ確率を動かす（目的の数が8なら「1」の確率を下げる）
function shiftToward(die, choice, delta) {
  die.p1 = clamp01(die.p1 + (choice === 1 ? delta : -delta));
}

const ownProb = (die, choice) => (choice === 1 ? die.p1 : 1 - die.p1);
const opposite = choice => (choice === 1 ? 8 : 1);

// 「守り」を出した人は、他の人のカードでポイントが減らない
const exposedOthersOf = p => othersOf(p).filter(q => !q.guard);
const movableDice = () => state.dice.filter(d => !d.fixed);
const NO_MOVABLE = '確率を変えられるサイコロがなかった';

// 上限を超えない範囲でサイコロを追加し、メッセージを返す
function addDice(count, p1, fixed, label) {
  const room = CONFIG.MAX_DICE - state.dice.length;
  const added = Math.min(count, room);
  for (let i = 0; i < added; i++) state.dice.push(newDie(p1, fixed));
  if (added === 0) return `サイコロが上限（${CONFIG.MAX_DICE}個）なので追加できなかった`;
  return `${label}を${added}つ追加${added < count ? '（上限に達した）' : ''}`;
}

const CARDS = [
  // ===== ポイント系 =====
  { id: 'bonus', type: 'point', name: 'ボーナス',
    effect: `+${B.flatPoints}ポイント`, cond: null,
    text: `自分に${B.flatPoints}ポイント付与（掛け金に関係なし）`,
    resolve: p => { p.points += B.flatPoints; return true; } },
  { id: 'perHit', type: 'point', name: '的中',
    effect: `${B.perHitEvery}個ごとに +掛け金`, cond: '目的の数が出た個数で',
    text: `出目のうち目的の数が${B.perHitEvery}個出るごとに、掛け金と同じポイントを自分に付与`,
    resolve: (p, r) => { const n = Math.floor(countOwn(p, r) / B.perHitEvery); p.points += n * p.bet; return n > 0; } },
  { id: 'high', type: 'point', name: '8 優勢',
    effect: `+${betText(B.highBet)}`, cond: `出目の${pct(B.highShare)}以上が 8`,
    text: `出目のうち 8 が${pct(B.highShare)}以上なら、掛け金の${B.highBet}倍を自分に付与`,
    resolve: (p, r) => {
      if (shareOf(8, r) < B.highShare) return false;
      p.points += B.highBet * p.bet;
      return true;
    } },
  { id: 'even', type: 'point', name: '偶数',
    effect: `+${betText(B.evenBet)}`, cond: '出目の合計が偶数',
    text: `出目の合計が偶数なら、掛け金の${B.evenBet}倍を自分に付与`,
    resolve: (p, r) => { if (sumOf(r) % 2 !== 0) return false; p.points += B.evenBet * p.bet; return true; } },
  { id: 'odd', type: 'point', name: '奇数',
    effect: `他の全員 −各自の${betText(B.oddBet)}`, cond: '出目の合計が奇数',
    text: `出目の合計が奇数なら、自分以外の全員から、それぞれの掛け金${B.oddBet === 1 ? '' : `の${B.oddBet}倍`}を没収`,
    resolve: (p, r) => {
      if (sumOf(r) % 2 === 0) return false;
      exposedOthersOf(p).forEach(q => { q.points = Math.max(0, q.points - B.oddBet * q.bet); });
      return true;
    } },
  // 何枚発動しても、1人が半分にされるのは1ラウンドに1回まで（重なると0点近くまで削れてしまうため）
  // 条件を「1」ではなく自分の目的の数にしている。「1」固定だと、8 の人が
  // 「1 が多く出たら 1 の人を半分にする」保険として使えてしまい、8 のチームが有利になっていた
  { id: 'half', type: 'point', name: '圧勝',
    effect: '相手全員のポイント半分', cond: `出目の${pct(B.halfShare)}以上が目的の数`,
    text: `出目のうち自分の目的の数が${pct(B.halfShare)}以上なら、目的の数が自分と違う人全員のポイントを半分にする（半分になるのは1ラウンドに1回まで）`,
    resolve: (p, r) => {
      if (shareOf(p.choice, r) < B.halfShare) return false;
      exposedOthersOf(p).filter(q => q.choice !== p.choice && !state.halved.has(q)).forEach(q => {
        q.points = Math.floor(q.points / 2);
        state.halved.add(q);
      });
      return true;
    } },
  { id: 'many', type: 'point', name: '大当たり',
    effect: `+${betText(B.manyBet)}`, cond: `目的の数が${B.manyHitsCount}個以上`,
    text: `出目のうち目的の数が${B.manyHitsCount}個以上なら、掛け金の${B.manyBet}倍を自分に付与`,
    resolve: (p, r) => {
      if (countOwn(p, r) < B.manyHitsCount) return false;
      p.points += B.manyBet * p.bet;
      return true;
    } },
  { id: 'perfect', type: 'point', weight: 0.5, name: '独占',
    effect: `+${betText(B.perfectBet)}`, cond: `目的の数以外が1個以下（サイコロ${B.perfectMinDice}個以上）`,
    text: `サイコロが${B.perfectMinDice}個以上あり、目的の数でない出目が1個以下なら、掛け金の${B.perfectBet}倍を自分に付与`,
    resolve: (p, r) => {
      if (r.length < B.perfectMinDice || countOwn(p, r) < r.length - 1) return false;
      p.points += B.perfectBet * p.bet;
      return true;
    } },
  { id: 'team', type: 'point', name: '仲間',
    effect: `味方全員 +${betText(B.teamBet)}`, cond: '目的の数が過半数（掛け金は各自の）',
    text: `出目の過半数が目的の数なら、自分と同じ目的の数の全員に、それぞれの掛け金の${B.teamBet}倍を付与`,
    resolve: (p, r) => {
      if (countOwn(p, r) * 2 <= r.length) return false;
      state.players.filter(q => q.choice === p.choice).forEach(q => { q.points += B.teamBet * q.bet; });
      return true;
    } },
  // 判定は出した順なので、「その時点」で最下位かどうかで決まる
  { id: 'underdog', type: 'point', weight: 0.6, name: '下剋上',
    effect: `+${B.underdogReward}ポイント`, cond: '判定のとき最下位',
    text: `このカードを判定する時点で自分のポイントが最下位（同点を含む）なら、${B.underdogReward}ポイント付与（掛け金に関係なし）`,
    resolve: p => {
      if (p.points > Math.min(...othersOf(p).map(q => q.points))) return false;
      p.points += B.underdogReward;
      return true;
    } },

  // ===== 確率系 =====
  { id: 'prob30', type: 'prob', name: '狙い撃ち',
    effect: '目的の数 +30%', cond: 'ランダムなサイコロ1個',
    text: 'ランダムなサイコロ1つの、目的の数が出る確率を+30%',
    play: p => {
      const picked = pickRandom(movableDice(), 1);
      if (picked.length === 0) return NO_MOVABLE;
      picked.forEach(d => shiftToward(d, p.choice, 0.3));
      return `サイコロ${state.dice.indexOf(picked[0]) + 1} の「${p.choice}」の確率を+30%`;
    } },
  { id: 'prob10x3', type: 'prob', name: '底上げ',
    effect: '目的の数 +10%', cond: 'ランダムなサイコロ3個',
    text: 'ランダムなサイコロ3つの、目的の数が出る確率を+10%',
    play: p => {
      const picked = pickRandom(movableDice(), 3);
      if (picked.length === 0) return NO_MOVABLE;
      picked.forEach(d => shiftToward(d, p.choice, 0.1));
      return `サイコロ${picked.length}つの「${p.choice}」の確率を+10%`;
    } },
  { id: 'donden', type: 'prob', weight: 0.6, name: 'どんでん返し',
    effect: '1 と 8 の確率を逆に', cond: '全サイコロ（確定も）',
    text: '全てのサイコロの「1」と「8」の確率を入れ替える。確定のサイコロも反対の目の確定になる',
    play: () => {
      state.dice.forEach(d => { d.p1 = clamp01(1 - d.p1); });
      return '全てのサイコロの 1 と 8 の確率が入れ替わった！';
    } },
  { id: 'reset', type: 'prob', weight: 0.8, name: 'リセット',
    effect: '50% に戻す', cond: '目的の数が一番出にくい1個',
    text: '目的の数が出る確率が最も低いサイコロを1つ、50%に戻す（確定のサイコロも対象）',
    play: p => {
      const worst = state.dice.reduce((a, b) => (ownProb(b, p.choice) < ownProb(a, p.choice) ? b : a));
      if (worst.p1 === 0.5 && !worst.fixed) return '50%より不利なサイコロがなかった';
      worst.p1 = 0.5;
      worst.fixed = false;
      return `サイコロ${state.dice.indexOf(worst) + 1} を50%に戻した`;
    } },

  // ===== 特殊系 =====
  { id: 'rev', type: 'special', weight: 0.7, name: '寝返り',
    effect: '目的の数を反対に', cond: '1 ⇔ 8',
    text: '自分の目的の数を反対にする（1 なら 8 に、8 なら 1 に）',
    play: p => { p.choice = opposite(p.choice); return `目的の数を「${p.choice}」に寝返った！`; } },
  { id: 'steal', type: 'special', weight: 0.6, name: '横取り',
    effect: 'ポイント系を1枚奪う', cond: '他の人が最後に出した1枚',
    text: '場にあるポイント系カードのうち、他の人が最後に出した1枚を自分のものにする（判定の順番はそのまま）',
    play: p => {
      const target = [...state.field].reverse().find(f => f.owner !== p);
      if (!target) return '横取りできるカードがなかった';
      const from = target.owner;
      target.owner = p;
      return `${from.name} の「${target.card.name}」を横取りした！`;
    } },
  { id: 'guard', type: 'special', weight: 0.5, name: '守り',
    effect: '減点されない', cond: 'このラウンド中、他の人のカードで',
    text: 'このラウンドの判定で、他の人のカード（奇数・圧勝）によって自分のポイントが減らない',
    play: p => { p.guard = true; return 'このラウンドはポイントを減らされない'; } },
  { id: 'extra', type: 'special', weight: 0.35, name: 'もう一回',
    effect: 'もう一度手番', cond: 'この手番の後',
    text: 'この手番の後、もう一度自分の手番になる',
    play: () => { state.extraTurn = true; return 'この手番の後、もう一度手番が回ってくる'; } },
  { id: 'bet', type: 'special', weight: 0.45, name: '掛け金アップ',
    effect: `掛け金 +${CONFIG.BET_STEP}`, cond: '「掛け金」と書かれたカードが強くなる',
    text: `自分の掛け金を${CONFIG.BET_STEP}増やす。「+掛け金×2」などのカードで得るポイントが増える（増えた掛け金は次のラウンドも続く）`,
    play: p => { p.bet += CONFIG.BET_STEP; return `掛け金が ${p.bet} になった`; } },
  { id: 'redraw', type: 'special', weight: 0.7, name: '引き直し',
    effect: '手札を全部交換', cond: null,
    text: '自分の手札を全て引き直す',
    play: p => { p.hand = drawCards(CONFIG.HAND_SIZE); return '手札を全て引き直した'; } },

  // ===== サイコロ系 =====
  { id: 'dice1', type: 'dice', weight: 1, name: 'サイコロ追加',
    effect: '+1個', cond: '1 と 8 が半々',
    text: '1と8が50%ずつのサイコロを1つ追加',
    play: () => addDice(1, 0.5, false, 'サイコロ') },
  { id: 'dice2', type: 'dice', weight: 0.7, name: 'サイコロ追加',
    effect: '+2個', cond: '1 と 8 が半々',
    text: '1と8が50%ずつのサイコロを2つ追加',
    play: () => addDice(2, 0.5, false, 'サイコロ') },
  { id: 'dice3', type: 'dice', weight: 0.4, name: 'サイコロ追加',
    effect: '+3個', cond: '1 と 8 が半々',
    text: '1と8が50%ずつのサイコロを3つ追加',
    play: () => addDice(3, 0.5, false, 'サイコロ') },
  { id: 'fix1', type: 'dice', weight: 0.6, name: '確定サイコロ',
    effect: '必ず 1 が出る', cond: 'サイコロ +1個',
    text: '確定で1が出るサイコロを1つ追加',
    play: () => addDice(1, 1, true, '確定で1が出るサイコロ') },
  { id: 'fix8', type: 'dice', weight: 0.6, name: '確定サイコロ',
    effect: '必ず 8 が出る', cond: 'サイコロ +1個',
    text: '確定で8が出るサイコロを1つ追加',
    play: () => addDice(1, 0, true, '確定で8が出るサイコロ') },
];

// レア度: 引かれにくいカードほど ★ が多い（1〜3）
const TOTAL_WEIGHT = CARDS.reduce((s, c) => s + (c.weight ?? 1), 0);
const rarityOf = c => {
  const w = c.weight ?? 1;
  return w >= 0.9 ? 1 : w >= 0.55 ? 2 : 3;
};
const drawChance = c => (c.weight ?? 1) / TOTAL_WEIGHT;

// 重み付きで1枚引く
function drawCard() {
  let x = Math.random() * TOTAL_WEIGHT;
  for (const c of CARDS) {
    x -= c.weight ?? 1;
    if (x < 0) return c;
  }
  return CARDS[CARDS.length - 1];
}

const drawCards = n => Array.from({ length: n }, drawCard);
