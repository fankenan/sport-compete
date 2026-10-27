-- ============================================================
-- 迁移：田径专项 · 第三期「赛中变更 + 号码簿 + 表单打印 + 成绩公布」
-- 执行：mysql -ucompete -pCompete@2026 sport_compete < migrate_track_phase3.sql
-- ============================================================

SET NAMES utf8mb4;

-- ============================================================
-- 一、临时变更记录（四类：临时报名 / 撤赛 / 换人 / 改项）
--     统一一张表 + change_type 区分，每类都有「撤销」能力
-- ============================================================

DROP TABLE IF EXISTS participant_change;
CREATE TABLE participant_change (
  id                INT PRIMARY KEY AUTO_INCREMENT,
  competition_id    INT         NOT NULL,
  band_id           INT         NOT NULL,
  event_item_id     INT         NOT NULL,
  change_type       VARCHAR(20) NOT NULL
    COMMENT 'TEMP_ENTRY临时报名 WITHDRAWAL撤赛 REPLACEMENT换人 EVENT_CHANGE改项 NAME_CHANGE改名',
  -- 临时报名
  new_athlete_id    INT         COMMENT '新增的运动员 athlete.id',
  new_athlete_name  VARCHAR(64),
  new_school_id     INT,
  new_school_name   VARCHAR(128),
  -- 撤赛 / 换人：原运动员
  old_athlete_id    INT,
  old_athlete_name  VARCHAR(64),
  old_school_id     INT,
  old_school_name   VARCHAR(128),
  old_heat_id       INT         COMMENT '原来所在的组',
  old_heat_entry_id INT,
  -- 换人：替补
  replace_athlete_id   INT,
  replace_athlete_name VARCHAR(64),
  replace_school_id    INT,
  replace_school_name  VARCHAR(128),
  -- 改项
  from_event_item_id INT,
  from_event_name    VARCHAR(64),
  to_event_item_id   INT,
  to_event_name      VARCHAR(64),
  to_heat_id         INT        COMMENT '改项后进入的组',
  -- 改名
  before_name        VARCHAR(64),
  after_name         VARCHAR(64),
  -- 通用
  reason           VARCHAR(255) COMMENT '变更原因',
  operation_source VARCHAR(20) NOT NULL DEFAULT 'ADMIN'
    COMMENT 'ADMIN教育局 TEAM代表队 REFEREE裁判',
  target_heat_id   INT         COMMENT '生效到哪一组',
  new_heat_entry_id INT        COMMENT '生成的新 heat_entry.id',
  revoked          TINYINT     NOT NULL DEFAULT 0 COMMENT '1=已撤销',
  revoked_at       DATETIME,
  revoked_by       VARCHAR(32),
  created_by       VARCHAR(32),
  created_at       DATETIME    DEFAULT CURRENT_TIMESTAMP,
  KEY idx_comp (competition_id, change_type),
  KEY idx_event (event_item_id),
  KEY idx_athlete (old_athlete_id, new_athlete_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='赛中临时变更记录';

-- ============================================================
-- 二、号码簿规则与生成结果
-- ============================================================

DROP TABLE IF EXISTS bib_number;
CREATE TABLE bib_number (
  id               INT PRIMARY KEY AUTO_INCREMENT,
  competition_id   INT         NOT NULL,
  band_id          INT,
  school_id        INT         NOT NULL,
  team_name        VARCHAR(128),
  athlete_id       INT         NOT NULL,
  athlete_name     VARCHAR(64),
  gender           TINYINT,
  bib_no           VARCHAR(20) NOT NULL COMMENT '号码',
  prefix           VARCHAR(10) COMMENT '前缀（学校代码等）',
  seq_no           INT         COMMENT '校内序号',
  generated_flag   TINYINT     NOT NULL DEFAULT 1 COMMENT '1自动生成 0手工指定',
  created_at       DATETIME    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_athlete (athlete_id),
  KEY idx_comp_school (competition_id, school_id),
  KEY idx_bib (competition_id, bib_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='号码簿';

-- ============================================================
-- 三、检录表 / 成绩单 打印模板配置
-- ============================================================

DROP TABLE IF EXISTS print_form_config;
CREATE TABLE print_form_config (
  id               INT PRIMARY KEY AUTO_INCREMENT,
  competition_id   INT         NOT NULL,
  form_type        VARCHAR(20) NOT NULL COMMENT 'CHECK_IN检录表 RESULT成绩单 START_LIST出发名单',
  show_school      TINYINT     NOT NULL DEFAULT 1,
  show_bib         TINYINT     NOT NULL DEFAULT 1,
  show_lane        TINYINT     NOT NULL DEFAULT 1,
  show_gender      TINYINT     NOT NULL DEFAULT 0,
  show_sign_col    TINYINT     NOT NULL DEFAULT 1 COMMENT '检录表签字栏',
  show_referee     TINYINT     NOT NULL DEFAULT 1 COMMENT '裁判员签字栏',
  rows_per_page    INT         NOT NULL DEFAULT 30,
  title_text       VARCHAR(128) COMMENT '自定义表头',
  footer_text      VARCHAR(128),
  created_at       DATETIME    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_comp_type (competition_id, form_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='表单打印配置';

-- ============================================================
-- 四、成绩公布
-- ============================================================

DROP TABLE IF EXISTS score_announcement;
CREATE TABLE score_announcement (
  id               INT PRIMARY KEY AUTO_INCREMENT,
  competition_id   INT         NOT NULL,
  band_id          INT,
  event_item_id    INT,
  round_code       VARCHAR(20),
  heat_id          INT,
  title            VARCHAR(128),
  content_json     JSON        COMMENT '公布内容快照',
  publish_flag     TINYINT     NOT NULL DEFAULT 0 COMMENT '1已公布',
  published_at     DATETIME,
  published_by     VARCHAR(32),
  sort_no          INT         NOT NULL DEFAULT 0,
  created_at       DATETIME    DEFAULT CURRENT_TIMESTAMP,
  KEY idx_comp (competition_id, publish_flag)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='成绩公布';

-- 赛事级成绩公布开关
ALTER TABLE competition
  ADD COLUMN announce_flag     TINYINT NOT NULL DEFAULT 0 COMMENT '成绩公布开关' AFTER order_book_lock_flag,
  ADD COLUMN announce_auto_flag TINYINT NOT NULL DEFAULT 0 COMMENT '确认成绩后自动公布' AFTER announce_flag,
  ADD COLUMN announce_show_school TINYINT NOT NULL DEFAULT 1 COMMENT '公布时显示单位' AFTER announce_auto_flag;

-- ============================================================
-- 五、裁判员与代表队账号（赛中需要）
-- ============================================================

DROP TABLE IF EXISTS referee_account;
CREATE TABLE referee_account (
  id                INT PRIMARY KEY AUTO_INCREMENT,
  competition_id    INT          NOT NULL,
  referee_id        INT          COMMENT '关联 referee.id',
  username          VARCHAR(32)  NOT NULL,
  password_hash     VARCHAR(255) NOT NULL,
  real_name         VARCHAR(32),
  event_item_id     INT          COMMENT '负责的项目',
  band_id           INT          COMMENT '负责的组别',
  duty              VARCHAR(64)  COMMENT '职务：起点/终点/计时/跳部/投部',
  phone             VARCHAR(20),
  login_flag        TINYINT      NOT NULL DEFAULT 1 COMMENT '允许登录',
  last_login_at     DATETIME,
  sort_no           INT          NOT NULL DEFAULT 0,
  status            TINYINT      NOT NULL DEFAULT 1,
  created_at        DATETIME     DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_username (username),
  KEY idx_comp (competition_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='裁判员账号';

-- athlete 增加出生日期（出生年月现在靠身份证推算，这里冗余存一份便于限制校验）
ALTER TABLE athlete
  ADD COLUMN birth_date DATE COMMENT '出生日期' AFTER id_card,
  ADD COLUMN gender_text VARCHAR(6) COMMENT '男/女冗余' AFTER gender;

SELECT '第三期表结构迁移完成' AS result;
