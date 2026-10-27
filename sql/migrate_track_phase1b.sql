-- 补漏：event_template 缺 admission_count / scoring_scheme / scoring_scheme_custom
-- 执行：mysql -ucompete -pCompete@2026 sport_compete < migrate_track_phase1b.sql

SET NAMES utf8mb4;

ALTER TABLE event_template
  ADD COLUMN admission_count       INT COMMENT '录取人数' AFTER has_preliminary,
  ADD COLUMN scoring_scheme        VARCHAR(30) COMMENT '计分方案码' AFTER result_aggregation_mode,
  ADD COLUMN scoring_scheme_custom VARCHAR(200) COMMENT '自定义计分：逗号分隔' AFTER scoring_scheme;

SELECT '补漏完成' AS result;
