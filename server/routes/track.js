const express = require('express');
const { query, queryOne, execute, ok, fail } = require('../db');
const { authRequired, roleRequired } = require('../middleware/auth');
const scoreEngine = require('../services/scoreEngine');

const router = express.Router();
router.use(authRequired);

/**
 * GET /api/track/overview?competition_id=
 * 田径编排总览（给「编排中心」用）
 *
 * 一次性给出田径赛事的编排进度，让管理员在一个页面看清：
 *   报名 → 分组编排（赛次） → 日程编排（排进日期/场地/时刻） → 录分 → 统计
 *
 * 【为什么需要】原来编排中心只统计球类（filter category === 3），
 * 田径完全不在编排流程里 —— 管理员要自己判断"田径编排到哪一步了"。
 */
router.get('/overview', async (req, res, next) => {
  try {
    const { competition_id } = req.query;
    if (!competition_id) return res.json(fail('缺少赛事参数'));

    // 田径项目（径赛 + 田赛）
    const events = await query(
      `SELECT id, name, category, event_type FROM event_item
        WHERE competition_id = ? AND category IN (1, 2)
        ORDER BY sort_no, id`,
      [competition_id]
    );

    const items = [];
    for (const ev of events) {
      // 已通过报名人数
      const enr = await queryOne(
        `SELECT COUNT(*) AS c FROM athlete_entry
          WHERE competition_id = ? AND event_item_id = ? AND status = 2`,
        [competition_id, ev.id]
      );

      // 赛次分组数 / 已录分赛次数 / 已确认赛次数
      const heats = await queryOne(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN h.status >= 3 THEN 1 ELSE 0 END) AS scoring,
                SUM(CASE WHEN h.confirm_flag = 1 THEN 1 ELSE 0 END) AS confirmed
           FROM track_heat h
          WHERE h.competition_id = ? AND h.event_item_id = ?`,
        [competition_id, ev.id]
      );

      // 已排进日程的赛次数
      const planned = await queryOne(
        `SELECT COUNT(DISTINCT ti.heat_id) AS c
           FROM timetable_item ti
           JOIN track_heat h ON h.id = ti.heat_id
          WHERE ti.competition_id = ? AND h.event_item_id = ?`,
        [competition_id, ev.id]
      );

      const total = Number(heats?.total || 0);
      const scheduled = Number(planned?.c || 0);

      let state = 'todo';
      let stateLabel = '未开始';
      if (!Number(enr?.c || 0)) { state = 'todo'; stateLabel = '待报名'; }
      else if (!total) { state = 'doing'; stateLabel = '待分组编排'; }
      else if (scheduled < total) { state = 'doing'; stateLabel = '待排期'; }
      else { state = 'done'; stateLabel = '已排期'; }

      items.push({
        event_item_id: ev.id,
        event_name: ev.name,
        category: ev.category,
        event_type: ev.event_type,
        athletes: Number(enr?.c || 0),
        heats: total,
        scoring: Number(heats?.scoring || 0),
        confirmed: Number(heats?.confirmed || 0),
        scheduled,
        unplaced: Math.max(0, total - scheduled),
        state,
        state_label: stateLabel
      });
    }

    // 日程单元（比赛日）概况
    const units = await queryOne(
      'SELECT COUNT(*) AS c FROM schedule_unit WHERE competition_id = ?',
      [competition_id]
    );

    res.json(ok({
      total: items.length,
      items,
      units: Number(units?.c || 0),
      heats: items.reduce((s, x) => s + x.heats, 0),
      scheduled: items.reduce((s, x) => s + x.scheduled, 0),
      athletes: items.reduce((s, x) => s + x.athletes, 0)
    }));
  } catch (e) { next(e); }
});

// ============================================================
// 一、项目模板库
// ============================================================

/**
 * GET /api/track/templates?event_type=&category=&gender=&scope=
 * scope: system 内置 / custom 自定义 / public 公共库 / all
 */
router.get('/templates', async (req, res, next) => {
  try {
    const { event_type, category, gender, scope, keyword } = req.query;
    let where = ['status = 1'];
    const p = [];
    if (event_type) { where.push('event_type = ?'); p.push(event_type); }
    if (category) { where.push('category = ?'); p.push(category); }
    if (gender) { where.push('(gender = ? OR gender = \'A\')'); p.push(gender); }
    if (scope === 'system') where.push("owner_scope = 'SYSTEM'");
    if (scope === 'custom') where.push("owner_scope = 'CUSTOM'");
    if (scope === 'public') where.push('public_flag = 1');
    if (keyword) { where.push('template_name LIKE ?'); p.push('%' + keyword + '%'); }

    const rows = await query(
      `SELECT * FROM event_template
        WHERE ${where.join(' AND ')}
        ORDER BY event_type, category, sort_no, id`, p
    );
    // 父模板在前，子项挂后面
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/** GET /api/track/templates/:id 含子项 */
router.get('/templates/:id', async (req, res, next) => {
  try {
    const t = await queryOne('SELECT * FROM event_template WHERE id = ?', [req.params.id]);
    if (!t) return res.json(fail('模板不存在'));
    const children = await query(
      'SELECT * FROM event_template WHERE combined_parent_id = ? ORDER BY combined_item_order, id',
      [req.params.id]
    );
    res.json(ok({ ...t, children }));
  } catch (e) { next(e); }
});

/** POST /api/track/templates 新建自定义模板 */
router.post('/templates', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.template_name) return res.json(fail('请填写项目名称'));
    const r = await execute(
      `INSERT INTO event_template
        (template_name, event_type, category, gender, result_entry_type, event_unit,
         is_higher_better, result_min_value, result_max_value, result_decimal_places,
         need_lane_order, relay_leg_count, has_preliminary, admission_count,
         base_attempt_count, extra_attempt_count, extra_qualifier_count,
         result_aggregation_mode, scoring_scheme, scoring_scheme_custom,
         team_score_multiplier, estimated_unit_minutes,
         combined_parent_id, combined_item_order,
         built_in_flag, public_flag, owner_scope, created_by, sort_no, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?, 'CUSTOM', ?, ?, 1)`,
      [b.template_name, b.event_type || 'TRACK', b.category || 1, b.gender || 'A',
       b.result_entry_type || 'TIME', b.event_unit || null,
       b.is_higher_better ? 1 : 0, b.result_min_value ?? null, b.result_max_value ?? null,
       b.result_decimal_places ?? 2,
       b.need_lane_order ?? 1, b.relay_leg_count ?? 4, b.has_preliminary ? 1 : 0,
       b.admission_count ?? null,
       b.base_attempt_count ?? 3, b.extra_attempt_count ?? 3, b.extra_qualifier_count ?? null,
       b.result_aggregation_mode || 'BEST', b.scoring_scheme || null, b.scoring_scheme_custom || null,
       b.team_score_multiplier ?? 1, b.estimated_unit_minutes ?? null,
       b.combined_parent_id || null, b.combined_item_order ?? null,
       b.public_flag ? 1 : 0, req.user.id, b.sort_no || 0]
    );
    res.json(ok({ id: r.insertId }, '模板已创建'));
  } catch (e) { next(e); }
});

/** PUT /api/track/templates/:id 修改（内置模板不允许改） */
router.put('/templates/:id', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    const t = await queryOne('SELECT * FROM event_template WHERE id = ?', [req.params.id]);
    if (!t) return res.json(fail('模板不存在'));
    if (Number(t.built_in_flag) === 1) return res.json(fail('内置模板不可修改，请先另存为自定义模板'));

    await execute(
      `UPDATE event_template SET template_name=?, event_type=?, category=?, gender=?,
        result_entry_type=?, event_unit=?, is_higher_better=?, result_min_value=?, result_max_value=?,
        result_decimal_places=?, need_lane_order=?, relay_leg_count=?, has_preliminary=?,
        admission_count=?, base_attempt_count=?, extra_attempt_count=?, extra_qualifier_count=?,
        result_aggregation_mode=?, scoring_scheme=?, scoring_scheme_custom=?,
        team_score_multiplier=?, estimated_unit_minutes=?, combined_parent_id=?,
        combined_item_order=?, public_flag=?, sort_no=?
       WHERE id=?`,
      [b.template_name ?? t.template_name, b.event_type ?? t.event_type, b.category ?? t.category,
       b.gender ?? t.gender, b.result_entry_type ?? t.result_entry_type, b.event_unit ?? t.event_unit,
       b.is_higher_better ?? t.is_higher_better, b.result_min_value ?? t.result_min_value,
       b.result_max_value ?? t.result_max_value, b.result_decimal_places ?? t.result_decimal_places,
       b.need_lane_order ?? t.need_lane_order, b.relay_leg_count ?? t.relay_leg_count,
       b.has_preliminary ?? t.has_preliminary, b.admission_count ?? t.admission_count,
       b.base_attempt_count ?? t.base_attempt_count, b.extra_attempt_count ?? t.extra_attempt_count,
       b.extra_qualifier_count ?? t.extra_qualifier_count,
       b.result_aggregation_mode ?? t.result_aggregation_mode, b.scoring_scheme ?? t.scoring_scheme,
       b.scoring_scheme_custom ?? t.scoring_scheme_custom,
       b.team_score_multiplier ?? t.team_score_multiplier,
       b.estimated_unit_minutes ?? t.estimated_unit_minutes,
       b.combined_parent_id ?? t.combined_parent_id, b.combined_item_order ?? t.combined_item_order,
       b.public_flag ?? t.public_flag, b.sort_no ?? t.sort_no, req.params.id]
    );
    res.json(ok(null, '已保存'));
  } catch (e) { next(e); }
});

/** DELETE /api/track/templates/:id */
router.delete('/templates/:id', roleRequired(1), async (req, res, next) => {
  try {
    const t = await queryOne('SELECT * FROM event_template WHERE id = ?', [req.params.id]);
    if (!t) return res.json(fail('模板不存在'));
    if (Number(t.built_in_flag) === 1) return res.json(fail('内置模板不可删除'));
    await execute('UPDATE event_template SET status = 0 WHERE id = ? OR combined_parent_id = ?',
      [req.params.id, req.params.id]);
    res.json(ok(null, '已删除'));
  } catch (e) { next(e); }
});

/** POST /api/track/templates/:id/copy-to-public 复制到公共库 */
router.post('/templates/:id/copy-to-public', roleRequired(1), async (req, res, next) => {
  try {
    const t = await queryOne('SELECT * FROM event_template WHERE id = ?', [req.params.id]);
    if (!t) return res.json(fail('模板不存在'));
    const r = await execute(
      `INSERT INTO event_template
        (template_name, event_type, category, gender, result_entry_type, event_unit,
         is_higher_better, result_min_value, result_max_value, result_decimal_places,
         need_lane_order, relay_leg_count, has_preliminary, admission_count,
         base_attempt_count, extra_attempt_count, extra_qualifier_count,
         result_aggregation_mode, scoring_scheme, scoring_scheme_custom,
         team_score_multiplier, estimated_unit_minutes, combined_item_order,
         built_in_flag, public_flag, owner_scope, created_by, sort_no, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,1,'CUSTOM',?,?,1)`,
      [t.template_name, t.event_type, t.category, t.gender, t.result_entry_type, t.event_unit,
       t.is_higher_better, t.result_min_value, t.result_max_value, t.result_decimal_places,
       t.need_lane_order, t.relay_leg_count, t.has_preliminary, t.admission_count,
       t.base_attempt_count, t.extra_attempt_count, t.extra_qualifier_count,
       t.result_aggregation_mode, t.scoring_scheme, t.scoring_scheme_custom,
       t.team_score_multiplier, t.estimated_unit_minutes, t.combined_item_order,
       req.user.id, t.sort_no]
    );
    res.json(ok({ id: r.insertId }, '已复制到公共库'));
  } catch (e) { next(e); }
});

/**
 * POST /api/track/events/from-template
 * 从模板批量创建赛事项目（全能模板会连父带子一起建）
 * body: { competition_id, template_ids: [], band_id? }
 */
router.post('/events/from-template', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, template_ids } = req.body;
    if (!competition_id || !Array.isArray(template_ids) || !template_ids.length) {
      return res.json(fail('请选择要添加的项目模板'));
    }
    let created = 0;
    for (const tid of template_ids) {
      const t = await queryOne('SELECT * FROM event_template WHERE id = ?', [tid]);
      if (!t) continue;

      // 父项目
      const pr = await execute(
        `INSERT INTO event_item
          (competition_id, name, category, is_relay, lane_count, prelim_max,
           event_type, result_entry_type, event_unit, is_higher_better,
           result_min_value, result_max_value, result_decimal_places, gender_requirement,
           need_lane_order, relay_leg_count, has_preliminary, admission_count,
           estimated_unit_minutes, base_attempt_count, extra_attempt_count, extra_qualifier_count,
           result_aggregation_mode, team_score_multiplier, template_id, sort_no)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [competition_id, t.template_name, t.category, t.event_type === 'RELAY' ? 1 : 0,
         8, 16,
         t.event_type ?? 'TRACK', t.result_entry_type ?? 'TIME', t.event_unit ?? null,
         t.is_higher_better ? 1 : 0,
         t.result_min_value ?? null, t.result_max_value ?? null,
         t.result_decimal_places ?? 2, t.gender ?? 'A',
         t.need_lane_order ?? 1, t.relay_leg_count ?? 4, t.has_preliminary ? 1 : 0,
         t.admission_count ?? null,
         t.estimated_unit_minutes ?? null, t.base_attempt_count ?? 3,
         t.extra_attempt_count ?? 3, t.extra_qualifier_count ?? null,
         t.result_aggregation_mode ?? 'BEST', t.team_score_multiplier ?? 1, t.id, t.sort_no ?? 0]
      );
      created++;
      const parentId = pr.insertId;

      // 全能子项
      const children = await query(
        'SELECT * FROM event_template WHERE combined_parent_id = ? ORDER BY combined_item_order, id', [tid]
      );
      for (const c of children) {
        await execute(
          `INSERT INTO event_item
            (competition_id, name, category, is_relay, lane_count, prelim_max,
             event_type, result_entry_type, event_unit, is_higher_better,
             result_min_value, result_max_value, result_decimal_places, gender_requirement,
             need_lane_order, has_preliminary, estimated_unit_minutes,
             base_attempt_count, extra_attempt_count, extra_qualifier_count,
             result_aggregation_mode, combined_parent_id, combined_item_name, combined_item_order,
             template_id, sort_no)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [competition_id, c.template_name, c.category, 0, 8, 16,
           c.event_type ?? 'TRACK', c.result_entry_type ?? 'TIME', c.event_unit ?? null,
           c.is_higher_better ? 1 : 0,
           c.result_min_value ?? null, c.result_max_value ?? null,
           c.result_decimal_places ?? 2, c.gender ?? 'A',
           c.need_lane_order ?? 1, c.has_preliminary ? 1 : 0, c.estimated_unit_minutes ?? null,
           c.base_attempt_count ?? 3, c.extra_attempt_count ?? 3, c.extra_qualifier_count ?? null,
           c.result_aggregation_mode ?? 'BEST', parentId, c.template_name,
           c.combined_item_order ?? 0, c.id, c.sort_no ?? 0]
        );
        created++;
      }
    }
    res.json(ok({ created }, `已添加 ${created} 个项目`));
  } catch (e) { next(e); }
});

// ============================================================
// 二、评分表（成绩 → 积分）
// ============================================================

/** GET /api/track/score-tables?table_type=&gender=&event_key= */
router.get('/score-tables', async (req, res, next) => {
  try {
    const { table_type, gender, event_key } = req.query;
    let where = ['status = 1'];
    const p = [];
    if (table_type) { where.push('table_type = ?'); p.push(table_type); }
    if (gender) { where.push("(gender = ? OR gender = 'A')"); p.push(gender); }
    if (event_key) { where.push('event_key = ?'); p.push(event_key); }
    const rows = await query(
      `SELECT * FROM score_table WHERE ${where.join(' AND ')} ORDER BY gender, event_key, id`, p
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/** GET /api/track/score-tables/:id 含查表明细 */
router.get('/score-tables/:id', async (req, res, next) => {
  try {
    const t = await queryOne('SELECT * FROM score_table WHERE id = ?', [req.params.id]);
    if (!t) return res.json(fail('评分表不存在'));
    const details = await query(
      'SELECT * FROM score_table_detail WHERE score_table_id = ? ORDER BY result_value', [req.params.id]
    );
    res.json(ok({ ...t, details }));
  } catch (e) { next(e); }
});

/** POST /api/track/score-tables */
router.post('/score-tables', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.table_name) return res.json(fail('请填写评分表名称'));
    const r = await execute(
      `INSERT INTO score_table
        (table_name, table_type, event_template_id, event_key, gender, calculation_type,
         formula_type, coefficient_a, coefficient_b, coefficient_c, input_unit,
         rounding_mode, timing_adjustment, built_in_flag, owner_scope, created_by, remark, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,'CUSTOM',?,?,1)`,
      [b.table_name, b.table_type || 'COMBINED', b.event_template_id || null, b.event_key || null,
       b.gender || 'A', b.calculation_type || 'FORMULA', b.formula_type || 'IaAF',
       b.coefficient_a ?? null, b.coefficient_b ?? null, b.coefficient_c ?? null,
       b.input_unit || null, b.rounding_mode || 'FLOOR', b.timing_adjustment ?? null,
       req.user.id, b.remark || null]
    );
    res.json(ok({ id: r.insertId }, '评分表已创建'));
  } catch (e) { next(e); }
});

/** PUT /api/track/score-tables/:id */
router.put('/score-tables/:id', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    const t = await queryOne('SELECT * FROM score_table WHERE id = ?', [req.params.id]);
    if (!t) return res.json(fail('评分表不存在'));
    if (Number(t.built_in_flag) === 1) return res.json(fail('内置评分表不可修改'));
    await execute(
      `UPDATE score_table SET table_name=?, table_type=?, event_key=?, gender=?,
        calculation_type=?, formula_type=?, coefficient_a=?, coefficient_b=?, coefficient_c=?,
        input_unit=?, rounding_mode=?, timing_adjustment=?, remark=?
       WHERE id=?`,
      [b.table_name ?? t.table_name, b.table_type ?? t.table_type, b.event_key ?? t.event_key,
       b.gender ?? t.gender, b.calculation_type ?? t.calculation_type, b.formula_type ?? t.formula_type,
       b.coefficient_a ?? t.coefficient_a, b.coefficient_b ?? t.coefficient_b,
       b.coefficient_c ?? t.coefficient_c, b.input_unit ?? t.input_unit,
       b.rounding_mode ?? t.rounding_mode, b.timing_adjustment ?? t.timing_adjustment,
       b.remark ?? t.remark, req.params.id]
    );
    res.json(ok(null, '已保存'));
  } catch (e) { next(e); }
});

/** PUT /api/track/score-tables/:id/details 批量保存查表明细 */
router.put('/score-tables/:id/details', roleRequired(1), async (req, res, next) => {
  try {
    const rows = req.body.rows || [];
    await execute('DELETE FROM score_table_detail WHERE score_table_id = ?', [req.params.id]);
    for (let i = 0; i < rows.length; i++) {
      await execute(
        'INSERT INTO score_table_detail (score_table_id, result_value, score_value, sort_no) VALUES (?,?,?,?)',
        [req.params.id, rows[i].result_value, rows[i].score_value, i]
      );
    }
    res.json(ok({ count: rows.length }, '已保存'));
  } catch (e) { next(e); }
});

/**
 * POST /api/track/score/preview 试算：成绩 → 积分
 * body: { score_table_id, entry_type, value }
 */
router.post('/score/preview', async (req, res, next) => {
  try {
    const { score_table_id, entry_type, value } = req.body;
    const rule = await queryOne('SELECT * FROM score_table WHERE id = ?', [score_table_id]);
    if (!rule) return res.json(fail('评分表不存在'));

    let tableRows = null;
    if (rule.calculation_type === 'TABLE') {
      tableRows = await query(
        'SELECT * FROM score_table_detail WHERE score_table_id = ? ORDER BY result_value', [score_table_id]
      );
    }
    const v = scoreEngine.parseResult(value, entry_type);
    if (v === null) return res.json(fail('成绩无法解析'));
    const score = scoreEngine.toScore({ entryType: entry_type, value: v, rule, tableRows });
    res.json(ok({ value: v, score }, '换算完成'));
  } catch (e) { next(e); }
});

// ============================================================
// 三、项目评分规则绑定
// ============================================================

/** GET /api/track/events/:id/score-rule */
router.get('/events/:id/score-rule', async (req, res, next) => {
  try {
    const r = await queryOne('SELECT * FROM event_score_rule WHERE event_item_id = ?', [req.params.id]);
    res.json(ok(r));
  } catch (e) { next(e); }
});

/** PUT /api/track/events/:id/score-rule 绑定评分规则 */
router.put('/events/:id/score-rule', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    const eventItemId = req.params.id;
    const ev = await queryOne('SELECT * FROM event_item WHERE id = ?', [eventItemId]);
    if (!ev) return res.json(fail('项目不存在'));

    // 优先用传过来的表做模板，其次按项目自动匹配
    let src = null;
    if (b.source_score_table_id) {
      src = await queryOne('SELECT * FROM score_table WHERE id = ?', [b.source_score_table_id]);
    } else if (b.event_key && b.gender) {
      src = await queryOne(
        'SELECT * FROM score_table WHERE event_key = ? AND gender = ? AND status = 1 LIMIT 1',
        [b.event_key, b.gender]
      );
    }

    const payload = {
      score_type: b.score_type || 'COMBINED',
      calculation_type: (b.calculation_type) || (src ? src.calculation_type : 'FORMULA'),
      formula_type: b.formula_type || (src ? src.formula_type : null),
      coefficient_a: b.coefficient_a ?? (src ? src.coefficient_a : null),
      coefficient_b: b.coefficient_b ?? (src ? src.coefficient_b : null),
      coefficient_c: b.coefficient_c ?? (src ? src.coefficient_c : null),
      input_unit: b.input_unit || (src ? src.input_unit : null),
      rounding_mode: b.rounding_mode || (src ? src.rounding_mode : 'FLOOR'),
      timing_adjustment: b.timing_adjustment ?? (src ? src.timing_adjustment : null),
      source_score_table_id: src ? src.id : null
    };

    const exist = await queryOne('SELECT * FROM event_score_rule WHERE event_item_id = ?', [eventItemId]);
    if (exist) {
      await execute(
        `UPDATE event_score_rule SET source_score_table_id=?, score_type=?, calculation_type=?,
          formula_type=?, coefficient_a=?, coefficient_b=?, coefficient_c=?, input_unit=?,
          rounding_mode=?, timing_adjustment=? WHERE id=?`,
        [payload.source_score_table_id, payload.score_type, payload.calculation_type,
         payload.formula_type, payload.coefficient_a, payload.coefficient_b, payload.coefficient_c,
         payload.input_unit, payload.rounding_mode, payload.timing_adjustment, exist.id]
      );
    } else {
      await execute(
        `INSERT INTO event_score_rule
          (event_item_id, source_score_table_id, score_type, calculation_type, formula_type,
           coefficient_a, coefficient_b, coefficient_c, input_unit, rounding_mode, timing_adjustment)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [eventItemId, payload.source_score_table_id, payload.score_type, payload.calculation_type,
         payload.formula_type, payload.coefficient_a, payload.coefficient_b, payload.coefficient_c,
         payload.input_unit, payload.rounding_mode, payload.timing_adjustment]
      );
    }
    // 回写到项目表，方便直接联查
    const rule = await queryOne('SELECT * FROM event_score_rule WHERE event_item_id = ?', [eventItemId]);
    await execute('UPDATE event_item SET score_rule_id = ? WHERE id = ?', [rule.id, eventItemId]);
    res.json(ok(rule, '评分规则已绑定'));
  } catch (e) { next(e); }
});

