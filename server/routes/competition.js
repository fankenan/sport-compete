const express = require('express');
const { query, queryOne, execute, ok, fail } = require('../db');
const { authRequired, roleRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

/**
 * 赛事列表
 */
router.get('/list', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT c.*,
        (SELECT COUNT(*) FROM school) AS school_total,
        (SELECT COUNT(DISTINCT school_id) FROM team_entry WHERE competition_id = c.id AND status = 2) AS school_joined,
        (SELECT COUNT(*) FROM athlete_entry WHERE competition_id = c.id AND status = 2) AS athlete_count,
        (SELECT COUNT(*) FROM match_info WHERE competition_id = c.id) AS match_count
       FROM competition c ORDER BY c.year DESC, c.id DESC`
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/**
 * 赛事详情
 */
router.get('/:id', async (req, res, next) => {
  try {
    const c = await queryOne('SELECT * FROM competition WHERE id = ?', [req.params.id]);
    if (!c) return res.json(fail('赛事不存在'));
    res.json(ok(c));
  } catch (e) { next(e); }
});

/**
 * 新建赛事
 */
router.post('/', roleRequired(1), async (req, res, next) => {
  try {
    const { name, year, stage, start_date, end_date } = req.body;
    if (!name || !year) return res.json(fail('请填写赛事名称和年份'));
    const r = await execute(
      'INSERT INTO competition (name, year, stage, start_date, end_date) VALUES (?,?,?,?,?)',
      [name, year, stage || 0, start_date || null, end_date || null]
    );
    res.json(ok({ id: r.insertId }, '赛事已创建'));
  } catch (e) { next(e); }
});

/**
 * 修改赛事
 */
router.put('/:id', roleRequired(1), async (req, res, next) => {
  try {
    const { name, year, stage, start_date, end_date, status, config_json } = req.body;
    await execute(
      `UPDATE competition SET name=?, year=?, stage=?, start_date=?, end_date=?, status=?, config_json=? WHERE id=?`,
      [name, year, stage, start_date, end_date, status,
       config_json ? JSON.stringify(config_json) : null, req.params.id]
    );
    res.json(ok(null, '已保存'));
  } catch (e) { next(e); }
});

/**
 * 推进赛事状态
 */
router.patch('/:id/stage', roleRequired(1), async (req, res, next) => {
  try {
    const { status } = req.body;
    await execute('UPDATE competition SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json(ok(null, '状态已更新'));
  } catch (e) { next(e); }
});

/**
 * 删除赛事
 */
router.delete('/:id', roleRequired(1), async (req, res, next) => {
  try {
    const id = req.params.id;
    // 级联清理
    await execute('DELETE FROM match_result WHERE match_id IN (SELECT id FROM match_info WHERE competition_id=?)', [id]);
    await execute('DELETE FROM match_referee WHERE match_id IN (SELECT id FROM match_info WHERE competition_id=?)', [id]);
    await execute('DELETE FROM match_info WHERE competition_id = ?', [id]);
    await execute('DELETE FROM schedule_slot WHERE competition_id = ?', [id]);
    await execute('DELETE FROM heat_member WHERE heat_group_id IN (SELECT id FROM heat_group WHERE competition_id=?)', [id]);
    await execute('DELETE FROM heat_group WHERE competition_id = ?', [id]);
    await execute('DELETE FROM final_rank WHERE competition_id = ?', [id]);
    await execute('DELETE FROM athlete_entry WHERE competition_id = ?', [id]);
    await execute('DELETE FROM team_entry WHERE competition_id = ?', [id]);
    await execute('DELETE FROM committee WHERE competition_id = ?', [id]);
    await execute('DELETE FROM venue WHERE competition_id = ?', [id]);
    await execute('DELETE FROM group_band WHERE competition_id = ?', [id]);
    await execute('DELETE FROM event_item WHERE competition_id = ?', [id]);
    await execute('DELETE FROM competition WHERE id = ?', [id]);
    res.json(ok(null, '赛事已删除'));
  } catch (e) { next(e); }
});

module.exports = router;
