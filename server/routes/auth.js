const express = require('express');
const { query, queryOne, execute, ok, fail } = require('../db');
const { signToken, authRequired, roleRequired } = require('../middleware/auth');
const { hashPassword, verifyPassword, randomPassword } = require('../utils/helpers');

const router = express.Router();

/**
 * 登录
 * POST /api/auth/login
 */
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.json(fail('请输入账号和密码'));
    }

    const user = await queryOne(
      'SELECT * FROM user WHERE username = ? AND is_active = 1',
      [username]
    );
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.json(fail('账号或密码错误'));
    }

    await execute('UPDATE user SET last_login_at = NOW() WHERE id = ?', [user.id]);

    const token = signToken(user);
    const school = user.school_id
      ? await queryOne('SELECT id, name, stage FROM school WHERE id = ?', [user.school_id])
      : null;

    res.json(ok({
      token,
      user: {
        id: user.id,
        username: user.username,
        real_name: user.real_name,
        role: user.role,
        school_id: user.school_id,
        school_name: school?.name || null,
        referee_id: user.referee_id
      }
    }, '登录成功'));
  } catch (e) { next(e); }
});

/**
 * 修改密码
 * POST /api/auth/change-password
 */
router.post('/change-password', authRequired, async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.json(fail('请填写完整'));
    }
    if (newPassword.length < 6) {
      return res.json(fail('新密码至少 6 位'));
    }

    const user = await queryOne('SELECT * FROM user WHERE id = ?', [req.user.id]);
    if (!verifyPassword(oldPassword, user.password_hash)) {
      return res.json(fail('原密码错误'));
    }

    await execute('UPDATE user SET password_hash = ? WHERE id = ?', [
      hashPassword(newPassword), req.user.id
    ]);
    res.json(ok(null, '密码已修改'));
  } catch (e) { next(e); }
});

/**
 * 获取当前用户信息
 * GET /api/auth/profile
 */
router.get('/profile', authRequired, async (req, res, next) => {
  try {
    const school = req.user.school_id
      ? await queryOne('SELECT id, name, stage FROM school WHERE id = ?', [req.user.school_id])
      : null;
    res.json(ok({
      ...req.user,
      school_name: school?.name || null
    }));
  } catch (e) { next(e); }
});

module.exports = router;
