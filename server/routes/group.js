const express = require('express');
const { query, queryOne, execute, ok, fail } = require('../db');
const { authRequired, roleRequired } = require('../middleware/auth');
const { bandLabel } = require('../utils/helpers');
const scheduler = require('../services/scheduler');
const { computeStanding } = require('../services/schedule-algorithms');

const router = express.Router();
router.use(authRequired);

/**
 * 取项目的积分规则（胜/平各多少分）传给积分榜算法
 */
async function pointsOpt(eventItemId) {
  if (!eventItemId) return {};
  const ev = await queryOne(
    'SELECT win_points, draw_points FROM event_item WHERE id = ?', [eventItemId]
  );
  if (!ev) return {};
  return {
    winPts: Number(ev.win_points) || 3,
    drawPts: Number(ev.draw_points) || 0
  };
}

/**
 * 分组预览（不落库，用于抽签前确认）
 * GET /api/group/preview?competition_id=&event_item_id=
 */
router.get('/preview', async (req, res, next) => {
  try {
    const { competition_id, event_item_id } = req.query;
    const event = await queryOne('SELECT * FROM event_item WHERE id = ?', [event_item_id]);
    if (!event) return res.json(fail('项目不存在'));

    const teams = await query(
      `SELECT te.*, s.name AS school_name, gb.stage, gb.gender, gb.label AS band_label
       FROM team_entry te
       JOIN school s ON s.id = te.school_id
       JOIN group_band gb ON gb.id = te.band_id
       WHERE te.competition_id = ? AND te.event_item_id = ? AND te.status = 2
       ORDER BY gb.stage, gb.gender, te.id`,
      [competition_id, event_item_id]
    );

    // 按组别分组统计
    const byBand = new Map();
    teams.forEach((t) => {
      if (!byBand.has(t.band_id)) byBand.set(t.band_id, []);
      byBand.get(t.band_id).push(t);
    });

    const groups = [];
    for (const [bandId, list] of byBand) {
      let groupCount = event.group_count || 0;
      if (groupCount <= 0) {
        if (list.length >= 8) groupCount = 4;
        else if (list.length >= 4) groupCount = 2;
        else groupCount = 1;
      }
      groupCount = Math.min(groupCount, list.length);

      const buckets = Array.from({ length: groupCount }, () => []);
      list.forEach((t, i) => {
        const round = Math.floor(i / groupCount);
        const idx = i % groupCount;
        const g = round % 2 === 0 ? idx : groupCount - 1 - idx;
        buckets[g].push(t);
      });

      buckets.forEach((members, g) => {
        groups.push({
          band_id: bandId,
          band_label: bandLabel(list[0]),
          group_letter: 'ABCDEFGH'[g],
          team_count: members.length,
          rounds: members.length > 1 ? members.length - 1 : 0,
          teams: members.map((t) => ({ id: t.id, name: t.team_name, school: t.school_name }))
        });
      });
    }

    res.json(ok({
      groups,
      pairing_rule: event.pairing_rule,
      advance_count: event.advance_count,
      has_third_place: event.has_third_place
    }));
  } catch (e) { next(e); }
});

/**
 * 执行分组
 * POST /api/group/generate
 */
router.post('/generate', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, event_item_id } = req.body;
    const result = await scheduler.generateGroups(competition_id, event_item_id);
    res.json(ok(result, `已生成 ${result.length} 个小组`));
  } catch (e) { next(e); }
});

/**
 * 已生成的分组
 */
router.get('/list', async (req, res, next) => {
  try {
    const { competition_id, event_item_id } = req.query;
    const groups = await query(
      `SELECT hg.*, gb.stage, gb.gender, gb.label AS band_label
       FROM heat_group hg JOIN group_band gb ON gb.id = hg.band_id
       WHERE hg.competition_id = ? ${event_item_id ? 'AND hg.event_item_id = ?' : ''}
       ORDER BY gb.stage, gb.gender, hg.sort_no`,
      event_item_id ? [competition_id, event_item_id] : [competition_id]
    );

    // 附上成员
    for (const g of groups) {
      const members = await query(
        `SELECT hm.id, hm.seed_no, te.id AS team_id, te.team_name, s.name AS school_name
         FROM heat_member hm
         JOIN team_entry te ON te.id = hm.team_entry_id
         JOIN school s ON s.id = te.school_id
         WHERE hm.heat_group_id = ? ORDER BY hm.seed_no`,
        [g.id]
      );
      g.members = members;
      g.band_label = bandLabel(g);
    }
    res.json(ok(groups));
  } catch (e) { next(e); }
});

/**
 * 调整组内队伍顺序（手动微调）
 */
router.put('/member/:id', roleRequired(1), async (req, res, next) => {
  try {
    const { seed_no } = req.body;
    await execute('UPDATE heat_member SET seed_no = ? WHERE id = ?', [seed_no, req.params.id]);
    res.json(ok(null, '已调整'));
  } catch (e) { next(e); }
});

