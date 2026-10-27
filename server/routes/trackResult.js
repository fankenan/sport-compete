const express = require('express');
const { query, queryOne, execute, ok, fail, transaction } = require('../db');
const { authRequired, roleRequired } = require('../middleware/auth');
const scoreEngine = require('../services/scoreEngine');
const arrange = require('../services/trackArrange');

const router = express.Router();
router.use(authRequired);

const ROUND_NAME = { PRELIM: '预赛', SEMI: '复赛', FINAL: '决赛' };
const ROUND_NO = { PRELIM: 1, SEMI: 2, FINAL: 3 };

// ============================================================
// 一、编排规则
// ============================================================

/** GET /api/track-result/arrange-rule?event_item_id=&band_id= */
router.get('/arrange-rule', async (req, res, next) => {
  try {
    const { event_item_id, band_id } = req.query;
    let r = await queryOne(
      'SELECT * FROM arrangement_rule WHERE event_item_id = ? AND band_id <=> ? AND status = 1',
      [event_item_id, band_id ?? null]
    );
    if (!r) {
      r = await queryOne(
        'SELECT * FROM arrangement_rule WHERE event_item_id = ? AND band_id IS NULL AND status = 1',
        [event_item_id]
      );
    }
    res.json(ok(r));
  } catch (e) { next(e); }
});

/** PUT /api/track-result/arrange-rule */
router.put('/arrange-rule', roleRequired(1, 3), async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.event_item_id) return res.json(fail('缺少项目 id'));
    const bandId = b.band_id ?? null;
    const exist = await queryOne(
      'SELECT * FROM arrangement_rule WHERE event_item_id = ? AND band_id <=> ?',
      [b.event_item_id, bandId]
    );
    const payload = [
      b.competition_id, b.event_item_id, bandId, b.round_code || 'FINAL',
      b.round_mode || 'AUTO', b.lane_count ?? 8, b.heat_capacity ?? null,
      b.fixed_heat_count ?? null, b.lane_order_mode || 'SNAKE',
      b.seed_mode || 'NONE', b.estimated_unit_minutes ?? null
    ];
    if (exist) {
      await execute(
        `UPDATE arrangement_rule SET competition_id=?, event_item_id=?, band_id=?, round_code=?,
          round_mode=?, lane_count=?, heat_capacity=?, fixed_heat_count=?, lane_order_mode=?,
          seed_mode=?, estimated_unit_minutes=?, status=1 WHERE id=?`,
        [...payload, exist.id]
      );
    } else {
      await execute(
        `INSERT INTO arrangement_rule
          (competition_id, event_item_id, band_id, round_code, round_mode, lane_count,
           heat_capacity, fixed_heat_count, lane_order_mode, seed_mode, estimated_unit_minutes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        payload
      );
    }
    res.json(ok(null, '编排规则已保存'));
  } catch (e) { next(e); }
});

// ============================================================
// 二、分组编排
// ============================================================

/**
 * POST /api/track-result/arrange
 * body: { competition_id, event_item_id, band_id, round_code }
 * 从 athlete_entry 取报名名单，按规则切组、排道次，写入 track_heat + heat_entry
 */
router.post('/arrange', roleRequired(1, 3), async (req, res, next) => {
  try {
    const { competition_id, event_item_id, band_id, round_code = 'FINAL' } = req.body;
    if (!competition_id || !event_item_id || !band_id) return res.json(fail('参数不完整'));

    const ev = await queryOne('SELECT * FROM event_item WHERE id = ?', [event_item_id]);
    if (!ev) return res.json(fail('项目不存在'));

    let rule = await queryOne(
      'SELECT * FROM arrangement_rule WHERE event_item_id = ? AND band_id <=> ? AND status = 1',
      [event_item_id, band_id]
    );
    if (!rule) {
      rule = await queryOne(
        'SELECT * FROM arrangement_rule WHERE event_item_id = ? AND band_id IS NULL AND status = 1',
        [event_item_id]
      );
    }
    const ruleObj = rule || { lane_count: ev.lane_count || 8, lane_order_mode: 'SNAKE', round_mode: 'AUTO', seed_mode: 'NONE' };

    // 报名名单
    const athletes = await query(
      `SELECT ae.athlete_id, a.name AS athlete_name, a.school_id, a.bib_no,
              s.name AS school_name
         FROM athlete_entry ae
         JOIN athlete a ON a.id = ae.athlete_id
         LEFT JOIN school s ON s.id = a.school_id
        WHERE ae.competition_id = ? AND ae.band_id = ? AND ae.event_item_id = ? AND ae.status = 2
        ORDER BY a.school_id, a.bib_no, a.id`,
      [competition_id, band_id, event_item_id]
    );
    if (!athletes.length) return res.json(fail('该项目该组别没有已通过的报名人员'));

    const heats = arrange.splitHeats(athletes, ruleObj);
    const laneCount = Number(ruleObj.lane_count) || Number(ev.lane_count) || 8;

    let heatCount = 0, entryCount = 0;
    await transaction(async (conn) => {
      // 清掉本轮旧编排
      const oldIds = await query(
        'SELECT id FROM track_heat WHERE competition_id=? AND band_id=? AND event_item_id=? AND round_code=?',
        [competition_id, band_id, event_item_id, round_code]
      );
      for (const h of oldIds) {
        await conn.execute('DELETE FROM heat_entry WHERE heat_id = ?', [h.id]);
        await conn.execute('DELETE FROM track_heat WHERE id = ?', [h.id]);
      }

      for (let i = 0; i < heats.length; i++) {
        const members = arrange.assignLanes(heats[i], ruleObj, laneCount);
        const hr = await conn.execute(
          `INSERT INTO track_heat
            (competition_id, band_id, event_item_id, round_code, round_no, heat_no, heat_name,
             lane_count, entry_count, status)
           VALUES (?,?,?,?,?,?,?,?,?,2)`,
          [competition_id, band_id, event_item_id, round_code,
           ROUND_NO[round_code] || 1, i + 1,
           `${ROUND_NAME[round_code] || ''}第${i + 1}组`, laneCount, members.length]
        );
        const heatId = hr[0].insertId;
        heatCount++;

        members.forEach((m, idx) => {
          conn.execute(
            `INSERT INTO heat_entry
              (heat_id, competition_id, band_id, event_item_id, athlete_id, athlete_name,
               school_id, school_name, bib_no, lane_no, sort_no)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [heatId, competition_id, band_id, event_item_id, m.athlete_id, m.athlete_name,
             m.school_id, m.school_name, m.bib_no,
             ev.event_type === 'FIELD' ? null : (m.lane_no ?? idx + 1), idx + 1]
          );
          entryCount++;
        });
      }
    });

    res.json(ok({ heats: heatCount, entries: entryCount }, `已编排 ${heatCount} 组 / ${entryCount} 人`));
  } catch (e) { next(e); }
});

