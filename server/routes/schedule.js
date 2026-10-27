const express = require('express');
const { query, queryOne, execute, ok, fail } = require('../db');
const { authRequired, roleRequired } = require('../middleware/auth');
const { bandLabel, addMinutes } = require('../utils/helpers');
const scheduler = require('../services/scheduler');
const { bergerByes } = require('../services/schedule-algorithms');

const router = express.Router();
router.use(authRequired);

const STAGE_LABEL = {
  1: '小组赛', 2: '八进四', 3: '半决赛', 4: '排位赛', 5: '决赛', 6: '三四名'
};

/**
 * 项目赛制设置（主客场双循环 / 是否允许平局 / 积分规则）
 * GET  /api/schedule/event-config?event_item_id=1
 * POST /api/schedule/event-config  { event_item_id, home_away?, allow_draw?, win_points?, draw_points? }
 *
 * home_away=1（主客场双循环）时：手动编排不再限制「同一对队伍重复对阵」，
 * 一键生成循环赛程时第二循环镜像第一循环并主客对调
 */
router.get('/event-config', async (req, res, next) => {
  try {
    const { event_item_id } = req.query;
    if (!event_item_id) return res.json(fail('缺少项目参数'));
    const ev = await queryOne(
      'SELECT id, name, home_away, allow_draw, win_points, draw_points FROM event_item WHERE id = ?',
      [event_item_id]
    );
    if (!ev) return res.json(fail('项目不存在'));
    res.json(ok({
      event_item_id: ev.id,
      name: ev.name,
      home_away: Number(ev.home_away) === 1 ? 1 : 0,
      allow_draw: Number(ev.allow_draw) === 0 ? 0 : 1,
      win_points: Number(ev.win_points) || 3,
      draw_points: Number(ev.draw_points) || 0
    }));
  } catch (e) { next(e); }
});

router.post('/event-config', roleRequired(1), async (req, res, next) => {
  try {
    const { event_item_id, home_away, allow_draw, win_points, draw_points } = req.body;
    if (!event_item_id) return res.json(fail('缺少项目参数'));

    const sets = [];
    const params = [];
    if (home_away !== undefined) { sets.push('home_away = ?'); params.push(Number(home_away) === 1 ? 1 : 0); }
    if (allow_draw !== undefined) { sets.push('allow_draw = ?'); params.push(Number(allow_draw) === 0 ? 0 : 1); }
    if (win_points !== undefined) { sets.push('win_points = ?'); params.push(Number(win_points) || 0); }
    if (draw_points !== undefined) { sets.push('draw_points = ?'); params.push(Number(draw_points) || 0); }
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
 * 生成时间槽
 * POST /api/schedule/slots
 */
router.post('/slots', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, playDates, slotInterval, amStart, pmStart, slotCount } = req.body;
    if (!competition_id || !Array.isArray(playDates) || playDates.length === 0) {
      return res.json(fail('请选择比赛日期'));
    }
    const slots = await scheduler.generateSlots(competition_id, playDates, {
      slotInterval, amStart, pmStart, slotCount
    });
    res.json(ok({ count: slots.length }, `已生成 ${slots.length} 个时间槽`));
  } catch (e) { next(e); }
});

/**
 * 装箱排期
 * POST /api/schedule/pack
 */
