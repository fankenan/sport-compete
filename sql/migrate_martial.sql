-- ============================================================
-- 迁移：武术项目（评分制 / 名次制）
-- 日期：2026-11-03
--
-- 为什么单独建表而不复用田径的 track_heat / heat_entry / field_attempt
-- ------------------------------------------------------------
-- 武术比赛是**评分制**：多位裁判各自打分，去掉最高最低取平均，按总分排名。
-- 径赛的 track_heat 有 lane_no（道次）、heat_entry 有 bib_no（号码布），
-- field_attempt 是"试跳/试投明细"——语义都对不上，硬套会让以后维护的人抓狂。
--
-- 但**报名**复用 team_entry（学校组队，一校一队），所以武术和球类共用报名审核流程。
--
-- 流程：
--   报名审核(team_entry) → 编排出场顺序(martial_heat / martial_entry)
--   → 各裁判打分(martial_entry.scores_json) → 算分去极值 → 排名(rank_no)
--   → 确认(confirm_flag) → 秩序册 / 公开成绩页
-- ============================================================

-- ---- 武术轮次（一个赛次的一组，如"决赛第1组"） ----
CREATE TABLE IF NOT EXISTS martial_heat (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT          NOT NULL,
  band_id        INT          NOT NULL,
  event_item_id  INT          NOT NULL,
  round_code     VARCHAR(20)  NOT NULL DEFAULT 'FINAL'
                 COMMENT 'PRELIM预赛 SEMI复赛 FINAL决赛',
  round_no       TINYINT      NOT NULL DEFAULT 1 COMMENT '赛次序号',
  heat_no        TINYINT      NOT NULL DEFAULT 1 COMMENT '该赛次第几组',
  heat_name      VARCHAR(40)  COMMENT '如 决赛第1组',
  entry_count    INT          NOT NULL DEFAULT 0,
  judge_count    INT          NOT NULL DEFAULT 5 COMMENT '裁判人数（用于去极值）',
  plan_date      DATE         COMMENT '计划日期',
  plan_time      TIME         COMMENT '计划时刻',
  venue_id       INT          COMMENT '场地',
  status         TINYINT      NOT NULL DEFAULT 1
                 COMMENT '1待编排 2已编排 3评分中 4已确认',
  confirm_flag   TINYINT      NOT NULL DEFAULT 0 COMMENT '成绩已确认',
  confirmed_at   DATETIME,
  confirmed_by   VARCHAR(32),
  remark         VARCHAR(255),
  created_at     DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_martial_heat (event_item_id, band_id, round_code, heat_no),
  KEY idx_mh_comp (competition_id, event_item_id),
  KEY idx_mh_band (band_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='武术赛次分组';

-- ---- 参赛单位与成绩 ----
CREATE TABLE IF NOT EXISTS martial_entry (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  heat_id        INT          NOT NULL,
  competition_id INT          NOT NULL,
  band_id        INT          NOT NULL,
  event_item_id  INT          NOT NULL,
  school_id      INT          NOT NULL,
  team_name      VARCHAR(64)  NOT NULL COMMENT '代表队名称',
  leader_name    VARCHAR(32)  COMMENT '领队',
  order_no       INT          NOT NULL DEFAULT 0 COMMENT '出场顺序',
  scores_json    JSON         COMMENT '各裁判打分 [{"judge":"张三","score":9.5}]',
  total_score    DECIMAL(8,3) COMMENT '最终得分（去极值后平均）',
  score_detail   VARCHAR(255) COMMENT '算分明细，如 9.43（去 9.8/9.1）',
  rank_no        INT          COMMENT '名次',
  remark         VARCHAR(255),
  created_at     DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_me_heat (heat_id),
  KEY idx_me_comp (competition_id, event_item_id),
  KEY idx_me_school (school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='武术参赛单位与成绩';

-- ---- event_item 支持武术类别 ----
-- category: 1径赛 2田赛 3球类 4武术
-- （VARCHAR 存放，兼容新增类型而不必改列类型）
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_item'
               AND COLUMN_NAME = 'martial_judge_count');
SET @sql := IF(@col = 0,
  'ALTER TABLE event_item ADD COLUMN martial_judge_count INT NOT NULL DEFAULT 5 COMMENT ''武术裁判人数（用于去极值计算）''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_item'
               AND COLUMN_NAME = 'martial_minutes');
SET @sql := IF(@col = 0,
  'ALTER TABLE event_item ADD COLUMN martial_minutes INT NOT NULL DEFAULT 90 COMMENT ''单套演练时长上限（秒）''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_item'
               AND COLUMN_NAME = 'martial_drop_highest');
SET @sql := IF(@col = 0,
  'ALTER TABLE event_item ADD COLUMN martial_drop_highest TINYINT NOT NULL DEFAULT 1 COMMENT ''是否去掉最高分和最低分（1是）''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
