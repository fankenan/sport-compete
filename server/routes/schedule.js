const express = require('express');
const { query, queryOne, execute, ok, fail } = require('../db');
const { authRequired, roleRequired } = require('../middleware/auth');
const { bandLabel, addMinutes } = require('../utils/helpers');
const scheduler = require('../services/scheduler');
const ko = require('../services/schedule-ko');
const ballTimeline = require('../services/ballTimeline');
const { bergerByes } = require('../services/schedule-algorithms');

const router = express.Router();
router.use(authRequired);

const STAGE_LABEL = {
  1: '小组赛', 2: '八进四', 3: '半决赛', 4: '排位赛', 5: '决赛', 6: '三四名'
};

/**
 * 项目赛制设置（赛制模式 / 主客场双循环 / 是否允许平局 / 积分规则）
 * GET  /api/schedule/event-config?event_item_id=1
 * POST /api/schedule/event-config  { event_item_id, schedule_mode?, home_away?, allow_draw?, win_points?, draw_points? }
 *
 * home_away=1（主客场双循环）时：手动编排不再限制「同一对队伍重复对阵」，
 * 一键生成循环赛程时第二循环镜像第一循环并主客对调
 */
router.get('/event-config', async (req, res, next) => {
  try {
    const { event_item_id } = req.query;
    if (!event_item_id) return res.json(fail('缺少项目参数'));
    const ev = await queryOne(
      `SELECT id, name, schedule_mode, participant_kind, home_away, allow_draw,
              win_points, draw_points, group_count, rounds_per_group, advance_count,
              pairing_rule, has_third_place, match_minutes, slot_interval
       FROM event_item WHERE id = ?`,
      [event_item_id]
    );
    if (!ev) return res.json(fail('项目不存在'));
    res.json(ok({
      event_item_id: ev.id,
      name: ev.name,
      schedule_mode: ev.schedule_mode || 'GROUP_KO',
      participant_kind: ev.participant_kind || 'TEAM',
      home_away: Number(ev.home_away) === 1 ? 1 : 0,
      allow_draw: Number(ev.allow_draw) === 0 ? 0 : 1,
      win_points: Number(ev.win_points) || 3,
      draw_points: Number(ev.draw_points) || 0,
      group_count: Number(ev.group_count) || 0,
      rounds_per_group: Number(ev.rounds_per_group) || 0,
      advance_count: Number(ev.advance_count) || 4,
      pairing_rule: Number(ev.pairing_rule) || 1,
      has_third_place: Number(ev.has_third_place) === 1 ? 1 : 0,
      match_minutes: Number(ev.match_minutes) || 24,
      slot_interval: Number(ev.slot_interval) || 45
    }));
  } catch (e) { next(e); }
});

router.post('/event-config', roleRequired(1), async (req, res, next) => {
  try {
    const {
      event_item_id, schedule_mode, home_away, allow_draw,
      win_points, draw_points, group_count, rounds_per_group,
      advance_count, pairing_rule, has_third_place
    } = req.body;
    if (!event_item_id) return res.json(fail('缺少项目参数'));

    const sets = [];
    const params = [];

    const put = (col, val) => { sets.push(`${col} = ?`); params.push(val); };

    if (schedule_mode !== undefined) {
      const modes = ['GROUP_KO', 'KO', 'LEAGUE', 'ROUND'];
      if (!modes.includes(schedule_mode)) return res.json(fail('赛制不合法'));
      put('schedule_mode', schedule_mode);
    }
    if (home_away !== undefined) put('home_away', Number(home_away) === 1 ? 1 : 0);
    if (allow_draw !== undefined) put('allow_draw', Number(allow_draw) === 0 ? 0 : 1);
    if (win_points !== undefined) put('win_points', Math.max(0, Number(win_points) || 0));
    if (draw_points !== undefined) put('draw_points', Math.max(0, Number(draw_points) || 0));
    if (group_count !== undefined) put('group_count', Math.max(0, Number(group_count) || 0));
    if (rounds_per_group !== undefined) put('rounds_per_group', Math.max(0, Number(rounds_per_group) || 0));
    if (advance_count !== undefined) put('advance_count', Math.max(0, Number(advance_count) || 0));
    if (pairing_rule !== undefined) put('pairing_rule', Math.max(1, Number(pairing_rule) || 1));
    if (has_third_place !== undefined) put('has_third_place', Number(has_third_place) === 1 ? 1 : 0);

    if (sets.length === 0) return res.json(fail('没有要修改的项'));

    params.push(event_item_id);
    await execute(`UPDATE event_item SET ${sets.join(', ')} WHERE id = ?`, params);
    res.json(ok(null, '赛制已保存'));
  } catch (e) { next(e); }
});

/**
 * 循环赛规模预估（生成前先看要打多少场）
 * GET /api/schedule/estimate?competition_id=1&band_id=1&event_item_id=1
 */
router.get('/estimate', async (req, res, next) => {
  try {
    const { competition_id, band_id, event_item_id } = req.query;
    if (!competition_id || !event_item_id) return res.json(fail('缺少参数'));

    // 已分组：按各组实际队数算；未分组：按该项目报名队伍数算
    const groups = await query(
      `SELECT hg.id, hg.group_letter,
              (SELECT COUNT(*) FROM heat_member hm WHERE hm.heat_group_id = hg.id) AS team_count
       FROM heat_group hg
       WHERE hg.competition_id = ? AND hg.event_item_id = ? ${band_id ? 'AND hg.band_id = ?' : ''}
       ORDER BY hg.sort_no`,
      band_id ? [competition_id, event_item_id, band_id] : [competition_id, event_item_id]
    );

    const ev = await queryOne('SELECT home_away FROM event_item WHERE id = ?', [event_item_id]);
    const homeAway = Number(ev && ev.home_away) === 1;

    if (groups.length === 0) {
      const teams = await query(
        `SELECT COUNT(*) AS c FROM team_entry
         WHERE competition_id = ? AND event_item_id = ? AND status = 2
         ${band_id ? 'AND band_id = ?' : ''}`,
        band_id ? [competition_id, event_item_id, band_id] : [competition_id, event_item_id]
      );
      const est = scheduler.estimateRoundRobin(teams[0].c);
      return res.json(ok({ grouped: false, home_away: homeAway ? 1 : 0, ...est, groups: [] }));
    }

    const perGroup = groups.map((g) => ({ group_letter: g.group_letter, ...scheduler.estimateRoundRobin(g.team_count) }));
    const total = perGroup.reduce((s, g) => s + (homeAway ? g.matchesDouble : g.matches), 0);
    res.json(ok({
      grouped: true,
      home_away: homeAway ? 1 : 0,
      teamCount: perGroup.reduce((s, g) => s + g.teamCount, 0),
      matches: total,
      groups: perGroup
    }));
  } catch (e) { next(e); }
});

/**
 * 小组赛程（按轮次，标出奇数队每轮谁轮空）
 * GET /api/schedule/rounds?competition_id=1&band_id=1&event_item_id=1
 */
