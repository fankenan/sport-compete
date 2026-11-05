/**
 * 第四期：赛后统计与公开
 * 挂载 /api/track-stats
 *
 *   15 团体总分排名（按组 / 合并 / 虚拟组）
 *   16 达级标准库 + 认定 + 加分 + 汇总
 *   17 破纪录管理 + 加分 + 汇总
 *   18 成绩汇总 / 综合查询
 *   19 基础分调整
 *   20 公开成绩查询页（免登录，走 /api/public）
 */
const express = require('express');
const { query, queryOne, execute, ok, fail } = require('../db');
const { authRequired, roleRequired } = require('../middleware/auth');
const teamScore = require('../services/teamScore');
const gradeRecord = require('../services/gradeRecord');
const scoreEngine = require('../services/scoreEngine');

const router = express.Router();
router.use(authRequired);

function parseJson(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

// ============================================================
// 15. 团体总分
// ============================================================

/** GET /api/track-stats/team-score-rules?competition_id= */
router.get('/team-score-rules', async (req, res, next) => {
  try {
    const rows = await query(
      'SELECT * FROM team_score_rule WHERE competition_id = ? ORDER BY sort_no, id',
      [req.query.competition_id]
    );
    res.json(ok(rows.map((r) => ({ ...r, band_ids: parseJson(r.band_ids, []), score_table: parseJson(r.score_table, teamScore.DEFAULT_SCORE_TABLE) }))));
  } catch (e) { next(e); }
});

/** POST /api/track-stats/team-score-rules 新建/更新方案 */
router.post('/team-score-rules', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.competition_id) return res.json(fail('缺少赛事 id'));
    if (!b.scheme_name) return res.json(fail('请填写方案名称'));
    const bandIds = Array.isArray(b.band_ids) ? b.band_ids : [];
    const scoreTable = b.score_table || teamScore.DEFAULT_SCORE_TABLE;

    if (b.id) {
      await execute(
        `UPDATE team_score_rule SET scheme_name=?, scope_mode=?, band_ids=?, score_source=?,
          score_table=?, rank_limit=?, relay_multiplier=?, include_grade_bonus=?,
          include_record_bonus=?, tie_break_mode=?, sort_no=? WHERE id=?`,
        [b.scheme_name, b.scope_mode || 'BAND', JSON.stringify(bandIds), b.score_source || 'RANK',
         JSON.stringify(scoreTable), b.rank_limit ?? null, b.relay_multiplier ?? 2,
         b.include_grade_bonus ?? 0, b.include_record_bonus ?? 0,
         b.tie_break_mode || 'FIRST', b.sort_no ?? 0, b.id]
      );
      res.json(ok({ id: Number(b.id) }, '方案已更新'));
    } else {
      const r = await execute(
        `INSERT INTO team_score_rule
          (competition_id, scheme_name, scope_mode, band_ids, score_source, score_table,
           rank_limit, relay_multiplier, include_grade_bonus, include_record_bonus,
           tie_break_mode, sort_no)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [b.competition_id, b.scheme_name, b.scope_mode || 'BAND', JSON.stringify(bandIds),
         b.score_source || 'RANK', JSON.stringify(scoreTable), b.rank_limit ?? null,
         b.relay_multiplier ?? 2, b.include_grade_bonus ?? 0, b.include_record_bonus ?? 0,
         b.tie_break_mode || 'FIRST', b.sort_no ?? 0]
      );
      res.json(ok({ id: r.insertId }, '方案已创建'));
    }
  } catch (e) { next(e); }
});

/** DELETE /api/track-stats/team-score-rules/:id */
router.delete('/team-score-rules/:id', roleRequired(1), async (req, res, next) => {
  try {
    const id = req.params.id;
    await execute('DELETE FROM team_score_item WHERE rule_id = ?', [id]);
    await execute('DELETE FROM team_score_total WHERE rule_id = ?', [id]);
    await execute('DELETE FROM virtual_group WHERE rule_id = ?', [id]);
    await execute('DELETE FROM team_score_rule WHERE id = ?', [id]);
    res.json(ok(null, '方案已删除'));
  } catch (e) { next(e); }
});

/** GET /api/track-stats/virtual-groups?competition_id=[&rule_id] */
router.get('/virtual-groups', async (req, res, next) => {
  try {
    const { competition_id, rule_id } = req.query;
    let sql = 'SELECT * FROM virtual_group WHERE competition_id = ?';
    const p = [competition_id];
    if (rule_id) { sql += ' AND (rule_id = ? OR rule_id IS NULL)'; p.push(rule_id); }
    const rows = await query(sql + ' ORDER BY sort_no, id', p);
    res.json(ok(rows.map((r) => ({ ...r, school_ids: parseJson(r.school_ids, []) }))));
  } catch (e) { next(e); }
});

/** POST /api/track-stats/virtual-groups */
router.post('/virtual-groups', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.competition_id) return res.json(fail('缺少赛事 id'));
    if (!b.group_name) return res.json(fail('请填写虚拟组名称'));
    const ids = Array.isArray(b.school_ids) ? b.school_ids : [];
    if (b.id) {
      await execute(
        'UPDATE virtual_group SET group_name=?, school_ids=?, rule_id=?, sort_no=? WHERE id=?',
        [b.group_name, JSON.stringify(ids), b.rule_id ?? null, b.sort_no ?? 0, b.id]
      );
      res.json(ok({ id: Number(b.id) }, '已更新'));
    } else {
      const r = await execute(
        'INSERT INTO virtual_group (competition_id, rule_id, group_name, school_ids, sort_no) VALUES (?,?,?,?,?)',
        [b.competition_id, b.rule_id ?? null, b.group_name, JSON.stringify(ids), b.sort_no ?? 0]
      );
      res.json(ok({ id: r.insertId }, '已创建'));
    }
  } catch (e) { next(e); }
});

router.delete('/virtual-groups/:id', roleRequired(1), async (req, res, next) => {
  try {
    await execute('DELETE FROM virtual_group WHERE id = ?', [req.params.id]);
    res.json(ok(null, '已删除'));
  } catch (e) { next(e); }
});

/** POST /api/track-stats/team-score/calc 计算团体总分 */
router.post('/team-score/calc', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, rule_id } = req.body;
    const rule = await queryOne('SELECT * FROM team_score_rule WHERE id = ?', [rule_id]);
    if (!rule) return res.json(fail('方案不存在'));
    const r = await teamScore.buildTeamScore(Number(competition_id || rule.competition_id), rule);
    res.json(ok(r, `已计算：${r.items} 条得分，${r.units} 个参赛单位`));
  } catch (e) { next(e); }
});

/** GET /api/track-stats/team-score/total?rule_id= */
router.get('/team-score/total', async (req, res, next) => {
  try {
    const { rule_id } = req.query;
    const rows = await query(
      `SELECT * FROM team_score_total WHERE rule_id = ?
        ORDER BY COALESCE(rank_no, 999), final_score DESC, unit_name`, [rule_id]
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/** GET /api/track-stats/team-score/detail?rule_id=[&unit_id][&unit_type] */
router.get('/team-score/detail', async (req, res, next) => {
  try {
    const { rule_id, unit_id, unit_type } = req.query;
    let sql = 'SELECT * FROM team_score_item WHERE rule_id = ?';
    const p = [rule_id];
    if (unit_id && unit_type === 'SCHOOL') { sql += ' AND school_id = ?'; p.push(unit_id); }
    sql += ' ORDER BY event_item_id, rank_no';
    const rows = await query(sql, p);
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/** PUT /api/track-stats/team-score/adjust 19 基础分调整 */
router.put('/team-score/adjust', roleRequired(1), async (req, res, next) => {
  try {
    const { id, adjust_score, adjust_reason } = req.body;
    const row = await queryOne('SELECT * FROM team_score_total WHERE id = ?', [id]);
    if (!row) return res.json(fail('记录不存在'));
    const adj = Number(adjust_score) || 0;
    const finalScore = Math.round((Number(row.total_score) + Number(row.grade_bonus)
      + Number(row.record_bonus) + adj) * 100) / 100;
    await execute(
      'UPDATE team_score_total SET adjust_score=?, adjust_reason=?, final_score=? WHERE id=?',
      [adj, adjust_reason || null, finalScore, id]
    );
    // 同榜重排名次
    await resortRank(row.rule_id, row.band_id);
    res.json(ok(null, '基础分已调整'));
  } catch (e) { next(e); }
});

async function resortRank(ruleId, bandId) {
  const rule = await queryOne('SELECT * FROM team_score_rule WHERE id = ?', [ruleId]);
  const tieMode = rule?.tie_break_mode || 'FIRST';
  let where = 'rule_id = ? AND band_id <=> ?';
  const rows = await query(
    `SELECT * FROM team_score_total WHERE ${where} ORDER BY final_score DESC`, [ruleId, bandId ?? null]
  );
  let prev = null, rank = 0;
  for (let i = 0; i < rows.length; i++) {
    const x = rows[i];
    const same = prev !== null && Math.abs(Number(x.final_score) - prev) < 1e-9
      && (tieMode !== 'FIRST' || (i > 0 && x.first_count === rows[i - 1].first_count
        && x.second_count === rows[i - 1].second_count && x.third_count === rows[i - 1].third_count));
    if (!same) rank = i + 1;
    await execute('UPDATE team_score_total SET rank_no=?, rank_reason=? WHERE id=?',
      [rank, same ? '并列' : null, x.id]);
    prev = Number(x.final_score);
  }
}

// ============================================================
// 16. 达级
// ============================================================

/** GET /api/track-stats/grade-standards?keyword= */
router.get('/grade-standards', async (req, res, next) => {
  try {
    const { keyword } = req.query;
    let sql = 'SELECT * FROM grade_standard WHERE status = 1';
    const p = [];
    if (keyword) { sql += ' AND (event_name LIKE ? OR standard_code LIKE ?)'; p.push(`%${keyword}%`, `%${keyword}%`); }
    const rows = await query(sql + ' ORDER BY standard_code, event_name, gender', p);
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/** POST /api/track-stats/grade-standards 新建标准 */
router.post('/grade-standards', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.event_name) return res.json(fail('请填写项目名称'));
    if (b.id) {
      await execute(
        `UPDATE grade_standard SET standard_code=?, event_name=?, event_category=?, specification=?,
          gender=?, result_unit=?, result_direction=?, result_entry_type=?, display_note=?, source_document=? WHERE id=?`,
        [b.standard_code || 'CUSTOM', b.event_name, b.event_category || null, b.specification || null,
         b.gender || 'A', b.result_unit || null, b.result_direction || 'LOWER',
         b.result_entry_type || 'TIME', b.display_note || null, b.source_document || null, b.id]
      );
      res.json(ok({ id: Number(b.id) }, '标准已更新'));
    } else {
      const r = await execute(
        `INSERT INTO grade_standard
          (standard_code, event_name, event_category, specification, gender,
           result_unit, result_direction, result_entry_type, display_note, source_document)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [b.standard_code || 'CUSTOM', b.event_name, b.event_category || null, b.specification || null,
         b.gender || 'A', b.result_unit || null, b.result_direction || 'LOWER',
         b.result_entry_type || 'TIME', b.display_note || null, b.source_document || null]
      );
      res.json(ok({ id: r.insertId }, '标准已创建'));
    }
  } catch (e) { next(e); }
});

