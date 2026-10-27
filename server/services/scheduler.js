/**
 * 赛程编排服务
 * 负责：分组生成、小组赛程生成、时间槽装箱、阶段自动推进
 */
const { query, queryOne, execute, transaction } = require('../db');
const { addMinutes, bandLabel } = require('../utils/helpers');
const {
  bergerRotation, computeStanding, buildKnockoutPairing
} = require('./schedule-algorithms');
const {
  decideRaceFormat, allocateHeats, advanceFromHeats,
  standardSeedOrder, buildByeBracket
} = require('./track-algorithms');

/**
 * 生成小组（按学段男女 + 球类 AB 组）
 * @param {number} competitionId
 * @param {number} eventItemId
 * @param {object} opts { groupCount: 0 表示按队数自动 }
 */
async function generateGroups(competitionId, eventItemId, opts = {}) {
  const event = await queryOne('SELECT * FROM event_item WHERE id = ?', [eventItemId]);
  if (!event) throw new Error('项目不存在');
  if (event.category !== 3) throw new Error('仅球类项目支持分组编排');

  // 已有分组则先清空
  await execute('DELETE FROM heat_member WHERE heat_group_id IN (SELECT id FROM heat_group WHERE competition_id=? AND event_item_id=?)', [competitionId, eventItemId]);
  await execute('DELETE FROM heat_group WHERE competition_id=? AND event_item_id=?', [competitionId, eventItemId]);

  // 找出所有通过审核的队伍
  const teams = await query(
    `SELECT te.*, s.name AS school_name FROM team_entry te
     JOIN school s ON s.id = te.school_id
     WHERE te.competition_id = ? AND te.event_item_id = ? AND te.status = 2
     ORDER BY te.id`,
    [competitionId, eventItemId]
  );

  if (teams.length === 0) throw new Error('该组别下没有已审核通过的队伍');

  // 按组别（band）分别分组
  const bands = await query(
    'SELECT * FROM group_band WHERE competition_id = ? ORDER BY stage, gender, sort_no',
    [competitionId]
  );

  const results = [];

  for (const band of bands) {
    const bandTeams = teams.filter((t) => t.band_id === band.id);
    if (bandTeams.length === 0) continue;

    // 组数：配置优先，否则按队数（>=8队分4组，>=4队分2组，否则1组）
    let groupCount = event.group_count || 0;
    if (groupCount <= 0) {
      if (bandTeams.length >= 8) groupCount = 4;
      else if (bandTeams.length >= 4) groupCount = 2;
      else groupCount = 1;
    }
    groupCount = Math.min(groupCount, bandTeams.length);

    // 蛇形分配（打散同校）
    const letters = 'ABCDEFGH'.split('');
    const buckets = Array.from({ length: groupCount }, () => []);
    const sorted = [...bandTeams].sort((a, b) => (a.seed_no || 9999) - (b.seed_no || 9999));

    sorted.forEach((team, i) => {
      const round = Math.floor(i / groupCount);
      const idx = i % groupCount;
      const g = round % 2 === 0 ? idx : groupCount - 1 - idx;
      buckets[g].push(team);
    });

    // 写入小组与小组成员
    for (let g = 0; g < groupCount; g++) {
      const letter = letters[g];
      const members = buckets[g];
      const rounds = members.length > 1 ? members.length - 1 : 0;

      const res = await execute(
        `INSERT INTO heat_group (competition_id, band_id, event_item_id, group_letter, rounds, sort_no)
         VALUES (?,?,?,?,?,?)`,
        [competitionId, band.id, eventItemId, letter, rounds, g]
      );
      const groupId = res.insertId;

      for (let m = 0; m < members.length; m++) {
        await execute(
          'INSERT INTO heat_member (heat_group_id, team_entry_id, seed_no) VALUES (?,?,?)',
          [groupId, members[m].id, m + 1]
        );
      }

      results.push({
        band_id: band.id,
        band_label: bandLabel(band),
        group_letter: letter,
        team_count: members.length,
        rounds,
        teams: members.map((t) => t.team_name)
      });
    }
  }

  return results;
}

/**
 * 生成小组循环赛程（Berger 轮转）
 */
