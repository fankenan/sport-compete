/**
 * 田径编排与成绩处理服务
 * ------------------------------------------------------------------
 * 1. splitHeats       —— 按人数切分分组（蛇形 / 抽签 / 同校分开）
 * 2. assignLanes      —— 道次分配（蛇形 / 抽签 / 按成绩）
 * 3. computeHeatRank  —— 本组成绩排名次（含并列）
 * 4. applyAdvancement —— 按晋级规则生成下一轮名单
 * 5. computeCombined  —— 全能总分汇总
 */

const { query, queryOne, execute } = require('../db');
const scoreEngine = require('./scoreEngine');

// ============================================================
// 一、分组
// ============================================================

/**
 * 把一批运动员切成若干组
 * @param {Array} athletes [{ athlete_id, school_id, athlete_name, bib_no }]
 * @param {object} rule { round_mode, lane_count, heat_capacity, fixed_heat_count, lane_order_mode, seed_mode }
 * @returns {Array<Array>} 分组结果
 */
function splitHeats(athletes, rule = {}) {
  const list = [...athletes];
  const capacity = Number(rule.heat_capacity) || Number(rule.lane_count) || 8;

  // 排序：种子依据
  const seedMode = rule.seed_mode || 'NONE';
  if (seedMode === 'BY_BIB') {
    list.sort((a, b) => Number(a.bib_no || 0) - Number(b.bib_no || 0));
  } else if (seedMode === 'BY_RESULT') {
    list.sort((a, b) => Number(b.seed_value || 0) - Number(a.seed_value || 0));
  }

  // 确定组数
  let heatCount;
  if (rule.round_mode === 'FIXED' && rule.fixed_heat_count) {
    heatCount = Number(rule.fixed_heat_count);
  } else {
    heatCount = Math.max(1, Math.ceil(list.length / capacity));
  }

  const heats = Array.from({ length: heatCount }, () => []);

  const mode = rule.lane_order_mode || 'SNAKE';
  if (mode === 'SNAKE') {
    // 蛇形：1,2,3 → 3,2,1 → 1,2,3 … 依次循环，保证各组人数均衡
    const wave = heatCount * 2;
    list.forEach((a, i) => {
      const pos = i % wave;
      const h = pos < heatCount ? pos : wave - 1 - pos;
      heats[h].push(a);
    });
  } else if (mode === 'SAME_SCHOOL_SPREAD') {
    // 同校尽量分开：按学校轮转发牌
    const bySchool = new Map();
    for (const a of list) {
      const k = a.school_id || 0;
      if (!bySchool.has(k)) bySchool.set(k, []);
      bySchool.get(k).push(a);
    }
    const schools = [...bySchool.values()].sort((a, b) => b.length - a.length);
    let h = 0;
    for (const group of schools) {
      for (const a of group) {
        // 找一个本组还没有该校选手、且人最少的组
        let target = -1;
        for (let i = 0; i < heatCount; i++) {
          const cand = (h + i) % heatCount;
          if (heats[cand].length >= capacity) continue;
          if (!heats[cand].some((x) => (x.school_id || 0) === (a.school_id || 0))) { target = cand; break; }
        }
        if (target < 0) {
          for (let i = 0; i < heatCount; i++) {
            const cand = (h + i) % heatCount;
            if (heats[cand].length < capacity) { target = cand; break; }
          }
        }
        if (target < 0) target = 0;
        heats[target].push(a);
        h = (target + 1) % heatCount;
      }
    }
  } else {
    // DRAW 抽签：随机打乱后顺序发牌
    const shuffled = [...list];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    shuffled.forEach((a, i) => heats[Math.floor(i / capacity)]?.push(a));
  }

  return heats.filter((h) => h.length > 0 || heats.length === 1);
}

// ============================================================
// 二、道次
// ============================================================

/**
 * 给一组人分配道次
 * @param {Array} entries 组内名单
 * @param {object} rule { lane_count, lane_order_mode }
 * @param {number} laneCount
 * 返回 [{ ...entry, lane_no }]
 */
