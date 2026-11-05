/**
 * 纯淘汰赛（KO）编排
 *
 * 适用：乒乓球、羽毛球单打 / 双打 / 混双，以及任何「不分组、直接单败淘汰」的项目。
 *
 * 与「分组循环 + 淘汰」（GROUP_KO）的区别：
 *   - 不走 heat_group，报名审核通过后直接生成对阵树
 *   - 轮次不固定，用 match_info.round_no 表示（1,2,3…），stage 统一为 2
 *   - 轮空自动处理，轮空者直接落位到下一轮
 *
 * 轮空规则（国际通用做法，与用户那张乒乓球对阵图完全一致）：
 *   size = 2^ceil(log2(n))     目标位次
 *   byes = size - n            轮空数
 *   按标准种子位表把 1..n 号种子放进 size 个位置，空位即轮空，
 *   与空位相邻的选手直接晋级。
 *     18 人 → size=32、byes=14 → 首轮只剩 2 场（等于「先打预赛凑 16 强」）
 *     14 人 → size=16、byes=2  → 首轮 6 场 + 2 人轮空
 *     8  人 → size=8、 byes=0  → 直接八进四
 */
const { query, queryOne, execute, transaction } = require('../db');

/** 标准种子位表：seedSlots(8) = [1,8,4,5,3,6,2,7] */
function seedSlots(size) {
  let arr = [1, 2];
  while (arr.length < size) {
    const sum = arr.length * 2 + 1;
    const next = [];
    for (const x of arr) {
      next.push(x);
      next.push(sum - x);
    }
    arr = next;
  }
  return arr.slice(0, size);
}

/** 由参赛人数推算赛制结构 */
function planKo(n) {
  const count = Math.max(2, Number(n) || 0);
  const size = 2 ** Math.ceil(Math.log2(count));
  return {
    size,
    byes: size - count,
    rounds: Math.round(Math.log2(size)),
    firstRoundMatches: size / 2 - (size - count)
  };
}

async function nextSeqNo(competitionId) {
  const row = await queryOne(
    'SELECT MAX(seq_no) AS maxSeq FROM match_info WHERE competition_id = ?',
    [competitionId]
  );
  return (row?.maxSeq || 0) + 1;
}

function winnerId(m) {
  if (!m || m.status !== 1 || m.score_a == null || m.score_b == null) return null;
  if (Number(m.score_a) === Number(m.score_b)) return null; // 淘汰赛不允许平局
  return Number(m.score_a) > Number(m.score_b) ? m.team_a_id : m.team_b_id;
}

function loserId(m) {
  if (!m || m.status !== 1 || m.score_a == null || m.score_b == null) return null;
  if (Number(m.score_a) === Number(m.score_b)) return null;
  return Number(m.score_a) > Number(m.score_b) ? m.team_b_id : m.team_a_id;
}

/**
 * 生成淘汰赛对阵树
 * @param {number} competitionId
 * @param {number} eventItemId
 * @param {object} opts  { band_id?: 只生成某个组别 }
 */