// ============================================================
// 四、全能项目
// ============================================================

/**
 * GET /api/track/combined?competition_id=
 * 返回全能父项目 + 子项 + 子项评分规则
 */
router.get('/combined', async (req, res, next) => {
  try {
    const parents = await query(
      `SELECT * FROM event_item
        WHERE competition_id = ? AND event_type = 'COMBINED' AND (combined_parent_id IS NULL OR combined_parent_id = 0)
        ORDER BY sort_no, id`, [req.query.competition_id]
    );
    const out = [];
    for (const p of parents) {
      const children = await query(
        `SELECT e.*, r.calculation_type, r.formula_type, r.coefficient_a, r.coefficient_b,
                r.coefficient_c, r.input_unit, r.rounding_mode, r.timing_adjustment
           FROM event_item e
           LEFT JOIN event_score_rule r ON r.event_item_id = e.id
          WHERE e.combined_parent_id = ? ORDER BY e.combined_item_order, e.id`, [p.id]
      );
      out.push({ ...p, children });
    }
    res.json(ok(out));
  } catch (e) { next(e); }
});

/**
 * POST /api/track/combined 新建全能项目（父 + 子项）
 * body: { competition_id, name, gender, children: [{ name, event_type, result_entry_type, event_unit, event_key }] }
 */