router.get('/rounds', async (req, res, next) => {
  try {
    const { competition_id, band_id, event_item_id } = req.query;
    if (!competition_id || !event_item_id) return res.json(fail('缺少参数'));

    const groups = await query(
      `SELECT hg.*, gb.stage, gb.gender, gb.label AS band_label
       FROM heat_group hg JOIN group_band gb ON gb.id = hg.band_id
       WHERE hg.competition_id = ? AND hg.event_item_id = ? ${band_id ? 'AND hg.band_id = ?' : ''}
       ORDER BY hg.sort_no`,
      band_id ? [competition_id, event_item_id, band_id] : [competition_id, event_item_id]
    );

    const result = [];
    for (const g of groups) {
      const members = await query(
        `SELECT hm.team_entry_id, te.team_name, s.name AS school_name
         FROM heat_member hm
         JOIN team_entry te ON te.id = hm.team_entry_id
         JOIN school s ON s.id = te.school_id
         WHERE hm.heat_group_id = ? ORDER BY hm.seed_no`,
        [g.id]
      );
      const matches = await query(
        `SELECT m.id, m.round_no, m.seq_no, m.team_a_id, m.team_b_id, m.score_a, m.score_b, m.status,
                ss.play_date, ss.start_time, v.name AS venue_name, v.venue_no
         FROM match_info m
         LEFT JOIN schedule_slot ss ON ss.id = m.slot_id
         LEFT JOIN venue v ON v.id = ss.venue_id
         WHERE m.heat_group_id = ? ORDER BY m.round_no, m.seq_no`,
        [g.id]
      );

      const nameOf = new Map(members.map((m) => [m.team_entry_id, m.team_name || m.school_name]));

      // 按轮次归拢
      const byRound = new Map();
      for (const m of matches) {
        if (!byRound.has(m.round_no)) {
          byRound.set(m.round_no, {
            round_no: m.round_no,
            matches: [],
            bye: null
          });
        }
        byRound.get(m.round_no).matches.push({
          id: m.id,
          seq_no: m.seq_no,
          team_a: nameOf.get(m.team_a_id) || '—',
          team_b: nameOf.get(m.team_b_id) || '—',
          score_a: m.score_a,
          score_b: m.score_b,
          status: m.status,
          play_date: m.play_date,
          start_time: (m.start_time || '').slice(0, 5),
          venue: m.venue_name ? `${m.venue_name}` : ''
        });
      }

      // 奇数队：算出每轮轮空的是谁
      const teamIds = members.map((m) => m.team_entry_id);
      if (teamIds.length % 2 === 1) {
        const byes = bergerByes(teamIds);
        const roundNos = [...byRound.keys()].sort((a, b) => a - b);
        roundNos.forEach((rn, idx) => {
          const b = byes[idx];
          if (b) byRound.get(rn).bye = nameOf.get(b) || null;
        });
      }

      result.push({
        group_id: g.id,
        group_letter: g.group_letter,
        band_label: bandLabel(g),
        rounds: [...byRound.values()].sort((a, b) => a.round_no - b.round_no)
      });
    }

    res.json(ok(result));
  } catch (e) { next(e); }
});

/**
 * 设置比赛日程（可用时间窗）
 * POST /api/schedule/slots
 *
 * 【语义变更】原来叫「生成时间槽」，生成的是**等距格子**（一格一场、时长写死 35 分钟），
 * 导致 event_item.match_minutes 字段全后端零引用，且「生成时间槽」成了所有编排的前置门槛。
 * 现在生成的是「**可用时间窗**」——当天各场地在哪些时段可以排比赛，
 * 一场球可以在窗内取任意一段，时长按项目的 match_minutes 决定。
 *
 * 端点路径保持 /slots 不变（前端不用改 URL），但返回结构变了。
 */
router.post('/slots', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, playDates, slotInterval, amStart, pmStart, slotCount } = req.body;
    if (!competition_id || !Array.isArray(playDates) || playDates.length === 0) {
      return res.json(fail('请选择比赛日期'));
    }
    const windows = await ballTimeline.generateWindows(competition_id, playDates, {
      slotInterval, amStart, pmStart, slotCount
    });
    res.json(ok({ count: windows.length }, `已设置 ${windows.length} 个可用时段`));
  } catch (e) { next(e); }
});

/**
 * 自动排期
 * POST /api/schedule/pack
 *
 * 现在走新的时间轴引擎：按「场地 × 时间窗」用分钟游标连续排，
 * 每场时长按项目 match_minutes，支持小组赛与淘汰赛一起排。
 */
router.post('/pack', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, venue_id, play_date } = req.body;
    if (!competition_id) return res.json(fail('缺少赛事参数'));

    const result = await ballTimeline.autoArrange(competition_id, { venue_id, play_date });
    const msg = `已排入 ${result.placed} 场`
      + (result.unplaced ? `，${result.unplaced} 场没找到合适空档` : '')
      + (result.waiting ? `，${result.waiting} 场等上一轮赛果确定对手` : '');
    res.json(ok(result, msg));
  } catch (e) { next(e); }
});

/**
 * 冲突检测
 * GET /api/schedule/conflicts?competition_id=1
 *
 * 三类：VENUE 场地重叠 / TEAM 同一队伍同时两场 / REST 队伍休息不足
 */
router.get('/conflicts', async (req, res, next) => {
  try {
    const { competition_id } = req.query;
    if (!competition_id) return res.json(fail('缺少赛事参数'));
    const list = await ballTimeline.detectConflicts(competition_id);
    res.json(ok({
      total: list.length,
      conflicts: list
    }, list.length ? `发现 ${list.length} 处冲突` : '没有冲突'));
  } catch (e) { next(e); }
});

/**
 * 清空排期（保留时间窗）
 * POST /api/schedule/clear-schedule
 */
router.post('/clear-schedule', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, play_date, venue_id } = req.body;
    if (!competition_id) return res.json(fail('缺少赛事参数'));
    const r = await ballTimeline.clearSchedule(competition_id, { play_date, venue_id });
    res.json(ok(r, `已清空 ${r.cleared} 场的排期`));
  } catch (e) { next(e); }
});

/**
 * 待排期场次
 * GET /api/schedule/unplaced?competition_id=1&band_id=&event_item_id=
 *
 * 以前系统里没有任何地方能列出「还有哪些比赛没排期」——
 * 淘汰赛（stage>=2）因为 packSchedule 只排 stage=1，管理员在甘特图上根本看不到它们，
 * 只能凭记忆逐场手动新增。这个接口把缺口显式化。
 */
router.get('/unplaced', async (req, res, next) => {
  try {
    const { competition_id, band_id, event_item_id } = req.query;
    if (!competition_id) return res.json(fail('缺少赛事参数'));

    const where = ['m.competition_id = ?', 'm.slot_id IS NULL'];
    const params = [competition_id];
    if (band_id) { where.push('m.band_id = ?'); params.push(band_id); }
    if (event_item_id) { where.push('m.event_item_id = ?'); params.push(event_item_id); }

    const rows = await query(
      `SELECT m.id, m.seq_no, m.stage, m.round_no, m.band_id, m.event_item_id,
              m.team_a_id, m.team_b_id, m.ref_a, m.ref_b, m.status,
              ta.team_name AS team_a_name, tb.team_name AS team_b_name,
              ei.name AS event_name, gb.label AS band_label
       FROM match_info m
       LEFT JOIN team_entry ta ON ta.id = m.team_a_id
       LEFT JOIN team_entry tb ON tb.id = m.team_b_id
       JOIN event_item ei ON ei.id = m.event_item_id
       JOIN group_band gb ON gb.id = m.band_id
       WHERE ${where.join(' AND ')}
       ORDER BY m.band_id, m.event_item_id, m.stage, m.round_no, m.seq_no`,
      params
    );

    const STAGE_LABEL = {
      1: '小组赛', 2: '八进四', 3: '半决赛', 4: '排位赛', 5: '决赛', 6: '三四名'
    };

    // 按「项目 + 阶段」汇总，让管理员一眼看到缺多少
    const summary = new Map();
    for (const r of rows) {
      const key = `${r.band_id}|${r.event_item_id}|${r.stage}`;
      if (!summary.has(key)) {
        summary.set(key, {
          band_id: r.band_id,
          band_label: bandLabel(r),
          event_item_id: r.event_item_id,
          event_name: r.event_name,
          stage: r.stage,
          stage_label: STAGE_LABEL[r.stage] || `阶段${r.stage}`,
          count: 0,
          ready: 0
        });
      }
      const s = summary.get(key);
      s.count++;
      // 双方都已确定才能排期（占位场次要等上一轮赛果）
      if (r.team_a_id && r.team_b_id) s.ready++;
    }

    res.json(ok({
      total: rows.length,
      ready: rows.filter((r) => r.team_a_id && r.team_b_id).length,
      pendingResult: rows.filter((r) => !r.team_a_id || !r.team_b_id).length,
      summary: [...summary.values()],
      matches: rows.map((r) => ({
        id: r.id,
        seq_no: r.seq_no,
        stage: r.stage,
        stage_label: STAGE_LABEL[r.stage] || `阶段${r.stage}`,
        round_no: r.round_no,
        band_id: r.band_id,
        band_label: bandLabel(r),
        event_item_id: r.event_item_id,
        event_name: r.event_name,
        team_a: r.team_a_name || r.ref_a || '待定',
        team_b: r.team_b_name || r.ref_b || '待定',
        ready: !!(r.team_a_id && r.team_b_id),
        status: r.status
      }))
    }));
  } catch (e) { next(e); }
});

