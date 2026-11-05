/**
 * 球类赛程编排引擎（时间轴模型）
 *
 * ============================================================
 * 为什么重写
 * ============================================================
 * 原来的模型把「日期 × 场地」预先切成**等距格子**：
 *     schedule_slot  UNIQUE (play_date, venue_id, slot_index)
 *     每格时长写死：end = start + (interval - 10)
 * 由此带来三个硬约束：
 *     1) 一格只能一场 —— 同时间同场地无法并行
 *     2) 每场时长一律 35 分钟 —— event_item.match_minutes 字段在全后端零引用
 *     3) 「生成时间槽」成了所有编排的前置门槛，而这步和"谁跟谁比"毫无关系
 *
 * ============================================================
 * 新模型
 * ============================================================
 *   · 场次自带时间地点：match_info.play_date / start_time / end_time / venue_id
 *   · schedule_slot 语义改为「**可用时间窗**」：当天某场地在某个时段可排比赛
 *   · 同一时间窗内可排多场，只要不重叠
 *   · 每场时长按项目的 match_minutes 决定（终于能用上了）
 *   · 排期算法：按「场地 × 时间窗」用**分钟游标**连续往下排
 *
 * 与田径的 services/timetable.js 是同一套思路（那里已经用了游标 + 冲突检测），
 * 这份是球类专用版，额外处理了「先分组后淘汰」的场次编排顺序。
 */

const { query, queryOne, execute, transaction } = require('../db');
const { addMinutes } = require('../utils/helpers');