async function generateGroupMatches(competitionId, eventItemId) {
  const event = await queryOne('SELECT * FROM event_item WHERE id = ?', [eventItemId]);
  const groups = await query(
    'SELECT * FROM heat_group WHERE competition_id=? AND event_item_id=? ORDER BY band_id, sort_no',
    [competitionId, eventItemId]
  );

  // 清空旧的小组赛场次
  await execute(
    `DELETE FROM match_info WHERE competition_id=? AND event_item_id=? AND stage=1`,
    [competitionId, eventItemId]
  );

  let seqNo = await nextSeqNo(competitionId);
  const created = [];

  for (const group of groups) {
    const members = await query(
      'SELECT hm.*, te.team_name FROM heat_member hm JOIN team_entry te ON te.id = hm.team_entry_id WHERE hm.heat_group_id = ? ORDER BY hm.seed_no',
      [group.id]
    );
    if (members.length < 2) continue;

    const teamIds = members.map((m) => m.team_entry_id);
    const rounds = event.rounds_per_group > 0 ? event.rounds_per_group : teamIds.length - 1;
    const rotation = bergerRotation(teamIds).slice(0, rounds);

    // 主客场双循环：第二循环复制第一循环并主客对调，轮次接续
    // 例：6 队单循环 1~5 轮，双循环 6~10 轮，第 1 轮与第 6 轮互为镜像
    const homeAway = Number(event.home_away) === 1;

    const insertRound = async (pairs, roundNo) => {
      for (const [a, b] of pairs) {
        const res = await execute(
          `INSERT INTO match_info (competition_id, band_id, event_item_id, stage, round_no, heat_group_id, seq_no, team_a_id, team_b_id)
           VALUES (?,?,?,1,?,?,?,?,?)`,
          [competitionId, group.band_id, eventItemId, roundNo, group.id, seqNo++, a, b]
        );
        created.push(res.insertId);
      }
    };

    for (let r = 0; r < rotation.length; r++) {
      await insertRound(rotation[r], r + 1);
    }

    if (homeAway) {
      const offset = rotation.length;
      for (let r = 0; r < rotation.length; r++) {
        // 主客对调：A vs B → B vs A
        const mirrored = rotation[r].map(([a, b]) => [b, a]);
        await insertRound(mirrored, offset + r + 1);
      }
    }
  }

  return {
    count: created.length,
    seqFrom: seqNo - created.length,
    seqTo: seqNo - 1,
    home_away: Number(event.home_away) === 1 ? 1 : 0
  };
}

/**
 * 循环赛规模预估（不落库，生成前给管理员看）
 * @returns {{teamCount, rounds, matches, roundsDouble, matchesDouble, byePerRound}}
 *   n 队：单循环 n-1 轮（奇数 n 轮）、n(n-1)/2 场；双循环翻倍
 */
function estimateRoundRobin(teamCount) {
  const n = Number(teamCount) || 0;
  if (n < 2) {
    return { teamCount: n, rounds: 0, matches: 0, roundsDouble: 0, matchesDouble: 0, byePerRound: 0 };
  }
  const odd = n % 2 === 1;
  const rounds = odd ? n : n - 1;              // 奇数队每轮有一队轮空，轮数 = 队数
  const matches = (n * (n - 1)) / 2;
  return {
    teamCount: n,
    rounds,
    matches,
    roundsDouble: rounds * 2,
    matchesDouble: matches * 2,
    byePerRound: odd ? 1 : 0                   // 奇数队每轮恰好 1 队轮空
  };
}

/**
 * 取下一个全局场序
 */
async function nextSeqNo(competitionId) {
  const row = await queryOne(
    'SELECT MAX(seq_no) AS maxSeq FROM match_info WHERE competition_id = ?',
    [competitionId]
  );
  return (row?.maxSeq || 0) + 1;
}

/**
 * 生成时间槽（按学段算间隔，场地 × 槽位）
 */
