const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, queryOne, execute, ok, fail } = require('../db');
const { signToken, authRequired, roleRequired } = require('../middleware/auth');
const { hashPassword, verifyPassword, needsRehash, randomPassword } = require('../utils/helpers');

const router = express.Router();

/**
 * 登录限流
 *
 * 之前 /login 完全不限流，账号密码可以被无限暴力尝试。
 * 这里做双层限制：
 *   1) 按 IP 限制总次数（防大范围扫描）
 *   2) 按用户名限制失败次数（防针对单个账号的撞库）
 */
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,   // 10 分钟
  max: 30,                    // 同一 IP 最多 30 次
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 1, message: '登录尝试过于频繁，请 10 分钟后再试', data: null }
});

/** 按用户名计数的失败次数 */
const failCount = new Map();
const FAIL_WINDOW = 10 * 60 * 1000;
const FAIL_LIMIT = 8;          // 同一账号 10 分钟内最多失败 8 次

function checkUserLock(username) {
  const rec = failCount.get(username);
  if (!rec) return null;
  if (Date.now() - rec.at > FAIL_WINDOW) {
    failCount.delete(username);
    return null;
  }
  if (rec.n >= FAIL_LIMIT) {
    const mins = Math.ceil((FAIL_WINDOW - (Date.now() - rec.at)) / 60000);
    return `该账号连续登录失败次数过多，请 ${mins} 分钟后再试`;
  }
  return null;
}

function recordFail(username) {
  const rec = failCount.get(username);
  if (!rec || Date.now() - rec.at > FAIL_WINDOW) {
    failCount.set(username, { n: 1, at: Date.now() });
  } else {
    rec.n += 1;
    rec.at = Date.now();
  }
}

function clearFail(username) {
  failCount.delete(username);
}

// 定期清理过期记录，避免 Map 无限增长
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of failCount) {
    if (now - v.at > FAIL_WINDOW) failCount.delete(k);
  }
}, FAIL_WINDOW).unref?.();

/**
 * 登录
 * POST /api/auth/login
 */
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.json(fail('请输入账号和密码'));
    }

    const lockMsg = checkUserLock(String(username));
    if (lockMsg) {
      return res.status(429).json(fail(lockMsg, 429));
    }

    const user = await queryOne(
      'SELECT * FROM user WHERE username = ? AND is_active = 1',
      [username]
    );
    if (!user || !verifyPassword(password, user.password_hash)) {
      recordFail(String(username));
      return res.json(fail('账号或密码错误'));
    }

    // 老版 sha256 哈希在此处自动升级为 bcrypt
    if (needsRehash(user.password_hash)) {
      try {
        await execute('UPDATE user SET password_hash = ? WHERE id = ?', [
          hashPassword(password), user.id
        ]);
        console.log(`[安全] 用户 ${user.username} 的密码哈希已升级为 bcrypt`);
      } catch (e) {
        console.error('[安全] 密码哈希升级失败：', e.message);
      }
    }

    clearFail(String(username));

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