/**
 * 生成小组循环赛程
 */
router.post('/generate-matches', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, event_item_id } = req.body;
    const result = await scheduler.generateGroupMatches(competition_id, event_item_id);
    res.json(ok(result, `已生成 ${result.count} 场小组赛`));
  } catch (e) { next(e); }
});

/**
 * 生成联赛/循环赛赛程（不分组，全部大循环）
 * POST /api/group/generate-league
 */
router.post('/generate-league', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, event_item_id } = req.body;
    const result = await scheduler.generateLeagueMatches(competition_id, event_item_id);
    res.json(ok(result, `已生成 ${result.count} 场循环赛`));
  } catch (e) { next(e); }
});

/**
 * 积分榜
 * GET /api/group/standing?competition_id=&band_id=&event_item_id=&group_letter=
 */
router.get('/standing', async (req, res, next) => {
  try {
    const { competition_id, band_id, event_item_id, group_letter } = req.query;

    const where = ['m.competition_id = ?', 'm.status = 1'];
    const params = [competition_id];
    if (band_id) { where.push('m.band_id = ?'); params.push(band_id); }
    if (event_item_id) { where.push('m.event_item_id = ?'); params.push(event_item_id); }
    if (group_letter) { where.push('hg.group_letter = ?'); params.push(group_letter); }

    const matches = await query(
      `SELECT m.* FROM match_info m
       LEFT JOIN heat_group hg ON hg.id = m.heat_group_id
       WHERE ${where.join(' AND ')}`,
      params
    );

    // 收集涉及的队伍
    const teamIds = new Set();
    matches.forEach((m) => {
      if (m.team_a_id) teamIds.add(m.team_a_id);
      if (m.team_b_id) teamIds.add(m.team_b_id);
    });

    if (teamIds.size === 0) return res.json(ok([]));

    const standing = computeStanding([...teamIds], matches, await pointsOpt(event_item_id));

    // 补队伍名
    const teams = await query(
      `SELECT te.id, te.team_name, s.name AS school_name FROM team_entry te
       JOIN school s ON s.id = te.school_id WHERE te.id IN (${[...teamIds].map(() => '?').join(',')})`,
      [...teamIds]
    );
    const map = new Map(teams.map((t) => [t.id, t]));

    res.json(ok(standing.map((s) => ({ ...s, ...map.get(s.id) }))));
  } catch (e) { next(e); }
});

/**
 * 单组积分榜（含分组信息）
 */
router.get('/group-standing', async (req, res, next) => {
  try {
    const { competition_id, band_id, event_item_id } = req.query;
    const groups = await query(
      `SELECT hg.*, gb.stage, gb.gender, gb.label AS band_label
       FROM heat_group hg JOIN group_band gb ON gb.id = hg.band_id
       WHERE hg.competition_id = ? AND hg.band_id = ? AND hg.event_item_id = ?
       ORDER BY hg.sort_no`,
      [competition_id, band_id, event_item_id]
    );

    const result = [];
    for (const g of groups) {
      const members = await query(
        'SELECT team_entry_id FROM heat_member WHERE heat_group_id = ?',
        [g.id]
      );
      const matches = await query(
        'SELECT * FROM match_info WHERE heat_group_id = ? AND status = 1',
        [g.id]
      );
      const standing = computeStanding(
        members.map((m) => m.team_entry_id), matches, await pointsOpt(event_item_id)
      );

      const teams = await query(
        `SELECT te.id, te.team_name, s.name AS school_name FROM team_entry te
         JOIN school s ON s.id = te.school_id
         WHERE te.id IN (${members.map(() => '?').join(',')})`,
        members.map((m) => m.team_entry_id)
      );
      const map = new Map(teams.map((t) => [t.id, t]));

      result.push({
        ...g,
        band_label: bandLabel(g),
        standing: standing.map((s) => ({ ...s, ...map.get(s.id) }))
      });
    }
    res.json(ok(result));
  } catch (e) { next(e); }
});

/**
 * 径赛分组生成（已移除）
 *
 * ⚠️ 2026-11-03：直接返回错误，**不再执行**。
 *
 * 原来这个端点把分组写进 heat_group / heat_member（旧表），
 * 而成绩录入页读的是 track_heat / heat_entry（新表），两边互不可见 ——
 * 用户点「已生成」，数据却进了黑洞。
 * 「打日志后照常执行」是最坏的处理方式：既堵不住黑洞，又留下误导性成功提示。
 *
 * 现在正确入口：POST /api/track-result/group-arrange
 * 前端：田径项目 → 分组编排（/track-arrange）
 */
router.post('/track-generate', roleRequired(1), async (req, res, next) => {
  return res.json(fail(
    '径赛分组已统一到「田径分组编排」。请到「田径项目 → 分组编排」操作。' +
    '（旧端点写入的分组在成绩录入页不可见，已停止执行）',
    410
  ));
});

module.exports = router;
