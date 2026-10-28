const express = require('express');
const { query, queryOne, execute, transaction, ok, fail } = require('../db');
const { authRequired, roleRequired, scopeSchoolId } = require('../middleware/auth');
const { bandLabel, birthText, birthFromIdCard } = require('../utils/helpers');
const { buildRosterPdf } = require('../services/rosterPdf');
const { buildBadgePdf } = require('../services/badgePdf');

const router = express.Router();
router.use(authRequired);

/**
 * 导出花名册 PDF
 * GET /api/entry/roster-pdf?competition_id=2&school_id=
 *
 * 版式：白底黑框线普通表格，一行一个运动员，所有学校连续排列
 * 只导出该赛事报名的运动员（田径按报名记录，球类按名单姓名），学校角色只导出本校
 */
router.get('/roster-pdf', async (req, res, next) => {
  try {
    const { competition_id, school_id } = req.query;
    if (!competition_id) return res.json(fail('缺少赛事参数'));

    const comp = await queryOne('SELECT id, name, year FROM competition WHERE id = ?', [competition_id]);
    if (!comp) return res.json(fail('赛事不存在'));

    // 学校角色强制只看本校
    const scopeId = scopeSchoolId(req) || school_id || null;

    const where = [];
    const params = [];
    if (scopeId) { where.push('a.school_id = ?'); params.push(scopeId); }

    let rows = await query(
      `SELECT a.id, a.name, a.gender, a.class_name, a.id_card, a.bib_no, a.photo,
              a.school_id, s.name AS school_name
       FROM athlete a
       JOIN school s ON s.id = a.school_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY s.stage, s.name, a.name`,
      params
    );

    // 只导出本赛事报名的运动员（与名册页筛选口径一致）
    const entries = await query(
      'SELECT DISTINCT athlete_id FROM athlete_entry WHERE competition_id = ?',
      [competition_id]
    );
    const idSet = new Set(entries.map((e) => e.athlete_id));

    const teams = await query(
      'SELECT roster_json FROM team_entry WHERE competition_id = ? AND roster_json IS NOT NULL',
      [competition_id]
    );
    const nameSet = new Set();
    for (const t of teams) {
      try {
        // roster_json 为 JSON 类型列时 mysql2 已自动解析为数组
        const arr = typeof t.roster_json === 'string' ? JSON.parse(t.roster_json) : t.roster_json;
        if (Array.isArray(arr)) {
          for (const m of arr) {
            if (m && m.name) nameSet.add(String(m.name).trim());
          }
        }
      } catch (e) { /* 忽略坏数据 */ }
    }

    rows = rows.filter((r) => idSet.has(r.id) || nameSet.has(String(r.name || '').trim()));

    // 由身份证号推算出生年月
    for (const r of rows) {
      r.birth = birthText(r.id_card);
    }

    const title = `${comp.name}运动员名单`;
    const filename = `${title}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="athlete-roster.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.setHeader('Cache-Control', 'no-store');

    const doc = buildRosterPdf({ competitionName: comp.name, title, rows });
    doc.pipe(res);
  } catch (e) { next(e); }
});

/**
 * 报名列表
 * GET /api/entry/list
 */
router.get('/list', async (req, res, next) => {
  try {
    const { competition_id, band_id, event_item_id, status, school_id } = req.query;
    const scopeId = scopeSchoolId(req);

    const where = ['te.competition_id = ?'];
    const params = [competition_id];

    // 学校端强制只看本校（即使传了 school_id 也不生效）；管理员可按筛选的学校过滤
    if (scopeId) { where.push('te.school_id = ?'); params.push(scopeId); }
    else if (school_id) { where.push('te.school_id = ?'); params.push(school_id); }
    if (band_id) { where.push('te.band_id = ?'); params.push(band_id); }
    if (event_item_id) { where.push('te.event_item_id = ?'); params.push(event_item_id); }
    if (status) { where.push('te.status = ?'); params.push(status); }

    const rows = await query(
      `SELECT te.*, s.name AS school_name, gb.stage, gb.gender, gb.label AS band_label,
              ei.name AS event_name, ei.category,
              EXISTS(SELECT 1 FROM match_info mi WHERE mi.team_a_id = te.id OR mi.team_b_id = te.id) AS has_match
       FROM team_entry te
       JOIN school s ON s.id = te.school_id
       JOIN group_band gb ON gb.id = te.band_id
       JOIN event_item ei ON ei.id = te.event_item_id
       WHERE ${where.join(' AND ')}
       ORDER BY gb.stage, gb.gender, ei.name, s.name`,
      params
    );

    res.json(ok(rows.map((r) => ({ ...r, band_label: bandLabel(r) }))));
  } catch (e) { next(e); }
});

/**
 * 个人报名列表（田径）
 */
router.get('/athlete-list', async (req, res, next) => {
  try {
    const { competition_id, band_id, event_item_id, school_id } = req.query;
    const scopeId = scopeSchoolId(req);

    const where = ['ae.competition_id = ?'];
    const params = [competition_id];
    // 学校端强制只看本校；管理员可按筛选的学校过滤
    if (scopeId) { where.push('a.school_id = ?'); params.push(scopeId); }
    else if (school_id) { where.push('a.school_id = ?'); params.push(school_id); }
    if (band_id) { where.push('ae.band_id = ?'); params.push(band_id); }
    if (event_item_id) { where.push('ae.event_item_id = ?'); params.push(event_item_id); }

    const rows = await query(
      `SELECT ae.*, a.name, a.gender, a.class_name, a.student_no, a.bib_no,
              s.name AS school_name, gb.stage, gb.gender AS band_gender, gb.label AS band_label,
              ei.name AS event_name,
              EXISTS(SELECT 1 FROM heat_entry he
                     WHERE he.athlete_id = ae.athlete_id
                       AND he.event_item_id = ae.event_item_id
                       AND he.competition_id = ae.competition_id) AS has_heat
       FROM athlete_entry ae
       JOIN athlete a ON a.id = ae.athlete_id
       JOIN school s ON s.id = a.school_id
       JOIN group_band gb ON gb.id = ae.band_id
       JOIN event_item ei ON ei.id = ae.event_item_id
       WHERE ${where.join(' AND ')}
       ORDER BY gb.stage, gb.gender, ei.name, s.name, a.name`,
      params
    );
    res.json(ok(rows.map((r) => ({ ...r, band_label: bandLabel(r) }))));
  } catch (e) { next(e); }
});

/**
 * 提交球队报名
 * POST /api/entry/team
 */
router.post('/team', async (req, res, next) => {
  try {
    const { competition_id, band_id, event_item_id, team_name, leader_name, coach_name, roster } = req.body;
    if (!competition_id || !band_id || !event_item_id || !team_name) {
      return res.json(fail('请填写完整'));
    }

    // 学校角色强制用自己学校
    const schoolId = req.user.role === 2 ? req.user.school_id : (req.body.school_id || 0);
    if (!schoolId) return res.json(fail('请选择学校'));

    // 同组别同项目同校唯一
    const dup = await queryOne(
      'SELECT id FROM team_entry WHERE band_id=? AND event_item_id=? AND school_id=?',
      [band_id, event_item_id, schoolId]
    );
    if (dup) return res.json(fail('本校在该组别该项目已报名，请勿重复提交'));

    // 组别校验：学校学段与组别学段必须一致
    const band = await queryOne('SELECT * FROM group_band WHERE id = ?', [band_id]);
    const school = await queryOne('SELECT * FROM school WHERE id = ?', [schoolId]);
    if (band && school && band.stage !== school.stage) {
      return res.json(fail(`组别学段不匹配：${school.name} 属于${['小学','初中','高中'][school.stage - 1]}`));
    }

    const r = await execute(
      `INSERT INTO team_entry (competition_id, band_id, event_item_id, school_id, team_name, leader_name, coach_name, roster_json)
       VALUES (?,?,?,?,?,?,?,?)`,
      [competition_id, band_id, event_item_id, schoolId, team_name,
       leader_name || null, coach_name || null,
       roster ? JSON.stringify(roster) : null]
    );
    res.json(ok({ id: r.insertId }, '报名已提交，等待审核'));
  } catch (e) { next(e); }
});

/**
 * 修改球队报名
 */
router.put('/team/:id', async (req, res, next) => {
  try {
    const { team_name, leader_name, coach_name, roster, band_id, event_item_id } = req.body;
    const entry = await queryOne('SELECT * FROM team_entry WHERE id = ?', [req.params.id]);
    if (!entry) return res.json(fail('报名不存在'));
    if (req.user.role === 2 && entry.school_id !== req.user.school_id) {
      return res.json(fail('无权修改其他学校的报名'));
    }

    // 组别 / 项目：不传则保持原值
    const newBand = band_id != null && band_id !== '' ? Number(band_id) : entry.band_id;
    const newItem = event_item_id != null && event_item_id !== '' ? Number(event_item_id) : entry.event_item_id;
    const changed = newBand !== entry.band_id || newItem !== entry.event_item_id;

    if (changed) {
      // 已进入赛程的不能改，否则场次会对不上
      const used = await queryOne(
        'SELECT id FROM match_info WHERE team_a_id = ? OR team_b_id = ? LIMIT 1',
        [req.params.id, req.params.id]
      );
      if (used) {
        return res.json(fail('该队已进入赛程，不能修改组别或项目。如需调整，请先到「赛程编排」删除相关场次'));
      }
      // 同一组别+项目下本校只能有一支队
      const dup = await queryOne(
        'SELECT id FROM team_entry WHERE band_id = ? AND event_item_id = ? AND school_id = ? AND id <> ?',
        [newBand, newItem, entry.school_id, req.params.id]
      );
      if (dup) return res.json(fail('该组别和项目下本校已有报名，不能重复'));
    }

    await execute(
      'UPDATE team_entry SET band_id=?, event_item_id=?, team_name=?, leader_name=?, coach_name=?, roster_json=?, status=? WHERE id=?',
      [newBand,
       newItem,
       team_name != null && team_name !== '' ? team_name : entry.team_name,
       leader_name !== undefined ? leader_name : entry.leader_name,
       coach_name !== undefined ? coach_name : entry.coach_name,
       roster !== undefined ? (roster ? JSON.stringify(roster) : null) : entry.roster_json,
       // 改了组别或项目，参赛资格就变了，退回待审核重走一遍
       changed ? 1 : entry.status,
       req.params.id]
    );
    res.json(ok({ needAudit: changed }, changed ? '已保存，需重新审核' : '已保存'));
  } catch (e) { next(e); }
});

/**
 * 修改个人报名（组别 / 项目 / 运动员）
 * 已进入赛次的报名不允许改动，避免赛次名单与报名对不上
 */
router.put('/athlete-entry/:id', async (req, res, next) => {
  try {
    const { band_id, event_item_id, athlete_id } = req.body;
    const row = await queryOne(
      `SELECT ae.*, a.school_id
       FROM athlete_entry ae JOIN athlete a ON a.id = ae.athlete_id
       WHERE ae.id = ?`, [req.params.id]);
    if (!row) return res.json(fail('报名不存在'));
    if (req.user.role === 2 && row.school_id !== req.user.school_id) {
      return res.json(fail('无权修改其他学校的报名'));
    }

    const newBand = band_id != null && band_id !== '' ? Number(band_id) : row.band_id;
    const newItem = event_item_id != null && event_item_id !== '' ? Number(event_item_id) : row.event_item_id;
    const newAthlete = athlete_id != null && athlete_id !== '' ? Number(athlete_id) : row.athlete_id;
    const changed = newBand !== row.band_id || newItem !== row.event_item_id || newAthlete !== row.athlete_id;

    if (changed) {
      const used = await queryOne(
        'SELECT id FROM heat_entry WHERE athlete_id = ? AND event_item_id = ? AND competition_id = ? LIMIT 1',
        [row.athlete_id, row.event_item_id, row.competition_id]
      );
      if (used) {
        return res.json(fail('该报名已进入赛次，不能修改。如需调整，请先到「成绩录入」删除相关赛次'));
      }
      const dup = await queryOne(
        'SELECT id FROM athlete_entry WHERE athlete_id = ? AND event_item_id = ? AND id <> ?',
        [newAthlete, newItem, req.params.id]
      );
      if (dup) return res.json(fail('该运动员已经报过这个项目'));
      // 学校端换人时只能选本校的运动员
      if (req.user.role === 2 && newAthlete !== row.athlete_id) {
        const a = await queryOne('SELECT school_id FROM athlete WHERE id = ?', [newAthlete]);
        if (!a || a.school_id !== req.user.school_id) {
          return res.json(fail('只能选择本校运动员'));
        }
      }
    }

    await execute(
      'UPDATE athlete_entry SET band_id=?, event_item_id=?, athlete_id=?, status=? WHERE id=?',
      [newBand, newItem, newAthlete,
       // 组别 / 项目 / 运动员任一变动，都退回待审核
       changed ? 1 : row.status,
       req.params.id]
    );
    res.json(ok({ needAudit: changed }, changed ? '已保存，需重新审核' : '已保存'));
  } catch (e) { next(e); }
});

/**
 * 删除报名
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const entry = await queryOne('SELECT * FROM team_entry WHERE id = ?', [req.params.id]);
    if (!entry) return res.json(fail('报名不存在'));
    if (req.user.role === 2 && entry.school_id !== req.user.school_id) {
      return res.json(fail('无权删除其他学校的报名'));
    }
    await execute('DELETE FROM team_entry WHERE id = ?', [req.params.id]);
    res.json(ok(null, '已删除'));
  } catch (e) { next(e); }
});

/**
 * 审核报名
 * POST /api/entry/audit
 */
router.post('/audit', roleRequired(1), async (req, res, next) => {
  try {
    const { id, status, reject_reason } = req.body;
    if (!id || !status) return res.json(fail('参数不完整'));
    await execute(
      'UPDATE team_entry SET status=?, reject_reason=? WHERE id=?',
      [status, reject_reason || null, id]
    );
    res.json(ok(null, status === 2 ? '已通过' : '已驳回'));
  } catch (e) { next(e); }
});

/**
 * 批量审核
 */
router.post('/audit-batch', roleRequired(1), async (req, res, next) => {
  try {
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.json(fail('请选择要审核的项'));
    const placeholders = ids.map(() => '?').join(',');
    await execute(
      `UPDATE team_entry SET status=? WHERE id IN (${placeholders})`,
      [status, ...ids]
    );
    res.json(ok({ count: ids.length }, `已处理 ${ids.length} 条`));
  } catch (e) { next(e); }
});

/**
 * 生成参赛证 PDF
 * GET /api/entry/badge-pdf?competition_id=2          → 该赛事全部报名运动员（A4 一页 4 证）
 * GET /api/entry/badge-pdf?competition_id=2&athlete_id=5 → 单个运动员
 *
 * 数据来源：
 *   - 田径个人报名 athlete_entry → 组别 + 项目
 *   - 球类团体报名 team_entry.roster_json → 按（学校+姓名）匹配组别 + 项目
 *   - 运动员档案 athlete → 照片 / 身份证号（出生年月）/ 号码 / 学校
 */
router.get('/badge-pdf', async (req, res, next) => {
  try {
    const { competition_id, athlete_id } = req.query;
    if (!competition_id) return res.json(fail('缺少赛事参数'));

    const comp = await queryOne('SELECT id, name FROM competition WHERE id = ?', [competition_id]);
    if (!comp) return res.json(fail('赛事不存在'));

    const scopeId = scopeSchoolId(req);

    // ── 1. 田径个人报名 → athlete_id → { band, events } ──
    const aeRows = await query(
      `SELECT ae.athlete_id, gb.stage, gb.gender, gb.label, ei.name AS event_name
       FROM athlete_entry ae
       JOIN group_band gb ON gb.id = ae.band_id
       JOIN event_item ei ON ei.id = ae.event_item_id
       WHERE ae.competition_id = ?`,
      [competition_id]
    );
    const trackMap = new Map();
    for (const r of aeRows) {
      if (!trackMap.has(r.athlete_id)) {
        trackMap.set(r.athlete_id, { band: '', events: new Set() });
      }
      const t = trackMap.get(r.athlete_id);
      if (!t.band) t.band = bandLabel(r);
      if (r.event_name) t.events.add(r.event_name);
    }

    // ── 2. 球类团体报名 → (school_id|姓名) → { band, events, bib } ──
    const teRows = await query(
      `SELECT te.school_id, te.band_id, te.roster_json,
              gb.stage, gb.gender, gb.label, ei.name AS event_name
       FROM team_entry te
       JOIN group_band gb ON gb.id = te.band_id
       JOIN event_item ei ON ei.id = te.event_item_id
       WHERE te.competition_id = ? AND te.roster_json IS NOT NULL`,
      [competition_id]
    );
    const teamMap = new Map();
    for (const t of teRows) {
      try {
        // roster_json 为 JSON 类型列时 mysql2 已自动解析为数组
        const arr = typeof t.roster_json === 'string' ? JSON.parse(t.roster_json) : t.roster_json;
        if (!Array.isArray(arr)) continue;
        for (const m of arr) {
          if (!m || !m.name) continue;
          const key = `${t.school_id}|${String(m.name).trim()}`;
          if (!teamMap.has(key)) {
            teamMap.set(key, { band: '', events: new Set(), bib: '' });
          }
          const tm = teamMap.get(key);
          if (!tm.band) tm.band = bandLabel(t);
          if (t.event_name) tm.events.add(t.event_name);
          if (m.bib_no != null && String(m.bib_no) !== '') tm.bib = String(m.bib_no);
        }
      } catch (e) { /* 忽略坏数据 */ }
    }

    // ── 3. 运动员基础信息 ──
    let rows;
    if (athlete_id) {
      rows = await query(
        `SELECT a.id, a.school_id, a.name, a.id_card, a.bib_no, a.photo, s.name AS school_name
         FROM athlete a JOIN school s ON s.id = a.school_id WHERE a.id = ?`,
        [athlete_id]
      );
      if (rows.length && scopeId && rows[0].school_id !== scopeId) {
        return res.json(fail('无权打印其他学校的参赛证'));
      }
    } else {
      const where = scopeId ? 'WHERE a.school_id = ?' : '';
      const params = scopeId ? [scopeId] : [];
      rows = await query(
        `SELECT a.id, a.school_id, a.name, a.id_card, a.bib_no, a.photo, s.name AS school_name
         FROM athlete a JOIN school s ON s.id = a.school_id ${where}
         ORDER BY s.stage, s.name, a.name`,
        params
      );
      // 只保留本赛事报名的运动员（田径按 id，球类按 学校+姓名）
      rows = rows.filter(
        (r) => trackMap.has(r.id) || teamMap.has(`${r.school_id}|${String(r.name || '').trim()}`)
      );
    }

    const cards = rows.map((r) => {
      const t = trackMap.get(r.id);
      const tm = teamMap.get(`${r.school_id}|${String(r.name || '').trim()}`);
      const events = [...((t && t.events) || (tm && tm.events) || [])];
      return {
        compName: comp.name,
        name: r.name,
        band: (t && t.band) || (tm && tm.band) || '',
        events: events.join('、'),
        birth: birthText(r.id_card),
        bib: r.bib_no || (tm && tm.bib) || '',
        unit: r.school_name,
        photo: r.photo
      };
    });

    res.setHeader('Content-Type', 'application/pdf');
    const filename = `${comp.name}参赛证.pdf`;
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="athlete-badge.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.setHeader('Cache-Control', 'no-store');

    const doc = buildBadgePdf({ competitionName: comp.name, cards });
    doc.pipe(res);
  } catch (e) { next(e); }
});

/**
 * 运动员名册（学校端维护）
 */
router.get('/athletes', async (req, res, next) => {
  try {
    const schoolId = scopeSchoolId(req);
    const { competition_id } = req.query;
    const where = schoolId ? 'WHERE a.school_id = ?' : '';
    const params = schoolId ? [schoolId] : [];

    // 列表不返回学籍表正文（体积大），只返回文件名，需要时单独取
    let rows = await query(
      `SELECT a.id, a.school_id, a.name, a.gender, a.class_name, a.student_no, a.id_card, a.bib_no,
              a.photo, a.student_card_name, a.student_card_type, a.created_at,
              s.name AS school_name,
              CASE WHEN a.student_card IS NULL OR a.student_card = '' THEN 0 ELSE 1 END AS has_card
       FROM athlete a
       JOIN school s ON s.id = a.school_id ${where} ORDER BY s.name, a.name`,
      params
    );

    // 按赛事筛选：田径个人报名按 athlete_id 匹配；球类团体报名按名单姓名匹配
    if (competition_id) {
      const cid = Number(competition_id);
      if (Number.isFinite(cid) && cid > 0) {
        const entries = await query(
          'SELECT DISTINCT athlete_id FROM athlete_entry WHERE competition_id = ?',
          [cid]
        );
        const idSet = new Set(entries.map((e) => e.athlete_id));

        const teams = await query(
          'SELECT roster_json FROM team_entry WHERE competition_id = ? AND roster_json IS NOT NULL',
          [cid]
        );
        const nameSet = new Set();
        for (const t of teams) {
          try {
            // roster_json 为 JSON 类型列时 mysql2 已自动解析为数组
            const arr = typeof t.roster_json === 'string' ? JSON.parse(t.roster_json) : t.roster_json;
            if (Array.isArray(arr)) {
              for (const m of arr) {
                if (m && m.name) nameSet.add(String(m.name).trim());
              }
            }
          } catch (e) { /* 忽略坏数据 */ }
        }

        rows = rows.filter(
          (r) => idSet.has(r.id) || nameSet.has(String(r.name || '').trim())
        );
      }
    }

    // 由身份证号推算出生年月
    for (const r of rows) {
      r.birth = birthText(r.id_card);
    }

    res.json(ok(rows));
  } catch (e) { next(e); }
});

/**
 * 取出学籍表正文（点击查看时调用）
 * GET /api/entry/athletes/:id/card
 */
router.get('/athletes/:id/card', async (req, res, next) => {
  try {
    const row = await queryOne(
      'SELECT id, school_id, name, student_card, student_card_name, student_card_type FROM athlete WHERE id = ?',
      [req.params.id]
    );
    if (!row) return res.json(fail('运动员不存在'));
    if (req.user.role === 2 && row.school_id !== req.user.school_id) {
      return res.json(fail('无权查看其他学校的资料'));
    }
    if (!row.student_card) return res.json(fail('该运动员未上传学籍表'));
    res.json(ok({
      name: row.name,
      file_name: row.student_card_name,
      file_type: row.student_card_type,
      data: row.student_card
    }));
  } catch (e) { next(e); }
});

/**
 * 新增运动员
 */
router.post('/athletes', async (req, res, next) => {
  try {
    const {
      name, gender, class_name, student_no, id_card, school_id,
      photo, student_card, student_card_name, student_card_type
    } = req.body;
    if (!name) return res.json(fail('请填写姓名'));
    const sid = req.user.role === 2 ? req.user.school_id : school_id;
    if (!sid) return res.json(fail('请选择学校'));

    const idCardVal = String(id_card || '').trim().toUpperCase() || null;

    // 身份证号格式校验 + 查重
    if (idCardVal) {
      if (!birthFromIdCard(idCardVal)) {
        return res.json(fail('身份证号格式不正确'));
      }
      const dup = await queryOne('SELECT id, name FROM athlete WHERE id_card = ? AND id <> 0', [idCardVal]);
      if (dup) return res.json(fail(`该身份证号已存在（${dup.name}）`));
    }

    // 体积保护
    if (photo && photo.length > 2 * 1024 * 1024) {
      return res.json(fail('照片过大，请重新上传（压缩后应小于 2MB）'));
    }
    if (student_card && student_card.length > 8 * 1024 * 1024) {
      return res.json(fail('学籍表过大，请压缩后重试（小于 8MB）'));
    }

    const r = await execute(
      `INSERT INTO athlete
        (school_id, name, gender, class_name, student_no, id_card, photo, student_card, student_card_name, student_card_type)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [sid, name, gender || 1, class_name || null, student_no || null, idCardVal,
       photo || null, student_card || null, student_card_name || null, student_card_type || null]
    );
    res.json(ok({ id: r.insertId }, '已添加'));
  } catch (e) { next(e); }
});

