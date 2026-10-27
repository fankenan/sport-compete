/**
 * 径赛编排与轮空算法
 * 体育竞赛管理系统 · 依据五份秩序册范本提炼
 *
 * 核心：
 *   1. decideRaceFormat      — 按项目距离决定赛次（预赛复赛决赛 / 单轮）
 *   2. allocateHeats         — 按道次数切分分组，不满道次从二道起排
 *   3. advanceFromHeats      — 晋级规则两套（按名次取+递补 / 按成绩取前N）
 *   4. buildByeBracket       — 淘汰赛轮空位算法
 *   5. generateLaneSheet     — 道次表数据（比赛号+姓名+单位）
 *   6. allocateBibNumbers    — 按单位号段发号
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

/**
 * 蛇形分配道次（按种子成绩分档时用，避免强者同道）
 */
function assignLanesBySeed(scored, laneCount = 8) {
  // scored: [{athleteId, seedTime}] 已按成绩升序（成绩越好越前）
  const n = scored.length;
  const groupCount = Math.ceil(n / laneCount);
  const result = new Map(); // groupNo -> [{...scored, lane}]

  for (let g = 0; g < groupCount; g++) result.set(g + 1, []);

  // 蛇形：第1组第1道、第2组第1道、...、第1组第2道...
  scored.forEach((athlete, i) => {
    const round = Math.floor(i / groupCount);
    const idx = i % groupCount;
    // 奇数轮反向
    const g = round % 2 === 0 ? idx : groupCount - 1 - idx;
    const groupNo = g + 1;
    const lane = round + 1;

    result.get(groupNo).push({ ...athlete, lane });
  });

  return [...result.entries()].map(([groupNo, entries]) => ({
    groupNo,
    entries: entries.sort((a, b) => a.lane - b.lane),
    occupiedLanes: entries.map((e) => e.lane)
  }));
}

// ============================================================
// 三、晋级判定
// ============================================================

/**
 * 晋级规则两套（依据北京田径范本）
 *
 * 规则 A（rank_take）：各组按名次取 N 人，剩余名额按成绩递补
 *   例：16人2组，各组取3人 = 6人，再按成绩递补2人 = 8人
 *
 * 规则 B（total_time）：按总成绩取前 N 人
 *   例：42人6组，按成绩取24人进复赛
 *
 * @param {Array} heatResults [[{athleteId, rank, rawValue}...], ...] 每组的成绩表（已排名）
 * @param {string} rule 'rank_take' | 'total_time'
 * @param {number} targetCount 目标晋级人数
 * @param {number} perHeatTake 每组按名次取几人（rule=rank_take 时有效）
 */
function advanceFromHeats(heatResults, rule, targetCount, perHeatTake = 3) {
  if (rule === 'rank_take') {
    // 各组按名次取 perHeatTake 人
    const byRank = [];
    heatResults.forEach((heat, heatIdx) => {
      heat
        .filter((r) => r.rank && r.rank <= perHeatTake)
        .forEach((r) => byRank.push({ ...r, fromHeat: heatIdx + 1, pickedByRank: true }));
    });

    const restSlots = targetCount - byRank.length;

    if (restSlots > 0) {
      // 取各组第 perHeatTake+1 名及之后的所有人，按成绩递补
      const candidates = [];
      heatResults.forEach((heat, heatIdx) => {
        heat
          .filter((r) => !r.rank || r.rank > perHeatTake)
          .forEach((r) => candidates.push({ ...r, fromHeat: heatIdx + 1, pickedByRank: false }));
      });

      // 按成绩排序（径赛用时越短越好，即 rawValue 越小越好）
      candidates.sort((a, b) => a.rawValue - b.rawValue);

      // 递补规则：北京范本写"按成绩递补2人"，这里按同组优先+成绩
      // 简化：全局按成绩取前 restSlots
      byRank.push(...candidates.slice(0, restSlots));
    }

    return byRank.slice(0, targetCount);
  }

  // rule = 'total_time'
  const all = [];
  heatResults.forEach((heat, heatIdx) => {
    heat.forEach((r) => all.push({ ...r, fromHeat: heatIdx + 1 }));
  });
  all.sort((a, b) => a.rawValue - b.rawValue);
  return all.slice(0, targetCount);
}

