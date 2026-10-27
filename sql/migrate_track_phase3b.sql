-- 第三期补漏（可重复执行）

-- 1. 改名属于运动员级操作，不强制挂组别/项目
ALTER TABLE participant_change
  MODIFY COLUMN band_id INT NULL,
  MODIFY COLUMN event_item_id INT NULL;

-- 2. 索引（MySQL 不支持 ADD INDEX IF NOT EXISTS，用动态 SQL 做幂等）
SET @db = DATABASE();

SET @i1 = (SELECT COUNT(*) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA=@db AND TABLE_NAME='participant_change' AND INDEX_NAME='idx_pc_comp_type');
SET @s1 = IF(@i1 = 0,
  'ALTER TABLE participant_change ADD INDEX idx_pc_comp_type (competition_id, change_type)',
  'DO 0');
PREPARE st1 FROM @s1; EXECUTE st1; DEALLOCATE PREPARE st1;

SET @i2 = (SELECT COUNT(*) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA=@db AND TABLE_NAME='bib_number' AND INDEX_NAME='idx_bib_comp');
SET @s2 = IF(@i2 = 0,
  'ALTER TABLE bib_number ADD INDEX idx_bib_comp (competition_id, bib_no)',
  'DO 0');
PREPARE st2 FROM @s2; EXECUTE st2; DEALLOCATE PREPARE st2;

SET @i3 = (SELECT COUNT(*) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA=@db AND TABLE_NAME='score_announcement' AND INDEX_NAME='idx_sa_comp');
SET @s3 = IF(@i3 = 0,
  'ALTER TABLE score_announcement ADD INDEX idx_sa_comp (competition_id, publish_flag)',
  'DO 0');
PREPARE st3 FROM @s3; EXECUTE st3; DEALLOCATE PREPARE st3;

SELECT '第三期补漏完成' AS msg;
