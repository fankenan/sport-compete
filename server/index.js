const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4100;

// 关闭 ETag：API 响应绝不能被浏览器缓存。
// 一旦返回 304，nginx / CDN 可能丢弃 CORS 头，
// 浏览器会判定跨域失败，导致后续 POST 请求根本不发出（表现为"无法连接服务器"）
app.set('etag', false);
app.disable('x-powered-by');

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Disposition'],
  maxAge: 86400
}));

// 所有响应禁用缓存
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// 请求日志
app.use((req, res, next) => {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}] ${req.method} ${req.url}`);
  next();
});

// 公开路由（免登录）：赛事大屏 + 公开成绩查询页，拿到链接即可查看
app.use('/api/screen', require('./routes/screen'));
console.log('  路由挂载 /api/screen（公开）');
app.use('/api/public', require('./routes/publicMeet'));
console.log('  路由挂载 /api/public（公开）');

// 路由
const routes = [
  'auth', 'school', 'competition', 'event', 'band', 'venue',
  'entry', 'group', 'schedule', 'referee', 'result', 'rank', 'stats', 'track',
  'upload'
];
routes.forEach((r) => {
  const p = path.join(__dirname, 'routes', `${r}.js`);
  if (fs.existsSync(p)) {
    app.use(`/api/${r}`, require(p));
    console.log(`  路由挂载 /api/${r}`);
  }
});

// 挂载路径与文件名不一致的路由（连字符）
const aliasRoutes = [
  ['/api/track-result', 'trackResult'],
  ['/api/track-race', 'trackRace'],
  ['/api/track-stats', 'trackStats'],
  ['/api/screen-control', 'screenControl'],
  ['/api/track-plan', 'trackPlan'],
  ['/api/sport-activity', 'sportActivity']
];
aliasRoutes.forEach(([mount, file]) => {
  const p = path.join(__dirname, 'routes', `${file}.js`);
  if (fs.existsSync(p)) {
    app.use(mount, require(p));
    console.log(`  路由挂载 ${mount}`);
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ code: 0, message: 'ok', data: { time: new Date().toISOString() } });
});

// 上传的图片（体育活动上报等），由同源静态服务提供
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// 静态托管（前端构建产物，可选）
const distDir = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// 错误处理
app.use((err, req, res, next) => {
  console.error('[错误]', err);
  res.status(500).json({
    code: 500,
    message: err.message || '服务器内部错误',
    data: null
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`体育竞赛管理系统后端已启动 → http://0.0.0.0:${PORT}`);
});