/**
 * PUT /api/track-result/arrange/adjust
 * body: { heat_id, entries: [{ id, lane_no, sort_no }] }
 * 手工调整道次 / 出场顺序
 */
router.put('/arrange/adjust', roleRequired(1, 3), async (req, res, next) => {
  try {
    const { heat_id, entries } = req.body;
    if (!heat_id || !Array.isArray(entries)) return res.json(fail('参数不完整'));
    for (const e of entries) {
      if (!e.id) continue;
      await execute(
        'UPDATE heat_entry SET lane_no = ?, sort_no = ? WHERE id = ? AND heat_id = ?',
        [e.lane_no ?? null, e.sort_no ?? null, e.id, heat_id]
      );
    }
    res.json(ok(null, '已调整'));
  } catch (e) { next(e); }
});

/**
 * PUT /api/track-result/arrange/move
 * body: { entry_id, target_heat_id }
 * 把某人挪到另一组
 */
router.put('/arrange/move', roleRequired(1, 3), async (req, res, next) => {
  try {
    const { entry_id, target_heat_id } = req.body;
    const ent = await queryOne('SELECT * FROM heat_entry WHERE id = ?', [entry_id]);
    if (!ent) return res.json(fail('记录不存在'));
    const target = await queryOne('SELECT * FROM track_heat WHERE id = ?', [target_heat_id]);
    if (!target) return res.json(fail('目标组不存在'));

    // 目标组内找一个空道次
    const used = await query(
      'SELECT lane_no FROM heat_entry WHERE heat_id = ? AND id <> ?', [target_heat_id, entry_id]
    );
    const usedSet = new Set(used.map((u) => u.lane_no).filter((x) => x !== null));
    let lane = null;
    for (let i = 1; i <= target.lane_count; i++) {
      if (!usedSet.has(i)) { lane = i; break; }
    }
    await execute(
      `UPDATE heat_entry SET heat_id = ?, lane_no = ?, sort_no = (SELECT COALESCE(MAX(sort_no),0)+1 FROM (SELECT sort_no FROM heat_entry WHERE heat_id=?) t)
       WHERE id = ?`,
      [target_heat_id, lane, target_heat_id, entry_id]
    );
    // 更新两组人数
    for (const hid of [ent.heat_id, target_heat_id]) {
      const c = await queryOne('SELECT COUNT(*) AS c FROM heat_entry WHERE heat_id = ?', [hid]);
      await execute('UPDATE track_heat SET entry_count = ? WHERE id = ?', [c.c, hid]);
    }
    res.json(ok(null, '已调整分组'));
  } catch (e) { next(e); }
});

