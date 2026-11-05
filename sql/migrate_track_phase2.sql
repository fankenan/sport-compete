-- ============================================================
-- 迁移：田径专项 · 第二期「分组编排 + 成绩录入」
-- 执行：mysql -ucompete -p<DB_PASSWORD> sport_compete < migrate_track_phase2.sql
-- 说明：现有 heat_group / heat_member 是「队」维度的球类分组，
--       田径需要「个人 + 赛次 + 道次 + 成绩」维度，故另建一套表。
-- ============================================================

SET NAMES utf8mb4;

-- ============================================================
-- 一、赛次与分组（track_heat）
--    一次比赛 = 项目 × 组别 × 赛次（预/复/决）× 第几组
-- ============================================================

DROP TABLE IF EXISTS track_heat;
CREATE TABLE track_heat (
  id               INT PRIMARY KEY AUTO_INCREMENT,
  competition_id   INT         NOT NULL,
  band_id          INT         NOT NULL,
  event_item_id    INT         NOT NULL,
  round_code       VARCHAR(20) NOT NULL DEFAULT 'FINAL'
    COMMENT 'PRELIM预赛 SEMI复赛 FINAL决赛',
  round_no         TINYINT     NOT NULL DEFAULT 1 COMMENT '赛次序号 1预 2复 3决',
  heat_no          TINYINT     NOT NULL DEFAULT 1 COMMENT '该赛次第几组',
  heat_name        VARCHAR(40) COMMENT '如 预赛第1组',
  lane_count       TINYINT     NOT NULL DEFAULT 8,
  venue_id         INT         COMMENT '场地',
  plan_date        DATE        COMMENT '计划日期',
  plan_time        TIME        COMMENT '计划时间',
  estimated_minutes INT        COMMENT '预计用时',
  entry_count      INT         NOT NULL DEFAULT 0 COMMENT '本组人数',
  status           TINYINT     NOT NULL DEFAULT 1
    COMMENT '1待编排 2已编排 3录入中 4已确认',
  confirm_flag     TINYINT     NOT NULL DEFAULT 0 COMMENT '成绩已确认',
  confirmed_at     DATETIME,
  confirmed_by     VARCHAR(32),
  remark           VARCHAR(255),
  created_at       DATETIME    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_evt_round_heat (event_item_id, band_id, round_code, heat_no),
  KEY idx_comp (competition_id, event_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='赛次分组（径赛/田赛通用）';

-- ============================================================
-- 二、分组内个人成绩（heat_entry）
-- ============================================================

DROP TABLE IF EXISTS heat_entry;
CREATE TABLE heat_entry (
  id               INT PRIMARY KEY AUTO_INCREMENT,
  heat_id          INT          NOT NULL,
  competition_id   INT          NOT NULL,
  band_id          INT          NOT NULL,
  event_item_id    INT          NOT NULL,
  athlete_id       INT          NOT NULL COMMENT 'athlete.id',
  athlete_name     VARCHAR(64)  COMMENT '冗余，便于打印',
  school_id        INT,
  school_name      VARCHAR(128) COMMENT '冗余',
  team_name        VARCHAR(128) COMMENT '接力队名/代表队',
  bib_no           VARCHAR(20)  COMMENT '号码簿',
  lane_no          TINYINT      COMMENT '道次（径赛）',
  sort_no          INT          NOT NULL DEFAULT 0 COMMENT '出场顺序（田赛）',
  result_text      VARCHAR(32)  COMMENT '成绩原始录入，如 11"23 / 5.62',
  result_value     DECIMAL(10,3) COMMENT '可比较数值（秒 / 米）',
  status_code      VARCHAR(8)   COMMENT 'DNS未出发 DNF未完成 DQ取消资格 NM无成绩 WD弃权',
  best_attempt_id  INT          COMMENT '田赛最好一次试跳（投）的 id',
  rank_no          INT          COMMENT '本组名次',
  manual_rank_flag TINYINT      NOT NULL DEFAULT 0 COMMENT '1=人工指定名次',
  score            INT          COMMENT '换算积分（全能子项）',
  qualified        TINYINT      COMMENT '是否晋级（1是 0否）',
  advance_reason   VARCHAR(64)  COMMENT '晋级依据：按名次第2 / 成绩递补',
  source_heat_id   INT          COMMENT '从哪个组晋级而来',
  remark           VARCHAR(255),
  created_at       DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_heat_athlete (heat_id, athlete_id),
  KEY idx_comp (competition_id, event_item_id),
  KEY idx_athlete (athlete_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='分组内个人成绩';

-- ============================================================
-- 三、田赛试跳（投）明细（field_attempt）
-- ============================================================

DROP TABLE IF EXISTS field_attempt;
CREATE TABLE field_attempt (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  heat_entry_id  INT          NOT NULL,
  attempt_no     TINYINT      NOT NULL COMMENT '第几次',
  phase          VARCHAR(10)  NOT NULL DEFAULT 'BASE'
    COMMENT 'BASE基础轮 EXTRA附加轮 JUMPOFF跳跃赛（跳高争第一）',
  result_text    VARCHAR(32)  COMMENT '如 5.62 / 1.75',
  result_value   DECIMAL(10,3),
  valid_flag     TINYINT      NOT NULL DEFAULT 1 COMMENT '1成功 0失败',
  symbol         VARCHAR(4)   COMMENT 'O成功 X失败 -免跳  r 弃权',
  height         DECIMAL(6,2) COMMENT '跳高/撑杆：当轮高度',
  is_best        TINYINT      NOT NULL DEFAULT 0 COMMENT '1=本人最好成绩',
  created_at     DATETIME     DEFAULT CURRENT_TIMESTAMP,
  KEY idx_entry (heat_entry_id, attempt_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='田赛试跳（投）明细';

-- ============================================================
-- 四、接力棒次（relay_lineup）
-- ============================================================

DROP TABLE IF EXISTS relay_lineup;
CREATE TABLE relay_lineup (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  heat_entry_id   INT         NOT NULL,
  leg_no          TINYINT     NOT NULL COMMENT '第几棒',
  athlete_id      INT         NOT NULL,
  athlete_name    VARCHAR(64),
  bib_no          VARCHAR(20),
  is_temporary    TINYINT     NOT NULL DEFAULT 0 COMMENT '1=临时选拔',
  created_at      DATETIME    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_entry_leg (heat_entry_id, leg_no),
  KEY idx_entry (heat_entry_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='接力棒次表';

-- ============================================================
-- 五、晋级规则（advancement_rule）
-- ============================================================

DROP TABLE IF EXISTS advancement_rule;
CREATE TABLE advancement_rule (
  id                  INT PRIMARY KEY AUTO_INCREMENT,
  event_item_id       INT         NOT NULL,
  band_id             INT         COMMENT '空=项目级通用',
  round_code          VARCHAR(20) NOT NULL COMMENT '本规则作用于哪个赛次（PRELIM/SEMI）',
  advancement_mode    VARCHAR(20) NOT NULL DEFAULT 'BY_PLACE'
    COMMENT 'BY_PLACE按名次 BY_RESULT按成绩 MIXED混合',
  qualify_by_place    INT         COMMENT '每组按名次取几人',
  qualify_by_result   INT         COMMENT '按成绩递补几人',
  advance_total_count INT         COMMENT '晋级总人数上限',
  next_round_code     VARCHAR(20) COMMENT '晋级到哪个赛次',
  next_heat_count     TINYINT     COMMENT '下一赛次分几组',
  lane_order_mode     VARCHAR(20) NOT NULL DEFAULT 'SNAKE'
    COMMENT '下一轮道次分配：SNAKE蛇形 DRAW抽签 BY_RANK按成绩',
  status              TINYINT     NOT NULL DEFAULT 1,
  created_at          DATETIME    DEFAULT CURRENT_TIMESTAMP,
  KEY idx_event (event_item_id, round_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='晋级录取规则';

-- ============================================================
-- 六、全能成绩（combined_entry + 子项得分）
-- ============================================================

DROP TABLE IF EXISTS combined_item_score;
DROP TABLE IF EXISTS combined_entry;
CREATE TABLE combined_entry (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  competition_id  INT         NOT NULL,
  band_id         INT         NOT NULL,
  event_item_id   INT         NOT NULL COMMENT '全能父项目 id',
  athlete_id      INT         NOT NULL,
  athlete_name    VARCHAR(64),
  school_id       INT,
  school_name     VARCHAR(128),
  total_score     INT         NOT NULL DEFAULT 0 COMMENT '全能总分',
  finished_count  INT         NOT NULL DEFAULT 0 COMMENT '已完成子项数',
  missing_count   INT         NOT NULL DEFAULT 0 COMMENT '缺项数',
  rank_no         INT,
  status_code     VARCHAR(8)  COMMENT 'DNF中途退出 DQ取消资格',
  confirm_flag    TINYINT     NOT NULL DEFAULT 0,
  created_at      DATETIME    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_evt_athlete (event_item_id, band_id, athlete_id),
  KEY idx_comp (competition_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='全能总成绩';

CREATE TABLE combined_item_score (
  id                 INT PRIMARY KEY AUTO_INCREMENT,
  combined_entry_id  INT          NOT NULL,
  child_event_item_id INT         NOT NULL COMMENT '全能子项目 id',
  item_order         INT          NOT NULL DEFAULT 0,
  result_text        VARCHAR(32),
  result_value       DECIMAL(10,3),
  score              INT          NOT NULL DEFAULT 0 COMMENT '该子项换算积分',
  status_code        VARCHAR(8),
  created_at         DATETIME     DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_entry_child (combined_entry_id, child_event_item_id),
  KEY idx_entry (combined_entry_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='全能子项得分';

-- ============================================================
-- 七、编排规则配置（arrangement_rule）
--     项目级：分几组、每组几人、道次如何分配
-- ============================================================

DROP TABLE IF EXISTS arrangement_rule;
CREATE TABLE arrangement_rule (
  id                  INT PRIMARY KEY AUTO_INCREMENT,
  competition_id      INT         NOT NULL,
  event_item_id       INT         NOT NULL,
  band_id             INT         COMMENT '空=项目级',
  round_code          VARCHAR(20) NOT NULL DEFAULT 'FINAL',
  round_mode          VARCHAR(20) NOT NULL DEFAULT 'AUTO'
    COMMENT 'AUTO按人数自动 FIXED固定分组数 NONE不分组',
  lane_count          TINYINT     NOT NULL DEFAULT 8,
  heat_capacity       INT         COMMENT '每组最多几人（默认取道次数）',
  fixed_heat_count    TINYINT     COMMENT '固定分几组',
  lane_order_mode     VARCHAR(20) NOT NULL DEFAULT 'SNAKE'
    COMMENT 'SNAKE蛇形 DRAW抽签 SAME_SCHOOL_SPREAD同校分开',
  seed_mode           VARCHAR(20) NOT NULL DEFAULT 'NONE'
    COMMENT '种子依据：NONE随机 BY_RESULT按历史成绩 BY_BIB按号码',
  estimated_unit_minutes INT,
  status              TINYINT     NOT NULL DEFAULT 1,
  created_at          DATETIME    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_evt_band_round (event_item_id, band_id, round_code),
  KEY idx_comp (competition_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='分组编排规则';

SELECT '第二期表结构迁移完成' AS result;
