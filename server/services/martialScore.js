/**
 * 武术评分服务
 *
 * 武术是**评分制**：每位裁判独立给分，去掉一个最高分和一个最低分，
 * 其余取平均 —— 这是国内武术比赛的常规算法（类似体操/跳远评分）。
 *
 * 规则可配（event_item）：
 *   martial_judge_count   裁判人数（默认 5）
 *   martial_drop_highest  是否去掉最高最低（默认 1）
 *   martial_minutes       单套演练时长上限（秒）
 */

const DEFAULT_JUDGES = 5;

/**
 * 算分
 *
 * @param {Array<{judge?:string, score:number}>} scores 各裁判打分
 * @param {object} opts { judgeCount, dropHighest, dropLowest }
 * @returns {{
 *   total: number|null,   最终得分
 *   detail: string,       算分明细
 *   used: number[],       参与平均的分数
 *   dropped: number[],    被去掉的分数
 *   count: number,        有效打分数
 *   reason: string        不计分的原因（打分不足时）
 * }}
 */
function computeScore(scores, opts = {}) {
  const judgeCount = Number(opts.judgeCount) || DEFAULT_JUDGES;
  const drop = opts.dropHighest !== 0;

  const arr = Array.isArray(scores) ? scores : [];
  const valid = arr
    .map((s) => Number(s && typeof s === 'object' ? s.score : s))
    .filter((n) => Number.isFinite(n));

  if (!valid.length) {
    return { total: null, detail: '未评分', used: [], dropped: [], count: 0, reason: '尚未评分' };
  }

  if (valid.length < judgeCount) {
    return {
      total: null,
      detail: `打分不足（${valid.length}/${judgeCount}）`,
      used: [],
      dropped: [],
      count: valid.length,
      reason: `打分不足（${valid.length}/${judgeCount} 位裁判）`
    };
  }

  const sorted = [...valid].sort((a, b) => a - b);
  let used = sorted;
  let dropped = [];

  if (drop && sorted.length >= 3) {
    // 去掉一个最高、一个最低；人数不足 3 时不去极值
    dropped = [sorted[0], sorted[sorted.length - 1]];
    used = sorted.slice(1, sorted.length - 1);
  }

  const sum = used.reduce((s, n) => s + n, 0);
  const total = Math.round((sum / used.length) * 1000) / 1000;

  const detail = dropped.length
    ? `${total.toFixed(2)}（去 ${dropped.map((d) => d.toFixed(2)).join('/')}）`
    : `${total.toFixed(2)}`;

  return {
    total,
    detail,
    used: used.map((n) => Math.round(n * 1000) / 1000),
    dropped: dropped.map((n) => Math.round(n * 1000) / 1000),
    count: valid.length,
    reason: ''
  };
}

/**
 * 排名：按得分降序，同分按出场顺序（先出场的靠前，这是武术的惯例）
 *
 * @param {Array<{id:number, total_score:number|null, order_no:number}>} entries
 * @returns {Map<number, number>} entry_id → 名次
 */
function rankEntries(entries) {
  const scored = entries.filter((e) => Number(e.total_score) !== null && Number.isFinite(Number(e.total_score)));
  const unscored = entries.filter((e) => !scored.includes(e));

  const sorted = [...scored].sort((a, b) => {
    const d = Number(b.total_score) - Number(a.total_score);
    if (d !== 0) return d;
    return (a.order_no || 0) - (b.order_no || 0);
  });

  const map = new Map();
  let rank = 1;
  let prev = null;
  let prevScore = null;

  for (const e of sorted) {
    const sc = Number(e.total_score);
    if (prevScore !== null && sc === prevScore) {
      // 同分同名次
      map.set(e.id, rank);
    } else {
      rank = map.size + 1;
      map.set(e.id, rank);
    }
    prevScore = sc;
    prev = e;
  }
  // 未评分的不排名
  for (const e of unscored) map.set(e.id, null);
  return map;
}

/**
 * 校验一份打分是否合法
 */
function validateScores(scores, opts = {}) {
  const judgeCount = Number(opts.judgeCount) || DEFAULT_JUDGES;
  const arr = Array.isArray(scores) ? scores : [];
  const issues = [];

  const valid = arr.filter((s) => Number.isFinite(Number(s && typeof s === 'object' ? s.score : s)));
  if (valid.length < judgeCount) {
    issues.push(`打分不足：需要 ${judgeCount} 位裁判，当前 ${valid.length} 位`);
  }

  const vals = valid.map((s) => Number(s && typeof s === 'object' ? s.score : s));
  const over = vals.filter((v) => v < 0 || v > 10);
  if (over.length) {
    issues.push(`分数必须在 0~10 之间（越界 ${over.length} 个）`);
  }

  // 同一裁判重复打分
  const judges = arr
    .filter((s) => s && typeof s === 'object' && s.judge)
    .map((s) => String(s.judge).trim());
  const dup = judges.filter((j, i) => judges.indexOf(j) !== i);
  if (dup.length) {
    issues.push(`裁判重复打分：${[...new Set(dup)].join('、')}`);
  }

  return { ok: issues.length === 0, issues };
}

module.exports = {
  computeScore,
  rankEntries,
  validateScores,
  DEFAULT_JUDGES
};