// ============================================================
// 三、赛次查询（录入工作台）
// ============================================================

/**
 * GET /api/track-result/workbench?competition_id=[&band_id][&event_item_id][&round_code]
 * 返回赛次分组 + 组内人员（含成绩）
 */
router.get('/workbench', async (req, res, next) => {
  try {
    const { competition_id, band_id, event_item_id, round_code } = req.query;
    if (!competition_id) return res.json(fail('缺少赛事 id'));

    let where = ['h.competition_id = ?'];
    const p = [competition_id];
    if (band_id) { where.push('h.band_id = ?'); p.push(band_id); }
    if (event_item_id) { where.push('h.event_item_id = ?'); p.push(event_item_id); }
    if (round_code) { where.push('h.round_code = ?'); p.push(round_code); }

    const heats = await query(
      `SELECT h.*, e.name AS event_name, e.event_type, e.result_entry_type, e.event_unit,
              e.is_higher_better, e.result_decimal_places, e.base_attempt_count,
              e.extra_attempt_count, e.extra_qualifier_count, e.result_aggregation_mode,
              gb.label AS band_label, gb.stage, gb.gender
         FROM track_heat h
         JOIN event_item e ON e.id = h.event_item_id
         JOIN group_band gb ON gb.id = h.band_id
        WHERE ${where.join(' AND ')}
        ORDER BY e.sort_no, e.id, h.band_id, h.round_no, h.heat_no`, p
    );

    if (!heats.length) return res.json(ok([]));

    const ids = heats.map((h) => h.id);
    const entries = await query(
      `SELECT * FROM heat_entry WHERE heat_id IN (${ids.map(() => '?').join(',')})
        ORDER BY heat_id, COALESCE(lane_no, sort_no, 0), id`, ids
    );
    const attempts = await query(
      `SELECT fa.* FROM field_attempt fa
         JOIN heat_entry he ON he.id = fa.heat_entry_id
        WHERE he.heat_id IN (${ids.map(() => '?').join(',')})
        ORDER BY fa.heat_entry_id, fa.attempt_no`, ids
    );

    const byHeat = new Map();
    for (const h of heats) byHeat.set(h.id, { ...h, entries: [] });
    for (const e of entries) {
      const h = byHeat.get(e.heat_id);
      if (h) h.entries.push({ ...e, attempts: [] });
    }
    const entryMap = new Map();
    for (const h of byHeat.values()) for (const e of h.entries) entryMap.set(e.id, e);
    for (const a of attempts) {
      const e = entryMap.get(a.heat_entry_id);
      if (e) e.attempts.push(a);
    }

    res.json(ok([...byHeat.values()]));
  } catch (e) { next(e); }
});

/** GET /api/track-result/heat/:id 单组详情 */
router.get('/heat/:id', async (req, res, next) => {
  try {
    const h = await queryOne(
      `SELECT h.*, e.name AS event_name, e.event_type, e.result_entry_type, e.event_unit,
              e.is_higher_better, e.result_decimal_places, e.base_attempt_count,
              e.extra_attempt_count, e.extra_qualifier_count
         FROM track_heat h JOIN event_item e ON e.id = h.event_item_id
        WHERE h.id = ?`, [req.params.id]
    );
    if (!h) return res.json(fail('赛次不存在'));
    const entries = await query(
      'SELECT * FROM heat_entry WHERE heat_id = ? ORDER BY COALESCE(lane_no, sort_no, 0), id',
      [req.params.id]
    );
    const attempts = await query(
      `SELECT fa.* FROM field_attempt fa JOIN heat_entry he ON he.id = fa.heat_entry_id
        WHERE he.heat_id = ? ORDER BY fa.heat_entry_id, fa.attempt_no`, [req.params.id]
    );
    const map = new Map(entries.map((e) => [e.id, { ...e, attempts: [] }]));
    for (const a of attempts) map.get(a.heat_entry_id)?.attempts.push(a);
    res.json(ok({ ...h, entries: [...map.values()] }));
  } catch (e) { next(e); }
});

// ============================================================
// 四、成绩录入（径赛 / 田赛通用）
// ============================================================

/**
 * POST /api/track-result/save
 * body: { heat_id, entries: [{ id, result_text, status_code, manual_rank_flag, rank_no, remark }] }
 */