async function generateKo(competitionId, eventItemId, opts = {}) {
  const event = await queryOne('SELECT * FROM event_item WHERE id = ?', [eventItemId]);
  if (!event) throw new Error('项目不存在');

  let bandIds;
  if (opts.band_id) {
    bandIds = [Number(opts.band_id)];
  } else {
    const rows = await query(
      `SELECT DISTINCT band_id FROM team_entry
        WHERE competition_id = ? AND event_item_id = ? AND status = 2`,
      [competitionId, eventItemId]
    );
    bandIds = rows.map((r) => r.band_id);
  }
  if (!bandIds.length) throw new Error('还没有审核通过的参赛单位，无法生成对阵');

  const summary = [];

  for (const bandId of bandIds) {
    const teams = await query(
      `SELECT id, team_name, seed_no FROM team_entry
        WHERE competition_id = ? AND event_item_id = ? AND band_id = ? AND status = 2
        ORDER BY CASE WHEN seed_no > 0 THEN seed_no ELSE 9999 END, id`,
      [competitionId, eventItemId, bandId]
    );
    if (teams.length < 2) {
      summary.push({ band_id: bandId, created: 0, note: '参赛单位不足 2 个，已跳过' });
      continue;
    }

    // 清掉该组别旧的淘汰赛与名次
    await execute(
      'DELETE FROM match_info WHERE competition_id=? AND event_item_id=? AND band_id=? AND stage IN (2,6)',
      [competitionId, eventItemId, bandId]
    );
    await execute(
      'DELETE FROM final_rank WHERE competition_id=? AND event_item_id=? AND band_id=?',
      [competitionId, eventItemId, bandId]
    );

    const n = teams.length;
    const { size, byes, rounds } = planKo(n);
    const atPos = seedSlots(size).map((seed) => (seed <= n ? teams[seed - 1] : null));

    let seqNo = await nextSeqNo(competitionId);
    let created = 0;

    // 删旧树 + 建新树必须原子完成（原来分开执行，中途失败会留下半截对阵树）
    await transaction(async (tx) => {
      await tx.execute(
        'DELETE FROM match_info WHERE competition_id=? AND event_item_id=? AND band_id=? AND stage IN (2,6)',
        [competitionId, eventItemId, bandId]
      );
      await tx.execute(
        'DELETE FROM final_rank WHERE competition_id=? AND event_item_id=? AND band_id=?',
        [competitionId, eventItemId, bandId]
      );

      // ---------- 第 1 轮 ----------
      const carry = []; // 长度 size/2：轮空者直接带入下一轮，其余为 null
      for (let j = 0; j < size / 2; j++) {
        const a = atPos[2 * j];
        const b = atPos[2 * j + 1];
        if (a && b) {
          await tx.execute(
            `INSERT INTO match_info
               (competition_id, band_id, event_item_id, stage, round_no, seq_no, team_a_id, team_b_id)
             VALUES (?,?,?,2,1,?,?,?)`,
            [competitionId, bandId, eventItemId, seqNo++, a.id, b.id]
          );
          created++;
          carry.push(null);
        } else {
          carry.push(a || b || null);
        }
      }

      // ---------- 第 2 ~ rounds 轮：全部预生成（空位待晋级填充） ----------
      let prev = carry;
      for (let r = 2; r <= rounds; r++) {
        const count = size / 2 ** r;
        const cur = new Array(count).fill(null);
        for (let k = 0; k < count; k++) {
          const teamA = prev[2 * k] ? prev[2 * k].id : null;
          const teamB = prev[2 * k + 1] ? prev[2 * k + 1].id : null;
          await tx.execute(
            `INSERT INTO match_info
               (competition_id, band_id, event_item_id, stage, round_no, seq_no, team_a_id, team_b_id)
             VALUES (?,?,?,2,?,?,?,?)`,
            [competitionId, bandId, eventItemId, r, seqNo++, teamA, teamB]
          );
          created++;
        }
        prev = cur;
      }
    });

    summary.push({
      band_id: bandId,
      created,
      teams: n,
      size,
      byes,
      rounds,
      firstRoundMatches: size / 2 - byes
    });
  }

  return {
    total: summary.reduce((s, x) => s + (x.created || 0), 0),
    bands: summary
  };
}

/** 决赛名次落库 */
async function writeKoRank(competitionId, bandId, eventItemId, finalMatch) {
  const w = winnerId(finalMatch);
  const l = loserId(finalMatch);
  if (!w) return { advanced: false, reason: '决赛尚未录分' };

  const third = await queryOne(
    `SELECT * FROM match_info
      WHERE competition_id=? AND band_id=? AND event_item_id=? AND stage=6 AND status=1`,
    [competitionId, bandId, eventItemId]
  );

  await execute(
    'DELETE FROM final_rank WHERE competition_id=? AND band_id=? AND event_item_id=?',
    [competitionId, bandId, eventItemId]
  );
  await execute(
    'INSERT INTO final_rank (competition_id, band_id, event_item_id, rank_no, team_entry_id, source_stage) VALUES (?,?,?,1,?,2)',
    [competitionId, bandId, eventItemId, w]
  );
  if (l) {
    await execute(
      'INSERT INTO final_rank (competition_id, band_id, event_item_id, rank_no, team_entry_id, source_stage) VALUES (?,?,?,2,?,2)',
      [competitionId, bandId, eventItemId, l]
    );
  }
  if (third) {
    const t3 = winnerId(third);
    const t4 = loserId(third);
    if (t3) {
      await execute(
        'INSERT INTO final_rank (competition_id, band_id, event_item_id, rank_no, team_entry_id, source_stage) VALUES (?,?,?,3,?,2)',
        [competitionId, bandId, eventItemId, t3]
      );
    }
    if (t4) {
      await execute(
        'INSERT INTO final_rank (competition_id, band_id, event_item_id, rank_no, team_entry_id, source_stage) VALUES (?,?,?,4,?,2)',
        [competitionId, bandId, eventItemId, t4]
      );
    }
  }
  return { advanced: true, finished: true };
}

