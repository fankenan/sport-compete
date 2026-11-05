-- ============================================================
-- 迁移：球类编排 · 从「固定时间槽」改为「连续时间轴」
-- 日期：2026-11-03
--
-- 背景
-- ----
-- 原来的 schedule_slot 是把「日期 × 场地」预先切成**等距格子**：
--     UNIQUE KEY uk_date_venue_slot (play_date, venue_id, slot_index)
-- 由此带来三个硬约束：
--     1) 一格只能一场（同一时间同一场地无法并行）
--     2) 每场时长写死（end = start + interval - 10，35 分钟一刀切）
--        —— event_item.match_minutes 字段在全后端零引用，就是被这个模型逼的
--     3) 「生成时间槽」成了所有编排的前置门槛，而这一步和"谁跟谁比"毫无关系
--
-- 改造后
-- ----
--   · 场次自带时间地点：match_info.play_date / start_time / end_time / venue_id
--   · schedule_slot 语义改为「**可用时间窗**」：当天某场地在某个时段可排比赛
--     （仍保留 slot_index 与唯一键，作为该场地当天的时段序号）
--   · 同一时间窗内可以排多场（只要不重叠），每场时长按项目的 match_minutes 决定
--   · match_info.slot_id 保留但不再用于新排期，老数据照常能读（前端有回退逻辑）
--
-- 用法：mysql -u<user> -p<pwd> sport_compete < sql/migrate_ball_timeline.sql
--       全部用 information_schema 判断后再 ALTER，可重复执行
-- ============================================================

-- ---- match_info 增加时间地点字段 ----
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'match_info'
               AND COLUMN_NAME = 'play_date');
SET @sql := IF(@col = 0,
  'ALTER TABLE match_info ADD COLUMN play_date DATE NULL COMMENT ''比赛日期''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'match_info'
               AND COLUMN_NAME = 'start_time');
SET @sql := IF(@col = 0,
  'ALTER TABLE match_info ADD COLUMN start_time TIME NULL COMMENT ''开始时间''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'match_info'
               AND COLUMN_NAME = 'end_time');
SET @sql := IF(@col = 0,
  'ALTER TABLE match_info ADD COLUMN end_time TIME NULL COMMENT ''结束时间''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'match_info'
               AND COLUMN_NAME = 'venue_id');
SET @sql := IF(@col = 0,
  'ALTER TABLE match_info ADD COLUMN venue_id INT NULL COMMENT ''场地''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'match_info'
               AND COLUMN_NAME = 'locked_flag');
SET @sql := IF(@col = 0,
  'ALTER TABLE match_info ADD COLUMN locked_flag TINYINT NOT NULL DEFAULT 0 COMMENT ''1锁定：自动排期时不移动''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- 排期查询索引 ----
SET @col := (SELECT COUNT(*) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'match_info'
               AND INDEX_NAME = 'idx_comp_day_venue');
SET @sql := IF(@col = 0,
  'ALTER TABLE match_info ADD INDEX idx_comp_day_venue (competition_id, play_date, venue_id)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'match_info'
               AND INDEX_NAME = 'idx_team_a');
SET @sql := IF(@col = 0,
  'ALTER TABLE match_info ADD INDEX idx_team_a (team_a_id)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'match_info'
               AND INDEX_NAME = 'idx_team_b');
SET @sql := IF(@col = 0,
  'ALTER TABLE match_info ADD INDEX idx_team_b (team_b_id)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- schedule_slot 语义扩展 ----
-- 加一个 kind 字段区分「可用时间窗」与「非比赛占位（开幕式/体测）」，
-- 老数据默认按可用时间窗处理（slot_type=1），不需要回填。
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schedule_slot'
               AND COLUMN_NAME = 'kind');
SET @sql := IF(@col = 0,
  'ALTER TABLE schedule_slot ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT ''WINDOW'' COMMENT ''WINDOW可用时间窗 PLACEHOLDER非比赛占位''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- 数据回填：把老数据从 slot 同步到新字段（一次性的，让甘特图能立刻用新字段渲染）----
-- 只回填还没有新字段、但有 slot_id 的记录；重复执行不会重复处理。
UPDATE match_info m
  JOIN schedule_slot s ON s.id = m.slot_id
SET m.play_date = s.play_date,
    m.venue_id   = s.venue_id,
    m.start_time = s.start_time,
    m.end_time   = s.end_time
WHERE m.play_date IS NULL
  AND m.slot_id IS NOT NULL;

-- ---- 事件：追加赛会级默认排期参数 ----
-- 每场之间的最短间隔（分钟）与每天的最晚结束时间，
-- 供自动排期使用；未配置时后端用默认值。
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'competition'
               AND COLUMN_NAME = 'match_gap_minutes');
SET @sql := IF(@col = 0,
  'ALTER TABLE competition ADD COLUMN match_gap_minutes INT NOT NULL DEFAULT 10 COMMENT ''两场比赛之间的最短间隔（分钟）''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'competition'
               AND COLUMN_NAME = 'minimum_rest_minutes');
SET @sql := IF(@col = 0,
  'ALTER TABLE competition ADD COLUMN minimum_rest_minutes INT NOT NULL DEFAULT 90 COMMENT ''同一队伍两场之间的最短间隔（分钟）''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
