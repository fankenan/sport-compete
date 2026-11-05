/**
 * 武术项目 —— 编排与评分
 *
 * 武术是**评分制 / 名次制**，与球类（输赢淘汰）、田径（时间/距离）都不同：
 *   报名审核(team_entry) → 编排出场顺序 → 各裁判打分 → 去极值算分 → 排名 → 确认
 *
 * 端点前缀：/api/martial
 */
const express = require('express');
const { query, queryOne, execute, transaction, ok, fail } = require('../db');
const { authRequired, roleRequired } = require('../middleware/auth');
const { bandLabel } = require('../utils/helpers');
const martialScore = require('../services/martialScore');

const router = express.Router();
router.use(authRequired);

const ROUND_NAME = { PRELIM: '预赛', SEMI: '复赛', FINAL: '决赛' };

/** 取项目的武术参数 */
async function eventOptions(eventItemId) {
  const ev = await queryOne(
    `SELECT id, name, martial_judge_count, martial_drop_highest, martial_minutes
       FROM event_item WHERE id = ?`, [eventItemId]
  );
  return {
    judgeCount: Number(ev?.martial_judge_count) || martialScore.DEFAULT_JUDGES,
    dropHighest: Number(ev?.martial_drop_highest) === 0 ? 0 : 1,
    minutes: Number(ev?.martial_minutes) || 90
  };
}

/** 算分 + 排名（一次算完所有 entry） */
function scoreAndRank(entries, opts) {
  const scored = entries.map((e) => {
    let scores = e.scores_json;
    if (typeof scores === 'string') {
      try { scores = JSON.parse(scores); } catch (err) { scores = []; }
    }
    const r = martialScore.computeScore(scores || [], opts);
    return { ...e, scores: scores || [], ...r };
  });

  const rankMap = martialScore.rankEntries(scored);
  for (const e of scored) {
    e.rank_no = rankMap.get(e.id) ?? null;
  }
  return scored;
}

/* ============================================================
   一、列表与编排
   ============================================================ */

/**
 * GET /api/martial/heats?competition_id=&event_item_id=&band_id=&round_code=
 * 武术赛次分组列表（含参赛单位与成绩）
 */
router.get('/heats', async (req, res, next) => {
  try {
    const { competition_id, event_item_id, band_id, round_code } = req.query;
    if (!competition_id) return res.json(fail('缺少赛事参数'));

    const where = ['h.competition_id = ?'];
    const params = [competition_id];
    if (event_item_id) { where.push('h.event_item_id = ?'); params.push(event_item_id); }
    if (band_id) { where.push('h.band_id = ?'); params.push(band_id); }
    if (round_code) { where.push('h.round_code = ?'); params.push(round_code); }

    const heats = await query(
      `SELECT h.*, ei.name AS event_name, ei.martial_judge_count, ei.martial_drop_highest,
              gb.label AS band_label, gb.stage AS band_stage, gb.gender,
              v.name AS venue_name
         FROM martial_heat h
         JOIN event_item ei ON ei.id = h.event_item_id
         JOIN group_band gb ON gb.id = h.band_id
         LEFT JOIN venue v ON v.id = h.venue_id
        WHERE ${where.join(' AND ')}
        ORDER BY ei.sort_no, ei.id, h.band_id, h.round_no, h.heat_no`,
      params
    );

    const out = [];
    for (const h of heats) {
      const entries = await query(
        `SELECT e.*, s.name AS school_name
           FROM martial_entry e
           LEFT JOIN school s ON s.id = e.school_id
          WHERE e.heat_id = ?
          ORDER BY e.order_no, e.id`,
        [h.id]
      );
      const opts = {
        judgeCount: Number(h.martial_judge_count) || martialScore.DEFAULT_JUDGES,
        dropHighest: Number(h.martial_drop_highest) === 0 ? 0 : 1
      };
      const scored = scoreAndRank(entries, opts);
      out.push({
        ...h,
        band_label: bandLabel({ stage: h.band_stage, gender: h.gender, label: h.band_label }),
        round_name: ROUND_NAME[h.round_code] || h.round_code,
        judge_count: opts.judgeCount,
        drop_highest: opts.dropHighest,
        entries: scored.map((e) => ({
          id: e.id,
          school_id: e.school_id,
          school_name: e.school_name,
          team_name: e.team_name,
          leader_name: e.leader_name,
          order_no: e.order_no,
          scores: e.scores,
          total_score: e.total_score,
          score_detail: e.detail,
          rank_no: e.rank_no,
          remark: e.remark,
          reason: e.reason
        }))
      });
    }

    res.json(ok(out));
  } catch (e) { next(e); }
});