router.post('/combined', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.competition_id || !b.name) return res.json(fail('请填写全能项目名称'));
    const pr = await execute(
      `INSERT INTO event_item
        (competition_id, name, category, event_type, result_entry_type, event_unit,
         is_higher_better, result_decimal_places, gender_requirement, need_lane_order,
         result_aggregation_mode, sort_no)
       VALUES (?,?,2,'COMBINED','POINT','分',1,0,?,0,'SUM',?)`,
      [b.competition_id, b.name, b.gender || 'A', b.sort_no || 0]
    );
    const parentId = pr.insertId;

    const children = Array.isArray(b.children) ? b.children : [];
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      const cr = await execute(
        `INSERT INTO event_item
          (competition_id, name, category, event_type, result_entry_type, event_unit,
           is_higher_better, result_decimal_places, gender_requirement, lane_count, prelim_max,
           combined_parent_id, combined_item_name, combined_item_order, sort_no)
         VALUES (?,?,?,?,?,?,?,?,?,8,16,?,?,?,?)`,
        [b.competition_id, c.name, c.event_type === 'FIELD' ? 2 : 1, c.event_type || 'TRACK',
         c.result_entry_type || 'TIME', c.event_unit || 's',
         c.event_type === 'FIELD' ? 1 : 0, c.result_decimal_places ?? 2,
         b.gender || 'A', parentId, c.name, i + 1, (b.sort_no || 0) + i + 1]
      );
      // 自动按 event_key + gender 绑定评分公式
      if (c.event_key) {
        const src = await queryOne(
          'SELECT * FROM score_table WHERE event_key = ? AND gender = ? AND status = 1 LIMIT 1',
          [c.event_key, b.gender || 'A']
        );
        if (src) {
          await execute(
            `INSERT INTO event_score_rule
              (event_item_id, source_score_table_id, score_type, calculation_type, formula_type,
               coefficient_a, coefficient_b, coefficient_c, input_unit, rounding_mode, timing_adjustment)
             VALUES (?,?,'COMBINED',?,?,?,?,?,?,?,?)`,
            [cr.insertId, src.id, src.calculation_type, src.formula_type,
             src.coefficient_a, src.coefficient_b, src.coefficient_c,
             src.input_unit, src.rounding_mode, src.timing_adjustment]
          );
          await execute('UPDATE event_item SET score_rule_id = LAST_INSERT_ID() WHERE id = ?', [cr.insertId]);
        }
      }
    }
    res.json(ok({ id: parentId }, '全能项目已创建'));
  } catch (e) { next(e); }
});

