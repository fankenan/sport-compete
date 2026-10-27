/**
 * 参赛证 PDF 生成
 *
 * 版式（参考用户模板）：A4 纵向，2×2 排布 4 张参赛证
 * 每张证：
 *   - 赛事名称（加粗居中，顶部）
 *   - 「参 赛 证」大字（加粗、字距拉开、居中）
 *   - 左侧照片框，右侧 姓名 / 组别 / 项目（下划线）
 *   - 底部 出生年月 / 号码（同一行）、参赛单位
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const FONT_DIR = path.join(__dirname, '..', 'fonts');
const FONT_BOLD = path.join(FONT_DIR, 'deng_bold.ttf');
const FONT_REGULAR = path.join(FONT_DIR, 'deng.ttf');

// A4 纵向（单位 pt）
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;
const GAP = 22;
const CARD_W = (PAGE_W - MARGIN * 2 - GAP) / 2;   // ≈ 244.6
const CARD_H = (PAGE_H - MARGIN * 2 - GAP) / 2;   // ≈ 368

const C_TEXT = '#1a1a1a';
const C_MUTED = '#444444';
const C_LINE = '#333333';
const C_BORDER = '#2a2a2a';
const C_PHOTO_BOX = '#d9d9d9';

function hasFonts() {
  return fs.existsSync(FONT_BOLD) && fs.existsSync(FONT_REGULAR);
}

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
 * 画「标签：____值____」结构，值下画下划线
 * @returns {number} 行尾 x
 */
function labelValue(doc, x, y, label, value, maxW, fontSize = 10.5) {
  doc.fillColor(C_TEXT).font('cn').fontSize(fontSize)
     .text(label, x, y, { lineBreak: false, characterSpacing: 0.5 });
  const labelW = doc.widthOfString(label);
  const ux = x + labelW + 3;
  const uw = Math.max(20, maxW - labelW - 3);
  const uy = y + fontSize + 2.5;

  if (value) {
    doc.font('cnBold').fillColor(C_TEXT);
    // 值太长就缩字号
    let vSize = fontSize;
    let vW = doc.widthOfString(String(value));
    while (vW > uw - 2 && vSize > 6.5) {
      vSize -= 0.5;
      doc.fontSize(vSize);
      vW = doc.widthOfString(String(value));
    }
    if (vW <= uw - 2) {
      // 值在下划线区域内水平居中
      const vx = ux + (uw - vW) / 2;
      doc.text(String(value), vx, y - 0.5, { lineBreak: false });
    } else {
      doc.fontSize(fontSize).text(String(value), ux, y - 0.5, {
        lineBreak: false, width: uw, ellipsis: true
      });
      doc.fontSize(fontSize);
    }
  }

  doc.lineWidth(0.7).strokeColor(C_LINE)
     .moveTo(ux, uy).lineTo(ux + uw, uy).stroke();
  return ux + uw;
}

/**
 * 画一张参赛证
 */
function drawCard(doc, x, y, card) {
  // 外框
  doc.lineWidth(0.9).strokeColor(C_BORDER).rect(x, y, CARD_W, CARD_H).stroke();

  const padX = 16;

  // 顶部：赛事名称（超长缩字号）
  let nameSize = 12;
  doc.font('cnBold').fontSize(nameSize);
  let nameStr = String(card.compName || '');
  while (doc.widthOfString(nameStr) > CARD_W - padX * 2 && nameSize > 8) {
    nameSize -= 0.5;
    doc.fontSize(nameSize);
  }
  doc.fillColor(C_TEXT).text(nameStr, x, y + 14, {
    width: CARD_W, align: 'center', lineBreak: false
  });

  // 「参 赛 证」大字
  doc.font('cnBold').fontSize(19).fillColor(C_TEXT)
     .text('参  赛  证', x, y + 36, { width: CARD_W, align: 'center', lineBreak: false });

  // 照片框
  const phX = x + padX;
  const phY = y + 72;
  const phW = 66;
  const phH = 88;
  doc.lineWidth(0.8).strokeColor(C_PHOTO_BOX).rect(phX, phY, phW, phH).stroke();

  const buf = dataUrlToBuffer(card.photo);
  if (buf) {
    try {
      const img = doc.openImage(buf);
      const scale = Math.min((phW - 4) / img.width, (phH - 4) / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      doc.image(buf, phX + (phW - w) / 2, phY + (phH - h) / 2, { width: w, height: h });
    } catch (e) { /* 图片损坏忽略 */ }
  } else {
    doc.fillColor('#c0c0c0').font('cn').fontSize(13)
       .text('照 片', phX, phY + phH / 2 - 9, { width: phW, align: 'center', lineBreak: false });
  }

  // 右侧信息：姓名 / 组别 / 项目
  const infoX = phX + phW + 14;
  const infoW = x + CARD_W - padX - infoX;
  let iy = phY + 4;
  const lineGap = 27;

  labelValue(doc, infoX, iy, '姓名：', card.name, infoW);
  iy += lineGap;
  labelValue(doc, infoX, iy, '组别：', card.band || '', infoW);
  iy += lineGap;
  labelValue(doc, infoX, iy, '项目：', card.events || '', infoW);

  // 底部：出生年月 + 号码（同一行）
  const by = y + CARD_H - 78;
  const halfW = (CARD_W - padX * 2) * 0.55;
  labelValue(doc, x + padX, by, '出生年月：', card.birth || '', halfW, 10);
  labelValue(doc, x + padX + halfW + 8, by, '号码：', card.bib || '', CARD_W - padX * 2 - halfW - 8, 10);

  // 参赛单位
  labelValue(doc, x + padX, by + 30, '参赛单位：', card.unit || '', CARD_W - padX * 2, 10);
}

/**
 * 生成参赛证 PDF
 * @param {object} opt
 * @param {string} opt.competitionName 赛事名称
 * @param {Array}  opt.cards [{ name, band, events, birth, bib, unit, photo }]
 */
function buildBadgePdf({ competitionName, cards }) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    info: {
      Title: `${competitionName}参赛证`,
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

  if (!cards || cards.length === 0) {
    doc.fillColor(C_TEXT).font('cn').fontSize(12)
       .text('当前赛事没有可打印参赛证的运动员。', MARGIN, 200, {
         width: PAGE_W - MARGIN * 2, align: 'center'
       });
    doc.end();
    return doc;
  }

  for (let i = 0; i < cards.length; i++) {
    const pos = i % 4; // 页内位置 0..3
    if (i > 0 && pos === 0) doc.addPage({ size: 'A4', margin: 0 });

    const col = pos % 2;
    const row = Math.floor(pos / 2);
    const x = MARGIN + col * (CARD_W + GAP);
    const y = MARGIN + row * (CARD_H + GAP);
    drawCard(doc, x, y, cards[i]);
  }

  doc.end();
  return doc;
}

module.exports = { buildBadgePdf, hasFonts };
