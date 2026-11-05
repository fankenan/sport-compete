-- ============================================================
-- 迁移：补齐报名驳回原因 + 赛制扩展字段
-- 日期：2026-11-03
-- 用法：mysql -u<user> -p<pwd> <db> < sql/migrate_security_fields.sql
--       （重复执行会报错但不影响，可重复跑）
-- ============================================================

-- ---- athlete_entry 补 reject_reason ----
-- 原来个人报名被驳回时学校看不到原因（team_entry 有该列，athlete_entry 没有）
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'athlete_entry'
               AND COLUMN_NAME = 'reject_reason');
SET @sql := IF(@col = 0,
  'ALTER TABLE athlete_entry ADD COLUMN reject_reason VARCHAR(128) NULL COMMENT ''驳回原因''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- event_item：赛制扩展 ----
-- schedule_mode 原来只有 GROUP_KO / KO，现在扩到 4 档：
--   GROUP_KO  分组循环 + 淘汰（默认）
--   KO        纯淘汰，不分组
--   LEAGUE    联赛循环：不分组，所有队大循环，按总积分排名
--   ROUND     循环赛排名：只循环不淘汰，按积分出最终名次
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_item'
               AND COLUMN_NAME = 'schedule_mode');
SET @sql := IF(@col = 0,
  'ALTER TABLE event_item ADD COLUMN schedule_mode VARCHAR(16) NOT NULL DEFAULT ''GROUP_KO'' COMMENT ''赛制：GROUP_KO/KO/LEAGUE/ROUND''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- league_teams_per_match 等赛制参数（若不存在则补）
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_item'
               AND COLUMN_NAME = 'league_rank_rule');
SET @sql := IF(@col = 0,
  'ALTER TABLE event_item ADD COLUMN league_rank_rule TINYINT DEFAULT 1 COMMENT ''联赛排名规则：1积分 2净胜分 3胜场''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- 报名状态：允许「已驳回后重报」----
-- team_entry.reject_reason 已存在，确认一下（没有就补）
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'team_entry'
               AND COLUMN_NAME = 'reject_reason');
SET @sql := IF(@col = 0,
  'ALTER TABLE team_entry ADD COLUMN reject_reason VARCHAR(128) NULL COMMENT ''驳回原因''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- match_info：成绩确认字段 ----
-- 球类原来完全没有「确认」环节，裁判可以反复覆盖自己录过的比分，
-- 录完就直接上大屏。现在补一个与田径 track_heat.confirm_flag 一致的确认机制。
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'match_info'
               AND COLUMN_NAME = 'confirmed');
SET @sql := IF(@col = 0,
  'ALTER TABLE match_info ADD COLUMN confirmed TINYINT NOT NULL DEFAULT 0 COMMENT ''成绩已确认：1已确认''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'match_info'
               AND COLUMN_NAME = 'confirmed_at');
SET @sql := IF(@col = 0,
  'ALTER TABLE match_info ADD COLUMN confirmed_at DATETIME NULL COMMENT ''确认时间''',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- 索引优化：待排期场次查询 ----
SET @col := (SELECT COUNT(*) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'match_info'
               AND INDEX_NAME = 'idx_slot_stage');
SET @sql := IF(@col = 0,
  'ALTER TABLE match_info ADD INDEX idx_slot_stage (competition_id, slot_id, stage)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
