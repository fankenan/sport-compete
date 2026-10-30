/**
 * 学校体育活动上报
 *
 * 一学期三个节点（phase）：1 学期初 / 2 学期中 / 3 学期末
 * 一个学校 × 一个学期 × 一个阶段 一条记录
 *
 * 五个板块：
 *   一、阳光大课间（recess_*）—— 含「是否落实 15 分钟」，由时长自动判定
 *   二、每天体育活动时间（pe_*, after_class_*）—— 自动加总判是否够 60 分钟
 *   三、校内竞赛（comp_*）—— 按学期统计
 *   四、武术进校园（wushu_*）
 *   五、体育作业（hw_*）
 *
 * 达标状态一律**查询时计算**，不入库：
 *   大课间达标 = recess_enabled && recess_minutes >= 15
 *   每天时长   = 体育课折算 + 大课间折算 + 课后活动
 *   每天达标   = 每天时长 >= 60
 * 折算方式：每周 x 次的活动按 /5 摊到每天（前端实时预览用同一套公式，改动需同步）
 */
const express = require('express');
const { query, queryOne, execute, ok, fail } = require('../db');
const { authRequired, roleRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

const PHASE_NAME = { 1: '学期初', 2: '学期中', 3: '学期末' };
const STATUS_NAME = { 0: '草稿', 1: '待审核', 2: '已通过', 3: '已退回' };
const SECTIONS = ['recess', 'time', 'comp', 'wushu', 'hw'];
const MAX_PHOTO_PER_SECTION = 3;

/** 计算达标指标（与前端 SportActivity.vue 的 calcMetrics 保持一致） */
function calcMetrics(r) {
  const recessMinutes = Number(r.recess_minutes) || 0;
  const recessWeekly = Number(r.recess_weekly) || 0;
  const peWeekly = Number(r.pe_weekly) || 0;
  const peMinutes = Number(r.pe_minutes) || 0;
  const afterClass = Number(r.after_class_minutes) || 0;

  const recessDaily = Math.round(recessMinutes * Math.min(recessWeekly, 5) / 5);
  const peDaily = Math.round(peMinutes * Math.min(peWeekly, 5) / 5);
  const dailyMinutes = recessDaily + peDaily + afterClass;

  return {
    recess_ok: Number(r.recess_enabled) === 1 && recessMinutes >= 15,
    recess_daily: recessDaily,
    daily_minutes: dailyMinutes,
    daily_ok: dailyMinutes >= 60
  };
}

function decorate(r) {
  return {
    ...r,
    phase_name: PHASE_NAME[r.phase] || '',
    status_name: STATUS_NAME[r.status] || '',
    ...calcMetrics(r)
  };
}

/** 取某条报表的图片，按板块分组 */
async function photosOf(reportIds) {
  const map = new Map();
  if (!reportIds.length) return map;
  const rows = await query(
    `SELECT id, report_id, section, url, sort_no FROM school_sport_photo
     WHERE report_id IN (${reportIds.map(() => '?').join(',')})
     ORDER BY sort_no, id`, reportIds);
  for (const p of rows) {
    if (!map.has(p.report_id)) map.set(p.report_id, {});
    const g = map.get(p.report_id);
    if (!g[p.section]) g[p.section] = [];
    g[p.section].push({ id: p.id, url: p.url });
  }
  return map;
}

/** 全量替换图片（保存时一起提交，避免额外维护上传与绑定两步） */
async function replacePhotos(reportId, photos) {
  if (!photos || typeof photos !== 'object') return;
  await execute('DELETE FROM school_sport_photo WHERE report_id = ?', [reportId]);
  let sort = 0;
  for (const section of SECTIONS) {
    const list = Array.isArray(photos[section]) ? photos[section] : [];
    const urls = list.filter((u) => typeof u === 'string' && u.trim()).slice(0, MAX_PHOTO_PER_SECTION);
    for (const url of urls) {
      await execute(
        'INSERT INTO school_sport_photo (report_id, section, url, sort_no) VALUES (?,?,?,?)',
        [reportId, section, url.trim(), sort++]);
    }
  }
}

/* ============ 学校端 ============ */

/** GET /api/sport-activity/mine?term=&phase= 取本校某阶段报表（没有则返回空壳） */
router.get('/mine', async (req, res, next) => {
  try {
    const schoolId = req.user.role === 2 ? req.user.school_id : Number(req.query.school_id) || 0;
    if (!schoolId) return res.json(fail('缺少学校'));
    const { term, phase } = req.query;
    if (!term || !phase) return res.json(fail('缺少学期或阶段'));

    let row = await queryOne(
      'SELECT * FROM school_sport_report WHERE school_id=? AND term=? AND phase=?',
      [schoolId, term, Number(phase)]);

    if (!row) {
      const school = await queryOne('SELECT id, name, short_name, stage FROM school WHERE id=?', [schoolId]);
      return res.json(ok({
        id: null, school_id: schoolId, term, phase: Number(phase), status: 0,
        school_name: school ? school.name : '',
        school_stage: school ? school.stage : null,
        photos: {}, ...calcMetrics({})
      }));
    }

    const photos = await photosOf([row.id]);
    res.json(ok({ ...decorate(row), photos: photos.get(row.id) || {} }));
  } catch (e) { next(e); }
});

/** PUT /api/sport-activity/mine 保存草稿（没有就新建） */
router.put('/mine', async (req, res, next) => {
  try {
    const b = req.body || {};
    const schoolId = req.user.role === 2 ? req.user.school_id : Number(b.school_id) || 0;
    if (!schoolId) return res.json(fail('缺少学校'));
    if (!b.term || !b.phase) return res.json(fail('缺少学期或阶段'));

    const exist = await queryOne(
      'SELECT * FROM school_sport_report WHERE school_id=? AND term=? AND phase=?',
      [schoolId, b.term, Number(b.phase)]);
    if (exist && Number(exist.status) === 2) {
      return res.json(fail('已审核通过，不能再修改'));
    }

    const cols = [
      'recess_enabled', 'recess_minutes', 'recess_weekly', 'recess_forms', 'recess_scope',
      'pe_weekly', 'pe_minutes', 'after_class_minutes',
      'comp_count', 'comp_sports', 'comp_join_count', 'comp_desc',
      'wushu_enabled', 'wushu_forms', 'wushu_scope', 'wushu_weekly', 'wushu_teacher', 'wushu_desc',
      'hw_enabled', 'hw_freq', 'hw_forms', 'hw_check'
    ];
    const vals = cols.map((k) => (b[k] === undefined || b[k] === '' ? null : b[k]));

    let reportId = exist?.id;
    if (exist) {
      await execute(
        `UPDATE school_sport_report SET ${cols.map((c) => `${c}=?`).join(',')} WHERE id=?`,
        [...vals, exist.id]);
    } else {
      const r = await execute(
        `INSERT INTO school_sport_report (school_id, term, phase, ${cols.join(',')})
         VALUES (?,?,?,${cols.map(() => '?').join(',')})`,
        [schoolId, b.term, Number(b.phase), ...vals]);
      reportId = r.insertId;
    }

    await replacePhotos(reportId, b.photos);
    const saved = await queryOne('SELECT * FROM school_sport_report WHERE id=?', [reportId]);
    const photos = await photosOf([reportId]);
    res.json(ok({ ...decorate(saved), photos: photos.get(reportId) || {} }, '已保存'));
  } catch (e) { next(e); }
});

/** POST /api/sport-activity/submit 保存并提交审核 */
router.post('/submit', async (req, res, next) => {
  try {
    const b = req.body || {};
    const schoolId = req.user.role === 2 ? req.user.school_id : Number(b.school_id) || 0;
    if (!schoolId) return res.json(fail('缺少学校'));

    // 必填校验
    const miss = [];
    if (b.recess_enabled === undefined || b.recess_enabled === null) miss.push('是否开展大课间');
    if (Number(b.recess_enabled) === 1 && !(Number(b.recess_minutes) > 0)) miss.push('大课间每次时长');
    if (!(Number(b.pe_weekly) > 0)) miss.push('每周体育课节数');
    if (!(Number(b.pe_minutes) > 0)) miss.push('每节体育课时长');
    if (b.comp_count === undefined || b.comp_count === null || b.comp_count === '') miss.push('校内竞赛次数');
    if (b.wushu_enabled === undefined || b.wushu_enabled === null) miss.push('是否开展武术进校园');
    if (b.hw_enabled === undefined || b.hw_enabled === null) miss.push('是否布置体育作业');
    if (miss.length) return res.json(fail(`还有 ${miss.length} 项未填写：${miss.join('、')}`));

    const cols = [
      'recess_enabled', 'recess_minutes', 'recess_weekly', 'recess_forms', 'recess_scope',
      'pe_weekly', 'pe_minutes', 'after_class_minutes',
      'comp_count', 'comp_sports', 'comp_join_count', 'comp_desc',
      'wushu_enabled', 'wushu_forms', 'wushu_scope', 'wushu_weekly', 'wushu_teacher', 'wushu_desc',
      'hw_enabled', 'hw_freq', 'hw_forms', 'hw_check'
    ];
    const vals = cols.map((k) => (b[k] === undefined || b[k] === '' ? null : b[k]));
    const who = req.user.real_name || req.user.username;

    const exist = await queryOne(
      'SELECT * FROM school_sport_report WHERE school_id=? AND term=? AND phase=?',
      [schoolId, b.term, Number(b.phase)]);

    let reportId = exist?.id;
    if (exist) {
      await execute(
        `UPDATE school_sport_report SET ${cols.map((c) => `${c}=?`).join(',')},
           status=1, submitted_at=NOW(), submitted_by=?, audit_note=NULL
         WHERE id=?`,
        [...vals, who, exist.id]);
    } else {
      const r = await execute(
        `INSERT INTO school_sport_report (school_id, term, phase, ${cols.join(',')},
           status, submitted_at, submitted_by)
         VALUES (?,?,?,${cols.map(() => '?').join(',')},1,NOW(),?)`,
        [schoolId, b.term, Number(b.phase), ...vals, who]);
      reportId = r.insertId;
    }

    await replacePhotos(reportId, b.photos);
    const saved = await queryOne('SELECT * FROM school_sport_report WHERE id=?', [reportId]);
    res.json(ok(decorate(saved), '已提交，等待审核'));
  } catch (e) { next(e); }
});

/** GET /api/sport-activity/mine/history?term= 本校三个阶段的提交状态一览 */
router.get('/mine/history', async (req, res, next) => {
  try {
    const schoolId = req.user.role === 2 ? req.user.school_id : Number(req.query.school_id) || 0;
    const { term } = req.query;
    const rows = await query(
      'SELECT * FROM school_sport_report WHERE school_id=? AND term=? ORDER BY phase',
      [schoolId, term]);
    const byPhase = {};
    for (const r of rows) byPhase[r.phase] = decorate(r);
    res.json(ok({ term, list: byPhase }));
  } catch (e) { next(e); }
});

/* ============ 局端 ============ */

/** GET /api/sport-activity/list?term=&phase=&status= 全区列表（含未上报学校） */
router.get('/list', roleRequired(1), async (req, res, next) => {
  try {
    const { term, phase, status } = req.query;
    if (!term || !phase) return res.json(fail('缺少学期或阶段'));

    const schools = await query(
      'SELECT id, name, short_name, stage FROM school WHERE name <> ? ORDER BY stage, id', ['测试学校']);
    const reports = await query(
      'SELECT * FROM school_sport_report WHERE term=? AND phase=?', [term, Number(phase)]);
    const bySchool = new Map(reports.map((r) => [r.school_id, r]));

    const ids = reports.map((r) => r.id);
    const photoMap = await photosOf(ids);

    let list = schools.map((s) => {
      const r = bySchool.get(s.id);
      const base = {
        school_id: s.id, school_name: s.name, school_short: s.short_name,
        school_stage: s.stage, status: 0, reported: false
      };
      if (!r) return { ...base, ...calcMetrics({}) };
      return {
        ...base,
        ...decorate(r),
        reported: Number(r.status) > 0,
        photos: photoMap.get(r.id) || {}
      };
    });

    if (status !== undefined && status !== '') {
      list = list.filter((x) => Number(x.status) === Number(status));
    }

    const reported = list.filter((x) => x.reported);
    res.json(ok({
      list,
      summary: {
        total: list.length,
        reported: reported.length,
        pending: list.filter((x) => Number(x.status) === 1).length,
        passed: list.filter((x) => Number(x.status) === 2).length,
        rejected: list.filter((x) => Number(x.status) === 3).length,
        recess_ok: reported.filter((x) => x.recess_ok).length,
        daily_ok: reported.filter((x) => x.daily_ok).length,
        wushu_ok: reported.filter((x) => Number(x.wushu_enabled) === 1).length,
        hw_ok: reported.filter((x) => Number(x.hw_enabled) === 1).length,
        comp_ok: reported.filter((x) => Number(x.comp_count) > 0).length
      }
    }));
  } catch (e) { next(e); }
});

/** POST /api/sport-activity/:id/audit  { status: 2|3, note } */
router.post('/:id/audit', roleRequired(1), async (req, res, next) => {
  try {
    const { status, note } = req.body || {};
    const st = Number(status);
    if (![2, 3].includes(st)) return res.json(fail('审核状态不合法'));
    const row = await queryOne('SELECT * FROM school_sport_report WHERE id=?', [req.params.id]);
    if (!row) return res.json(fail('报表不存在'));
    if (st === 3 && !String(note || '').trim()) {
      return res.json(fail('退回时请填写整改意见'));
    }
    const who = req.user.real_name || req.user.username;
    await execute(
      'UPDATE school_sport_report SET status=?, audit_note=?, audited_at=NOW(), audited_by=? WHERE id=?',
      [st, note || null, who, req.params.id]);
    res.json(ok(null, st === 2 ? '已通过' : '已退回'));
  } catch (e) { next(e); }
});

module.exports = router;
