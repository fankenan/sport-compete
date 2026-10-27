/**
 * 田径成绩处理引擎
 * ------------------------------------------------------------------
 * 负责三件事：
 *   1. 成绩录入文本的解析与格式化（时间 / 远度 / 高度 / 分值）
 *   2. 成绩 → 积分 的换算（国际田联公式 / 查表）
 *   3. 全能项目总分汇总
 */

// ============================================================
// 一、成绩解析
// ============================================================

/**
 * 把录入框里的成绩文本解析成可比较的数值
 *   TIME     : "12.34" / "1:23.45" / "11\"23" / "1'23\"45" → 秒
 *   DISTANCE : "5.62" → 米
 *   HEIGHT   : "1.75" → 米
 *   POINT    : "856"  → 分
 * 返回 null 表示无法解析
 */
function parseResult(text, entryType = 'TIME') {
  if (text === null || text === undefined) return null;
  const s = String(text).trim();
  if (!s) return null;

  // 特殊状态：DNS 未出发 / DNF 未完成 / DQ 取消资格 / NM 无成绩
  if (/^(DNS|DNF|DQ|NM|WD)$/i.test(s)) return null;

  if (entryType === 'TIME') {
    return parseTime(s);
  }

  // 远度 / 高度 / 分值：纯数字
  const m = s.replace(/[^\d.]/g, '');
  if (!m) return null;
  const v = Number(m);
  return Number.isFinite(v) ? v : null;
}

/**
 * 时间解析，统一返回「秒」
 * 支持：12.34 | 1:23.45 | 11"23 | 1'23"45 | 1:02:03.4
 */