/**
 * 赛程总表
 * GET /api/schedule/list
 */
router.get('/list', async (req, res, next) => {
  try {
    const { competition_id, band_id, event_item_id, stage, play_date } = req.query;
    const where = ['m.competition_id = ?'];
    const params = [competition_id];

    if (band_id) { where.push('m.band_id = ?'); params.push(band_id); }
    if (event_item_id) { where.push('m.event_item_id = ?'); params.push(event_item_id); }
    if (stage) { where.push('m.stage = ?'); params.push(stage); }
    if (play_date) { where.push('ss.play_date = ?'); params.push(play_date); }

    const rows = await query(
      `SELECT m.*, ss.play_date, ss.start_time, ss.end_time, ss.slot_index,
              v.venue_no, v.name AS venue_name,
              ta.team_name AS team_a_name, tb.team_name AS team_b_name,
              sa.name AS school_a, sb.name AS school_b,
              ei.name AS event_name, ei.category,
              gb.stage AS band_stage, gb.gender, gb.label AS band_label
       FROM match_info m
       LEFT JOIN schedule_slot ss ON ss.id = m.slot_id
       LEFT JOIN venue v ON v.id = ss.venue_id
       LEFT JOIN team_entry ta ON ta.id = m.team_a_id
       LEFT JOIN team_entry tb ON tb.id = m.team_b_id
       LEFT JOIN school sa ON sa.id = ta.school_id
       LEFT JOIN school sb ON sb.id = tb.school_id
       JOIN event_item ei ON ei.id = m.event_item_id
       JOIN group_band gb ON gb.id = m.band_id
       WHERE ${where.join(' AND ')}
       ORDER BY ss.play_date, ss.slot_index, m.seq_no`,
      params
    );

    res.json(ok(rows.map((r) => ({
      ...r,
      band_label: bandLabel({ stage: r.band_stage, gender: r.gender, label: r.band_label }),
      stage_label: STAGE_LABEL[r.stage] || `阶段${r.stage}`,
      start_time: (r.start_time || '').slice(0, 5),
      end_time: (r.end_time || '').slice(0, 5)
    }))));
  } catch (e) { next(e); }
});

/**
 * 甘特视图：按日期 × 场地 网格
 * GET /api/schedule/gantt
 */
/**
 * 淘汰赛对阵图数据（bracket）
 * GET /api/schedule/bracket?competition_id=&event_item_id=&band_id=
 * 返回按轮次分列的场次树（八进四 → 半决赛 → 决赛/三四名），前端画 NBA 式对阵图。
 * 晋级连线由前端按「上一列两场 → 下一列一场」的树形规则推导。
 */
/** 纯淘汰模式的轮次名：决赛 / 半决赛 / 8强 / 16强 / 预赛 */
function koRoundLabel(r, totalRounds, matchCount) {
  if (r === totalRounds) return '决赛';
  if (r === totalRounds - 1) return '半决赛';
  const full = 2 ** (totalRounds - r);   // 该轮满额场次（无轮空时）
  if (matchCount < full) return '预赛';   // 该轮只有部分人参赛
  return `${matchCount * 2}强`;
}

/** 构建单个「项目 × 组别」的淘汰赛对阵，供 /bracket 与 /bracket-all 共用 */
async function buildBracket(competitionId, eventItemId, bandId) {
  const ev = await queryOne('SELECT schedule_mode FROM event_item WHERE id = ?', [eventItemId]);
  const isKo = (ev?.schedule_mode || 'GROUP_KO') === 'KO';

  const rows = await query(
    `SELECT m.id, m.stage, m.round_no, m.seq_no, m.score_a, m.score_b, m.status,
            m.team_a_id, m.team_b_id,
            ta.team_name AS team_a_name, sa.name AS school_a,
            tb.team_name AS team_b_name, sb.name AS school_b,
            ss.play_date, TIME_FORMAT(ss.start_time,'%H:%i') AS start_time,
            v.name AS venue_name
     FROM match_info m
     LEFT JOIN team_entry ta ON ta.id = m.team_a_id
     LEFT JOIN team_entry tb ON tb.id = m.team_b_id
     LEFT JOIN school sa ON sa.id = ta.school_id
     LEFT JOIN school sb ON sb.id = tb.school_id
     LEFT JOIN schedule_slot ss ON ss.id = m.slot_id
     LEFT JOIN venue v ON v.id = ss.venue_id
     WHERE m.competition_id = ? AND m.event_item_id = ? AND m.band_id = ?
       AND m.stage IN (${isKo ? '2,6' : '2,3,5,6'})
     ORDER BY ${isKo ? 'm.round_no, m.seq_no' : 'm.stage, m.seq_no'}`,
    [competitionId, eventItemId, bandId]
  );

  const nameOf = (m, side) => {
    const t = side === 'a' ? m.team_a_name : m.team_b_name;
    const s = side === 'a' ? m.school_a : m.school_b;
    return t || s || '待定';
  };

  const decorate = (m) => ({
    id: m.id,
    stage: m.stage,
    round_no: m.round_no,
    seq_no: m.seq_no,
    team_a: nameOf(m, 'a'),
    team_b: nameOf(m, 'b'),
    team_a_id: m.team_a_id,
    team_b_id: m.team_b_id,
    score_a: m.score_a,
    score_b: m.score_b,
    status: m.status,
    has_both: !!(m.team_a_id && m.team_b_id),
    winner_id:
      m.status === 1 && m.score_a != null && m.score_b != null && m.score_a !== m.score_b
        ? (m.score_a > m.score_b ? m.team_a_id : m.team_b_id)
        : null,
    play_date: m.play_date,
    start_time: m.start_time,
    venue: m.venue_name || ''
  });

  const byStage = new Map();
  for (const m of rows) {
    if (!byStage.has(m.stage)) byStage.set(m.stage, []);
    byStage.get(m.stage).push(decorate(m));
  }

  const rounds = [];
  let champion = null;

  if (isKo) {
    // 纯淘汰：按 round_no 分轮，轮次名按剩余人数动态生成
    const koList = byStage.get(2) || [];
    const totalRounds = koList.reduce((mx, m) => Math.max(mx, m.round_no || 1), 0);
    for (let r = 1; r <= totalRounds; r++) {
      const list = koList.filter((m) => (m.round_no || 1) === r);
      if (!list.length) continue;
      rounds.push({
        stage: 2,
        round_no: r,
        label: koRoundLabel(r, totalRounds, list.length),
        matches: list
      });
    }
    const third = byStage.get(6) || [];
    if (third.length) {
      // 三四名插在决赛前一列
      rounds.splice(Math.max(0, rounds.length - 1), 0, {
        stage: 6, label: '三四名', matches: third, side: 'bottom'
      });
    }
    const finalRound = [...rounds].reverse().find((x) => x.stage === 2);
    const finalM = finalRound?.matches?.[0];
    if (finalM && finalM.winner_id) {
      champion = finalM.winner_id === finalM.team_a_id ? finalM.team_a : finalM.team_b;
    }
  } else {
    if (byStage.has(2)) rounds.push({ stage: 2, label: '八进四', matches: byStage.get(2) });
    if (byStage.has(3)) rounds.push({ stage: 3, label: '半决赛', matches: byStage.get(3) });
    if (byStage.has(6)) rounds.push({ stage: 6, label: '三四名', matches: byStage.get(6), side: 'bottom' });
    if (byStage.has(5)) rounds.push({ stage: 5, label: '决赛', matches: byStage.get(5) });

    const finalM = byStage.get(5)?.[0];
    if (finalM && finalM.winner_id) {
      champion = finalM.winner_id === finalM.team_a_id ? finalM.team_a : finalM.team_b;
    }
  }

  return { rounds, champion, is_ko: isKo };
}

router.get('/bracket', async (req, res, next) => {
  try {
    const { competition_id, event_item_id, band_id } = req.query;
    if (!competition_id || !event_item_id || !band_id) return res.json(fail('缺少参数'));
    res.json(ok(await buildBracket(competition_id, event_item_id, band_id)));
  } catch (e) { next(e); }
});

/**
 * GET /api/schedule/bracket-all?competition_id=
 * 一次返回该赛事所有有淘汰赛的「项目 × 组别」，供深色大屏对阵图切换
 */
