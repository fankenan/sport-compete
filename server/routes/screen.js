/**
 * 赛事大屏（公开，免登录）
 *
 * 任何人拿到链接都能看：积分榜、最新赛果、今日/近期赛程。
 * 只读，不返回任何账号、联系方式等敏感信息。
 *
 * GET /api/screen/board?competition_id=6[&event_item_id=1][&band_id=1]
 */
const express = require('express');
const { query, queryOne, ok, fail } = require('../db');
const { bandLabel } = require('../utils/helpers');
const { computeStanding } = require('../services/schedule-algorithms');

const router = express.Router();

/**
 * 取项目积分规则
 */
async function pointsOpt(eventItemId) {
  if (!eventItemId) return {};
  const ev = await queryOne('SELECT win_points, draw_points FROM event_item WHERE id = ?', [eventItemId]);
  if (!ev) return {};
  return { winPts: Number(ev.win_points) || 3, drawPts: Number(ev.draw_points) || 0 };
}

/**
 * 公开赛事列表（大屏选赛事用，只返回最基本的字段）
 * GET /api/screen/competitions
 */
router.get('/competitions', async (req, res, next) => {
  try {
    const rows = await query(
      'SELECT id, name, year, start_date, end_date FROM competition ORDER BY year DESC, id DESC'
    );
    res.json(ok(rows));
  } catch (e) { next(e); }
});

