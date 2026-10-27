-- ============================================================
-- 第四期：赛后统计与公开
--   15 团体总分排名（按组 / 合并方案 / 虚拟组）
--   19 基础分调整
--   20 公开成绩查询页
--   21 大屏控制端（队列、插播、主题）
-- （16 达级 / 17 破纪录 / 18 综合查询 所需表已在第一期建好）
-- ============================================================

-- ---------- 15. 团体总分方案 ----------
DROP TABLE IF EXISTS team_score_rule;
CREATE TABLE team_score_rule (
  id                  INT PRIMARY KEY AUTO_INCREMENT,
  competition_id      INT           NOT NULL,
  scheme_name         VARCHAR(64)   NOT NULL COMMENT '方案名，如 初中组团体总分',
  scope_mode          VARCHAR(20)   NOT NULL DEFAULT 'BAND' COMMENT 'BAND按组分别 MERGE合并组别 VIRTUAL虚拟组',
  band_ids            JSON          COMMENT '参与本方案的组别 id 数组',
  score_source        VARCHAR(20)   NOT NULL DEFAULT 'RANK' COMMENT 'RANK按名次计分 SCORE_RULE按项目评分规则',
  score_table         JSON          COMMENT '名次→分，如 {"1":9,"2":7,"3":6}',
  rank_limit          INT           COMMENT '录取名次上限，超过不计分，空=全部',
  relay_multiplier    DECIMAL(5,2)  NOT NULL DEFAULT 2.00 COMMENT '接力项目倍数',
  include_grade_bonus TINYINT       NOT NULL DEFAULT 0 COMMENT '达级加分计入团体总分',
  include_record_bonus TINYINT      NOT NULL DEFAULT 0 COMMENT '破纪录加分计入团体总分',
  tie_break_mode      VARCHAR(20)   NOT NULL DEFAULT 'FIRST' COMMENT '同分决胜：FIRST先比第一名个数 NONE不比',
  status              TINYINT       NOT NULL DEFAULT 1,
  sort_no             INT           NOT NULL DEFAULT 0,
  created_at          DATETIME      DEFAULT CURRENT_TIMESTAMP,
  KEY idx_comp (competition_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='团体总分方案';

-- ---------- 15b. 虚拟组 ----------
DROP TABLE IF EXISTS virtual_group;
CREATE TABLE virtual_group (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT          NOT NULL,
  rule_id        INT,
  group_name     VARCHAR(64)  NOT NULL COMMENT '虚拟组名，如 市区联队',
  school_ids     JSON         COMMENT '并入本虚拟组的学校 id 数组',
  sort_no        INT          NOT NULL DEFAULT 0,
  KEY idx_comp (competition_id, rule_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='团体总分虚拟组';

-- ---------- 15c. 团体总分明细（物化，可追溯）----------
DROP TABLE IF EXISTS team_score_item;
CREATE TABLE team_score_item (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT           NOT NULL,
  rule_id        INT           NOT NULL,
  band_id        INT,
  event_item_id  INT           NOT NULL,
  heat_entry_id  INT,
  athlete_id     INT,
  athlete_name   VARCHAR(64),
  school_id      INT,
  school_name    VARCHAR(128),
  rank_no        INT,
  result_text    VARCHAR(32),
  score_type     VARCHAR(20)   NOT NULL DEFAULT 'INDIVIDUAL' COMMENT 'INDIVIDUAL个人 RELAY接力 COMBINED全能',
  base_score     DECIMAL(8,2)  NOT NULL DEFAULT 0,
  grade_bonus    DECIMAL(8,2)  NOT NULL DEFAULT 0,
  record_bonus   DECIMAL(8,2)  NOT NULL DEFAULT 0,
  total_score    DECIMAL(8,2)  NOT NULL DEFAULT 0,
  created_at     DATETIME      DEFAULT CURRENT_TIMESTAMP,
  KEY idx_rule (rule_id),
  KEY idx_comp_event (competition_id, event_item_id),
  KEY idx_school (competition_id, school_id),
  UNIQUE KEY uk_item (rule_id, heat_entry_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='团体总分得分明细';

-- ---------- 15d. 团体总分汇总（含 19 基础分调整）----------
DROP TABLE IF EXISTS team_score_total;
CREATE TABLE team_score_total (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT           NOT NULL,
  rule_id        INT           NOT NULL,
  band_id        INT           COMMENT 'MERGE/VIRTUAL 模式下为 NULL',
  unit_type      VARCHAR(20)   NOT NULL DEFAULT 'SCHOOL' COMMENT 'SCHOOL学校 VIRTUAL虚拟组',
  unit_id        INT           NOT NULL COMMENT 'school_id 或 virtual_group.id',
  unit_name      VARCHAR(128),
  total_score    DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '项目得分合计',
  grade_bonus    DECIMAL(10,2) NOT NULL DEFAULT 0,
  record_bonus   DECIMAL(10,2) NOT NULL DEFAULT 0,
  adjust_score   DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '基础分调整（可正可负）',
  adjust_reason  VARCHAR(255)  COMMENT '调整原因',
  final_score    DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '最终总分',
  first_count    INT           NOT NULL DEFAULT 0 COMMENT '第一名个数（同分决胜用）',
  second_count   INT           NOT NULL DEFAULT 0,
  third_count    INT           NOT NULL DEFAULT 0,
  rank_no        INT,
  rank_reason    VARCHAR(64),
  updated_at     DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_unit (rule_id, band_id, unit_type, unit_id),
  KEY idx_comp (competition_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='团体总分汇总';

-- ---------- 20. 公开页 ----------
ALTER TABLE competition
  ADD COLUMN public_flag TINYINT NOT NULL DEFAULT 0 COMMENT '公开成绩页开关' AFTER announce_show_school,
  ADD COLUMN public_note VARCHAR(255) COMMENT '公开页说明文字' AFTER public_flag;

-- ---------- 21. 大屏控制端 ----------
DROP TABLE IF EXISTS screen_config;
CREATE TABLE screen_config (
  id                INT PRIMARY KEY AUTO_INCREMENT,
  competition_id    INT           NOT NULL,
  theme             VARCHAR(20)   NOT NULL DEFAULT 'DARK' COMMENT 'DARK深色 LIGHT浅色 BLUE蓝 RED红 GREEN绿',
  layout            VARCHAR(20)   NOT NULL DEFAULT 'MIXED' COMMENT 'MIXED综合 TEAM_SCORE团体总分 LATEST最新成绩 RECORD破纪录',
  queue_json        JSON          COMMENT '播放队列 [{type, event_item_id, band_id, seconds}]',
  loop_flag         TINYINT       NOT NULL DEFAULT 1,
  dwell_seconds     INT           NOT NULL DEFAULT 12 COMMENT '每屏停留秒数',
  show_team_score   TINYINT       NOT NULL DEFAULT 1,
  show_latest       TINYINT       NOT NULL DEFAULT 1,
  show_upcoming     TINYINT       NOT NULL DEFAULT 1,
  show_record       TINYINT       NOT NULL DEFAULT 1 COMMENT '破纪录滚动条',
  latest_count      INT           NOT NULL DEFAULT 12,
  refresh_seconds   INT           NOT NULL DEFAULT 30,
  insert_flag       TINYINT       NOT NULL DEFAULT 0 COMMENT '插播开关',
  insert_text       TEXT          COMMENT '插播内容',
  insert_until      DATETIME      COMMENT '插播截止时刻，过期自动关闭',
  updated_at        DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_comp (competition_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='大屏控制配置';

-- ---------- 补充既有表的字段 ----------
-- 达级汇总导出需要知道认定时间
ALTER TABLE grade_achievement
  ADD COLUMN confirmed_by VARCHAR(32) AFTER confirm_flag,
  ADD COLUMN confirmed_at DATETIME AFTER confirmed_by;

ALTER TABLE record_break
  ADD COLUMN confirmed_by VARCHAR(32) AFTER confirm_flag,
  ADD COLUMN confirmed_at DATETIME AFTER confirmed_by;

-- 纪录登记补一个"是否参与自动破纪录检测"开关
ALTER TABLE meet_record
  ADD COLUMN detect_flag TINYINT NOT NULL DEFAULT 1 COMMENT '1参与自动检测' AFTER status;

-- 索引
SET @db = DATABASE();
SET @i1 = (SELECT COUNT(*) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA=@db AND TABLE_NAME='competition' AND INDEX_NAME='uk_uuid');
SET @s1 = IF(@i1 = 0, 'ALTER TABLE competition ADD UNIQUE KEY uk_uuid (uuid)', 'DO 0');
PREPARE st1 FROM @s1; EXECUTE st1; DEALLOCATE PREPARE st1;

SELECT '第四期表结构迁移完成' AS msg;