router.get('/bracket-all', async (req, res, next) => {
  try {
    const { competition_id } = req.query;
    if (!competition_id) return res.json(fail('缺少赛事'));

    const combos = await query(
      `SELECT DISTINCT m.event_item_id, m.band_id,
              ei.name AS event_name, ei.category, ei.sort_no AS event_sort,
              gb.label AS band_label, gb.stage, gb.gender, gb.sort_no AS band_sort
       FROM match_info m
       JOIN event_item ei ON ei.id = m.event_item_id
       JOIN group_band gb ON gb.id = m.band_id
       WHERE m.competition_id = ? AND m.stage IN (2,3,5,6)
       ORDER BY gb.stage, gb.gender, ei.sort_no`, [competition_id]);

    const out = [];
    for (const c of combos) {
      const b = await buildBracket(competition_id, c.event_item_id, c.band_id);
      if (!b.rounds.length) continue;
      out.push({
        event_item_id: c.event_item_id,
        band_id: c.band_id,
        event_name: c.event_name,
        band_label: c.band_label || '',
        stage: c.stage,
        rounds: b.rounds,
        champion: b.champion,
        match_count: b.rounds.reduce((s, r) => s + r.matches.length, 0)
      });
    }
    res.json(ok(out));
  } catch (e) { next(e); }
});

/**
 * GET /api/schedule/gantt?competition_id=
 *
 * 【模型变更】原来返回的是「格子数组」：每个 schedule_slot 一格，
 * 通过 slot_id 一对一挂一场比赛（`new Map(matches.map(m => [m.slot_id, m]))`）——
 * 这就是"一格只能一场"的根源。
 *
 * 现在改为返回三层结构：
 *   days     比赛日（来自可用时间窗）
 *   windows  可用时间窗（当天 × 场地 × 时段）
 *   matches  已排期场次（自带日期/场地/起止时间）
 * 前端按 (日期, 场地, 时间) 自行分桶渲染，**同一时间窗内可以有多场**。
 *
 * 老数据（只有 slot_id、没有 play_date/start_time）会在服务端回填成 match 的时间，
 * 保证升级后老赛程照样能显示。
 */
router.get('/gantt', async (req, res, next) => {
  try {
    const { competition_id } = req.query;

    const venues = await query(
      'SELECT * FROM venue WHERE competition_id = ? ORDER BY venue_no',
      [competition_id]
    );

    const windows = await query(
      `SELECT ss.*, v.venue_no, v.name AS venue_name FROM schedule_slot ss
       JOIN venue v ON v.id = ss.venue_id
       WHERE ss.competition_id = ? ORDER BY ss.play_date, v.venue_no, ss.slot_index`,
      [competition_id]
    );

    const matches = await query(
      `SELECT m.*, ta.team_name AS team_a_name, tb.team_name AS team_b_name,
              ei.name AS event_name, gb.stage AS band_stage, gb.gender, gb.label AS band_label
       FROM match_info m
       LEFT JOIN team_entry ta ON ta.id = m.team_a_id
       LEFT JOIN team_entry tb ON tb.id = m.team_b_id
       JOIN event_item ei ON ei.id = m.event_item_id
       JOIN group_band gb ON gb.id = m.band_id
       WHERE m.competition_id = ?`,
      [competition_id]
    );

    // 老数据回填：只有 slot_id 的，从时间窗借时间与场地
    const winById = new Map(windows.map((w) => [w.id, w]));
    const decorate = (m) => {
      let date = m.play_date;
      let start = m.start_time;
      let end = m.end_time;
      let venueId = m.venue_id;
      if ((!date || !start) && m.slot_id && winById.has(m.slot_id)) {
        const w = winById.get(m.slot_id);
        date = date || w.play_date;
        start = start || w.start_time;
        end = end || w.end_time;
        venueId = venueId || w.venue_id;
      }
      return {
        id: m.id,
        seq_no: m.seq_no,
        stage: m.stage,
        stage_label: STAGE_LABEL[m.stage],
        band_id: m.band_id,
        event_item_id: m.event_item_id,
        event_name: m.event_name,
        band_label: bandLabel({ stage: m.band_stage, gender: m.gender, label: m.band_label }),
        team_a: m.team_a_name || m.ref_a,
        team_b: m.team_b_name || m.ref_b,
        score_a: m.score_a,
        score_b: m.score_b,
        status: m.status,
        confirmed: Number(m.confirmed) === 1,
        date,
        start_time: start ? String(start).slice(0, 5) : null,
        end_time: end ? String(end).slice(0, 5) : null,
        venue_id: venueId,
        slot_id: m.slot_id
      };
    };

    const decorated = matches.map(decorate);
    const scheduled = decorated.filter((m) => m.date && m.start_time);
    const unscheduled = decorated.filter((m) => !m.date || !m.start_time);

    // 比赛日：优先取已排期场次的日期，其次取时间窗的日期
    const dateSet = new Set();
    scheduled.forEach((m) => dateSet.add(m.date));
    windows.forEach((w) => dateSet.add(w.play_date));
    const dates = [...dateSet].filter(Boolean).sort();

    res.json(ok({
      dates,
      venues: venues.map((v) => ({ id: v.id, venue_no: v.venue_no, name: v.name })),
      // 可用时间窗（前端画"可放置区"的底纹）
      windows: windows.map((w) => ({
        id: w.id,
        date: w.play_date,
        venue_id: w.venue_id,
        venue_no: w.venue_no,
        venue_name: w.venue_name,
        slot_index: w.slot_index,
        start_time: String(w.start_time || '').slice(0, 5),
        end_time: String(w.end_time || '').slice(0, 5),
        slot_type: w.slot_type,
        occupation: w.occupation
      })),
      // 已排期场次（自带时间地点）
      matches: scheduled,
      // 未排期场次
      unplaced: unscheduled
    }));
  } catch (e) { next(e); }
});

/**
 * 对阵表（与排期解耦）
 * GET /api/schedule/lineup?competition_id=1&event_item_id=&band_id=
 *
 * ============================================================
 * 为什么需要这个接口
 * ============================================================
 * 原来「谁跟谁比」和「什么时候在哪打」被揉进了同一个"时间槽"概念，
 * 结果是：
 *   - 淘汰赛生成后，因为装箱只排 stage=1，在甘特图上根本看不见
 *   - 管理员无法回答「我的赛程编排到哪一步了」
 *
 * 这个接口把**对阵**单独抽出来：
 *   小组赛 → 轮次矩阵（Berger，每轮几场一目了然）
 *   淘汰赛 → 对阵树（按轮次）
 * 完全不涉及时间地点，所以「生成对阵」不再需要先「生成时间槽」。
 */