router.delete('/grade-standards/:id', roleRequired(1), async (req, res, next) => {
  try {
    await execute('DELETE FROM grade_standard_threshold WHERE standard_id = ?', [req.params.id]);
    await execute('DELETE FROM grade_standard WHERE id = ?', [req.params.id]);
    res.json(ok(null, '标准已删除'));
  } catch (e) { next(e); }
});

/** GET /api/track-stats/grade-thresholds?standard_id= */
router.get('/grade-thresholds', async (req, res, next) => {
  try {
    const rows = await query(
      'SELECT * FROM grade_standard_threshold WHERE standard_id = ? ORDER BY sort_no, id',
      [req.query.standard_id]
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/** PUT /api/track-stats/grade-thresholds 整表覆盖保存 */
router.put('/grade-thresholds', roleRequired(1), async (req, res, next) => {
  try {
    const { standard_id, rows: list } = req.body;
    if (!standard_id) return res.json(fail('缺少标准 id'));
    if (!Array.isArray(list)) return res.json(fail('数据格式不正确'));
    await execute('DELETE FROM grade_standard_threshold WHERE standard_id = ?', [standard_id]);
    let n = 0;
    for (const t of list) {
      if (t.result_value === '' || t.result_value === null || t.result_value === undefined) continue;
      await execute(
        `INSERT INTO grade_standard_threshold
          (standard_id, grade_code, grade_name, result_value, bonus_value, sort_no)
         VALUES (?,?,?,?,?,?)`,
        [standard_id, t.grade_code, t.grade_name || gradeRecord.GRADE_NAME[t.grade_code] || t.grade_code,
         Number(t.result_value), Number(t.bonus_value) || 0, Number(t.sort_no) || n]
      );
      n++;
    }
    res.json(ok({ count: n }, `已保存 ${n} 条阈值`));
  } catch (e) { next(e); }
});

/** GET/PUT /api/track-stats/grade-bonus-rules?competition_id= 赛事达级加分 */
router.get('/grade-bonus-rules', async (req, res, next) => {
  try {
    const rows = await query(
      'SELECT * FROM meet_grade_bonus_rule WHERE competition_id = ? ORDER BY id',
      [req.query.competition_id]
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

router.put('/grade-bonus-rules', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, rows: list } = req.body;
    if (!competition_id) return res.json(fail('缺少赛事 id'));
    await execute('DELETE FROM meet_grade_bonus_rule WHERE competition_id = ?', [competition_id]);
    let n = 0;
    for (const r of list || []) {
      if (!r.grade_code) continue;
      await execute(
        `INSERT INTO meet_grade_bonus_rule
          (competition_id, grade_code, grade_name, event_category, bonus_value)
         VALUES (?,?,?,?,?)`,
        [competition_id, r.grade_code, r.grade_name || gradeRecord.GRADE_NAME[r.grade_code] || r.grade_code,
         r.event_category || null, Number(r.bonus_value) || 0]
      );
      n++;
    }
    res.json(ok({ count: n }, `已保存 ${n} 条加分规则`));
  } catch (e) { next(e); }
});

/** POST /api/track-stats/grade/recognize 批量认定达级 */
router.post('/grade/recognize', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.competition_id) return res.json(fail('缺少赛事 id'));
    const r = await gradeRecord.recognizeGrades(Number(b.competition_id), b);
    res.json(ok(r, `扫描 ${r.scanned} 条，新认定 ${r.created} 条，升级 ${r.updated} 条`));
  } catch (e) { next(e); }
});

/** GET /api/track-stats/grade-achievements?competition_id=[&grade_code][&school_id] */
router.get('/grade-achievements', async (req, res, next) => {
  try {
    const { competition_id, grade_code, school_id, band_id } = req.query;
    let where = ['g.competition_id = ?', 'g.confirm_flag = 1'];
    const p = [competition_id];
    if (grade_code) { where.push('g.grade_code = ?'); p.push(grade_code); }
    if (school_id) { where.push('g.school_id = ?'); p.push(school_id); }
    if (band_id) { where.push('g.band_id = ?'); p.push(band_id); }
    const rows = await query(
      `SELECT g.*, e.name AS event_name, gb.label AS band_label
         FROM grade_achievement g
         LEFT JOIN event_item e ON e.id = g.event_item_id
         LEFT JOIN group_band gb ON gb.id = g.band_id
        WHERE ${where.join(' AND ')}
        ORDER BY FIELD(g.grade_code,'MASTER','L1','L2','L3','YOUTH'), g.event_item_id`, p
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/** POST /api/track-stats/grade-achievements/:id/revoke 撤销认定 */
router.post('/grade-achievements/:id/revoke', roleRequired(1), async (req, res, next) => {
  try {
    await execute('UPDATE grade_achievement SET confirm_flag = 0 WHERE id = ?', [req.params.id]);
    res.json(ok(null, '已撤销认定'));
  } catch (e) { next(e); }
});

/** GET /api/track-stats/grade/summary?competition_id= 达级汇总（按等级 / 按单位） */
router.get('/grade/summary', async (req, res, next) => {
  try {
    const cid = req.query.competition_id;
    const byGrade = await query(
      `SELECT grade_code, grade_name, COUNT(*) AS c
         FROM grade_achievement WHERE competition_id = ? AND confirm_flag = 1
        GROUP BY grade_code, grade_name`, [cid]
    );
    const bySchool = await query(
      `SELECT school_id, team_name,
              COUNT(*) AS c,
              SUM(CASE WHEN grade_code='MASTER' THEN 1 ELSE 0 END) AS master_count,
              SUM(CASE WHEN grade_code='L1' THEN 1 ELSE 0 END) AS l1_count,
              SUM(CASE WHEN grade_code='L2' THEN 1 ELSE 0 END) AS l2_count,
              SUM(CASE WHEN grade_code='L3' THEN 1 ELSE 0 END) AS l3_count,
              SUM(CASE WHEN grade_code='YOUTH' THEN 1 ELSE 0 END) AS youth_count,
              SUM(bonus_value) AS bonus_total
         FROM grade_achievement WHERE competition_id = ? AND confirm_flag = 1
        GROUP BY school_id, team_name ORDER BY c DESC`, [cid]
    );
    res.json(ok({ byGrade, bySchool }));
  } catch (e) { next(e); }
});

/** PUT /api/track-stats/event/:id/grade-standard 给项目绑定等级标准 */
router.put('/event/:id/grade-standard', roleRequired(1), async (req, res, next) => {
  try {
    await execute('UPDATE event_item SET grade_standard_id = ? WHERE id = ?',
      [req.body.grade_standard_id ?? null, req.params.id]);
    res.json(ok(null, '已绑定'));
  } catch (e) { next(e); }
});

// ============================================================
// 17. 破纪录
// ============================================================

/** GET /api/track-stats/records?competition_id=[&event_item_id] 纪录登记 */
router.get('/records', async (req, res, next) => {
  try {
    const { competition_id, event_item_id } = req.query;
    let sql = `SELECT r.*, e.name AS event_name, e.event_unit, e.is_higher_better,
                      gb.label AS band_label
                 FROM meet_record r
                 LEFT JOIN event_item e ON e.id = r.event_item_id
                 LEFT JOIN group_band gb ON gb.id = r.band_id
                WHERE r.competition_id = ?`;
    const p = [competition_id];
    if (event_item_id) { sql += ' AND r.event_item_id = ?'; p.push(event_item_id); }
    res.json(ok(await query(sql + ' ORDER BY e.sort_no, r.band_id', p)));
  } catch (e) { next(e); }
});

/** POST /api/track-stats/records 登记/更新纪录 */
router.post('/records', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.competition_id) return res.json(fail('缺少赛事 id'));
    if (!b.event_item_id) return res.json(fail('请选择项目'));

    const parseVal = (txt) => {
      if (txt === '' || txt === null || txt === undefined) return null;
      const ev = { result_entry_type: b.result_entry_type || 'TIME' };
      return scoreEngine.parseResult(String(txt), ev.result_entry_type);
    };
    const mv = parseVal(b.meet_record_value);
    const hv = parseVal(b.highest_record_value);

    const payload = [
      b.competition_id, b.band_id ?? null, b.event_item_id, b.gender ?? null,
      b.meet_record_value ?? null, mv, b.meet_record_holder ?? null,
      b.meet_record_unit ?? null, b.meet_record_meet_name ?? null, b.meet_record_date ?? null,
      b.highest_record_value ?? null, hv, b.highest_record_holder ?? null,
      b.highest_record_unit ?? null, b.highest_record_meet_name ?? null, b.highest_record_date ?? null,
      b.detect_flag ?? 1
    ];

    if (b.id) {
      await execute(
        `UPDATE meet_record SET competition_id=?, band_id=?, event_item_id=?, gender=?,
          meet_record_value=?, meet_record_result_value=?, meet_record_holder=?,
          meet_record_unit=?, meet_record_meet_name=?, meet_record_date=?,
          highest_record_value=?, highest_record_result_value=?, highest_record_holder=?,
          highest_record_unit=?, highest_record_meet_name=?, highest_record_date=?, detect_flag=?
         WHERE id=?`, [...payload, b.id]
      );
      res.json(ok({ id: Number(b.id) }, '纪录已更新'));
    } else {
      const exist = await queryOne(
        'SELECT id FROM meet_record WHERE competition_id=? AND event_item_id=? AND band_id <=> ?',
        [b.competition_id, b.event_item_id, b.band_id ?? null]
      );
      if (exist) {
        await execute(
          `UPDATE meet_record SET gender=?, meet_record_value=?, meet_record_result_value=?,
            meet_record_holder=?, meet_record_unit=?, meet_record_meet_name=?, meet_record_date=?,
            highest_record_value=?, highest_record_result_value=?, highest_record_holder=?,
            highest_record_unit=?, highest_record_meet_name=?, highest_record_date=?, detect_flag=?
           WHERE id=?`,
          [...payload.slice(3), exist.id]
        );
        res.json(ok({ id: exist.id }, '纪录已更新'));
      } else {
        const r = await execute(
          `INSERT INTO meet_record
            (competition_id, band_id, event_item_id, gender,
             meet_record_value, meet_record_result_value, meet_record_holder,
             meet_record_unit, meet_record_meet_name, meet_record_date,
             highest_record_value, highest_record_result_value, highest_record_holder,
             highest_record_unit, highest_record_meet_name, highest_record_date, detect_flag)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, payload
        );
        res.json(ok({ id: r.insertId }, '纪录已登记'));
      }
    }
  } catch (e) { next(e); }
});

router.delete('/records/:id', roleRequired(1), async (req, res, next) => {
  try {
    await execute('DELETE FROM meet_record WHERE id = ?', [req.params.id]);
    res.json(ok(null, '纪录已删除'));
  } catch (e) { next(e); }
});

/** GET/PUT /api/track-stats/record-bonus-rules?competition_id= */
router.get('/record-bonus-rules', async (req, res, next) => {
  try {
    res.json(ok(await query(
      'SELECT * FROM meet_record_bonus_rule WHERE competition_id = ? ORDER BY id',
      [req.query.competition_id]
    )));
  } catch (e) { next(e); }
});

router.put('/record-bonus-rules', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, rows: list } = req.body;
    await execute('DELETE FROM meet_record_bonus_rule WHERE competition_id = ?', [competition_id]);
    let n = 0;
    for (const r of list || []) {
      if (!r.record_type) continue;
      await execute(
        'INSERT INTO meet_record_bonus_rule (competition_id, record_type, event_category, bonus_value) VALUES (?,?,?,?)',
        [competition_id, r.record_type, r.event_category || null, Number(r.bonus_value) || 0]
      );
      n++;
    }
    res.json(ok({ count: n }, `已保存 ${n} 条`));
  } catch (e) { next(e); }
});

/** POST /api/track-stats/record/detect 自动检测破纪录 */
router.post('/record/detect', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.competition_id) return res.json(fail('缺少赛事 id'));
    const r = await gradeRecord.detectRecordBreaks(Number(b.competition_id), b);
    res.json(ok(r, `扫描 ${r.scanned} 条成绩，新认定破纪录 ${r.created} 条`));
  } catch (e) { next(e); }
});

/** GET /api/track-stats/record-breaks?competition_id=[&record_type] */
router.get('/record-breaks', async (req, res, next) => {
  try {
    const { competition_id, record_type } = req.query;
    let where = ['rb.competition_id = ?', 'rb.confirm_flag = 1'];
    const p = [competition_id];
    if (record_type) { where.push('rb.record_type = ?'); p.push(record_type); }
    const rows = await query(
      `SELECT rb.*, e.name AS event_name, e.event_unit, gb.label AS band_label
         FROM record_break rb
         LEFT JOIN event_item e ON e.id = rb.event_item_id
         LEFT JOIN group_band gb ON gb.id = rb.band_id
        WHERE ${where.join(' AND ')}
        ORDER BY rb.record_type, rb.event_item_id, rb.id`, p
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

router.post('/record-breaks/:id/revoke', roleRequired(1), async (req, res, next) => {
  try {
    await execute('UPDATE record_break SET confirm_flag = 0 WHERE id = ?', [req.params.id]);
    res.json(ok(null, '已撤销'));
  } catch (e) { next(e); }
});

// ============================================================
// 18. 综合查询
// ============================================================

/** GET /api/track-stats/query/athletes 按运动员查 */
router.get('/query/athletes', async (req, res, next) => {
  try {
    const { competition_id, keyword, school_id, band_id, event_item_id } = req.query;
    let where = ['he.competition_id = ?'];
    const p = [competition_id];
    if (keyword) { where.push('(he.athlete_name LIKE ? OR a.name LIKE ?)'); p.push(`%${keyword}%`, `%${keyword}%`); }
    if (school_id) { where.push('he.school_id = ?'); p.push(school_id); }
    if (band_id) { where.push('he.band_id = ?'); p.push(band_id); }
    if (event_item_id) { where.push('he.event_item_id = ?'); p.push(event_item_id); }
    const rows = await query(
      `SELECT he.athlete_id, COALESCE(he.athlete_name, a.name) AS athlete_name,
              he.school_id, he.school_name, he.band_id, gb.label AS band_label,
              COUNT(DISTINCT he.event_item_id) AS event_count,
              SUM(CASE WHEN he.rank_no = 1 THEN 1 ELSE 0 END) AS first_count,
              SUM(CASE WHEN he.rank_no = 2 THEN 1 ELSE 0 END) AS second_count,
              SUM(CASE WHEN he.rank_no = 3 THEN 1 ELSE 0 END) AS third_count,
              SUM(CASE WHEN he.status_code IN ('DNS','DNF','DQ','NM','WD') THEN 1 ELSE 0 END) AS abnormal_count
         FROM heat_entry he
         LEFT JOIN athlete a ON a.id = he.athlete_id
         LEFT JOIN group_band gb ON gb.id = he.band_id
        WHERE ${where.join(' AND ')}
        GROUP BY he.athlete_id, he.athlete_name, a.name, he.school_id, he.school_name,
                 he.band_id, gb.label
        ORDER BY first_count DESC, second_count DESC, third_count DESC, athlete_name`, p
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/** GET /api/track-stats/query/athlete/:id/detail 单人全部成绩 */
router.get('/query/athlete/:id/detail', async (req, res, next) => {
  try {
    const { competition_id } = req.query;
    const rows = await query(
      `SELECT he.*, e.name AS event_name, e.event_unit, h.round_code, h.heat_no, h.heat_name,
              gb.label AS band_label
         FROM heat_entry he
         JOIN track_heat h ON h.id = he.heat_id
         JOIN event_item e ON e.id = he.event_item_id
         LEFT JOIN group_band gb ON gb.id = he.band_id
        WHERE he.competition_id = ? AND he.athlete_id = ?
        ORDER BY e.sort_no, h.round_no`, [competition_id, req.params.id]
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/** GET /api/track-stats/query/schools 按单位查 */
router.get('/query/schools', async (req, res, next) => {
  try {
    const { competition_id, band_id } = req.query;
    let where = ['he.competition_id = ?'];
    const p = [competition_id];
    if (band_id) { where.push('he.band_id = ?'); p.push(band_id); }
    const rows = await query(
      `SELECT he.school_id, he.school_name,
              COUNT(*) AS entry_count,
              COUNT(DISTINCT he.athlete_id) AS athlete_count,
              COUNT(DISTINCT he.event_item_id) AS event_count,
              SUM(CASE WHEN he.rank_no = 1 THEN 1 ELSE 0 END) AS first_count,
              SUM(CASE WHEN he.rank_no = 2 THEN 1 ELSE 0 END) AS second_count,
              SUM(CASE WHEN he.rank_no = 3 THEN 1 ELSE 0 END) AS third_count,
              SUM(COALESCE(he.score, 0)) AS score_total
         FROM heat_entry he
        WHERE ${where.join(' AND ')}
        GROUP BY he.school_id, he.school_name
        ORDER BY first_count DESC, second_count DESC, third_count DESC`, p
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/** GET /api/track-stats/query/events 按项目查（每个项目的成绩分布） */
router.get('/query/events', async (req, res, next) => {
  try {
    const { competition_id, band_id } = req.query;
    let where = ['he.competition_id = ?'];
    const p = [competition_id];
    if (band_id) { where.push('he.band_id = ?'); p.push(band_id); }
    const rows = await query(
      `SELECT he.event_item_id, e.name AS event_name, e.event_type, e.event_unit,
              he.band_id, gb.label AS band_label,
              COUNT(*) AS entry_count,
              SUM(CASE WHEN he.rank_no IS NOT NULL THEN 1 ELSE 0 END) AS ranked_count,
              SUM(CASE WHEN he.status_code IN ('DNS','DNF','DQ','NM','WD') THEN 1 ELSE 0 END) AS abnormal_count,
              MIN(CASE WHEN e.is_higher_better = 1 THEN he.result_value END) AS worst_value,
              MAX(CASE WHEN e.is_higher_better = 1 THEN he.result_value END) AS best_value,
              MIN(CASE WHEN e.is_higher_better = 0 AND he.result_value > 0 THEN he.result_value END) AS best_time,
              MAX(CASE WHEN e.is_higher_better = 0 THEN he.result_value END) AS worst_time
         FROM heat_entry he
         JOIN event_item e ON e.id = he.event_item_id
         LEFT JOIN group_band gb ON gb.id = he.band_id
        WHERE ${where.join(' AND ')}
        GROUP BY he.event_item_id, e.name, e.event_type, e.event_unit, he.band_id, gb.label
        ORDER BY e.sort_no, he.band_id`, p
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/** GET /api/track-stats/query/summary 总览 */
router.get('/query/summary', async (req, res, next) => {
  try {
    const cid = req.query.competition_id;
    const [schools, athletes, entries, heats, grades, records] = await Promise.all([
      queryOne('SELECT COUNT(DISTINCT school_id) AS c FROM heat_entry WHERE competition_id = ?', [cid]),
      queryOne('SELECT COUNT(DISTINCT athlete_id) AS c FROM heat_entry WHERE competition_id = ?', [cid]),
      queryOne('SELECT COUNT(*) AS c FROM heat_entry WHERE competition_id = ?', [cid]),
      queryOne('SELECT COUNT(*) AS c, SUM(confirm_flag) AS confirmed FROM track_heat WHERE competition_id = ?', [cid]),
      queryOne('SELECT COUNT(*) AS c FROM grade_achievement WHERE competition_id = ? AND confirm_flag = 1', [cid]),
      queryOne('SELECT COUNT(*) AS c FROM record_break WHERE competition_id = ? AND confirm_flag = 1', [cid])
    ]);
    res.json(ok({
      school_count: Number(schools?.c) || 0,
      athlete_count: Number(athletes?.c) || 0,
      entry_count: Number(entries?.c) || 0,
      heat_count: Number(heats?.c) || 0,
      confirmed_heat_count: Number(heats?.confirmed) || 0,
      grade_count: Number(grades?.c) || 0,
      record_break_count: Number(records?.c) || 0
    }));
  } catch (e) { next(e); }
});

// ============================================================
// 20. 公开页设置
// ============================================================

/** GET/PUT /api/track-stats/public-config?competition_id= */
router.get('/public-config', async (req, res, next) => {
  try {
    const c = await queryOne(
      'SELECT id, uuid, name, public_flag, public_note FROM competition WHERE id = ?',
      [req.query.competition_id]
    );
    res.json(ok(c));
  } catch (e) { next(e); }
});

router.put('/public-config', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    let uuid = b.uuid;
    if (!uuid) {
      const c = await queryOne('SELECT uuid FROM competition WHERE id = ?', [b.competition_id]);
      uuid = c?.uuid;
      if (!uuid) {
        uuid = require('crypto').randomUUID().replace(/-/g, '').slice(0, 24);
        await execute('UPDATE competition SET uuid = ? WHERE id = ?', [uuid, b.competition_id]);
      }
    }

    // 【副作用修复】原来不管传什么，都会顺手把 public_flag 写成 0 ——
    // 「打开大屏控制端」「生成分享码」这类操作会偷偷把公开成绩查询关掉。
    // 现在只有明确传了 public_flag 才改它；只传 generate_uuid 时不动开关。
    if (b.public_flag !== undefined) {
      await execute(
        'UPDATE competition SET public_flag = ?, public_note = ? WHERE id = ?',
        [Number(b.public_flag) === 1 ? 1 : 0, b.public_note ?? null, b.competition_id]
      );
    } else {
      const sets = ['uuid = ?'];
      const params = [uuid];
      if (b.public_note !== undefined) { sets.push('public_note = ?'); params.push(b.public_note); }
      params.push(b.competition_id);
      await execute(`UPDATE competition SET ${sets.join(', ')} WHERE id = ?`, params);
    }

    res.json(ok({ uuid }, '已保存'));
  } catch (e) { next(e); }
});

/** POST /api/track-stats/public-config/reset-uuid 重新生成分享码 */
router.post('/public-config/reset-uuid', roleRequired(1), async (req, res, next) => {
  try {
    const uuid = require('crypto').randomUUID().replace(/-/g, '').slice(0, 24);
    await execute('UPDATE competition SET uuid = ? WHERE id = ?', [uuid, req.body.competition_id]);
    res.json(ok({ uuid }, '分享码已重新生成'));
  } catch (e) { next(e); }
});

module.exports = router;