function assignLanes(entries, rule = {}, laneCount = 8) {
  const lanes = Number(rule.lane_count || laneCount || 8);
  const mode = rule.lane_order_mode || 'SNAKE';
  const n = Math.min(entries.length, lanes);

  // 不满道次时，从第二道起排（范本规则）
  const startLane = entries.length < lanes ? 2 : 1;
  const laneList = [];
  for (let i = 0; i < lanes; i++) {
    const lane = startLane + i;
    if (lane <= lanes) laneList.push(lane);
  }
  // 若从 2 道起排导致道位不够（如 8 道排 8 人），退回从 1 道
  if (laneList.length < entries.length) {
    for (let i = 1; i <= lanes; i++) laneList.push(i);
  }

  const out = entries.map((e, i) => ({ ...e }));

  if (mode === 'BY_RANK') {
    // 按上一轮成绩优劣，好的排中间道（4/5/3/6/2/7/1/8）
    const sorted = [...out].sort((a, b) => {
      const va = a.prev_rank ?? 999, vb = b.prev_rank ?? 999;
      return va - vb;
    });
    const order = centerOutOrder(lanes);
    sorted.forEach((e, i) => { e.lane_no = order[i] ?? (i + 1); });
    return out.map((e) => {
      const hit = sorted.find((s) => s.athlete_id === e.athlete_id);
      return hit || e;
    });
  }

  if (mode === 'DRAW') {
    const pool = [...laneList];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    out.forEach((e, i) => { e.lane_no = pool[i] ?? (i + 1); });
    return out;
  }

  // SNAKE 默认：按组内顺序依次占道
  out.forEach((e, i) => { e.lane_no = laneList[i] ?? (i + 1); });
  void n;
  return out;
}

/** 由中间向两边的道次顺序：8道 → 4,5,3,6,2,7,1,8 */
function centerOutOrder(lanes) {
  const mid = Math.ceil(lanes / 2);
  const order = [];
  let l = mid, r = mid + 1;
  while (order.length < lanes) {
    if (l >= 1) order.push(l--);
    if (r <= lanes && order.length < lanes) order.push(r++);
    if (l < 1 && r > lanes) break;
  }
  return order.filter((x) => x >= 1 && x <= lanes);
}

// ============================================================
// 三、名次
// ============================================================

/**
 * 给一组算名次
 * @param {Array} entries heat_entry 行（含 result_value / status_code）
 * @param {object} event { is_higher_better, result_decimal_places }
 * @param {string} tieMode RANK / SHARE / NEXT
 */
function computeHeatRank(entries, event = {}, tieMode = 'RANK') {
  const higherBetter = Number(event.is_higher_better) === 1;

  // 有成绩的
  const scored = entries
    .filter((e) => !e.status_code && e.result_value !== null && e.result_value !== undefined && Number.isFinite(Number(e.result_value)))
    .map((e) => ({ ...e, _v: Number(e.result_value) }));

  scored.sort((a, b) => (higherBetter ? b._v - a._v : a._v - b._v));

  if (tieMode === 'NEXT') {
    scored.forEach((e, i) => { e.rank_no = i + 1; });
  } else {
    let i = 0;
    while (i < scored.length) {
      let j = i;
      while (j + 1 < scored.length && scored[j + 1]._v === scored[i]._v) j++;
      const rank = i + 1;
      for (let k = i; k <= j; k++) scored[k].rank_no = rank;
      i = j + 1;
    }
  }
  // 人工指定的名次优先
  const byId = new Map(scored.map((e) => [e.id, e]));
  for (const e of entries) {
    if (Number(e.manual_rank_flag) === 1 && e.rank_no) {
      const hit = byId.get(e.id);
      if (hit) hit.rank_no = Number(e.rank_no);
    }
  }
  // 无成绩的排最后，不给名次
  for (const e of entries) {
    if (!byId.has(e.id)) e.rank_no = null;
  }
  return entries.map((e) => {
    const hit = byId.get(e.id);
    return hit ? { ...e, rank_no: hit.rank_no } : e;
  });
}

// ============================================================
// 四、晋级
// ============================================================

/**
 * 按规则挑选晋级者
 * @param {Array} heats 本赛次所有组（每组含 entries，已算名次）
 * @param {object} rule advancement_rule 行
 * @param {object} event
 * @returns {Array} 晋级者（含 advance_reason）
 */