/**
 * POST /api/martial/arrange
 * body: { competition_id, event_item_id, band_id, round_code, heat_size?, judge_count? }
 *
 * 从已审核通过的报名（team_entry）生成出场顺序。
 * 按报名顺序排（同组别同项目一校一队），可按人数分批。
 */
router.post('/arrange', roleRequired(1), async (req, res, next) => {
  try {
    const {
      competition_id, event_item_id, band_id,
      round_code = 'FINAL', heat_size, judge_count
    } = req.body;
    if (!competition_id || !event_item_id || !band_id) {
      return res.json(fail('参数不完整'));
    }

    const opts = await eventOptions(eventItemId);
    const judges = Number(judge_count) || opts.judgeCount;
    const size = Number(heat_size) || 0;   // 0 = 全部一组

    // 已审核通过的参赛队
    const teams = await query(
      `SELECT te.id, te.team_name, te.school_id, te.leader_name, s.name AS school_name
         FROM team_entry te
         LEFT JOIN school s ON s.id = te.school_id
        WHERE te.competition_id = ? AND te.event_item_id = ? AND te.band_id = ?
          AND te.status = 2
        ORDER BY te.seed_no, te.id`,
      [competition_id, event_item_id, band_id]
    );
    if (!teams.length) {
      return res.json(fail('该项目该组别没有已审核通过的参赛队（请先在「报名管理」审核）'));
    }

    // 分批
    const perHeat = size > 0 ? size : teams.length;
    const groups = [];
    for (let i = 0; i < teams.length; i += perHeat) {
      groups.push(teams.slice(i, i + perHeat));
    }

    const roundNo = { PRELIM: 1, SEMI: 2, FINAL: 3 }[round_code] || 1;

    await transaction(async (tx) => {
      // 清掉本轮旧编排
      const old = await tx.query(
        'SELECT id FROM martial_heat WHERE competition_id=? AND band_id=? AND event_item_id=? AND round_code=?',
        [competition_id, band_id, event_item_id, round_code]
      );
      for (const h of old) {
        await tx.execute('DELETE FROM martial_entry WHERE heat_id = ?', [h.id]);
        await tx.execute('DELETE FROM martial_heat WHERE id = ?', [h.id]);
      }

      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        const heatNo = gi + 1;
        const hr = await tx.execute(
          `INSERT INTO martial_heat
             (competition_id, band_id, event_item_id, round_code, round_no, heat_no, heat_name,
              entry_count, judge_count, status)
           VALUES (?,?,?,?,?,?,?,?,?,2)`,
          [competition_id, band_id, event_item_id, round_code, roundNo, heatNo,
           `${ROUND_NAME[round_code] || ''}第${heatNo}组`, g.length, judges]
        );
        const heatId = hr.insertId;

        for (let oi = 0; oi < g.length; oi++) {
          const t = g[oi];
          await tx.execute(
            `INSERT INTO martial_entry
               (heat_id, competition_id, band_id, event_item_id, school_id, team_name,
                leader_name, order_no)
             VALUES (?,?,?,?,?,?,?,?)`,
            [heatId, competition_id, band_id, event_item_id, t.school_id,
             t.team_name || t.school_name, t.leader_name || null, oi + 1]
          );
        }
      }
    });

    res.json(ok({
      heats: groups.length,
      entries: teams.length,
      judge_count: judges
    }, `已编排 ${groups.length} 组、${teams.length} 支参赛队`));
  } catch (e) { next(e); }
});

/**
 * PUT /api/martial/entry/:id/order
 * body: { order_no }
 * 调整出场顺序
 */
router.put('/entry/:id/order', roleRequired(1), async (req, res, next) => {
  try {
    const { order_no } = req.body;
    if (order_no === undefined) return res.json(fail('缺少出场顺序'));
    await execute(
      'UPDATE martial_entry SET order_no = ? WHERE id = ?',
      [Number(order_no) || 0, req.params.id]
    );
    res.json(ok(null, '已调整'));
  } catch (e) { next(e); }
});

/* ============================================================
   二、评分
   ============================================================ */

/**
 * PUT /api/martial/entry/:id/scores
 * body: { scores: [{ judge: '张三', score: 9.5 }] }
 *
 * 保存各裁判打分并立即算分、排名。
 */