router.post('/save', roleRequired(1, 3), async (req, res, next) => {
  try {
    const { heat_id, entries } = req.body;
    if (!heat_id || !Array.isArray(entries)) return res.json(fail('参数不完整'));

    const heat = await queryOne('SELECT * FROM track_heat WHERE id = ?', [heat_id]);
    if (!heat) return res.json(fail('赛次不存在'));
    const ev = await queryOne('SELECT * FROM event_item WHERE id = ?', [heat.event_item_id]);
    if (!ev) return res.json(fail('项目不存在'));
    if (Number(heat.confirm_flag) === 1) return res.json(fail('该组成绩已确认，需先撤销确认'));

    const entryType = ev.result_entry_type || 'TIME';
    const decimals = Number(ev.result_decimal_places ?? 2);
    const isField = ev.event_type === 'FIELD';

    for (const item of entries) {
      if (!item.id) continue;
      let value = null;
      let text = item.result_text ?? null;

      if (item.status_code) {
        // 特殊状态：清空成绩
        value = null;
        text = String(item.status_code).toUpperCase();
      } else if (text !== null && text !== undefined && String(text).trim() !== '') {
        value = scoreEngine.parseResult(text, entryType);
        if (value === null) {
          // 无法解析，保留原文但不算数值
          value = null;
        }
      } else {
        value = null;
        text = null;
      }

      await execute(
        `UPDATE heat_entry SET result_text = ?, result_value = ?, status_code = ?,
          manual_rank_flag = ?, rank_no = ?, remark = ?
         WHERE id = ? AND heat_id = ?`,
        [text, value, item.status_code ? String(item.status_code).toUpperCase() : null,
         item.manual_rank_flag ? 1 : 0,
         item.manual_rank_flag ? (item.rank_no ?? null) : null,
         item.remark ?? null, item.id, heat_id]
      );
    }

    // 田赛：如果没有明细，则把主成绩同步成一次试跳（投）
    if (isField) {
      for (const item of entries) {
        if (!item.id) continue;
        const cnt = await queryOne('SELECT COUNT(*) AS c FROM field_attempt WHERE heat_entry_id = ?', [item.id]);
        if (Number(cnt.c) === 0) {
          const ent = await queryOne('SELECT * FROM heat_entry WHERE id = ?', [item.id]);
          if (ent && (ent.result_text || ent.status_code)) {
            await execute(
              `INSERT INTO field_attempt
                (heat_entry_id, attempt_no, phase, result_text, result_value, valid_flag, symbol, is_best)
               VALUES (?,1,'BASE',?,?,?,?,1)`,
              [item.id, ent.result_text, ent.result_value,
               ent.status_code ? 0 : 1, ent.status_code ? String(ent.status_code) : 'O']
            );
            await execute('UPDATE heat_entry SET best_attempt_id = LAST_INSERT_ID() WHERE id = ?', [item.id]);
          }
        }
      }
    }

    // 重排名次
    await recalcRank(heat_id, ev, heat.competition_id);
    await execute('UPDATE track_heat SET status = 3 WHERE id = ?', [heat_id]);

    res.json(ok(null, '成绩已保存'));
  } catch (e) { next(e); }
});

/** 重算一组名次 */
async function recalcRank(heatId, ev, competitionId) {
  const meet = await queryOne('SELECT tie_score_mode FROM competition WHERE id = ?', [competitionId]);
  const entries = await query('SELECT * FROM heat_entry WHERE heat_id = ?', [heatId]);
  const ranked = arrange.computeHeatRank(entries, ev, meet?.tie_score_mode || 'RANK');

  for (const r of ranked) {
    await execute('UPDATE heat_entry SET rank_no = ? WHERE id = ?', [r.rank_no ?? null, r.id]);
  }

  // 全能子项：换算积分
  if (ev.combined_parent_id) {
    await recalcCombinedScore(ev, entries);
  }
  return ranked;
}

async function recalcCombinedScore(ev, entries) {
  const rule = await queryOne('SELECT * FROM event_score_rule WHERE event_item_id = ?', [ev.id]);
  if (!rule) return;
  let tableRows = null;
  if (rule.calculation_type === 'TABLE' && rule.source_score_table_id) {
    tableRows = await query(
      'SELECT * FROM score_table_detail WHERE score_table_id = ? ORDER BY result_value',
      [rule.source_score_table_id]
    );
  }
  for (const e of entries) {
    let score = 0;
    if (!e.status_code && e.result_value !== null) {
      score = scoreEngine.toScore({
        entryType: ev.result_entry_type, value: Number(e.result_value), rule, tableRows
      });
    }
    await execute('UPDATE heat_entry SET score = ? WHERE id = ?', [score, e.id]);
  }
}

