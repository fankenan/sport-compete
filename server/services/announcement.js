/**
 * 成绩公布服务
 *
 * 原来公布逻辑写在 routes/trackRace.js 的端点里，只能手动调用；
 * 而 competition.announce_auto_flag（"确认后自动公布"）**只写不读** ——
 * 配了这个开关，系统什么也不会做。
 *
 * 现在把逻辑抽到这里：
 *   - routes/trackRace.js  的 /announcement/publish  → 手动公布
 *   - routes/trackResult.js 的 /confirm              → 确认后按开关自动公布
 */

const { query, queryOne, execute } = require('../db');

/**
 * 把请求体里的赛次 id 归一化
 * 支持：heat_ids: [1,2] / heats: [1,2] / heat_id: 3
 */
function normalizeHeatIds(body = {}) {
  const raw = body.heat_ids ?? body.heats ?? body.heat_id;
  const arr = Array.isArray(raw) ? raw : (raw === undefined || raw === null || raw === '' ? [] : [raw]);
  return [...new Set(arr.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0))];
}

/**
 * 公布一组赛次的成绩
 *
 * @param {number[]} heatIds
 * @param {string} who 公布人
 * @param {number} [competitionId] 限定赛事（避免跨赛事串数据）
 * @returns {Promise<{count:number}>}
 */
async function publishHeats(heatIds, who, competitionId = null) {
  const ids = normalizeHeatIds({ heat_ids: heatIds });
  if (!ids.length) return { count: 0 };

  let done = 0;
  for (const heatId of ids) {
    const heat = await queryOne(
      `SELECT h.*, e.name AS event_name FROM track_heat h
         JOIN event_item e ON e.id = h.event_item_id
        WHERE h.id = ?${competitionId ? ' AND h.competition_id = ?' : ''}`,
      competitionId ? [heatId, competitionId] : [heatId]
    );
    if (!heat) continue;

    const entries = await query(
      'SELECT * FROM heat_entry WHERE heat_id = ? ORDER BY COALESCE(rank_no, 999), id',
      [heatId]
    );

    const content = {
      event_name: heat.event_name,
      heat_name: heat.heat_name,
      round_code: heat.round_code,
      published_by: who,
      entries: entries.map((e) => ({
        rank: e.rank_no,
        lane: e.lane_no ?? e.sort_no,
        bib: e.bib_no,
        name: e.athlete_name,
        school: e.school_name,
        result: e.result_text,
        status: e.status_code,
        score: e.score
      }))
    };

    const exist = await queryOne('SELECT id FROM score_announcement WHERE heat_id = ?', [heatId]);
    if (exist) {
      await execute(
        `UPDATE score_announcement
            SET content_json = ?, publish_flag = 1, published_at = NOW(), published_by = ?
          WHERE id = ?`,
        [JSON.stringify(content), who, exist.id]
      );
    } else {
      await execute(
        `INSERT INTO score_announcement
           (competition_id, band_id, event_item_id, round_code, heat_id, title, content_json,
            publish_flag, published_at, published_by)
         VALUES (?,?,?,?,?,?,?,1,NOW(),?)`,
        [heat.competition_id, heat.band_id, heat.event_item_id, heat.round_code, heatId,
         `${heat.event_name} ${heat.heat_name}`, JSON.stringify(content), who]
      );
    }
    done++;
  }
  return { count: done };
}

/**
 * 撤回公布
 */
async function withdrawHeats(heatIds) {
  const ids = normalizeHeatIds({ heat_ids: heatIds });
  if (!ids.length) return { count: 0 };
  const ph = ids.map(() => '?').join(',');
  await execute(
    `UPDATE score_announcement SET publish_flag = 0 WHERE heat_id IN (${ph})`, ids
  );
  return { count: ids.length };
}

/**
 * 确认成绩后按开关自动公布
 *
 * 现在 competition.announce_auto_flag 终于被读取了 ——
 * 配了「确认后自动公布」，确认成绩就会自动上公告栏。
 *
 * @returns {Promise<{auto:boolean, count:number}>}
 */
async function autoPublishIfEnabled(competitionId, heatIds, who) {
  if (!competitionId) return { auto: false, count: 0 };

  const comp = await queryOne(
    'SELECT announce_auto_flag, announce_flag FROM competition WHERE id = ?',
    [competitionId]
  );
  // 两个开关都要开：既要在自动公布模式，也要总开关打开
  if (!comp || Number(comp.announce_auto_flag) !== 1 || Number(comp.announce_flag) !== 1) {
    return { auto: false, count: 0 };
  }

  const r = await publishHeats(heatIds, who, competitionId);
  return { auto: true, count: r.count };
}

module.exports = {
  normalizeHeatIds,
  publishHeats,
  withdrawHeats,
  autoPublishIfEnabled
};
