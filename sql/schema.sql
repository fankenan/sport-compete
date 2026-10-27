-- ============================================================
-- 体育竞赛管理系统 · 数据库结构
-- 库：sport_compete   引擎：MySQL 8
-- 说明：15 张表 + 2 个视图，四大域划分
-- ============================================================

SET NAMES utf8mb4;

-- ============================================================
-- 一、基础档案域
-- ============================================================

DROP TABLE IF EXISTS schedule_version;
DROP TABLE IF EXISTS final_rank;
DROP TABLE IF EXISTS match_result;
DROP TABLE IF EXISTS match_referee;
DROP TABLE IF EXISTS referee;
DROP TABLE IF EXISTS `match_info`;
DROP TABLE IF EXISTS schedule_slot;
DROP TABLE IF EXISTS heat_member;
DROP TABLE IF EXISTS heat_group;
DROP TABLE IF EXISTS committee;
DROP TABLE IF EXISTS athlete_entry;
DROP TABLE IF EXISTS athlete;
DROP TABLE IF EXISTS team_entry;
DROP TABLE IF EXISTS venue;
DROP TABLE IF EXISTS group_band;
DROP TABLE IF EXISTS event_item;
DROP TABLE IF EXISTS competition;
DROP TABLE IF EXISTS user;
DROP TABLE IF EXISTS school;