function pickAdvancers(heats, rule = {}, event = {}) {
  const mode = rule.advancement_mode || 'BY_PLACE';
  const byPlace = Number(rule.qualify_by_place || 0);
  const byResult = Number(rule.qualify_by_result || 0);
  const total = Number(rule.advance_total_count || 0);
  const higherBetter = Number(event.is_higher_better) === 1;

  const picked = [];
  const seen = new Set();

  if (mode === 'BY_PLACE' || mode === 'MIXED') {
    for (const h of heats) {
      const sorted = h.entries
        .filter((e) => e.rank_no && !e.status_code)
        .sort((a, b) => a.rank_no - b.rank_no);
      sorted.slice(0, byPlace).forEach((e) => {
        if (seen.has(e.athlete_id)) return;
        seen.add(e.athlete_id);
        picked.push({ ...e, advance_reason: `按名次第 ${e.rank_no} 名`, source_heat_id: h.id });
      });
    }
  }

  if ((mode === 'BY_RESULT' || mode === 'MIXED') && byResult > 0) {
    const rest = [];
    for (const h of heats) {
      for (const e of h.entries) {
        if (seen.has(e.athlete_id)) continue;
        if (e.status_code || e.result_value === null || e.result_value === undefined) continue;
        rest.push({ ...e, source_heat_id: h.id, _v: Number(e.result_value) });
      }
    }
    rest.sort((a, b) => (higherBetter ? b._v - a._v : a._v - b._v));
    rest.slice(0, byResult).forEach((e) => {
      if (seen.has(e.athlete_id)) return;
      seen.add(e.athlete_id);
      picked.push({ ...e, advance_reason: '按成绩递补' });
    });
  }

  if (mode === 'BY_RESULT' && byPlace === 0) {
    // 纯按成绩：全场统一排序取前 N
    const all = [];
    for (const h of heats) {
      for (const e of h.entries) {
        if (e.status_code || e.result_value === null || e.result_value === undefined) continue;
        all.push({ ...e, source_heat_id: h.id, _v: Number(e.result_value) });
      }
    }
    all.sort((a, b) => (higherBetter ? b._v - a._v : a._v - b._v));
    picked.length = 0;
    seen.clear();
    all.slice(0, total || byResult || 8).forEach((e) => {
      if (seen.has(e.athlete_id)) return;
      seen.add(e.athlete_id);
      picked.push({ ...e, advance_reason: '按成绩录取' });
    });
  }

  if (total > 0 && picked.length > total) {
    picked.length = total;
  }
  return picked;
}

// ============================================================
// 五、全能总分
// ============================================================

/**
 * 汇总一名运动员的全能总分
 * @param {number} competitionId
 * @param {number} parentEventId
 * @param {number} bandId
 * @param {number} athleteId
 */
async function computeCombinedTotal(competitionId, parentEventId, bandId, athleteId) {
  const children = await query(
    `SELECT e.id, e.name, e.result_entry_type, e.event_unit, e.result_decimal_places,
            e.is_higher_better, r.calculation_type, r.formula_type, r.coefficient_a,
            r.coefficient_b, r.coefficient_c, r.input_unit, r.rounding_mode,
            r.timing_adjustment, r.source_score_table_id
       FROM event_item e
       LEFT JOIN event_score_rule r ON r.event_item_id = e.id
      WHERE e.combined_parent_id = ? ORDER BY e.combined_item_order, e.id`,
    [parentEventId]
  );

  let total = 0, finished = 0, missing = 0;
  const details = [];

  for (const c of children) {
    // 取该运动员在该子项的最好成绩
    const row = await queryOne(
      `SELECT he.result_value, he.result_text, he.status_code
         FROM heat_entry he
        WHERE he.competition_id = ? AND he.event_item_id = ? AND he.athlete_id = ?
          AND he.status_code IS NULL
        ORDER BY he.result_value ${Number(c.is_higher_better) === 1 ? 'DESC' : 'ASC'}
        LIMIT 1`,
      [competitionId, c.id, athleteId]
    );

    let score = 0;
    if (row && row.result_value !== null) {
      let tableRows = null;
      if (c.calculation_type === 'TABLE' && c.source_score_table_id) {
        tableRows = await query(
          'SELECT * FROM score_table_detail WHERE score_table_id = ? ORDER BY result_value',
          [c.source_score_table_id]
        );
      }
      score = scoreEngine.toScore({
        entryType: c.result_entry_type,
        value: Number(row.result_value),
        rule: c,
        tableRows
      });
      finished++;
    } else {
      missing++;
    }
    total += score;
    details.push({
      child_event_item_id: c.id,
      item_order: children.indexOf(c) + 1,
      item_name: c.name,
      result_text: row?.result_text || null,
      result_value: row?.result_value ?? null,
      score
    });
  }

  return { total, finished, missing, details };
}

module.exports = {
  splitHeats,
  assignLanes,
  centerOutOrder,
  computeHeatRank,
  pickAdvancers,
  computeCombinedTotal
};
