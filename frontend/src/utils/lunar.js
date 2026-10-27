import { Solar } from 'lunar-javascript';

const WEEK_CN = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const WEEK_SHORT = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 取某天的农历描述
 * 优先级：公历节日 > 农历节日 > 节气 > 农历月名（初一） > 农历日
 */
export function getLunarInfo(date) {
  const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const lunar = solar.getLunar();

  const solarFestivals = solar.getFestivals() || [];
  const lunarFestivals = lunar.getFestivals() || [];
  const jieQi = lunar.getJieQi() || '';

  let text = '';
  let kind = 'day';

  if (solarFestivals.length) {
    text = solarFestivals[0];
    kind = 'festival';
  } else if (lunarFestivals.length) {
    text = lunarFestivals[0];
    kind = 'festival';
  } else if (jieQi) {
    text = jieQi;
    kind = 'jieqi';
  } else {
    const dayCn = lunar.getDayInChinese();
    if (dayCn === '初一') {
      text = lunar.getMonthInChinese() + '月';
      kind = 'month';
    } else {
      text = dayCn;
      kind = 'day';
    }
  }

  return {
    text,
    kind,
    lunarDay: lunar.getDayInChinese(),
    lunarMonth: lunar.getMonthInChinese(),
    lunarMonthNum: Math.abs(lunar.getMonth()),
    lunarDayNum: lunar.getDay(),
    isLeap: lunar.getMonth() < 0,
    lunarYear: lunar.getYearInGanZhi(),
    shengXiao: lunar.getYearShengXiao(),
    full: `农历${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`
  };
}

/**
 * 输入框显示文本：2026年10月26日 星期日
 */
export function formatDateCn(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_CN[d.getDay()]}`;
}

/**
 * 完整显示：2026年10月26日 星期日 · 农历九月十七
 */
export function formatWithLunar(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const lunar = getLunarInfo(d);
  return `${formatDateCn(d)} · ${lunar.full}`;
}

/**
 * 解析 YYYY-MM-DD → Date（本地时区，避免 UTC 偏移）
 */
export function parseDate(str) {
  if (!str) return null;
  if (str instanceof Date) return str;
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Date → YYYY-MM-DD
 */
export function toDateStr(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : parseDate(date);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export { WEEK_CN, WEEK_SHORT };
