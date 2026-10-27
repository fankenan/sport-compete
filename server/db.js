const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'compete',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'sport_compete',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: '+08:00',
  dateStrings: true
});

/**
 * 查询多行
 */
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/**
 * 查询单行
 */
async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

/**
 * 执行写入，返回 insertId / affectedRows
 */
async function execute(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

/**
 * 事务包装
 */
async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * 统一响应包装
 */
function ok(data = null, message = 'success') {
  return { code: 0, message, data };
}

function fail(message = '操作失败', code = 400) {
  return { code, message, data: null };
}

module.exports = { pool, query, queryOne, execute, transaction, ok, fail };
