const jwt = require('jsonwebtoken');
const { queryOne, fail } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'sport-compete-dev-secret';
const TOKEN_TTL = '12h';

/**
 * 生成 token
 */
function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      school_id: user.school_id,
      real_name: user.real_name
    },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

/**
 * 解析 token
 */
function parseToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(header.slice(7), JWT_SECRET);
  } catch (e) {
    return null;
  }
}

/**
 * 认证中间件：必须登录
 */
async function authRequired(req, res, next) {
  const payload = parseToken(req);
  if (!payload) {
    return res.status(401).json(fail('登录已失效，请重新登录', 401));
  }
  // 查库确认用户仍有效
  const user = await queryOne(
    'SELECT id, school_id, username, real_name, role, referee_id, is_active FROM user WHERE id = ?',
    [payload.id]
  );
  if (!user || user.is_active !== 1) {
    return res.status(401).json(fail('账号不存在或已停用', 401));
  }
  req.user = user;
  next();
}

/**
 * 角色校验中间件
 * @param {...number} roles 允许的角色，1教育局 2学校 3裁判
 */
function roleRequired(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json(fail('未登录', 401));
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json(fail('无权访问该资源', 403));
    }
    next();
  };
}

/**
 * 数据隔离：学校角色只能看自己的数据
 * 教育局角色 school_id = 0 表示全域
 */
function scopeSchoolId(req) {
  if (req.user.role === 1) {
    // 教育局可传 schoolId 过滤，不传则返回 null（表示全部）
    const q = req.query.schoolId;
    return q ? Number(q) : null;
  }
  return req.user.school_id;
}

module.exports = { signToken, parseToken, authRequired, roleRequired, scopeSchoolId, JWT_SECRET };