router.get('/lineup', async (req, res, next) => {
  try {
    const { competition_id, event_item_id, band_id } = req.query;
    if (!competition_id) return res.json(fail('缺少赛事参数'));

    const where = ['m.competition_id = ?'];
    const params = [competition_id];
    if (event_item_id) { where.push('m.event_item_id = ?'); params.push(event_item_id); }
    if (band_id) { where.push('m.band_id = ?'); params.push(band_id); }

    const matches = await query(
      `SELECT m.*, ta.team_name AS team_a_name, tb.team_name AS team_b_name,
              ei.name AS event_name, ei.category, ei.schedule_mode,
              gb.label AS band_label, gb.stage AS band_stage, gb.gender
         FROM match_info m
         LEFT JOIN team_entry ta ON ta.id = m.team_a_id
         LEFT JOIN team_entry tb ON tb.id = m.team_b_id
         JOIN event_item ei ON ei.id = m.event_item_id
         JOIN group_band gb ON gb.id = m.band_id
        WHERE ${where.join(' AND ')}
        ORDER BY m.band_id, m.event_item_id, m.stage, m.round_no, m.seq_no`,
      params
    );

    // 按「组别 × 项目」分组
    const combos = new Map();
    for (const m of matches) {
      const k = `${m.band_id}|${m.event_item_id}`;
      if (!combos.has(k)) {
        combos.set(k, {
          band_id: m.band_id,
          band_label: bandLabel({ stage: m.band_stage, gender: m.gender, label: m.band_label }),
          event_item_id: m.event_item_id,
          event_name: m.event_name,
          schedule_mode: m.schedule_mode || 'GROUP_KO',
          groups: new Map(),
          total: 0,
          done: 0,
          scheduled: 0
        });
      }
      const c = combos.get(k);
      c.total++;
      if (Number(m.status) === 1) c.done++;
      if (m.play_date) c.scheduled++;

      // 小组赛按小组归拢，淘汰赛按轮次归拢
      const gk = m.stage === 1
        ? `g-${m.heat_group_id || 'single'}`
        : `s-${m.stage}-r${m.round_no || 0}`;
      if (!c.groups.has(gk)) {
        c.groups.set(gk, {
          key: gk,
          group_id: m.heat_group_id,
          group_letter: m.stage === 1 ? m.group_letter : null,
          stage: m.stage,
          round_no: m.round_no,
          rounds: new Map()
        });
      }
      const g = c.groups.get(gk);
      if (!g.rounds.has(m.round_no || 0)) g.rounds.set(m.round_no || 0, []);
      g.rounds.get(m.round_no || 0).push(m);
    }

    const out = [];
    for (const c of combos.values()) {
      const groups = [];
      for (const g of c.groups.values()) {
        const rounds = [...g.rounds.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([rn, list]) => ({
            round_no: rn,
            matches: list.map((m) => ({
              id: m.id,
              seq_no: m.seq_no,
              stage: m.stage,
              stage_label: STAGE_LABEL[m.stage],
              team_a: m.team_a_name || m.ref_a || '待定',
              team_b: m.team_b_name || m.ref_b || '待定',
              team_a_id: m.team_a_id,
              team_b_id: m.team_b_id,
              score_a: m.score_a,
              score_b: m.score_b,
              status: m.status,
              scheduled: !!m.play_date,
              play_date: m.play_date,
              start_time: m.start_time ? String(m.start_time).slice(0, 5) : null,
              venue_id: m.venue_id
            }))
          }));
        groups.push({
          key: g.key,
          group_id: g.group_id,
          group_letter: g.group_letter,
          stage: g.stage,
          stage_label: STAGE_LABEL[g.stage],
          rounds
        });
      }
      out.push({
        band_id: c.band_id,
        band_label: c.band_label,
        event_item_id: c.event_item_id,
        event_name: c.event_name,
        schedule_mode: c.schedule_mode,
        total: c.total,
        done: c.done,
        scheduled: c.scheduled,
        groups
      });
    }

    res.json(ok({
      total: out.length,
      combos: out
    }));
  } catch (e) { next(e); }
});

/**
 * 拖拽 / 手动调整场次落位
 * PUT /api/schedule/match/:id
 *
 * 【模型变更】原来只有两种传参：
 *   1) { slot_id }                          —— 落到某个固定格子
 *   2) { play_date, start_time, venue_id }  —— 落到空白处则新建一个格子
 * 新模型下场次自带时间地点，同一时间窗内允许多场，所以：
 *   - 直接传 { play_date, start_time, venue_id } 即可，**不需要 slot_id**
 *   - slot_id 只是额外记录「落在哪个可用时间窗」，不再是一对一的归属
 *   - 时长按项目的 match_minutes 计算（原来写死 40 分钟）
 */
router.put('/match/:id', roleRequired(1), async (req, res, next) => {
  try {
    const { slot_id, play_date, start_time, venue_id, end_time } = req.body;
    const matchId = req.params.id;

    const m = await queryOne('SELECT * FROM match_info WHERE id = ?', [matchId]);
    if (!m) return res.json(fail('场次不存在'));

    // ---- 情况一：给了具体时间地点（新模型的主路径）----
    if (play_date && start_time && venue_id) {
      const st = String(start_time).slice(0, 5);
      const minutes = await ballTimeline.matchDuration(m.event_item_id, 40);
      const et = end_time ? String(end_time).slice(0, 5) : addMinutes(st, minutes);

      // 场地冲突：同一场地、同一日期、时间区间重叠
      const venueBusy = await queryOne(
        `SELECT m.id, m.seq_no,
                COALESCE(ta.team_name, m.ref_a) AS a,
                COALESCE(tb.team_name, m.ref_b) AS b
           FROM match_info m
           LEFT JOIN team_entry ta ON ta.id = m.team_a_id
           LEFT JOIN team_entry tb ON tb.id = m.team_b_id
          WHERE m.competition_id = ? AND m.id != ? AND m.play_date = ? AND m.venue_id = ?
            AND m.start_time IS NOT NULL
            AND TIME_TO_SEC(m.start_time) < TIME_TO_SEC(?)
            AND TIME_TO_SEC(?) < TIME_TO_SEC(m.end_time)`,
        [m.competition_id, matchId, play_date, venue_id, et, st]
      );
      if (venueBusy) {
        return res.json(fail(`该场地此时段已有第 ${venueBusy.seq_no} 场（${venueBusy.a || '待定'} 对 ${venueBusy.b || '待定'}）`));
      }

      // 队伍冲突：同一支队伍同一时段已有另一场
      const teamBusy = await queryOne(
        `SELECT m.id, m.seq_no, ta.team_name AS team_a, tb.team_name AS team_b
           FROM match_info m
           LEFT JOIN team_entry ta ON ta.id = m.team_a_id
           LEFT JOIN team_entry tb ON tb.id = m.team_b_id
          WHERE m.competition_id = ? AND m.id != ? AND m.play_date = ?
            AND m.start_time IS NOT NULL
            AND ((m.team_a_id IN (?, ?) AND m.team_a_id IS NOT NULL)
              OR (m.team_b_id IN (?, ?) AND m.team_b_id IS NOT NULL))
            AND TIME_TO_SEC(m.start_time) < TIME_TO_SEC(?)
            AND TIME_TO_SEC(?) < TIME_TO_SEC(m.end_time)`,
        [m.competition_id, matchId, play_date,
          m.team_a_id, m.team_b_id, m.team_a_id, m.team_b_id, et, st]
      );
      if (teamBusy) {
        return res.json(fail(`有队伍在这个时段已有第 ${teamBusy.seq_no} 场`));
      }

      // 关联到覆盖该时刻的可用时间窗（如果有）
      let winId = Number(slot_id) || 0;
      if (!winId) {
        const w = await queryOne(
          `SELECT id FROM schedule_slot
            WHERE competition_id = ? AND play_date = ? AND venue_id = ?
              AND TIME_TO_SEC(start_time) <= TIME_TO_SEC(?)
              AND TIME_TO_SEC(?) <= TIME_TO_SEC(end_time)
            ORDER BY slot_index LIMIT 1`,
          [m.competition_id, play_date, venue_id, st, et]
        );
        winId = w?.id || null;
      }

      await execute(
        `UPDATE match_info
            SET play_date = ?, venue_id = ?, start_time = ?, end_time = ?, slot_id = ?
          WHERE id = ?`,
        [play_date, venue_id, `${st}:00`, `${et}:00`, winId, matchId]
      );
      return res.json(ok({ play_date, venue_id, start_time: st, end_time: et }, '已调整'));
    }

    // ---- 情况二：只给了 slot_id（老数据兼容）----
    if (slot_id) {
      const targetSlotId = Number(slot_id);
      const slot = await queryOne(
        'SELECT * FROM schedule_slot WHERE id = ?', [targetSlotId]
      );
      if (!slot) return res.json(fail('目标时段不存在'));

      if (Number(slot.slot_type) === 2) {
        return res.json(fail(`该时段已被「${slot.occupation || '占位'}」占用，不能放比赛`));
      }

      const minutes = await ballTimeline.matchDuration(m.event_item_id, 40);
      const st = String(slot.start_time).slice(0, 5);
      const et = addMinutes(st, minutes);

      await execute(
        `UPDATE match_info
            SET play_date = ?, venue_id = ?, start_time = ?, end_time = ?, slot_id = ?
          WHERE id = ?`,
        [slot.play_date, slot.venue_id, `${st}:00`, `${et}:00`, targetSlotId, matchId]
      );
      return res.json(ok({ slot_id: targetSlotId }, '已调整'));
    }

    return res.json(fail('请指定比赛日期、时间与场地'));
  } catch (e) { next(e); }
});

/**
 * 手动设置开赛时间（只改这一场，不动其他场次）
 * PATCH /api/schedule/match/:id/time
 *
 * 原来改的是 schedule_slot.start_time —— 一改就影响了**所有落在那个格子上的比赛**
 * （虽然当时一格只有一场，但语义是错的）。现在只改这一场自己的时间。
 */