async function generateSlots(competitionId, playDates, cfg) {
  const venues = await query(
    'SELECT * FROM venue WHERE competition_id=? ORDER BY venue_no',
    [competitionId]
  );
  if (venues.length === 0) throw new Error('尚未配置场地');

  const interval = cfg.slotInterval || 45;
  const amStart = cfg.amStart || '08:30';
  const pmStart = cfg.pmStart || '13:30';
  const slotCount = cfg.slotCount || 10;   // 上午 5 + 下午 5

  // 清空旧槽位
  await execute('DELETE FROM schedule_slot WHERE competition_id = ?', [competitionId]);

  const half = Math.ceil(slotCount / 2);
  let slotId = null;
  const slotMap = [];

  for (const date of playDates) {
    for (const venue of venues) {
      for (let i = 1; i <= slotCount; i++) {
        const isPm = i > half;
        const idxInHalf = isPm ? i - half : i - 1;
        const start = addMinutes(isPm ? pmStart : amStart, idxInHalf * interval);
        const end = addMinutes(start, interval - 10);
        const res = await execute(
          `INSERT INTO schedule_slot (competition_id, play_date, venue_id, slot_index, start_time, end_time, slot_type)
           VALUES (?,?,?,?,?,?,1)`,
          [competitionId, date, venue.id, i, start, end]
        );
        slotMap.push({
          id: res.insertId,
          date, venue_id: venue.id, venue_no: venue.venue_no,
          slot_index: i, half: isPm ? 'PM' : 'AM',
          start_time: start, end_time: end
        });
      }
    }
  }

  return slotMap;
}

/**
 * 装箱：把未排期的场次塞进时间槽
 * 规则：同组两轮尽量同一天（一天双赛），上午/下午交替
 */
async function packSchedule(competitionId, slotMap, opts = {}) {
  const matches = await query(
    `SELECT m.*, te.team_name AS team_a_name, te2.team_name AS team_b_name
     FROM match_info m
     LEFT JOIN team_entry te ON te.id = m.team_a_id
     LEFT JOIN team_entry te2 ON te2.id = m.team_b_id
     WHERE m.competition_id = ? AND m.slot_id IS NULL AND m.stage = 1
     ORDER BY m.band_id, m.heat_group_id, m.round_no`,
    [competitionId]
  );

  if (matches.length === 0) return { placed: 0, unplaced: 0 };

  // 记录已占用（初始为空，只记录本次排入的槽位）
  const used = new Set();
  const occupiedHalf = new Set();
  // 非比赛占位（开幕式等）先锁位
  const blocks = await query(
    `SELECT ss.*, v.venue_no FROM schedule_slot ss
     JOIN venue v ON v.id = ss.venue_id
     WHERE ss.competition_id = ? AND ss.slot_type = 2`,
    [competitionId]
  );
  // 整日占位：把该场地当天的所有槽位都锁掉
  blocks.forEach((b) => {
    if (b.occupation && b.end_time && b.start_time) {
      const isFullDay = b.start_time.slice(0, 5) <= '08:30' && b.end_time.slice(0, 5) >= '17:30';
      if (isFullDay) {
        slotMap
          .filter((s) => s.date === b.play_date && s.venue_id === b.venue_id)
          .forEach((s) => used.add(`${s.date}|${s.venue_id}|${s.slot_index}`));
      }
    }
  });

  // 按小组归拢
  const byGroup = new Map();
  matches.forEach((m) => {
    const key = m.heat_group_id || `single-${m.band_id}`;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(m);
  });

  let placed = 0;
  let unplaced = 0;
  let venueCursor = 0;
  const updates = [];

  for (const [, groupMatches] of byGroup) {
    groupMatches.sort((a, b) => a.round_no - b.round_no);

    groupMatches.forEach((m, idx) => {
      // 一天双赛：偶数轮上午，奇数轮下午
      const preferHalf = idx % 2 === 0 ? 'AM' : 'PM';
      const candidate = findSlot(slotMap, used, occupiedHalf, preferHalf, venueCursor);

      if (candidate) {
        used.add(`${candidate.date}|${candidate.venue_id}|${candidate.slot_index}`);
        // 注意：不再占用整个半区。同一半区有多个时间槽，可连续排多场。
        // occupiedHalf 只用于标记非比赛占位（如全天体测）
        updates.push(
          execute('UPDATE match_info SET slot_id = ? WHERE id = ?', [candidate.id, m.id])
        );
        placed++;
      } else {
        unplaced++;
      }
    });
  }

  // 等待所有落位写入完成，避免调用方读到未提交的数据
  await Promise.all(updates);

  return { placed, unplaced };
}

/**
 * 找一个可用槽位
 */