router.put('/entry/:id/scores', roleRequired(1), async (req, res, next) => {
  try {
    const { scores } = req.body;
    const entry = await queryOne(
      'SELECT e.*, h.event_item_id FROM martial_entry e JOIN martial_heat h ON h.id = e.heat_id WHERE e.id = ?',
      [req.params.id]
    );
    if (!entry) return res.json(fail('参赛单位不存在'));

    const opts = await eventOptions(entry.event_item_id);
    const arr = Array.isArray(scores) ? scores : [];

    const check = martialScore.validateScores(arr, { judgeCount: opts.judgeCount });
    if (!check.ok) {
      return res.json(fail(check.issues.join('；')));
    }

    const r = martialScore.computeScore(arr, opts);
    await execute(
      'UPDATE martial_entry SET scores_json = ?, total_score = ?, score_detail = ? WHERE id = ?',
      [JSON.stringify(arr), r.total, r.detail, entry.id]
    );

    // 重算本组排名
    const siblings = await query(
      'SELECT id, total_score, order_no FROM martial_entry WHERE heat_id = ?',
      [entry.heat_id]
    );
    const rankMap = martialScore.rankEntries(siblings);
    for (const s of siblings) {
      await execute(
        'UPDATE martial_entry SET rank_no = ? WHERE id = ?',
        [rankMap.get(s.id) ?? null, s.id]
      );
    }

    res.json(ok({
      total_score: r.total,
      score_detail: r.detail,
      rank_no: rankMap.get(entry.id) ?? null,
      dropped: r.dropped
    }, r.total === null ? '打分已保存（尚未计分）' : `已保存，得分 ${r.detail}`));
  } catch (e) { next(e); }
});

/**
 * POST /api/martial/heat/:id/confirm
 * 确认本组成绩
 */
router.post('/heat/:id/confirm', roleRequired(1), async (req, res, next) => {
  try {
    const heat = await queryOne('SELECT * FROM martial_heat WHERE id = ?', [req.params.id]);
    if (!heat) return res.json(fail('赛次不存在'));

    const entries = await query(
      'SELECT id, total_score, order_no FROM martial_entry WHERE heat_id = ?', [req.params.id]
    );
    const unscored = entries.filter((e) => e.total_score === null);
    if (unscored.length) {
      return res.json(fail(`还有 ${unscored.length} 支参赛队未评分，不能确认`));
    }

    await execute(
      'UPDATE martial_heat SET confirm_flag = 1, status = 4, confirmed_at = NOW(), confirmed_by = ? WHERE id = ?',
      [req.user.real_name || req.user.username, req.params.id]
    );
    res.json(ok(null, '成绩已确认'));
  } catch (e) { next(e); }
});

/**
 * POST /api/martial/heat/:id/revoke
 * 撤销确认
 */
router.post('/heat/:id/revoke', roleRequired(1), async (req, res, next) => {
  try {
    await execute(
      'UPDATE martial_heat SET confirm_flag = 0, status = 3, confirmed_at = NULL, confirmed_by = NULL WHERE id = ?',
      [req.params.id]
    );
    res.json(ok(null, '已撤销确认'));
  } catch (e) { next(e); }
});

/* ============================================================
   三、排名与日程
   ============================================================ */

/**
 * GET /api/martial/standing?competition_id=&event_item_id=&band_id=
 * 各组最终排名（已确认优先）
 */
router.get('/standing', async (req, res, next) => {
  try {
    const { competition_id, event_item_id, band_id } = req.query;
    if (!competition_id) return res.json(fail('缺少赛事参数'));

    const where = ['h.competition_id = ?'];
    const params = [competition_id];
    if (event_item_id) { where.push('h.event_item_id = ?'); params.push(event_item_id); }
    if (band_id) { where.push('h.band_id = ?'); params.push(band_id); }

    const heats = await query(
      `SELECT h.*, ei.name AS event_name, ei.martial_judge_count, ei.martial_drop_highest,
              gb.label AS band_label, gb.stage AS band_stage, gb.gender
         FROM martial_heat h
         JOIN event_item ei ON ei.id = h.event_item_id
         JOIN group_band gb ON gb.id = h.band_id
        WHERE ${where.join(' AND ')}
        ORDER BY ei.sort_no, ei.id, h.band_id, h.round_no, h.heat_no`,
      params
    );

    const out = [];
    for (const h of heats) {
      const entries = await query(
        `SELECT e.*, s.name AS school_name FROM martial_entry e
           LEFT JOIN school s ON s.id = e.school_id
          WHERE e.heat_id = ? ORDER BY e.order_no, e.id`,
        [h.id]
      );
      const opts = {
        judgeCount: Number(h.martial_judge_count) || martialScore.DEFAULT_JUDGES,
        dropHighest: Number(h.martial_drop_highest) === 0 ? 0 : 1
      };
      const scored = scoreAndRank(entries, opts);
      out.push({
        id: h.id,
        band_id: h.band_id,
        band_label: bandLabel({ stage: h.band_stage, gender: h.gender, label: h.band_label }),
        event_item_id: h.event_item_id,
        event_name: h.event_name,
        round_code: h.round_code,
        round_name: ROUND_NAME[h.round_code] || h.round_code,
        heat_no: h.heat_no,
        heat_name: h.heat_name,
        confirm_flag: h.confirm_flag,
        rows: scored.map((e) => ({
          rank_no: e.rank_no,
          team_name: e.team_name,
          school_name: e.school_name,
          order_no: e.order_no,
          total_score: e.total_score,
          score_detail: e.detail
        }))
      });
    }
    res.json(ok(out));
  } catch (e) { next(e); }
});