/**
 * 淘汰赛推进：本轮全部录分后，把胜者填入下一轮
 * 录分接口（/result/score）在保存后自动调用，无需人工触发
 */
async function advanceKo(competitionId, bandId, eventItemId) {
  const event = await queryOne('SELECT * FROM event_item WHERE id = ?', [eventItemId]);

  const all = await query(
    `SELECT * FROM match_info
      WHERE competition_id=? AND band_id=? AND event_item_id=? AND stage IN (2,6)
      ORDER BY round_no, seq_no`,
    [competitionId, bandId, eventItemId]
  );
  if (!all.length) return { advanced: false, reason: '尚未生成对阵' };

  const ko = all.filter((m) => m.stage === 2);
  const rounds = [...new Set(ko.map((m) => m.round_no))].sort((a, b) => a - b);
  const lastRound = rounds[rounds.length - 1];

  // 半决赛打完 → 生成三四名（只生成一次）
  if (event?.has_third_place) {
    const semiRound = lastRound - 1;
    const semis = ko.filter((m) => m.round_no === semiRound).sort((a, b) => a.seq_no - b.seq_no);
    if (semis.length === 2 && semis.every((m) => m.status === 1)) {
      const exists = all.find((m) => m.stage === 6);
      if (!exists) {
        const l1 = loserId(semis[0]);
        const l2 = loserId(semis[1]);
        if (l1 && l2) {
          const seqNo = await nextSeqNo(competitionId);
          const res = await execute(
            `INSERT INTO match_info
               (competition_id, band_id, event_item_id, stage, round_no, seq_no, team_a_id, team_b_id)
             VALUES (?,?,?,6,?,?,?,?)`,
            [competitionId, bandId, eventItemId, lastRound, seqNo, l1, l2]
          );
          all.push({ id: res.insertId, stage: 6, round_no: lastRound, team_a_id: l1, team_b_id: l2, status: 0 });
        }
      }
    }
  }

  // 逐轮把胜者往下填。全过程幂等：已在位的不会再动，
  // 因此每次录分调用都可以从头走一遍，能连续推进多轮。
  let filled = 0;
  const bySeq = (a, b) => a.seq_no - b.seq_no;

  for (let i = 0; i < rounds.length - 1; i++) {
    const list = ko.filter((m) => m.round_no === rounds[i]).sort(bySeq);
    if (!list.length || list.some((m) => m.status !== 1)) break;

    // 注意：第 1 轮有轮空时，真实比赛只占其中几个位次，不能用「第 i 场 → 第 i/2 场」
    // 的固定配对。改为按「下一轮空位顺序」逐个落位——
    // 无轮空时等价于 i/2 配对，有轮空时正好填进预留的缺口。
    const nextList = ko.filter((m) => m.round_no === rounds[i + 1]).sort(bySeq);
    const targets = [];
    for (const m of nextList) {
      if (!m.team_a_id) targets.push({ m, side: 'team_a_id' });
      if (!m.team_b_id) targets.push({ m, side: 'team_b_id' });
    }
    const winners = list.map((m) => winnerId(m)).filter(Boolean);

    for (let k = 0; k < Math.min(winners.length, targets.length); k++) {
      const { m, side } = targets[k];
      await execute(`UPDATE match_info SET ${side} = ? WHERE id = ?`, [winners[k], m.id]);
      m[side] = winners[k];   // 同步本地副本，供下一轮判断
      filled++;
    }
  }

  // 决赛打完 → 写名次
  const finalList = ko.filter((m) => m.round_no === lastRound);
  if (finalList.length && finalList.every((m) => m.status === 1)) {
    return writeKoRank(competitionId, bandId, eventItemId, finalList[0]);
  }

  if (filled) return { advanced: true, count: filled };
  return { advanced: false, reason: '暂无可推进的场次' };
}

/** 预览：不落库，给前端显示「n 人 → 几轮、几场、几个轮空」 */
function previewKo(n) {
  const p = planKo(n);
  return {
    teams: Number(n) || 0,
    ...p,
    totalMatches: Math.max(0, (Number(n) || 0) - 1)
  };
}

module.exports = {
  seedSlots,
  planKo,
  previewKo,
  generateKo,
  advanceKo
};
