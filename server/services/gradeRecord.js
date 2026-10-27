/**
 * 达级认定 + 破纪录检测
 *
 * 达级：拿成绩去 grade_standard_threshold 里比对
 *   LOWER（径赛，越小越好）：成绩 <= 阈值 即达标
 *   HIGHER（田赛，越大越好）：成绩 >= 阈值 即达标
 *   一个运动员可能同时达到多个等级（如同时够二级和三级），取最高等级
 *
 * 破纪录：赛会纪录 / 最高纪录 双轨，各自独立判定
 */
const { query, queryOne, execute } = require('../db');

const GRADE_ORDER = ['MASTER', 'L1', 'L2', 'L3', 'YOUTH'];
const GRADE_NAME = {
  MASTER: '运动健将', L1: '一级运动员', L2: '二级运动员',
  L3: '三级运动员', YOUTH: '少年级'
};

/**
 * 判定单个成绩达到的最高等级
 * @returns {{grade_code, grade_name, bonus_value, result_value}|null}
 */
function judgeGrade(value, thresholds) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  const v = Number(value);
  let best = null;
  for (const t of thresholds) {
    const tv = Number(t.result_value);
    if (Number.isNaN(tv)) continue;
    const ok = String(t.result_direction || 'LOWER').toUpperCase() === 'HIGHER' ? v >= tv : v <= tv;
    if (!ok) continue;
    if (!best || GRADE_ORDER.indexOf(t.grade_code) < GRADE_ORDER.indexOf(best.grade_code)) {
      best = t;
    }
  }
  if (!best) return null;
  return {
    grade_code: best.grade_code,
    grade_name: best.grade_name || GRADE_NAME[best.grade_code] || best.grade_code,
    bonus_value: Number(best.bonus_value) || 0,
    result_value: v
  };
}

/**
 * 批量认定达级
 * 扫描已确认赛次的成绩，按项目绑定的 grade_standard_id 找标准，逐个判定
 */
async function recognizeGrades(competitionId, opts = {}) {
  const { event_item_id, band_id } = opts;
  let sql = `
    SELECT he.id AS heat_entry_id, he.competition_id, he.band_id, he.event_item_id,
           he.athlete_id, he.athlete_name, he.school_id, he.school_name,
           he.result_value, he.result_text, he.rank_no,
           e.name AS event_name, e.grade_standard_id, e.event_type,
           gb.label AS band_label, gb.gender, gb.stage
      FROM heat_entry he
      JOIN track_heat h ON h.id = he.heat_id
      JOIN event_item e ON e.id = he.event_item_id
      LEFT JOIN group_band gb ON gb.id = he.band_id
     WHERE he.competition_id = ? AND h.confirm_flag = 1
       AND he.result_value IS NOT NULL
       AND (he.status_code IS NULL OR he.status_code = '')
       AND e.grade_standard_id IS NOT NULL`;
  const p = [competitionId];
  if (event_item_id) { sql += ' AND he.event_item_id = ?'; p.push(event_item_id); }
  if (band_id) { sql += ' AND he.band_id = ?'; p.push(band_id); }

  const rows = await query(sql, p);
  // 赛事级达级加分规则（可覆盖标准自带的加分）
  const bonusRules = await query(
    'SELECT * FROM meet_grade_bonus_rule WHERE competition_id = ? AND status = 1', [competitionId]
  );
  const bonusMap = new Map(bonusRules.map((r) => [r.grade_code, Number(r.bonus_value) || 0]));

  let created = 0, updated = 0, skipped = 0;
  for (const r of rows) {
    const ths = await query(
      `SELECT t.*, s.result_direction, s.result_entry_type
         FROM grade_standard_threshold t
         JOIN grade_standard s ON s.id = t.standard_id
        WHERE t.standard_id = ? ORDER BY t.sort_no, t.id`,
      [r.grade_standard_id]
    );
    if (!ths.length) { skipped++; continue; }

    const g = judgeGrade(r.result_value, ths);
    if (!g) { skipped++; continue; }

    const bonus = bonusMap.has(g.grade_code) ? bonusMap.get(g.grade_code) : g.bonus_value;

    const exist = await queryOne(
      `SELECT * FROM grade_achievement
        WHERE competition_id = ? AND event_item_id = ? AND athlete_id = ?`,
      [competitionId, r.event_item_id, r.athlete_id]
    );
    if (exist) {
      // 已有认定：只在等级更高或成绩更好时覆盖
      const better = GRADE_ORDER.indexOf(g.grade_code) < GRADE_ORDER.indexOf(exist.grade_code);
      if (better) {
        await execute(
          `UPDATE grade_achievement SET grade_code=?, grade_name=?, bonus_value=?,
            result_value=?, result_text=?, confirm_flag=1 WHERE id=?`,
          [g.grade_code, g.grade_name, bonus, g.result_value, r.result_text, exist.id]
        );
        updated++;
      } else {
        skipped++;
      }
    } else {
      await execute(
        `INSERT INTO grade_achievement
          (competition_id, band_id, event_item_id, athlete_id, athlete_name, school_id, team_name,
           result_value, result_text, grade_code, grade_name, bonus_value, confirm_flag)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`,
        [competitionId, r.band_id, r.event_item_id, r.athlete_id, r.athlete_name,
         r.school_id, r.school_name, g.result_value, r.result_text,
         g.grade_code, g.grade_name, bonus]
      );
      created++;
    }
  }
  return { scanned: rows.length, created, updated, skipped };
}

