/**
 * 日程编排引擎（第五期 22）
 *
 * 把已编排好的赛次（track_heat）排进「日程单元 + 场地 + 时刻」。
 *
 * 自动排布策略：
 *   1. 先把赛次按 项目 sort_no → 轮次 → 组号 排序（径赛先预赛后决赛）
 *   2. 按单元顺序（日期 → 上午下午）依次填充，每个单元内按场地轮转
 *   3. 每条占用 estimated_minutes（缺省由项目 estimated_unit_minutes 或按人数估算）
 *   4. locked_flag=1 的条目保持原时间不动，自动排布跳过它占的时间
 *
 * 冲突检测三类：
 *   VENUE    同一场地同一时刻有两条（时间区间重叠）
 *   ATHLETE  同一运动员在重叠时段被安排了两场
 *   REST     同一运动员两场之间间隔 < competition.minimum_rest_minutes
 */
const { query, queryOne, execute } = require('../db');

/** 把 "HH:MM:SS" / "HH:MM" 转成分钟数 */
function toMinutes(t) {
  if (t === null || t === undefined || t === '') return null;
  const s = String(t);
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 分钟数转成 "HH:MM:SS" */
function toTimeStr(min) {
  if (min === null || min === undefined) return null;
  const h = Math.floor(min / 60) % 24;
  const mm = Math.floor(min % 60);
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
}

/** 估算某赛次用时（分钟） */
function estimateMinutes(heat, event) {
  if (event?.estimated_unit_minutes) return Number(event.estimated_unit_minutes);
  const n = Number(heat.entry_count) || 0;
  const type = String(event?.event_type || '');
  if (type === 'FIELD') {
    // 田赛：每人 3 次试跳，每次约 40 秒
    return Math.max(20, Math.round(n * 3 * 0.7) + 10);
  }
  if (type === 'RELAY') return Math.max(10, Math.round(n * 2) + 5);
  if (type === 'COMBINED') return Math.max(60, n * 12);
  // 径赛：每组约 人数×0.8 + 5 分钟
  return Math.max(8, Math.round(n * 0.8) + 5);
}

/**
 * 自动排布
 * @param {Object} opts { competition_id, unit_ids?, venue_ids?, clear? }
 */
async function autoArrange(competitionId, opts = {}) {
  const comp = await queryOne('SELECT * FROM competition WHERE id = ?', [competitionId]);
  if (!comp) throw new Error('赛事不存在');

  const units = await query(
    'SELECT * FROM schedule_unit WHERE competition_id = ? ORDER BY unit_date, sort_no, id',
    [competitionId]
  );
  if (!units.length) throw new Error('请先创建日程单元（比赛日 + 上午/下午）');

  const venues = await query(
    'SELECT * FROM venue WHERE competition_id = ? ORDER BY sort_no, id', [competitionId]
  );
  if (!venues.length) throw new Error('请先添加场地');

  // 待排赛次：已编排（status>=2）且未排进日程的
  const heats = await query(
    `SELECT h.*, e.name AS event_name, e.event_type, e.estimated_unit_minutes, e.sort_no AS event_sort,
            gb.label AS band_label
       FROM track_heat h
       JOIN event_item e ON e.id = h.event_item_id
       LEFT JOIN group_band gb ON gb.id = h.band_id
      WHERE h.competition_id = ?
        AND NOT EXISTS (SELECT 1 FROM timetable_item t WHERE t.heat_id = h.id)
      ORDER BY e.sort_no, h.round_no, h.heat_no`,
    [competitionId]
  );

  // 已存在的条目（含锁定的），用于占位
  const existing = await query(
    'SELECT * FROM timetable_item WHERE competition_id = ?', [competitionId]
  );

  if (opts.clear) {
    await execute('DELETE FROM timetable_conflict WHERE competition_id = ?', [competitionId]);
    await execute('DELETE FROM timetable_item WHERE competition_id = ? AND locked_flag = 0', [competitionId]);
    existing.length = 0;
    existing.push(...await query('SELECT * FROM timetable_item WHERE competition_id = ?', [competitionId]));
  }

  // 每个单元每个场地一个游标（分钟）
  const cursor = new Map();
  for (const u of units) {
    for (const v of venues) {
      const start = toMinutes(u.start_time);
      cursor.set(`${u.id}:${v.id}`, start === null ? 8 * 60 : start);
    }
  }
  // 已有条目推进游标
  for (const it of existing) {
    const key = `${it.unit_id}:${it.venue_id}`;
    if (!cursor.has(key)) continue;
    const end = toMinutes(it.end_time);
    const st = toMinutes(it.start_time);
    if (end !== null && end > (cursor.get(key) ?? 0)) cursor.set(key, end);
    else if (st !== null) cursor.set(key, st + (Number(it.estimated_minutes) || 10));
  }

  let unitIdx = 0, venueIdx = 0, placed = 0, skipped = 0;

  for (const heat of heats) {
    const ev = await queryOne('SELECT * FROM event_item WHERE id = ?', [heat.event_item_id]);
    const mins = estimateMinutes(heat, ev);

    // 找一个能放下的位置：从当前单元/场地开始扫
    let ok = false;
    for (let tryN = 0; tryN < units.length * venues.length; tryN++) {
      const u = units[unitIdx % units.length];
      const v = venues[venueIdx % venues.length];
      const key = `${u.id}:${v.id}`;
      const start = cursor.get(key) ?? 8 * 60;
      const end = start + mins;

      const uStart = toMinutes(u.start_time);
      const uEnd = toMinutes(u.end_time);
      const inRange = (uStart === null || start >= uStart) && (uEnd === null || end <= uEnd);

      if (inRange) {
        await execute(
          `INSERT INTO timetable_item
            (competition_id, unit_id, venue_id, heat_id, event_item_id, band_id, round_code, heat_no,
             title, start_time, end_time, estimated_minutes, participant_count, sort_no)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE
             unit_id=VALUES(unit_id), venue_id=VALUES(venue_id), start_time=VALUES(start_time),
             end_time=VALUES(end_time), estimated_minutes=VALUES(estimated_minutes)`,
          [competitionId, u.id, v.id, heat.id, heat.event_item_id, heat.band_id,
           heat.round_code, heat.heat_no,
           `${heat.band_label || ''}${heat.event_name} ${roundName(heat.round_code)}${heat.heat_no ? '第' + heat.heat_no + '组' : ''}`.trim(),
           toTimeStr(start), toTimeStr(end), mins, heat.entry_count || 0, placed]
        );
        cursor.set(key, end);
        placed++;
        ok = true;
        break;
      }

      // 放不下就换下一个场地 / 单元
      venueIdx++;
      if (venueIdx % venues.length === 0) unitIdx++;
    }
    if (!ok) { skipped++; continue; }
    venueIdx++;
    if (venueIdx % venues.length === 0) unitIdx++;
  }

  const conflicts = await detectConflicts(competitionId);
  return { placed, skipped, conflicts };
}

function roundName(code) {
  return { PRELIM: '预赛', SEMI: '复赛', FINAL: '决赛' }[code] || '';
}

/** 冲突检测，写入 timetable_conflict，返回冲突条数 */
async function detectConflicts(competitionId) {
  const comp = await queryOne('SELECT minimum_rest_minutes FROM competition WHERE id = ?', [competitionId]);
  const restMin = Number(comp?.minimum_rest_minutes) || 30;

  await execute('DELETE FROM timetable_conflict WHERE competition_id = ? AND resolved_flag = 0', [competitionId]);

  const items = await query(
    `SELECT t.*, u.unit_date, u.name AS unit_name
       FROM timetable_item t
       LEFT JOIN schedule_unit u ON u.id = t.unit_id
      WHERE t.competition_id = ? AND t.start_time IS NOT NULL AND t.end_time IS NOT NULL
      ORDER BY u.unit_date, t.start_time`,
    [competitionId]
  );

  // 统一到"绝对分钟"，便于跨单元比较
  const withAbs = items.map((it) => {
    const d = it.unit_date ? new Date(it.unit_date) : null;
    const dayMin = d ? d.getDate() * 1440 : 0; // 只在同一赛事内比较，够用
    return {
      ...it,
      _s: dayMin + toMinutes(it.start_time),
      _e: dayMin + toMinutes(it.end_time),
      _date: it.unit_date ? String(it.unit_date).slice(0, 10) : ''
    };
  });

  let count = 0;

  // 1) 场地重叠
  for (let i = 0; i < withAbs.length; i++) {
    for (let j = i + 1; j < withAbs.length; j++) {
      const a = withAbs[i], b = withAbs[j];
      if (a._date !== b._date) continue;
      if (!a.venue_id || a.venue_id !== b.venue_id) continue;
      if (a._s < b._e && b._s < a._e) {
        await insertConflict(competitionId, 'VENUE', a.id, b.id, null, null,
          `同一场地时间重叠：${a.title} 与 ${b.title}`);
        count++;
      }
    }
  }

  // 2) 兼项 / 休息不足
  // 取每条条目涉及的运动员
  const athleteMap = new Map(); // item_id -> [{athlete_id, athlete_name}]
  for (const it of withAbs) {
    const rows = await query(
      'SELECT athlete_id, athlete_name FROM heat_entry WHERE heat_id = ?', [it.heat_id]
    );
    athleteMap.set(it.id, rows);
  }

  const byAthlete = new Map();
  for (const it of withAbs) {
    for (const a of (athleteMap.get(it.id) || [])) {
      if (!a.athlete_id) continue;
      if (!byAthlete.has(a.athlete_id)) byAthlete.set(a.athlete_id, { name: a.athlete_name, items: [] });
      byAthlete.get(a.athlete_id).items.push(it);
    }
  }

  for (const [aid, info] of byAthlete) {
    const list = info.items.sort((x, y) => x._s - y._s);
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1];
      if (a._date !== b._date) continue;
      if (a._s < b._e && b._s < a._e) {
        await insertConflict(competitionId, 'ATHLETE', a.id, b.id, aid, info.name,
          `${info.name} 同时被安排：${a.title} 与 ${b.title}`);
        count++;
      } else if (b._s - a._e < restMin) {
        await insertConflict(competitionId, 'REST', a.id, b.id, aid, info.name,
          `${info.name} 两场间隔 ${b._s - a._e} 分钟，低于最小休息 ${restMin} 分钟`);
        count++;
      }
    }
  }

  // 回写条目的冲突标记
  await execute('UPDATE timetable_item SET conflict_flag = 0, conflict_note = NULL WHERE competition_id = ?', [competitionId]);
  const cs = await query(
    'SELECT item_id, GROUP_CONCAT(detail SEPARATOR "；") AS note FROM timetable_conflict WHERE competition_id = ? AND resolved_flag = 0 GROUP BY item_id',
    [competitionId]
  );
  for (const c of cs) {
    await execute('UPDATE timetable_item SET conflict_flag = 1, conflict_note = ? WHERE id = ?',
      [String(c.note || '').slice(0, 250), c.item_id]);
  }
  // 冲突也可能挂在 other_item_id 上
  const cs2 = await query(
    'SELECT other_item_id AS item_id, GROUP_CONCAT(detail SEPARATOR "；") AS note FROM timetable_conflict WHERE competition_id = ? AND resolved_flag = 0 AND other_item_id IS NOT NULL GROUP BY other_item_id',
    [competitionId]
  );
  for (const c of cs2) {
    await execute(
      'UPDATE timetable_item SET conflict_flag = 1, conflict_note = COALESCE(CONCAT(COALESCE(conflict_note,""), ?), ?) WHERE id = ? AND conflict_flag = 0',
      [String(c.note || '').slice(0, 200), String(c.note || '').slice(0, 200), c.item_id]
    );
  }

  return count;
}

