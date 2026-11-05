/**
 * 前端本地演示用 Mock API（仅 dev 生效，不进生产构建）
 *
 * 用途：本机没有 MySQL 时，也能 `npm run dev` 把界面完整跑起来，
 *      用来看设计改动效果、调试前端交互。
 *
 * 开启：默认开启。关闭：设环境变量 VITE_MOCK=0
 * 说明：数据是**写死的示例数据**，不是真实赛事，不要当业务数据用。
 */

const ok = (data = null, message = 'success') => ({ code: 0, message, data });
const fail = (message) => ({ code: 1, message, data: null });

/* ============================================================
   示例数据
   ============================================================ */

const COMPETITION = {
  id: 1,
  name: '登封市 2026 年秋季全市校园体育竞赛',
  year: 2026,
  stage: 0,
  start_date: '2026-11-02',
  end_date: '2026-11-06',
  status: 4
};

const SCHOOLS = [
  '登封市实验中学', '登封市第二高级中学', '登封市育才中学',
  '登封市少林实验学校', '登封市职教中心', '登封市第一高级中学',
  '登封市外国语学校', '登封市嵩阳中学', '登封市大道实验学校',
  '登封市大冶镇中心小学', '登封市卢崖寺小学', '登封市唐庄镇初中',
  '登封市石坊学校', '登封市告成镇中学', '登封市白坪镇中心小学',
  '登封市书院实验小学'
];

const BANDS = [
  { id: 1, stage: 2, gender: 1, label: '男初A', sort_no: 1 },
  { id: 2, stage: 2, gender: 2, label: '女初A', sort_no: 2 },
  { id: 3, stage: 1, gender: 1, label: '男小A', sort_no: 3 },
  { id: 4, stage: 1, gender: 2, label: '女小A', sort_no: 4 },
  { id: 5, stage: 3, gender: 1, label: '男高A', sort_no: 5 },
  { id: 6, stage: 3, gender: 2, label: '女高A', sort_no: 6 }
];

const EVENTS = [
  { id: 1, competition_id: 1, name: '男子篮球', category: 3, schedule_mode: 'GROUP_KO', participant_kind: 'TEAM', group_count: 4, advance_count: 4, pairing_rule: 1, has_third_place: 1, match_minutes: 24, slot_interval: 45, home_away: 0, allow_draw: 0, win_points: 3, draw_points: 0, lane_count: 8 },
  { id: 2, competition_id: 1, name: '女子篮球', category: 3, schedule_mode: 'GROUP_KO', participant_kind: 'TEAM', group_count: 2, advance_count: 4, pairing_rule: 1, has_third_place: 1, match_minutes: 24, slot_interval: 45, home_away: 0, allow_draw: 0, win_points: 3, draw_points: 0, lane_count: 8 },
  { id: 3, competition_id: 1, name: '男子足球', category: 3, schedule_mode: 'GROUP_KO', participant_kind: 'TEAM', group_count: 4, advance_count: 4, pairing_rule: 1, has_third_place: 1, match_minutes: 30, slot_interval: 60, home_away: 0, allow_draw: 0, win_points: 3, draw_points: 0, lane_count: 8 },
  { id: 4, competition_id: 1, name: '乒乓球单打', category: 3, schedule_mode: 'KO', participant_kind: 'ATHLETE', group_count: 0, advance_count: 8, pairing_rule: 1, has_third_place: 1, match_minutes: 15, slot_interval: 30, home_away: 0, allow_draw: 0, win_points: 3, draw_points: 0, lane_count: 8 },
  { id: 5, competition_id: 1, name: '100米', category: 1, lane_count: 8, prelim_max: 16 },
  { id: 6, competition_id: 1, name: '跳远', category: 2 },
  { id: 8, competition_id: 1, name: '武术·男子套路', category: 4, martial_judge_count: 5, martial_drop_highest: 1, martial_minutes: 90 },
  { id: 9, competition_id: 1, name: '武术·女子拳术', category: 4, martial_judge_count: 5, martial_drop_highest: 1, martial_minutes: 90 }
];

const VENUES = [
  { id: 1, competition_id: 1, name: '市体育馆', venue_no: 1, host_school_id: 2, sort_no: 1 },
  { id: 2, competition_id: 1, name: '实验中学球场', venue_no: 2, host_school_id: 1, sort_no: 2 },
  { id: 3, competition_id: 1, name: '职教中心球场', venue_no: 3, host_school_id: 5, sort_no: 3 }
];

const TEAM_NAMES = [
  '实验中学', '第二高中', '育才中学', '少林实验',
  '职教中心', '第一高中', '外国语学校', '嵩阳中学',
  '大道实验', '大冶镇中心小学', '卢崖寺小学', '唐庄镇初中',
  '石坊学校', '告成镇中学', '白坪镇中心小学', '书院实验小学'
];