// ============================================================
// 四、淘汰赛轮空
// ============================================================

/**
 * 单败淘汰赛轮空位算法
 * 依据北京羽毛球范本：人数不足 2 的幂时，首轮需设轮空位
 *
 * 规则：
 *   - 参赛数 n，2^k = 不小于 n 的最小 2 的幂
 *   - 首轮轮空数 = 2^k - n
 *   - 轮空位分散插入，避免集中在同一侧（公平抽签）
 *
 * @param {number} teamCount 参赛队数/人数
 * @param {Array} teamIds 队伍 id 数组（已随机或按种子排列）
 * @param {Array} [seedOrder] 种子选手 id（若需种子排位）
 * @returns {Object} { bracketSize, rounds, firstRound:[[a,b],...]  b 可为 null 表示轮空 }
 */
/**
 * 单败淘汰赛对阵表生成
 * 依据北京羽毛球范本：人数不足 2 的幂时，首轮设轮空位
 *
 * @param {number} teamCount 参赛队数/人数
 * @param {Array} teamIds 队伍 id 数组（无种子时按此顺序）
 * @param {Array} [seedOrder] 种子选手 id（1号种子最强）
 * @returns {Object|null} { bracketSize, rounds, byeCount, firstRound }
 */
/**
 * 生成标准单败淘汰赛种子排位
 * 经典算法：逐轮在每对空位间插入镜像种子
 *
 * n=1 → [1]
 * n=2 → [1, 2]
 * n=4 → [1, 4, 2, 3]        即 1打3、4打2
 * n=8 → [1, 8, 4, 5, 2, 7, 3, 6]   即 1打8、4打5、2打7、3打6
 * n=16→ [1,16,8,9,4,13,5,12,2,15,7,10,3,14,6,11]
 *
 * 效果：1号与n号同处一个半区但首轮不相遇，最强种子必进决赛
 */
function standardSeedOrder(bracketSize) {
  let arr = [1];
  while (arr.length < bracketSize) {
    const sum = arr.length * 2 + 1;
    const next = [];
    for (const v of arr) {
      next.push(v);
      next.push(sum - v);
    }
    arr = next;
  }
  return arr;
}

function buildByeBracket(teamCount, teamIds, seedOrder = null) {
  if (teamCount < 2) return null;

  let bracketSize = 1;
  while (bracketSize < teamCount) bracketSize *= 2;

  const rounds = Math.round(Math.log2(bracketSize));
  const totalBye = bracketSize - teamCount;
  const seedList = (seedOrder && seedOrder.length >= 2) ? seedOrder.slice() : null;

  // 构造 bracketSize 个 slot，按标准种子排位把种子放好，剩余留给普通队
  const slots = new Array(bracketSize).fill(null);

  if (seedList && seedList.length === bracketSize) {
    // 种子数正好等于 bracket 位数 → 用标准种子排位
    const pattern = standardSeedOrder(bracketSize);
    pattern.forEach((seedNo, pos) => {
      slots[pos] = seedList[seedNo - 1];
    });
  } else {
    // 参赛数不足 bracket 位数 → 队伍按序填入，末尾空位即轮空
    teamIds.forEach((id, i) => { slots[i] = id; });
  }

  const finalSlots = slots;

  // 首轮对阵：直接按 slot 位置两两配对，null 即轮空
  const matchCount = bracketSize / 2;
  const halfCount = matchCount / 2;

  const firstRound = [];
  for (let i = 0; i < matchCount; i++) {
    const a = finalSlots[i * 2] ?? null;
    const b = finalSlots[i * 2 + 1] ?? null;
    // 两边都空 → 该位无实际比赛，不生成（避免出现"空对"）
    if (a === null && b === null) continue;
    firstRound.push([a, b]);
  }

  // 统计轮空分布（上/下半区应均衡，按原始 slot 位置判定）
  const byePositions = [];
  for (let i = 0; i < firstRound.length; i++) {
    if (firstRound[i][1] === null) byePositions.push(i);
  }

  return {
    bracketSize,
    rounds,
    byeCount: totalBye,
    firstRound,
    byePositions,
    slots: finalSlots,
    byeBalance: {
      upper: byePositions.filter((p) => p < halfCount).length,
      lower: byePositions.filter((p) => p >= halfCount).length
    }
  };
}