/**
 * GET /api/martial/schedule?competition_id=&band_id=&event_item_id=
 * 武术赛程（供编排中心 / 公开页）
 */
router.get('/schedule', async (req, res, next) => {
  try {
    const { competition_id, band_id, event_item_id } = req.query;
    if (!competition_id) return res.json(fail('缺少赛事参数'));

    const where = ['h.competition_id = ?'];
    const params = [competition_id];
    if (band_id) { where.push('h.band_id = ?'); params.push(band_id); }
    if (event_item_id) { where.push('h.event_item_id = ?'); params.push(event_item_id); }

    const rows = await query(
      `SELECT h.id, h.round_code, h.round_no, h.heat_no, h.heat_name, h.entry_count,
              h.plan_date, h.plan_time, h.status, h.confirm_flag,
              ei.name AS event_name, ei.category, gb.label AS band_label,
              v.name AS venue_name
         FROM martial_heat h
         JOIN event_item ei ON ei.id = h.event_item_id
         JOIN group_band gb ON gb.id = h.band_id
         LEFT JOIN venue v ON v.id = h.venue_id
        WHERE ${where.join(' AND ')}
        ORDER BY h.plan_date, h.plan_time, h.id`,
      params
    );

    res.json(ok(rows.map((r) => ({
      id: r.id,
      round_code: r.round_code,
      round_name: ROUND_NAME[r.round_code] || r.round_code,
      heat_no: r.heat_no,
      heat_name: r.heat_name,
      entry_count: r.entry_count,
      date: r.plan_date,
      time: r.plan_time ? String(r.plan_time).slice(0, 5) : null,
      venue: r.venue_name || '',
      event_name: r.event_name,
      band_label: r.band_label || '',
      confirm_flag: r.confirm_flag
    }))));
  } catch (e) { next(e); }
});

/**
 * GET /api/martial/overview?competition_id=
 * 武术编排总览（给「编排中心」用）
 */
router.get('/overview', async (req, res, next) => {
  try {
    const { competition_id } = req.query;
    if (!competition_id) return res.json(fail('缺少赛事参数'));

    const events = await query(
      `SELECT id, name, category FROM event_item
        WHERE competition_id = ? AND category = 4
        ORDER BY sort_no, id`,
      [competition_id]
    );

    const items = [];
    for (const ev of events) {
      const heats = await queryOne(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN confirm_flag = 1 THEN 1 ELSE 0 END) AS confirmed
           FROM martial_heat WHERE competition_id = ? AND event_item_id = ?`,
        [competition_id, ev.id]
      );
      // 已审核通过的参赛队数
      const teams = await queryOne(
        `SELECT COUNT(*) AS c FROM team_entry
          WHERE competition_id = ? AND event_item_id = ? AND status = 2`,
        [competition_id, ev.id]
      );
      // 已编排参赛单位数
      const entries = await queryOne(
        `SELECT COUNT(*) AS c FROM martial_entry
          WHERE competition_id = ? AND event_item_id = ?`,
        [competition_id, ev.id]
      );

      const total = Number(heats?.total || 0);
      const confirmed = Number(heats?.confirmed || 0);
      const teamCount = Number(teams?.c || 0);
      const entryCount = Number(entries?.c || 0);

      let state = 'todo';
      let stateLabel = '未开始';
      if (!teamCount) { state = 'todo'; stateLabel = '待报名'; }
      else if (!total) { state = 'doing'; stateLabel = '待编排'; }
      else if (confirmed < total) { state = 'doing'; stateLabel = '评分中'; }
      else { state = 'done'; stateLabel = '已完成'; }

      items.push({
        event_item_id: ev.id,
        event_name: ev.name,
        category: ev.category,
        teams: teamCount,
        heats: total,
        confirmed,
        scheduled: confirmed,
        unplaced: Math.max(0, total - confirmed),
        entries: entryCount,
        state,
        state_label: stateLabel
      });
    }

    res.json(ok({
      total: items.length,
      items,
      teams: items.reduce((s, x) => s + x.teams, 0),
      heats: items.reduce((s, x) => s + x.heats, 0)
    }));
  } catch (e) { next(e); }
});

module.exports = router;
