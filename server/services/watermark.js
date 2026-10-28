/**
 * PDF 水印：在每页「底层」平铺半透明文字（赛事名称）
 *
 * 用法（必须在注册字体之后、写内容之前调用）：
 *   const doc = new PDFDocument(...);
 *   doc.registerFont('cn', FONT_REGULAR);
 *   attachWatermark(doc, competitionName, { font: 'cn' });
 *   ... 正常写内容 ...
 *
 * 实现要点：
 *   - 第一页手动画一次；后续每页靠 pageAdded 事件重画
 *   - 全部绘制包在 save/restore 里，画完把 doc.x / doc.y 还原，
 *     避免影响后续正常内容的排版位置
 *   - 透明度很低（默认 0.055），保证打印出来不干扰阅读
 */

function attachWatermark(doc, text, opts = {}) {
  const label = String(text || '').trim();
  if (!label) return null;

  const {
    font = 'cn',
    opacity = 0.055,
    fontSize = 30,
    color = '#1A1A1A',
    angle = -28
  } = opts;

  const draw = () => {
    const y0 = doc.y;
    const x0 = doc.x;
    const W = doc.page.width;
    const H = doc.page.height;

    doc.save();
    try { doc.opacity(opacity); } catch (e) { /* 旧版 pdfkit 无 opacity */ }
    doc.fillColor(color);
    try { doc.font(font); } catch (e) { /* 字体未注册时用当前字体 */ }
    doc.fontSize(fontSize);

    let textW = label.length * fontSize;
    try {
      const w = doc.widthOfString(label);
      if (w > 0) textW = w;
    } catch (e) { /* 忽略 */ }

    const stepX = Math.max(textW + 90, W * 0.52);
    const stepY = Math.max(H / 4, 160);

    let row = 0;
    for (let y = -stepY * 0.35; y < H + stepY; y += stepY) {
      const offset = row % 2 ? stepX / 2 : 0;
      for (let x = -stepX; x < W + stepX; x += stepX) {
        doc.save();
        doc.translate(x + offset, y);
        doc.rotate(angle);
        doc.text(label, 0, 0, { lineBreak: false });
        doc.restore();
      }
      row++;
    }

    doc.restore();
    doc.y = y0;
    doc.x = x0;
  };

  draw();                     // 第一页
  doc.on('pageAdded', draw);  // 之后每新增一页都补上
  return draw;
}

module.exports = { attachWatermark };