/** POST /api/track-result/confirm 确认一组成绩 */
router.post('/confirm', roleRequired(1, 3), async (req, res, next) => {
  try {
    const { heat_id } = req.body;
    await execute(
      'UPDATE track_heat SET confirm_flag = 1, status = 4, confirmed_at = NOW(), confirmed_by = ? WHERE id = ?',
      [req.user.real_name || req.user.username, heat_id]
    );
    res.json(ok(null, '成绩已确认'));
  } catch (e) { next(e); }
});

/** POST /api/track-result/revoke 撤销确认 */
router.post('/revoke', roleRequired(1, 3), async (req, res, next) => {
  try {
    const { heat_id } = req.body;
    await execute(
      'UPDATE track_heat SET confirm_flag = 0, status = 3, confirmed_at = NULL, confirmed_by = NULL WHERE id = ?',
      [heat_id]
    );
    res.json(ok(null, '已撤销确认'));
  } catch (e) { next(e); }
});

/** DELETE /api/track-result/clear/:heatId 清空一组成绩 */
router.delete('/clear/:heatId', roleRequired(1, 3), async (req, res, next) => {
  try {
    const heatId = req.params.heatId;
    const heat = await queryOne('SELECT * FROM track_heat WHERE id = ?', [heatId]);
    if (!heat) return res.json(fail('赛次不存在'));
    if (Number(heat.confirm_flag) === 1) return res.json(fail('已确认的成绩不能清空，请先撤销'));

    await execute(
      `UPDATE heat_entry SET result_text = NULL, result_value = NULL, status_code = NULL,
        rank_no = NULL, score = NULL, qualified = NULL, advance_reason = NULL, best_attempt_id = NULL
       WHERE heat_id = ?`, [heatId]
    );
    await execute(
      `DELETE FROM field_attempt WHERE heat_entry_id IN (SELECT id FROM heat_entry WHERE heat_id = ?)`,
      [heatId]
    );
    await execute('UPDATE track_heat SET status = 2, confirm_flag = 0 WHERE id = ?', [heatId]);
    res.json(ok(null, '成绩已清空'));
  } catch (e) { next(e); }
});

// ============================================================
// 五、田赛试跳（投）明细
// ============================================================

