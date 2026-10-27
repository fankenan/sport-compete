/**
 * 赛程编排核心算法
 * 体育竞赛管理系统 · 实施设计 v3.0
 *
 * 只放「不碰数据库的纯函数」；涉及落库 / 事务的编排逻辑一律在 scheduler.js。
 * （2026-10-27 清理：generateSlots / packSchedule / advanceToKnockout 是早期原型，
 *   线上实际跑的是 scheduler.js 里的同名实现，已从本文件移除）
 *
 * 三个核心算法：
 *   1. bergerRotation    — 小组循环赛对阵轮转
 *   2. computeStanding   — 积分榜排序（含弃权与作废）
 *   3. buildKnockoutPairing — 淘汰赛首尾配对
 */

// ============================================================
// 一、Berger 轮转法
// ============================================================

/**
 * 生成单循环赛程
 * @param {number[]} teams 队伍 id 数组（按 seed_no 升序）
 * @returns {Array<Array<[number, number]>>} 共 n-1 轮，每轮 n/2 场
 *
 * 实测 4 队 [1,2,3,4]：
 *   第1轮 [1,4] [2,3]
 *   第2轮 [1,3] [4,2]
 *   第3轮 [1,2] [3,4]
 */
function bergerRotation(teams) {
  const n = teams.length;
  if (n < 2) return [];

  let arr = teams.slice();
  if (n % 2 === 1) arr = [...arr, null]; // 补轮空位

  const size = arr.length;
  const totalRounds = size - 1;
  const rounds = [];
  const byes = [];

  for (let r = 0; r < totalRounds; r++) {
    const pairs = [];
    let bye = null; // 本轮轮空的队伍（奇数队时才有）
    for (let i = 0; i < size / 2; i++) {
      const a = arr[i];
      const b = arr[size - 1 - i];
      if (a !== null && b !== null) {
        // 奇数轮正常，偶数轮交替主客，避免同一队总在左侧
        pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
      } else {
        bye = a === null ? b : a;
      }
    }
    rounds.push(pairs);
    byes.push(bye);

    // 最后一轮后不再旋转
    if (r === totalRounds - 1) break;

    // 固定首位，其余整体反向
    const first = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr = [first, ...rest];
  }

  rounds.byes = byes;
  return rounds;
}

/**
 * 取每轮轮空的队伍（与 bergerRotation 顺序一致）
 * @param {number[]} teams
 * @returns {Array<number|null>} 每轮轮空的队伍 id，偶数队时全为 null
 */
function bergerByes(teams) {
  const rounds = bergerRotation(teams);
  return rounds.byes || rounds.map(() => null);
}

/**
 * 校验 Berger 轮转的正确性
 *
 * 轮次规律：
 *   偶数队：n-1 轮，每轮 n/2 场（如 4 队 3 轮 × 2 场）
 *   奇数队：n 轮，每轮 (n-1)/2 场，每队恰轮空一次（如 5 队 5 轮 × 2 场）
 *   总场次恒为 n(n-1)/2
 */
function verifyRotation(teams, rounds) {
  const n = teams.length;
  const isOdd = n % 2 === 1;
  const expectedRounds = isOdd ? n : n - 1;
  const expectedPairsPerRound = Math.floor(n / 2);
  const seen = new Set();
  const byeCount = new Map();
  teams.forEach((t) => byeCount.set(t, 0));

  if (rounds.length !== expectedRounds) {
    return { ok: false, msg: `轮次数应为 ${expectedRounds}，实际 ${rounds.length}` };
  }

  for (let r = 0; r < rounds.length; r++) {
    const inRound = new Set();

    if (rounds[r].length !== expectedPairsPerRound) {
      return { ok: false, msg: `第${r + 1}轮应有 ${expectedPairsPerRound} 场，实际 ${rounds[r].length}` };
    }

    for (const [a, b] of rounds[r]) {
      if (a === b) return { ok: false, msg: `第${r + 1}轮有队伍自战` };
      if (!teams.includes(a) || !teams.includes(b)) {
        return { ok: false, msg: `第${r + 1}轮出现非法队伍 ${a} 或 ${b}` };
      }
      if (inRound.has(a) || inRound.has(b)) {
        return { ok: false, msg: `第${r + 1}轮有队伍重复出场` };
      }
      inRound.add(a); inRound.add(b);

      const key = [a, b].sort((x, y) => x - y).join('-');
      if (seen.has(key)) return { ok: false, msg: `对阵 ${key} 重复出现` };
      seen.add(key);
    }

    // 偶数队每轮全员出场；奇数队每轮恰一队轮空
    if (!isOdd && inRound.size !== n) {
      return { ok: false, msg: `第${r + 1}轮应有 ${n} 队出场，实际 ${inRound.size}` };
    }
    if (isOdd) {
      teams.forEach((t) => { if (!inRound.has(t)) byeCount.set(t, byeCount.get(t) + 1); });
    }
  }

  // 奇数队每个队必须恰好轮空一次
  if (isOdd) {
    for (const [t, c] of byeCount) {
      if (c !== 1) return { ok: false, msg: `队伍 ${t} 轮空 ${c} 次，应为 1 次` };
    }
  }

  const totalPairs = (n * (n - 1)) / 2;
  if (seen.size !== totalPairs) {
    return { ok: false, msg: `总场次应为 ${totalPairs}，实际 ${seen.size}` };
  }

  return { ok: true, msg: `正确，共 ${seen.size} 场 / ${rounds.length} 轮` };
}

