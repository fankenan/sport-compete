const express = require('express');
const { query, queryOne, execute, ok, fail } = require('../db');
const { authRequired, roleRequired } = require('../middleware/auth');
const { hashPassword, randomPassword, bandLabel } = require('../utils/helpers');

const router = express.Router();
router.use(authRequired);

// ============================================================
// 裁判库
// ============================================================

router.get('/list', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT r.*, s.name AS school_name FROM referee r
       LEFT JOIN school s ON s.id = r.school_id
       WHERE r.is_active = 1 ORDER BY r.level, r.id`
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

router.post('/', roleRequired(1), async (req, res, next) => {
  try {
    const { name, phone, school_id, level } = req.body;
    if (!name) return res.json(fail('请填写裁判姓名'));
    const r = await execute(
      'INSERT INTO referee (name, phone, school_id, level) VALUES (?,?,?,?)',
      [name, phone || null, school_id || null, level || null]
    );
    res.json(ok({ id: r.insertId }, '裁判已添加'));
  } catch (e) { next(e); }
});

router.put('/:id', roleRequired(1), async (req, res, next) => {
  try {
    const { name, phone, school_id, level, is_active } = req.body;
    await execute(
      'UPDATE referee SET name=?, phone=?, school_id=?, level=?, is_active=? WHERE id=?',
      [name, phone, school_id, level, is_active ?? 1, req.params.id]
    );
    res.json(ok(null, '已保存'));
  } catch (e) { next(e); }
});

router.delete('/:id', roleRequired(1), async (req, res, next) => {
  try {
    await execute('UPDATE referee SET is_active = 0 WHERE id = ?', [req.params.id]);
    res.json(ok(null, '已停用'));
  } catch (e) { next(e); }
});

// ============================================================
// 场次裁判指派
// ============================================================

router.get('/assign', async (req, res, next) => {
  try {
    const { competition_id } = req.query;
    const rows = await query(
      `SELECT mr.id, mr.match_id, mr.role, mr.referee_id, r.name AS referee_name,
              m.seq_no, m.stage, m.team_a_id, m.team_b_id,
              ta.team_name AS team_a_name, tb.team_name AS team_b_name,
              ei.name AS event_name, gb.stage AS band_stage, gb.gender, gb.label AS band_label,
              ss.play_date, ss.start_time
       FROM match_referee mr
       JOIN referee r ON r.id = mr.referee_id
       JOIN match_info m ON m.id = mr.match_id
       LEFT JOIN team_entry ta ON ta.id = m.team_a_id
       LEFT JOIN team_entry tb ON tb.id = m.team_b_id
       JOIN event_item ei ON ei.id = m.event_item_id
       JOIN group_band gb ON gb.id = m.band_id
       LEFT JOIN schedule_slot ss ON ss.id = m.slot_id
       WHERE m.competition_id = ? ORDER BY m.seq_no`,
      [competition_id]
    );
    // gb.label 存的是 男高 这类短码，统一转成 高中男子
    res.json(ok(rows.map((r) => ({
      ...r,
      band_label: bandLabel({ stage: r.band_stage, gender: r.gender, label: r.band_label })
    }))));
  } catch (e) { next(e); }
});

router.post('/assign', roleRequired(1), async (req, res, next) => {
  try {
    const { match_id, referee_id, role } = req.body;
    if (!match_id || !referee_id) return res.json(fail('参数不完整'));
    const exists = await queryOne(
      'SELECT id FROM match_referee WHERE match_id=? AND referee_id=?',
      [match_id, referee_id]
    );
    if (exists) return res.json(fail('该裁判已指派到本场'));
    await execute(
      'INSERT INTO match_referee (match_id, referee_id, role) VALUES (?,?,?)',
      [match_id, referee_id, role || 1]
    );
    res.json(ok(null, '已指派'));
  } catch (e) { next(e); }
});

/**
 * 批量指派（按日期或全部未指派场次）
 */
router.post('/assign-batch', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, referee_id, role, play_date, match_ids } = req.body;
    if (!referee_id) return res.json(fail('请选择裁判'));

    let ids = match_ids;
    if (!ids || ids.length === 0) {
      const where = ['m.competition_id = ?', 'm.slot_id IS NOT NULL'];
      const params = [competition_id];
      if (play_date) { where.push('ss.play_date = ?'); params.push(play_date); }
      where.push('m.id NOT IN (SELECT match_id FROM match_referee WHERE referee_id = ?)');
      params.push(referee_id);
      const rows = await query(
        `SELECT m.id FROM match_info m JOIN schedule_slot ss ON ss.id = m.slot_id
         WHERE ${where.join(' AND ')}`,
        params
      );
      ids = rows.map((r) => r.id);
    }

    let count = 0;
    for (const id of ids) {
      const exists = await queryOne(
        'SELECT id FROM match_referee WHERE match_id=? AND referee_id=?',
        [id, referee_id]
      );
      if (exists) continue;
      await execute('INSERT INTO match_referee (match_id, referee_id, role) VALUES (?,?,?)', [id, referee_id, role || 1]);
      count++;
    }
    res.json(ok({ count }, `已指派 ${count} 场`));
  } catch (e) { next(e); }
});

router.delete('/assign/:id', roleRequired(1), async (req, res, next) => {
  try {
    await execute('DELETE FROM match_referee WHERE id = ?', [req.params.id]);
    res.json(ok(null, '已取消指派'));
  } catch (e) { next(e); }
});

/**
 * 为裁判创建登录账号
 */
router.post('/account', roleRequired(1), async (req, res, next) => {
  try {
    const { referee_id, real_name } = req.body;
    if (!referee_id) return res.json(fail('请选择裁判'));

    const r = await queryOne('SELECT * FROM referee WHERE id = ?', [referee_id]);
    if (!r) return res.json(fail('裁判不存在'));

    const username = `ref${String(referee_id).padStart(3, '0')}`;
    const exists = await queryOne('SELECT id FROM user WHERE username = ?', [username]);
    if (exists) return res.json(fail('该裁判已有账号'));

    const pwd = randomPassword(8);
    await execute(
      'INSERT INTO user (school_id, username, password_hash, real_name, role, phone, referee_id) VALUES (0,?,?,?,3,?,?)',
      [username, hashPassword(pwd), real_name || r.name, r.phone, referee_id]
    );
    res.json(ok({ username, password: pwd }, '账号已创建'));
  } catch (e) { next(e); }
});

/**
 * 裁判委员会名单（进秩序册）
 */
router.get('/committee', async (req, res, next) => {
  try {
    const { competition_id } = req.query;
    const rows = await query(
      'SELECT * FROM committee WHERE competition_id = ? ORDER BY category, sort_no, id',
      [competition_id]
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

router.post('/committee', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, category, name, position, sort_no } = req.body;
    if (!competition_id || !category || !name) return res.json(fail('请填写完整'));
    const r = await execute(
      'INSERT INTO committee (competition_id, category, name, position, sort_no) VALUES (?,?,?,?,?)',
      [competition_id, category, name, position || null, sort_no || 0]
    );
    res.json(ok({ id: r.insertId }, '已添加'));
  } catch (e) { next(e); }
});

router.delete('/committee/:id', roleRequired(1), async (req, res, next) => {
  try {
    await execute('DELETE FROM committee WHERE id = ?', [req.params.id]);
    res.json(ok(null, '已删除'));
  } catch (e) { next(e); }
});

module.exports = router;