/** GET /api/track-result/attempts/:entryId */
router.get('/attempts/:entryId', async (req, res, next) => {
  try {
    const rows = await query(
      'SELECT * FROM field_attempt WHERE heat_entry_id = ? ORDER BY attempt_no, id',
      [req.params.entryId]
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/**
 * PUT /api/track-result/attempts/:entryId
 * body: { attempts: [{ attempt_no, phase, result_text, valid_flag, symbol, height }] }
 * 保存后自动取本人最好一次回写到 heat_entry
 */
router.put('/attempts/:entryId', roleRequired(1, 3), async (req, res, next) => {
  try {
    const entryId = req.params.entryId;
    const ent = await queryOne('SELECT * FROM heat_entry WHERE id = ?', [entryId]);
    if (!ent) return res.json(fail('记录不存在'));
    const ev = await queryOne('SELECT * FROM event_item WHERE id = ?', [ent.event_item_id]);
    const entryType = ev?.result_entry_type || 'DISTANCE';
    const mode = ev?.result_aggregation_mode || 'BEST';
    const higherBetter = Number(ev?.is_higher_better) === 1;

    const list = req.body.attempts || [];
    await execute('DELETE FROM field_attempt WHERE heat_entry_id = ?', [entryId]);

    let best = null;
    let bestId = null;
    const validValues = [];

    for (const a of list) {
      const value = a.result_text ? scoreEngine.parseResult(a.result_text, entryType) : null;
      const valid = a.symbol === 'X' ? 0 : (value !== null ? 1 : 0);
      const r = await execute(
        `INSERT INTO field_attempt
          (heat_entry_id, attempt_no, phase, result_text, result_value, valid_flag, symbol, height)
         VALUES (?,?,?,?,?,?,?,?)`,
        [entryId, a.attempt_no, a.phase || 'BASE', a.result_text ?? null, value,
         valid, a.symbol || (valid ? 'O' : '-'), a.height ?? null]
      );
      if (valid && value !== null) {
        validValues.push(value);
        if (best === null || (higherBetter ? value > best : value < best)) {
          best = value;
          bestId = r.insertId;
        }
      }
    }

    // 先清 is_best
    await execute('UPDATE field_attempt SET is_best = 0 WHERE heat_entry_id = ?', [entryId]);
    if (bestId) await execute('UPDATE field_attempt SET is_best = 1 WHERE id = ?', [bestId]);

    // 聚合回主成绩
    let finalValue = null;
    if (mode === 'AVG' && validValues.length) {
      finalValue = validValues.reduce((s, v) => s + v, 0) / validValues.length;
    } else {
      finalValue = best;
    }

    const decimals = Number(ev?.result_decimal_places ?? 2);
    await execute(
      'UPDATE heat_entry SET result_value = ?, result_text = ?, best_attempt_id = ?, status_code = NULL WHERE id = ?',
      [finalValue,
       finalValue === null ? null : scoreEngine.formatResult(finalValue, entryType, decimals, ''),
       bestId, entryId]
    );

    res.json(ok({ best: finalValue }, '试跳（投）记录已保存'));
  } catch (e) { next(e); }
});

// ============================================================
// 六、晋级
// ============================================================

/** GET /api/track-result/advancement-rule?event_item_id=&band_id= */
router.get('/advancement-rule', async (req, res, next) => {
  try {
    const { event_item_id, band_id } = req.query;
    const rows = await query(
      'SELECT * FROM advancement_rule WHERE event_item_id = ? AND (band_id IS NULL OR band_id <=> ?) AND status = 1 ORDER BY round_code',
      [event_item_id, band_id ?? null]
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/** PUT /api/track-result/advancement-rule */
router.put('/advancement-rule', roleRequired(1, 3), async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.event_item_id) return res.json(fail('缺少项目 id'));
    const bandId = b.band_id ?? null;
    const roundCode = b.round_code || 'PRELIM';

    const exist = await queryOne(
      'SELECT * FROM advancement_rule WHERE event_item_id = ? AND band_id <=> ? AND round_code = ?',
      [b.event_item_id, bandId, roundCode]
    );
    const vals = [
      b.event_item_id, bandId, roundCode, b.advancement_mode || 'BY_PLACE',
      b.qualify_by_place ?? null, b.qualify_by_result ?? null, b.advance_total_count ?? null,
      b.next_round_code || null, b.next_heat_count ?? null, b.lane_order_mode || 'SNAKE'
    ];
    if (exist) {
      await execute(
        `UPDATE advancement_rule SET event_item_id=?, band_id=?, round_code=?, advancement_mode=?,
          qualify_by_place=?, qualify_by_result=?, advance_total_count=?, next_round_code=?,
          next_heat_count=?, lane_order_mode=?, status=1 WHERE id=?`,
        [...vals, exist.id]
      );
    } else {
      await execute(
        `INSERT INTO advancement_rule
          (event_item_id, band_id, round_code, advancement_mode, qualify_by_place,
           qualify_by_result, advance_total_count, next_round_code, next_heat_count, lane_order_mode)
         VALUES (?,?,?,?,?,?,?,?,?,?)`, vals
      );
    }
    res.json(ok(null, '晋级规则已保存'));
  } catch (e) { next(e); }
});

/**
 * POST /api/track-result/advancement/generate
 * body: { competition_id, event_item_id, band_id, from_round, to_round, to_heat_count }
 * 按规则挑人，生成下一轮分组
 */
router.post('/advancement/generate', roleRequired(1, 3), async (req, res, next) => {
  try {
    const { competition_id, event_item_id, band_id, from_round = 'PRELIM', to_round = 'FINAL', to_heat_count } = req.body;
    if (!competition_id || !event_item_id || !band_id) return res.json(fail('参数不完整'));

    const ev = await queryOne('SELECT * FROM event_item WHERE id = ?', [event_item_id]);
    if (!ev) return res.json(fail('项目不存在'));

    let rule = await queryOne(
      'SELECT * FROM advancement_rule WHERE event_item_id = ? AND band_id <=> ? AND round_code = ? AND status = 1',
      [event_item_id, band_id, from_round]
    );
    if (!rule) {
      rule = await queryOne(
        'SELECT * FROM advancement_rule WHERE event_item_id = ? AND band_id IS NULL AND round_code = ? AND status = 1',
        [event_item_id, from_round]
      );
    }
    if (!rule) return res.json(fail('尚未配置晋级规则'));

    // 取本轮所有组与人员（已算名次）
    const heats = await query(
      'SELECT * FROM track_heat WHERE competition_id=? AND band_id=? AND event_item_id=? AND round_code=? ORDER BY heat_no',
      [competition_id, band_id, event_item_id, from_round]
    );
    if (!heats.length) return res.json(fail('本轮尚无分组'));

    const withEntries = [];
    for (const h of heats) {
      const entries = await query('SELECT * FROM heat_entry WHERE heat_id = ?', [h.id]);
      withEntries.push({ ...h, entries });
    }

    const picked = arrange.pickAdvancers(withEntries, rule, ev);
    if (!picked.length) return res.json(fail('没有符合晋级条件的人员'));

    // 清掉本轮已有的晋级标记（heat_entry 不存 round_code，按项目+组别清）
    await execute(
      'UPDATE heat_entry SET qualified = 0, advance_reason = NULL WHERE competition_id=? AND band_id=? AND event_item_id=?',
      [competition_id, band_id, event_item_id]
    );

    // 目标组数
    const capacity = Number(ev.lane_count) || 8;
    let heatCount = Number(to_heat_count || rule.next_heat_count || 0);
    if (!heatCount) heatCount = Math.max(1, Math.ceil(picked.length / capacity));

    const groups = arrange.splitHeats(picked, {
      round_mode: 'FIXED', fixed_heat_count: heatCount,
      lane_order_mode: rule.lane_order_mode || 'SNAKE',
      lane_count: capacity, heat_capacity: capacity
    });

    // 删掉旧的下一轮
    const oldHeats = await query(
      'SELECT id FROM track_heat WHERE competition_id=? AND band_id=? AND event_item_id=? AND round_code=?',
      [competition_id, band_id, event_item_id, to_round]
    );
    for (const h of oldHeats) {
      await execute('DELETE FROM heat_entry WHERE heat_id = ?', [h.id]);
      await execute('DELETE FROM track_heat WHERE id = ?', [h.id]);
    }

    let created = 0;
    for (let i = 0; i < groups.length; i++) {
      const members = arrange.assignLanes(groups[i], { lane_count: capacity, lane_order_mode: rule.lane_order_mode }, capacity);
      const hr = await execute(
        `INSERT INTO track_heat
          (competition_id, band_id, event_item_id, round_code, round_no, heat_no, heat_name, lane_count, entry_count, status)
         VALUES (?,?,?,?,?,?,?,?,?,2)`,
        [competition_id, band_id, event_item_id, to_round, ROUND_NO[to_round] || 3, i + 1,
         `${ROUND_NAME[to_round] || ''}第${i + 1}组`, capacity, members.length]
      );
      const heatId = hr.insertId;
      for (let k = 0; k < members.length; k++) {
        const m = members[k];
        await execute(
          `INSERT INTO heat_entry
            (heat_id, competition_id, band_id, event_item_id, athlete_id, athlete_name,
             school_id, school_name, bib_no, lane_no, sort_no, qualified, advance_reason, source_heat_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
          [heatId, competition_id, band_id, event_item_id, m.athlete_id, m.athlete_name,
           m.school_id, m.school_name, m.bib_no,
           ev.event_type === 'FIELD' ? null : (m.lane_no ?? k + 1), k + 1,
           m.advance_reason || null, m.source_heat_id || null]
        );
        created++;
      }
    }

    res.json(ok({ heats: groups.length, entries: created }, `已生成 ${ROUND_NAME[to_round]}：${groups.length} 组 / ${created} 人`));
  } catch (e) { next(e); }
});

// ============================================================
// 七、棒次表
// ============================================================

/** GET /api/track-result/relay/:entryId */
router.get('/relay/:entryId', async (req, res, next) => {
  try {
    const rows = await query(
      'SELECT * FROM relay_lineup WHERE heat_entry_id = ? ORDER BY leg_no', [req.params.entryId]
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/**
 * GET /api/track-result/relay/candidates?competition_id=&band_id=&event_item_id=
 * 取同校已报名该接力项目的运动员作为候选
 */
router.get('/relay/candidates', async (req, res, next) => {
  try {
    const { competition_id, band_id, event_item_id } = req.query;
    const rows = await query(
      `SELECT a.id AS athlete_id, a.name AS athlete_name, a.school_id, s.name AS school_name, a.bib_no
         FROM athlete_entry ae
         JOIN athlete a ON a.id = ae.athlete_id
         LEFT JOIN school s ON s.id = a.school_id
        WHERE ae.competition_id = ? AND ae.band_id = ? AND ae.event_item_id = ? AND ae.status = 2
        ORDER BY a.school_id, a.bib_no`,
      [competition_id, band_id, event_item_id]
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/** PUT /api/track-result/relay/:entryId */
router.put('/relay/:entryId', roleRequired(1, 2, 3), async (req, res, next) => {
  try {
    const entryId = req.params.entryId;
    const legs = req.body.legs || [];
    await execute('DELETE FROM relay_lineup WHERE heat_entry_id = ?', [entryId]);
    for (const l of legs) {
      if (!l.athlete_id) continue;
      await execute(
        'INSERT INTO relay_lineup (heat_entry_id, leg_no, athlete_id, athlete_name, bib_no, is_temporary) VALUES (?,?,?,?,?,?)',
        [entryId, l.leg_no, l.athlete_id, l.athlete_name || null, l.bib_no || null, l.is_temporary ? 1 : 0]
      );
    }
    res.json(ok(null, '棒次已保存'));
  } catch (e) { next(e); }
});

// ============================================================
// 八、全能总分
// ============================================================

/**
 * GET /api/track-result/combined?competition_id=&event_item_id=&band_id=
 * 全能父项目的总分排名
 */
router.get('/combined', async (req, res, next) => {
  try {
    const { competition_id, event_item_id, band_id } = req.query;
    const rows = await query(
      `SELECT c.*, s.name AS school_name
         FROM combined_entry c
         LEFT JOIN school s ON s.id = c.school_id
        WHERE c.competition_id = ? AND c.event_item_id = ? AND (? IS NULL OR c.band_id = ?)
        ORDER BY c.total_score DESC, c.rank_no, c.id`,
      [competition_id, event_item_id, band_id ?? null, band_id ?? null]
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/**
 * POST /api/track-result/combined/recalc
 * body: { competition_id, event_item_id, band_id }
 * 重算全能总分
 */
router.post('/combined/recalc', roleRequired(1, 3), async (req, res, next) => {
  try {
    const { competition_id, event_item_id, band_id } = req.body;
    const parent = await queryOne('SELECT * FROM event_item WHERE id = ?', [event_item_id]);
    if (!parent) return res.json(fail('全能项目不存在'));

    // 参赛名单：报名了全能父项目的人
    const athletes = await query(
      `SELECT ae.athlete_id, a.name AS athlete_name, a.school_id, s.name AS school_name
         FROM athlete_entry ae
         JOIN athlete a ON a.id = ae.athlete_id
         LEFT JOIN school s ON s.id = a.school_id
        WHERE ae.competition_id = ? AND ae.band_id = ? AND ae.event_item_id = ? AND ae.status = 2`,
      [competition_id, band_id, event_item_id]
    );

    let n = 0;
    for (const a of athletes) {
      const r = await arrange.computeCombinedTotal(competition_id, event_item_id, band_id, a.athlete_id);
      const exist = await queryOne(
        'SELECT * FROM combined_entry WHERE event_item_id = ? AND band_id = ? AND athlete_id = ?',
        [event_item_id, band_id, a.athlete_id]
      );
      if (exist) {
        await execute(
          'UPDATE combined_entry SET total_score=?, finished_count=?, missing_count=? WHERE id=?',
          [r.total, r.finished, r.missing, exist.id]
        );
        await execute('DELETE FROM combined_item_score WHERE combined_entry_id = ?', [exist.id]);
        for (const d of r.details) {
          await execute(
            `INSERT INTO combined_item_score
              (combined_entry_id, child_event_item_id, item_order, result_text, result_value, score)
             VALUES (?,?,?,?,?,?)`,
            [exist.id, d.child_event_item_id, d.item_order, d.result_text, d.result_value, d.score]
          );
        }
      } else {
        const ir = await execute(
          `INSERT INTO combined_entry
            (competition_id, band_id, event_item_id, athlete_id, athlete_name, school_id, school_name,
             total_score, finished_count, missing_count)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [competition_id, band_id, event_item_id, a.athlete_id, a.athlete_name,
           a.school_id, a.school_name, r.total, r.finished, r.missing]
        );
        for (const d of r.details) {
          await execute(
            `INSERT INTO combined_item_score
              (combined_entry_id, child_event_item_id, item_order, result_text, result_value, score)
             VALUES (?,?,?,?,?,?)`,
            [ir.insertId, d.child_event_item_id, d.item_order, d.result_text, d.result_value, d.score]
          );
        }
      }
      n++;
    }

    // 排名
    const meet = await queryOne('SELECT tie_score_mode FROM competition WHERE id = ?', [competition_id]);
    const list = await query(
      'SELECT * FROM combined_entry WHERE event_item_id = ? AND band_id = ? ORDER BY total_score DESC',
      [event_item_id, band_id]
    );
    const tie = meet?.tie_score_mode || 'RANK';
    let i = 0;
    while (i < list.length) {
      let j = i;
      while (j + 1 < list.length && Number(list[j + 1].total_score) === Number(list[i].total_score)) j++;
      const rank = i + 1;
      for (let k = i; k <= j; k++) {
        await execute('UPDATE combined_entry SET rank_no = ? WHERE id = ?', [rank, list[k].id]);
      }
      i = j + 1;
    }
    void tie;

    res.json(ok({ count: n }, `已重算 ${n} 人`));
  } catch (e) { next(e); }
});

module.exports = router;