// ============================================================
// 二、积分榜计算（含弃权与作废）
// ============================================================

/**
 * @param {number[]} teamIds 参与积分的队伍
 * @param {Object[]} matches 该组全部场次
 * @param {Object} [opt] { winPts=3, drawPts=1 }
 * @returns {Object[]} 排序后的积分榜
 */
function computeStanding(teamIds, matches, opt = {}) {
  const winPts = opt.winPts ?? 3;
  const drawPts = opt.drawPts ?? 1;

  const table = new Map();
  teamIds.forEach((id) => table.set(id, {
    id, played: 0, win: 0, draw: 0, lose: 0,
    scored: 0, conceded: 0, diff: 0, points: 0,
    abandonCount: 0, isVoided: false,
    // 相互战绩用：只统计本榜这几队之间的交手
    h2h: new Map()
  }));

  // 统计各队弃权次数
  matches.filter((m) => m.status === 1).forEach((m) => {
    if (m.abandon_a === 1) {
      table.get(m.team_a_id).abandonCount++;
      table.get(m.team_a_id).lose++;
    }
    if (m.abandon_b === 1) {
      table.get(m.team_b_id).abandonCount++;
      table.get(m.team_b_id).lose++;
    }
  });

  // 2 次弃权 → 该队全部成绩作废
  table.forEach((t) => {
    if (t.abandonCount >= 2) t.isVoided = true;
  });

  // 累计有效比赛
  matches.filter((m) => m.status === 1).forEach((m) => {
    const A = table.get(m.team_a_id);
    const B = table.get(m.team_b_id);
    if (!A || !B) return;

    // 有一方被作废，该场不计
    if (A.isVoided || B.isVoided) return;

    A.played++; B.played++;
    A.scored += m.score_a; A.conceded += m.score_b;
    B.scored += m.score_b; B.conceded += m.score_a;

    // 记录两队交手明细（用于相互战绩决胜）
    if (!A.h2h.has(B.id)) A.h2h.set(B.id, { opp: B.id, played: 0, points: 0, scored: 0, conceded: 0, diff: 0, win: 0 });
    if (!B.h2h.has(A.id)) B.h2h.set(A.id, { opp: A.id, played: 0, points: 0, scored: 0, conceded: 0, diff: 0, win: 0 });
    const ha = A.h2h.get(B.id);
    const hb = B.h2h.get(A.id);
    ha.played++; hb.played++;
    ha.scored += m.score_a; ha.conceded += m.score_b;
    hb.scored += m.score_b; hb.conceded += m.score_a;

    if (m.score_a > m.score_b) {
      A.win++; B.lose++;
      A.points += winPts;
      ha.win++; ha.points += winPts;
    } else if (m.score_a < m.score_b) {
      B.win++; A.lose++;
      B.points += winPts;
      hb.win++; hb.points += winPts;
    } else {
      A.draw++; B.draw++;
      A.points += drawPts; B.points += drawPts;
      ha.points += drawPts; hb.points += drawPts;
    }
  });

  table.forEach((t) => {
    t.diff = t.scored - t.conceded;
    t.h2h.forEach((h) => { h.diff = h.scored - h.conceded; });
  });

  /**
   * 两队比较：积分 → 相互战绩（积分→净胜分→得分）→ 总净胜分 → 总得分 → 弃权少 → id
   * 返回 0 表示无法分出先后（真并列）
   */
  function compare(x, y) {
    if (y.points !== x.points) return y.points - x.points;

    const hx = x.h2h.get(y.id);
    const hy = y.h2h.get(x.id);
    if (hx && hy && hx.played > 0) {
      if (hy.points !== hx.points) return hy.points - hx.points;   // 相互战绩积分
      if (hy.diff !== hx.diff) return hy.diff - hx.diff;           // 相互净胜分
      if (hy.scored !== hx.scored) return hy.scored - hx.scored;   // 相互得分
    }

    if (y.diff !== x.diff) return y.diff - x.diff;
    if (y.scored !== x.scored) return y.scored - x.scored;
    if (x.abandonCount !== y.abandonCount) return x.abandonCount - y.abandonCount;
    // 到此仍分不出先后 → 真并列（名次相同，下一名跳号）
    // 不拿 id 兜底，否则永远判不出并列
    return 0;
  }

  const list = [...table.values()].sort(compare);

  // 名次：比较结果完全相同才算真并列（并列后下一名跳号）
  const out = [];
  let lastRank = 0;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    let rank = 1;
    let reason = '';

    if (i > 0) {
      const prev = list[i - 1];
      const tie = compare(prev, t) === 0;
      rank = tie ? lastRank : i + 1;

      // 积分相同却分出了先后 → 写明依据，方便现场核对
      if (!tie && prev.points === t.points) {
        const hp = prev.h2h.get(t.id);
        const ht = t.h2h.get(prev.id);
        if (hp && ht && hp.played > 0 && hp.points !== ht.points) {
          reason = `相互战绩 ${ht.points}:${hp.points}`;
        } else if (hp && ht && hp.played > 0 && hp.diff !== ht.diff) {
          reason = `相互净胜分 ${ht.diff}:${hp.diff}`;
        } else if (hp && ht && hp.played > 0 && hp.scored !== ht.scored) {
          reason = `相互得分 ${ht.scored}:${hp.scored}`;
        } else if (t.diff !== prev.diff) {
          reason = `净胜分 ${t.diff}（前一位 ${prev.diff}）`;
        } else {
          reason = `总得分 ${t.scored}（前一位 ${prev.scored}）`;
        }
      }
    }

    lastRank = rank;
    out.push({ ...t, h2h: undefined, rank, rankReason: reason });
  }
  return out;
}

