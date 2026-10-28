/**
 * 秩序册 PDF 生成
 *
 * 章节顺序与内容完全对齐前端 buildOrderHtml：
 *   封面 / 竞赛规程 / 组织机构 / 参赛单位名单 / 运动员名单 /
 *   竞赛日程 / 分组名单 / 纪录一览 / 注意事项
 *
 * 全文带赛事水印（复用 services/watermark.js），末尾加页码。
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { attachWatermark } = require('./watermark');

const FONT_DIR = path.join(__dirname, '..', 'fonts');
const FONT_BOLD = path.join(FONT_DIR, 'deng_bold.ttf');
const FONT_REGULAR = path.join(FONT_DIR, 'deng.ttf');
const hasFonts = () => fs.existsSync(FONT_REGULAR) && fs.existsSync(FONT_BOLD);

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;
const CONTENT_W = PAGE_W - MARGIN * 2;

const C_TEXT = '#1A1A1A';
const C_SUB = '#555555';
const C_LINE = '#999999';
const C_HEAD_BG = '#EEF2F9';
const C_BRAND = '#0052D9';

const PERIOD = { AM: '上午', PM: '下午' };
const ROUND = {
  PRELIM: '预赛', SEMI: '复赛', FINAL: '决赛', HEAT: '预赛',
  SEMIFINAL: '复赛', FINAL_ONLY: '决赛', TIMED_FINAL: '决赛'
};

function pad(n) { return String(n).padStart(2, '0'); }

/** 剩余空间不足就换页 */
function ensure(doc, h) {
  if (doc.y + h > PAGE_H - MARGIN - 22) {
    doc.addPage();
  }
}

function sectionTitle(doc, text) {
  ensure(doc, 52);
  const y = doc.y + 6;
  doc.save();
  doc.rect(MARGIN, y + 2, 3.5, 15).fill(C_BRAND);
  doc.restore();
  doc.fillColor(C_TEXT).font('cnBold').fontSize(14)
     .text(text, MARGIN + 11, y, { width: CONTENT_W - 11 });
  doc.y = y + 26;
}

function subTitle(doc, text) {
  ensure(doc, 30);
  const y = doc.y + 2;
  doc.fillColor(C_TEXT).font('cnBold').fontSize(10.5).text(text, MARGIN, y, { width: CONTENT_W });
  doc.y = y + 18;
}

/** 键值表（两列） */
function kvTable(doc, pairs) {
  const colW = [CONTENT_W * 0.3, CONTENT_W * 0.7];
  drawTable(doc, [{ title: '项目', width: colW[0] }, { title: '内容', width: colW[1] }],
    pairs.map(([k, v]) => [k, v == null || v === '' ? '—' : String(v)]), { fontSize: 10 });
}

/** 通用表格，自动分页并重复表头 */
function drawTable(doc, cols, rows, opts = {}) {
  const fontSize = opts.fontSize || 9;
  const padX = 5;
  const padY = 5;
  const minRowH = opts.minRowH || 21;
  const totalW = cols.reduce((s, c) => s + c.width, 0);

  const drawHeader = () => {
    const y = doc.y;
    doc.save();
    doc.rect(MARGIN, y, totalW, minRowH).fill(C_HEAD_BG);
    doc.restore();
    doc.fillColor(C_TEXT).font('cnBold').fontSize(fontSize);
    let x = MARGIN;
    cols.forEach((c) => {
      doc.text(c.title, x + padX, y + padY + 1, {
        width: c.width - padX * 2, align: c.align || 'left', lineBreak: false, ellipsis: true
      });
      doc.strokeColor(C_LINE).lineWidth(0.6).rect(x, y, c.width, minRowH).stroke();
      x += c.width;
    });
    doc.y = y + minRowH;
  };

  drawHeader();

  if (!rows.length) {
    const y = doc.y;
    doc.fillColor(C_SUB).font('cn').fontSize(fontSize)
       .text('（本章暂无数据）', MARGIN + padX, y + padY, { width: totalW - padX * 2 });
    doc.y = y + minRowH;
    return;
  }

  doc.font('cn').fontSize(fontSize);
  for (const row of rows) {
    // 按内容算行高
    let contentH = 0;
    cols.forEach((c, i) => {
      const h = doc.heightOfString(String(row[i] ?? ''), { width: c.width - padX * 2, lineBreak: true });
      contentH = Math.max(contentH, h);
    });
    const rowH = Math.max(minRowH, contentH + padY * 2);

    if (doc.y + rowH > PAGE_H - MARGIN - 22) {
      doc.addPage();
      drawHeader();
      doc.font('cn').fontSize(fontSize);
    }

    const y = doc.y;
    let x = MARGIN;
    cols.forEach((c, i) => {
      const text = String(row[i] ?? '');
      doc.fillColor(C_TEXT).font('cn').fontSize(fontSize)
         .text(text, x + padX, y + padY, { width: c.width - padX * 2, align: c.align || 'left' });
      doc.strokeColor(C_LINE).lineWidth(0.6).rect(x, y, c.width, rowH).stroke();
      x += c.width;
    });
    doc.y = y + rowH;
  }
}

