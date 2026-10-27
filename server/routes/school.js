const express = require('express');
const { query, queryOne, execute, ok, fail } = require('../db');
const { authRequired, roleRequired } = require('../middleware/auth');
const { hashPassword, randomPassword } = require('../utils/helpers');

const router = express.Router();
router.use(authRequired);

/**
 * 学校列表
 * GET /api/school/list
 */
router.get('/list', async (req, res, next) => {
  try {
    // 学校角色只看自己
    const where = req.user.role === 2 ? 'WHERE id = ?' : '';
    const params = req.user.role === 2 ? [req.user.school_id] : [];

    const rows = await query(
      `SELECT s.*,
        (SELECT COUNT(*) FROM user WHERE school_id = s.id AND role = 2) AS account_count
       FROM school s ${where} ORDER BY s.stage, s.name`,
      params
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/**
 * 新增学校
 * POST /api/school
 */
router.post('/', roleRequired(1), async (req, res, next) => {
  try {
    const { name, stage, short_name, principal, phone, createAccount } = req.body;
    if (!name) return res.json(fail('请填写学校名称'));

    const exists = await queryOne('SELECT id FROM school WHERE name = ?', [name]);
    if (exists) return res.json(fail('学校名称已存在'));

    const r = await execute(
      'INSERT INTO school (name, stage, short_name, principal, phone) VALUES (?,?,?,?,?)',
      [name, stage || 1, short_name || null, principal || null, phone || null]
    );

    // 顺手创建学校端账号
    let account = null;
    if (createAccount) {
      const username = `school${r.insertId}`;
      const pwd = randomPassword(8);
      await execute(
        'INSERT INTO user (school_id, username, password_hash, real_name, role) VALUES (?,?,?,?,2)',
        [r.insertId, username, hashPassword(pwd), principal || name]
      );
      account = { username, password: pwd };
    }

    res.json(ok({ id: r.insertId, account }, '学校已创建'));
  } catch (e) { next(e); }
});

/**
 * 启用/停用账号
 * PUT /api/school/user-status
 * 注意：必须注册在 PUT /:id 之前，否则会被通配路由抢先命中
 */
router.put('/user-status', roleRequired(1), async (req, res, next) => {
  try {
    const { user_id, is_active } = req.body;
    await execute('UPDATE user SET is_active = ? WHERE id = ?', [is_active ? 1 : 0, user_id]);
    res.json(ok(null, is_active ? '已启用' : '已停用'));
  } catch (e) { next(e); }
});

/**
 * 修改账号
 * PUT /api/school/user/:id
 * 可改：账号名、姓名、联系电话、角色、所属学校（学校账号必填）
 * 注意：必须注册在 PUT /:id 之前
 */
router.put('/user/:id', roleRequired(1), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const u = await queryOne('SELECT * FROM user WHERE id = ?', [id]);
    if (!u) return res.json(fail('账号不存在'));

    const { username, real_name, phone, role, school_id } = req.body;

    const nextName = String(username || '').trim();
    if (!nextName) return res.json(fail('请填写登录账号'));

    // 账号名查重（排除自己）
    const dup = await queryOne('SELECT id FROM user WHERE username = ? AND id <> ?', [nextName, id]);
    if (dup) return res.json(fail('登录账号已存在'));

    const nextRole = role !== undefined && role !== null ? Number(role) : u.role;
    if (![1, 2, 3].includes(nextRole)) return res.json(fail('角色不正确'));

    // 角色与所属学校：库里 school_id NOT NULL，0 表示教育局；学校账号必须挂学校
    let nextSchool = school_id !== undefined && school_id !== null && school_id !== ''
      ? Number(school_id)
      : u.school_id;
    if (nextRole !== 2) nextSchool = 0;
    if (nextRole === 2 && !nextSchool) return res.json(fail('学校账号必须选择所属学校'));

    // 不允许把最后一个教育局账号改成别的角色
    if (u.role === 1 && nextRole !== 1) {
      const admins = await queryOne('SELECT COUNT(*) AS c FROM user WHERE role = 1');
      if (admins.c <= 1) return res.json(fail('至少保留一个教育局账号'));
    }

    // real_name 在库里是 NOT NULL，没填就保留原值
    const nextRealName = String(real_name || '').trim() || u.real_name || '';

    await execute(
      'UPDATE user SET username = ?, real_name = ?, phone = ?, role = ?, school_id = ? WHERE id = ?',
      [nextName, nextRealName,
       phone ? String(phone).trim() : null, nextRole, nextSchool, id]
    );
    res.json(ok(null, '已保存'));
  } catch (e) { next(e); }
});

/**
 * 删除账号
 * DELETE /api/school/user/:id
 * 保护：不能删自己，不能删最后一个教育局账号
 */
router.delete('/user/:id', roleRequired(1), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.json(fail('不能删除当前登录的账号'));

    const u = await queryOne('SELECT * FROM user WHERE id = ?', [id]);
    if (!u) return res.json(fail('账号不存在'));

    if (u.role === 1) {
      const admins = await queryOne('SELECT COUNT(*) AS c FROM user WHERE role = 1');
      if (admins.c <= 1) return res.json(fail('至少保留一个教育局账号'));
    }

    await execute('DELETE FROM user WHERE id = ?', [id]);
    res.json(ok(null, '已删除'));
  } catch (e) { next(e); }
});

