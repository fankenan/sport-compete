/**
 * 图片上传
 *
 * POST /api/upload/photo   （multipart/form-data，字段名 file）
 *   - 只收图片，单张上限 5MB
 *   - 存到 server/uploads/，返回 { url: '/uploads/xxx.jpg' }
 *     url 由同源的后端静态服务提供，前端直接用即可
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { ok, fail } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_SIZE = 5 * 1024 * 1024;   // 5MB

const ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = ALLOWED[file.mimetype] || path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const name = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED[file.mimetype]) {
      return cb(new Error('只能上传 JPG / PNG / WEBP / GIF 图片'));
    }
    cb(null, true);
  }
});

router.post('/photo', authRequired, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.json(fail('图片超过 5MB，请压缩后再上传'));
      return res.json(fail(err.message || '上传失败'));
    }
    if (!req.file) return res.json(fail('没有收到图片'));
    res.json(ok({ url: `/uploads/${req.file.filename}`, size: req.file.size }, '上传成功'));
  });
});

module.exports = router;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