/** 注意事项：有序列表 */
function noticeList(doc, items) {
  doc.font('cn').fontSize(10.5).fillColor(C_TEXT);
  items.forEach((t, i) => {
    ensure(doc, 30);
    const y = doc.y;
    const h = doc.heightOfString(t, { width: CONTENT_W - 22, lineBreak: true });
    doc.text(`${i + 1}.`, MARGIN + 2, y, { width: 20 });
    doc.text(t, MARGIN + 22, y, { width: CONTENT_W - 22 });
    doc.y = y + Math.max(h, 15) + 6;
  });
}

function buildOrderBookPdf({ book, data }) {
  const c = (data && data.competition) || {};
  const title = (book && book.title) || c.name || '秩序册';

  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    bufferPages: true,
    info: { Title: title, Creator: '体育竞赛管理系统' }
  });

  if (hasFonts()) {
    doc.registerFont('cnBold', FONT_BOLD);
    doc.registerFont('cn', FONT_REGULAR);
  } else {
    doc.registerFont('cnBold', 'Helvetica-Bold');
    doc.registerFont('cn', 'Helvetica');
  }

  // 水印：赛事全称，每页底层平铺
  attachWatermark(doc, c.name || title, { font: 'cn', opacity: 0.05 });

  const sections = ((book && book.sections_json) || [])
    .filter((s) => Number(s.enabled) === 1)
    .sort((a, b) => (Number(a.sort_no) || 0) - (Number(b.sort_no) || 0));

  const list = sections.length ? sections : [{ code: 'COVER' }];

  for (const s of list) {
    switch (s.code) {
      case 'COVER': {
        doc.y = MARGIN + 150;
        doc.fillColor(C_TEXT).font('cnBold').fontSize(30)
           .text(title, MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
        if (book && book.subtitle) {
          doc.moveDown(0.6);
          doc.fillColor(C_SUB).font('cn').fontSize(14)
             .text(book.subtitle, MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
        }
        if (book && book.cover_note) {
          doc.moveDown(1.2);
          doc.fillColor(C_SUB).font('cn').fontSize(11)
             .text(book.cover_note, MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
        }
        doc.moveDown(3);
        const infoY = doc.y;
        doc.fillColor(C_SUB).font('cn').fontSize(11);
        const lines = [];
        if (c.host_unit) lines.push(`主办单位：${c.host_unit}`);
        if (c.venue) lines.push(`比赛地点：${c.venue}`);
        if (c.start_date) lines.push(`比赛时间：${c.start_date} 至 ${c.end_date || ''}`);
        lines.forEach((t, i) => {
          doc.text(t, MARGIN, infoY + i * 20, { width: CONTENT_W, align: 'center' });
        });
        doc.addPage();
        break;
      }

      case 'REGULATION': {
        sectionTitle(doc, '竞赛规程');
        kvTable(doc, [
          ['赛事名称', c.name],
          ['主办单位', c.host_unit],
          ['比赛地点', c.venue],
          ['比赛时间', c.start_date ? `${c.start_date} 至 ${c.end_date || ''}` : ''],
          ['直道 / 弯道', `${c.straight_lane_count || 8} / ${c.curve_lane_count || 8} 道`],
          ['最小休息间隔', `${c.minimum_rest_minutes || 30} 分钟`],
          ['联系人', `${c.contact_person || ''} ${c.contact_phone || ''}`.trim()]
        ]);
        doc.moveDown(0.8);
        break;
      }

      case 'ORGANIZATION': {
        sectionTitle(doc, '组织机构');
        kvTable(doc, [
          ['主办单位', c.host_unit],
          ['比赛地点', c.venue]
        ]);
        doc.moveDown(0.8);
        break;
      }

      case 'SCHOOL_LIST': {
        sectionTitle(doc, '参赛单位名单');
        drawTable(doc,
          [{ title: '序号', width: 60, align: 'center' }, { title: '单位名称', width: CONTENT_W - 60 }],
          (data.schools || []).map((s2, i) => [i + 1, s2.name]),
          { fontSize: 10 });
        doc.moveDown(0.8);
        break;
      }

      case 'ATHLETE_LIST': {
        sectionTitle(doc, '运动员名单');
        const cols = [
          { title: '序号', width: 38, align: 'center' },
          { title: '姓名', width: 70 },
          { title: '单位', width: 150 },
          { title: '组别', width: 72 },
          { title: '班级', width: 80 },
          { title: '参赛项目', width: CONTENT_W - 38 - 70 - 150 - 72 - 80 }
        ];
        drawTable(doc, cols,
          (data.athletes || []).map((a, i) => [i + 1, a.name, a.school_name, a.band_label || '', a.class_name || '', a.events || '']),
          { fontSize: 8.5, minRowH: 20 });
        doc.moveDown(0.8);
        break;
      }

      case 'TIMETABLE': {
        sectionTitle(doc, '竞赛日程');
        drawTable(doc, [
          { title: '日期', width: 78 },
          { title: '时段', width: 46, align: 'center' },
          { title: '时间', width: 46, align: 'center' },
          { title: '项目', width: CONTENT_W - 78 - 46 - 46 - 90 },
          { title: '场地', width: 90 }
        ], (data.timetable || []).map((t) => [
          t.unit_date || '',
          PERIOD[t.period] || '',
          (t.start_time || '').slice(0, 5),
          t.title || t.event_name || '',
          t.venue_name || ''
        ]), { fontSize: 8.5, minRowH: 20 });
        doc.moveDown(0.8);
        break;
      }

      case 'HEAT_LIST': {
        sectionTitle(doc, '分组名单');
        const heats = data.heats || [];
        if (!heats.length) {
          doc.fillColor(C_SUB).font('cn').fontSize(10).text('（尚未编排赛次）', MARGIN, doc.y);
          doc.moveDown(1);
        }
        for (const h of heats) {
          const head = `${h.band_label || ''}${h.event_name || ''} ${ROUND[h.round_code] || ''}`
            + (h.heat_no ? ` 第${h.heat_no}组` : '');
          ensure(doc, 70);
          subTitle(doc, head);
          drawTable(doc, [
            { title: '道次', width: 54, align: 'center' },
            { title: '姓名', width: 90 },
            { title: '单位', width: CONTENT_W - 54 - 90 - 70 },
            { title: '号码', width: 70, align: 'center' }
          ], (h.entries || []).map((e) => [
            e.lane_no ?? e.sort_no ?? '', e.athlete_name || '', e.school_name || '', e.bib_no ?? ''
          ]), { fontSize: 8.5, minRowH: 19 });
          doc.moveDown(0.5);
        }
        doc.moveDown(0.4);
        break;
      }

      case 'RECORD': {
        sectionTitle(doc, '纪录一览');
        drawTable(doc, [
          { title: '项目', width: 96 },
          { title: '组别', width: 78 },
          { title: '赛会纪录', width: 78, align: 'center' },
          { title: '保持者', width: CONTENT_W - 96 - 78 - 78 - 80 - 80 },
          { title: '最高纪录', width: 80, align: 'center' },
          { title: '保持者', width: 80 }
        ], (data.records || []).map((r) => [
          r.event_name || '', r.band_label || '',
          r.meet_record_value || '—', r.meet_record_holder || '',
          r.highest_record_value || '—', r.highest_record_holder || ''
        ]), { fontSize: 8.5, minRowH: 20 });
        doc.moveDown(0.8);
        break;
      }

      case 'NOTICE': {
        sectionTitle(doc, '注意事项');
        noticeList(doc, [
          '各参赛单位须于赛前 30 分钟到检录处检录，三次点名不到者按弃权处理。',
          '运动员须佩戴号码簿，服装、钉鞋须符合田径竞赛规则。',
          '径赛项目不得串道、不得带跑，违者取消该项比赛资格。',
          '田赛项目试跳（掷）次数按规程执行，无故延误按失败计。',
          '对成绩有异议须在该项比赛结束后 30 分钟内向仲裁委员会书面提出。',
          '兼项冲突时，运动员须向检录处报告，由裁判长按最小休息间隔协调。'
        ]);
        break;
      }

      default:
        break;
    }
  }

  // 页码
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.fillColor('#999999').font('cn').fontSize(8)
       .text(`${i + 1} / ${range.count}`, MARGIN, PAGE_H - MARGIN + 6, {
         width: CONTENT_W, align: 'center', lineBreak: false
       });
  }
  doc.switchToPage(range.start + range.count - 1);

  doc.end();
  return doc;
}

module.exports = { buildOrderBookPdf, hasFonts };
