/**
 * 免登录公开接口（第四期 20 公开成绩查询页 + 21 大屏端拉数据）
 * 挂载 /api/public，全部只读，不校验 token
 * 只按 uuid 取数，不暴露任何账号、联系方式
 */
const express = require('express');
const { query, queryOne, ok, fail } = require('../db');

const router = express.Router();

function parseJson(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

async function compByUuid(uuid) {
  return queryOne(
    `SELECT id, uuid, name, year, start_date, end_date, host_unit, venue,
            public_flag, public_note, announce_show_school
       FROM competition WHERE uuid = ?`, [uuid]
  );
}

/**
 * GET /api/public/meet/:uuid
 * 公开成绩查询页：赛事信息 + 项目列表 + 各组别成绩
 */
router.get('/meet/:uuid', async (req, res, next) => {
  try {
    const comp = await compByUuid(req.params.uuid);
    if (!comp) return res.json(fail('赛事不存在或链接已失效'));
    if (Number(comp.public_flag) !== 1) return res.json(fail('该赛事未开放公开查询'));

    const events = await query(
      `SELECT id, name, event_type, event_unit, is_higher_better, result_decimal_places, sort_no
         FROM event_item WHERE competition_id = ? ORDER BY sort_no, id`, [comp.id]
    );

    const bands = await query(
      'SELECT id, label, stage, gender FROM group_band WHERE competition_id = ? ORDER BY sort_no, id',
      [comp.id]
    );

    // 每个项目每个组别的最好成绩榜（只取已确认赛次）
    const rows = await query(
      `SELECT he.event_item_id, he.band_id, he.athlete_name, he.school_id, he.school_name,
              he.rank_no, he.result_text, he.result_value, he.score, he.status_code,
              h.round_code, h.heat_no, h.heat_name
         FROM heat_entry he
         JOIN track_heat h ON h.id = he.heat_id
        WHERE he.competition_id = ? AND h.confirm_flag = 1
        ORDER BY he.event_item_id, he.band_id, h.round_no, COALESCE(he.rank_no, 999)`,
      [comp.id]
    );

    const byKey = new Map();
    for (const r of rows) {
      const k = `${r.event_item_id}:${r.band_id ?? ''}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(r);
    }

    const results = [];
    for (const ev of events) {
      for (const band of bands) {
        const list = byKey.get(`${ev.id}:${band.id}`) || [];
        if (!list.length) continue;
        const showSchool = Number(comp.announce_show_school) === 1;
        results.push({
          event_item_id: ev.id,
          event_name: ev.name,
          event_unit: ev.event_unit,
          band_id: band.id,
          band_label: band.label,
          rows: list.map((r) => ({
            rank: r.rank_no,
            name: r.athlete_name,
            school: showSchool ? r.school_name : null,
            result: r.status_code || r.result_text,
            score: r.score,
            heat: r.heat_name,
            round: r.round_code
          }))
        });
      }
    }

    res.json(ok({
      competition: {
        name: comp.name, year: comp.year,
        start_date: comp.start_date, end_date: comp.end_date,
        host_unit: comp.host_unit, venue: comp.venue, note: comp.public_note
      },
      events: events.map((e) => ({ id: e.id, name: e.name, event_type: e.event_type, event_unit: e.event_unit, sort_no: e.sort_no })),
      bands: bands.map((b) => ({ id: b.id, label: b.label })),
      results,
      updated_at: new Date().toISOString()
    }));
  } catch (e) { next(e); }
});

/**
 * GET /api/public/meet/:uuid/team-score
 * 公开页的团体总分（取第一个启用方案）
 */
router.get('/meet/:uuid/team-score', async (req, res, next) => {
  try {
    const comp = await compByUuid(req.params.uuid);
    if (!comp) return res.json(fail('赛事不存在'));
    const rule = await queryOne(
      'SELECT * FROM team_score_rule WHERE competition_id = ? AND status = 1 ORDER BY sort_no, id LIMIT 1',
      [comp.id]
    );
    if (!rule) return res.json(ok({ rule: null, rows: [] }));
    const rows = await query(
      `SELECT unit_name, unit_type, rank_no, total_score, grade_bonus, record_bonus,
              adjust_score, final_score, first_count, second_count, third_count
         FROM team_score_total WHERE rule_id = ?
        ORDER BY COALESCE(rank_no, 999), final_score DESC`, [rule.id]
    );
    res.json(ok({ rule: { id: rule.id, scheme_name: rule.scheme_name, scope_mode: rule.scope_mode }, rows }));
  } catch (e) { next(e); }
});

/**
 * GET /api/public/meet/:uuid/bracket?event_item_id=&band_id=
 * 公开页的淘汰赛对阵图（复用 schedule/bracket 的组装逻辑，免登录）
 */
router.get('/meet/:uuid/bracket', async (req, res, next) => {
  try {
    const comp = await compByUuid(req.params.uuid);
    if (!comp) return res.json(fail('赛事不存在'));
    const { event_item_id, band_id } = req.query;
    if (!event_item_id || !band_id) return res.json(fail('缺少参数'));

    const rows = await query(
      `SELECT m.id, m.stage, m.seq_no, m.score_a, m.score_b, m.status,
              m.team_a_id, m.team_b_id,
              ta.team_name AS team_a_name, sa.name AS school_a,
              tb.team_name AS team_b_name, sb.name AS school_b,
              ss.play_date, TIME_FORMAT(ss.start_time,'%H:%i') AS start_time,
              v.name AS venue_name
       FROM match_info m
       LEFT JOIN team_entry ta ON ta.id = m.team_a_id
       LEFT JOIN team_entry tb ON tb.id = m.team_b_id
       LEFT JOIN school sa ON sa.id = ta.school_id
       LEFT JOIN school sb ON sb.id = tb.school_id
       LEFT JOIN schedule_slot ss ON ss.id = m.slot_id
       LEFT JOIN venue v ON v.id = ss.venue_id
       WHERE m.competition_id = ? AND m.event_item_id = ? AND m.band_id = ?
         AND m.stage IN (2,3,5,6)
       ORDER BY m.stage, m.seq_no`,
      [comp.id, event_item_id, band_id]
    );

    const nameOf = (m, side) => {
      const t = side === 'a' ? m.team_a_name : m.team_b_name;
      const s = side === 'a' ? m.school_a : m.school_b;
      return t || s || '待定';
    };
    const decorate = (m) => ({
      id: m.id, stage: m.stage, seq_no: m.seq_no,
      team_a: nameOf(m, 'a'), team_b: nameOf(m, 'b'),
      team_a_id: m.team_a_id, team_b_id: m.team_b_id,
      score_a: m.score_a, score_b: m.score_b, status: m.status,
      winner_id:
        m.status === 1 && m.score_a != null && m.score_b != null && m.score_a !== m.score_b
          ? (m.score_a > m.score_b ? m.team_a_id : m.team_b_id)
          : null,
      play_date: m.play_date, start_time: m.start_time, venue: m.venue_name || ''
    });

    const byStage = new Map();
    for (const m of rows) {
      if (!byStage.has(m.stage)) byStage.set(m.stage, []);
      byStage.get(m.stage).push(decorate(m));
    }

    const rounds = [];
    if (byStage.has(2)) rounds.push({ stage: 2, label: '八进四', matches: byStage.get(2) });
    if (byStage.has(3)) rounds.push({ stage: 3, label: '半决赛', matches: byStage.get(3) });
    if (byStage.has(6)) rounds.push({ stage: 6, label: '三四名', matches: byStage.get(6), side: 'bottom' });
    if (byStage.has(5)) rounds.push({ stage: 5, label: '决赛', matches: byStage.get(5) });

    let champion = null;
    const finalM = byStage.get(5)?.[0];
    if (finalM && finalM.winner_id) {
      champion = finalM.winner_id === finalM.team_a_id ? finalM.team_a : finalM.team_b;
    }

    res.json(ok({ rounds, champion }));
  } catch (e) { next(e); }
});

/**
 * GET /api/public/screen/:uuid
 * 大屏端拉数据：主题、布局、队列、插播 + 各板块内容
 */
router.get('/screen/:uuid', async (req, res, next) => {
  try {
    const comp = await compByUuid(req.params.uuid);
    if (!comp) return res.json(fail('赛事不存在'));

    let cfg = await queryOne('SELECT * FROM screen_config WHERE competition_id = ?', [comp.id]);
    if (!cfg) {
      cfg = {
        theme: 'DARK', layout: 'MIXED', loop_flag: 1, dwell_seconds: 12,
        show_team_score: 1, show_latest: 1, show_upcoming: 1, show_record: 1,
        latest_count: 12, refresh_seconds: 30, insert_flag: 0, insert_text: null, insert_until: null
      };
    }

    // 插播到期自动关闭
    let insertFlag = Number(cfg.insert_flag) === 1;
    if (insertFlag && cfg.insert_until && new Date(cfg.insert_until) < new Date()) {
      insertFlag = false;
      await query('UPDATE screen_config SET insert_flag=0 WHERE competition_id=?', [comp.id]);
    }

    const latestCount = Number(cfg.latest_count) || 12;

    // 最新成绩（已确认赛次里最近更新的）
    const latest = Number(cfg.show_latest) === 1 ? await query(
      `SELECT he.id, he.athlete_name, he.school_name, he.rank_no, he.result_text,
              he.status_code, e.name AS event_name, e.event_unit,
              h.heat_name, h.confirm_flag, h.confirmed_at
         FROM heat_entry he
         JOIN track_heat h ON h.id = he.heat_id
         JOIN event_item e ON e.id = he.event_item_id
        WHERE he.competition_id = ? AND h.confirm_flag = 1
          AND (he.status_code IS NULL OR he.status_code = '')
        ORDER BY h.confirmed_at DESC, he.rank_no
        LIMIT ?`, [comp.id, latestCount]
    ) : [];

    // 破纪录滚动
    const records = Number(cfg.show_record) === 1 ? await query(
      `SELECT rb.athlete_name, rb.team_name AS school_name, rb.result_text, rb.old_value,
              rb.record_type, e.name AS event_name, e.event_unit
         FROM record_break rb
         LEFT JOIN event_item e ON e.id = rb.event_item_id
        WHERE rb.competition_id = ? AND rb.confirm_flag = 1
        ORDER BY rb.id DESC LIMIT 20`, [comp.id]
    ) : [];

    // 团体总分
    let teamScore = null;
    if (Number(cfg.show_team_score) === 1) {
      const rule = await queryOne(
        'SELECT id, scheme_name, scope_mode FROM team_score_rule WHERE competition_id = ? AND status = 1 ORDER BY sort_no, id LIMIT 1',
        [comp.id]
      );
      if (rule) {
        const rows = await query(
          `SELECT unit_name, rank_no, final_score, first_count, second_count, third_count
             FROM team_score_total WHERE rule_id = ?
            ORDER BY COALESCE(rank_no, 999) LIMIT 12`, [rule.id]
        );
        teamScore = { rule, rows };
      }
    }

    res.json(ok({
      competition: { name: comp.name, year: comp.year, venue: comp.venue },
      config: {
        theme: cfg.theme, layout: cfg.layout, loop_flag: cfg.loop_flag,
        dwell_seconds: cfg.dwell_seconds, refresh_seconds: cfg.refresh_seconds,
        queue: parseJson(cfg.queue_json, null),
        show_team_score: cfg.show_team_score, show_latest: cfg.show_latest,
        show_upcoming: cfg.show_upcoming, show_record: cfg.show_record
      },
      insert: insertFlag ? { text: cfg.insert_text, until: cfg.insert_until } : null,
      latest, records, teamScore,
      updated_at: new Date().toISOString()
    }));
  } catch (e) { next(e); }
});

module.exports = router;