/**
 * 修改运动员
 * PUT /api/entry/athletes/:id
 */
router.put('/athletes/:id', async (req, res, next) => {
  try {
    const a = await queryOne('SELECT * FROM athlete WHERE id = ?', [req.params.id]);
    if (!a) return res.json(fail('运动员不存在'));
    if (req.user.role === 2 && a.school_id !== req.user.school_id) {
      return res.json(fail('无权修改其他学校的运动员'));
    }

    const {
      name, gender, class_name, student_no, id_card, school_id,
      photo, student_card, student_card_name, student_card_type
    } = req.body;
    if (!name) return res.json(fail('请填写姓名'));

    const idCardVal = String(id_card || '').trim().toUpperCase() || null;

    // 身份证号格式校验 + 查重（排除自己）
    if (idCardVal) {
      if (!birthFromIdCard(idCardVal)) {
        return res.json(fail('身份证号格式不正确'));
      }
      const dup = await queryOne('SELECT id, name FROM athlete WHERE id_card = ? AND id <> ?',
        [idCardVal, req.params.id]);
      if (dup) return res.json(fail(`该身份证号已存在（${dup.name}）`));
    }

    if (photo && photo.length > 2 * 1024 * 1024) {
      return res.json(fail('照片过大，请重新上传'));
    }
    if (student_card && student_card.length > 8 * 1024 * 1024) {
      return res.json(fail('学籍表过大，请压缩后重试'));
    }

    // 只有教育局可以改归属学校
    const sid = req.user.role === 1 && school_id ? school_id : a.school_id;

    // 照片：传了空字符串表示清除；undefined 表示不改
    const photoVal = photo === undefined ? a.photo : (photo || null);
    const cardVal = student_card === undefined ? a.student_card : (student_card || null);
    const cardNameVal = student_card_name === undefined ? a.student_card_name : (student_card_name || null);
    const cardTypeVal = student_card_type === undefined ? a.student_card_type : (student_card_type || null);

    await execute(
      `UPDATE athlete SET
        name = ?, gender = ?, class_name = ?, student_no = ?, id_card = ?, school_id = ?,
        photo = ?, student_card = ?, student_card_name = ?, student_card_type = ?
       WHERE id = ?`,
      [name, gender || a.gender, class_name || null, student_no || null, idCardVal, sid,
       photoVal, cardVal, cardNameVal, cardTypeVal, req.params.id]
    );
    res.json(ok(null, '已保存'));
  } catch (e) { next(e); }
});