router.patch('/match/:id/time', roleRequired(1), async (req, res, next) => {
  try {
    const { start_time, end_time } = req.body;
    if (!start_time) return res.json(fail('请填写时间'));

    const m = await queryOne('SELECT * FROM match_info WHERE id = ?', [req.params.id]);
    if (!m) return res.json(fail('场次不存在'));

    const st = String(start_time).slice(0, 5);
    const minutes = await ballTimeline.matchDuration(m.event_item_id, 40);
    const et = end_time ? String(end_time).slice(0, 5) : addMinutes(st, minutes);

    await execute(
      'UPDATE match_info SET start_time = ?, end_time = ? WHERE id = ?',
      [`${st}:00`, `${et}:00`, req.params.id]
    );
    res.json(ok(null, '已调整'));
  } catch (e) { next(e); }
});

/**
 * 添加非比赛占位（开幕式、体测等）
 * POST /api/schedule/block
 */
router.post('/block', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, play_date, venue_id, slot_type, occupation, start_time, end_time } = req.body;
    if (!competition_id || !play_date || !venue_id || !occupation) {
      return res.json(fail('请填写完整'));
    }

    // 找到该场地当天的槽位，把对应的标记为占位
    const slots = await query(
      'SELECT * FROM schedule_slot WHERE competition_id=? AND play_date=? AND venue_id=? ORDER BY slot_index',
      [competition_id, play_date, venue_id]
    );
    if (slots.length === 0) return res.json(fail('该场地当天没有时间槽，请先生成时间槽'));

    // 全天占位：全部标记；否则只标记第一个
    const targets = slot_type === 3 ? slots : [slots[0]];

    for (const s of targets) {
      await execute(
        'UPDATE schedule_slot SET slot_type = 2, occupation = ?, start_time = ?, end_time = ? WHERE id = ?',
        [occupation, start_time || s.start_time, end_time || s.end_time, s.id]
      );
    }
    res.json(ok({ count: targets.length }, `已占用 ${targets.length} 个时间槽`));
  } catch (e) { next(e); }
});

/**
 * 删除占位
 */
router.delete('/block/:slotId', roleRequired(1), async (req, res, next) => {
  try {
    await execute(
      "UPDATE schedule_slot SET slot_type = 1, occupation = NULL WHERE id = ? AND slot_type = 2",
      [req.params.slotId]
    );
    res.json(ok(null, '已取消占位'));
  } catch (e) { next(e); }
});

/**
 * 手动编排：直接指定 日期 + 时间 + 场地 + 对阵双方
 * POST /api/schedule/manual
 *
 * 不依赖"生成时间槽 + 自动装箱"，用户填什么时间就排什么时间。
 * 若该场地该时刻还没有时间槽，会自动建一个。
 */
router.post('/manual', roleRequired(1), async (req, res, next) => {
  try {
    const {
      competition_id, band_id, event_item_id,
      play_date, start_time, venue_id,
      team_a_id, team_b_id, stage
    } = req.body;

    if (!competition_id) return res.json(fail('缺少赛事'));
    if (!band_id) return res.json(fail('请选择组别'));
    if (!event_item_id) return res.json(fail('请选择项目'));
    if (!play_date) return res.json(fail('请选择比赛日期'));
    if (!start_time) return res.json(fail('请填写开赛时间'));
    if (!venue_id) return res.json(fail('请选择场地'));
    if (!team_a_id || !team_b_id) return res.json(fail('请选择对阵双方'));
    if (Number(team_a_id) === Number(team_b_id)) return res.json(fail('对阵双方不能是同一支队伍'));

    // 时间规范化 HH:mm
    const st = String(start_time).slice(0, 5);
    if (!/^\d{1,2}:\d{2}$/.test(st)) return res.json(fail('时间格式应为 HH:mm'));
    const [hh, mm] = st.padStart(5, '0').split(':').map(Number);
    if (hh > 23 || mm > 59) return res.json(fail('时间超出范围'));
    const timeStr = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;

    // 项目时长 → 结束时间
    const ev = await queryOne('SELECT * FROM event_item WHERE id = ?', [event_item_id]);
    if (!ev) return res.json(fail('项目不存在'));
    const minutes = Number(ev.match_minutes) > 0 ? Number(ev.match_minutes) : 40;
    const endTotal = hh * 60 + mm + minutes;
    const endStr = `${String(Math.floor(endTotal / 60) % 24).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}:00`;

    // 校验两支队伍归属
    const ta = await queryOne('SELECT * FROM team_entry WHERE id = ?', [team_a_id]);
    const tb = await queryOne('SELECT * FROM team_entry WHERE id = ?', [team_b_id]);
    if (!ta || !tb) return res.json(fail('对阵队伍不存在'));
    if (Number(ta.band_id) !== Number(band_id) || Number(tb.band_id) !== Number(band_id)) {
      return res.json(fail('队伍组别与所选组别不一致'));
    }
    if (Number(ta.event_item_id) !== Number(event_item_id) || Number(tb.event_item_id) !== Number(event_item_id)) {
      return res.json(fail('队伍项目与所选项目不一致'));
    }

    // ---------- 先做完全部校验，再落库 ----------

    // 场地时间冲突（同场地、时间重叠）
    const venueBusy = await queryOne(
      `SELECT id, seq_no FROM match_info
        WHERE competition_id = ? AND play_date = ? AND venue_id = ?
          AND start_time IS NOT NULL
          AND TIME_TO_SEC(start_time) < TIME_TO_SEC(?)
          AND TIME_TO_SEC(?) < TIME_TO_SEC(end_time)
        LIMIT 1`,
      [competition_id, play_date, venue_id, endStr, timeStr]
    );
    if (venueBusy) {
      return res.json(fail(`该场地此时段已有第 ${venueBusy.seq_no} 场，请换时间或场地`));
    }

    // 队伍时间冲突（同一支队伍同一时段不能打两场）
    const teamBusy = await queryOne(
      `SELECT id, seq_no FROM match_info
        WHERE competition_id = ? AND play_date = ?
          AND start_time IS NOT NULL
          AND ((team_a_id = ? OR team_b_id = ?) OR (team_a_id = ? OR team_b_id = ?))
          AND TIME_TO_SEC(start_time) < TIME_TO_SEC(?)
          AND TIME_TO_SEC(?) < TIME_TO_SEC(end_time)
        LIMIT 1`,
      [competition_id, play_date, team_a_id, team_a_id, team_b_id, team_b_id, endStr, timeStr]
    );
    if (teamBusy) {
      return res.json(fail(`有队伍在这个时段已有第 ${teamBusy.seq_no} 场，请换时间`));
    }

    // 同一对队伍在同一项目里不能重复对阵
    // 例外：该项目开了主客场双循环（如篮球），允许同一对队伍打多场（主、客各一场）
    const homeAway = Number(ev.home_away) === 1;

    if (!homeAway) {
      const dupPair = await queryOne(
        `SELECT id FROM match_info
         WHERE competition_id = ? AND event_item_id = ?
           AND ((team_a_id = ? AND team_b_id = ?) OR (team_a_id = ? AND team_b_id = ?))
         LIMIT 1`,
        [competition_id, event_item_id, team_a_id, team_b_id, team_b_id, team_a_id]
      );
      if (dupPair) return res.json(fail('这两支队伍在该项目里已经排过一场了'));
    }

    // 关联到覆盖该时刻的可用时间窗（如果有），不再强制建槽
    const win = await queryOne(
      `SELECT id, slot_type, occupation FROM schedule_slot
        WHERE competition_id = ? AND play_date = ? AND venue_id = ?
          AND TIME_TO_SEC(start_time) <= TIME_TO_SEC(?)
          AND TIME_TO_SEC(?) <= TIME_TO_SEC(end_time)
        ORDER BY slot_index LIMIT 1`,
      [competition_id, play_date, venue_id, timeStr, endStr]
    );
    if (win && Number(win.slot_type) === 2) {
      return res.json(fail(`该时段已被占用（${win.occupation || '非比赛'}）`));
    }

    // 场序
    const seqRow = await queryOne(
      'SELECT COALESCE(MAX(seq_no), 0) AS mx FROM match_info WHERE competition_id = ?',
      [competition_id]
    );
    const seq = Number(seqRow?.mx || 0) + 1;

    const r = await execute(
      `INSERT INTO match_info
        (competition_id, band_id, event_item_id, stage, round_no, seq_no,
         team_a_id, team_b_id, slot_id, play_date, start_time, end_time, venue_id, status)
       VALUES (?,?,?,?,0,?,?,?,?,?,?,?,?,0)`,
      [competition_id, band_id, event_item_id, Number(stage) || 1, seq,
       team_a_id, team_b_id, win?.id || null,
       play_date, timeStr, endStr, venue_id]
    );

    res.json(ok({
      id: r.insertId,
      seq_no: seq,
      slot_id: win?.id || null,
      start_time: timeStr.slice(0, 5),
      end_time: endStr.slice(0, 5)
    }, `已排定第 ${seq} 场：${st}`));
  } catch (e) { next(e); }
});

