/**
 * 大屏控制端（第四期 21）+ 免登录公开查询（第四期 20）
 *
 * 管理端：/api/screen-control/**  （需登录，role 1/3）
 * 大屏端：/api/public/screen/:uuid （免登录，只读）
 * 公开页：/api/public/meet/:uuid   （免登录，只读）
 */
const express = require('express');
const { query, queryOne, execute, ok, fail } = require('../db');
const { authRequired, roleRequired } = require('../middleware/auth');

const router = express.Router();

const DEFAULT_CONFIG = {
  theme: 'DARK', layout: 'MIXED', queue_json: null,
  loop_flag: 1, dwell_seconds: 12,
  show_team_score: 1, show_latest: 1, show_upcoming: 1, show_record: 1,
  latest_count: 12, refresh_seconds: 30,
  insert_flag: 0, insert_text: null, insert_until: null
};

function parseJson(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

// ============================================================
// 管理端
// ============================================================
router.use(authRequired);

/** GET /api/screen-control/config?competition_id= */
router.get('/config', async (req, res, next) => {
  try {
    let c = await queryOne('SELECT * FROM screen_config WHERE competition_id = ?', [req.query.competition_id]);
    if (!c) c = { ...DEFAULT_CONFIG, competition_id: Number(req.query.competition_id) };
    res.json(ok({ ...c, queue_json: parseJson(c.queue_json, null) }));
  } catch (e) { next(e); }
});

/** PUT /api/screen-control/config */
router.put('/config', roleRequired(1), async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.competition_id) return res.json(fail('缺少赛事 id'));
    const exist = await queryOne('SELECT id FROM screen_config WHERE competition_id = ?', [b.competition_id]);
    const payload = [
      b.competition_id,
      b.theme || 'DARK',
      b.layout || 'MIXED',
      JSON.stringify(b.queue_json ?? null),
      b.loop_flag ?? 1,
      Number(b.dwell_seconds) || 12,
      b.show_team_score ?? 1, b.show_latest ?? 1, b.show_upcoming ?? 1, b.show_record ?? 1,
      Number(b.latest_count) || 12,
      Number(b.refresh_seconds) || 30,
      b.insert_flag ?? 0,
      b.insert_text ?? null,
      b.insert_until || null
    ];
    if (exist) {
      await execute(
        `UPDATE screen_config SET competition_id=?, theme=?, layout=?, queue_json=?,
          loop_flag=?, dwell_seconds=?, show_team_score=?, show_latest=?, show_upcoming=?,
          show_record=?, latest_count=?, refresh_seconds=?, insert_flag=?, insert_text=?, insert_until=?
         WHERE id=?`, [...payload, exist.id]
      );
    } else {
      await execute(
        `INSERT INTO screen_config
          (competition_id, theme, layout, queue_json, loop_flag, dwell_seconds,
           show_team_score, show_latest, show_upcoming, show_record,
           latest_count, refresh_seconds, insert_flag, insert_text, insert_until)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, payload
      );
    }
    res.json(ok(null, '大屏配置已保存'));
  } catch (e) { next(e); }
});

/** POST /api/screen-control/insert 插播 */
router.post('/insert', roleRequired(1), async (req, res, next) => {
  try {
    const { competition_id, insert_text, minutes } = req.body;
    if (!insert_text) return res.json(fail('请填写插播内容'));
    const mins = Number(minutes) || 5;
    const until = new Date(Date.now() + mins * 60000);
    const exist = await queryOne('SELECT id FROM screen_config WHERE competition_id = ?', [competition_id]);
    const sql = 'UPDATE screen_config SET insert_flag=1, insert_text=?, insert_until=? WHERE competition_id=?';
    const p = [insert_text, until, competition_id];
    if (!exist) {
      await execute(
        `INSERT INTO screen_config (competition_id, insert_flag, insert_text, insert_until)
         VALUES (?,1,?,?)`, [competition_id, insert_text, until]
      );
    } else {
      await execute(sql, p);
    }
    res.json(ok({ until }, `插播已开启，${mins} 分钟后自动关闭`));
  } catch (e) { next(e); }
});

/** POST /api/screen-control/insert/clear 关闭插播 */
router.post('/insert/clear', roleRequired(1), async (req, res, next) => {
  try {
    await execute(
      'UPDATE screen_config SET insert_flag=0, insert_text=NULL, insert_until=NULL WHERE competition_id=?',
      [req.body.competition_id]
    );
    res.json(ok(null, '插播已关闭'));
  } catch (e) { next(e); }
});

/** GET /api/screen-control/queue-items?competition_id= 可选播放项（项目×组别） */
router.get('/queue-items', async (req, res, next) => {
  try {
    const cid = req.query.competition_id;
    const rows = await query(
      `SELECT h.event_item_id, e.name AS event_name, h.band_id, gb.label AS band_label,
              COUNT(DISTINCT h.id) AS heat_count,
              SUM(h.confirm_flag) AS confirmed_count
         FROM track_heat h
         JOIN event_item e ON e.id = h.event_item_id
         LEFT JOIN group_band gb ON gb.id = h.band_id
        WHERE h.competition_id = ?
        GROUP BY h.event_item_id, e.name, h.band_id, gb.label
        ORDER BY e.sort_no, h.band_id`, [cid]
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

module.exports = router;
