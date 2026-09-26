// 全体イベント: ターンが一巡するたびに1つ公開され、サイコロを振った後に起きる
// 公開されたイベントはラウンドをまたいで残り、毎ラウンド起きる
//
// kind
//   'dice'   : 振った直後、役や判定の前にサイコロを変える。apply() は { msg, dice: [目立たせるサイコロ] } を返す
//   'rule'   : このラウンドの判定のしかたを変える（judgeRound が id を見て切り替える）
//   'points' : 判定がすべて終わった後にポイントを動かす。apply() はメッセージを返す
// 同じイベントは2回公開されない

const pickDiceIndexes = n => pickRandom(state.dice.map((_, i) => i), n).sort((a, b) => a - b);
const lowestPlayers = () => state.players.filter(p => p.points === Math.min(...state.players.map(q => q.points)));
const topPlayers = () => state.players.filter(p => p.points === Math.max(...state.players.map(q => q.points)));
const names = ps => ps.map(p => p.name).join('・');

const EVENTS = [
  // ===== サイコロが変わる =====
  { id: 'swap3', kind: 'dice', name: '入れ替え', desc: 'ランダムなサイコロ3個の出目が入れ替わる',
    apply: () => {
      const idx = pickDiceIndexes(3);
      const faces = idx.map(i => state.dice[i].face);
      idx.forEach((i, k) => { state.dice[i].face = faces[(k + 1) % faces.length]; });  // 1つずつずらす
      return { msg: `サイコロ${idx.map(i => i + 1).join('・')} の出目が入れ替わった`, dice: idx };
    } },
  { id: 'vanish2', kind: 'dice', name: '消滅', desc: 'ランダムなサイコロ2個が消える（最低1個は残る）',
    apply: () => {
      const n = Math.min(2, state.dice.length - 1);
      const idx = pickDiceIndexes(n);
      state.dice = state.dice.filter((_, i) => !idx.includes(i));
      return { msg: n ? `サイコロ${idx.map(i => i + 1).join('・')} が消えた` : '消せるサイコロがなかった', dice: [] };
    } },
  { id: 'flip1', kind: 'dice', name: '反転', desc: 'ランダムなサイコロ1個の出目が反対になる',
    apply: () => {
      const [i] = pickDiceIndexes(1);
      state.dice[i].face = opposite(state.dice[i].face);
      return { msg: `サイコロ${i + 1} が「${state.dice[i].face}」に変わった`, dice: [i] };
    } },
  { id: 'sort', kind: 'dice', name: '整列', desc: '出目を 1 → 8 の順に並べ替える（役ができやすい）',
    apply: () => {
      state.dice.sort((a, b) => a.face - b.face);
      return { msg: 'サイコロが 1 → 8 の順に並んだ', dice: state.dice.map((_, i) => i) };
    } },
  { id: 'extraDie', kind: 'dice', name: '飛び入り', desc: '1 と 8 が50%ずつのサイコロを1個追加して振る',
    apply: () => {
      if (state.dice.length >= CONFIG.MAX_DICE) return { msg: 'サイコロが上限なので追加されなかった', dice: [] };
      const d = newDie();
      d.face = rollFace(d);
      state.dice.push(d);
      return { msg: `サイコロ${state.dice.length} が飛び入りで「${d.face}」`, dice: [state.dice.length - 1] };
    } },

  // ===== 判定のしかたが変わる =====
  { id: 'reverse', kind: 'rule', name: '逆順', desc: 'ポイント系カードを、出した順とは逆から判定する' },
  { id: 'yakuDouble', kind: 'rule', name: '役祭り', desc: '役のポイントが2倍になる' },

  // ===== ポイントが動く（判定の後） =====
  { id: 'rescue', kind: 'points', name: '救済', desc: '判定の後、ポイントが最下位の人に +30',
    apply: () => { const ps = lowestPlayers(); ps.forEach(p => { p.points += 30; }); return `最下位の ${names(ps)} に +30`; } },
  { id: 'tax', kind: 'points', name: '税金', desc: '判定の後、ポイントが1位の人から −20',
    apply: () => { const ps = topPlayers(); ps.forEach(p => { p.points = Math.max(0, p.points - 20); }); return `1位の ${names(ps)} から −20`; } },
  { id: 'gift', kind: 'points', name: 'ご祝儀', desc: '判定の後、全員に +10',
    apply: () => { state.players.forEach(p => { p.points += 10; }); return '全員に +10'; } },
];

// まだ公開されていないイベントから1つ引く（全部出たら何も追加しない）
function drawEvent() {
  const rest = EVENTS.filter(e => !state.events.includes(e));
  return rest[Math.floor(Math.random() * rest.length)];
}

const hasEvent = id => state.events.some(e => e.id === id);