/** PUT /api/track/combined/:id 修改全能项目（名称 + 子项顺序） */
router.put('/combined/:id', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    if (b.name !== undefined) {
      await execute('UPDATE event_item SET name = ? WHERE id = ?', [b.name, req.params.id]);
    }
    if (Array.isArray(b.children)) {
      for (const c of b.children) {
        if (!c.id) continue;
        await execute(
          'UPDATE event_item SET combined_item_order = ?, combined_item_name = ? WHERE id = ? AND combined_parent_id = ?',
          [c.combined_item_order ?? 0, c.combined_item_name ?? null, c.id, req.params.id]
        );
      }
    }
    res.json(ok(null, '已保存'));
  } catch (e) { next(e); }
});

/** DELETE /api/track/combined/:id 连子项一起删 */
router.delete('/combined/:id', roleRequired(1), async (req, res, next) => {
  try {
    await execute('DELETE FROM event_item WHERE id = ? OR combined_parent_id = ?', [req.params.id, req.params.id]);
    res.json(ok(null, '已删除'));
  } catch (e) { next(e); }
});

// ============================================================
// 五、赛事 / 组别 / 项目 的田径扩展配置
// ============================================================

/** GET /api/track/meet-config?competition_id= */
router.get('/meet-config', async (req, res, next) => {
  try {
    const c = await queryOne(
      `SELECT id, uuid, name, year, stage, start_date, end_date, status,
              meet_level, host_unit, venue, contact_person, contact_phone, cover_image, logo,
              straight_lane_count, curve_lane_count, track_timing_mode,
              minimum_rest_minutes, tie_score_mode, deduct_one_flag,
              record_bonus_flag, record_bonus_strategy, record_bonus_value,
              grade_bonus_flag, grade_bonus_strategy, grade_bonus_value,
              enroll_open_flag, enroll_start_time, enroll_end_time, enroll_audit_flag,
              enroll_field_config, enroll_material_config, relay_temporary_selection_flag,
              enroll_lock_flag, schedule_lock_flag, timetable_lock_flag, order_book_lock_flag
         FROM competition WHERE id = ?`, [req.query.competition_id]
    );
    res.json(ok(c));
  } catch (e) { next(e); }
});

