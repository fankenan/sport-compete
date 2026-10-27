/**
 * 团体总分计算引擎
 *
 * 三种口径：
 *   BAND    按组别分别排名（每个组别一张榜）
 *   MERGE   多个组别合并排名（如男女合起来算团体总分）
 *   VIRTUAL 虚拟组：把若干学校并成一个队参与排名（如"市区联队"）
 *
 * 计分来源：
 *   RANK        按名次查 score_table：{"1":9,"2":7,...}
 *   SCORE_RULE  直接用 heat_entry.score（项目绑定的评分规则算出来的分）
 *
 * 同分决胜：先比第一名个数，再比第二名、第三名。
 */
const { query, queryOne, execute } = require('../db');

/** 默认名次得分表（9/7/6/5/4/3/2/1） */
const DEFAULT_SCORE_TABLE = { 1: 9, 2: 7, 3: 6, 4: 5, 5: 4, 6: 3, 7: 2, 8: 1 };

function parseJson(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

function scoreTableOf(rule) {
  const t = parseJson(rule.score_table, null);
  if (!t || typeof t !== 'object') return { ...DEFAULT_SCORE_TABLE };
  const out = {};
  for (const [k, v] of Object.entries(t)) {
    const n = Number(k);
    if (Number.isInteger(n) && n > 0) out[n] = Number(v) || 0;
  }
  return Object.keys(out).length ? out : { ...DEFAULT_SCORE_TABLE };
}

/**
 * 取出某方案下所有可计分的成绩行
 * 只取已确认（confirm_flag=1）的赛次，且名次在录取范围内
 */
async function collectEntries(competitionId, rule) {
  const table = scoreTableOf(rule);
  const rankLimit = Number(rule.rank_limit) || 0;
  const bandIds = parseJson(rule.band_ids, []) || [];

  let sql = `
    SELECT he.id AS heat_entry_id, he.band_id, he.event_item_id, he.athlete_id,
           he.athlete_name, he.school_id, he.school_name,
           he.rank_no, he.result_text, he.score, he.status_code,
           e.name AS event_name, e.is_relay, e.event_type, e.team_score_multiplier,
           h.confirm_flag, h.round_code
      FROM heat_entry he
      JOIN track_heat h ON h.id = he.heat_id
      JOIN event_item e ON e.id = he.event_item_id
     WHERE he.competition_id = ? AND h.confirm_flag = 1
       AND he.rank_no IS NOT NULL
       AND (he.status_code IS NULL OR he.status_code = '')`;
  const p = [competitionId];

  if (bandIds.length) {
    sql += ` AND he.band_id IN (${bandIds.map(() => '?').join(',')})`;
    p.push(...bandIds.map(Number));
  }
  sql += ' ORDER BY he.event_item_id, he.band_id, he.rank_no, he.id';

  const rows = await query(sql, p);

  // 达级加分（按人按项）
  const gradeBonus = new Map();
  if (Number(rule.include_grade_bonus) === 1) {
    const g = await query(
      `SELECT athlete_id, event_item_id, SUM(bonus_value) AS b
         FROM grade_achievement
        WHERE competition_id = ? AND confirm_flag = 1
        GROUP BY athlete_id, event_item_id`, [competitionId]
    );
    g.forEach((x) => gradeBonus.set(`${x.athlete_id}:${x.event_item_id}`, Number(x.b) || 0));
  }

  // 破纪录加分
  const recordBonus = new Map();
  if (Number(rule.include_record_bonus) === 1) {
    const r = await query(
      `SELECT athlete_id, event_item_id, SUM(bonus_value) AS b
         FROM record_break
        WHERE competition_id = ? AND confirm_flag = 1
        GROUP BY athlete_id, event_item_id`, [competitionId]
    );
    r.forEach((x) => recordBonus.set(`${x.athlete_id}:${x.event_item_id}`, Number(x.b) || 0));
  }

  const relayMul = Number(rule.relay_multiplier) || 1;
  const items = [];
  for (const r of rows) {
    const rank = Number(r.rank_no);
    if (!Number.isInteger(rank) || rank <= 0) continue;
    if (rankLimit && rank > rankLimit) continue;

    let base = 0;
    if (rule.score_source === 'SCORE_RULE') {
      base = Number(r.score) || 0;
    } else {
      base = Number(table[rank] ?? 0);
    }
    const isRelay = Number(r.is_relay) === 1 || String(r.event_type) === 'RELAY';
    if (isRelay) base = Math.round(base * relayMul * 100) / 100;
    else {
      const mul = Number(r.team_score_multiplier) || 1;
      if (mul !== 1) base = Math.round(base * mul * 100) / 100;
    }

    const key = `${r.athlete_id}:${r.event_item_id}`;
    const gb = gradeBonus.get(key) || 0;
    const rb = recordBonus.get(key) || 0;

    items.push({
      heat_entry_id: r.heat_entry_id,
      band_id: r.band_id,
      event_item_id: r.event_item_id,
      athlete_id: r.athlete_id,
      athlete_name: r.athlete_name,
      school_id: r.school_id,
      school_name: r.school_name,
      rank_no: rank,
      result_text: r.result_text,
      score_type: isRelay ? 'RELAY' : (String(r.event_type) === 'COMBINED' ? 'COMBINED' : 'INDIVIDUAL'),
      base_score: base,
      grade_bonus: gb,
      record_bonus: rb,
      total_score: Math.round((base + gb + rb) * 100) / 100
    });
  }
  return items;
}

/**
 * 计算并物化团体总分
 * @returns {{items:number, units:number}}
 */
async function buildTeamScore(competitionId, rule) {
  const ruleId = rule.id;
  const mode = rule.scope_mode || 'BAND';

  const items = await collectEntries(competitionId, rule);

  // 清旧明细
  await execute('DELETE FROM team_score_item WHERE rule_id = ?', [ruleId]);
  for (const it of items) {
    await execute(
      `INSERT INTO team_score_item
        (competition_id, rule_id, band_id, event_item_id, heat_entry_id, athlete_id,
         athlete_name, school_id, school_name, rank_no, result_text, score_type,
         base_score, grade_bonus, record_bonus, total_score)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         band_id=VALUES(band_id), rank_no=VALUES(rank_no), result_text=VALUES(result_text),
         score_type=VALUES(score_type), base_score=VALUES(base_score),
         grade_bonus=VALUES(grade_bonus), record_bonus=VALUES(record_bonus),
         total_score=VALUES(total_score)`,
      [competitionId, ruleId, it.band_id, it.event_item_id, it.heat_entry_id, it.athlete_id,
       it.athlete_name, it.school_id, it.school_name, it.rank_no, it.result_text, it.score_type,
       it.base_score, it.grade_bonus, it.record_bonus, it.total_score]
    );
  }

  // 虚拟组映射：school_id -> {unit_type, unit_id, unit_name}
  const vmap = new Map();
  if (mode === 'VIRTUAL') {
    const vgs = await query(
      'SELECT * FROM virtual_group WHERE competition_id = ? AND (rule_id = ? OR rule_id IS NULL)',
      [competitionId, ruleId]
    );
    for (const vg of vgs) {
      const ids = parseJson(vg.school_ids, []) || [];
      for (const sid of ids) vmap.set(Number(sid), { unit_type: 'VIRTUAL', unit_id: vg.id, unit_name: vg.group_name });
    }
  }

  // 按单位聚合
  const agg = new Map();
  for (const it of items) {
    // MERGE / VIRTUAL：所有组别并到一起（band_id = null）
    const bandKey = mode === 'BAND' ? it.band_id : null;
    let unit = vmap.get(Number(it.school_id));
    if (!unit) {
      unit = { unit_type: 'SCHOOL', unit_id: it.school_id, unit_name: it.school_name };
    }
    const key = `${bandKey}|${unit.unit_type}|${unit.unit_id}`;
    if (!agg.has(key)) {
      agg.set(key, {
        band_id: bandKey, unit_type: unit.unit_type, unit_id: unit.unit_id, unit_name: unit.unit_name,
        total_score: 0, grade_bonus: 0, record_bonus: 0,
        first_count: 0, second_count: 0, third_count: 0
      });
    }
    const a = agg.get(key);
    a.total_score += it.base_score;
    a.grade_bonus += it.grade_bonus;
    a.record_bonus += it.record_bonus;
    if (it.rank_no === 1) a.first_count++;
    else if (it.rank_no === 2) a.second_count++;
    else if (it.rank_no === 3) a.third_count++;
  }

  // 保留已有的基础分调整，重新排名次
  const existed = await query('SELECT * FROM team_score_total WHERE rule_id = ?', [ruleId]);
  const adjustMap = new Map();
  existed.forEach((x) => adjustMap.set(
    `${x.band_id}|${x.unit_type}|${x.unit_id}`,
    { adjust_score: Number(x.adjust_score) || 0, adjust_reason: x.adjust_reason }
  ));

  await execute('DELETE FROM team_score_total WHERE rule_id = ?', [ruleId]);

  const list = [...agg.values()].map((a) => {
    const adj = adjustMap.get(`${a.band_id}|${a.unit_type}|${a.unit_id}`) || { adjust_score: 0, adjust_reason: null };
    a.total_score = Math.round(a.total_score * 100) / 100;
    a.grade_bonus = Math.round(a.grade_bonus * 100) / 100;
    a.record_bonus = Math.round(a.record_bonus * 100) / 100;
    a.adjust_score = adj.adjust_score;
    a.adjust_reason = adj.adjust_reason;
    a.final_score = Math.round((a.total_score + a.grade_bonus + a.record_bonus + a.adjust_score) * 100) / 100;
    return a;
  });

  // 分组排名（MERGE/BAND 下 band_id 相同的一组内排）
  const byBand = new Map();
  list.forEach((x) => {
    const k = String(x.band_id);
    if (!byBand.has(k)) byBand.set(k, []);
    byBand.get(k).push(x);
  });

  const tieMode = rule.tie_break_mode || 'FIRST';
  for (const group of byBand.values()) {
    group.sort((x, y) => {
      if (y.final_score !== x.final_score) return y.final_score - x.final_score;
      if (tieMode === 'FIRST') {
        if (y.first_count !== x.first_count) return y.first_count - x.first_count;
        if (y.second_count !== x.second_count) return y.second_count - x.second_count;
        if (y.third_count !== x.third_count) return y.third_count - x.third_count;
      }
      return String(x.unit_name || '').localeCompare(String(y.unit_name || ''), 'zh');
    });
    let prev = null, rank = 0;
    group.forEach((x, i) => {
      const same = prev !== null && Math.abs(x.final_score - prev) < 1e-9
        && (tieMode !== 'FIRST' || (x.first_count === group[i - 1].first_count
          && x.second_count === group[i - 1].second_count && x.third_count === group[i - 1].third_count));
      if (!same) rank = i + 1;
      x.rank_no = rank;
      x.rank_reason = same ? '并列' : '';
      prev = x.final_score;
    });
  }

  for (const x of list) {
    await execute(
      `INSERT INTO team_score_total
        (competition_id, rule_id, band_id, unit_type, unit_id, unit_name,
         total_score, grade_bonus, record_bonus, adjust_score, adjust_reason,
         final_score, first_count, second_count, third_count, rank_no, rank_reason)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [competitionId, ruleId, x.band_id, x.unit_type, x.unit_id, x.unit_name,
       x.total_score, x.grade_bonus, x.record_bonus, x.adjust_score, x.adjust_reason,
       x.final_score, x.first_count, x.second_count, x.third_count, x.rank_no, x.rank_reason || null]
    );
  }

  return { items: items.length, units: list.length };
}

module.exports = { buildTeamScore, collectEntries, scoreTableOf, DEFAULT_SCORE_TABLE, parseJson };
