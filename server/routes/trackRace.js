const express = require('express');
const crypto = require('crypto');
const { query, queryOne, execute, ok, fail } = require('../db');
const { authRequired, roleRequired } = require('../middleware/auth');
const { hashPassword } = require('../utils/helpers');
const announcement = require('../services/announcement');

const router = express.Router();
router.use(authRequired);

/**
 * referee_account 表的密码哈希
 *
 * 原来这里自己写了一套 sha256(plain + '::sport')，和主体系（现在是 bcrypt）不一致。
 * 现在统一走 helpers：
 *   - 新建/重置 → bcrypt
 *   - 校验 → 兼容旧 sha256，验证通过后自动升级为 bcrypt
 */
function hashPwd(plain) {
  return hashPassword(plain);
}

// ============================================================
// 一、号码簿
// ============================================================

/**
 * GET /api/track-race/bibs?competition_id=[&school_id][&band_id]
 */
router.get('/bibs', async (req, res, next) => {
  try {
    const { competition_id, school_id, band_id } = req.query;
    let where = ['b.competition_id = ?'];
    const p = [competition_id];
    if (school_id) { where.push('b.school_id = ?'); p.push(school_id); }
    if (band_id) { where.push('b.band_id = ?'); p.push(band_id); }
    const rows = await query(
      `SELECT b.*, s.name AS school_name
         FROM bib_number b
         LEFT JOIN school s ON s.id = b.school_id
        WHERE ${where.join(' AND ')}
        ORDER BY b.school_id, b.bib_no`, p
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/**
 * POST /api/track-race/bibs/generate
 * body: { competition_id, band_id?, mode, prefix, start_number, number_length, gender_order }
 * mode: SCHOOL_SEGMENT 按校分段 / GLOBAL 全局连续 / BY_BAND 按组别
 */
router.post('/bibs/generate', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    const cid = b.competition_id;
    if (!cid) return res.json(fail('缺少赛事 id'));

    // 取所有已报名的运动员
    let sql = `
      SELECT DISTINCT a.id AS athlete_id, a.name AS athlete_name, a.school_id, a.gender,
             s.name AS school_name
        FROM athlete_entry ae
        JOIN athlete a ON a.id = ae.athlete_id
        LEFT JOIN school s ON s.id = a.school_id
       WHERE ae.competition_id = ? AND ae.status = 2`;
    const p = [cid];
    if (b.band_id) { sql += ' AND ae.band_id = ?'; p.push(b.band_id); }
    sql += ' ORDER BY a.school_id, a.gender, a.id';

    const athletes = await query(sql, p);
    if (!athletes.length) return res.json(fail('没有已通过的报名人员'));

    const len = Number(b.number_length || 4);
    const start = Number(b.start_number || 1);
    const genderOrder = b.gender_order || 'M_F'; // M_F 男先 / F_M 女先
    const prefixMode = b.prefix || ''; // SCHOOL_CODE 用学校 id 做前缀 / 自定义字符串

    // 按校分组
    const bySchool = new Map();
    for (const a of athletes) {
      const k = a.school_id || 0;
      if (!bySchool.has(k)) bySchool.set(k, []);
      bySchool.get(k).push(a);
    }
    const schools = [...bySchool.keys()].sort((x, y) => x - y);

    await execute('DELETE FROM bib_number WHERE competition_id = ?' + (b.band_id ? ' AND band_id = ?' : ''),
      b.band_id ? [cid, b.band_id] : [cid]);

    let n = 0;
    for (const sid of schools) {
      const list = [...bySchool.get(sid)];
      if (genderOrder === 'F_M') list.sort((a, b2) => (b2.gender ?? 0) - (a.gender ?? 0) || a.id - b2.id);
      else list.sort((a, b2) => (a.gender ?? 0) - (b2.gender ?? 0) || a.id - b2.id);

      // 前缀
      let prefix = '';
      if (prefixMode === 'SCHOOL_CODE') {
        // 用学校在赛事内的序号做前缀
        prefix = String(schools.indexOf(sid) + 1).padStart(2, '0');
      } else if (prefixMode) {
        prefix = String(prefixMode);
      }

      // 起始号：按校分段时每校从 start 起另一段
      const mode = b.mode || 'SCHOOL_SEGMENT';
      let seq;
      if (mode === 'GLOBAL') {
        seq = start + n;
      } else {
        seq = start + (schools.indexOf(sid) * Math.pow(10, Math.max(1, len - 2)));
      }

      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        const num = seq + i;
        const bibNo = prefix + String(num).padStart(len - prefix.length, '0');
        await execute(
          `INSERT INTO bib_number
            (competition_id, band_id, school_id, team_name, athlete_id, athlete_name,
             gender, bib_no, prefix, seq_no, generated_flag)
           VALUES (?,?,?,?,?,?,?,?,?,?,1)
           ON DUPLICATE KEY UPDATE bib_no = VALUES(bib_no), prefix = VALUES(prefix), seq_no = VALUES(seq_no)`,
          [cid, b.band_id || null, a.school_id, a.school_name, a.athlete_id, a.athlete_name,
           a.gender, bibNo, prefix || null, i + 1]
        );
        // 回写运动员表
        await execute('UPDATE athlete SET bib_no = ? WHERE id = ?', [Number(bibNo) || null, a.athlete_id]);
        n++;
      }
    }

    res.json(ok({ count: n }, `已为 ${n} 人生成号码`));
  } catch (e) { next(e); }
});

/** PUT /api/track-race/bibs/:id 手工改号 */
router.put('/bibs/:id', roleRequired(1), async (req, res, next) => {
  try {
    const { bib_no } = req.body;
    await execute(
      'UPDATE bib_number SET bib_no = ?, generated_flag = 0 WHERE id = ?', [bib_no, req.params.id]
    );
    const row = await queryOne('SELECT * FROM bib_number WHERE id = ?', [req.params.id]);
    if (row) await execute('UPDATE athlete SET bib_no = ? WHERE id = ?', [Number(bib_no) || null, row.athlete_id]);
    res.json(ok(null, '号码已更新'));
  } catch (e) { next(e); }
});

/** DELETE /api/track-race/bibs/clear?competition_id= */
router.delete('/bibs/clear', roleRequired(1), async (req, res, next) => {
  try {
    await execute('DELETE FROM bib_number WHERE competition_id = ?', [req.query.competition_id]);
    res.json(ok(null, '号码簿已清空'));
  } catch (e) { next(e); }
});

/** GET /api/track-race/bibs/missing?competition_id= 缺号检查 */
router.get('/bibs/missing', async (req, res, next) => {
  try {
    const cid = req.query.competition_id;
    // 已报名但没号码的
    const noBib = await query(
      `SELECT a.id, a.name, s.name AS school_name
         FROM athlete_entry ae
         JOIN athlete a ON a.id = ae.athlete_id
         LEFT JOIN school s ON s.id = a.school_id
        WHERE ae.competition_id = ? AND ae.status = 2
          AND NOT EXISTS (SELECT 1 FROM bib_number b WHERE b.athlete_id = a.id AND b.competition_id = ae.competition_id)`,
      [cid]
    );
    // 重号
    const dup = await query(
      `SELECT bib_no, COUNT(*) AS c FROM bib_number WHERE competition_id = ? GROUP BY bib_no HAVING c > 1`,
      [cid]
    );
    res.json(ok({ noBib, dup }));
  } catch (e) { next(e); }
});

// ============================================================
// 二、临时变更
// ============================================================

const CHANGE_TYPES = ['TEMP_ENTRY', 'WITHDRAWAL', 'REPLACEMENT', 'EVENT_CHANGE', 'NAME_CHANGE'];

/** GET /api/track-race/changes?competition_id=[&change_type][&event_item_id] */
router.get('/changes', async (req, res, next) => {
  try {
    const { competition_id, change_type, event_item_id } = req.query;
    let where = ['c.competition_id = ?', 'c.revoked = 0'];
    const p = [competition_id];
    if (change_type) { where.push('c.change_type = ?'); p.push(change_type); }
    if (event_item_id) { where.push('c.event_item_id = ?'); p.push(event_item_id); }
    const rows = await query(
      `SELECT c.*, e.name AS event_name, gb.label AS band_label
         FROM participant_change c
         LEFT JOIN event_item e ON e.id = c.event_item_id
         LEFT JOIN group_band gb ON gb.id = c.band_id
        WHERE ${where.join(' AND ')}
        ORDER BY c.id DESC`, p
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/**
 * POST /api/track-race/changes
 * body 按 change_type 不同：
 *  TEMP_ENTRY   : { event_item_id, band_id, athlete_id? / new_athlete_name + new_school_id, target_heat_id? }
 *  WITHDRAWAL   : { event_item_id, band_id, old_heat_entry_id }
 *  REPLACEMENT  : { event_item_id, band_id, old_heat_entry_id, replace_athlete_id }
 *  EVENT_CHANGE : { event_item_id(原), band_id, old_athlete_id, to_event_item_id }
 *  NAME_CHANGE  : { old_athlete_id, after_name }
 */
router.post('/changes', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    const cid = b.competition_id;
    if (!cid) return res.json(fail('缺少赛事 id'));
    if (!CHANGE_TYPES.includes(b.change_type)) return res.json(fail('变更类型不正确'));

    const who = req.user.real_name || req.user.username;
    let result = null;

    if (b.change_type === 'TEMP_ENTRY') {
      result = await doTempEntry(cid, b, who);
    } else if (b.change_type === 'WITHDRAWAL') {
      result = await doWithdrawal(cid, b, who);
    } else if (b.change_type === 'REPLACEMENT') {
      result = await doReplacement(cid, b, who);
    } else if (b.change_type === 'EVENT_CHANGE') {
      result = await doEventChange(cid, b, who);
    } else if (b.change_type === 'NAME_CHANGE') {
      result = await doNameChange(cid, b, who);
    }

    res.json(ok(result, '变更已记录'));
  } catch (e) { next(e); }
});

async function doTempEntry(cid, b, who) {
  let athleteId = b.athlete_id;
  let name = b.new_athlete_name;
  let schoolId = b.new_school_id;

  if (!athleteId) {
    if (!name) throw new Error('请填写运动员姓名');
    // 现场新增运动员
    const r = await execute(
      'INSERT INTO athlete (school_id, name, gender, class_name) VALUES (?,?,?,?)',
      [schoolId || null, name, b.gender || 1, b.class_name || null]
    );
    athleteId = r.insertId;
  } else {
    const a = await queryOne('SELECT * FROM athlete WHERE id = ?', [athleteId]);
    if (!a) throw new Error('运动员不存在');
    name = a.name;
    schoolId = a.school_id;
  }
  const school = schoolId ? await queryOne('SELECT name FROM school WHERE id = ?', [schoolId]) : null;

  // 建报名关系
  await execute(
    `INSERT INTO athlete_entry (competition_id, band_id, athlete_id, event_item_id, status)
     VALUES (?,?,?,?,2) ON DUPLICATE KEY UPDATE status = 2`,
    [cid, b.band_id, athleteId, b.event_item_id]
  );

  // 加入指定组（或最后一个组）
  let heatId = b.target_heat_id;
  if (!heatId) {
    const h = await queryOne(
      `SELECT id FROM track_heat WHERE competition_id=? AND band_id=? AND event_item_id=?
        ORDER BY round_no DESC, heat_no DESC LIMIT 1`, [cid, b.band_id, b.event_item_id]
    );
    heatId = h?.id || null;
  }

  let entryId = null;
  if (heatId) {
    const dup = await queryOne(
      'SELECT id FROM heat_entry WHERE heat_id = ? AND athlete_id = ?', [heatId, athleteId]
    );
    if (dup) throw new Error('该运动员已在目标赛次中，不能重复报名');
    const heat = await queryOne('SELECT * FROM track_heat WHERE id = ?', [heatId]);
    // 找空道次
    const used = await query('SELECT lane_no FROM heat_entry WHERE heat_id = ?', [heatId]);
    const usedSet = new Set(used.map((u) => u.lane_no).filter((x) => x !== null));
    let lane = null;
    for (let i = 1; i <= (heat?.lane_count || 8); i++) if (!usedSet.has(i)) { lane = i; break; }
    const r = await execute(
      `INSERT INTO heat_entry
        (heat_id, competition_id, band_id, event_item_id, athlete_id, athlete_name,
         school_id, school_name, lane_no, sort_no)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [heatId, cid, b.band_id, b.event_item_id, athleteId, name, schoolId, school?.name || null,
       lane, (used.length || 0) + 1]
    );
    entryId = r.insertId;
    await execute('UPDATE track_heat SET entry_count = entry_count + 1 WHERE id = ?', [heatId]);
  }

  const r = await execute(
    `INSERT INTO participant_change
      (competition_id, band_id, event_item_id, change_type, new_athlete_id, new_athlete_name,
       new_school_id, new_school_name, reason, operation_source, target_heat_id, new_heat_entry_id, created_by)
     VALUES (?,?,?,'TEMP_ENTRY',?,?,?,?,?,?,?,?,?)`,
    [cid, b.band_id, b.event_item_id, athleteId, name, schoolId, school?.name || null,
     b.reason || null, b.operation_source || 'ADMIN', heatId, entryId, who]
  );
  return { change_id: r.insertId, athlete_id: athleteId, heat_entry_id: entryId };
}

async function doWithdrawal(cid, b, who) {
  const ent = await queryOne('SELECT * FROM heat_entry WHERE id = ?', [b.old_heat_entry_id]);
  if (!ent) throw new Error('原记录不存在');
  await execute(
    'UPDATE heat_entry SET status_code = ?, result_text = ?, result_value = NULL WHERE id = ?',
    ['WD', 'WD', ent.id]
  );
  const r = await execute(
    `INSERT INTO participant_change
      (competition_id, band_id, event_item_id, change_type, old_athlete_id, old_athlete_name,
       old_school_id, old_school_name, old_heat_id, old_heat_entry_id, reason, operation_source, created_by)
     VALUES (?,?,?,'WITHDRAWAL',?,?,?,?,?,?,?,?,?)`,
    [cid, ent.band_id, ent.event_item_id, ent.athlete_id, ent.athlete_name,
     ent.school_id, ent.school_name, ent.heat_id, ent.id,
     b.reason || null, b.operation_source || 'ADMIN', who]
  );
  return { change_id: r.insertId };
}

async function doReplacement(cid, b, who) {
  const ent = await queryOne('SELECT * FROM heat_entry WHERE id = ?', [b.old_heat_entry_id]);
  if (!ent) throw new Error('原记录不存在');
  const na = await queryOne('SELECT * FROM athlete WHERE id = ?', [b.replace_athlete_id]);
  if (!na) throw new Error('替补运动员不存在');
  if (na.id === ent.athlete_id) throw new Error('替补运动员与原运动员是同一人');
  const already = await queryOne(
    'SELECT id, lane_no FROM heat_entry WHERE heat_id = ? AND athlete_id = ? AND status_code IS NULL',
    [ent.heat_id, na.id]
  );
  if (already) throw new Error(`该运动员已在本组第 ${already.lane_no ?? '-'} 道，不能重复上道`);
  const inOther = await queryOne(
    `SELECT he.id FROM heat_entry he JOIN track_heat h ON h.id = he.heat_id
      WHERE he.competition_id = ? AND he.band_id = ? AND he.event_item_id = ?
        AND he.athlete_id = ? AND (he.status_code IS NULL OR he.status_code = '')`,
    [cid, ent.band_id, ent.event_item_id, na.id]
  );
  if (inOther) throw new Error('该运动员已在本项目其他赛次中，不能重复上道');
  const school = na.school_id ? await queryOne('SELECT name FROM school WHERE id = ?', [na.school_id]) : null;

  // 跨项顶替时补一条报名关系，保证名次/积分统计能覆盖到
  await execute(
    `INSERT INTO athlete_entry (competition_id, band_id, athlete_id, event_item_id, status)
     VALUES (?,?,?,?,2) ON DUPLICATE KEY UPDATE status = 2`,
    [cid, ent.band_id, na.id, ent.event_item_id]
  );

  // 原记录标记换下
  await execute(
    'UPDATE heat_entry SET status_code = ?, result_text = ?, result_value = NULL, rank_no = NULL WHERE id = ?',
    ['WD', 'WD（换人）', ent.id]
  );

  // 新记录占用同一道次
  const r = await execute(
    `INSERT INTO heat_entry
      (heat_id, competition_id, band_id, event_item_id, athlete_id, athlete_name,
       school_id, school_name, bib_no, lane_no, sort_no)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [ent.heat_id, cid, ent.band_id, ent.event_item_id, na.id, na.name,
     na.school_id, school?.name || null, na.bib_no, ent.lane_no, ent.sort_no]
  );

  const cr = await execute(
    `INSERT INTO participant_change
      (competition_id, band_id, event_item_id, change_type, old_athlete_id, old_athlete_name,
       old_school_id, old_school_name, old_heat_id, old_heat_entry_id,
       replace_athlete_id, replace_athlete_name, replace_school_id, replace_school_name,
       reason, operation_source, target_heat_id, new_heat_entry_id, created_by)
     VALUES (?,?,?,'REPLACEMENT',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [cid, ent.band_id, ent.event_item_id, ent.athlete_id, ent.athlete_name,
     ent.school_id, ent.school_name, ent.heat_id, ent.id,
     na.id, na.name, na.school_id, school?.name || null,
     b.reason || null, b.operation_source || 'ADMIN', ent.heat_id, r.insertId, who]
  );
  return { change_id: cr.insertId, heat_entry_id: r.insertId };
}

async function doEventChange(cid, b, who) {
  const a = await queryOne('SELECT * FROM athlete WHERE id = ?', [b.old_athlete_id]);
  if (!a) throw new Error('运动员不存在');
  const toEv = await queryOne('SELECT * FROM event_item WHERE id = ?', [b.to_event_item_id]);
  const fromEv = await queryOne('SELECT * FROM event_item WHERE id = ?', [b.event_item_id]);
  if (!toEv) throw new Error('目标项目不存在');

  // 原项目撤下
  await execute(
    'UPDATE heat_entry SET status_code = ?, result_text = ? WHERE competition_id = ? AND band_id = ? AND event_item_id = ? AND athlete_id = ?',
    ['WD', 'WD（改项）', cid, b.band_id, b.event_item_id, b.old_athlete_id]
  );

  // 新项目加报名
  await execute(
    `INSERT INTO athlete_entry (competition_id, band_id, athlete_id, event_item_id, status)
     VALUES (?,?,?,?,2) ON DUPLICATE KEY UPDATE status = 2`,
    [cid, b.band_id, b.old_athlete_id, b.to_event_item_id]
  );

  // 进组
  let heatId = b.to_heat_id || null;
  if (!heatId) {
    const h = await queryOne(
      `SELECT id FROM track_heat WHERE competition_id=? AND band_id=? AND event_item_id=?
        ORDER BY round_no DESC, heat_no DESC LIMIT 1`, [cid, b.band_id, b.to_event_item_id]
    );
    heatId = h?.id || null;
  }
  let entryId = null;
  if (heatId) {
    const exists = await queryOne(
      'SELECT id FROM heat_entry WHERE heat_id = ? AND athlete_id = ?', [heatId, b.old_athlete_id]
    );
    if (exists) throw new Error('该运动员已在目标赛次中，无需改项');
    const used = await query('SELECT lane_no FROM heat_entry WHERE heat_id = ?', [heatId]);
    const usedSet = new Set(used.map((u) => u.lane_no).filter((x) => x !== null));
    const heat = await queryOne('SELECT * FROM track_heat WHERE id = ?', [heatId]);
    let lane = null;
    for (let i = 1; i <= (heat?.lane_count || 8); i++) if (!usedSet.has(i)) { lane = i; break; }
    if (lane === null) lane = null; // 道次排满时留空，按出场顺序排
    const school = a.school_id ? await queryOne('SELECT name FROM school WHERE id = ?', [a.school_id]) : null;
    const r = await execute(
      `INSERT INTO heat_entry
        (heat_id, competition_id, band_id, event_item_id, athlete_id, athlete_name,
         school_id, school_name, bib_no, lane_no, sort_no)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [heatId, cid, b.band_id, b.to_event_item_id, b.old_athlete_id, a.name,
       a.school_id, school?.name || null, a.bib_no, lane, (used.length || 0) + 1]
    );
    entryId = r.insertId;
    await execute('UPDATE track_heat SET entry_count = entry_count + 1 WHERE id = ?', [heatId]);
  }

  const cr = await execute(
    `INSERT INTO participant_change
      (competition_id, band_id, event_item_id, change_type, old_athlete_id, old_athlete_name,
       old_school_id, from_event_item_id, from_event_name, to_event_item_id, to_event_name,
       reason, operation_source, target_heat_id, new_heat_entry_id, created_by)
     VALUES (?,?,?,'EVENT_CHANGE',?,?,?,?,?,?,?,?,?,?,?,?)`,
    [cid, b.band_id, b.event_item_id, b.old_athlete_id, a.name, a.school_id,
     fromEv?.id || null, fromEv?.name || null, toEv.id, toEv.name,
     b.reason || null, b.operation_source || 'ADMIN', heatId, entryId, who]
  );
  return { change_id: cr.insertId, heat_entry_id: entryId };
}

async function doNameChange(cid, b, who) {
  const a = await queryOne('SELECT * FROM athlete WHERE id = ?', [b.old_athlete_id]);
  if (!a) throw new Error('运动员不存在');
  if (!b.after_name) throw new Error('请填写新姓名');
  await execute('UPDATE athlete SET name = ? WHERE id = ?', [b.after_name, b.old_athlete_id]);
  await execute(
    'UPDATE heat_entry SET athlete_name = ? WHERE athlete_id = ? AND competition_id = ?',
    [b.after_name, b.old_athlete_id, cid]
  );
  const cr = await execute(
    `INSERT INTO participant_change
      (competition_id, band_id, event_item_id, change_type, old_athlete_id,
       before_name, after_name, reason, operation_source, created_by)
     VALUES (?,?,?,'NAME_CHANGE',?,?,?,?,?,?)`,
    [cid, b.band_id || null, b.event_item_id || null, b.old_athlete_id,
     a.name, b.after_name, b.reason || null, b.operation_source || 'ADMIN', who]
  );
  return { change_id: cr.insertId };
}

/** POST /api/track-race/changes/:id/revoke 撤销变更 */
router.post('/changes/:id/revoke', roleRequired(1), async (req, res, next) => {
  try {
    const c = await queryOne('SELECT * FROM participant_change WHERE id = ?', [req.params.id]);
    if (!c) return res.json(fail('记录不存在'));
    if (Number(c.revoked) === 1) return res.json(fail('该变更已撤销'));

    const who = req.user.real_name || req.user.username;

    if (c.change_type === 'TEMP_ENTRY') {
      if (c.new_heat_entry_id) {
        await execute('DELETE FROM heat_entry WHERE id = ?', [c.new_heat_entry_id]);
        await execute('UPDATE track_heat SET entry_count = GREATEST(entry_count - 1, 0) WHERE id = ?', [c.target_heat_id]);
      }
      await execute(
        'DELETE FROM athlete_entry WHERE competition_id = ? AND band_id = ? AND athlete_id = ? AND event_item_id = ?',
        [c.competition_id, c.band_id, c.new_athlete_id, c.event_item_id]
      );
    } else if (c.change_type === 'WITHDRAWAL') {
      await execute(
        'UPDATE heat_entry SET status_code = NULL, result_text = NULL WHERE id = ?', [c.old_heat_entry_id]
      );
    } else if (c.change_type === 'REPLACEMENT') {
      if (c.new_heat_entry_id) await execute('DELETE FROM heat_entry WHERE id = ?', [c.new_heat_entry_id]);
      await execute(
        'UPDATE heat_entry SET status_code = NULL, result_text = NULL WHERE id = ?', [c.old_heat_entry_id]
      );
    } else if (c.change_type === 'EVENT_CHANGE') {
      if (c.new_heat_entry_id) {
        await execute('DELETE FROM heat_entry WHERE id = ?', [c.new_heat_entry_id]);
        await execute('UPDATE track_heat SET entry_count = GREATEST(entry_count - 1, 0) WHERE id = ?', [c.target_heat_id]);
      }
      await execute(
        'DELETE FROM athlete_entry WHERE competition_id = ? AND band_id = ? AND athlete_id = ? AND event_item_id = ?',
        [c.competition_id, c.band_id, c.old_athlete_id, c.to_event_item_id]
      );
      await execute(
        'UPDATE heat_entry SET status_code = NULL, result_text = NULL WHERE competition_id = ? AND band_id = ? AND event_item_id = ? AND athlete_id = ?',
        [c.competition_id, c.band_id, c.event_item_id, c.old_athlete_id]
      );
    } else if (c.change_type === 'NAME_CHANGE') {
      await execute('UPDATE athlete SET name = ? WHERE id = ?', [c.before_name, c.old_athlete_id]);
      await execute(
        'UPDATE heat_entry SET athlete_name = ? WHERE athlete_id = ? AND competition_id = ?',
        [c.before_name, c.old_athlete_id, c.competition_id]
      );
    }

    await execute(
      'UPDATE participant_change SET revoked = 1, revoked_at = NOW(), revoked_by = ? WHERE id = ?',
      [who, req.params.id]
    );
    res.json(ok(null, '变更已撤销'));
  } catch (e) { next(e); }
});

/** GET /api/track-race/changes/candidates?competition_id=&band_id=&event_item_id=&kind= */
router.get('/changes/candidates', async (req, res, next) => {
  try {
    const { competition_id, band_id, event_item_id, kind } = req.query;
    if (kind === 'replace') {
      // 换人候选：本组别已通过报名、且未进入本项目任何赛次的运动员
      // enrolled_flag=1 表示已报本项目（同项替补，优先）；0 表示未报本项目（跨项顶替）
      const rows = await query(
        `SELECT a.id AS athlete_id, a.name AS athlete_name, a.school_id, s.name AS school_name, a.bib_no,
                (SELECT COUNT(*) FROM athlete_entry ae2
                  WHERE ae2.competition_id = ? AND ae2.band_id = ? AND ae2.event_item_id = ?
                    AND ae2.athlete_id = a.id AND ae2.status = 2) AS enrolled_flag
           FROM athlete a
           LEFT JOIN school s ON s.id = a.school_id
          WHERE EXISTS (SELECT 1 FROM athlete_entry ae
                         WHERE ae.competition_id = ? AND ae.band_id = ? AND ae.athlete_id = a.id AND ae.status = 2)
            AND NOT EXISTS (SELECT 1 FROM heat_entry he
                             WHERE he.competition_id = ? AND he.band_id = ? AND he.event_item_id = ?
                               AND he.athlete_id = a.id
                               AND (he.status_code IS NULL OR he.status_code = ''))
          ORDER BY enrolled_flag DESC, a.school_id, a.name`,
        [competition_id, band_id, event_item_id,
         competition_id, band_id,
         competition_id, band_id, event_item_id]
      );
      return res.json(ok(rows));
    }
    // 默认：本项目的在册人员（可撤赛/换人）
    const rows = await query(
      `SELECT he.id AS heat_entry_id, he.athlete_id, he.athlete_name, he.school_id, he.school_name,
              he.lane_no, he.heat_id, h.heat_name
         FROM heat_entry he
         JOIN track_heat h ON h.id = he.heat_id
        WHERE he.competition_id = ? AND he.band_id = ? AND he.event_item_id = ?
          AND (he.status_code IS NULL OR he.status_code = '')
        ORDER BY h.round_no, h.heat_no, he.lane_no`,
      [competition_id, band_id, event_item_id]
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

// ============================================================
// 三、检录表 / 成绩单 打印配置
// ============================================================

/** GET /api/track-race/form-config?competition_id=&form_type= */
router.get('/form-config', async (req, res, next) => {
  try {
    const { competition_id } = req.query;
    const ft = req.query.form_type || 'CALL_ROOM';
    let r = await queryOne(
      'SELECT * FROM print_form_config WHERE competition_id = ? AND form_type = ?',
      [competition_id ?? null, ft]
    );
    if (!r) {
      r = {
        competition_id: Number(competition_id) || null, form_type: ft,
        show_school: 1, show_bib: 1, show_lane: 1, show_gender: 0,
        show_sign_col: 1, show_referee: 1, rows_per_page: 30
      };
    }
    res.json(ok(r));
  } catch (e) { next(e); }
});

/** PUT /api/track-race/form-config */
router.put('/form-config', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    const ft = b.form_type || 'CALL_ROOM';
    const exist = await queryOne(
      'SELECT * FROM print_form_config WHERE competition_id = ? AND form_type = ?',
      [b.competition_id ?? null, ft]
    );
    const v = [
      b.competition_id ?? null, ft,
      b.show_school ?? 1, b.show_bib ?? 1, b.show_lane ?? 1, b.show_gender ?? 0,
      b.show_sign_col ?? 1, b.show_referee ?? 1, b.rows_per_page ?? 30,
      b.title_text ?? null, b.footer_text ?? null
    ];
    if (exist) {
      await execute(
        `UPDATE print_form_config SET competition_id=?, form_type=?, show_school=?, show_bib=?,
          show_lane=?, show_gender=?, show_sign_col=?, show_referee=?, rows_per_page=?,
          title_text=?, footer_text=? WHERE id=?`,
        [...v, exist.id]
      );
    } else {
      await execute(
        `INSERT INTO print_form_config
          (competition_id, form_type, show_school, show_bib, show_lane, show_gender,
           show_sign_col, show_referee, rows_per_page, title_text, footer_text)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`, v
      );
    }
    res.json(ok(null, '打印配置已保存'));
  } catch (e) { next(e); }
});

/**
 * GET /api/track-race/form-data?heat_id=&form_type=
 * 返回可直接打印的数据（检录表 / 成绩单）
 */
router.get('/form-data', async (req, res, next) => {
  try {
    const { heat_id, form_type = 'CHECK_IN' } = req.query;
    const heat = await queryOne(
      `SELECT h.*, e.name AS event_name, e.event_type, e.result_entry_type, e.event_unit,
              e.is_higher_better, e.result_decimal_places,
              gb.label AS band_label, gb.stage, gb.gender,
              c.name AS meet_name, c.host_unit, c.venue
         FROM track_heat h
         JOIN event_item e ON e.id = h.event_item_id
         JOIN group_band gb ON gb.id = h.band_id
         JOIN competition c ON c.id = h.competition_id
        WHERE h.id = ?`, [heat_id]
    );
    if (!heat) return res.json(fail('赛次不存在'));

    const cfg = await queryOne(
      'SELECT * FROM print_form_config WHERE competition_id = ? AND form_type = ?',
      [heat.competition_id, form_type]
    );

    const entries = await query(
      'SELECT * FROM heat_entry WHERE heat_id = ? ORDER BY COALESCE(lane_no, sort_no, 0), id',
      [heat_id]
    );

    res.json(ok({ heat, entries, config: cfg || null }));
  } catch (e) { next(e); }
});

// ============================================================
// 四、成绩公布
// ============================================================

/** GET /api/track-race/announcement?competition_id=[&event_item_id] */
router.get('/announcement', async (req, res, next) => {
  try {
    const { competition_id, event_item_id } = req.query;
    let where = ['a.competition_id = ?'];
    const p = [competition_id];
    if (event_item_id) { where.push('a.event_item_id = ?'); p.push(event_item_id); }
    const rows = await query(
      `SELECT a.*, e.name AS event_name
         FROM score_announcement a
         LEFT JOIN event_item e ON e.id = a.event_item_id
        WHERE ${where.join(' AND ')} ORDER BY a.publish_flag DESC, a.id DESC`, p
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/** PUT /api/track-race/announcement/config 公布开关 */
router.put('/announcement/config', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    await execute(
      'UPDATE competition SET announce_flag=?, announce_auto_flag=?, announce_show_school=? WHERE id=?',
      [b.announce_flag ?? 0, b.announce_auto_flag ?? 0, b.announce_show_school ?? 1, b.competition_id]
    );
    res.json(ok(null, '已保存'));
  } catch (e) { next(e); }
});

/** POST /api/track-race/announcement/publish 公布一组成绩 */
router.post('/announcement/publish', roleRequired(1), async (req, res, next) => {
  try {
    // 支持单个 heat_id 或批量 heat_ids / heats
    const ids = announcement.normalizeHeatIds(req.body);
    if (!ids.length) return res.json(fail('请选择要公布的赛次'));
    const who = req.user.real_name || req.user.username;

    // 公布逻辑已抽到 services/announcement.js（确认成绩后自动公布也复用它）
    const r = await announcement.publishHeats(ids, who, req.body.competition_id || null);
    res.json(ok({ count: r.count }, `已公布 ${r.count} 个赛次`));
  } catch (e) { next(e); }
});

/** POST /api/track-race/announcement/withdraw */
router.post('/announcement/withdraw', roleRequired(1), async (req, res, next) => {
  try {
    const ids = announcement.normalizeHeatIds(req.body);
    if (!ids.length) return res.json(fail('请选择要撤回的赛次'));
    const r = await announcement.withdrawHeats(ids);
    res.json(ok({ count: r.count }, `已撤回 ${r.count} 个赛次`));
  } catch (e) { next(e); }
});

// ============================================================
// 五、裁判员账号
// ============================================================

/** GET /api/track-race/referee-accounts?competition_id= */
router.get('/referee-accounts', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT r.*, e.name AS event_name, gb.label AS band_label
         FROM referee_account r
         LEFT JOIN event_item e ON e.id = r.event_item_id
         LEFT JOIN group_band gb ON gb.id = r.band_id
        WHERE r.competition_id = ? ORDER BY r.sort_no, r.id`,
      [req.query.competition_id]
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/** POST /api/track-race/referee-accounts */
router.post('/referee-accounts', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.username) return res.json(fail('请填写登录账号'));
    const dup = await queryOne('SELECT id FROM referee_account WHERE username = ?', [b.username]);
    if (dup) return res.json(fail('该账号已存在'));
    const r = await execute(
      `INSERT INTO referee_account
        (competition_id, referee_id, username, password_hash, real_name, event_item_id,
         band_id, duty, phone, login_flag, sort_no)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [b.competition_id, b.referee_id || null, b.username,
       hashPwd(b.password || '123456'), b.real_name || null,
       b.event_item_id || null, b.band_id || null, b.duty || null, b.phone || null,
       b.login_flag ?? 1, b.sort_no ?? 0]
    );
    res.json(ok({ id: r.insertId }, '裁判账号已创建'));
  } catch (e) { next(e); }
});

/** PUT /api/track-race/referee-accounts/:id */
router.put('/referee-accounts/:id', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    await execute(
      `UPDATE referee_account SET real_name=?, event_item_id=?, band_id=?, duty=?, phone=?,
        login_flag=?, sort_no=?, status=? WHERE id=?`,
      [b.real_name ?? null, b.event_item_id ?? null, b.band_id ?? null, b.duty ?? null,
       b.phone ?? null, b.login_flag ?? 1, b.sort_no ?? 0, b.status ?? 1, req.params.id]
    );
    res.json(ok(null, '已保存'));
  } catch (e) { next(e); }
});

/** PUT /api/track-race/referee-accounts/:id/reset-password */
router.put('/referee-accounts/:id/reset-password', roleRequired(1), async (req, res, next) => {
  try {
    await execute(
      'UPDATE referee_account SET password_hash = ? WHERE id = ?',
      [hashPwd(req.body.password || '123456'), req.params.id]
    );
    res.json(ok(null, '密码已重置'));
  } catch (e) { next(e); }
});

/** DELETE /api/track-race/referee-accounts/:id */
router.delete('/referee-accounts/:id', roleRequired(1), async (req, res, next) => {
  try {
    await execute('DELETE FROM referee_account WHERE id = ?', [req.params.id]);
    res.json(ok(null, '已删除'));
  } catch (e) { next(e); }
});

module.exports = router;
