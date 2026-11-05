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
      `SELECT id, name, category, event_type, event_unit, is_higher_better, result_decimal_places, sort_no
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
          kind: 'track',
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

    /* ---- 球类：最终名次 ----
       原来公开页只读 heat_entry / track_heat（田径表），
       球类赛事的成绩在 match_info / final_rank 里，完全不在数据源中 ——
       结果一个纯球类赛事打开公开页，三个 tab 全是空的。
       现在把球类的最终名次也接进来。
    */
    const ballEvents = events.filter((e) => e.category === 3);
    if (ballEvents.length) {
      const ranks = await query(
        `SELECT fr.band_id, fr.event_item_id, fr.rank_no,
                te.team_name, s.name AS school_name
           FROM final_rank fr
           JOIN team_entry te ON te.id = fr.team_entry_id
           LEFT JOIN school s ON s.id = te.school_id
          WHERE fr.competition_id = ?
          ORDER BY fr.band_id, fr.event_item_id, fr.rank_no`,
        [comp.id]
      );
      const ballByKey = new Map();
      for (const r of ranks) {
        const k = `${r.event_item_id}:${r.band_id}`;
        if (!ballByKey.has(k)) ballByKey.set(k, []);
        ballByKey.get(k).push(r);
      }
      const showSchool = Number(comp.announce_show_school) === 1;
      for (const ev of ballEvents) {
        for (const band of bands) {
          const list = ballByKey.get(`${ev.id}:${band.id}`) || [];
          if (!list.length) continue;
          results.push({
            event_item_id: ev.id,
            event_name: ev.name,
            event_unit: null,
            band_id: band.id,
            band_label: band.label,
            kind: 'ball',
            rows: list.map((r) => ({
              rank: r.rank_no,
              name: r.team_name,
              school: showSchool ? r.school_name : null,
              result: `第 ${r.rank_no} 名`,
              score: null,
              heat: '',
              round: ''
            }))
          });
        }
      }
    }

    /* ---- 武术：已确认的评分排名 ---- */
    const martialEvents = events.filter((e) => Number(e.category) === 4);
    if (martialEvents.length) {
      const rows = await query(
        `SELECT me.event_item_id, me.band_id, me.rank_no, me.team_name,
                me.total_score, me.score_detail, me.order_no,
                ei.name AS event_name, s.name AS school_name
           FROM martial_entry me
           JOIN event_item ei ON ei.id = me.event_item_id
           JOIN martial_heat mh ON mh.id = me.heat_id
           LEFT JOIN school s ON s.id = me.school_id
          WHERE me.competition_id = ? AND mh.confirm_flag = 1
          ORDER BY me.event_item_id, me.band_id, me.rank_no`,
        [comp.id]
      );
      const byKey = new Map();
      for (const r of rows) {
        const k = `${r.event_item_id}:${r.band_id}`;
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(r);
      }
      const showSchool = Number(comp.announce_show_school) === 1;
      for (const ev of martialEvents) {
        for (const band of bands) {
          const list = byKey.get(`${ev.id}:${band.id}`) || [];
          if (!list.length) continue;
          results.push({
            event_item_id: ev.id,
            event_name: ev.name,
            event_unit: '分',
            band_id: band.id,
            band_label: band.label,
            kind: 'martial',
            rows: list.map((r) => ({
              rank: r.rank_no,
              name: r.team_name,
              school: showSchool ? r.school_name : null,
              result: r.score_detail || (r.total_score !== null ? String(r.total_score) : ''),
              score: r.total_score,
              heat: '',
              round: ''
            }))
          });
        }
      }
    }

    res.json(ok({
      competition: {
        name: comp.name, year: comp.year,
        start_date: comp.start_date, end_date: comp.end_date,
        host_unit: comp.host_unit, venue: comp.venue, note: comp.public_note
      },
      events: events.map((e) => ({
        id: e.id, name: e.name, event_type: e.event_type,
        event_unit: e.event_unit, sort_no: e.sort_no, category: e.category
      })),
      bands: bands.map((b) => ({ id: b.id, label: b.label })),
      results,
      updated_at: new Date().toISOString()
    }));
  } catch (e) { next(e); }
});

/**
 * GET /api/public/meet/:uuid/standing?event_item_id=&band_id=
 * 公开页的球类小组积分榜
 *
 * 原来公开页没有这个接口，公开页的「团体总分」tab 只认 team_score_rule（田径计分方案），
 * 球类赛事完全看不到积分。现在按 v_group_standing 的口径算出来。
 */
router.get('/meet/:uuid/standing', async (req, res, next) => {
  try {
    const comp = await compByUuid(req.params.uuid);
    if (!comp) return res.json(fail('赛事不存在'));
    const { event_item_id, band_id } = req.query;
    if (!event_item_id) return res.json(fail('缺少参数'));

    const where = ['m.competition_id = ?', 'm.status = 1', 'm.heat_group_id IS NOT NULL',
      'm.event_item_id = ?'];
    const params = [comp.id, event_item_id];
    if (band_id) { where.push('m.band_id = ?'); params.push(band_id); }

    const matches = await query(
      `SELECT m.* FROM match_info m WHERE ${where.join(' AND ')}`, params
    );
    if (!matches.length) return res.json(ok([]));

    const { computeStanding } = require('../services/schedule-algorithms');
    const groupIds = [...new Set(matches.map((m) => m.heat_group_id))];
    const out = [];

    for (const gid of groupIds) {
      const gm = matches.filter((m) => m.heat_group_id === gid);
      const teamIds = [...new Set(gm.flatMap((m) => [m.team_a_id, m.team_b_id]).filter(Boolean))];
      if (!teamIds.length) continue;

      const standing = computeStanding(teamIds, gm);
      const teams = await query(
        `SELECT te.id, te.team_name, s.name AS school_name FROM team_entry te
           LEFT JOIN school s ON s.id = te.school_id WHERE te.id IN (${teamIds.map(() => '?').join(',')})`,
        teamIds
      );
      const map = new Map(teams.map((t) => [t.id, t]));
      const group = await queryOne(
        `SELECT hg.group_letter, gb.label AS band_label FROM heat_group hg
           JOIN group_band gb ON gb.id = hg.band_id WHERE hg.id = ?`, [gid]
      );

      out.push({
        group_id: gid,
        group_letter: group?.group_letter,
        band_label: group?.band_label,
        rows: standing.map((s, i) => ({
          rank: i + 1,
          team_name: map.get(s.id)?.team_name || '—',
          school_name: map.get(s.id)?.school_name || null,
          played: s.played, win: s.win, draw: s.draw, lose: s.lose,
          scored: s.scored, conceded: s.conceded, points: s.points, diff: s.diff
        }))
      });
    }
    res.json(ok(out));
  } catch (e) { next(e); }
});

/**
 * GET /api/public/meet/:uuid/schedule?band_id=&event_item_id=
 * 公开页的赛程总表
 *
 * 观众最想要的一张表（按日期看全部比赛的时间、场地、对阵），
 * 原来系统里根本没有 —— 公开页只有「成绩」「团体总分」「对阵图」三个 tab，
 * 而这三个在纯球类赛事下全是空的。
 *
 * 【本轮补齐】球类读 match_info；田径读 timetable_item + track_heat
 * —— 之前 timetable_item 完全不在公开页任何接口的数据源里，
 * 结果观众看不到田径的日程（哪天几点哪个项目第几组）。
 */
router.get('/meet/:uuid/schedule', async (req, res, next) => {
  try {
    const comp = await compByUuid(req.params.uuid);
    if (!comp) return res.json(fail('赛事不存在'));
    const { band_id, event_item_id } = req.query;

    const where = ['m.competition_id = ?'];
    const params = [comp.id];
    if (band_id) { where.push('m.band_id = ?'); params.push(band_id); }
    if (event_item_id) { where.push('m.event_item_id = ?'); params.push(event_item_id); }

    /* ---- 球类：match_info 自带日期/时间/场地 ---- */
    const ballRows = await query(
      `SELECT m.id, m.seq_no, m.stage, m.status, m.score_a, m.score_b,
              m.team_a_id, m.team_b_id, m.ref_a, m.ref_b,
              ta.team_name AS team_a_name, tb.team_name AS team_b_name,
              m.play_date, m.start_time, m.end_time,
              m.venue_id, v.name AS venue_name,
              ei.name AS event_name, ei.category, gb.label AS band_label
         FROM match_info m
         LEFT JOIN team_entry ta ON ta.id = m.team_a_id
         LEFT JOIN team_entry tb ON tb.id = m.team_b_id
         LEFT JOIN venue v ON v.id = m.venue_id
         JOIN event_item ei ON ei.id = m.event_item_id
         JOIN group_band gb ON gb.id = m.band_id
        WHERE ${where.join(' AND ')} AND m.play_date IS NOT NULL
        ORDER BY m.play_date, m.start_time, m.seq_no`,
      params
    );

    /* ---- 田径：timetable_item（赛次 × 场地 × 时刻） ---- */
    const tw = ['ti.competition_id = ?'];
    const tp = [comp.id];
    if (band_id) { tw.push('h.band_id = ?'); tp.push(band_id); }
    if (event_item_id) { tw.push('h.event_item_id = ?'); tp.push(event_item_id); }

    const trackRows = await query(
      `SELECT ti.id, ti.title, ti.start_time, ti.end_time, ti.heat_id,
              ti.event_item_id, h.heat_name, h.round_code, h.entry_count,
              v.name AS venue_name, su.unit_date AS play_date,
              ei.name AS event_name, ei.category, gb.label AS band_label
         FROM timetable_item ti
         JOIN track_heat h ON h.id = ti.heat_id
         LEFT JOIN venue v ON v.id = ti.venue_id
         LEFT JOIN schedule_unit su ON su.id = ti.unit_id
         JOIN event_item ei ON ei.id = ti.event_item_id
         JOIN group_band gb ON gb.id = h.band_id
        WHERE ${tw.join(' AND ')}
        ORDER BY su.unit_date, ti.start_time, ti.id`,
      tp
    );

    const STAGE_LABEL = {
      1: '小组赛', 2: '八进四', 3: '半决赛', 4: '排位赛', 5: '决赛', 6: '三四名'
    };

    const out = [];

    for (const r of ballRows) {
      out.push({
        id: r.id,
        kind: 'ball',
        seq_no: r.seq_no,
        stage: r.stage,
        stage_label: STAGE_LABEL[r.stage] || `阶段${r.stage}`,
        status: r.status,
        score_a: r.score_a,
        score_b: r.score_b,
        team_a: r.team_a_name || r.ref_a || '待定',
        team_b: r.team_b_name || r.ref_b || '待定',
        date: r.play_date,
        time: (r.start_time || '').slice(0, 5),
        end_time: (r.end_time || '').slice(0, 5),
        venue: r.venue_name || '',
        event_name: r.event_name,
        band_label: r.band_label || ''
      });
    }

    for (const r of trackRows) {
      out.push({
        id: r.id,
        kind: 'track',
        seq_no: null,
        stage: null,
        stage_label: r.round_code === 'PRELIM' ? '预赛'
          : r.round_code === 'SEMI' ? '复赛' : '决赛',
        status: null,
        score_a: null,
        score_b: null,
        team_a: r.heat_name || r.title || '',
        team_b: r.entry_count ? `${r.entry_count} 人` : '',
        date: r.play_date,
        time: (r.start_time || '').slice(0, 5),
        end_time: (r.end_time || '').slice(0, 5),
        venue: r.venue_name || '',
        event_name: r.event_name,
        band_label: r.band_label || ''
      });
    }

    out.sort((a, b) => {
      if (a.date !== b.date) return (a.date || '') < (b.date || '') ? -1 : 1;
      return (a.time || '') < (b.time || '') ? -1 : 1;
    });

    res.json(ok(out));
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
    // 【一致性修复】原来只有 /meet/:uuid 校验 public_flag，大屏接口完全不看 ——
    // 同一个 uuid 两个公开出口，一个受开关控制一个不受，管理员关掉公开查询后
    // 大屏还能照常对外显示。这里统一口径。
    if (Number(comp.public_flag) !== 1) return res.json(fail('该赛事未开放公开展示'));

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
