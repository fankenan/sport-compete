-- ============================================================
-- 球类编排：分项目赛制 + 个人/双打参赛单位
-- 2026-11-02
--
-- 背景：原来所有球类项目共用一套「分组循环 → 淘汰」，且参赛方一律是球队。
-- 乒乓球/羽毛球是个人项目（单打/双打/混双），需要区分。
--
-- 设计要点：不新建 contestant 表，也不改 match_info。
-- 把「个人」「双打组合」也写成一条 team_entry，用 entry_kind 区分，
-- 这样对阵图、录分、自动晋级、积分榜、秩序册全部零改动复用。
-- ============================================================

ALTER TABLE event_item
  ADD COLUMN schedule_mode VARCHAR(20) NOT NULL DEFAULT 'GROUP_KO'
    COMMENT '赛制：GROUP_KO=分组循环+淘汰 KO=纯淘汰 LEAGUE=单循环联赛 LEAGUE_HOME=主客场双循环'
    AFTER has_third_place,
  ADD COLUMN participant_kind VARCHAR(10) NOT NULL DEFAULT 'TEAM'
    COMMENT '参赛单位：TEAM=学校组队 ATHLETE=个人单打 PAIR=双打/混双组合'
    AFTER schedule_mode;

ALTER TABLE team_entry
  ADD COLUMN entry_kind TINYINT NOT NULL DEFAULT 1
    COMMENT '1=球队 2=个人单打 3=双打/混双组合'
    AFTER coach_name,
  ADD COLUMN partner_name VARCHAR(32) NULL
    COMMENT '双打搭档姓名（entry_kind=3 时有值）'
    AFTER roster_json,
  ADD COLUMN partner_athlete_id INT NULL
    COMMENT '双打搭档运动员 id（entry_kind=3 时指向 athlete 表）'
    AFTER partner_name;

-- 现有数据：老的都是球队，保持 entry_kind=1 默认值即可，无需回填
