const express = require('express');
const { query, queryOne, execute, ok, fail } = require('../db');
const { authRequired, roleRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

// ============================================================
// 项目
// ============================================================

router.get('/items', async (req, res, next) => {
  try {
    const { competition_id } = req.query;
    const rows = await query(
      'SELECT * FROM event_item WHERE competition_id = ? ORDER BY category, id',
      [competition_id]
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

// 田径扩展字段（与 track.js 的 track-config 保持同一套，便于前端一次提交）
const TRACK_FIELDS = [
  'event_type', 'result_entry_type', 'event_unit', 'is_higher_better',
  'result_min_value', 'result_max_value', 'result_decimal_places', 'gender_requirement',
  'need_lane_order', 'relay_leg_count', 'has_preliminary', 'admission_count',
  'estimated_unit_minutes', 'base_attempt_count', 'extra_attempt_count', 'extra_qualifier_count',
  'result_aggregation_mode', 'scoring_scheme', 'scoring_scheme_custom',
  'team_score_multiplier', 'max_total_count', 'max_male_count', 'max_female_count',
  'grade_standard_id', 'sort_no'
];

router.post('/items', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.name || !b.competition_id) return res.json(fail('请填写项目名称'));

    const cols = ['competition_id', 'name', 'category', 'is_relay', 'match_minutes', 'slot_interval',
      'group_count', 'rounds_per_group', 'advance_count', 'pairing_rule', 'has_third_place',
      'schedule_mode', 'participant_kind',
      'lane_count', 'prelim_max'];
    const vals = [b.competition_id, b.name, b.category, b.is_relay || 0, b.match_minutes || 24,
      b.slot_interval || 45, b.group_count || 0, b.rounds_per_group || 0,
      b.advance_count || 4, b.pairing_rule || 1, b.has_third_place ?? 1,
      b.schedule_mode || 'GROUP_KO', b.participant_kind || 'TEAM',
      b.lane_count || 8, b.prelim_max || 16];

    for (const f of TRACK_FIELDS) {
      if (b[f] !== undefined) { cols.push(f); vals.push(b[f]); }
    }

    const r = await execute(
      `INSERT INTO event_item (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, vals
    );
    res.json(ok({ id: r.insertId }, '项目已添加'));
  } catch (e) { next(e); }
});

router.put('/items/:id', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    const ev = await queryOne('SELECT * FROM event_item WHERE id = ?', [req.params.id]);
    if (!ev) return res.json(fail('项目不存在'));

    const sets = [];
    const p = [];
    const base = {
      name: b.name ?? ev.name,
      category: b.category ?? ev.category,
      is_relay: b.is_relay ?? ev.is_relay,
      match_minutes: b.match_minutes ?? ev.match_minutes,
      slot_interval: b.slot_interval ?? ev.slot_interval,
      group_count: b.group_count ?? ev.group_count,
      rounds_per_group: b.rounds_per_group ?? ev.rounds_per_group,
      advance_count: b.advance_count ?? ev.advance_count,
      pairing_rule: b.pairing_rule ?? ev.pairing_rule,
      has_third_place: b.has_third_place ?? ev.has_third_place,
      schedule_mode: b.schedule_mode ?? ev.schedule_mode,
      participant_kind: b.participant_kind ?? ev.participant_kind,
      lane_count: b.lane_count ?? ev.lane_count,
      prelim_max: b.prelim_max ?? ev.prelim_max
    };
    for (const k of Object.keys(base)) { sets.push(`${k} = ?`); p.push(base[k]); }
    for (const f of TRACK_FIELDS) {
      if (b[f] !== undefined) { sets.push(`${f} = ?`); p.push(b[f]); }
    }
    p.push(req.params.id);
    await execute(`UPDATE event_item SET ${sets.join(', ')} WHERE id = ?`, p);
    res.json(ok(null, '已保存'));
  } catch (e) { next(e); }
});

router.delete('/items/:id', roleRequired(1), async (req, res, next) => {
  try {
    await execute('DELETE FROM event_item WHERE id = ?', [req.params.id]);
    res.json(ok(null, '已删除'));
  } catch (e) { next(e); }
});

// ============================================================
// 组别
// ============================================================

router.get('/bands', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT gb.*,
        (SELECT COUNT(*) FROM team_entry WHERE band_id = gb.id AND status = 2) AS team_count,
        (SELECT COUNT(*) FROM athlete_entry WHERE band_id = gb.id AND status = 2) AS athlete_count
       FROM group_band gb WHERE gb.competition_id = ? ORDER BY gb.stage, gb.gender, gb.sort_no`,
      [req.query.competition_id]
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

router.post('/bands', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, stage, gender, label, sort_no } = req.body;
    if (!competition_id || !stage || !gender) return res.json(fail('请填写完整'));
    const r = await execute(
      'INSERT INTO group_band (competition_id, stage, gender, label, sort_no) VALUES (?,?,?,?,?)',
      [competition_id, stage, gender, label || '', sort_no || 0]
    );
    res.json(ok({ id: r.insertId }, '组别已添加'));
  } catch (e) { next(e); }
});

router.put('/bands/:id', roleRequired(1), async (req, res, next) => {
  try {
    const { stage, gender, label, sort_no } = req.body;
    await execute(
      'UPDATE group_band SET stage=?, gender=?, label=?, sort_no=? WHERE id=?',
      [stage, gender, label, sort_no, req.params.id]
    );
    res.json(ok(null, '已保存'));
  } catch (e) { next(e); }
});

router.delete('/bands/:id', roleRequired(1), async (req, res, next) => {
  try {
    await execute('DELETE FROM group_band WHERE id = ?', [req.params.id]);
    res.json(ok(null, '已删除'));
  } catch (e) { next(e); }
});

// ============================================================
// 场地
// ============================================================

router.get('/venues', async (req, res, next) => {
  try {
    const rows = await query(
      'SELECT v.*, s.name AS host_school_name FROM venue v LEFT JOIN school s ON s.id = v.host_school_id WHERE v.competition_id = ? ORDER BY v.venue_no',
      [req.query.competition_id]
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

router.post('/venues', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, name, venue_no, host_school_id } = req.body;
    if (!competition_id || !name) return res.json(fail('请填写场地名称'));
    const r = await execute(
      'INSERT INTO venue (competition_id, name, venue_no, host_school_id) VALUES (?,?,?,?)',
      [competition_id, name, venue_no || 1, host_school_id || null]
    );
    res.json(ok({ id: r.insertId }, '场地已添加'));
  } catch (e) { next(e); }
});

router.put('/venues/:id', roleRequired(1), async (req, res, next) => {
  try {
    const { name, venue_no, host_school_id } = req.body;
    await execute(
      'UPDATE venue SET name=?, venue_no=?, host_school_id=? WHERE id=?',
      [name, venue_no, host_school_id, req.params.id]
    );
    res.json(ok(null, '已保存'));
  } catch (e) { next(e); }
});

router.delete('/venues/:id', roleRequired(1), async (req, res, next) => {
  try {
    await execute('DELETE FROM venue WHERE id = ?', [req.params.id]);
    res.json(ok(null, '已删除'));
  } catch (e) { next(e); }
});

module.exports = router;