function parseTime(s) {
  const t = String(s).trim();

  // 1:02:03.4 / 1:23.45 / 23.45
  if (/^\d+:\d+/.test(t)) {
    const parts = t.split(':');
    let sec = 0;
    for (let i = 0; i < parts.length; i++) {
      sec = sec * 60 + (Number(parts[i]) || 0);
    }
    return Number.isFinite(sec) ? Number(sec.toFixed(3)) : null;
  }

  // 11"23  或  1'23"45
  const qm = t.match(/^(?:(\d+)'(\d+)")?(\d+)(?:[."](\d+))?"?$/);
  if (qm) {
    const min = Number(qm[1] || 0);
    const secWhole = Number(qm[2] !== undefined ? qm[2] : qm[3]);
    const frac = qm[4] ? Number('0.' + qm[4]) : (qm[2] !== undefined ? 0 : 0);
    const total = min * 60 + secWhole + frac;
    return Number.isFinite(total) ? Number(total.toFixed(3)) : null;
  }

  // 纯秒：12.34
  const v = Number(t.replace(/[^\d.]/g, ''));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * 把数值格式化成展示文本
 * TIME     : 65.43 → 1:05.43 ；11.23 → 11.23
 * DISTANCE : 5.62 → 5.62
 */
function formatResult(value, entryType = 'TIME', decimals = 2, unit = '') {
  if (value === null || value === undefined || value === '') return '';
  let v = Number(value);
  if (!Number.isFinite(v)) return '';

  let text;
  if (entryType === 'TIME') {
    if (v >= 60) {
      const m = Math.floor(v / 60);
      const s = v - m * 60;
      text = decimals > 0
        ? `${m}:${s.toFixed(decimals).padStart(decimals + 3, '0')}`
        : `${m}:${String(Math.round(s)).padStart(2, '0')}`;
    } else {
      text = v.toFixed(decimals);
    }
  } else {
    text = v.toFixed(decimals);
  }
  return unit ? text + unit : text;
}

/** 特殊状态判定 */
const RESULT_STATUS = {
  DNS: '未出发',
  DNF: '未完成',
  DQ: '取消资格',
  NM: '无成绩',
  WD: '弃权'
};

function statusText(code) {
  return RESULT_STATUS[String(code || '').toUpperCase()] || '';
}

function isSpecialStatus(text) {
  return !!RESULT_STATUS[String(text || '').trim().toUpperCase()];
}

// ============================================================
// 二、成绩 → 积分
// ============================================================

/**
 * 国际田联（World Athletics）全能评分公式
 *   径赛：P = A × (B − T)^C     T 为秒
 *   田赛：P = A × (M − B)^C     M 为厘米（跳跃）或米（投掷）
 * @param {string} entryType TIME / DISTANCE / HEIGHT
 * @param {number} value    成绩数值（秒 / 厘米 / 米）
 * @param {object} rule     { coefficient_a, coefficient_b, coefficient_c, input_unit, rounding_mode, timing_adjustment, formula_type }
 * @returns {number} 积分（整数）
 */
function scoreByFormula(entryType, value, rule) {
  const A = Number(rule.coefficient_a);
  const B = Number(rule.coefficient_b);
  const C = Number(rule.coefficient_c);
  if (!Number.isFinite(A) || !Number.isFinite(B) || !Number.isFinite(C)) return 0;

  let v = Number(value);
  if (!Number.isFinite(v)) return 0;

  // 单位归一：公式里跳跃用厘米、投掷用米、径赛用秒
  const unit = String(rule.input_unit || '').toLowerCase();
  if (unit === 'cm') v = v * 100;
  else if (unit === 'm' && entryType === 'HEIGHT') v = v; // 已是米
  else if (unit === 'm' && entryType === 'DISTANCE') v = v; // 已是米

  // 手计时修正
  const adj = Number(rule.timing_adjustment || 0);
  if (adj && entryType === 'TIME') v = v + adj;

  let base;
  if (entryType === 'TIME') {
    // 时间越短越好：B 是基准秒数
    base = B - v;
  } else {
    // 远度/高度越大越好：B 是基线
    base = v - B;
  }

  if (!(base > 0)) return 0;

  const raw = A * Math.pow(base, C);
  return roundScore(raw, rule.rounding_mode || 'FLOOR');
}

function roundScore(raw, mode = 'FLOOR') {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  switch (String(mode).toUpperCase()) {
    case 'ROUND': return Math.round(raw);
    case 'CEIL': return Math.ceil(raw);
    case 'FLOOR':
    default: return Math.floor(raw);
  }
}

/**
 * 查表换算
 * @param {Array<{result_value:number, score_value:number}>} rows 明细（按成绩升序）
 * @param {number} value 成绩
 * @param {boolean} higherBetter 越大越好（田赛）
 */
function scoreByTable(rows, value, higherBetter = false) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;

  let hit = null;
  if (higherBetter) {
    // 找不超过成绩的最大档
    for (const r of rows) {
      if (Number(r.result_value) <= v) {
        if (!hit || Number(r.result_value) > Number(hit.result_value)) hit = r;
      }
    }
  } else {
    // 径赛：找不低于成绩的最小档（成绩越慢分越低）
    for (const r of rows) {
      if (Number(r.result_value) >= v) {
        if (!hit || Number(r.result_value) < Number(hit.result_value)) hit = r;
      }
    }
  }
  return hit ? Number(hit.score_value) : 0;
}

/**
 * 通用入口：按规则把成绩换成分值
 * @param {object} opts { entryType, value, rule, tableRows }
 */
function toScore(opts) {
  const { entryType, value, rule, tableRows } = opts;
  if (!rule) return 0;
  if (rule.calculation_type === 'TABLE') {
    return scoreByTable(tableRows || [], value, entryType !== 'TIME');
  }
  if (rule.formula_type === 'LINEAR') {
    // 线性：score = a * (value - b) + c
    const a = Number(rule.coefficient_a) || 0;
    const b = Number(rule.coefficient_b) || 0;
    const c = Number(rule.coefficient_c) || 0;
    const d = entryType === 'TIME' ? (b - Number(value)) : (Number(value) - b);
    return roundScore(a * d + c, rule.rounding_mode);
  }
  return scoreByFormula(entryType, value, rule);
}

// ============================================================
// 三、全能总分
// ============================================================

/**
 * 汇总一个运动员的全能总分
 * @param {Array} items [{ result_value, score }]
 * @returns {{total:number, finished:number, missing:number}}
 */
function sumCombined(items) {
  let total = 0, finished = 0, missing = 0;
  for (const it of items || []) {
    const s = Number(it && it.score);
    if (Number.isFinite(s) && s > 0) {
      total += s;
      finished++;
    } else {
      missing++;
    }
  }
  return { total, finished, missing };
}

// ============================================================
// 四、名次与并列
// ============================================================

/**
 * 按成绩排名次（支持并列跳号 / 并列共享名次）
 * @param {Array} rows 每项需含 { value }（value 为 null 表示无成绩）
 * @param {boolean} higherBetter
 * @param {string} tieMode RANK=并列后跳号 SHARE=并列同名次 NEXT=不并列
 */
function rankByResult(rows, higherBetter = false, tieMode = 'RANK') {
  const valid = rows.filter(r => r.value !== null && r.value !== undefined && Number.isFinite(Number(r.value)));
  valid.sort((a, b) => {
    const va = Number(a.value), vb = Number(b.value);
    return higherBetter ? vb - va : va - vb;
  });

  const invalid = rows.filter(r => !(r.value !== null && r.value !== undefined && Number.isFinite(Number(r.value))));
  for (const r of invalid) r.rank = null;

  if (tieMode === 'NEXT') {
    valid.forEach((r, i) => { r.rank = i + 1; });
    return rows;
  }

  let i = 0;
  while (i < valid.length) {
    let j = i;
    while (j + 1 < valid.length &&
           Number(valid[j + 1].value) === Number(valid[i].value)) j++;
    const count = j - i + 1;
    if (tieMode === 'SHARE') {
      // 并列共享名次，下一名跳号（1,2,2,4）
      for (let k = i; k <= j; k++) valid[k].rank = i + 1;
    } else {
      for (let k = i; k <= j; k++) valid[k].rank = i + 1;
    }
    i = j + 1;
    void count;
  }
  return rows;
}

module.exports = {
  parseResult,
  parseTime,
  formatResult,
  statusText,
  isSpecialStatus,
  RESULT_STATUS,
  scoreByFormula,
  scoreByTable,
  toScore,
  roundScore,
  sumCombined,
  rankByResult
};
