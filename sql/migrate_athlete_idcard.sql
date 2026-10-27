-- ============================================================
-- 迁移：运动员增加身份证号（用于自动计算出生年月）
-- 执行：mysql -ucompete -pCompete@2026 sport_compete < migrate_athlete_idcard.sql
-- ============================================================

SET NAMES utf8mb4;

ALTER TABLE athlete
  ADD COLUMN id_card VARCHAR(18) COMMENT '身份证号，用于推算出生年月' AFTER student_no;

-- 便于按身份证查重
CREATE INDEX idx_id_card ON athlete (id_card);

SELECT '迁移完成' AS result;
