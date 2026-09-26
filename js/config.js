// 設定: ルールの数値（ラウンド数・初期ポイント・カードの強さなど）
const CONFIG = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 6,
  TOTAL_ROUNDS: 3,
  TURNS_PER_ROUND: 3,
  START_POINTS: 50,
  BASE_BET: 10,        // 掛け金の初期値（ゲームの最初だけ。ラウンドが変わっても戻らない）
  BET_STEP: 10,        // 「掛け金を増やす」カードで増える額
  HAND_SIZE: 5,        // 手札の枚数
  PLAYS_PER_TURN: 2,   // 1回の手番で出す枚数
  MAX_DICE: 12,        // 場に置けるサイコロの上限
  START_DICE: 3,       // ゲーム開始時のサイコロ（1と8が50%ずつ）。ラウンドが変わってもそのまま残る
};

// カードの強さ。数値を変えるとカードの説明文も自動で変わる
// 「〜Bet」は掛け金の何倍か（例: evenBet 2 → 「+掛け金×2」。掛け金10なら+20、20なら+40）
const BALANCE = {
  flatPoints: 15,         // ボーナス: ○ポイント（掛け金に関係なし）
  perHitEvery: 3,         // 的中: 目的の数が○個出るごとに +掛け金
  highShare: 0.7,         // 8 優勢: 8 がこの割合以上なら
  highBet: 4,             //   → +掛け金×○
  evenBet: 2,             // 偶数: +掛け金×○
  oddBet: 1,              // 奇数: 他の全員 −各自の掛け金×○
  halfShare: 0.6,         // 圧勝: 目的の数がこの割合以上なら 相手全員（目的の数が違う人）を半分に
  manyHitsCount: 5,       // 大当たり: 目的の数が○個以上なら
  manyBet: 3,             //   → +掛け金×○
  underdogReward: 45,     // 下剋上: 判定の時点で最下位なら ○ポイント（掛け金に関係なし）
  teamBet: 2,             // 仲間: 目的の数が過半数なら、味方全員に +各自の掛け金×○
  perfectMinDice: 5,      // 独占: サイコロがこの数以上あって
  perfectBet: 8,          //   目的の数でない出目が1個以下なら +掛け金×○
};
