const crypto = require('crypto');

/**
 * SHA256 加盐哈希（与现有项目保持一致的做法：sha256(password + salt)）
 */
function hashPassword(password, salt = 'sport_compete') {
  return crypto.createHash('sha256').update(`${password}${salt}`).digest('hex');
}

/**
 * 校验密码
 */
function verifyPassword(password, stored) {
  return hashPassword(password) === stored;
}

/**
 * 生成随机密码（学校端初始密码）
 */
function randomPassword(len = 8) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[crypto.randomInt(0, chars.length)];
  }
  return out;
}

/**
 * 时间格式化为 HH:mm
 */
function toTimeStr(date) {
  if (!date) return null;
  if (typeof date === 'string') return date.slice(0, 5);
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * 加分钟
 */
function addMinutes(timeStr, minutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * 日期加减天数
 */
function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 组别显示名
 */
/**
 * 组别显示名
 * 库里存 stage(1小学/2初中/3高中) + gender(1男/2女) + label(如 "男高" "女初B")
 * 统一显示成：高中男子 / 小学女子 / 初中男子 A组
 */
function bandLabel(band) {
  if (!band) return '';

  const stage = { 1: '小学', 2: '初中', 3: '高中' }[band.stage] || '';
  const gender = { 1: '男子', 2: '女子' }[band.gender] || '';
  const raw = String(band.label || '').trim();

  // 已经是完整表述
  if (/^(小学|初中|高中)/.test(raw)) return raw;

  // 剥掉开头的性别字、学段字，剩下的是子组标识
  let sub = raw;
  for (let i = 0; i < 2; i++) {
    sub = sub.replace(/^[男女]/, '').replace(/^[小初高]/, '');
  }
  sub = sub.trim();

  if (!sub || /^[小初高男女]$/.test(sub)) {
    return `${stage}${gender}`;
  }

  const suffix = sub.endsWith('组') ? sub : `${sub}组`;
  return `${stage}${gender} ${suffix}`;
}

/**
 * 从身份证号推算出生年月
 * 18 位：第 7-14 位是 YYYYMMDD
 * 15 位（老证）：第 7-12 位是 YYMMDD，年份 00-29 记 20xx，30-99 记 19xx
 * @returns {{year:number, month:number, text:string}|null} text 形如 "2005年3月"
 */
function birthFromIdCard(idCard) {
  const s = String(idCard || '').trim().toUpperCase();
  if (!s) return null;

  let m = s.match(/^\d{6}(\d{4})(\d{2})\d{2}\d{3}[\dX]$/);
  if (!m) {
    m = s.match(/^\d{6}(\d{2})(\d{2})\d{2}\d{3}$/);
    if (m) {
      const yy = Number(m[1]);
      const year = yy <= 30 ? 2000 + yy : 1900 + yy;
      const month = Number(m[2]);
      if (month < 1 || month > 12) return null;
      return { year, month, text: `${year}年${month}月` };
    }
    return null;
  }

  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  if (year < 1900 || year > 2100) return null;
  return { year, month, text: `${year}年${month}月` };
}

/** 只取显示文本，无效返回空串 */
function birthText(idCard) {
  const b = birthFromIdCard(idCard);
  return b ? b.text : '';
}

module.exports = {
  hashPassword, verifyPassword, randomPassword,
  toTimeStr, addMinutes, addDays, bandLabel,
  birthFromIdCard, birthText
};