/**
 * 删除场次（手动编排排错了可以撤）
 * DELETE /api/schedule/match/:id
 * 注意：只删比赛，保留时间槽（槽是用户的时间规划，不能顺手删掉）
 */
router.delete('/match/:id', roleRequired(1), async (req, res, next) => {
  try {
    const m = await queryOne('SELECT * FROM match_info WHERE id = ?', [req.params.id]);
    if (!m) return res.json(fail('场次不存在'));
    if (m.status === 1) return res.json(fail('已录分的场次不能删除，请先在成绩录入里清除'));

    await execute('DELETE FROM match_result WHERE match_id = ?', [m.id]);
    await execute('DELETE FROM match_referee WHERE match_id = ?', [m.id]);
    await execute('DELETE FROM match_info WHERE id = ?', [m.id]);

    res.json(ok(null, `已删除第 ${m.seq_no} 场`));
  } catch (e) { next(e); }
});

/**
 * 清除整个时间段（甘特图整行）
 * POST /api/schedule/clear-time
 * body: { competition_id, start_time, play_date?, force? }
 *   start_time  'HH:mm' 或 'HH:mm:00'
 *   play_date   不传 = 所有日期的同一时刻
 *   force=1     连同已录分的场次一起删（默认拒绝）
 *
 * 【模型变更】原来删的是「槽位 + 挂在槽上的比赛」。
 * 现在比赛自带日期/时间，与时间窗不再是 1:1，所以改成：
 *   - 把该时刻的**比赛**清空（取消排期，或按 force 删除）
 *   - 同时把该时刻的**可用时间窗**也清掉（它属于"时间规划"，跟槽位一个性质）
 */
router.post('/clear-time', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, start_time, play_date, force } = req.body;
    if (!competition_id) return res.json(fail('缺少赛事'));

    const st = String(start_time || '').slice(0, 5);
    if (!/^\d{1,2}:\d{2}$/.test(st)) return res.json(fail('时间格式应为 HH:mm'));
    const timeStr = `${st.padStart(5, '0')}:00`;

    const where = ['competition_id = ?', 'start_time = ?'];
    const params = [competition_id, timeStr];
    if (play_date) {
      where.push('play_date = ?');
      params.push(play_date);
    }

    // 该时刻的可用时间窗
    const wins = await query(
      `SELECT id, slot_type, occupation FROM schedule_slot
        WHERE ${where.join(' AND ')} ORDER BY id`,
      params
    );

    // 该时刻的比赛（按自带时间字段查）
    const mw = ['competition_id = ?', 'start_time = ?'];
    const mp = [competition_id, timeStr];
    if (play_date) { mw.push('play_date = ?'); mp.push(play_date); }
    const matches = await query(
      `SELECT id, seq_no, status FROM match_info WHERE ${mw.join(' AND ')} ORDER BY seq_no`,
      mp
    );

    if (!wins.length && !matches.length) return res.json(fail('该时段没有可清除的内容'));

    const scored = matches.filter((r) => Number(r.status) === 1);

    // 已录分的场次默认拒绝，避免把成绩误删
    if (scored.length && !force) {
      const seqs = scored.slice(0, 5).map((r) => `第${r.seq_no}场`).join('、');
      return res.json(
        fail(`该时段有 ${scored.length} 场已录入成绩（${seqs}${scored.length > 5 ? '等' : ''}），请先到成绩录入中清除`)
      );
    }

    const matchIds = matches.map((r) => r.id);
    const winIds = wins.map((r) => r.id);

    if (matchIds.length) {
      const ph = matchIds.map(() => '?').join(',');
      if (force) {
        await execute(`DELETE FROM match_result WHERE match_id IN (${ph})`, matchIds);
        await execute(`DELETE FROM match_referee WHERE match_id IN (${ph})`, matchIds);
        await execute(`DELETE FROM match_info WHERE id IN (${ph})`, matchIds);
      } else {
        // 只取消排期，保留比赛
        await execute(
          `UPDATE match_info SET play_date = NULL, start_time = NULL, end_time = NULL,
                  venue_id = NULL, slot_id = NULL
            WHERE id IN (${ph})`,
          matchIds
        );
      }
    }

    // 时间窗：占位（slot_type=2）删掉，普通窗口保留（它是排期的骨架）
    const placeholderIds = wins.filter((w) => Number(w.slot_type) === 2).map((w) => w.id);
    if (placeholderIds.length) {
      const ph = placeholderIds.map(() => '?').join(',');
      await execute(`DELETE FROM schedule_slot WHERE id IN (${ph})`, placeholderIds);
    }

    const scope = play_date ? `${play_date} ` : '';
    res.json(
      ok(
        { slots: winIds.length, matches: matchIds.length, scored: scored.length, forced: !!force },
        force
          ? `已清除 ${scope}${st} 时段：${matchIds.length} 场比赛、${placeholderIds.length} 个占位`
          : `已取消 ${scope}${st} 时段的 ${matchIds.length} 场排期（比赛本身保留）`
      )
    );
  } catch (e) { next(e); }
});

/**
 * 清理空时间窗（没有比赛、也不是占位的窗口）
 * POST /api/schedule/clean-empty
 */
router.post('/clean-empty', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id } = req.body;
    if (!competition_id) return res.json(fail('缺少赛事'));

    const rows = await query(
      `SELECT ss.id FROM schedule_slot ss
        WHERE ss.competition_id = ? AND ss.slot_type = 1
          AND NOT EXISTS (
            SELECT 1 FROM match_info m
             WHERE m.slot_id = ss.id
                OR (m.play_date = ss.play_date AND m.venue_id = ss.venue_id
                    AND m.start_time >= ss.start_time AND m.start_time < ss.end_time)
          )`,
      [competition_id]
    );

    if (!rows.length) return res.json(ok({ count: 0 }, '没有需要清理的空时段'));

    const ids = rows.map((r) => r.id);
    const ph = ids.map(() => '?').join(',');
    await execute(`DELETE FROM schedule_slot WHERE id IN (${ph})`, ids);
    res.json(ok({ count: ids.length }, `已清理 ${ids.length} 个空时段`));
  } catch (e) { next(e); }
});

/**
 * 阶段推进检查
 * POST /api/schedule/advance
 */
router.post('/advance', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, band_id, event_item_id } = req.body;
    const result = await scheduler.tryAdvanceStage(competition_id, band_id, event_item_id);
    res.json(ok(result, result.advanced ? '已推进到下一阶段' : (result.reason || '无需推进')));
  } catch (e) { next(e); }
});

/**
 * 检查所有组别的推进状态
 */
router.get('/advance-status', async (req, res, next) => {
  try {
    const { competition_id } = req.query;
    const bands = await query(
      'SELECT * FROM group_band WHERE competition_id = ? ORDER BY stage, gender',
      [competition_id]
    );
    const events = await query(
      'SELECT * FROM event_item WHERE competition_id = ? AND category = 3',
      [competition_id]
    );

    const status = [];
    for (const band of bands) {
      for (const event of events) {
        const stages = await query(
          `SELECT stage, COUNT(*) AS cnt, SUM(status=1) AS done_cnt
           FROM match_info WHERE competition_id=? AND band_id=? AND event_item_id=?
           GROUP BY stage`,
          [competition_id, band.id, event.id]
        );
        if (stages.length === 0) continue;

        const cur = stages[stages.length - 1];
        status.push({
          band_id: band.id,
          band_label: bandLabel(band),
          event_id: event.id,
          event_name: event.name,
          stage: cur.stage,
          stage_label: STAGE_LABEL[cur.stage],
          total: cur.cnt,
          done: cur.done_cnt,
          complete: cur.done_cnt >= cur.cnt
        });
      }
    }
    res.json(ok(status));
  } catch (e) { next(e); }
});