/**
 * 破纪录检测
 * 对每条已确认成绩，查 meet_record 里登记的赛会纪录/最高纪录，判断是否打破
 */
async function detectRecordBreaks(competitionId, opts = {}) {
  const { event_item_id, band_id } = opts;
  let sql = `
    SELECT he.id AS heat_entry_id, he.competition_id, he.band_id, he.event_item_id,
           he.athlete_id, he.athlete_name, he.school_id, he.school_name,
           he.result_value, he.result_text,
           e.name AS event_name, e.event_type, e.is_higher_better, e.event_unit,
           h.round_code
      FROM heat_entry he
      JOIN track_heat h ON h.id = he.heat_id
      JOIN event_item e ON e.id = he.event_item_id
     WHERE he.competition_id = ? AND h.confirm_flag = 1
       AND he.result_value IS NOT NULL
       AND (he.status_code IS NULL OR he.status_code = '')`;
  const p = [competitionId];
  if (event_item_id) { sql += ' AND he.event_item_id = ?'; p.push(event_item_id); }
  if (band_id) { sql += ' AND he.band_id = ?'; p.push(band_id); }

  const rows = await query(sql, p);
  const records = await query(
    'SELECT * FROM meet_record WHERE competition_id = ? AND status = 1 AND detect_flag = 1',
    [competitionId]
  );
  const recMap = new Map();
  records.forEach((rc) => recMap.set(`${rc.event_item_id}:${rc.band_id ?? ''}`, rc));

  const bonusRules = await query(
    'SELECT * FROM meet_record_bonus_rule WHERE competition_id = ? AND status = 1', [competitionId]
  );
  const bonusMap = new Map(bonusRules.map((r) => [r.record_type, Number(r.bonus_value) || 0]));

  let created = 0;
  const breaks = [];

  for (const r of rows) {
    const rc = recMap.get(`${r.event_item_id}:${r.band_id ?? ''}`)
      || recMap.get(`${r.event_item_id}:`);
    if (!rc) continue;

    const v = Number(r.result_value);
    const higher = Number(r.is_higher_better) === 1;

    const candidates = [];
    const mv = Number(rc.meet_record_result_value);
    if (!Number.isNaN(mv) && rc.meet_record_result_value !== null) {
      if ((higher && v > mv) || (!higher && v < mv)) {
        candidates.push({ type: 'MEET', old_value: rc.meet_record_value, old_num: mv });
      }
    }
    const hv = Number(rc.highest_record_result_value);
    if (!Number.isNaN(hv) && rc.highest_record_result_value !== null) {
      if ((higher && v > hv) || (!higher && v < hv)) {
        candidates.push({ type: 'HIGHEST', old_value: rc.highest_record_value, old_num: hv });
      }
    }

    for (const c of candidates) {
      const exist = await queryOne(
        `SELECT id FROM record_break
          WHERE competition_id = ? AND event_item_id = ? AND athlete_id = ? AND record_type = ?`,
        [competitionId, r.event_item_id, r.athlete_id, c.type]
      );
      if (exist) continue;
      const bonus = bonusMap.get(c.type) || 0;
      const ins = await execute(
        `INSERT INTO record_break
          (competition_id, band_id, event_item_id, athlete_id, athlete_name, school_id, team_name,
           result_value, result_text, record_type, old_value, bonus_value, confirm_flag)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`,
        [competitionId, r.band_id, r.event_item_id, r.athlete_id, r.athlete_name,
         r.school_id, r.school_name, v, r.result_text, c.type, c.old_value, bonus]
      );
      created++;
      breaks.push({
        id: ins.insertId, record_type: c.type, event_name: r.event_name,
        athlete_name: r.athlete_name, school_name: r.school_name,
        result_text: r.result_text, old_value: c.old_value, bonus_value: bonus
      });

      // 回写新纪录（只在更好时覆盖：一轮检测里可能多人破同一纪录）
      if (c.type === 'MEET') {
        await execute(
          `UPDATE meet_record SET meet_record_value=?, meet_record_result_value=?,
            meet_record_holder=?, meet_record_meet_name=(SELECT name FROM competition WHERE id=?)
           WHERE id=? AND (meet_record_result_value IS NULL
             OR (CASE WHEN ? = 1 THEN ? > meet_record_result_value ELSE ? < meet_record_result_value END))`,
          [r.result_text, v, r.athlete_name, competitionId, rc.id,
           higher ? 1 : 0, v, v]
        );
      } else {
        await execute(
          `UPDATE meet_record SET highest_record_value=?, highest_record_result_value=?,
            highest_record_holder=?, highest_record_meet_name=(SELECT name FROM competition WHERE id=?)
           WHERE id=? AND (highest_record_result_value IS NULL
             OR (CASE WHEN ? = 1 THEN ? > highest_record_result_value ELSE ? < highest_record_result_value END))`,
          [r.result_text, v, r.athlete_name, competitionId, rc.id,
           higher ? 1 : 0, v, v]
        );
      }
    }
  }
  return { scanned: rows.length, created, breaks };
}

module.exports = { recognizeGrades, detectRecordBreaks, judgeGrade, GRADE_ORDER, GRADE_NAME };