const DATES = ['2026-11-03', '2026-11-04', '2026-11-05'];
const TIMES = ['08:30', '09:15', '10:00', '10:45', '11:30', '14:00', '14:45', '15:30', '16:15', '17:00'];

/* ---------- 构造场次 ---------- */

let matchSeq = 1;
const MATCHES = [];
let slotSeq = 1;
const SLOTS = [];

for (const date of DATES) {
  for (const venue of VENUES) {
    TIMES.forEach((time, idx) => {
      const slotId = slotSeq++;
      SLOTS.push({
        id: slotId,
        competition_id: 1,
        play_date: date,
        venue_id: venue.id,
        venue_no: venue.venue_no,
        venue_name: venue.name,
        slot_index: idx + 1,
        start_time: time,
        end_time: time.replace(/(\d\d):(\d\d)/, (m, h, mi) => `${h}:${String((Number(mi) + 35) % 60).padStart(2, '0')}`),
        slot_type: 1,
        occupation: null
      });
    });
  }
}

const BANDS_WITH_TEAMS = [1, 2, 3];
let slotCursor = 0;
for (const bandId of BANDS_WITH_TEAMS) {
  const groups = bandId === 1 ? 4 : 2;
  const perGroup = 4;
  for (let g = 0; g < groups; g++) {
    for (let r = 1; r < perGroup; r++) {
      for (let k = 0; k < perGroup / 2; k++) {
        const slot = SLOTS[slotCursor % SLOTS.length];
        slotCursor += 2;
        const teamA = TEAM_NAMES[(bandId * 3 + g * 4 + k * 2) % TEAM_NAMES.length];
        const teamB = TEAM_NAMES[(bandId * 3 + g * 4 + k * 2 + 1) % TEAM_NAMES.length];
        const done = slotCursor % 5 !== 0;
        MATCHES.push({
          id: matchSeq,
          competition_id: 1,
          band_id: bandId,
          event_item_id: bandId === 1 ? 1 : 2,
          stage: 1,
          round_no: r,
          heat_group_id: bandId * 100 + g + 1,
          seq_no: matchSeq,
          team_a: teamA,
          team_b: teamB,
          slot_id: slot.id,
          play_date: slot.play_date,
          start_time: slot.start_time,
          end_time: slot.end_time,
          venue_no: slot.venue_no,
          venue_name: slot.venue_name,
          score_a: done ? 18 + ((matchSeq * 7) % 22) : null,
          score_b: done ? 12 + ((matchSeq * 5) % 20) : null,
          status: done ? 1 : 0
        });
        matchSeq++;
      }
    }
  }
}

const BAND_LABEL = { 1: '男初A', 2: '女初A', 3: '男小A', 4: '女小A', 5: '男高A', 6: '女高A' };

/* ---------- 组别积分（由 MATCHES 汇总） ---------- */

function groupStanding(groupId) {
  const ms = MATCHES.filter((m) => m.heat_group_id === groupId && m.status === 1);
  const map = new Map();
  const touch = (name) => {
    if (!map.has(name)) {
      map.set(name, { id: map.size + 1, team_name: name, school_name: name, played: 0, win: 0, draw: 0, lose: 0, scored: 0, conceded: 0, points: 0, diff: 0 });
    }
    return map.get(name);
  };
  for (const m of ms) {
    const a = touch(m.team_a);
    const b = touch(m.team_b);
    a.played++; b.played++;
    a.scored += m.score_a; a.conceded += m.score_b;
    b.scored += m.score_b; b.conceded += m.score_a;
    if (m.score_a > m.score_b) { a.win++; b.lose++; a.points += 3; }
    else if (m.score_a < m.score_b) { b.win++; a.lose++; b.points += 3; }
    else { a.draw++; b.draw++; a.points += 1; b.points += 1; }
  }
  const list = [...map.values()];
  list.forEach((t) => { t.diff = t.scored - t.conceded; });
  list.sort((a, b) => b.points - a.points || b.diff - a.diff || a.scored - b.scored);
  return list.map((t, i) => ({ ...t, rank: i + 1 }));
}

/* ============================================================
   路由表
   ============================================================ */