-- 学校
CREATE TABLE school (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  name        VARCHAR(64)  NOT NULL COMMENT '学校全称',
  stage       TINYINT      NOT NULL DEFAULT 1 COMMENT '1小学 2初中 3高中',
  short_name  VARCHAR(32)  COMMENT '简称，秩序册用',
  principal   VARCHAR(32)  COMMENT '负责人',
  phone       VARCHAR(20),
  created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_school_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学校';

-- 用户（教育局 / 学校 / 裁判 三种角色）
CREATE TABLE user (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  school_id     INT          NOT NULL DEFAULT 0 COMMENT '0 表示教育局',
  username      VARCHAR(32)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  real_name     VARCHAR(32)  NOT NULL,
  role          TINYINT      NOT NULL COMMENT '1教育局 2学校 3裁判',
  phone         VARCHAR(20),
  referee_id    INT          COMMENT 'role=3 时关联 referee.id',
  is_active     TINYINT      DEFAULT 1,
  last_login_at DATETIME,
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_username (username),
  KEY idx_school_role (school_id, role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户';

-- 赛事
CREATE TABLE competition (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  name        VARCHAR(128) NOT NULL COMMENT '赛事全称',
  year        SMALLINT     NOT NULL,
  stage       TINYINT      NOT NULL DEFAULT 0 COMMENT '0不限 1小学 2初中 3高中',
  start_date  DATE,
  end_date    DATE,
  status      TINYINT      DEFAULT 1
              COMMENT '1报名中 2分组中 3排期中 4比赛中 5已结束',
  config_json JSON         COMMENT '赛制与排期配置',
  created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_year (year, stage)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='赛事';

-- 竞赛项目（赛制参数挂在项目上）
CREATE TABLE event_item (
  id                INT PRIMARY KEY AUTO_INCREMENT,
  competition_id    INT          NOT NULL,
  name              VARCHAR(64)  NOT NULL COMMENT '100米/篮球/足球',
  category          TINYINT      NOT NULL COMMENT '1径赛 2田赛 3球类',
  is_relay          TINYINT      DEFAULT 0 COMMENT '接力项目不占限报名额',
  -- 球类赛制参数
  match_minutes     TINYINT      DEFAULT 24 COMMENT '单场时长（分钟）',
  slot_interval     TINYINT      DEFAULT 45 COMMENT '时间槽间隔（分钟）',
  group_count       TINYINT      DEFAULT 0 COMMENT '分几组，0=按队数自动',
  rounds_per_group  TINYINT      DEFAULT 0 COMMENT '每组几轮，0=按队数自动',
  advance_count     TINYINT      DEFAULT 4 COMMENT '几人进淘汰赛',
  pairing_rule      TINYINT      DEFAULT 1 COMMENT '1首尾配对 2交叉 3对位',
  has_third_place   TINYINT      DEFAULT 1 COMMENT '是否打三四名',
  -- 径赛参数
  lane_count        TINYINT      DEFAULT 8 COMMENT '道次数',
  prelim_max        TINYINT      DEFAULT 16 COMMENT '超过此人数加复赛',
  KEY idx_comp (competition_id, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='竞赛项目';

-- 组别（学段 + 男女 + 可选 A/B 子组）
CREATE TABLE group_band (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT         NOT NULL,
  stage          TINYINT     NOT NULL COMMENT '1小学 2初中 3高中',
  gender         TINYINT     NOT NULL COMMENT '1男 2女',
  label          VARCHAR(32) NOT NULL COMMENT '男小A / 女初B',
  sort_no        INT         DEFAULT 0,
  KEY idx_comp (competition_id, stage, gender)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='组别';

-- 场地
CREATE TABLE venue (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT          NOT NULL,
  name           VARCHAR(64)  NOT NULL,
  venue_no       TINYINT      NOT NULL COMMENT '日程表显示的场地编号',
  host_school_id INT          COMMENT '若设在某校校内',
  sort_no        INT          DEFAULT 0,
  KEY idx_comp (competition_id, venue_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='场地';

-- ============================================================
-- 二、报名域
-- ============================================================

-- 球队报名（球类）
CREATE TABLE team_entry (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT          NOT NULL,
  band_id        INT          NOT NULL,
  event_item_id  INT          NOT NULL,
  school_id      INT          NOT NULL,
  team_name      VARCHAR(64)  NOT NULL COMMENT '队名',
  leader_name    VARCHAR(32)  COMMENT '领队',
  coach_name     VARCHAR(32)  COMMENT '教练员',
  roster_json    JSON         COMMENT '队员名单 [{"no":1,"name":"张三"}]',
  seed_no        INT          COMMENT '抽签号',
  status         TINYINT      DEFAULT 1 COMMENT '1待审 2通过 3驳回',
  reject_reason  VARCHAR(128),
  created_at     DATETIME     DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_band_event_school (band_id, event_item_id, school_id),
  KEY idx_comp_event (competition_id, event_item_id),
  KEY idx_school (school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='球队报名';

-- 运动员名册
CREATE TABLE athlete (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  school_id   INT          NOT NULL,
  name        VARCHAR(32)  NOT NULL,
  gender      TINYINT      NOT NULL,
  class_name  VARCHAR(32),
  student_no  VARCHAR(32),
  bib_no      INT          COMMENT '比赛号码',
  photo              MEDIUMTEXT   COMMENT '照片 base64 data URL（前端压缩到 400px）',
  student_card       MEDIUMTEXT   COMMENT '学籍表 base64（图片或 PDF）',
  student_card_name  VARCHAR(255) COMMENT '学籍表原始文件名',
  student_card_type  VARCHAR(64)  COMMENT '学籍表 MIME 类型',
  created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  KEY idx_school (school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='运动员';

-- 项目报名（田径，人报项）
CREATE TABLE athlete_entry (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT          NOT NULL,
  band_id        INT          NOT NULL,
  athlete_id     INT          NOT NULL,
  event_item_id  INT          NOT NULL,
  status         TINYINT      DEFAULT 1,
  created_at     DATETIME     DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_athlete_event (athlete_id, event_item_id),
  KEY idx_comp_band (competition_id, band_id),
  KEY idx_event (event_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='田径个人报名';

-- ============================================================
-- 三、赛程域
-- ============================================================

-- 小组
CREATE TABLE heat_group (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT         NOT NULL,
  band_id        INT         NOT NULL,
  event_item_id  INT         NOT NULL,
  group_letter   VARCHAR(4)  NOT NULL COMMENT 'A/B/C/D',
  rounds         TINYINT     NOT NULL DEFAULT 0 COMMENT '该组轮次',
  sort_no        INT         DEFAULT 0,
  KEY idx_comp_band_event (competition_id, band_id, event_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='小组';

-- 小组成员
CREATE TABLE heat_member (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  heat_group_id INT NOT NULL,
  team_entry_id INT NOT NULL,
  seed_no       INT COMMENT '组内编号 1/2/3/4',
  KEY idx_group (heat_group_id),
  KEY idx_team (team_entry_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='小组成员';

-- 日程槽位（承载比赛与非比赛占位）
CREATE TABLE schedule_slot (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT         NOT NULL,
  play_date      DATE         NOT NULL,
  venue_id       INT          NOT NULL,
  slot_index     TINYINT      NOT NULL COMMENT '当天第几槽',
  start_time     TIME         NOT NULL,
  end_time       TIME         NOT NULL,
  slot_type      TINYINT      DEFAULT 1 COMMENT '1比赛 2非比赛占位',
  occupation     VARCHAR(64)  COMMENT 'slot_type=2 时填 开幕式/体测 等',
  UNIQUE KEY uk_date_venue_slot (play_date, venue_id, slot_index),
  KEY idx_comp_date (competition_id, play_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='日程槽位';

-- 比赛场次
CREATE TABLE `match_info` (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT          NOT NULL,
  band_id        INT          NOT NULL,
  event_item_id  INT          NOT NULL,
  stage          TINYINT      NOT NULL
                 COMMENT '1小组赛 2八进四 3半决赛 4排位赛 5决赛 6三四名',
  round_no       TINYINT      DEFAULT 0 COMMENT '小组赛轮次',
  heat_group_id  INT          COMMENT '小组赛时归属',
  seq_no         INT          COMMENT '全局场序，秩序册引用',
  team_a_id      INT          COMMENT 'team_entry.id',
  team_b_id      INT,
  ref_a          VARCHAR(32)  COMMENT '占位引用：A组第1 / 场序43胜',
  ref_b          VARCHAR(32),
  slot_id        INT          COMMENT 'schedule_slot.id',
  score_a        INT,
  score_b        INT,
  abandon_a      TINYINT      DEFAULT 0 COMMENT '0正常 1弃权',
  abandon_b      TINYINT      DEFAULT 0,
  is_void        TINYINT      DEFAULT 0 COMMENT '2次弃权则全队成绩作废',
  status         TINYINT      DEFAULT 0 COMMENT '0未赛 1已录分 2作废',
  remark         VARCHAR(128),
  created_at     DATETIME     DEFAULT CURRENT_TIMESTAMP,
  KEY idx_comp_band_stage (competition_id, band_id, stage),
  KEY idx_seq (competition_id, seq_no),
  KEY idx_slot (slot_id),
  KEY idx_team_a (team_a_id),
  KEY idx_team_b (team_b_id),
  KEY idx_group (heat_group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='比赛场次';

-- ============================================================
-- 四、裁判与组委会
-- ============================================================

CREATE TABLE referee (
  id         INT PRIMARY KEY AUTO_INCREMENT,
  name       VARCHAR(32)  NOT NULL,
  phone      VARCHAR(20),
  school_id  INT          COMMENT '所属学校，可空',
  level      VARCHAR(32)  COMMENT '国家级/市级/县级',
  is_active  TINYINT      DEFAULT 1,
  KEY idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='裁判库';

CREATE TABLE match_referee (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  match_id    INT         NOT NULL,
  referee_id  INT         NOT NULL,
  role        TINYINT     DEFAULT 1 COMMENT '1主裁 2记录 3检录',
  UNIQUE KEY uk_match_ref (match_id, referee_id),
  KEY idx_ref (referee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='场次裁判指派';

-- 组委会名单（进秩序册）
CREATE TABLE committee (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT          NOT NULL,
  category       VARCHAR(32)  NOT NULL
                 COMMENT '主任/副主任/委员/仲裁委员会/裁判委员会/竞赛组/场地器材组/安全保障组/媒体宣传组',
  name           VARCHAR(32)  NOT NULL,
  position       VARCHAR(64)  COMMENT '职务',
  sort_no        INT          DEFAULT 0,
  KEY idx_comp_cat (competition_id, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='组委会名单';

-- ============================================================
-- 五、成绩与名次
-- ============================================================

CREATE TABLE match_result (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  match_id      INT NOT NULL,
  team_entry_id INT NOT NULL,
  scored        INT NOT NULL COMMENT '本队得分',
  conceded      INT NOT NULL COMMENT '失分',
  is_win        TINYINT NOT NULL,
  is_draw       TINYINT NOT NULL,
  KEY idx_match (match_id),
  KEY idx_team (team_entry_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='单场结果明细';

CREATE TABLE final_rank (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT         NOT NULL,
  band_id        INT         NOT NULL,
  event_item_id  INT         NOT NULL,
  rank_no        INT         NOT NULL,
  team_entry_id  INT         NOT NULL,
  source_stage   TINYINT     COMMENT '1小组赛 2八进四 3半决赛 4决赛',
  KEY idx_comp_band (competition_id, band_id, event_item_id, rank_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='最终名次';

-- 编排版本快照
CREATE TABLE schedule_version (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT         NOT NULL,
  version_no     INT         NOT NULL,
  generated_at   DATETIME    DEFAULT CURRENT_TIMESTAMP,
  generated_by   VARCHAR(32),
  is_current     TINYINT     DEFAULT 1,
  snapshot_json  JSON        COMMENT '完整赛程快照',
  KEY idx_comp_ver (competition_id, version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='编排版本';

-- ============================================================
-- 六、视图
-- ============================================================

-- 各校参赛人数统计（秩序册用）
CREATE OR REPLACE VIEW v_school_entry_count AS
SELECT
  c.id            AS competition_id,
  s.id            AS school_id,
  s.name          AS school_name,
  s.stage         AS school_stage,
  COUNT(DISTINCT a.id) AS athlete_count,
  COUNT(DISTINCT t.id) AS team_count
FROM competition c
LEFT JOIN school s ON 1 = 1
LEFT JOIN athlete a ON a.school_id = s.id
LEFT JOIN team_entry t ON t.school_id = s.id AND t.competition_id = c.id
GROUP BY c.id, s.id, s.name, s.stage;

-- 小组积分榜（实时）
CREATE OR REPLACE VIEW v_group_standing AS
SELECT
  m.competition_id,
  m.band_id,
  m.event_item_id,
  m.heat_group_id,
  m.team_a_id,
  m.team_b_id,
  m.score_a,
  m.score_b,
  m.abandon_a,
  m.abandon_b,
  m.is_void,
  m.status
FROM `match_info` m
WHERE m.heat_group_id IS NOT NULL AND m.status = 1;