/** PUT /api/track/meet-config 保存（分项保存，传什么存什么） */
router.put('/meet-config', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    const id = b.competition_id || b.id;
    if (!id) return res.json(fail('缺少赛事 id'));

    const FIELDS = [
      'meet_level', 'host_unit', 'venue', 'contact_person', 'contact_phone',
      'cover_image', 'logo', 'straight_lane_count', 'curve_lane_count', 'track_timing_mode',
      'minimum_rest_minutes', 'tie_score_mode', 'deduct_one_flag',
      'record_bonus_flag', 'record_bonus_strategy', 'record_bonus_value',
      'grade_bonus_flag', 'grade_bonus_strategy', 'grade_bonus_value',
      'enroll_open_flag', 'enroll_start_time', 'enroll_end_time', 'enroll_audit_flag',
      'relay_temporary_selection_flag',
      'enroll_lock_flag', 'schedule_lock_flag', 'timetable_lock_flag', 'order_book_lock_flag'
    ];
    const JSON_FIELDS = ['enroll_field_config', 'enroll_material_config'];

    const sets = [];
    const p = [];
    for (const f of FIELDS) {
      if (b[f] !== undefined) { sets.push(`${f} = ?`); p.push(b[f] ?? null); }
    }
    for (const f of JSON_FIELDS) {
      if (b[f] !== undefined) { sets.push(`${f} = ?`); p.push(JSON.stringify(b[f])); }
    }
    if (!sets.length) return res.json(fail('没有要保存的内容'));
    p.push(id);
    await execute(`UPDATE competition SET ${sets.join(', ')} WHERE id = ?`, p);
    res.json(ok(null, '赛事配置已保存'));
  } catch (e) { next(e); }
});

