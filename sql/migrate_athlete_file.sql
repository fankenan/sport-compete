-- ============================================================
-- 迁移：运动员增加照片与学籍表
-- 执行：mysql -ucompete -pCompete@2026 sport_compete < migrate_athlete_file.sql
-- ============================================================

SET NAMES utf8mb4;

-- 照片（前端压缩后的 base64，约 30-80KB）
ALTER TABLE athlete
  ADD COLUMN photo MEDIUMTEXT COMMENT '照片 base64 data URL' AFTER bib_no;

-- 学籍表（PDF 或图片的 base64）
ALTER TABLE athlete
  ADD COLUMN student_card MEDIUMTEXT COMMENT '学籍表 base64 data URL' AFTER photo;

-- 学籍表原始文件名，列表里显示附件名用
ALTER TABLE athlete
  ADD COLUMN student_card_name VARCHAR(255) COMMENT '学籍表文件名' AFTER student_card;

-- 学籍表 MIME 类型，决定前端用图片预览还是 PDF 预览
ALTER TABLE athlete
  ADD COLUMN student_card_type VARCHAR(64) COMMENT '学籍表 MIME 类型' AFTER student_card_name;

SELECT '迁移完成' AS result;