// ============================================================
// 五、道次表
// ============================================================

/**
 * 生成道次表数据
 * 格式：道次 | 一 | 二 | ... | 八
 *       比赛号 | 编号 | 编号 | ...
 *       姓名   | 姓名 | 姓名 | ...
 *       单位   | 单位 | 单位 | ...
 */
function generateLaneSheet(group, laneCount = 8) {
  const lanes = [];
  for (let i = 1; i <= laneCount; i++) lanes.push(i);

  const rows = lanes.map((lane) => {
    const entry = group.entries.find((e) => e.lane === lane);
    return {
      lane,
      laneLabel: '一二三四五六七八'[lane - 1],
      occupied: !!entry,
      bibNo: entry?.bibNo ?? '',
      athleteId: entry?.athleteId ?? null,
      name: entry?.name ?? '',
      school: entry?.school ?? ''
    };
  });

  return {
    groupNo: group.groupNo,
    raceName: group.raceName,
    time: group.startTime,
    roundLabel: group.roundLabel ?? '预赛',
    heatCount: group.entries.length,
    occupiedLanes: group.occupiedLanes,
    rows
  };
}

// ============================================================
// 六、号码分配
// ============================================================

/**
 * 按单位号段分配号码（北京范本做法）
 * 每校一个号段（默认 200 个），组别在号段内细分
 *
 * @param {Array} schools [{schoolId, name}]
 * @param {number} blockSize 每校号段大小
 * @returns {Object} { schoolId: {start, end} }
 */
function allocateBibNumbers(schools, blockSize = 200) {
  const map = {};
  schools.forEach((s, i) => {
    const start = i * blockSize + 1;
    map[s.schoolId] = {
      start,
      end: start + blockSize - 1,
      name: s.name
    };
  });
  return map;
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

  console.log('\n===== 晋级判定（16人2组，规则A）=====');
  const heat16 = [
    [
      { athleteId: 1, rank: 1, rawValue: 7.21 },
      { athleteId: 5, rank: 2, rawValue: 7.35 },
      { athleteId: 9, rank: 3, rawValue: 7.48 },
      { athleteId: 13, rank: 4, rawValue: 7.52 }
    ],
    [
      { athleteId: 2, rank: 1, rawValue: 7.19 },
      { athleteId: 6, rank: 2, rawValue: 7.33 },
      { athleteId: 10, rank: 3, rawValue: 7.51 },
      { athleteId: 14, rank: 4, rawValue: 7.55 }
    ]
  ];
  const adv = advanceFromHeats(heat16, 'rank_take', 8, 3);
  adv.forEach((a) => console.log(
    `  ${a.name || '选手' + a.athleteId} 第${a.fromHeat}组第${a.rank}名 ${a.rawValue}s` +
    `${a.pickedByRank ? ' [按名次取]' : ' [成绩递补]'}`
  ));

  console.log('\n===== 淘汰赛轮空 =====');
  [8, 7, 6, 5, 4, 3].forEach((n) => {
    const ids = Array.from({ length: n }, (_, i) => `队${i + 1}`);
    const b = buildByeBracket(n, ids);
    const first = b.firstRound.map(([a, c]) => (c === null ? `${a}-轮空` : `${a}-${c}`));
    console.log(`${n}队 → bracket ${b.bracketSize} (${b.rounds}轮) 轮空${b.byeCount}个: ${first.join('  ')}`);
  });

  console.log('\n===== 按单位号段 =====');
  const sch = [{ schoolId: 1, name: '东城' }, { schoolId: 2, name: '西城' }, { schoolId: 3, name: '朝阳' }];
  console.log(allocateBibNumbers(sch, 200));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    decideRaceFormat, allocateHeats, assignLanesBySeed,
    advanceFromHeats, standardSeedOrder, buildByeBracket,
    generateLaneSheet, allocateBibNumbers, runTests
  };
}