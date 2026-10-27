/**
 * 径赛赛次判定与分组切分
 * 体育竞赛管理系统 · 依据五份秩序册范本提炼
 *
 * 现保留（仅被 scheduler.generateTrackHeats 使用）：
 *   1. decideRaceFormat — 按项目距离决定赛次（预赛复赛决赛 / 单轮）
 *   2. allocateHeats    — 按道次数切分分组，不满道次从二道起排
 *
 * 2026-10-27 清理：以下函数全项目无人调用，已删除
 *   - advanceFromHeats   晋级实际走 trackArrange.pickAdvancers
 *   - standardSeedOrder / buildByeBracket   球类淘汰赛走 buildKnockoutPairing
 *   - generateLaneSheet  道次表由 trackResult 直接组装
 *   - allocateBibNumbers 发号走 TrackRace 号码簿
 *
 * 注：本文件与 trackArrange.js 存在能力重叠（切组 / 分道次）。
 * 统一径赛分组路径时（P1）应整体并入 trackArrange.js，本文件随之作废。
 */

// ============================================================
// 一、赛次判定
// ============================================================

/**
 * 按项目距离决定赛次格式
 * 依据北京田径范本：100/200米/直道栏 → 多赛次；400米及以上 → 只跑一次
 */
function decideRaceFormat(eventName, entryCount, laneCount = 8) {
  const isHurdle = /栏/.test(eventName);
  const isField = /跳远|跳高|铅球|标枪|铁饼|三级跳/.test(eventName);
  const distMatch = eventName.match(/(\d+)/);
  const dist = distMatch ? parseInt(distMatch[1], 10) : 0;

  // 田赛：只决赛，无分组概念
  if (isField) {
    return { format: 'field_final', heats: 1, needAdvance: false, note: '田赛只取成绩' };
  }

  // 400 米及以上（不含跨栏）：只跑一次，按电计时排定名次
  if (dist >= 400 && !isHurdle) {
    const heats = Math.ceil(entryCount / laneCount);
    return {
      format: 'single_round',
      heats,
      needAdvance: false,
      note: '按电计时成绩排定名次'
    };
  }

  // 人数不足一场：直接决赛
  if (entryCount <= laneCount) {
    return {
      format: 'final_only',
      heats: 1,
      needAdvance: false,
      note: '人数不满，直接决赛'
    };
  }

  // 预赛
  const prelimHeats = Math.ceil(entryCount / laneCount);

  // ≤16 人：预赛 + 决赛（各组按名次取 3 人 + 成绩递补 2 人）
  if (entryCount <= 16) {
    return {
      format: 'prelim_final',
      prelimHeats,
      heats: prelimHeats,
      needAdvance: true,
      advanceRule: 'rank_take',
      perHeatTake: 3,
      finalCount: 8
    };
  }

  // >16 人：预赛 + 复赛 + 决赛（按总成绩取前 24 人进复赛）
  const semiCount = 24;
  return {
    format: 'prelim_semi_final',
    prelimHeats,
    heats: prelimHeats,
    needAdvance: true,
    advanceRule: 'total_time',
    semiHeats: Math.ceil(semiCount / laneCount),
    semiCount,
    finalCount: 8
  };
}

// ============================================================
// 二、分组切分
// ============================================================

/**
 * 按道次数切分分组
 * 关键：不满道次时从"二道"起排，"一道"空缺（北京范本做法）
 *
 * @param {Array} entries 参赛者数组 [{athleteId, bibNo, name, school}]
 * @param {number} laneCount 道次数（通常 8）
 * @param {string} sortBy 'bib' 按号码顺序 | 'seed' 按种子成绩
 * @returns {Array} groups [{groupNo, entries:[{...entry, lane}], occupiedLanes}]
 */
function allocateHeats(entries, laneCount = 8, sortBy = 'bib') {
  const sorted = [...entries];
  if (sortBy === 'bib') sorted.sort((a, b) => a.bibNo - b.bibNo);
  else if (sortBy === 'seed') sorted.sort((a, b) => (a.seedTime ?? 999) - (b.seedTime ?? 999));

  const groupCount = Math.ceil(sorted.length / laneCount);
  const groups = [];

  for (let g = 0; g < groupCount; g++) {
    const slice = sorted.slice(g * laneCount, (g + 1) * laneCount);
    const group = {
      groupNo: g + 1,
      entries: [],
      occupiedLanes: []
    };

    // 满道次时用一至八道；不满道次从二道起排（一道留空）
    const startLane = slice.length >= laneCount ? 1 : 2;
    const maxLane = slice.length >= laneCount ? laneCount : laneCount;

    slice.forEach((entry, i) => {
      const lane = startLane + i;
      // 超过道次数则说明该组超过 8 人，理论上不会发生（已按 laneCount 切分）
      if (lane > maxLane) return;
      group.entries.push({ ...entry, lane });
      group.occupiedLanes.push(lane);
    });

    groups.push(group);
  }

  return groups;
}


// ============================================================
// 测试
// ============================================================

function runTests() {
  console.log('===== 赛次判定 =====');
  const cases = [
    ['100米', 30], ['100米', 42], ['100米', 8],
    ['200米', 16], ['400米', 33], ['800米', 30],
    ['1500米', 20], ['100米栏', 18], ['跳远', 12], ['铅球', 11]
  ];
  cases.forEach(([ev, n]) => {
    const r = decideRaceFormat(ev, n);
    console.log(
      `${ev.padEnd(8)} ${String(n).padStart(2)}人 → ${r.format.padEnd(18)}` +
      ` 预赛${r.heats}组 ${r.needAdvance ? `晋级:${r.advanceRule}` : '不晋级'}`
    );
  });

  console.log('\n===== 分组切分（42人，每组8人）=====');
  const entries42 = Array.from({ length: 42 }, (_, i) => ({
    athleteId: i + 1, bibNo: (i + 1) * 7 % 3800, name: `选手${i + 1}`, school: '测试小学'
  }));
  const g = allocateHeats(entries42, 8);
  g.forEach((grp) => {
    console.log(`第${grp.groupNo}组 ${grp.entries.length}人 道次[${grp.occupiedLanes.join(',')}]`);
  });

}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    decideRaceFormat, allocateHeats, runTests
  };
}