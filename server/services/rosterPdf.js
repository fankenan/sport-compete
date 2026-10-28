/**
 * 运动员花名册 PDF 生成
 *
 * 版式（2026-10-26 按用户要求重做）：
 *   - 白底、黑色框线的普通表格，一行一个运动员
 *   - 列：序号 | 照片 | 学校 | 姓名 | 性别 | 班级 | 出生年月 | 号码
 *   - 所有学校连续排列（不分页、不加彩色学校条）
 *   - 每页重复表头
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { attachWatermark } = require('./watermark');

const FONT_DIR = path.join(__dirname, '..', 'fonts');
const FONT_BOLD = path.join(FONT_DIR, 'deng_bold.ttf');
const FONT_REGULAR = path.join(FONT_DIR, 'deng.ttf');

// A4 纵向（单位 pt）
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2; // 515.28

// 表格列（宽度合计 = CONTENT_W = 515.28）
const COLS = [
  { key: 'idx',         title: '序号',     w: 32,    align: 'center' },
  { key: 'photo',       title: '照片',     w: 56,    align: 'center', type: 'photo' },
  { key: 'school_name', title: '学校',     w: 120,   align: 'left'   },
  { key: 'name',        title: '姓名',     w: 55,    align: 'center' },
  { key: 'gender',      title: '性别',     w: 38,    align: 'center' },
  { key: 'class_name',  title: '班级',     w: 75,    align: 'center' },
  { key: 'birth',       title: '出生年月', w: 70,    align: 'center' },
  { key: 'bib_no',      title: '号码',     w: 69.28, align: 'center' }
];

const C_LINE = '#000000';
const C_TEXT = '#1a1a1a';
const C_MUTED = '#9a9a9a';

const ROW_H = 58;      // 照片行高
const HEADER_H = 26;
const PHOTO_W = 42;
const PHOTO_H = 50;

function hasFonts() {
  return fs.existsSync(FONT_BOLD) && fs.existsSync(FONT_REGULAR);
}

function genderText(g) {
  return Number(g) === 2 ? '女' : '男';
}

/**
 * data URL → Buffer
 */
function dataUrlToBuffer(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!m) return null;
  try {
    return Buffer.from(m[2], 'base64');
  } catch (e) {
    return null;
  }
}

/**
 * 单元格内画照片（水平垂直居中，等比缩放）
 */
function cellPhoto(doc, dataUrl, x, y, w, rowH) {
  const buf = dataUrlToBuffer(dataUrl);
  if (buf) {
    try {
      const img = doc.openImage(buf);
      const scale = Math.min((PHOTO_W - 4) / img.width, (PHOTO_H - 4) / img.height);
      const iw = img.width * scale;
      const ih = img.height * scale;
      doc.image(buf, x + (w - iw) / 2, y + (rowH - ih) / 2, { width: iw, height: ih });
      return;
    } catch (e) { /* 图片损坏按无照片处理 */ }
  }
  doc.fillColor(C_MUTED).font('cn').fontSize(8)
     .text('无照片', x, y + rowH / 2 - 4, { width: w, align: 'center', lineBreak: false });
}

/**
 * 在 (x,y) 处画单元格文字，垂直居中于行高 rowH
 */
function cellText(doc, text, x, y, w, rowH, { align = 'left', bold = false, size = 9 } = {}) {
  const str = text === null || text === undefined || String(text).trim() === '' ? '' : String(text);
  doc.fillColor(C_TEXT)
     .font(bold ? 'cnBold' : 'cn')
     .fontSize(size);
  const tw = doc.widthOfString(str);
  let tx = x + 5;
  if (align === 'center') tx = x + (w - tw) / 2;
  else if (align === 'right') tx = x + w - tw - 5;
  const ty = y + (rowH - size) / 2 + 1;
  // 超宽截断（简单省略号）
  const maxW = w - 10;
  if (tw > maxW && align === 'left') {
    doc.text(str, tx, ty, { width: maxW, ellipsis: true, lineBreak: false });
  } else {
    doc.text(str, tx, ty, { lineBreak: false });
  }
}

function drawTableHeader(doc, y) {
  let x = MARGIN;
  for (const c of COLS) {
    doc.lineWidth(0.8).strokeColor(C_LINE).rect(x, y, c.w, HEADER_H).stroke();
    cellText(doc, c.title, x, y, c.w, HEADER_H, { align: 'center', bold: true, size: 10 });
    x += c.w;
  }
  return y + HEADER_H;
}

function buildRosterPdf({ competitionName, rows, title }) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    info: {
      Title: title || `${competitionName}运动员名单`,
      Creator: '体育竞赛管理系统'
    }
  });

  if (hasFonts()) {
    doc.registerFont('cnBold', FONT_BOLD);
    doc.registerFont('cn', FONT_REGULAR);
  } else {
    doc.registerFont('cnBold', 'Helvetica-Bold');
    doc.registerFont('cn', 'Helvetica');
  }

  // 赛事水印：每页底层平铺，压低透明度不影响阅读
  attachWatermark(doc, competitionName, { font: 'cn' });

  const mainTitle = title || `${competitionName}运动员名单`;
  const data = rows || [];

  if (data.length === 0) {
    doc.fillColor(C_TEXT).font('cn').fontSize(12)
       .text('当前赛事还没有运动员名册数据。', MARGIN, 200, { width: CONTENT_W, align: 'center' });
    doc.end();
    return doc;
  }

  // 标题
  doc.fillColor(C_TEXT).font('cnBold').fontSize(16)
     .text(mainTitle, MARGIN, MARGIN, { width: CONTENT_W, align: 'center' });

  let y = MARGIN + 30;
  y = drawTableHeader(doc, y);

  for (let i = 0; i < data.length; i++) {
    // 换页：剩余空间不足一行时，先补表头
    if (y + ROW_H > PAGE_H - MARGIN) {
      doc.addPage({ size: 'A4', margin: 0 });
      y = MARGIN;
      y = drawTableHeader(doc, y);
    }
    const r = data[i];
    let x = MARGIN;
    doc.lineWidth(0.7).strokeColor(C_LINE);
    for (const c of COLS) {
      doc.rect(x, y, c.w, ROW_H).stroke();
      if (c.type === 'photo') {
        cellPhoto(doc, r.photo, x, y, c.w, ROW_H);
      } else {
        let v = r[c.key];
        if (c.key === 'idx') v = i + 1;
        else if (c.key === 'gender') v = genderText(r.gender);
        cellText(doc, v, x, y, c.w, ROW_H, { align: c.align });
      }
      x += c.w;
    }
    y += ROW_H;
  }

  doc.end();
  return doc;
}

module.exports = { buildRosterPdf, hasFonts, FONT_DIR };