const ROUTES = {
  'POST /api/auth/login': () => ok({
    token: 'mock-token-for-preview',
    user: {
      id: 1, username: 'admin', real_name: '管理员',
      role: 1, school_id: 0, school_name: null, referee_id: null
    }
  }, '登录成功'),

  'GET /api/auth/profile': () => ok({
    id: 1, username: 'admin', real_name: '管理员', role: 1, school_id: 0
  }),

  'GET /api/competition/list': () => ok([
    { ...COMPETITION, school_joined: 16, status_name: '比赛中' },
    { id: 2, name: '登封市 2026 年春季田径运动会', year: 2026, stage: 0, start_date: '2026-04-10', end_date: '2026-04-12', status: 5, school_joined: 16 },
    { id: 3, name: '登封市 2025 年秋季全市校园体育竞赛', year: 2025, stage: 0, start_date: '2025-11-03', end_date: '2025-11-07', status: 5, school_joined: 15 }
  ]),

  'GET /api/event/bands': () => ok(BANDS.map((b) => ({ ...b, competition_id: 1, band_label: BAND_LABEL[b.id] }))),

  'GET /api/event/items': () => ok(EVENTS),

  'GET /api/stats/overview': () => ok({
    school_total: 16,
    school_joined: 16,
    team_count: 48,
    team_pending: 4,
    athlete_count: 428,
    match_count: 96,
    match_done: 48,
    group_count: 8,
    referee_count: 26,
    bands: BANDS.map((b) => ({
      id: b.id, stage: b.stage, gender: b.gender, label: b.label,
      band_label: BAND_LABEL[b.id],
      team_count: [8, 8, 4, 4, 12, 12][b.id - 1],
      athlete_count: [96, 104, 72, 68, 44, 44][b.id - 1],
      match_count: [24, 20, 19, 19, 7, 7][b.id - 1],
      match_done: [18, 12, 8, 6, 2, 2][b.id - 1]
    }))
  }),

  'GET /api/schedule/advance-status': () => ok([
    { band_id: 1, band_label: '男初A', event_id: 1, event_name: '男子篮球', stage: 1, stage_label: '小组赛', total: 24, done: 24, complete: true },
    { band_id: 2, band_label: '女初A', event_id: 2, event_name: '女子篮球', stage: 1, stage_label: '小组赛', total: 20, done: 12, complete: false },
    { band_id: 3, band_label: '男小A', event_id: 1, event_name: '男子篮球', stage: 1, stage_label: '小组赛', total: 19, done: 8, complete: false },
    { band_id: 5, band_label: '男高A', event_id: 3, event_name: '男子足球', stage: 1, stage_label: '小组赛', total: 7, done: 2, complete: false }
  ]),

  'GET /api/stats/recent-matches': () => ok(
    MATCHES.filter((m) => m.status === 1).slice(-8).reverse().map((m) => ({
      id: m.id, seq: m.seq_no, stage: m.stage, status: m.status,
      score_a: m.score_a, score_b: m.score_b,
      team_a: m.team_a, team_b: m.team_b,
      school_a: m.team_a, school_b: m.team_b,
      date: m.play_date, start_time: m.start_time, end_time: m.end_time,
      venue: m.venue_name,
      band_label: BAND_LABEL[m.band_id], event_name: m.event_item_id === 2 ? '女子篮球' : '男子篮球'
    }))
  ),

  'GET /api/stats/standings': () => ok(
    [...new Set(MATCHES.map((m) => m.heat_group_id))].map((gid) => {
      const first = MATCHES.find((m) => m.heat_group_id === gid);
      const letter = String.fromCharCode(65 + (gid % 4));
      return {
        group_id: gid,
        group_letter: letter,
        band_id: first.band_id,
        band_label: BAND_LABEL[first.band_id],
        standing: groupStanding(gid)
      };
    })
  ),

  'GET /api/group/standing': () => ok(
    [...new Set(MATCHES.map((m) => m.heat_group_id))].map((gid) => {
      const first = MATCHES.find((m) => m.heat_group_id === gid);
      const letter = String.fromCharCode(65 + (gid % 4));
      return {
        group_id: gid,
        group_letter: letter,
        band_id: first.band_id,
        band_label: BAND_LABEL[first.band_id],
        standing: groupStanding(gid)
      };
    })
  ),

  'GET /api/schedule/gantt': () => ok({
    dates: DATES,
    venues: VENUES.map((v) => ({ id: v.id, venue_no: v.venue_no, name: v.name })),
    cells: SLOTS.map((s) => {
      const m = MATCHES.find((x) => x.slot_id === s.id);
      return {
        slot_id: s.id,
        date: s.play_date,
        venue_no: s.venue_no,
        venue_name: s.venue_name,
        slot_index: s.slot_index,
        start_time: s.start_time,
        end_time: s.end_time,
        slot_type: 1,
        occupation: null,
        match: m ? {
          id: m.id, seq_no: m.seq_no, stage: m.stage, stage_label: '小组赛',
          band_id: m.band_id, event_item_id: m.event_item_id,
          event_name: m.event_item_id === 2 ? '女子篮球' : '男子篮球',
          band_label: BAND_LABEL[m.band_id],
          team_a: m.team_a, team_b: m.team_b,
          score_a: m.score_a, score_b: m.score_b, status: m.status
        } : null
      };
    })
  }),

  'GET /api/schedule/rounds': () => ok(
    [...new Set(MATCHES.map((m) => m.heat_group_id))].map((gid) => {
      const first = MATCHES.find((m) => m.heat_group_id === gid);
      const letter = String.fromCharCode(65 + (gid % 4));
      // 按真实后端结构：按小组归拢，rounds 是轮次数组
      const roundNos = [...new Set(MATCHES.filter((m) => m.heat_group_id === gid).map((m) => m.round_no))].sort((a, b) => a - b);
      return {
        group_id: gid,
        group_letter: letter,
        band_label: BAND_LABEL[first.band_id],
        rounds: roundNos.map((rn) => ({
          round_no: rn,
          bye: null,
          matches: MATCHES.filter((m) => m.heat_group_id === gid && m.round_no === rn).map((m) => ({
            id: m.id,
            seq_no: m.seq_no,
            team_a: m.team_a,
            team_b: m.team_b,
            score_a: m.score_a,
            score_b: m.score_b,
            status: m.status,
            play_date: m.play_date,
            start_time: m.start_time,
            venue: m.venue_name
          }))
        }))
      };
    })
  ),

  'GET /api/schedule/estimate': () => ok({
    grouped: true, home_away: 0, teamCount: 16,
    matches: 24, rounds: 3, byePerRound: 0,
    groups: [{ group_letter: 'A', teamCount: 4, rounds: 3, matches: 6, roundsDouble: 6, matchesDouble: 12, byePerRound: 0 }]
  }),

  'GET /api/schedule/ko-preview': () => ok({
    teams: 18, size: 32, byes: 14, rounds: 5, firstRoundMatches: 2, totalMatches: 17,
    bands: [{ band_id: 4, band_label: '女小A', teams: 18, size: 32, byes: 14, rounds: 5 }]
  }),

  'GET /api/schedule/event-config': () => ok({
    event_item_id: 1, name: '男子篮球',
    home_away: 0, allow_draw: 0, win_points: 3, draw_points: 0
  }),

  'GET /api/referee/list': () => ok([
    { id: 1, name: '王建军', phone: '138****0001', level: '国家级', is_active: 1 },
    { id: 2, name: '李国庆', phone: '138****0002', level: '市级', is_active: 1 },
    { id: 3, name: '张文博', phone: '138****0003', level: '市级', is_active: 1 },
    { id: 4, name: '刘明辉', phone: '138****0004', level: '县级', is_active: 1 }
  ]),

  'GET /api/entry/list': () => ok(
    TEAM_NAMES.slice(0, 12).map((name, i) => ({
      id: i + 1, team_name: name, school_name: name,
      school_id: i + 1, band_id: 1, band_label: '男初A',
      event_item_id: 1, event_name: '男子篮球',
      status: 2, seed_no: i + 1
    }))
  ),

  /* ---------- 编排中心 / 待排期 / 公开页 ---------- */

  /* 甘特图：新的时间轴结构 */
  'GET /api/schedule/gantt': () => {
    const windows = [];
    for (const date of DATES) {
      for (const venue of VENUES) {
        TIMES.forEach((time, idx) => {
          windows.push({
            id: windows.length + 1,
            date,
            venue_id: venue.id,
            venue_no: venue.venue_no,
            venue_name: venue.name,
            slot_index: idx + 1,
            start_time: time,
            end_time: time,
            slot_type: 1,
            occupation: null
          });
        });
      }
    }
    const scheduled = MATCHES.filter((m) => m.play_date && m.start_time);
    const unplaced = MATCHES.filter((m) => !m.play_date || !m.start_time);
    const dec = (m) => ({
      id: m.id, seq_no: m.seq_no, stage: m.stage, stage_label: '小组赛',
      band_id: m.band_id, band_label: BAND_LABEL[m.band_id],
      event_item_id: m.event_item_id,
      event_name: m.event_item_id === 2 ? '女子篮球' : '男子篮球',
      team_a: m.team_a, team_b: m.team_b,
      score_a: m.score_a, score_b: m.score_b, status: m.status,
      confirmed: m.status === 1 && m.seq_no % 3 === 0 ? 1 : 0,
      date: m.play_date, start_time: m.start_time, end_time: m.end_time,
      venue_id: m.venue_no, slot_id: null
    });
    return ok({
      dates: DATES,
      venues: VENUES.map((v) => ({ id: v.id, venue_no: v.venue_no, name: v.name })),
      windows,
      matches: scheduled.map(dec),
      unplaced: unplaced.map(dec)
    });
  },

  /* 对阵表（与排期解耦） */
  'GET /api/schedule/lineup': () => ok({
    total: 2,
    combos: [1, 2].map((bandId) => ({
      band_id: bandId,
      band_label: BAND_LABEL[bandId],
      event_item_id: bandId === 1 ? 1 : 2,
      event_name: bandId === 1 ? '男子篮球' : '女子篮球',
      schedule_mode: 'GROUP_KO',
      total: 24, done: 12, scheduled: 8,
      groups: ['A', 'B'].map((letter, gi) => ({
        key: `g-${bandId}-${gi}`,
        group_id: bandId * 100 + gi + 1,
        group_letter: letter,
        stage: 1,
        stage_label: '小组赛',
        rounds: [1, 2, 3].map((rn) => ({
          round_no: rn,
          matches: [0, 1].map((k) => ({
            id: bandId * 1000 + gi * 100 + rn * 10 + k,
            seq_no: bandId * 100 + gi * 10 + rn * 2 + k + 1,
            stage: 1, stage_label: '小组赛',
            team_a: TEAM_NAMES[(bandId + gi * 2 + k) % TEAM_NAMES.length],
            team_b: TEAM_NAMES[(bandId + gi * 2 + k + 1) % TEAM_NAMES.length],
            team_a_id: null, team_b_id: null,
            score_a: null, score_b: null,
            status: 0,
            scheduled: false,
            play_date: null, start_time: null, venue_id: null
          }))
        }))
      }))
    }))
  }),

  'GET /api/schedule/conflicts': () => ok({
    total: 1,
    conflicts: [{
      type: 'REST',
      a_id: 1, b_id: 2,
      team_id: 1, team_name: '实验中学',
      detail: '「实验中学」两场间隔仅 45 分钟，不足 90 分钟（第 1、2 场）'
    }]
  }),

  'POST /api/group/generate-league': () => ok({
    count: 66, mode: 'LEAGUE', seqFrom: 1, seqTo: 66
  }, '已生成 66 场联赛赛程'),

  'POST /api/schedule/clear-schedule': () => ok({ cleared: 0 }, '已清空 0 场的排期'),

  'POST /api/schedule/slots': () => ok({ count: 30 }, '已设置 30 个可用时段'),

  'POST /api/schedule/pack': () => ok({ placed: 24, unplaced: 0, waiting: 2 }, '已排入 24 场'),

  /* ---------- 武术编排与评分 ---------- */
  'GET /api/martial/overview': () => ok({
    total: 2,
    teams: 14,
    heats: 3,
    items: [
      { event_item_id: 8, event_name: '武术·男子套路', category: 4, teams: 8, heats: 2, confirmed: 1, scheduled: 1, unplaced: 1, entries: 8, state: 'doing', state_label: '评分中' },
      { event_item_id: 9, event_name: '武术·女子拳术', category: 4, teams: 6, heats: 1, confirmed: 0, scheduled: 0, unplaced: 1, entries: 0, state: 'doing', state_label: '待编排' }
    ]
  }),

  'GET /api/martial/heats': () => ok([
    {
      id: 401, competition_id: 1, band_id: 1, event_item_id: 8,
      round_code: 'FINAL', round_no: 3, heat_no: 1, heat_name: '决赛第1组',
      entry_count: 4, judge_count: 5, status: 3, confirm_flag: 0,
      event_name: '武术·男子套路', band_label: '男初A',
      judge_count_cfg: 5, drop_highest: 1,
      entries: [
        { id: 11, school_id: 1, school_name: '实验中学', team_name: '实验中学代表队', leader_name: '王教练', order_no: 1, scores: [{ judge: '张裁判', score: 9.5 }, { judge: '李裁判', score: 9.3 }, { judge: '刘裁判', score: 9.7 }, { judge: '陈裁判', score: 9.2 }, { judge: '赵裁判', score: 9.4 }], total_score: 9.4, score_detail: '9.40（去 9.20/9.70）', rank_no: 1, remark: null, reason: '' },
        { id: 12, school_id: 2, school_name: '第二高中', team_name: '第二高中代表队', leader_name: '李教练', order_no: 2, scores: [{ judge: '张裁判', score: 9.1 }, { judge: '李裁判', score: 9.0 }, { judge: '刘裁判', score: 9.3 }, { judge: '陈裁判', score: 8.9 }, { judge: '赵裁判', score: 9.2 }], total_score: 9.1, score_detail: '9.10（去 8.90/9.30）', rank_no: 2, remark: null, reason: '' },
        { id: 13, school_id: 3, school_name: '育才中学', team_name: '育才中学代表队', leader_name: '刘教练', order_no: 3, scores: [{ judge: '张裁判', score: 8.8 }, { judge: '李裁判', score: 9.0 }, { judge: '刘裁判', score: 8.7 }, { judge: '陈裁判', score: 8.9 }, { judge: '赵裁判', score: 8.6 }], total_score: 8.8, score_detail: '8.80（去 8.60/9.00）', rank_no: 3, remark: null, reason: '' },
        { id: 14, school_id: 4, school_name: '少林实验', team_name: '少林实验代表队', leader_name: '陈教练', order_no: 4, scores: [{ judge: '张裁判', score: 9.4 }, { judge: '李裁判', score: 9.5 }], total_score: null, score_detail: '打分不足（2/5 位裁判）', rank_no: null, remark: null, reason: '打分不足（2/5 位裁判）' }
      ]
    }
  ]),

  'GET /api/martial/standing': () => ok([
    {
      id: 401, band_id: 1, band_label: '男初A', event_item_id: 8,
      event_name: '武术·男子套路', round_code: 'FINAL', round_name: '决赛',
      heat_no: 1, heat_name: '决赛第1组', confirm_flag: 0,
      rows: [
        { rank_no: 1, team_name: '实验中学代表队', school_name: '实验中学', order_no: 1, total_score: 9.4, score_detail: '9.40（去 9.20/9.70）' },
        { rank_no: 2, team_name: '第二高中代表队', school_name: '第二高中', order_no: 2, total_score: 9.1, score_detail: '9.10（去 8.90/9.30）' },
        { rank_no: 3, team_name: '育才中学代表队', school_name: '育才中学', order_no: 3, total_score: 8.8, score_detail: '8.80（去 8.60/9.00）' }
      ]
    }
  ]),

  'GET /api/martial/schedule': () => ok([
    { id: 401, round_code: 'FINAL', round_name: '决赛', heat_no: 1, heat_name: '决赛第1组', entry_count: 4, date: '2026-11-05', time: '09:00', venue: '市体育馆', event_name: '武术·男子套路', band_label: '男初A', confirm_flag: 0 }
  ]),

  'POST /api/martial/arrange': () => ok({ heats: 1, entries: 4, judge_count: 5 }, '已编排 1 组、4 支参赛队'),
  'PUT /api/martial/entry/:id/scores': () => ok({ total_score: 9.4, score_detail: '9.40（去 9.20/9.70）', rank_no: 1, dropped: [9.2, 9.7] }, '已保存，得分 9.40（去 9.20/9.70）'),
  'POST /api/martial/heat/:id/confirm': () => ok(null, '成绩已确认'),
  'POST /api/martial/heat/:id/revoke': () => ok(null, '已撤销确认'),
  'PUT /api/martial/entry/:id/order': () => ok(null, '已调整'),

  'GET /api/schedule/unplaced': () => ok({
    total: 6, ready: 4, pendingResult: 2,
    summary: [
      { band_id: 1, band_label: '男初A', event_item_id: 1, event_name: '男子篮球', stage: 2, stage_label: '八进四', count: 4, ready: 4 },
      { band_id: 2, band_label: '女初A', event_item_id: 2, event_name: '女子篮球', stage: 5, stage_label: '决赛', count: 2, ready: 0 }
    ],
    matches: [
      { id: 9001, seq_no: 97, stage: 2, stage_label: '八进四', round_no: 2, band_id: 1, band_label: '男初A', event_item_id: 1, event_name: '男子篮球', team_a: '实验中学', team_b: '第二高中', ready: true, status: 0 },
      { id: 9002, seq_no: 98, stage: 2, stage_label: '八进四', round_no: 2, band_id: 1, band_label: '男初A', event_item_id: 1, event_name: '男子篮球', team_a: '育才中学', team_b: '少林实验', ready: true, status: 0 },
      { id: 9003, seq_no: 99, stage: 2, stage_label: '八进四', round_no: 2, band_id: 1, band_label: '男初A', event_item_id: 1, event_name: '男子篮球', team_a: '职教中心', team_b: '第一高中', ready: true, status: 0 },
      { id: 9004, seq_no: 100, stage: 2, stage_label: '八进四', round_no: 2, band_id: 1, band_label: '男初A', event_item_id: 1, event_name: '男子篮球', team_a: '外国语学校', team_b: '嵩阳中学', ready: true, status: 0 },
      { id: 9005, seq_no: 101, stage: 5, stage_label: '决赛', round_no: 3, band_id: 2, band_label: '女初A', event_item_id: 2, event_name: '女子篮球', team_a: '待定', team_b: '待定', ready: false, status: 0 },
      { id: 9006, seq_no: 102, stage: 6, stage_label: '三四名', round_no: 3, band_id: 2, band_label: '女初A', event_item_id: 2, event_name: '女子篮球', team_a: '待定', team_b: '待定', ready: false, status: 0 }
    ]
  }),

  /* ---------- 田径编排总览 ---------- */
  'GET /api/track/overview': () => ok({
    total: 3,
    units: 4,
    heats: 12,
    scheduled: 8,
    athletes: 156,
    items: [
      { event_item_id: 5, event_name: '100米', category: 1, event_type: 'TRACK', athletes: 64, heats: 6, scoring: 4, confirmed: 2, scheduled: 4, unplaced: 2, state: 'doing', state_label: '待排期' },
      { event_item_id: 6, event_name: '跳远', category: 2, event_type: 'FIELD', athletes: 52, heats: 4, scoring: 2, confirmed: 0, scheduled: 4, unplaced: 0, state: 'done', state_label: '已排期' },
      { event_item_id: 7, event_name: '4×100米接力', category: 1, event_type: 'RELAY', athletes: 40, heats: 2, scoring: 0, confirmed: 0, scheduled: 0, unplaced: 2, state: 'doing', state_label: '待排期' }
    ]
  }),

  /* ---------- 田径分组编排页 ---------- */
  // 注意：真实接口 GET /track-result/workbench 返回的是**数组**，
  // 不是 { heats: [...] }（每个元素自带 entries / attempts）
  'GET /api/track-result/workbench': () => ok([
    {
      id: 301, heat_name: '预赛第1组', round_code: 'PRELIM', round_no: 1, heat_no: 1,
      lane_count: 8, entry_count: 5, status: 2, plan_date: '2026-11-03', plan_time: '08:30:00',
      event_name: '100米', event_type: 'TRACK', result_entry_type: 'TIME', event_unit: 's',
      is_higher_better: 0, result_decimal_places: 2, band_label: '男初A', stage: 2, gender: 1,
      entries: [
        { id: 1, heat_id: 301, lane_no: 1, sort_no: 1, athlete_name: '张伟', school_name: '实验中学', bib_no: 'A0123', result_text: null, result_value: null, rank_no: null, status_code: null, score: null, attempts: [] },
        { id: 2, heat_id: 301, lane_no: 2, sort_no: 2, athlete_name: '李强', school_name: '第二高中', bib_no: 'B0345', result_text: null, result_value: null, rank_no: null, status_code: null, score: null, attempts: [] },
        { id: 3, heat_id: 301, lane_no: 3, sort_no: 3, athlete_name: '王磊', school_name: '育才中学', bib_no: 'C0789', result_text: '11.23', result_value: 11.23, rank_no: 1, status_code: null, score: null, attempts: [] },
        { id: 4, heat_id: 301, lane_no: 4, sort_no: 4, athlete_name: '刘洋', school_name: '少林实验', bib_no: 'D0012', result_text: '11.45', result_value: 11.45, rank_no: 2, status_code: null, score: null, attempts: [] },
        { id: 5, heat_id: 301, lane_no: 5, sort_no: 5, athlete_name: '陈晨', school_name: '职教中心', bib_no: 'E0456', result_text: null, result_value: null, rank_no: null, status_code: null, score: null, attempts: [] }
      ]
    },
    {
      id: 302, heat_name: '预赛第2组', round_code: 'PRELIM', round_no: 1, heat_no: 2,
      lane_count: 8, entry_count: 3, status: 2, plan_date: '2026-11-03', plan_time: '09:00:00',
      event_name: '100米', event_type: 'TRACK', result_entry_type: 'TIME', event_unit: 's',
      is_higher_better: 0, result_decimal_places: 2, band_label: '男初A', stage: 2, gender: 1,
      entries: [
        { id: 6, heat_id: 302, lane_no: 1, sort_no: 1, athlete_name: '赵鹏', school_name: '第一高中', bib_no: 'F0678', result_text: null, result_value: null, rank_no: null, status_code: null, score: null, attempts: [] },
        { id: 7, heat_id: 302, lane_no: 2, sort_no: 2, athlete_name: '孙浩', school_name: '外国语学校', bib_no: 'G0901', result_text: null, result_value: null, rank_no: null, status_code: null, score: null, attempts: [] },
        { id: 8, heat_id: 302, lane_no: 3, sort_no: 3, athlete_name: '周杰', school_name: '嵩阳中学', bib_no: 'H0234', result_text: null, result_value: null, rank_no: null, status_code: null, score: null, attempts: [] }
      ]
    }
  ]),

  'POST /api/track-result/arrange': () => ok({ message: '已编排 2 个赛次', heat_count: 2, entry_count: 11 }),
  'PUT /api/track-result/arrange-rule': () => ok(null, '编排规则已保存'),
  'POST /api/group/track-generate': () => fail(
    '径赛分组已统一到「田径分组编排」。请到「田径项目 → 分组编排」操作。', 410),

  'GET /api/schedule/list': () => ok(
    MATCHES.map((m) => ({
      id: m.id, seq_no: m.seq_no, stage: m.stage, stage_label: '小组赛',
      band_id: m.band_id, band_label: BAND_LABEL[m.band_id],
      event_item_id: m.event_item_id, event_name: m.event_item_id === 2 ? '女子篮球' : '男子篮球',
      team_a_id: 1, team_b_id: 2,
      team_a_name: m.team_a, team_b_name: m.team_b,
      school_a: m.team_a, school_b: m.team_b,
      score_a: m.score_a, score_b: m.score_b, status: m.status,
      confirmed: m.status === 1 && m.seq_no % 3 === 0 ? 1 : 0,
      slot_id: m.slot_id,
      play_date: m.play_date, start_time: m.start_time, end_time: m.end_time,
      venue_no: m.venue_no, venue_name: m.venue_name
    }))
  ),

  'POST /api/result/score-batch': (body) => ok({ count: (body?.matches || []).length, advanced: 0 }, '已提交'),

  'POST /api/result/confirm': (body) => ok({ count: (body?.match_ids || []).length }, '已确认'),

  'POST /api/result/unconfirm': (body) => ok({ count: (body?.match_ids || []).length }, '已取消确认'),

  'GET /api/public/meet/demo/standing': () => ok(
    [...new Set(MATCHES.map((m) => m.heat_group_id))].slice(0, 2).map((gid) => {
      const first = MATCHES.find((m) => m.heat_group_id === gid);
      return {
        group_id: gid,
        group_letter: String.fromCharCode(65 + (gid % 4)),
        band_label: BAND_LABEL[first.band_id],
        rows: groupStanding(gid).map((t) => ({
          rank: t.rank, team_name: t.team_name, school_name: t.school_name,
          played: t.played, win: t.win, draw: t.draw, lose: t.lose,
          scored: t.scored, conceded: t.conceded, points: t.points, diff: t.diff
        }))
      };
    })
  ),

  'GET /api/public/meet/demo/schedule': () => ok(
    MATCHES.slice(0, 20).map((m) => ({
      id: m.id, seq_no: m.seq_no, stage: m.stage, stage_label: '小组赛',
      status: m.status, score_a: m.score_a, score_b: m.score_b,
      team_a: m.team_a, team_b: m.team_b,
      date: m.play_date, time: m.start_time, venue: m.venue_name,
      event_name: m.event_item_id === 2 ? '女子篮球' : '男子篮球',
      band_label: BAND_LABEL[m.band_id]
    }))
  )
};