/** 'HH:mm' → 分钟数 */
function toMinutes(t) {
  if (t === null || t === undefined || t === '') return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 分钟数 → 'HH:mm' */
function toTimeStr(min) {
  if (min === null || min === undefined) return null;
  const h = Math.floor(min / 60) % 24;
  const mm = min % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * 取某赛事的可用时间窗
 *
 * schedule_slot 现在表示「可用时间窗」：
 *   slot_type = 1 → 可排比赛的时间窗
 *   slot_type = 2 → 非比赛占位（开幕式/体测），该时段不可排比赛
 *   kind = 'WINDOW' | 'PLACEHOLDER'
 */
async function loadWindows(competitionId) {
  const rows = await query(
    `SELECT ss.*, v.venue_no, v.name AS venue_name
       FROM schedule_slot ss
       JOIN venue v ON v.id = ss.venue_id
      WHERE ss.competition_id = ?
      ORDER BY ss.play_date, v.venue_no, ss.start_time`,
    [competitionId]
  );
  return rows.map((r) => ({
    id: r.id,
    play_date: r.play_date,
    venue_id: r.venue_id,
    venue_no: r.venue_no,
    venue_name: r.venue_name,
    slot_index: r.slot_index,
    slot_type: r.slot_type,
    kind: r.kind || (r.slot_type === 2 ? 'PLACEHOLDER' : 'WINDOW'),
    start_min: toMinutes(r.start_time),
    end_min: toMinutes(r.end_time)
  }));
}

/**
 * 单场时长（分钟）
 *
 * 优先用项目配置的 match_minutes；缺省 30。
 * 这一步是"每场时长可不同"的关键 —— 原来的格子模型写死 35 分钟。
 */
async function matchDuration(eventItemId, fallback = 30) {
  const ev = await queryOne('SELECT match_minutes FROM event_item WHERE id = ?', [eventItemId]);
  const m = Number(ev?.match_minutes);
  return m > 0 ? m : fallback;
}

/**
 * 自动排期：把未排期的场次排进时间窗
 *
 * 排期顺序（决定同一天谁先打）：
 *   1) 小组赛按「小组」归拢 —— 同组尽量排在一起、最好同一天
 *   2) 淘汰赛按「轮次」归拢 —— 同一轮尽量连续，方便观众跟看
 *   3) 同一天内，阶段靠前的先排
 *
 * 约束：
 *   - 队伍不能同时在两个场地（同一支队伍一场只能打一场）
 *   - 同一队伍两场之间留 minimum_rest_minutes（默认 90 分钟）
 *   - 场地不重叠（同一时间窗内游标连续推进，天然不重叠）
 *
 * @param {number} competitionId
 * @param {object} opts { venue_id?, play_date?, gap_minutes? }
 */
async function autoArrange(competitionId, opts = {}) {
  const comp = await queryOne(
    'SELECT id, match_gap_minutes, minimum_rest_minutes FROM competition WHERE id = ?',
    [competitionId]
  );
  if (!comp) throw new Error('赛事不存在');

  const gap = Number(opts.gap_minutes ?? comp.match_gap_minutes ?? 10) || 10;
  const rest = Number(comp.minimum_rest_minutes ?? 90) || 90;

  const windows = await loadWindows(competitionId);
  if (!windows.length) {
    throw new Error('还没有设置比赛日程。请先在「赛程编排 → 比赛日程」里配置比赛日期与每天的可用时段');
  }

  const venues = await query(
    'SELECT * FROM venue WHERE competition_id=? ORDER BY venue_no', [competitionId]
  );
  if (!venues.length) throw new Error('尚未配置场地');

  // 待排场次：没有 play_date 的
  const where = ['m.competition_id = ?', 'm.play_date IS NULL'];
  const params = [competitionId];
  if (opts.venue_id) { where.push('m.venue_id = ? OR m.venue_id IS NULL'); params.push(opts.venue_id); }
  if (opts.play_date) { where.push('(m.play_date = ? OR m.play_date IS NULL)'); params.push(opts.play_date); }

  const matches = await query(
    `SELECT m.*, ei.match_minutes, ei.name AS event_name
       FROM match_info m
       JOIN event_item ei ON ei.id = m.event_item_id
      WHERE ${where.join(' AND ')}
      ORDER BY m.band_id, m.heat_group_id, m.round_no, m.seq_no`,
    params
  );

  if (!matches.length) {
    return { placed: 0, unplaced: 0, reason: '没有待排期的比赛' };
  }

  // 占位场次（对手未定）先不排，等上一轮赛果出来再排
  const ready = matches.filter((m) => m.team_a_id && m.team_b_id);
  const waiting = matches.length - ready.length;

  // 已排期的场次：占住场地时间和队伍时间
  const busy = await query(
    `SELECT m.*, ss.play_date, ss.start_time, ss.end_time, ss.venue_id
       FROM match_info m
       LEFT JOIN schedule_slot ss ON ss.id = m.slot_id
      WHERE m.competition_id = ? AND m.play_date IS NOT NULL`,
    [competitionId]
  );

  /** 每「日期×场地」的游标（分钟） */
  const cursors = new Map();
  /** 每「日期×场地」的已占用区间 */
  const taken = new Map();   // `${date}|${venue}` -> [{s,e}]
  /** 每支队伍在每天的已占用区间： `${date}|${team}` -> [{s,e}] */
  const teamBusy = new Map();

  const keyOf = (d, v) => `${d}|${v}`;

  // 初始化游标：每个时间窗开一个游标
  const winByKey = new Map();
  for (const w of windows) {
    if (w.kind === 'PLACEHOLDER') continue;
    const k = keyOf(w.play_date, w.venue_id);
    if (!winByKey.has(k)) winByKey.set(k, []);
    winByKey.get(k).push(w);
  }

  // 已占用的先登记
  for (const b of busy) {
    if (!b.play_date || !b.start_time) continue;
    const s = toMinutes(b.start_time);
    const e = toMinutes(b.end_time) ?? s + 30;
    const k = keyOf(b.play_date, b.venue_id);
    if (!taken.has(k)) taken.set(k, []);
    taken.get(k).push({ s, e, match_id: b.id });

    for (const tid of [b.team_a_id, b.team_b_id]) {
      if (!tid) continue;
      const tk = keyOf(b.play_date, tid);
      if (!teamBusy.has(tk)) teamBusy.set(tk, []);
      teamBusy.get(tk).push({ s, e });
    }
  }

  // 场次分组排序：小组赛按小组归拢，淘汰赛按轮次归拢
  const groups = new Map();
  for (const m of ready) {
    const gk = m.stage === 1
      ? `g-${m.heat_group_id || `single-${m.band_id}`}`
      : `s-${m.stage}-r${m.round_no || 0}`;
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push(m);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => {
      if (a.stage === 1 && b.stage === 1) {
        return (a.round_no || 0) - (b.round_no || 0) || (a.seq_no || 0) - (b.seq_no || 0);
      }
      return (a.seq_no || 0) - (b.seq_no || 0);
    });
  }

  const updates = [];
  let placed = 0;
  let unplaced = 0;

  for (const [, list] of groups) {
    for (const m of list) {
      const duration = await matchDuration(m.event_item_id);
      const teamIds = [m.team_a_id, m.team_b_id].filter(Boolean);

      // 在所有可用时间窗里找一个放得下的位置
      let best = null;

      for (const [k, wins] of winByKey) {
        const [date, venueId] = k.split('|');
        if (opts.play_date && date !== opts.play_date) continue;

        const busyList = taken.get(k) || [];
        const teamLists = teamIds
          .map((tid) => teamBusy.get(keyOf(date, tid)) || [])
          .flat();

        for (const w of wins) {
          const ws = w.start_min;
          const we = w.end_min;
          if (ws === null || we === null) continue;

          // 从窗口起点开始找第一个不冲突的起点
          let start = ws;
          // 窗口内允许的候选起点：窗口起点，以及所有已占用区间结束后的点
          const candidates = [ws];
          for (const b of busyList) candidates.push(b.e);
          for (const t of teamLists) candidates.push(t.e);
          candidates.sort((a, b) => a - b);

          for (const cand of candidates) {
            if (cand < ws) continue;
            const end = cand + duration;
            if (end > we) break;              // 放不下，试试下一个窗口

            // 场地冲突？
            if (busyList.some((b) => cand < b.e && end > b.s)) continue;
            // 队伍冲突 / 休息不足？
            if (teamLists.some((t) => cand < t.e && end > t.s)) continue;
            if (teamLists.some((t) => cand >= t.s && cand - t.e < rest)) continue;

            best = { date, venue_id: Number(venueId), start: cand, end, window: w };
            break;
          }
          if (best) break;
        }
        if (best) break;
      }

      if (!best) {
        unplaced++;
        continue;
      }

      // 落库
      const startStr = toTimeStr(best.start);
      const endStr = toTimeStr(best.end);
      updates.push({
        id: m.id,
        play_date: best.date,
        venue_id: best.venue_id,
        start_time: startStr,
        end_time: endStr,
        slot_id: best.window.id
      });

      // 登记占用
      const k = keyOf(best.date, best.venue_id);
      if (!taken.has(k)) taken.set(k, []);
      taken.get(k).push({ s: best.start, e: best.end, match_id: m.id });
      for (const tid of teamIds) {
        const tk = keyOf(best.date, tid);
        if (!teamBusy.has(tk)) teamBusy.set(tk, []);
        teamBusy.get(tk).push({ s: best.start, e: best.end });
      }

      placed++;
    }
  }

  // 事务写库
  if (updates.length) {
    await transaction(async (tx) => {
      for (const u of updates) {
        await tx.execute(
          `UPDATE match_info
              SET play_date = ?, venue_id = ?, start_time = ?, end_time = ?, slot_id = ?
            WHERE id = ?`,
          [u.play_date, u.venue_id, u.start_time, u.end_time, u.slot_id, u.id]
        );
      }
    });
  }

  return {
    placed,
    unplaced,
    waiting,
    note: unplaced
      ? `有 ${unplaced} 场没找到合适的空档，可能是时间窗不够、场地不够或队伍休息间隔太长`
      : ''
  };
}

/**
 * 冲突检测（球类）
 *
 * 三类，与田径一致：
 *   VENUE    同一场地时间重叠
 *   TEAM     同一队伍同时被安排了两场
 *   REST     同一队伍两场之间间隔不足 minimum_rest_minutes
 */
async function detectConflicts(competitionId) {
  const comp = await queryOne(
    'SELECT minimum_rest_minutes FROM competition WHERE id = ?', [competitionId]
  );
  const rest = Number(comp?.minimum_rest_minutes) || 90;

  const rows = await query(
    `SELECT m.id, m.seq_no, m.team_a_id, m.team_b_id, m.play_date, m.start_time, m.end_time,
            m.venue_id, ei.name AS event_name, gb.label AS band_label
       FROM match_info m
       JOIN event_item ei ON ei.id = m.event_item_id
       JOIN group_band gb ON gb.id = m.band_id
      WHERE m.competition_id = ? AND m.play_date IS NOT NULL AND m.start_time IS NOT NULL
      ORDER BY m.play_date, m.start_time, m.seq_no`,
    [competitionId]
  );

  const conflicts = [];
  const teamName = new Map();

  const nameOf = async (tid) => {
    if (!tid) return '';
    if (teamName.has(tid)) return teamName.get(tid);
    const t = await queryOne('SELECT team_name FROM team_entry WHERE id = ?', [tid]);
    const n = t?.team_name || '';
    teamName.set(tid, n);
    return n;
  };

  const items = rows.map((r) => ({
    id: r.id,
    seq_no: r.seq_no,
    date: r.play_date,
    s: toMinutes(r.start_time),
    e: toMinutes(r.end_time) ?? toMinutes(r.start_time) + 30,
    venue_id: r.venue_id,
    event_name: r.event_name,
    band_label: r.band_label,
    teams: [r.team_a_id, r.team_b_id].filter(Boolean)
  }));

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a.date !== b.date) continue;

      // VENUE
      if (a.venue_id && a.venue_id === b.venue_id && a.s < b.e && b.s < a.e) {
        conflicts.push({
          type: 'VENUE',
          a_id: a.id, b_id: b.id,
          detail: `第 ${a.seq_no} 场与第 ${b.seq_no} 场在同一场地时间重叠`
        });
        continue;
      }

      const shared = a.teams.filter((t) => b.teams.includes(t));
      if (!shared.length) continue;

      // TEAM 同时段
      if (a.s < b.e && b.s < a.e) {
        const nm = await nameOf(shared[0]);
        conflicts.push({
          type: 'TEAM',
          a_id: a.id, b_id: b.id,
          team_id: shared[0], team_name: nm,
          detail: `「${nm}」在 ${a.date} 同时被安排了两场（第 ${a.seq_no}、${b.seq_no} 场）`
        });
        continue;
      }

      // REST 休息不足
      const gap = a.s >= b.s ? a.s - b.e : b.s - a.e;
      if (gap >= 0 && gap < rest) {
        const nm = await nameOf(shared[0]);
        conflicts.push({
          type: 'REST',
          a_id: a.id, b_id: b.id,
          team_id: shared[0], team_name: nm,
          detail: `「${nm}」两场间隔仅 ${gap} 分钟，不足 ${rest} 分钟（第 ${a.seq_no}、${b.seq_no} 场）`
        });
      }
    }
  }

  return conflicts;
}

