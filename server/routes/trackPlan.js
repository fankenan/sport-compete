/**
 * 第五期：日程可视化编排 / 秩序册 / 奖状 / 改期与锁
 * 挂载 /api/track-plan
 */
const express = require('express');
const { query, queryOne, execute, ok, fail } = require('../db');
const { authRequired, roleRequired } = require('../middleware/auth');
const timetable = require('../services/timetable');
const { buildOrderBookPdf } = require('../services/orderBookPdf');

const router = express.Router();
router.use(authRequired);

function parseJson(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

/** 检查某把锁，锁上时禁止写操作 */
const LOCK_COLUMN = {
  ENROLL: 'enroll_lock_flag',
  SCHEDULE: 'schedule_lock_flag',
  TIMETABLE: 'timetable_lock_flag',
  ORDER_BOOK: 'order_book_lock_flag'
};

async function assertUnlocked(competitionId, lockType) {
  const col = LOCK_COLUMN[lockType];
  if (!col) return;
  const c = await queryOne(`SELECT ${col} AS l FROM competition WHERE id = ?`, [competitionId]);
  if (c && Number(c.l) === 1) {
    const names = { ENROLL: '报名', SCHEDULE: '编排', TIMETABLE: '日程', ORDER_BOOK: '秩序册' };
    throw new Error(`${names[lockType]}已锁定，请先解锁再操作`);
  }
}

// ============================================================
// 22. 日程单元
// ============================================================

/** GET /api/track-plan/units?competition_id= */
router.get('/units', async (req, res, next) => {
  try {
    const rows = await query(
      'SELECT * FROM schedule_unit WHERE competition_id = ? ORDER BY unit_date, sort_no, id',
      [req.query.competition_id]
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/** POST /api/track-plan/units 新建/更新单元 */
router.post('/units', roleRequired(1), async (req, res, next) => {
  try {
    await assertUnlocked(req.body.competition_id, 'TIMETABLE');
    const b = req.body;
    if (!b.competition_id) return res.json(fail('缺少赛事 id'));
    if (!b.unit_date) return res.json(fail('请选择日期'));
    if (b.id) {
      await execute(
        'UPDATE schedule_unit SET unit_date=?, period=?, name=?, start_time=?, end_time=?, sort_no=? WHERE id=?',
        [b.unit_date, b.period || 'AM', b.name || null, b.start_time || null, b.end_time || null,
         b.sort_no ?? 0, b.id]
      );
      res.json(ok({ id: Number(b.id) }, '单元已更新'));
    } else {
      const r = await execute(
        'INSERT INTO schedule_unit (competition_id, unit_date, period, name, start_time, end_time, sort_no) VALUES (?,?,?,?,?,?,?)',
        [b.competition_id, b.unit_date, b.period || 'AM', b.name || null,
         b.start_time || null, b.end_time || null, b.sort_no ?? 0]
      );
      res.json(ok({ id: r.insertId }, '单元已创建'));
    }
  } catch (e) { next(e); }
});

router.delete('/units/:id', roleRequired(1), async (req, res, next) => {
  try {
    const u = await queryOne('SELECT * FROM schedule_unit WHERE id = ?', [req.params.id]);
    if (!u) return res.json(fail('单元不存在'));
    await assertUnlocked(u.competition_id, 'TIMETABLE');
    const used = await queryOne('SELECT COUNT(*) AS c FROM timetable_item WHERE unit_id = ?', [u.id]);
    if (Number(used?.c) > 0) return res.json(fail(`该单元下还有 ${used.c} 条日程，请先移除`));
    await execute('DELETE FROM schedule_unit WHERE id = ?', [u.id]);
    res.json(ok(null, '单元已删除'));
  } catch (e) { next(e); }
});

/** POST /api/track-plan/units/generate 按赛事起止日期批量生成单元 */
router.post('/units/generate', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, periods } = req.body; // periods: ['AM','PM']
    await assertUnlocked(competition_id, 'TIMETABLE');
    const c = await queryOne('SELECT start_date, end_date FROM competition WHERE id = ?', [competition_id]);
    if (!c?.start_date || !c?.end_date) return res.json(fail('请先设置赛事起止日期'));
    const list = periods && periods.length ? periods : ['AM', 'PM'];
    const timeMap = { AM: ['08:30', '11:30'], PM: ['14:00', '17:30'], NIGHT: ['19:00', '21:00'], FULL: ['08:30', '17:30'] };

    // 清掉还没有日程条目的旧单元
    await execute(
      `DELETE FROM schedule_unit WHERE competition_id = ?
         AND NOT EXISTS (SELECT 1 FROM timetable_item t WHERE t.unit_id = schedule_unit.id)`,
      [competition_id]
    );

    let n = 0, day = 1;
    const d = new Date(c.start_date);
    const end = new Date(c.end_date);
    while (d <= end) {
      const dateStr = d.toISOString().slice(0, 10);
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const [st, et] = timeMap[p] || ['08:30', '11:30'];
        await execute(
          'INSERT INTO schedule_unit (competition_id, unit_date, period, name, start_time, end_time, sort_no) VALUES (?,?,?,?,?,?,?)',
          [competition_id, dateStr, p, `第${day}天${p === 'AM' ? '上午' : p === 'PM' ? '下午' : p === 'NIGHT' ? '晚间' : '全天'}`,
           st + ':00', et + ':00', (day - 1) * 10 + i]
        );
        n++;
      }
      d.setDate(d.getDate() + 1);
      day++;
    }
    res.json(ok({ count: n }, `已生成 ${n} 个日程单元`));
  } catch (e) { next(e); }
});

// ============================================================
// 22b. 日程条目
// ============================================================

/** GET /api/track-plan/items?competition_id=[&unit_id] */
router.get('/items', async (req, res, next) => {
  try {
    const { competition_id, unit_id } = req.query;
    let sql = `
      SELECT t.*, u.unit_date, u.period, u.name AS unit_name,
             v.name AS venue_name, e.name AS event_name, gb.label AS band_label,
             h.confirm_flag, h.entry_count AS heat_entry_count
        FROM timetable_item t
        LEFT JOIN schedule_unit u ON u.id = t.unit_id
        LEFT JOIN venue v ON v.id = t.venue_id
        LEFT JOIN event_item e ON e.id = t.event_item_id
        LEFT JOIN group_band gb ON gb.id = t.band_id
        LEFT JOIN track_heat h ON h.id = t.heat_id
       WHERE t.competition_id = ?`;
    const p = [competition_id];
    if (unit_id) { sql += ' AND t.unit_id = ?'; p.push(unit_id); }
    sql += ' ORDER BY u.unit_date, u.sort_no, t.start_time, t.sort_no';
    res.json(ok(await query(sql, p)));
  } catch (e) { next(e); }
});

/** GET /api/track-plan/pending-heats?competition_id= 还没排进日程的赛次 */
router.get('/pending-heats', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT h.*, e.name AS event_name, e.event_type, gb.label AS band_label
         FROM track_heat h
         JOIN event_item e ON e.id = h.event_item_id
         LEFT JOIN group_band gb ON gb.id = h.band_id
        WHERE h.competition_id = ?
          AND NOT EXISTS (SELECT 1 FROM timetable_item t WHERE t.heat_id = h.id)
        ORDER BY e.sort_no, h.round_no, h.heat_no`, [req.query.competition_id]
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/** POST /api/track-plan/arrange 自动排布 */
router.post('/arrange', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    await assertUnlocked(b.competition_id, 'TIMETABLE');
    const r = await timetable.autoArrange(Number(b.competition_id), { clear: b.clear ?? true });
    res.json(ok(r, `已排入 ${r.placed} 条${r.skipped ? `，${r.skipped} 条放不下` : ''}${r.conflicts ? `，检测到 ${r.conflicts} 处冲突` : ''}`));
  } catch (e) { next(e); }
});

/** PUT /api/track-plan/item/:id 拖拽改时间 / 换单元场地 / 锁 */
router.put('/item/:id', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    const it = await queryOne('SELECT * FROM timetable_item WHERE id = ?', [req.params.id]);
    if (!it) return res.json(fail('条目不存在'));
    await assertUnlocked(it.competition_id, 'TIMETABLE');

    const fields = [];
    const p = [];
    for (const k of ['unit_id', 'venue_id', 'start_time', 'end_time', 'estimated_minutes', 'locked_flag', 'sort_no', 'title']) {
      if (b[k] !== undefined) { fields.push(`${k} = ?`); p.push(b[k]); }
    }
    if (b.start_time !== undefined && b.estimated_minutes !== undefined) {
      const s = timetable.toMinutes(b.start_time);
      if (s !== null) {
        fields.push('end_time = ?');
        p.push(timetable.toTimeStr(s + Number(b.estimated_minutes || 10)));
      }
    }
    if (!fields.length) return res.json(fail('没有要修改的字段'));
    p.push(it.id);
    await execute(`UPDATE timetable_item SET ${fields.join(', ')} WHERE id = ?`, p);

    await timetable.detectConflicts(it.competition_id);
    res.json(ok(null, '已更新'));
  } catch (e) { next(e); }
});

router.delete('/item/:id', roleRequired(1), async (req, res, next) => {
  try {
    const it = await queryOne('SELECT * FROM timetable_item WHERE id = ?', [req.params.id]);
    if (!it) return res.json(fail('条目不存在'));
    await assertUnlocked(it.competition_id, 'TIMETABLE');
    await execute('DELETE FROM timetable_conflict WHERE item_id = ? OR other_item_id = ?', [it.id, it.id]);
    await execute('DELETE FROM timetable_item WHERE id = ?', [it.id]);
    res.json(ok(null, '已移除'));
  } catch (e) { next(e); }
});

/** POST /api/track-plan/item 手动添加一条（非赛次的，如开幕式） */
router.post('/item', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    await assertUnlocked(b.competition_id, 'TIMETABLE');
    if (!b.competition_id) return res.json(fail('缺少赛事 id'));
    if (!b.title) return res.json(fail('请填写标题'));
    const r = await execute(
      `INSERT INTO timetable_item
        (competition_id, unit_id, venue_id, title, start_time, end_time, estimated_minutes, sort_no)
       VALUES (?,?,?,?,?,?,?,?)`,
      [b.competition_id, b.unit_id ?? null, b.venue_id ?? null, b.title,
       b.start_time || null, b.end_time || null, b.estimated_minutes ?? 10, b.sort_no ?? 0]
    );
    res.json(ok({ id: r.insertId }, '已添加'));
  } catch (e) { next(e); }
});

/** GET /api/track-plan/conflicts?competition_id=[&conflict_type] */
router.get('/conflicts', async (req, res, next) => {
  try {
    const { competition_id, conflict_type } = req.query;
    let sql = `SELECT c.*, a.title AS item_title, b.title AS other_title
                 FROM timetable_conflict c
                 LEFT JOIN timetable_item a ON a.id = c.item_id
                 LEFT JOIN timetable_item b ON b.id = c.other_item_id
                WHERE c.competition_id = ?`;
    const p = [competition_id];
    if (conflict_type) { sql += ' AND c.conflict_type = ?'; p.push(conflict_type); }
    res.json(ok(await query(sql + ' ORDER BY c.resolved_flag, c.conflict_type, c.id', p)));
  } catch (e) { next(e); }
});

/** POST /api/track-plan/detect 重新检测冲突 */
router.post('/detect', roleRequired(1), async (req, res, next) => {
  try {
    const n = await timetable.detectConflicts(Number(req.body.competition_id));
    res.json(ok({ count: n }, `检测到 ${n} 处冲突`));
  } catch (e) { next(e); }
});

/** POST /api/track-plan/conflicts/:id/resolve 标记已处理 */
router.post('/conflicts/:id/resolve', roleRequired(1), async (req, res, next) => {
  try {
    await execute('UPDATE timetable_conflict SET resolved_flag = 1 WHERE id = ?', [req.params.id]);
    res.json(ok(null, '已标记处理'));
  } catch (e) { next(e); }
});

// ============================================================
// 23. 秩序册
// ============================================================

const DEFAULT_SECTIONS = [
  { code: 'COVER', name: '封面', enabled: 1, sort_no: 1 },
  { code: 'REGULATION', name: '竞赛规程', enabled: 1, sort_no: 2 },
  { code: 'ORGANIZATION', name: '组织机构', enabled: 1, sort_no: 3 },
  { code: 'SCHOOL_LIST', name: '参赛单位名单', enabled: 1, sort_no: 4 },
  { code: 'ATHLETE_LIST', name: '运动员名单', enabled: 1, sort_no: 5 },
  { code: 'TIMETABLE', name: '竞赛日程', enabled: 1, sort_no: 6 },
  { code: 'HEAT_LIST', name: '分组名单', enabled: 1, sort_no: 7 },
  { code: 'RECORD', name: '纪录一览', enabled: 1, sort_no: 8 },
  { code: 'NOTICE', name: '注意事项', enabled: 1, sort_no: 9 }
];

/** GET /api/track-plan/order-book?competition_id= */
router.get('/order-book', async (req, res, next) => {
  try {
    let b = await queryOne('SELECT * FROM order_book WHERE competition_id = ?', [req.query.competition_id]);
    if (!b) {
      b = {
        competition_id: Number(req.query.competition_id),
        title: null, subtitle: null,
        sections_json: DEFAULT_SECTIONS, status: 0
      };
    }
    res.json(ok({ ...b, sections_json: parseJson(b.sections_json, DEFAULT_SECTIONS) }));
  } catch (e) { next(e); }
});

/** PUT /api/track-plan/order-book */
router.put('/order-book', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    await assertUnlocked(b.competition_id, 'ORDER_BOOK');
    if (!b.competition_id) return res.json(fail('缺少赛事 id'));
    const sections = Array.isArray(b.sections_json) ? b.sections_json : DEFAULT_SECTIONS;
    const exist = await queryOne('SELECT id FROM order_book WHERE competition_id = ?', [b.competition_id]);
    if (exist) {
      await execute(
        'UPDATE order_book SET title=?, subtitle=?, sections_json=?, cover_note=? WHERE id=?',
        [b.title || null, b.subtitle || null, JSON.stringify(sections), b.cover_note || null, exist.id]
      );
    } else {
      await execute(
        'INSERT INTO order_book (competition_id, title, subtitle, sections_json, cover_note) VALUES (?,?,?,?,?)',
        [b.competition_id, b.title || null, b.subtitle || null, JSON.stringify(sections), b.cover_note || null]
      );
    }
    res.json(ok(null, '秩序册已保存'));
  } catch (e) { next(e); }
});

/** 取出秩序册各章节所需的全部数据（前端预览与后端 PDF 共用） */
async function loadOrderBookData(cid) {
  const comp = await queryOne(
      `SELECT id, name, year, start_date, end_date, host_unit, venue, contact_person, contact_phone,
              meet_level, minimum_rest_minutes, straight_lane_count, curve_lane_count
         FROM competition WHERE id = ?`, [cid]
    );
    if (!comp) return res.json(fail('赛事不存在'));

    const schools = await query(
      `SELECT DISTINCT s.id, s.name
         FROM athlete_entry ae
         JOIN athlete a ON a.id = ae.athlete_id
         JOIN school s ON s.id = a.school_id
        WHERE ae.competition_id = ? AND ae.status = 2
        ORDER BY s.name`, [cid]
    );

    const athletes = await query(
      `SELECT a.id, a.name, a.gender, a.class_name, a.bib_no, s.name AS school_name,
              gb.label AS band_label, GROUP_CONCAT(DISTINCT e.name ORDER BY e.sort_no SEPARATOR '、') AS events
         FROM athlete_entry ae
         JOIN athlete a ON a.id = ae.athlete_id
         JOIN school s ON s.id = a.school_id
         JOIN event_item e ON e.id = ae.event_item_id
         JOIN group_band gb ON gb.id = ae.band_id
        WHERE ae.competition_id = ? AND ae.status = 2
        GROUP BY a.id, a.name, a.gender, a.class_name, a.bib_no, s.name, gb.label
        ORDER BY s.name, gb.label, a.name`, [cid]
    );

    const items = await query(
      `SELECT t.*, u.unit_date, u.period, u.name AS unit_name,
              v.name AS venue_name, e.name AS event_name, gb.label AS band_label
         FROM timetable_item t
         LEFT JOIN schedule_unit u ON u.id = t.unit_id
         LEFT JOIN venue v ON v.id = t.venue_id
         LEFT JOIN event_item e ON e.id = t.event_item_id
         LEFT JOIN group_band gb ON gb.id = t.band_id
        WHERE t.competition_id = ?
        ORDER BY u.unit_date, u.sort_no, t.start_time, t.sort_no`, [cid]
    );

    const heats = await query(
      `SELECT h.id, h.round_code, h.heat_no, h.heat_name, h.entry_count,
              e.name AS event_name, gb.label AS band_label,
              t.start_time, u.unit_date
         FROM track_heat h
         JOIN event_item e ON e.id = h.event_item_id
         LEFT JOIN group_band gb ON gb.id = h.band_id
         LEFT JOIN timetable_item t ON t.heat_id = h.id
         LEFT JOIN schedule_unit u ON u.id = t.unit_id
        WHERE h.competition_id = ?
        ORDER BY e.sort_no, h.round_no, h.heat_no`, [cid]
    );

    const heatEntries = await query(
      `SELECT he.heat_id, he.lane_no, he.sort_no, he.athlete_name, he.school_name, he.bib_no
         FROM heat_entry he
        WHERE he.competition_id = ?
        ORDER BY he.heat_id, COALESCE(he.lane_no, he.sort_no, 0)`, [cid]
    );
    const entMap = new Map();
    for (const x of heatEntries) {
      if (!entMap.has(x.heat_id)) entMap.set(x.heat_id, []);
      entMap.get(x.heat_id).push(x);
    }
    heats.forEach((h) => { h.entries = entMap.get(h.id) || []; });

    const records = await query(
      `SELECT r.*, e.name AS event_name, gb.label AS band_label
         FROM meet_record r
         LEFT JOIN event_item e ON e.id = r.event_item_id
         LEFT JOIN group_band gb ON gb.id = r.band_id
        WHERE r.competition_id = ? AND r.status = 1
        ORDER BY e.sort_no`, [cid]
    );

  return { competition: comp, schools, athletes, timetable: items, heats, records };
}

/** GET /api/track-plan/order-book/data 取各章节的实际内容 */
router.get('/order-book/data', async (req, res, next) => {
  try {
    res.json(ok(await loadOrderBookData(req.query.competition_id)));
  } catch (e) { next(e); }
});

/** GET /api/track-plan/order-book/pdf 直接下载带水印的秩序册 PDF */
router.get('/order-book/pdf', async (req, res, next) => {
  try {
    const cid = req.query.competition_id;
    let book = await queryOne('SELECT * FROM order_book WHERE competition_id = ?', [cid]);
    if (!book) {
      book = { competition_id: Number(cid), title: null, subtitle: null, sections_json: DEFAULT_SECTIONS };
    }
    book.sections_json = parseJson(book.sections_json, DEFAULT_SECTIONS);

    const data = await loadOrderBookData(cid);
    if (!data.competition) return res.json(fail('赛事不存在'));

    const name = book.title || data.competition.name || '秩序册';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(name)}.pdf`);

    const pdf = buildOrderBookPdf({ book, data });
    pdf.pipe(res);
    pdf.on('error', next);
  } catch (e) { next(e); }
});