router.get('/board', async (req, res, next) => {
  try {
    const { competition_id, event_item_id, band_id } = req.query;
    if (!competition_id) return res.json(fail('缺少赛事参数'));

    const comp = await queryOne(
      'SELECT id, name, year, start_date, end_date, status FROM competition WHERE id = ?',
      [competition_id]
    );
    if (!comp) return res.json(fail('赛事不存在'));

    // 项目（只取球类 category=3，田径是成绩表不是积分榜）
    const evWhere = ['competition_id = ?'];
    const evParams = [competition_id];
    if (event_item_id) { evWhere.push('id = ?'); evParams.push(event_item_id); }
    const events = await query(
      `SELECT id, name, category, home_away, allow_draw, win_points, draw_points
       FROM event_item WHERE ${evWhere.join(' AND ')} ORDER BY id`,
      evParams
    );

    // ── 球类：积分榜 ──
    const boards = [];
    for (const ev of events) {
      if (Number(ev.category) !== 3) continue;

      const bandWhere = ['m.competition_id = ?', 'm.event_item_id = ?', 'm.status = 1'];
      const bandParams = [competition_id, ev.id];
      if (band_id) { bandWhere.push('m.band_id = ?'); bandParams.push(band_id); }

      const matches = await query(
        `SELECT m.*, hg.group_letter
         FROM match_info m LEFT JOIN heat_group hg ON hg.id = m.heat_group_id
         WHERE ${bandWhere.join(' AND ')}`,
        bandParams
      );
      if (matches.length === 0) continue;

      // 按组别拆开，每个组别一张榜
      const bandIds = [...new Set(matches.map((m) => m.band_id))];
      for (const bid of bandIds) {
        const bm = matches.filter((m) => m.band_id === bid);
        const teamIds = new Set();
        bm.forEach((m) => {
          if (m.team_a_id) teamIds.add(m.team_a_id);
          if (m.team_b_id) teamIds.add(m.team_b_id);
        });
        if (teamIds.size === 0) continue;

        const standing = computeStanding([...teamIds], bm, await pointsOpt(ev.id));
        const teams = await query(
          `SELECT te.id, te.team_name, s.name AS school_name FROM team_entry te
           JOIN school s ON s.id = te.school_id
           WHERE te.id IN (${[...teamIds].map(() => '?').join(',')})`,
          [...teamIds]
        );
        const map = new Map(teams.map((t) => [t.id, t]));

        const band = await queryOne('SELECT * FROM group_band WHERE id = ?', [bid]);
        boards.push({
          type: 'standing',
          event_id: ev.id,
          event_name: ev.name,
          band_id: bid,
          band_label: band ? bandLabel(band) : '',
          win_points: Number(ev.win_points) || 3,
          draw_points: Number(ev.draw_points) || 0,
          rows: standing.map((s) => ({
            rank: s.rank,
            rank_reason: s.rankReason || '',
            team_name: map.get(s.id)?.team_name || '',
            school_name: map.get(s.id)?.school_name || '',
            played: s.played, win: s.win, draw: s.draw, lose: s.lose,
            points: s.points, scored: s.scored, conceded: s.conceded,
            diff: s.diff, is_voided: s.isVoided ? 1 : 0
          }))
        });
      }

      // ── 最新赛果（已结束的，取最近 12 场）──
      const recent = await query(
        `SELECT m.id, m.seq_no, m.score_a, m.score_b, m.band_id,
                ta.team_name AS team_a, tb.team_name AS team_b,
                sa.name AS school_a, sb.name AS school_b,
                ss.play_date, ss.start_time, v.name AS venue_name, v.venue_no
         FROM match_info m
         LEFT JOIN team_entry ta ON ta.id = m.team_a_id
         LEFT JOIN team_entry tb ON tb.id = m.team_b_id
         LEFT JOIN school sa ON sa.id = ta.school_id
         LEFT JOIN school sb ON sb.id = tb.school_id
         LEFT JOIN schedule_slot ss ON ss.id = m.slot_id
         LEFT JOIN venue v ON v.id = ss.venue_id
         WHERE m.competition_id = ? AND m.event_item_id = ? AND m.status = 1
         ORDER BY ss.play_date DESC, ss.start_time DESC, m.seq_no DESC
         LIMIT 12`,
        [competition_id, ev.id]
      );

      if (recent.length) {
        boards.push({
          type: 'results',
          event_id: ev.id,
          event_name: ev.name,
          rows: recent.map((m) => ({
            seq_no: m.seq_no,
            team_a: m.team_a || m.school_a || '—',
            team_b: m.team_b || m.school_b || '—',
            score_a: m.score_a,
            score_b: m.score_b,
            play_date: m.play_date,
            start_time: (m.start_time || '').slice(0, 5),
            venue: m.venue_name || '',
            band_label: bandLabel({ stage: null, gender: null, label: '' }) || ''
          }))
        });
      }

      // ── 待赛（还没打的最近 12 场）──
      const upcoming = await query(
        `SELECT m.id, m.seq_no, m.band_id,
                ta.team_name AS team_a, tb.team_name AS team_b,
                sa.name AS school_a, sb.name AS school_b,
                ss.play_date, ss.start_time, v.name AS venue_name, v.venue_no
         FROM match_info m
         LEFT JOIN team_entry ta ON ta.id = m.team_a_id
         LEFT JOIN team_entry tb ON tb.id = m.team_b_id
         LEFT JOIN school sa ON sa.id = ta.school_id
         LEFT JOIN school sb ON sb.id = tb.school_id
         LEFT JOIN schedule_slot ss ON ss.id = m.slot_id
         LEFT JOIN venue v ON v.id = ss.venue_id
         WHERE m.competition_id = ? AND m.event_item_id = ? AND m.status = 0
         ORDER BY ss.play_date, ss.start_time, m.seq_no
         LIMIT 12`,
        [competition_id, ev.id]
      );

      if (upcoming.length) {
        boards.push({
          type: 'upcoming',
          event_id: ev.id,
          event_name: ev.name,
          rows: upcoming.map((m) => ({
            seq_no: m.seq_no,
            team_a: m.team_a || m.school_a || '—',
            team_b: m.team_b || m.school_b || '—',
            play_date: m.play_date,
            start_time: (m.start_time || '').slice(0, 5),
            venue: m.venue_name || ''
          }))
        });
      }
    }

    res.json(ok({
      competition: {
        id: comp.id,
        name: comp.name,
        year: comp.year,
        start_date: comp.start_date,
        end_date: comp.end_date
      },
      updated_at: new Date().toISOString(),
      boards
    }));
  } catch (e) { next(e); }
});

module.exports = router;
