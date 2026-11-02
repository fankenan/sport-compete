const express = require('express');
const { query, queryOne, execute, transaction, ok, fail } = require('../db');
const { authRequired, roleRequired } = require('../middleware/auth');
const { bandLabel } = require('../utils/helpers');
const scheduler = require('../services/scheduler');

const router = express.Router();
router.use(authRequired);

const STAGE_LABEL = { 1: '小组赛', 2: '八进四', 3: '半决赛', 4: '排位赛', 5: '决赛', 6: '三四名' };

/**
 * 裁判当日赛程
 * GET /api/result/my-schedule
 */
router.get('/my-schedule', async (req, res, next) => {
  try {
    const { date } = req.query;
    const where = ['m.slot_id IS NOT NULL'];
    const params = [];

    if (date) { where.push('ss.play_date = ?'); params.push(date); }
    // 裁判只看指派给自己的
    if (req.user.role === 3) {
      where.push('m.id IN (SELECT match_id FROM match_referee WHERE referee_id = ?)');
      params.push(req.user.referee_id);
    }

    const rows = await query(
      `SELECT m.*, ss.play_date, ss.start_time, ss.end_time, ss.slot_index,
              v.venue_no, v.name AS venue_name,
              ta.team_name AS team_a_name, tb.team_name AS team_b_name,
              sa.name AS school_a, sb.name AS school_b,
              ei.name AS event_name, ei.category,
              gb.stage AS band_stage, gb.gender, gb.label AS band_label
       FROM match_info m
       JOIN schedule_slot ss ON ss.id = m.slot_id
       JOIN venue v ON v.id = ss.venue_id
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
      stage_label: STAGE_LABEL[r.stage],
      start_time: (r.start_time || '').slice(0, 5)
    }))));
  } catch (e) { next(e); }
});

/**
 * 录入比分
 * POST /api/result/score
 */
router.post('/score', async (req, res, next) => {
  try {
    const { match_id, score_a, score_b, abandon_a, abandon_b, remark } = req.body;
    if (!match_id) return res.json(fail('缺少场次'));

    const m = await queryOne('SELECT * FROM match_info WHERE id = ?', [match_id]);
    if (!m) return res.json(fail('场次不存在'));

    // 淘汰赛预生成的占位场次，双方还没确定时不能录分
    if (!m.team_a_id || !m.team_b_id) {
      return res.json(fail('该场对阵双方尚未确定（需等上一轮赛果），暂时不能录分'));
    }

    // 裁判只能录指派给自己的场次
    if (req.user.role === 3) {
      const assigned = await queryOne(
        'SELECT id FROM match_referee WHERE match_id = ? AND referee_id = ?',
        [match_id, req.user.referee_id]
      );
      if (!assigned) return res.json(fail('您未被指派到该场次'));
    }

    const aAbandon = abandon_a ? 1 : 0;
    const bAbandon = abandon_b ? 1 : 0;

    // 弃权：告负方 0 分
    let sa = Number(score_a) || 0;
    let sb = Number(score_b) || 0;
    if (aAbandon && !bAbandon) { sa = 0; }
    if (bAbandon && !aAbandon) { sb = 0; }
    if (aAbandon && bAbandon) { sa = 0; sb = 0; }

    await execute(
      `UPDATE match_info SET score_a=?, score_b=?, abandon_a=?, abandon_b=?, status=1, remark=? WHERE id=?`,
      [sa, sb, aAbandon, bAbandon, remark || null, match_id]
    );

    // 落明细
    await execute('DELETE FROM match_result WHERE match_id = ?', [match_id]);
    if (m.team_a_id) {
      await execute(
        'INSERT INTO match_result (match_id, team_entry_id, scored, conceded, is_win, is_draw) VALUES (?,?,?,?,?,?)',
        [match_id, m.team_a_id, sa, sb, sa > sb ? 1 : 0, sa === sb ? 1 : 0]
      );
    }
    if (m.team_b_id) {
      await execute(
        'INSERT INTO match_result (match_id, team_entry_id, scored, conceded, is_win, is_draw) VALUES (?,?,?,?,?,?)',
        [match_id, m.team_b_id, sb, sa, sb > sa ? 1 : 0, sa === sb ? 1 : 0]
      );
    }

    // 弃权累计检查：2 次弃权则该队全部成绩作废
    let voided = false;
    for (const [teamId, isAbandon] of [[m.team_a_id, aAbandon], [m.team_b_id, bAbandon]]) {
      if (!teamId || !isAbandon) continue;
      const cnt = await queryOne(
        `SELECT COUNT(*) AS c FROM match_info
         WHERE competition_id = ? AND status = 1
           AND ((team_a_id = ? AND abandon_a = 1) OR (team_b_id = ? AND abandon_b = 1))`,
        [m.competition_id, teamId, teamId]
      );
      if (cnt.c >= 2) {
        await execute(
          `UPDATE match_info SET is_void = 1, status = 2
           WHERE competition_id = ? AND ((team_a_id = ? AND abandon_a = 1) OR (team_b_id = ? AND abandon_b = 1))`,
          [m.competition_id, teamId, teamId]
        );
        voided = true;
      }
    }

    // 触发阶段推进
    let advanced = null;
    try {
      advanced = await scheduler.tryAdvanceStage(m.competition_id, m.band_id, m.event_item_id);
    } catch (e) {
      console.error('[阶段推进异常]', e.message);
    }

    res.json(ok({
      voided,
      advanced: advanced?.advanced || false,
      advancedTo: advanced?.to || null
    }, voided ? '比分已录入（该队因 2 次弃权，全部成绩作废）' : '比分已录入'));
  } catch (e) { next(e); }
});

/**
 * 某组别某项目的全部场次与比分
 */
router.get('/matches', async (req, res, next) => {
  try {
    const { competition_id, band_id, event_item_id } = req.query;
    const where = ['m.competition_id = ?'];
    const params = [competition_id];
    if (band_id) { where.push('m.band_id = ?'); params.push(band_id); }
    if (event_item_id) { where.push('m.event_item_id = ?'); params.push(event_item_id); }

    const rows = await query(
      `SELECT m.*, ta.team_name AS team_a_name, tb.team_name AS team_b_name,
              sa.name AS school_a, sb.name AS school_b,
              ei.name AS event_name, gb.stage AS band_stage, gb.gender, gb.label AS band_label
       FROM match_info m
       LEFT JOIN team_entry ta ON ta.id = m.team_a_id
       LEFT JOIN team_entry tb ON tb.id = m.team_b_id
       LEFT JOIN school sa ON sa.id = ta.school_id
       LEFT JOIN school sb ON sb.id = tb.school_id
       JOIN event_item ei ON ei.id = m.event_item_id
       JOIN group_band gb ON gb.id = m.band_id
       WHERE ${where.join(' AND ')}
       ORDER BY m.seq_no`,
      params
    );

    res.json(ok(rows.map((r) => ({
      ...r,
      band_label: bandLabel({ stage: r.band_stage, gender: r.gender, label: r.band_label }),
      stage_label: STAGE_LABEL[r.stage]
    }))));
  } catch (e) { next(e); }
});

/**
 * 修改已录比分
 */
router.put('/score/:matchId', roleRequired(1), async (req, res, next) => {
  try {
    const { score_a, score_b, remark } = req.body;
    await execute(
      'UPDATE match_info SET score_a=?, score_b=?, status=1, remark=? WHERE id=?',
      [Number(score_a) || 0, Number(score_b) || 0, remark || null, req.params.matchId]
    );
    res.json(ok(null, '已更新'));
  } catch (e) { next(e); }
});

/**
 * 标记作废
 */
router.patch('/void/:matchId', roleRequired(1), async (req, res, next) => {
  try {
    await execute('UPDATE match_info SET is_void = 1, status = 2 WHERE id = ?', [req.params.matchId]);
    res.json(ok(null, '已作废'));
  } catch (e) { next(e); }
});

module.exports = router;
