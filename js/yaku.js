// 役: サイコロの並びが特定の形になったら、対象の人にポイント（掛け金に関係なし）
//
// サイコロの並び順（サイコロ1, 2, 3…）で判定する。役はそれぞれ1ラウンドに1回まで
//   target : 'face' なら「その役を作った目」が目的の数の人全員、'all' なら全員
//   find(results) : 成立したら { face, dice: [役を作ったサイコロの番号] } を、しなければ null を返す

// 目 n が一番長く続いている並び（開始位置と長さ）
function longestRun(results, n) {
  let best = { start: -1, len: 0 };
  let start = -1;
  results.forEach((r, i) => {
    if (r === n) {
      if (start < 0) start = i;
      if (i - start + 1 > best.len) best = { start, len: i - start + 1 };
    } else {
      start = -1;
    }
  });
  return best;
}

const range = (start, len) => Array.from({ length: len }, (_, i) => start + i);

// 目 n が「min 個以上 max 個以下」続けて並んでいるか（一番長い並びで判定）
function runOf(n, min, max = Infinity) {
  return results => {
    const { start, len } = longestRun(results, n);
    return len >= min && len <= max ? { face: n, dice: range(start, len) } : null;
  };
}

const YAKU = [
  { id: 'triple1', name: 'トリプル 1', desc: '1 が3個続けて並ぶ', target: 'face', points: 10, find: runOf(1, 3, 3) },
  { id: 'triple8', name: 'トリプル 8', desc: '8 が3個続けて並ぶ', target: 'face', points: 10, find: runOf(8, 3, 3) },
  { id: 'four1', name: 'フォー 1', desc: '1 が4個続けて並ぶ', target: 'face', points: 20, find: runOf(1, 4, 4) },
  { id: 'four8', name: 'フォー 8', desc: '8 が4個続けて並ぶ', target: 'face', points: 20, find: runOf(8, 4, 4) },
  { id: 'five1', name: 'ファイブ 1', desc: '1 が5個以上続けて並ぶ', target: 'face', points: 40, find: runOf(1, 5) },
  { id: 'five8', name: 'ファイブ 8', desc: '8 が5個以上続けて並ぶ', target: 'face', points: 40, find: runOf(8, 5) },
  { id: 'ends', name: '両端', desc: '一番左と一番右が同じ目（サイコロ3個以上）', target: 'face', points: 10,
    find: r => (r.length >= 3 && r[0] === r[r.length - 1] ? { face: r[0], dice: [0, r.length - 1] } : null) },
  { id: 'zigzag', name: 'ジグザグ', desc: '1 と 8 が4個以上交互に並ぶ', target: 'all', points: 10,
    find: r => {
      for (let i = 0; i + 3 < r.length; i++) {
        let len = 1;
        while (i + len < r.length && r[i + len] !== r[i + len - 1]) len++;
        if (len >= 4) return { face: null, dice: range(i, len) };
      }
      return null;
    } },
  { id: 'even', name: 'イーブン', desc: '1 と 8 がちょうど同じ数', target: 'all', points: 15,
    find: r => (r.filter(x => x === 1).length * 2 === r.length ? { face: null, dice: r.map((_, i) => i) } : null) },
  { id: 'all', name: 'オール', desc: '全部が同じ目（サイコロ4個以上）', target: 'face', points: 50,
    find: r => (r.length >= 4 && r.every(x => x === r[0]) ? { face: r[0], dice: r.map((_, i) => i) } : null) },
];

// 成立した役の一覧 [{ yaku, face, dice }]
function findYaku(results) {
  return YAKU.map(yaku => ({ yaku, hit: yaku.find(results) }))
    .filter(x => x.hit)
    .map(({ yaku, hit }) => ({ yaku, ...hit }));
}

// 役の対象の人（目的の数がその目の人、または全員）
const yakuTargets = y => (y.yaku.target === 'all' ? state.players : state.players.filter(p => p.choice === y.face));