/**
 * 生成可用时间窗（取代原来的「生成时间槽」）
 *
 * 语义变了：现在生成的是「当天各场地的可用时间窗」，
 * 一场比赛可以在窗内取任意一段（按项目时长），不再是一格一场。
 *
 * @param {number} competitionId
 * @param {string[]} playDates
 * @param {object} cfg { amStart, pmStart, slotCount, slotInterval, venueIds? }
 */
async function generateWindows(competitionId, playDates, cfg = {}) {
  const venues = await query(
    'SELECT * FROM venue WHERE competition_id=? ORDER BY venue_no', [competitionId]
  );
  if (!venues.length) throw new Error('尚未配置场地');

  const slotInterval = Number(cfg.slotInterval) || 45;
  const amStart = cfg.amStart || '08:30';
  const pmStart = cfg.pmStart || '13:30';
  const slotCount = Number(cfg.slotCount) || 10;

  if (pmStart <= amStart) {
    throw new Error(`下午开始时间（${pmStart}）应晚于上午（${amStart}），否则两个时段会重叠`);
  }

  // 已有比赛排期时不能清空
  const used = await queryOne(
    'SELECT COUNT(*) AS c FROM match_info WHERE competition_id = ? AND play_date IS NOT NULL',
    [competitionId]
  );
  if (used && Number(used.c) > 0) {
    throw new Error('已有比赛排期，请先在「赛程编排」清空排期，再重新设置比赛日程');
  }

  await execute('DELETE FROM schedule_slot WHERE competition_id = ?', [competitionId]);

  const half = Math.ceil(slotCount / 2);
  const created = [];

  for (const date of playDates) {
    for (const venue of venues) {
      for (let i = 1; i <= slotCount; i++) {
        const isPm = i > half;
        const idxInHalf = isPm ? i - half - 1 : i - 1;
        const start = addMinutes(isPm ? pmStart : amStart, idxInHalf * slotInterval);
        const end = addMinutes(start, slotInterval - 10);
        const res = await execute(
          `INSERT INTO schedule_slot
             (competition_id, play_date, venue_id, slot_index, start_time, end_time, slot_type, kind)
           VALUES (?,?,?,?,?,?,1,'WINDOW')`,
          [competitionId, date, venue.id, i, start, end]
        );
        created.push({
          id: res.insertId,
          date, venue_id: venue.id, venue_no: venue.venue_no,
          slot_index: i, half: isPm ? 'PM' : 'AM',
          start_time: start, end_time: end
        });
      }
    }
  }

  return created;
}

/**
 * 清空排期（保留时间窗）
 */
async function clearSchedule(competitionId, opts = {}) {
  const where = ['competition_id = ?'];
  const params = [competitionId];
  if (opts.play_date) { where.push('play_date = ?'); params.push(opts.play_date); }
  if (opts.venue_id) { where.push('venue_id = ?'); params.push(opts.venue_id); }

  const res = await execute(
    `UPDATE match_info SET play_date = NULL, start_time = NULL, end_time = NULL,
            venue_id = NULL, slot_id = NULL
      WHERE ${where.join(' AND ')}`,
    params
  );
  return { cleared: res.affectedRows };
}

module.exports = {
  autoArrange,
  detectConflicts,
  generateWindows,
  clearSchedule,
  loadWindows,
  matchDuration,
  toMinutes,
  toTimeStr
};