/** PUT /api/track/band/:id/limits 组别限报配置 */
router.put('/band/:id/limits', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    await execute(
      `UPDATE group_band SET group_type=?, team_max_total_count=?, team_max_male_count=?,
        team_max_female_count=?, athlete_max_event_count=?,
        birth_date_limit_flag=?, birth_date_start=?, birth_date_end=?
       WHERE id=?`,
      [b.group_type || 'NORMAL', b.team_max_total_count ?? null, b.team_max_male_count ?? null,
       b.team_max_female_count ?? null, b.athlete_max_event_count ?? null,
       b.birth_date_limit_flag ? 1 : 0, b.birth_date_start || null, b.birth_date_end || null,
       req.params.id]
    );
    res.json(ok(null, '限报配置已保存'));
  } catch (e) { next(e); }
});

/** PUT /api/track/event/:id/track-config 项目田径参数 */
router.put('/event/:id/track-config', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    const ev = await queryOne('SELECT * FROM event_item WHERE id = ?', [req.params.id]);
    if (!ev) return res.json(fail('项目不存在'));

    const FIELDS = [
      'event_type', 'result_entry_type', 'event_unit', 'is_higher_better',
      'result_min_value', 'result_max_value', 'result_decimal_places', 'gender_requirement',
      'need_lane_order', 'relay_leg_count', 'has_preliminary', 'admission_count',
      'estimated_unit_minutes', 'base_attempt_count', 'extra_attempt_count', 'extra_qualifier_count',
      'result_aggregation_mode', 'scoring_scheme', 'scoring_scheme_custom',
      'team_score_multiplier', 'max_total_count', 'max_male_count', 'max_female_count',
      'grade_standard_id', 'sort_no'
    ];
    const sets = [];
    const p = [];
    for (const f of FIELDS) {
      if (b[f] !== undefined) { sets.push(`${f} = ?`); p.push(b[f] ?? null); }
    }
    if (!sets.length) return res.json(fail('没有要保存的内容'));
    p.push(req.params.id);
    await execute(`UPDATE event_item SET ${sets.join(', ')} WHERE id = ?`, p);
    res.json(ok(null, '项目参数已保存'));
  } catch (e) { next(e); }
});

// ============================================================
// 六、成绩格式化 / 解析（前端录入框用）
// ============================================================

/** POST /api/track/parse-result  { text, entry_type } */
router.post('/parse-result', async (req, res, next) => {
  try {
    const { text, entry_type, decimals, unit } = req.body;
    const v = scoreEngine.parseResult(text, entry_type);
    res.json(ok({
      ok: v !== null,
      value: v,
      text: v === null ? '' : scoreEngine.formatResult(v, entry_type, decimals ?? 2, unit || ''),
      status: scoreEngine.isSpecialStatus(text) ? String(text).trim().toUpperCase() : null,
      status_text: scoreEngine.statusText(text) || null
    }));
  } catch (e) { next(e); }
});

module.exports = router;