/** POST /api/track-plan/order-book/generate 标记生成 */
router.post('/order-book/generate', roleRequired(1), async (req, res, next) => {
  try {
    const who = req.user.real_name || req.user.username;
    await execute(
      'UPDATE order_book SET status = 1, generated_at = NOW(), generated_by = ? WHERE competition_id = ?',
      [who, req.body.competition_id]
    );
    res.json(ok(null, '秩序册已生成'));
  } catch (e) { next(e); }
});

// ============================================================
// 24. 奖状
// ============================================================

const DEFAULT_FIELDS = [
  { key: 'winner_name', label: '获奖人', x: 400, y: 300, font_size: 32, align: 'center', bold: 1 },
  { key: 'award_name', label: '奖项', x: 400, y: 370, font_size: 22, align: 'center', bold: 0 },
  { key: 'winner_school', label: '单位', x: 400, y: 420, font_size: 18, align: 'center', bold: 0 },
  { key: 'competition_name', label: '赛事名', x: 400, y: 620, font_size: 16, align: 'center', bold: 0 },
  { key: 'date_text', label: '日期', x: 400, y: 660, font_size: 14, align: 'center', bold: 0 }
];

/** GET /api/track-plan/cert-templates?competition_id=[&template_type] */
router.get('/cert-templates', async (req, res, next) => {
  try {
    const { competition_id, template_type } = req.query;
    let sql = 'SELECT * FROM certificate_template WHERE competition_id = ?';
    const p = [competition_id];
    if (template_type) { sql += ' AND template_type = ?'; p.push(template_type); }
    const rows = await query(sql + ' ORDER BY sort_no, id', p);
    res.json(ok(rows.map((r) => ({ ...r, fields_json: parseJson(r.fields_json, DEFAULT_FIELDS) }))));
  } catch (e) { next(e); }
});