async function insertConflict(competitionId, type, itemId, otherId, athleteId, athleteName, detail) {
  const exist = await queryOne(
    `SELECT id FROM timetable_conflict
      WHERE competition_id = ? AND conflict_type = ? AND item_id = ? AND other_item_id <=> ? AND resolved_flag = 0`,
    [competitionId, type, itemId, otherId ?? null]
  );
  if (exist) return;
  await execute(
    `INSERT INTO timetable_conflict
      (competition_id, conflict_type, item_id, other_item_id, athlete_id, athlete_name, detail)
     VALUES (?,?,?,?,?,?,?)`,
    [competitionId, type, itemId, otherId ?? null, athleteId ?? null, athleteName ?? null, detail]
  );
}

/**
 * 赛事整体改期：所有日程平移 N 天
 */
async function reschedule(competitionId, shiftDays, reason, operator) {
  const comp = await queryOne('SELECT * FROM competition WHERE id = ?', [competitionId]);
  if (!comp) throw new Error('赛事不存在');
  const n = Number(shiftDays);
  if (!Number.isInteger(n) || n === 0) throw new Error('平移天数必须是非零整数');

  const oldStart = comp.start_date, oldEnd = comp.end_date;

  // 1. 赛事日期
  await execute(
    `UPDATE competition
        SET start_date = DATE_ADD(start_date, INTERVAL ? DAY),
            end_date   = DATE_ADD(end_date,   INTERVAL ? DAY)
      WHERE id = ?`, [n, n, competitionId]
  );

  // 2. 日程单元
  const ru = await execute(
    'UPDATE schedule_unit SET unit_date = DATE_ADD(unit_date, INTERVAL ? DAY) WHERE competition_id = ?',
    [n, competitionId]
  );

  // 3. 球类时段
  const rs = await execute(
    'UPDATE schedule_slot SET play_date = DATE_ADD(play_date, INTERVAL ? DAY) WHERE competition_id = ?',
    [n, competitionId]
  );

  // 4. 田径赛次的计划日期（若已设置）
  const rh = await execute(
    'UPDATE track_heat SET plan_date = DATE_ADD(plan_date, INTERVAL ? DAY) WHERE competition_id = ? AND plan_date IS NOT NULL',
    [n, competitionId]
  );

  // 5. 流程节点
  await execute(
    'UPDATE meet_flow_node SET plan_date = DATE_ADD(plan_date, INTERVAL ? DAY) WHERE competition_id = ? AND plan_date IS NOT NULL',
    [n, competitionId]
  );

  // 6. 写日志
  const log = await execute(
    `INSERT INTO meet_reschedule_log
      (competition_id, old_start_date, old_end_date, new_start_date, new_end_date,
       shift_days, affected_units, affected_slots, affected_heats, reason, operation_by)
     VALUES (?,?,?,DATE_ADD(?, INTERVAL ? DAY), DATE_ADD(?, INTERVAL ? DAY),?,?,?,?,?,?)`,
    [competitionId, oldStart, oldEnd, oldStart, n, oldEnd, n, n,
     ru.affectedRows || 0, rs.affectedRows || 0, rh.affectedRows || 0,
     reason || null, operator || null]
  );

  return {
    shift_days: n,
    affected_units: ru.affectedRows || 0,
    affected_slots: rs.affectedRows || 0,
    affected_heats: rh.affectedRows || 0,
    log_id: log.insertId
  };
}

module.exports = { autoArrange, detectConflicts, reschedule, toMinutes, toTimeStr, estimateMinutes, roundName };