// ============================================================
// 三、淘汰赛首尾配对（据秩序册范本修正）
// ============================================================

/**
 * 范本真实做法：小学男子组 A1 vs H1, D1 vs E1, B1 vs G1, C1 vs F1
 *
 * 规律：
 *   1. 字母序列首尾配对（A-H、B-G、C-F、D-E）
 *   2. 上下半区各出一对，避免同半区强队提前碰撞
 *
 * @param {string[]} groupLetters ['A','B','C','D','E','F','G','H']
 * @param {number} advanceCount 进淘汰赛的队数
 * @returns {Array<[string, string]>}
 */
function buildKnockoutPairing(groupLetters, advanceCount) {
  const n = groupLetters.length;
  if (n <= 2) return [[groupLetters[0], groupLetters[1]]];

  const half = Math.ceil(n / 2);
  const upper = groupLetters.slice(0, half);   // 上半区 A B C D
  const lower = groupLetters.slice(half);      // 下半区 E F G H

  // 每半区取一半名额
  const perHalf = Math.max(1, Math.floor(advanceCount / 2));
  const uppers = upper.slice(0, perHalf);
  const lowers = lower.slice(0, perHalf);

  const pairs = [];
  for (let i = 0; i < Math.min(uppers.length, lowers.length); i++) {
    // 上下半区首尾相对：上半区第一个对下半区最后一个
    pairs.push([uppers[i], lowers[lowers.length - 1 - i]]);
  }
  return pairs;
}


// ============================================================
// 测试
// ============================================================

function runTests() {
  console.log('===== Berger 轮转 =====');
  for (const n of [3, 4, 5, 6, 8]) {
    const teams = Array.from({ length: n }, (_, i) => i + 1);
    const rounds = bergerRotation(teams);
    const v = verifyRotation(teams, rounds);
    console.log(`${n} 队 → ${rounds.length} 轮，每轮 ${rounds[0]?.length ?? 0} 场  ${v.ok ? '✓' : '✗ ' + v.msg}`);
    if (n <= 4) rounds.forEach((p, i) => console.log(`   第${i + 1}轮:`, JSON.stringify(p)));
  }

  console.log('\n===== 积分榜（含弃权）=====');
  const matches = [
    { team_a_id: 1, team_b_id: 2, score_a: 80, score_b: 60, status: 1, abandon_a: 0, abandon_b: 0 },
    { team_a_id: 1, team_b_id: 3, score_a: 0,  score_b: 70, status: 1, abandon_a: 1, abandon_b: 0 },
    { team_a_id: 2, team_b_id: 3, score_a: 55, score_b: 65, status: 1, abandon_a: 0, abandon_b: 0 },
    { team_a_id: 1, team_b_id: 4, score_a: 0,  score_b: 75, status: 1, abandon_a: 0, abandon_b: 0 },
    { team_a_id: 2, team_b_id: 4, score_a: 0,  score_b: 0,  status: 1, abandon_a: 1, abandon_b: 1 },
    { team_a_id: 3, team_b_id: 4, score_a: 68, score_b: 62, status: 1, abandon_a: 0, abandon_b: 0 }
  ];
  const st = computeStanding([1, 2, 3, 4], matches);
  st.forEach((t) => {
    console.log(
      `${t.rank}. 队${t.id}  ${t.points}分  ${t.win}胜${t.draw}平${t.lose}负` +
      `  得${t.scored}失${t.conceded}  净${t.diff}` +
      `  弃权${t.abandonCount}次${t.isVoided ? ' 【已作废】' : ''}`
    );
  });

  console.log('\n===== 首尾配对 =====');
  const cases = [
    [['A', 'B'], 2],
    [['A', 'B', 'C', 'D'], 4],
    [['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], 8]
  ];
  cases.forEach(([g, adv]) => {
    console.log(`${g.length}组 →`, JSON.stringify(buildKnockoutPairing(g, adv)));
  });

}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    bergerRotation, bergerByes, verifyRotation, computeStanding,
    buildKnockoutPairing, runTests
  };
}