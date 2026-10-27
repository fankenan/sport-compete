const express = require('express');
const { query, queryOne, execute, ok, fail } = require('../db');
const { authRequired, roleRequired } = require('../middleware/auth');
const { bandLabel } = require('../utils/helpers');

const router = express.Router();
router.use(authRequired);

/**
 * 名次表
 * GET /api/rank/list
 */
router.get('/list', async (req, res, next) => {
  try {
    const { competition_id, band_id, event_item_id } = req.query;
    const where = ['r.competition_id = ?'];
    const params = [competition_id];
    if (band_id) { where.push('r.band_id = ?'); params.push(band_id); }
    if (event_item_id) { where.push('r.event_item_id = ?'); params.push(event_item_id); }

    const rows = await query(
      `SELECT r.*, te.team_name, s.name AS school_name, s.short_name,
              ei.name AS event_name, gb.stage, gb.gender, gb.label AS band_label
       FROM final_rank r
       JOIN team_entry te ON te.id = r.team_entry_id
       JOIN school s ON s.id = te.school_id
       JOIN event_item ei ON ei.id = r.event_item_id
       JOIN group_band gb ON gb.id = r.band_id
       WHERE ${where.join(' AND ')}
       ORDER BY gb.stage, gb.gender, ei.name, r.rank_no`,
      params
    );
    res.json(ok(rows.map((r) => ({ ...r, band_label: bandLabel(r) }))));
  } catch (e) { next(e); }
});

/**
 * 手动设置名次
 */
router.post('/set', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, band_id, event_item_id, team_entry_id, rank_no } = req.body;
    if (!team_entry_id || !rank_no) return res.json(fail('参数不完整'));

    const exists = await queryOne(
      'SELECT id FROM final_rank WHERE competition_id=? AND band_id=? AND event_item_id=? AND team_entry_id=?',
      [competition_id, band_id, event_item_id, team_entry_id]
    );
    if (exists) {
      await execute('UPDATE final_rank SET rank_no=? WHERE id=?', [rank_no, exists.id]);
    } else {
      await execute(
        'INSERT INTO final_rank (competition_id, band_id, event_item_id, rank_no, team_entry_id, source_stage) VALUES (?,?,?,?,?,1)',
        [competition_id, band_id, event_item_id, rank_no, team_entry_id]
      );
    }
    res.json(ok(null, '名次已保存'));
  } catch (e) { next(e); }
});

/**
 * 删除名次
 */
router.delete('/:id', roleRequired(1), async (req, res, next) => {
  try {
    await execute('DELETE FROM final_rank WHERE id = ?', [req.params.id]);
    res.json(ok(null, '已删除'));
  } catch (e) { next(e); }
});

module.exports = router;