router.post('/cert-templates', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.competition_id) return res.json(fail('缺少赛事 id'));
    if (!b.name) return res.json(fail('请填写模板名称'));
    const fields = Array.isArray(b.fields_json) && b.fields_json.length ? b.fields_json : DEFAULT_FIELDS;
    if (b.id) {
      await execute(
        `UPDATE certificate_template SET name=?, template_type=?, page_size=?, orientation=?,
          background_image=?, fields_json=?, remark=?, sort_no=? WHERE id=?`,
        [b.name, b.template_type || 'INDIVIDUAL', b.page_size || 'A4',
         b.orientation || 'landscape', b.background_image || null,
         JSON.stringify(fields), b.remark || null, b.sort_no ?? 0, b.id]
      );
      res.json(ok({ id: Number(b.id) }, '模板已更新'));
    } else {
      const r = await execute(
        `INSERT INTO certificate_template
          (competition_id, name, template_type, page_size, orientation, background_image, fields_json, remark, sort_no)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [b.competition_id, b.name, b.template_type || 'INDIVIDUAL', b.page_size || 'A4',
         b.orientation || 'landscape', b.background_image || null,
         JSON.stringify(fields), b.remark || null, b.sort_no ?? 0]
      );
      res.json(ok({ id: r.insertId }, '模板已创建'));
    }
  } catch (e) { next(e); }
});

router.delete('/cert-templates/:id', roleRequired(1), async (req, res, next) => {
  try {
    await execute('DELETE FROM certificate_record WHERE template_id = ?', [req.params.id]);
    await execute('DELETE FROM certificate_template WHERE id = ?', [req.params.id]);
    res.json(ok(null, '模板已删除'));
  } catch (e) { next(e); }
});

/** POST /api/track-plan/cert/generate 按名次批量生成奖状 */
router.post('/cert/generate', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, template_id, rank_limit, source } = req.body;
    if (!competition_id) return res.json(fail('缺少赛事 id'));
    if (!template_id) return res.json(fail('请选择模板'));
    const limit = Number(rank_limit) || 3;

    await execute('DELETE FROM certificate_record WHERE competition_id = ? AND template_id = ?', [competition_id, template_id]);

    let n = 0;
    if (source === 'TEAM') {
      // 团体：取团体总分方案第一名
      const rule = await queryOne(
        'SELECT id FROM team_score_rule WHERE competition_id = ? AND status = 1 ORDER BY sort_no, id LIMIT 1',
        [competition_id]
      );
      if (!rule) return res.json(fail('还没有团体总分方案'));
      const rows = await query(
        'SELECT * FROM team_score_total WHERE rule_id = ? AND rank_no <= ? ORDER BY rank_no',
        [rule.id, limit]
      );
      for (const r of rows) {
        await execute(
          `INSERT INTO certificate_record
            (competition_id, template_id, source_type, school_id, award_name, rank_no,
             winner_name, winner_school)
           VALUES (?,?,'TEAM',?,?,?,?,?)`,
          [competition_id, template_id,
           r.unit_type === 'SCHOOL' ? r.unit_id : null,
           `团体总分第${r.rank_no}名`, r.rank_no, r.unit_name, r.unit_name]
        );
        n++;
      }
    } else {
      // 个人：取各项目各赛次已确认的前 N 名
      const rows = await query(
        `SELECT he.*, e.name AS event_name, gb.label AS band_label, h.heat_name, h.round_code, h.heat_no
           FROM heat_entry he
           JOIN track_heat h ON h.id = he.heat_id
           JOIN event_item e ON e.id = he.event_item_id
           LEFT JOIN group_band gb ON gb.id = he.band_id
          WHERE he.competition_id = ? AND h.confirm_flag = 1
            AND he.rank_no IS NOT NULL AND he.rank_no <= ?
            AND (he.status_code IS NULL OR he.status_code = '')
          ORDER BY e.sort_no, he.band_id, h.round_no, h.heat_no, he.rank_no`,
        [competition_id, limit]
      );
      for (const r of rows) {
        await execute(
          `INSERT INTO certificate_record
            (competition_id, template_id, source_type, athlete_id, school_id, award_name,
             rank_no, event_name, band_label, winner_name, winner_school, result_text)
           VALUES (?,?,'INDIVIDUAL',?,?,?,?,?,?,?,?,?)`,
          [competition_id, template_id, r.athlete_id, r.school_id,
           `${r.band_label || ''}${r.event_name}${r.heat_no ? '（' + (r.round_code === 'PRELIM' ? '预赛' : r.round_code === 'SEMI' ? '复赛' : r.round_code === 'FINAL' && rows.filter((x) => x.event_item_id === r.event_item_id && x.band_id === r.band_id && x.round_code === 'FINAL').length > 1 ? '第' + r.heat_no + '组' : '') + '）' : ''}第${r.rank_no}名`.trim(),
           r.rank_no, r.event_name, r.band_label, r.athlete_name, r.school_name, r.result_text]
        );
        n++;
      }
    }
    res.json(ok({ count: n }, `已生成 ${n} 张奖状`));
  } catch (e) { next(e); }
});

/** GET /api/track-plan/cert-records?competition_id=[&template_id] */
router.get('/cert-records', async (req, res, next) => {
  try {
    const { competition_id, template_id } = req.query;
    let sql = 'SELECT * FROM certificate_record WHERE competition_id = ?';
    const p = [competition_id];
    if (template_id) { sql += ' AND template_id = ?'; p.push(template_id); }
    res.json(ok(await query(sql + ' ORDER BY rank_no, id', p)));
  } catch (e) { next(e); }
});

router.delete('/cert-records/:id', roleRequired(1), async (req, res, next) => {
  try {
    await execute('DELETE FROM certificate_record WHERE id = ?', [req.params.id]);
    res.json(ok(null, '已删除'));
  } catch (e) { next(e); }
});

/** POST /api/track-plan/cert-records/printed 标记已打印 */
router.post('/cert-records/printed', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, template_id } = req.body;
    await execute(
      'UPDATE certificate_record SET printed_flag = 1, printed_at = NOW() WHERE competition_id = ? AND template_id = ?',
      [competition_id, template_id]
    );
    res.json(ok(null, '已标记为已打印'));
  } catch (e) { next(e); }
});

// ============================================================
// 25. 改期 / 锁 / 流程节点
// ============================================================

/** POST /api/track-plan/reschedule 赛事整体改期 */
router.post('/reschedule', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    await assertUnlocked(b.competition_id, 'SCHEDULE');
    if (!b.competition_id) return res.json(fail('缺少赛事 id'));
    if (!b.shift_days) return res.json(fail('请填写平移天数'));
    const who = req.user.real_name || req.user.username;
    const r = await timetable.reschedule(Number(b.competition_id), Number(b.shift_days), b.reason, who);
    res.json(ok(r, `已整体改期 ${r.shift_days > 0 ? '推迟' : '提前'} ${Math.abs(r.shift_days)} 天（单元 ${r.affected_units} / 时段 ${r.affected_slots} / 赛次 ${r.affected_heats}）`));
  } catch (e) { next(e); }
});

/** GET /api/track-plan/reschedule-logs?competition_id= */
router.get('/reschedule-logs', async (req, res, next) => {
  try {
    res.json(ok(await query(
      'SELECT * FROM meet_reschedule_log WHERE competition_id = ? ORDER BY id DESC LIMIT 30',
      [req.query.competition_id]
    )));
  } catch (e) { next(e); }
});

/** GET /api/track-plan/locks?competition_id= */
router.get('/locks', async (req, res, next) => {
  try {
    const c = await queryOne(
      `SELECT enroll_lock_flag, schedule_lock_flag, timetable_lock_flag, order_book_lock_flag
         FROM competition WHERE id = ?`, [req.query.competition_id]
    );
    res.json(ok(c || {}));
  } catch (e) { next(e); }
});

/** PUT /api/track-plan/locks 上锁/解锁 */
router.put('/locks', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, lock_type, action, reason } = req.body;
    const col = LOCK_COLUMN[lock_type];
    if (!col) return res.json(fail('锁类型不正确'));
    const val = action === 'LOCK' ? 1 : 0;
    await execute(`UPDATE competition SET ${col} = ? WHERE id = ?`, [val, competition_id]);
    const who = req.user.real_name || req.user.username;
    await execute(
      'INSERT INTO meet_lock_log (competition_id, lock_type, action, operation_by, reason) VALUES (?,?,?,?,?)',
      [competition_id, lock_type, action === 'LOCK' ? 'LOCK' : 'UNLOCK', who, reason || null]
    );
    res.json(ok(null, action === 'LOCK' ? '已锁定' : '已解锁'));
  } catch (e) { next(e); }
});

/** GET /api/track-plan/lock-logs?competition_id= */
router.get('/lock-logs', async (req, res, next) => {
  try {
    res.json(ok(await query(
      'SELECT * FROM meet_lock_log WHERE competition_id = ? ORDER BY id DESC LIMIT 30',
      [req.query.competition_id]
    )));
  } catch (e) { next(e); }
});

/** GET /api/track-plan/flow-nodes?competition_id= */
router.get('/flow-nodes', async (req, res, next) => {
  try {
    res.json(ok(await query(
      'SELECT * FROM meet_flow_node WHERE competition_id = ? ORDER BY sort_no, id',
      [req.query.competition_id]
    )));
  } catch (e) { next(e); }
});

const DEFAULT_NODES = [
  { node_code: 'ENROLL', node_name: '报名', sort_no: 1 },
  { node_code: 'ARRANGE', node_name: '编排', sort_no: 2 },
  { node_code: 'TIMETABLE', node_name: '日程', sort_no: 3 },
  { node_code: 'RACE', node_name: '比赛', sort_no: 4 },
  { node_code: 'SCORE', node_name: '成绩统计', sort_no: 5 },
  { node_code: 'CLOSE', node_name: '闭幕', sort_no: 6 }
];

/** POST /api/track-plan/flow-nodes/init 初始化流程节点 */
router.post('/flow-nodes/init', roleRequired(1), async (req, res, next) => {
  try {
    const cid = req.body.competition_id;
    const exist = await queryOne('SELECT COUNT(*) AS c FROM meet_flow_node WHERE competition_id = ?', [cid]);
    if (Number(exist?.c) > 0) return res.json(ok({ count: 0 }, '流程节点已存在'));
    for (const n of DEFAULT_NODES) {
      await execute(
        'INSERT INTO meet_flow_node (competition_id, node_code, node_name, sort_no) VALUES (?,?,?,?)',
        [cid, n.node_code, n.node_name, n.sort_no]
      );
    }
    res.json(ok({ count: DEFAULT_NODES.length }, '已初始化 6 个流程节点'));
  } catch (e) { next(e); }
});

/** PUT /api/track-plan/flow-nodes/:id */
router.put('/flow-nodes/:id', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    if (b.done_flag !== undefined && Number(b.done_flag) === 1) {
      const who = req.user.real_name || req.user.username;
      await execute(
        'UPDATE meet_flow_node SET plan_date=?, plan_time=?, done_flag=1, done_at=NOW(), operator=?, remark=? WHERE id=?',
        [b.plan_date ?? null, b.plan_time ?? null, who, b.remark ?? null, req.params.id]
      );
    } else {
      await execute(
        'UPDATE meet_flow_node SET plan_date=?, plan_time=?, done_flag=?, operator=NULL, done_at=NULL, remark=? WHERE id=?',
        [b.plan_date ?? null, b.plan_time ?? null, b.done_flag ?? 0, b.remark ?? null, req.params.id]
      );
    }
    res.json(ok(null, '已保存'));
  } catch (e) { next(e); }
});

module.exports = router;