router.post('/pack', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id } = req.body;
    const slotMap = await query(
      `SELECT ss.*, v.venue_no, v.name AS venue_name FROM schedule_slot ss
       JOIN venue v ON v.id = ss.venue_id
       WHERE ss.competition_id = ? ORDER BY ss.play_date, v.venue_no, ss.slot_index`,
      [competition_id]
    );
    if (slotMap.length === 0) return res.json(fail('请先生成时间槽'));

    // 每天每场地的槽位数（用于区分上午/下午）
    const firstDate = slotMap[0].play_date;
    const firstVenue = slotMap[0].venue_id;
    const slotsPerVenuePerDay = slotMap.filter(
      (s) => s.play_date === firstDate && s.venue_id === firstVenue
    ).length;
    const halfThreshold = Math.ceil(slotsPerVenuePerDay / 2);

    const mapped = slotMap.map((s) => ({
      id: s.id, date: s.play_date, venue_id: s.venue_id, venue_no: s.venue_no,
      slot_index: s.slot_index,
      half: s.slot_index > halfThreshold ? 'PM' : 'AM',
      start_time: (s.start_time || '').slice(0, 5), end_time: (s.end_time || '').slice(0, 5)
    }));

    const result = await scheduler.packSchedule(competition_id, mapped);
    res.json(ok(result, `已排入 ${result.placed} 场${result.unplaced ? `，${result.unplaced} 场待人工安排` : ''}`));
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
router.get('/gantt', async (req, res, next) => {
  try {
    const { competition_id } = req.query;

    const dates = await query(
      'SELECT DISTINCT play_date FROM schedule_slot WHERE competition_id = ? ORDER BY play_date',
      [competition_id]
    );
    const venues = await query(
      'SELECT * FROM venue WHERE competition_id = ? ORDER BY venue_no',
      [competition_id]
    );
    const slots = await query(
      `SELECT ss.*, v.venue_no, v.name AS venue_name FROM schedule_slot ss
       JOIN venue v ON v.id = ss.venue_id
       WHERE ss.competition_id = ? ORDER BY ss.play_date, ss.start_time, v.venue_no`,
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

    const matchMap = new Map(matches.map((m) => [m.slot_id, m]));

    const cells = slots.map((s) => {
      const m = matchMap.get(s.id);
      return {
        slot_id: s.id,
        date: s.play_date,
        venue_no: s.venue_no,
        venue_name: s.venue_name,
        slot_index: s.slot_index,
        start_time: (s.start_time || '').slice(0, 5),
        end_time: (s.end_time || '').slice(0, 5),
        slot_type: s.slot_type,
        occupation: s.occupation,
        match: m ? {
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
          status: m.status
        } : null
      };
    });

    res.json(ok({
      dates: dates.map((d) => d.play_date),
      venues: venues.map((v) => ({ id: v.id, venue_no: v.venue_no, name: v.name })),
      cells
    }));
  } catch (e) { next(e); }
});

/**
 * 拖拽 / 手动调整场次落位
 * PUT /api/schedule/match/:id
 *
 * 两种传参方式：
 *   1) { slot_id }                                —— 直接落到已有时间槽
 *   2) { play_date, start_time, venue_id }        —— 拖到空白格子：
 *      同日期同场地同时间的槽已存在就复用，不存在则按项目时长新建一个
 */
router.put('/match/:id', roleRequired(1), async (req, res, next) => {
  try {
    const { slot_id, play_date, start_time, venue_id } = req.body;
    const matchId = req.params.id;

    const m = await queryOne('SELECT * FROM match_info WHERE id = ?', [matchId]);
    if (!m) return res.json(fail('场次不存在'));

    let targetSlotId = Number(slot_id) || 0;

    if (!targetSlotId) {
      if (!play_date || !start_time || !venue_id) {
        return res.json(fail('请选择目标时间槽'));
      }
      const st = String(start_time).slice(0, 5);

      // 同日期 + 同场地 + 同开始时间的槽，直接复用
      const exist = await queryOne(
        `SELECT id FROM schedule_slot
         WHERE competition_id = ? AND play_date = ? AND venue_id = ?
           AND TIME_FORMAT(start_time, '%H:%i') = ?`,
        [m.competition_id, play_date, venue_id, st]
      );

      if (exist) {
        targetSlotId = exist.id;
      } else {
        // 没有就新建一个槽：时长取项目配置，默认 40 分钟
        const ev = await queryOne('SELECT match_minutes FROM event_item WHERE id = ?', [m.event_item_id]);
        const minutes = Number(ev && ev.match_minutes) > 0 ? Number(ev.match_minutes) : 40;
        const endTime = addMinutes(st, minutes);

        const mx = await queryOne(
          'SELECT MAX(slot_index) AS mx FROM schedule_slot WHERE competition_id = ? AND play_date = ? AND venue_id = ?',
          [m.competition_id, play_date, venue_id]
        );
        const slotIndex = (Number(mx && mx.mx) || 0) + 1;

        const ins = await execute(
          `INSERT INTO schedule_slot
             (competition_id, play_date, venue_id, slot_index, start_time, end_time, slot_type)
           VALUES (?,?,?,?,?,?,1)`,
          [m.competition_id, play_date, venue_id, slotIndex, `${st}:00`, `${endTime}:00`]
        );
        targetSlotId = ins.insertId;
      }
    }

    // 目标槽是"非比赛占位"（开幕式、体测等），不能塞比赛
    const slot = await queryOne('SELECT slot_type, occupation FROM schedule_slot WHERE id = ?', [targetSlotId]);
    if (!slot) return res.json(fail('目标时间槽不存在'));
    if (Number(slot.slot_type) === 2) {
      return res.json(fail(`该时间槽已被「${slot.occupation || '占位'}」占用，不能放比赛`));
    }

    // 检查目标槽位是否已被占用（返回占用方信息，前端提示更清楚）
    const occupied = await queryOne(
      `SELECT m.id, m.seq_no,
              COALESCE(ta.team_name, m.ref_a) AS a,
              COALESCE(tb.team_name, m.ref_b) AS b
       FROM match_info m
       LEFT JOIN team_entry ta ON ta.id = m.team_a_id
       LEFT JOIN team_entry tb ON tb.id = m.team_b_id
       WHERE m.slot_id = ? AND m.id != ?`,
      [targetSlotId, matchId]
    );
    if (occupied) {
      return res.json(fail(`该时间槽已有第 ${occupied.seq_no} 场（${occupied.a || '待定'} 对 ${occupied.b || '待定'}）`));
    }

    await execute('UPDATE match_info SET slot_id = ? WHERE id = ?', [targetSlotId, matchId]);
    res.json(ok({ slot_id: targetSlotId }, '已调整'));
  } catch (e) { next(e); }
});

/**
 * 手动设置开赛时间（不改槽位）
 */
router.patch('/match/:id/time', roleRequired(1), async (req, res, next) => {
  try {
    const { start_time } = req.body;
    if (!start_time) return res.json(fail('请填写时间'));
    await execute('UPDATE schedule_slot SET start_time = ? WHERE id = (SELECT slot_id FROM match_info WHERE id = ?)', [start_time, req.params.id]);
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
    // 否则校验失败时已创建的空槽会残留在甘特图上

    // 查已有槽（此时不创建）
    let slot = await queryOne(
      `SELECT * FROM schedule_slot
       WHERE competition_id = ? AND play_date = ? AND venue_id = ? AND start_time = ?
       LIMIT 1`,
      [competition_id, play_date, venue_id, timeStr]
    );

    if (slot) {
      if (slot.slot_type === 2) {
        return res.json(fail(`该时段已被占用（${slot.occupation || '非比赛'}）`));
      }
      // 一个槽一场比赛：同场地同时刻不能重复
      const occupied = await queryOne('SELECT id, seq_no FROM match_info WHERE slot_id = ? LIMIT 1', [slot.id]);
      if (occupied) {
        return res.json(fail(`该时间该场地已有第 ${occupied.seq_no} 场，请换时间或场地`));
      }
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

    // 校验全过，开始写库：没有槽就建一个
    if (!slot) {
      const maxRow = await queryOne(
        `SELECT COALESCE(MAX(slot_index), 0) AS mx FROM schedule_slot
         WHERE competition_id = ? AND play_date = ? AND venue_id = ?`,
        [competition_id, play_date, venue_id]
      );
      const idx = Number(maxRow?.mx || 0) + 1;
      const r = await execute(
        `INSERT INTO schedule_slot
          (competition_id, play_date, venue_id, slot_index, start_time, end_time, slot_type)
         VALUES (?,?,?,?,?,?,1)`,
        [competition_id, play_date, venue_id, idx, timeStr, endStr]
      );
      slot = { id: r.insertId, slot_type: 1 };
    }

    // 场序
    const seqRow = await queryOne(
      'SELECT COALESCE(MAX(seq_no), 0) AS mx FROM match_info WHERE competition_id = ?',
      [competition_id]
    );
    const seq = Number(seqRow?.mx || 0) + 1;

    const r = await execute(
      `INSERT INTO match_info
        (competition_id, band_id, event_item_id, stage, round_no, seq_no, team_a_id, team_b_id, slot_id, status)
       VALUES (?,?,?,?,0,?,?,?,?,0)`,
      [competition_id, band_id, event_item_id, Number(stage) || 1, seq, team_a_id, team_b_id, slot.id]
    );

    res.json(ok({
      id: r.insertId,
      seq_no: seq,
      slot_id: slot.id,
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
 * 清除整个时间段（甘特图整行）：删掉该时刻所有场地的槽位及其上的比赛
 * POST /api/schedule/clear-time
 * body: { competition_id, start_time, play_date?, force? }
 *   start_time  'HH:mm' 或 'HH:mm:00'
 *   play_date   不传 = 所有日期的同一时刻
 *   force=1     连同已录分的场次一起删（默认拒绝）
 */
router.post('/clear-time', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, start_time, play_date, force } = req.body;
    if (!competition_id) return res.json(fail('缺少赛事'));

    const st = String(start_time || '').slice(0, 5);
    if (!/^\d{1,2}:\d{2}$/.test(st)) return res.json(fail('时间格式应为 HH:mm'));
    const timeStr = `${st.padStart(5, '0')}:00`;

    const where = ['ss.competition_id = ?', 'ss.start_time = ?'];
    const params = [competition_id, timeStr];
    if (play_date) {
      where.push('ss.play_date = ?');
      params.push(play_date);
    }

    const rows = await query(
      `SELECT ss.id AS slot_id, ss.play_date, ss.slot_type,
              m.id AS match_id, m.seq_no, m.status
       FROM schedule_slot ss
       LEFT JOIN match_info m ON m.slot_id = ss.id
       WHERE ${where.join(' AND ')}
       ORDER BY ss.play_date, ss.id`,
      params
    );

    if (rows.length === 0) return res.json(fail('该时段没有可清除的槽位'));

    const withMatch = rows.filter((r) => r.match_id);
    const scored = withMatch.filter((r) => Number(r.status) === 1);

    // 已录分的场次默认拒绝，避免把成绩误删
    if (scored.length && !force) {
      const seqs = scored.slice(0, 5).map((r) => `第${r.seq_no}场`).join('、');
      return res.json(
        fail(`该时段有 ${scored.length} 场已录入成绩（${seqs}${scored.length > 5 ? '等' : ''}），请先到成绩录入中清除`)
      );
    }

    const slotIds = [...new Set(rows.map((r) => r.slot_id))];
    const matchIds = [...new Set(withMatch.map((r) => r.match_id))];

    // 先清关联数据，再删比赛，最后删槽
    if (matchIds.length) {
      const ph = matchIds.map(() => '?').join(',');
      await execute(`DELETE FROM match_result WHERE match_id IN (${ph})`, matchIds);
      await execute(`DELETE FROM match_referee WHERE match_id IN (${ph})`, matchIds);
      await execute(`DELETE FROM match_info WHERE id IN (${ph})`, matchIds);
    }
    const sph = slotIds.map(() => '?').join(',');
    await execute(`DELETE FROM schedule_slot WHERE id IN (${sph})`, slotIds);

    const scope = play_date ? `${play_date} ` : '';
    res.json(
      ok(
        { slots: slotIds.length, matches: matchIds.length, scored: scored.length },
        `已清除 ${scope}${st} 时段：${slotIds.length} 个槽位、${matchIds.length} 场比赛`
      )
    );
  } catch (e) { next(e); }
});

/**
 * 清理空时间槽（没有比赛、也不是占位的槽）
 * POST /api/schedule/clean-empty
 */
router.post('/clean-empty', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id } = req.body;
    if (!competition_id) return res.json(fail('缺少赛事'));

    const rows = await query(
      `SELECT ss.id FROM schedule_slot ss
       LEFT JOIN match_info m ON m.slot_id = ss.id
       WHERE ss.competition_id = ? AND ss.slot_type = 1 AND m.id IS NULL`,
      [competition_id]
    );

    if (!rows.length) return res.json(ok({ count: 0 }, '没有需要清理的空槽'));

    for (const r of rows) {
      await execute('DELETE FROM schedule_slot WHERE id = ?', [r.id]);
    }
    res.json(ok({ count: rows.length }, `已清理 ${rows.length} 个空槽`));
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

module.exports = router;