/**
 * 修改学校
 * PUT /api/school/:id
 */
router.put('/:id', roleRequired(1), async (req, res, next) => {
  try {
    const { name, stage, short_name, principal, phone } = req.body;
    const r = await execute(
      'UPDATE school SET name=?, stage=?, short_name=?, principal=?, phone=? WHERE id=?',
      [name, stage, short_name, principal, phone, req.params.id]
    );
    if (r.affectedRows === 0) return res.json(fail('学校不存在'));
    res.json(ok(null, '已保存'));
  } catch (e) { next(e); }
});

/**
 * 删除学校
 * DELETE /api/school/:id
 */
router.delete('/:id', roleRequired(1), async (req, res, next) => {
  try {
    await execute('DELETE FROM user WHERE school_id = ? AND role = 2', [req.params.id]);
    const r = await execute('DELETE FROM school WHERE id = ?', [req.params.id]);
    if (r.affectedRows === 0) return res.json(fail('学校不存在'));
    res.json(ok(null, '已删除'));
  } catch (e) { next(e); }
});

/**
 * 创建学校端账号
 * POST /api/school/account
 */
router.post('/account', roleRequired(1), async (req, res, next) => {
  try {
    const { school_id, real_name, username, phone } = req.body;
    if (!school_id || !real_name) return res.json(fail('请填写学校和联系人'));

    let account = username;
    if (!account) {
      const count = await queryOne('SELECT COUNT(*) AS c FROM user WHERE role = 2');
      account = `school${Date.now().toString().slice(-6)}`;
    }
    const exists = await queryOne('SELECT id FROM user WHERE username = ?', [account]);
    if (exists) return res.json(fail('账号已存在'));

    const pwd = randomPassword(8);
    await execute(
      'INSERT INTO user (school_id, username, password_hash, real_name, role, phone) VALUES (?,?,?,?,2,?)',
      [school_id, account, hashPassword(pwd), real_name, phone || null]
    );

    res.json(ok({ username: account, password: pwd }, '账号已创建，请把初始密码转交学校'));
  } catch (e) { next(e); }
});

/**
 * 重置密码
 * POST /api/school/reset-password
 */
router.post('/reset-password', roleRequired(1), async (req, res, next) => {
  try {
    const { user_id } = req.body;
    const pwd = randomPassword(8);
    await execute('UPDATE user SET password_hash = ? WHERE id = ?', [hashPassword(pwd), user_id]);
    res.json(ok({ password: pwd }, '密码已重置'));
  } catch (e) { next(e); }
});

/**
 * 用户列表
 * GET /api/school/users
 */
router.get('/users', roleRequired(1), async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT u.id, u.username, u.real_name, u.role, u.phone, u.school_id, u.is_active, u.last_login_at,
              s.name AS school_name
       FROM user u LEFT JOIN school s ON s.id = u.school_id
       ORDER BY u.role, u.id`
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

module.exports = router;
