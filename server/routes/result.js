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
    // 学校端只看涉及本校的场次（原来学校账号能看到当天全部场次）
    if (req.user.role === 2) {
      where.push(`(m.team_a_id IN (SELECT id FROM team_entry WHERE school_id = ?)
                 OR m.team_b_id IN (SELECT id FROM team_entry WHERE school_id = ?))`);
      params.push(req.user.school_id, req.user.school_id);
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
 *
 * 【权限调整】按业务要求，成绩统一由**管理员**录入，裁判不再有录分权限。
 * 裁判端「我的赛程」保留为**只读**（能看到自己被指派的场次与比分，但不能改）。
 * 如需恢复裁判录分，把 roleRequired(1) 改回并恢复下面的裁判分支即可。
 */
router.post('/score', roleRequired(1), async (req, res, next) => {
  try {
    const { match_id, score_a, score_b, abandon_a, abandon_b, remark } = req.body;
    if (!match_id) return res.json(fail('缺少场次'));

    const m = await queryOne('SELECT * FROM match_info WHERE id = ?', [match_id]);
    if (!m) return res.json(fail('场次不存在'));

    // 淘汰赛预生成的占位场次，双方还没确定时不能录分
    if (!m.team_a_id || !m.team_b_id) {
      return res.json(fail('该场对阵双方尚未确定（需等上一轮赛果），暂时不能录分'));
    }

    // 淘汰赛不允许平局
    if (m.stage >= 2 && !abandon_a && !abandon_b && Number(score_a) === Number(score_b)) {
      return res.json(fail('淘汰赛不允许平局'));
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
 * PUT /api/result/score/:matchId
 *
 * 【修复】原来这里只 UPDATE 主表，不重写 match_result 明细、不动 abandon 字段，
 * 与 POST /score 的落明细逻辑不一致 —— 改分之后积分明细会和主表对不上，
 * 积分榜显示的还是旧比分。现在统一走同一个落明细函数。
 */
router.put('/score/:matchId', roleRequired(1), async (req, res, next) => {
  try {
    const { score_a, score_b, remark } = req.body;
    const m = await queryOne('SELECT * FROM match_info WHERE id = ?', [req.params.matchId]);
    if (!m) return res.json(fail('场次不存在'));

    const sa = Number(score_a) || 0;
    const sb = Number(score_b) || 0;

    await transaction(async (tx) => {
      await tx.execute(
        'UPDATE match_info SET score_a=?, score_b=?, status=1, remark=? WHERE id=?',
        [sa, sb, remark || null, req.params.matchId]
      );
      // 同步重写明细
      await tx.execute('DELETE FROM match_result WHERE match_id = ?', [req.params.matchId]);
      if (m.team_a_id) {
        await tx.execute(
          'INSERT INTO match_result (match_id, team_entry_id, scored, conceded, is_win, is_draw) VALUES (?,?,?,?,?,?)',
          [req.params.matchId, m.team_a_id, sa, sb, sa > sb ? 1 : 0, sa === sb ? 1 : 0]
        );
      }
      if (m.team_b_id) {
        await tx.execute(
          'INSERT INTO match_result (match_id, team_entry_id, scored, conceded, is_win, is_draw) VALUES (?,?,?,?,?,?)',
          [req.params.matchId, m.team_b_id, sb, sa, sb > sa ? 1 : 0, sa === sb ? 1 : 0]
        );
      }
    });

    // 改分后重算积分榜上的名次（小组赛排名会变）
    try {
      await scheduler.tryAdvanceStage(m.competition_id, m.band_id, m.event_item_id);
    } catch (e) {
      console.error('[改分后重算排名异常]', e.message);
    }

    res.json(ok(null, '已更新'));
  } catch (e) { next(e); }
});

/**
 * 批量录分（管理员统一录分台用）
 * POST /api/result/score-batch
 * { matches: [{ match_id, score_a, score_b, abandon_a?, abandon_b?, remark? }] }
 *
 * 一次提交多场比赛，逐场校验（占位场次不能录、淘汰赛不能平局），
 * 全部成功才写库（事务），避免录一半。
 */
router.post('/score-batch', roleRequired(1), async (req, res, next) => {
  try {
    const { matches } = req.body;
    if (!Array.isArray(matches) || !matches.length) {
      return res.json(fail('没有要提交的比分'));
    }

    const errors = [];
    const prepared = [];

    for (const item of matches) {
      const m = await queryOne('SELECT * FROM match_info WHERE id = ?', [item.match_id]);
      if (!m) { errors.push(`第 ${item.match_id} 场不存在`); continue; }
      if (!m.team_a_id || !m.team_b_id) {
        errors.push(`第 ${m.seq_no} 场对阵双方尚未确定，暂时不能录分`);
        continue;
      }

      const aAbandon = item.abandon_a ? 1 : 0;
      const bAbandon = item.abandon_b ? 1 : 0;
      let sa = Number(item.score_a) || 0;
      let sb = Number(item.score_b) || 0;
      if (aAbandon && !bAbandon) sa = 0;
      if (bAbandon && !aAbandon) sb = 0;
      if (aAbandon && bAbandon) { sa = 0; sb = 0; }

      // 淘汰赛不允许平局
      if (m.stage >= 2 && !aAbandon && !bAbandon && sa === sb) {
        errors.push(`第 ${m.seq_no} 场是淘汰赛，不允许平局`);
        continue;
      }

      prepared.push({ m, sa, sb, aAbandon, bAbandon, remark: item.remark || null });
    }

    if (errors.length) {
      return res.json(fail(`有 ${errors.length} 场未通过校验：${errors.slice(0, 3).join('；')}`));
    }

    await transaction(async (tx) => {
      for (const p of prepared) {
        await tx.execute(
          'UPDATE match_info SET score_a=?, score_b=?, abandon_a=?, abandon_b=?, status=1, remark=? WHERE id=?',
          [p.sa, p.sb, p.aAbandon, p.bAbandon, p.remark, p.m.id]
        );
        await tx.execute('DELETE FROM match_result WHERE match_id = ?', [p.m.id]);
        if (p.m.team_a_id) {
          await tx.execute(
            'INSERT INTO match_result (match_id, team_entry_id, scored, conceded, is_win, is_draw) VALUES (?,?,?,?,?,?)',
            [p.m.id, p.m.team_a_id, p.sa, p.sb, p.sa > p.sb ? 1 : 0, p.sa === p.sb ? 1 : 0]
          );
        }
        if (p.m.team_b_id) {
          await tx.execute(
            'INSERT INTO match_result (match_id, team_entry_id, scored, conceded, is_win, is_draw) VALUES (?,?,?,?,?,?)',
            [p.m.id, p.m.team_b_id, p.sb, p.sa, p.sb > p.sa ? 1 : 0, p.sa === p.sb ? 1 : 0]
          );
        }
      }
    });

    // 触发阶段推进（可能生成下一轮）
    const advanced = [];
    for (const p of prepared) {
      try {
        const r = await scheduler.tryAdvanceStage(p.m.competition_id, p.m.band_id, p.m.event_item_id);
        if (r?.advanced) advanced.push(r);
      } catch (e) {
        console.error('[批量录分后推进异常]', e.message);
      }
    }

    res.json(ok({ count: prepared.length, advanced: advanced.length }, `已提交 ${prepared.length} 场比分`));
  } catch (e) { next(e); }
});

/**
 * 确认成绩（锁定）
 * POST /api/result/confirm
 * { match_ids: [1,2,3] }
 *
 * 球类原来完全没有「确认」环节，录完就直接上大屏/公开页，
 * 裁判可以反复覆盖自己录过的比分。现在补一个与田径一致的确认机制。
 */
router.post('/confirm', roleRequired(1), async (req, res, next) => {
  try {
    const { match_ids } = req.body;
    if (!Array.isArray(match_ids) || !match_ids.length) {
      return res.json(fail('没有要确认的场次'));
    }
    const ids = match_ids.map(Number).filter(Boolean);
    if (!ids.length) return res.json(fail('没有要确认的场次'));

    const marks = ids.map(() => '?').join(',');
    await execute(
      `UPDATE match_info SET confirmed = 1, confirmed_at = NOW() WHERE id IN (${marks}) AND status = 1`,
      ids
    );
    res.json(ok({ count: ids.length }, `已确认 ${ids.length} 场`));
  } catch (e) { next(e); }
});

/**
 * 取消确认
 * POST /api/result/unconfirm
 */
router.post('/unconfirm', roleRequired(1), async (req, res, next) => {
  try {
    const { match_ids } = req.body;
    if (!Array.isArray(match_ids) || !match_ids.length) {
      return res.json(fail('没有要取消确认的场次'));
    }
    const ids = match_ids.map(Number).filter(Boolean);
    const marks = ids.map(() => '?').join(',');
    await execute(
      `UPDATE match_info SET confirmed = 0, confirmed_at = NULL WHERE id IN (${marks})`,
      ids
    );
    res.json(ok({ count: ids.length }, `已取消确认 ${ids.length} 场`));
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