/**
 * 删除运动员
 */
router.delete('/athletes/:id', async (req, res, next) => {
  try {
    const a = await queryOne('SELECT * FROM athlete WHERE id = ?', [req.params.id]);
    if (!a) return res.json(fail('不存在'));
    if (req.user.role === 2 && a.school_id !== req.user.school_id) {
      return res.json(fail('无权删除'));
    }
    await execute('DELETE FROM athlete_entry WHERE athlete_id = ?', [req.params.id]);
    await execute('DELETE FROM athlete WHERE id = ?', [req.params.id]);
    res.json(ok(null, '已删除'));
  } catch (e) { next(e); }
});

/**
 * 添加径赛项目报名
 */
router.post('/athlete', async (req, res, next) => {
  try {
    const { competition_id, band_id, athlete_id, event_item_id } = req.body;
    if (!competition_id || !band_id || !athlete_id || !event_item_id) {
      return res.json(fail('参数不完整'));
    }

    // 防重复
    const dup = await queryOne(
      'SELECT id FROM athlete_entry WHERE athlete_id=? AND event_item_id=?',
      [athlete_id, event_item_id]
    );
    if (dup) return res.json(fail('该运动员已报此项目'));

    // 兼项校验：每人最多 2 项（接力除外）
    const athlete = await queryOne('SELECT * FROM athlete WHERE id = ?', [athlete_id]);
    const event = await queryOne('SELECT * FROM event_item WHERE id = ?', [event_item_id]);
    if (req.user.role === 2 && athlete.school_id !== req.user.school_id) {
      return res.json(fail('无权为其他学校报名'));
    }

    if (event && !event.is_relay) {
      const count = await queryOne(
        `SELECT COUNT(*) AS c FROM athlete_entry ae
         JOIN event_item ei ON ei.id = ae.event_item_id
         WHERE ae.athlete_id = ? AND ei.is_relay = 0`,
        [athlete_id]
      );
      if (count.c >= 2) {
        return res.json(fail('每人最多限报 2 项（接力除外）'));
      }
    }

    const r = await execute(
      'INSERT INTO athlete_entry (competition_id, band_id, athlete_id, event_item_id) VALUES (?,?,?,?)',
      [competition_id, band_id, athlete_id, event_item_id]
    );
    res.json(ok({ id: r.insertId }, '报名已提交'));
  } catch (e) { next(e); }
});

/**
 * 审核个人报名
 */
router.post('/athlete-audit', roleRequired(1), async (req, res, next) => {
  try {
    const { id, status } = req.body;
    await execute('UPDATE athlete_entry SET status = ? WHERE id = ?', [status, id]);
    res.json(ok(null, status === 2 ? '已通过' : '已驳回'));
  } catch (e) { next(e); }
});

/**
 * 报名进度统计
 */
router.get('/progress', async (req, res, next) => {
  try {
    const { competition_id } = req.query;
    const rows = await query(
      `SELECT s.id, s.name, s.stage, s.short_name,
        (SELECT COUNT(*) FROM team_entry te WHERE te.school_id = s.id AND te.competition_id = ? AND te.status = 2) AS team_count,
        (SELECT COUNT(*) FROM athlete_entry ae JOIN athlete a ON a.id = ae.athlete_id
          WHERE a.school_id = s.id AND ae.competition_id = ? AND ae.status = 2) AS athlete_count,
        (SELECT COUNT(*) FROM team_entry te WHERE te.school_id = s.id AND te.competition_id = ? AND te.status = 1) AS pending_count
       FROM school s ORDER BY s.stage, s.name`,
      [competition_id, competition_id, competition_id]
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

module.exports = router;