/** 把日期字符串往后推 n 天，返回 YYYY-MM-DD */
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 找 >= dateStr 的第一个星期 wd（1=周一 … 7=周日） */
function firstWeekday(dateStr, wd) {
  const d = new Date(`${dateStr}T00:00:00`);
  const cur = d.getDay() === 0 ? 7 : d.getDay();
  return addDays(dateStr, (wd - cur + 7) % 7);
}

/**
 * 联赛自动排期：每周一轮 + 主场排在自己学校的场地
 *
 * POST /api/schedule/league-auto
 * { competition_id, event_item_id?, start_date, weekday, base_time?, interval? }
 *   weekday: 1=周一 … 7=周日，start_date 会被顺延到最近的该星期
 *   base_time: 每天首场时间，默认 16:00
 *   interval: 同场地相邻两场的间隔，默认取项目 slot_interval
 *
 * 规则：
 *   - 第 n 轮排在「首个比赛日 + (n-1) 周」
 *   - 每场排到主队（team_a）所属学校的场地；主队没有场地时退回 1 号场地并给出提示
 *   - 同一天同一场地有多场（比如男、女各一场）时，依次占用 16:00、16:45… 等时段
 *
 * 【模型变更】原来靠"新建固定格子"来占位（每场一个 slot），
 * 新模型下每场自带时间地点，不再新建格子；同一场地同一时刻不会撞。
 */
router.post('/league-auto', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, event_item_id, start_date, weekday, base_time, interval: intervalIn } = req.body;
    if (!competition_id || !start_date) return res.json(fail('缺少赛事或起始日期'));
    const wd = Math.min(7, Math.max(1, Number(weekday) || 4));
    const baseTime = base_time || '16:00';

    const params = [competition_id];
    let sql = 'SELECT * FROM match_info WHERE competition_id = ?';
    if (event_item_id) { sql += ' AND event_item_id = ?'; params.push(event_item_id); }
    sql += ' ORDER BY round_no, stage, id';
    const matches = await query(sql, params);
    if (!matches.length) return res.json(fail('没有可排的比赛，请先在「分组编排」生成循环赛赛程'));

    const evIds = [...new Set(matches.map((m) => m.event_item_id))];
    const events = await query(
      `SELECT * FROM event_item WHERE id IN (${evIds.map(() => '?').join(',')})`, evIds);
    const interval = Math.max(20, Number(intervalIn) || Number(events[0]?.slot_interval) || 45);

    // 学校 → 主场场地
    const venues = await query('SELECT * FROM venue WHERE competition_id = ? ORDER BY venue_no', [competition_id]);
    const venueBySchool = new Map();
    for (const v of venues) {
      if (v.host_school_id && !venueBySchool.has(v.host_school_id)) venueBySchool.set(v.host_school_id, v);
    }
    if (!venueBySchool.size) {
      return res.json(fail('还没有把场地关联到学校，无法按「主场在本校」排期。请先到「项目与场地 → 场地管理」把每个场地绑定所属学校'));
    }

    const teams = await query('SELECT id, school_id FROM team_entry WHERE competition_id = ?', [competition_id]);
    const teamSchool = new Map(teams.map((t) => [t.id, t.school_id]));

    // 每场时长（按项目配置）
    const durations = new Map();
    for (const ev of events) {
      durations.set(ev.id, Number(ev.match_minutes) > 0 ? Number(ev.match_minutes) : 30);
    }

    const first = firstWeekday(start_date, wd);
    const slotUsed = new Map();   // `${date}|${venueId}` -> 已占用场次数
    const warnings = [];
    const updates = [];
    let placed = 0;

    for (const m of matches) {
      const round = Number(m.round_no) || 1;
      const dateStr = addDays(first, (round - 1) * 7);

      const homeSchool = teamSchool.get(m.team_a_id);
      let venue = homeSchool ? venueBySchool.get(homeSchool) : null;
      if (!venue) {
        venue = venues[0];
        warnings.push(`第 ${m.seq_no} 场的主队未绑定主场场地，临时用「${venue.name}」`);
      }

      const key = `${dateStr}|${venue.id}`;
      const idx = slotUsed.get(key) || 0;
      const st = addMinutes(baseTime, idx * interval);
      const minutes = durations.get(m.event_item_id) || 30;
      const et = addMinutes(st, minutes);

      // 关联到覆盖该时刻的可用时间窗（没有也不拦 —— 联赛可以自定义时间）
      const win = await queryOne(
        `SELECT id FROM schedule_slot
          WHERE competition_id = ? AND play_date = ? AND venue_id = ?
            AND TIME_TO_SEC(start_time) <= TIME_TO_SEC(?)
            AND TIME_TO_SEC(?) <= TIME_TO_SEC(end_time)
          ORDER BY slot_index LIMIT 1`,
        [competition_id, dateStr, venue.id, `${st}:00`, `${et}:00`]
      );

      updates.push({
        id: m.id,
        play_date: dateStr,
        venue_id: venue.id,
        start_time: `${st}:00`,
        end_time: `${et}:00`,
        slot_id: win?.id || null
      });

      slotUsed.set(key, idx + 1);
      placed++;
    }

    // 事务写库
    await transaction(async (tx) => {
      for (const u of updates) {
        await tx.execute(
          `UPDATE match_info
              SET play_date = ?, venue_id = ?, start_time = ?, end_time = ?, slot_id = ?
            WHERE id = ?`,
          [u.play_date, u.venue_id, u.start_time, u.end_time, u.slot_id, u.id]
        );
      }
    });

    const lastRound = Math.max(...matches.map((m) => Number(m.round_no) || 1));
    res.json(ok({
      placed,
      rounds: lastRound,
      newSlots: 0,
      firstDate: first,
      lastDate: addDays(first, (lastRound - 1) * 7),
      weekday: wd,
      warnings: warnings.slice(0, 20)
    }, `已排 ${placed} 场，共 ${lastRound} 轮，${first} 至 ${addDays(first, (lastRound - 1) * 7)}`));
  } catch (e) { next(e); }
});

/**
 * 纯淘汰（KO）预览：各组别会有几轮、几场、几个轮空
 * GET /api/schedule/ko-preview?competition_id=&event_item_id=
 */
router.get('/ko-preview', async (req, res, next) => {
  try {
    const { competition_id, event_item_id } = req.query;
    if (!competition_id || !event_item_id) return res.json(fail('缺少参数'));

    const rows = await query(
      `SELECT te.band_id, gb.label AS band_label, gb.sort_no, COUNT(*) AS cnt
         FROM team_entry te
         JOIN group_band gb ON gb.id = te.band_id
        WHERE te.competition_id = ? AND te.event_item_id = ? AND te.status = 2
        GROUP BY te.band_id, gb.label, gb.sort_no
        ORDER BY gb.sort_no`,
      [competition_id, event_item_id]
    );

    const bands = rows.map((r) => ({
      band_id: r.band_id,
      band_label: bandLabel({ label: r.band_label, stage: 0, gender: 0 }) || r.band_label,
      ...ko.previewKo(r.cnt)
    }));
    res.json(ok({ bands }));
  } catch (e) { next(e); }
});

/**
 * 纯淘汰（KO）：直接生成对阵树，不走分组
 * POST /api/schedule/generate-ko { competition_id, event_item_id, band_id? }
 */
router.post('/generate-ko', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, event_item_id, band_id } = req.body;
    if (!competition_id || !event_item_id) return res.json(fail('缺少参数'));

    const ev = await queryOne('SELECT name FROM event_item WHERE id = ?', [event_item_id]);
    if (!ev) return res.json(fail('项目不存在'));

    const r = await ko.generateKo(competition_id, event_item_id, { band_id });
    const parts = r.bands.map((b) => (
      b.created
        ? `${b.teams} 人 → ${b.rounds} 轮 ${b.created} 场（${b.byes} 个轮空）`
        : `跳过（${b.note || '人数不足'}）`
    ));
    res.json(ok(r, `已生成 ${r.total} 场对阵：${parts.join('；')}`));
  } catch (e) { next(e); }
});

module.exports = router;