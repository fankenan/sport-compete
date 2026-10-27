/**
 * 组别显示名统一规则
 *
 * 库里存 stage(1小学/2初中/3高中) + gender(1男/2女) + label(如 "男高" "女初B" "A")
 * 显示统一成：高中男子 / 小学女子 / 初中男子 A组
 */

const STAGE_MAP = { 1: '小学', 2: '初中', 3: '高中' };
const GENDER_MAP = { 1: '男子', 2: '女子' };

/**
 * 从 label 中取出「分组」标识（A / B / 1 / 二队…）
 * 剥掉开头的性别字和学段字，剩下的就是分组
 * @returns {string} 空字符串表示没有分组
 */
export function bandSub(b) {
  if (!b) return '';
  const raw = String(b.label || '').trim();
  if (!raw) return '';

  // 完整格式：高中男子 A组 → 取 A组
  if (/^(小学|初中|高中)/.test(raw)) {
    const m = raw.match(/^(?:小学|初中|高中)(?:男子|女子)\s*(.+)$/);
    return (m ? m[1] : '').trim();
  }

  let sub = raw;
  for (let i = 0; i < 2; i++) {
    sub = sub.replace(/^[男女]/, '').replace(/^[小初高]/, '');
  }
  sub = sub.trim();

  if (!sub || /^[小初高男女]$/.test(sub)) return '';
  return sub;
}

/**
 * 组别完整显示名
 * @param {{stage:number, gender:number, label?:string}} b
 * @returns {string} 如 "高中男子"、"小学女子 A组"
 */
export function bandLabel(b) {
  if (!b) return '';

  const stage = STAGE_MAP[b.stage] || '';
  const gender = GENDER_MAP[b.gender] || '';
  const raw = String(b.label || '').trim();

  // 已经是完整表述，原样用
  if (/^(小学|初中|高中)/.test(raw)) return raw;

  const sub = bandSub(b);
  return sub ? `${stage}${gender} ${sub}${sub.endsWith('组') ? '' : '组'}` : `${stage}${gender}`;
}

/**
 * 短名，用于空间很窄的地方（表格小徽标）
 * @returns {string} 如 "高中男"、"小女"
 */
export function bandShort(b) {
  if (!b) return '';
  const stage = { 1: '小', 2: '初', 3: '高' }[b.stage] || '';
  const gender = { 1: '男', 2: '女' }[b.gender] || '';
  return `${stage}${gender}`;
}

export { STAGE_MAP, GENDER_MAP };