/* ============================================================
   Vite 插件
   ============================================================ */

export function mockApiPlugin() {
  return {
    name: 'mock-api',
    apply: 'serve',
    configureServer(server) {
      if (process.env.VITE_MOCK === '0') return;

      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0];
        const key = `${req.method} ${url}`;
        let handler = ROUTES[key];

        const send = (body) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(body));
        };

        // 路径参数匹配：把 /api/martial/entry/:id/scores 之类转成正则
        if (!handler) {
          for (const [k, fn] of Object.entries(ROUTES)) {
            if (!k.includes('/:')) continue;
            const [method, pattern] = k.split(' ');
            if (method !== req.method) continue;
            const re = new RegExp('^' + pattern.replace(/:[^/]+/g, '[^/]+') + '$');
            if (re.test(url)) { handler = fn; break; }
          }
        }

        if (handler) {
          // 有 body 的请求（POST/PUT/PATCH）需要把 body 传给 handler
          if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
            let raw = '';
            req.on('data', (chunk) => { raw += chunk; });
            req.on('end', () => {
              let parsed = null;
              try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parsed = null; }
              try {
                send(handler(parsed));
              } catch (e) {
                send(fail(e.message || 'mock 处理失败'));
              }
            });
            return;
          }
          try {
            send(handler());
          } catch (e) {
            send(fail(e.message || 'mock 处理失败'));
          }
          return;
        }

        // 未收录的接口统一返回空成功，避免前端弹错
        if (url.startsWith('/api/')) {
          send(ok([]));
          return;
        }

        next();
      });

      server.config.logger.info('  ➜  Mock API 已启用（示例数据，非真实赛事）');
    }
  };
}

export { fail };