function findSlot(slotMap, used, occupiedHalf, preferHalf, venueCursor) {
  // 先找优先半区
  for (const half of [preferHalf, preferHalf === 'AM' ? 'PM' : 'AM']) {
    const candidates = slotMap.filter(
      (s) => s.half === half &&
             !used.has(`${s.date}|${s.venue_id}|${s.slot_index}`) &&
             !occupiedHalf.has(`${s.date}|${s.venue_id}|${s.half}`)
    );
    if (candidates.length > 0) {
      // 场地轮转，避免同组连着同一场地
      return candidates[venueCursor % candidates.length];
    }
  }
  return null;
}

/**
 * 阶段自动推进：小组赛打满 → 生成淘汰赛
 */
async function tryAdvanceStage(competitionId, bandId, eventItemId) {
  const event = await queryOne('SELECT * FROM event_item WHERE id = ?', [eventItemId]);

  // 当前阶段
  const stages = await query(
    `SELECT stage, COUNT(*) AS cnt, SUM(status = 1) AS done_cnt
     FROM match_info WHERE competition_id=? AND band_id=? AND event_item_id=?
     GROUP BY stage ORDER BY stage`,
    [competitionId, bandId, eventItemId]
  );

  if (stages.length === 0) return { advanced: false, reason: '无场次' };

  const current = stages[stages.length - 1];
  if (current.done_cnt < current.cnt) {
    return { advanced: false, reason: `当前阶段还有 ${current.cnt - current.done_cnt} 场未完成` };
  }

  const currentStage = current.stage;

  // 小组赛 → 淘汰赛
  if (currentStage === 1) {
    const groups = await query(
      'SELECT * FROM heat_group WHERE competition_id=? AND band_id=? AND event_item_id=? ORDER BY sort_no',
      [competitionId, bandId, eventItemId]
    );
    if (groups.length === 0) return { advanced: false, reason: '无小组' };

    // 各组排名
    const groupLetters = [];
    const standingsByGroup = {};
    for (const g of groups) {
      const memberIds = (await query(
        'SELECT team_entry_id FROM heat_member WHERE heat_group_id = ?',
        [g.id]
      )).map((m) => m.team_entry_id);

      const groupMatches = await query(
        'SELECT * FROM match_info WHERE heat_group_id = ? AND status = 1',
        [g.id]
      );
      const standing = computeStanding(memberIds, groupMatches);
      groupLetters.push(g.group_letter);
      standingsByGroup[g.group_letter] = { rank1: standing[0], all: standing };
    }

    // 配对
    const advanceCount = event.advance_count || 4;
    // 每组出线人数：出线总人数 ÷ 组数（向上取整，最少 1）
    const perGroup = Math.max(1, Math.ceil(advanceCount / groupLetters.length));

    // 收集晋级队：每组前 perGroup 名
    const qualified = [];
    for (const letter of groupLetters) {
      const st = standingsByGroup[letter];
      for (let i = 0; i < perGroup && st.all[i]; i++) {
        qualified.push({ letter, rank: i + 1, team: st.all[i] });
      }
    }
    // 出线人数不能超过实际队数
    const finalQualified = qualified.slice(0, Math.max(2, advanceCount));

    let pairs;
    if (event.pairing_rule === 2) {
      // 交叉配对：同组不同名次交叉
      pairs = [];
      const half = Math.ceil(finalQualified.length / 2);
      for (let i = 0; i < Math.floor(finalQualified.length / 2); i++) {
        pairs.push([finalQualified[i], finalQualified[half + i]]);
      }
    } else if (event.pairing_rule === 3) {
      // 对位：A1 vs B1, A2 vs B2
      pairs = [];
      const half = Math.ceil(finalQualified.length / 2);
      for (let i = 0; i < half; i++) {
        if (finalQualified[half + i]) {
          pairs.push([finalQualified[i], finalQualified[half + i]]);
        }
      }
    } else {
      // 首尾配对（范本做法）：A1-H1, B1-G1, C1-F1, D1-E1
      // 按名次分层，每层内首尾相对
      const byRank = new Map();
      finalQualified.forEach((q) => {
        if (!byRank.has(q.rank)) byRank.set(q.rank, []);
        byRank.get(q.rank).push(q);
      });
      pairs = [];
      for (const [, layer] of byRank) {
        for (let i = 0; i < Math.floor(layer.length / 2); i++) {
          pairs.push([layer[i], layer[layer.length - 1 - i]]);
        }
        // 奇数个时中间那个轮空（不生成）
      }
    }

    // 8 组及以上走"八进四"，4 组走"半决赛"
    const nextStage = groups.length >= 8 ? 2 : (groups.length >= 4 ? 3 : 4);
    let seqNo = await nextSeqNo(competitionId);
    const created = [];

    for (const [qa, qb] of pairs) {
      const teamA = qa?.team?.id || null;
      const teamB = qb?.team?.id || null;
      if (!teamA || !teamB) continue;

      const refA = `${qa.letter}组第${qa.rank}`;
      const refB = `${qb.letter}组第${qb.rank}`;

      const res = await execute(
        `INSERT INTO match_info (competition_id, band_id, event_item_id, stage, seq_no, team_a_id, team_b_id, ref_a, ref_b)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [competitionId, bandId, eventItemId, nextStage, seqNo++, teamA, teamB, refA, refB]
      );
      created.push(res.insertId);
    }

    return { advanced: true, to: nextStage, count: created.length };
  }

  // 八进四/半决赛/排位赛 → 决赛
  if (currentStage === 2 || currentStage === 3 || currentStage === 4) {
    const ms = await query(
      'SELECT * FROM match_info WHERE competition_id=? AND band_id=? AND event_item_id=? AND stage=? ORDER BY seq_no',
      [competitionId, bandId, eventItemId, currentStage]
    );

    const winners = ms.map((m) => (m.score_a > m.score_b ? m.team_a_id : m.team_b_id)).filter(Boolean);
    const losers = ms.map((m) => (m.score_a > m.score_b ? m.team_b_id : m.team_a_id)).filter(Boolean);

    let seqNo = await nextSeqNo(competitionId);
    const created = [];

    if (winners.length === 2) {
      // 决赛 + 三四名
      await execute(
        `INSERT INTO match_info (competition_id, band_id, event_item_id, stage, seq_no, team_a_id, team_b_id)
         VALUES (?,?,?,5,?,?,?)`,
        [competitionId, bandId, eventItemId, seqNo++, winners[0], winners[1]]
      );
      created.push('决赛');
      if (event.has_third_place && losers.length === 2) {
        await execute(
          `INSERT INTO match_info (competition_id, band_id, event_item_id, stage, seq_no, team_a_id, team_b_id)
           VALUES (?,?,?,6,?,?,?)`,
          [competitionId, bandId, eventItemId, seqNo++, losers[0], losers[1]]
        );
        created.push('三四名');
      }
    } else if (winners.length === 4) {
      // 生成两场半决赛
      await execute(
        `INSERT INTO match_info (competition_id, band_id, event_item_id, stage, seq_no, team_a_id, team_b_id)
         VALUES (?,?,?,3,?,?,?)`,
        [competitionId, bandId, eventItemId, seqNo++, winners[0], winners[1]]
      );
      await execute(
        `INSERT INTO match_info (competition_id, band_id, event_item_id, stage, seq_no, team_a_id, team_b_id)
         VALUES (?,?,?,3,?,?,?)`,
        [competitionId, bandId, eventItemId, seqNo++, winners[2], winners[3]]
      );
      created.push('半决赛');
    }

    return { advanced: true, count: created.length };
  }

  // 决赛结束 → 写名次
  // 条件：决赛已存在且已录分（不管当前处于哪个阶段，如三四名结束后再来写）
  const finalMatch = await queryOne(
    `SELECT * FROM match_info WHERE competition_id=? AND band_id=? AND event_item_id=? AND stage=5 AND status=1`,
    [competitionId, bandId, eventItemId]
  );
  if (finalMatch && finalMatch.score_a !== null) {
    const winner = finalMatch.score_a > finalMatch.score_b ? finalMatch.team_a_id : finalMatch.team_b_id;
    const loser = finalMatch.score_a > finalMatch.score_b ? finalMatch.team_b_id : finalMatch.team_a_id;

    // 三四名场次（若有）确定第 3、4 名
    const thirdMatch = await queryOne(
      `SELECT * FROM match_info WHERE competition_id=? AND band_id=? AND event_item_id=? AND stage=6 AND status=1`,
      [competitionId, bandId, eventItemId]
    );

    await execute(
      'DELETE FROM final_rank WHERE competition_id=? AND band_id=? AND event_item_id=?',
      [competitionId, bandId, eventItemId]
    );
    await execute(
      'INSERT INTO final_rank (competition_id, band_id, event_item_id, rank_no, team_entry_id, source_stage) VALUES (?,?,?,1,?,4)',
      [competitionId, bandId, eventItemId, winner]
    );
    if (loser) {
      await execute(
        'INSERT INTO final_rank (competition_id, band_id, event_item_id, rank_no, team_entry_id, source_stage) VALUES (?,?,?,2,?,4)',
        [competitionId, bandId, eventItemId, loser]
      );
    }
    if (thirdMatch && thirdMatch.score_a !== null) {
      const third = thirdMatch.score_a > thirdMatch.score_b ? thirdMatch.team_a_id : thirdMatch.team_b_id;
      const fourth = thirdMatch.score_a > thirdMatch.score_b ? thirdMatch.team_b_id : thirdMatch.team_a_id;
      await execute(
        'INSERT INTO final_rank (competition_id, band_id, event_item_id, rank_no, team_entry_id, source_stage) VALUES (?,?,?,3,?,4)',
        [competitionId, bandId, eventItemId, third]
      );
      if (fourth) {
        await execute(
          'INSERT INTO final_rank (competition_id, band_id, event_item_id, rank_no, team_entry_id, source_stage) VALUES (?,?,?,4,?,4)',
          [competitionId, bandId, eventItemId, fourth]
        );
      }
    }
    return { advanced: true, finished: true };
  }

  return { advanced: false, reason: '当前阶段无需推进' };
}

/**
 * 径赛编排：生成预赛/复赛/决赛分组与道次
 */
async function generateTrackHeats(competitionId, eventItemId) {
  const event = await queryOne('SELECT * FROM event_item WHERE id = ?', [eventItemId]);

  // 取报名该项目的运动员
  const entries = await query(
    `SELECT ae.*, a.name, a.school_id, a.bib_no, s.name AS school_name
     FROM athlete_entry ae
     JOIN athlete a ON a.id = ae.athlete_id
     JOIN school s ON s.id = a.school_id
     WHERE ae.competition_id = ? AND ae.event_item_id = ? AND ae.status = 2`,
    [competitionId, eventItemId]
  );

  if (entries.length === 0) throw new Error('该组别下没有已审核的运动员');

  const format = decideRaceFormat(event.name, entries.length, event.lane_count || 8);

  // 按组别分配
  const byBand = new Map();
  entries.forEach((e) => {
    if (!byBand.has(e.band_id)) byBand.set(e.band_id, []);
    byBand.get(e.band_id).push(e);
  });

  const results = [];

  for (const [bandId, list] of byBand) {
    const bandFormat = decideRaceFormat(event.name, list.length, event.lane_count || 8);
    const groups = allocateHeats(list, event.lane_count || 8, 'bib');

    // 写入 heat_group（用 M 标识径赛组，用 L 标识道次）
    for (const g of groups) {
      const res = await execute(
        `INSERT INTO heat_group (competition_id, band_id, event_item_id, group_letter, rounds, sort_no)
         VALUES (?,?,?,?,?,?)`,
        [competitionId, bandId, eventItemId, `G${g.groupNo}`, 0, g.groupNo]
      );
      const groupId = res.insertId;

      for (const e of g.entries) {
        await execute(
          'INSERT INTO heat_member (heat_group_id, team_entry_id, seed_no) VALUES (?,?,?)',
          [groupId, e.athlete_id, e.lane]
        );
      }
    }

    results.push({
      band_id: bandId,
      format: bandFormat.format,
      heats: groups.length,
      groups: groups.map((g) => ({
        group_no: g.groupNo,
        lanes: g.occupiedLanes,
        athletes: g.entries.map((e) => ({ name: e.name, lane: e.lane, bib: e.bib_no, school: e.school_name }))
      }))
    });
  }

  return { format, results };
}

module.exports = {
  generateGroups,
  generateGroupMatches,
  generateSlots,
  packSchedule,
  tryAdvanceStage,
  generateTrackHeats,
  nextSeqNo,
  estimateRoundRobin
};
