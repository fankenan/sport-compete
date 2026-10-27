const express = require('express');
const { query, queryOne, ok } = require('../db');
const { authRequired } = require('../middleware/auth');
const { bandLabel } = require('../utils/helpers');
const { computeStanding } = require('../services/schedule-algorithms');

const router = express.Router();
router.use(authRequired);

/**
 * 赛事总览统计
 * GET /api/stats/overview
 */
router.get('/overview', async (req, res, next) => {
  try {
    const { competition_id } = req.query;

    const basic = await queryOne(
      `SELECT
        (SELECT COUNT(*) FROM school) AS school_total,
        (SELECT COUNT(DISTINCT school_id) FROM team_entry WHERE competition_id = ? AND status = 2) AS school_joined,
        (SELECT COUNT(*) FROM team_entry WHERE competition_id = ? AND status = 2) AS team_count,
        (SELECT COUNT(*) FROM team_entry WHERE competition_id = ? AND status = 1) AS team_pending,
        (SELECT COUNT(*) FROM athlete_entry WHERE competition_id = ? AND status = 2) AS athlete_count,
        (SELECT COUNT(*) FROM match_info WHERE competition_id = ?) AS match_count,
        (SELECT COUNT(*) FROM match_info WHERE competition_id = ? AND status = 1) AS match_done,
        (SELECT COUNT(*) FROM heat_group WHERE competition_id = ?) AS group_count,
        (SELECT COUNT(*) FROM referee) AS referee_count`,
      [competition_id, competition_id, competition_id, competition_id, competition_id, competition_id, competition_id]
    );

    // 分组别统计
    const byBand = await query(
      `SELECT gb.id, gb.stage, gb.gender, gb.label,
        (SELECT COUNT(*) FROM team_entry te WHERE te.band_id = gb.id AND te.status = 2) AS team_count,
        (SELECT COUNT(*) FROM athlete_entry ae WHERE ae.band_id = gb.id AND ae.status = 2) AS athlete_count,
        (SELECT COUNT(*) FROM match_info m WHERE m.band_id = gb.id) AS match_count,
        (SELECT COUNT(*) FROM match_info m WHERE m.band_id = gb.id AND m.status = 1) AS match_done
       FROM group_band gb WHERE gb.competition_id = ?
       ORDER BY gb.stage, gb.gender, gb.sort_no`,
      [competition_id]
    );

    res.json(ok({
      ...basic,
      bands: byBand.map((b) => ({ ...b, band_label: bandLabel(b) }))
    }));
  } catch (e) { next(e); }
});

/**
 * 参赛人数统计表（秩序册用）
 */
router.get('/entry-count', async (req, res, next) => {
  try {
    const { competition_id } = req.query;
    const rows = await query(
      `SELECT s.id AS school_id, s.name AS school_name, s.short_name, s.stage,
        (SELECT COUNT(DISTINCT a.id) FROM athlete a
          JOIN athlete_entry ae ON ae.athlete_id = a.id
          WHERE a.school_id = s.id AND ae.competition_id = ? AND ae.status = 2) AS athlete_count,
        (SELECT COUNT(DISTINCT te.id) FROM team_entry te
          WHERE te.school_id = s.id AND te.competition_id = ? AND te.status = 2) AS team_count
       FROM school s ORDER BY s.stage, s.name`,
      [competition_id, competition_id]
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

/**
 * 积分榜总表（按组别）
 */
router.get('/standings', async (req, res, next) => {
  try {
    const { competition_id, band_id, event_item_id } = req.query;
    const where = ['m.competition_id = ?', 'm.status = 1', 'm.heat_group_id IS NOT NULL'];
    const params = [competition_id];
    if (band_id) { where.push('m.band_id = ?'); params.push(band_id); }
    if (event_item_id) { where.push('m.event_item_id = ?'); params.push(event_item_id); }

    const matches = await query(`SELECT * FROM match_info m WHERE ${where.join(' AND ')}`, params);
    if (matches.length === 0) return res.json(ok([]));

    // 按小组分别算
    const groupIds = [...new Set(matches.map((m) => m.heat_group_id))];
    const result = [];

    for (const gid of groupIds) {
      const gm = matches.filter((m) => m.heat_group_id === gid);
      const teamIds = [...new Set(gm.flatMap((m) => [m.team_a_id, m.team_b_id]).filter(Boolean))];
      if (teamIds.length === 0) continue;

      const standing = computeStanding(teamIds, gm);
      const teams = await query(
        `SELECT te.id, te.team_name, s.name AS school_name FROM team_entry te
         JOIN school s ON s.id = te.school_id WHERE te.id IN (${teamIds.map(() => '?').join(',')})`,
        teamIds
      );
      const map = new Map(teams.map((t) => [t.id, t]));

      const group = await queryOne(
        `SELECT hg.*, gb.stage, gb.gender, gb.label AS band_label
         FROM heat_group hg JOIN group_band gb ON gb.id = hg.band_id WHERE hg.id = ?`,
        [gid]
      );

      result.push({
        group_id: gid,
        group_letter: group?.group_letter,
        band_id: group?.band_id,
        band_label: group ? bandLabel(group) : '',
        standing: standing.map((s) => ({ ...s, ...map.get(s.id) }))
      });
    }

    res.json(ok(result));
  } catch (e) { next(e); }
});

/**
 * 最近赛况（Dashboard 驾驶舱用）
 * GET /api/stats/recent-matches?competition_id=
 */
router.get('/recent-matches', async (req, res, next) => {
  try {
    const { competition_id } = req.query;
    const rows = await query(
      `SELECT m.id, m.stage, m.status, m.score_a, m.score_b, m.abandon_a, m.abandon_b,
              m.seq_no,
              ta.team_name AS team_a, tb.team_name AS team_b,
              sa.name AS school_a, sb.name AS school_b,
              ss.play_date, ss.start_time, ss.end_time,
              v.name AS venue_name,
              gb.stage AS band_stage, gb.gender AS band_gender, gb.label AS band_label,
              e.name AS event_name
         FROM match_info m
         LEFT JOIN team_entry ta ON ta.id = m.team_a_id
         LEFT JOIN team_entry tb ON tb.id = m.team_b_id
         LEFT JOIN school sa ON sa.id = ta.school_id
         LEFT JOIN school sb ON sb.id = tb.school_id
         LEFT JOIN schedule_slot ss ON ss.id = m.slot_id
         LEFT JOIN venue v ON v.id = ss.venue_id
         LEFT JOIN group_band gb ON gb.id = m.band_id
         LEFT JOIN event_item e ON e.id = m.event_item_id
        WHERE m.competition_id = ?
        ORDER BY ss.play_date DESC, ss.start_time DESC, m.id DESC
        LIMIT 8`,
      [competition_id]
    );
    res.json(ok(rows.map((r) => ({
      id: r.id,
      seq: r.seq_no,
      stage: r.stage,
      status: r.status,
      score_a: r.score_a,
      score_b: r.score_b,
      abandon_a: r.abandon_a,
      abandon_b: r.abandon_b,
      team_a: r.team_a || r.school_a || '—',
      school_a: r.school_a,
      school_b: r.school_b,
      team_b: r.team_b,
      date: r.play_date,
      start_time: r.start_time,
      end_time: r.end_time,
      venue: r.venue_name,
      band_label: r.band_label || bandLabel({ stage: r.band_stage, gender: r.band_gender, label: r.band_label }),
      event_name: r.event_name
    }))));
  } catch (e) { next(e); }
});

module.exports = router;
