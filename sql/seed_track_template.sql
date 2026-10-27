-- ============================================================
-- 种子：内置田径项目模板 + 全能评分公式（国际田联标准公式）
-- 执行：mysql -ucompete -pCompete@2026 sport_compete < seed_track_template.sql
-- 说明：先执行 migrate_track_phase1.sql
-- ============================================================

SET NAMES utf8mb4;

-- 清空内置模板（只清 SYSTEM 的，不动用户自定义）
DELETE FROM event_template WHERE owner_scope = 'SYSTEM';
DELETE FROM score_table WHERE owner_scope = 'SYSTEM';

-- ============================================================
-- 一、径赛项目模板
-- ============================================================

INSERT INTO event_template
  (template_name, event_type, category, gender, result_entry_type, event_unit,
   is_higher_better, result_min_value, result_max_value, result_decimal_places,
   need_lane_order, has_preliminary, estimated_unit_minutes,
   built_in_flag, public_flag, owner_scope, sort_no, status)
VALUES
  ('50米',   'TRACK', 1, 'A', 'TIME', 's', 0,  5,   15,   2, 1, 1, 6,  1, 1, 'SYSTEM', 10, 1),
  ('60米',   'TRACK', 1, 'A', 'TIME', 's', 0,  6,   18,   2, 1, 1, 6,  1, 1, 'SYSTEM', 20, 1),
  ('100米',  'TRACK', 1, 'A', 'TIME', 's', 0,  9,   25,   2, 1, 1, 8,  1, 1, 'SYSTEM', 30, 1),
  ('200米',  'TRACK', 1, 'A', 'TIME', 's', 0,  20,  45,   2, 1, 1, 10, 1, 1, 'SYSTEM', 40, 1),
  ('400米',  'TRACK', 1, 'A', 'TIME', 's', 0,  45,  90,   2, 1, 1, 12, 1, 1, 'SYSTEM', 50, 1),
  ('800米',  'TRACK', 1, 'A', 'TIME', 's', 0,  100, 240,  2, 0, 1, 15, 1, 1, 'SYSTEM', 60, 1),
  ('1000米', 'TRACK', 1, 'A', 'TIME', 's', 0,  130, 300,  2, 0, 0, 18, 1, 1, 'SYSTEM', 70, 1),
  ('1500米', 'TRACK', 1, 'A', 'TIME', 's', 0,  200, 500,  2, 0, 0, 22, 1, 1, 'SYSTEM', 80, 1),
  ('3000米', 'TRACK', 1, 'A', 'TIME', 's', 0,  450, 1100, 2, 0, 0, 30, 1, 1, 'SYSTEM', 90, 1),
  ('5000米', 'TRACK', 1, 'A', 'TIME', 's', 0,  750, 2000, 2, 0, 0, 40, 1, 1, 'SYSTEM', 100, 1),
  ('110米栏', 'TRACK', 1, 'M', 'TIME', 's', 0, 12,  30,   2, 1, 0, 10, 1, 1, 'SYSTEM', 110, 1),
  ('100米栏', 'TRACK', 1, 'F', 'TIME', 's', 0, 12,  30,   2, 1, 0, 10, 1, 1, 'SYSTEM', 120, 1),
  ('400米栏', 'TRACK', 1, 'A', 'TIME', 's', 0, 50,  120,  2, 1, 0, 14, 1, 1, 'SYSTEM', 130, 1);

-- ============================================================
-- 二、接力项目模板
-- ============================================================

INSERT INTO event_template
  (template_name, event_type, category, gender, result_entry_type, event_unit,
   is_higher_better, result_decimal_places, need_lane_order, relay_leg_count,
   has_preliminary, team_score_multiplier, estimated_unit_minutes,
   built_in_flag, public_flag, owner_scope, sort_no, status)
VALUES
  ('4×100米接力', 'RELAY', 1, 'A', 'TIME', 's', 0, 2, 1, 4, 1, 2.00, 12, 1, 1, 'SYSTEM', 200, 1),
  ('4×400米接力', 'RELAY', 1, 'A', 'TIME', 's', 0, 2, 1, 4, 0, 2.00, 20, 1, 1, 'SYSTEM', 210, 1),
  ('4×50米接力',  'RELAY', 1, 'A', 'TIME', 's', 0, 2, 1, 4, 1, 2.00, 10, 1, 1, 'SYSTEM', 190, 1);

-- ============================================================
-- 三、田赛项目模板
-- ============================================================

INSERT INTO event_template
  (template_name, event_type, category, gender, result_entry_type, event_unit,
   is_higher_better, result_min_value, result_max_value, result_decimal_places,
   need_lane_order, has_preliminary, base_attempt_count, extra_attempt_count,
   extra_qualifier_count, result_aggregation_mode, estimated_unit_minutes,
   built_in_flag, public_flag, owner_scope, sort_no, status)
VALUES
  ('跳高',     'FIELD', 2, 'A', 'HEIGHT',   'm', 1, 0.5,  2.60, 2, 0, 0, 3, 3, 8, 'BEST', 60, 1, 1, 'SYSTEM', 300, 1),
  ('跳远',     'FIELD', 2, 'A', 'DISTANCE', 'm', 1, 1.0,  9.00, 2, 0, 1, 3, 3, 8, 'BEST', 45, 1, 1, 'SYSTEM', 310, 1),
  ('三级跳远', 'FIELD', 2, 'A', 'DISTANCE', 'm', 1, 3.0,  19.0, 2, 0, 0, 3, 3, 8, 'BEST', 50, 1, 1, 'SYSTEM', 320, 1),
  ('撑杆跳高', 'FIELD', 2, 'A', 'HEIGHT',   'm', 1, 1.0,  6.50, 2, 0, 0, 3, 3, 8, 'BEST', 90, 1, 1, 'SYSTEM', 330, 1),
  ('铅球',     'FIELD', 2, 'A', 'DISTANCE', 'm', 1, 3.0,  25.0, 2, 0, 0, 3, 3, 8, 'BEST', 45, 1, 1, 'SYSTEM', 340, 1),
  ('铁饼',     'FIELD', 2, 'A', 'DISTANCE', 'm', 1, 10.0, 75.0, 2, 0, 0, 3, 3, 8, 'BEST', 50, 1, 1, 'SYSTEM', 350, 1),
  ('标枪',     'FIELD', 2, 'A', 'DISTANCE', 'm', 1, 10.0, 100.0, 2, 0, 0, 3, 3, 8, 'BEST', 55, 1, 1, 'SYSTEM', 360, 1),
  ('实心球',   'FIELD', 2, 'A', 'DISTANCE', 'm', 1, 3.0,  20.0, 2, 0, 0, 3, 3, 8, 'BEST', 40, 1, 1, 'SYSTEM', 370, 1),
  ('垒球',     'FIELD', 2, 'A', 'DISTANCE', 'm', 1, 10.0, 80.0, 2, 0, 0, 3, 3, 8, 'BEST', 40, 1, 1, 'SYSTEM', 380, 1);

-- ============================================================
-- 四、全能项目（父模板 + 子项）
-- ============================================================

-- 4.1 男子五项全能：跳远、铅球、200米、跳高、1500米
INSERT INTO event_template
  (template_name, event_type, category, gender, result_entry_type, event_unit,
   is_higher_better, result_decimal_places, need_lane_order, has_preliminary,
   team_score_multiplier, estimated_unit_minutes,
   built_in_flag, public_flag, owner_scope, sort_no, status)
VALUES ('男子五项全能', 'COMBINED', 2, 'M', 'POINT', '分', 1, 0, 0, 0, 1.00, 200, 1, 1, 'SYSTEM', 500, 1);
SET @m5 := LAST_INSERT_ID();

INSERT INTO event_template
  (template_name, event_type, category, gender, result_entry_type, event_unit,
   is_higher_better, result_decimal_places, need_lane_order, has_preliminary,
   combined_parent_id, combined_item_order, estimated_unit_minutes,
   built_in_flag, public_flag, owner_scope, sort_no, status)
VALUES
  ('五项·跳远',   'FIELD', 2, 'M', 'DISTANCE', 'm', 1, 2, 0, 1, @m5, 1, 45, 1, 1, 'SYSTEM', 501, 1),
  ('五项·铅球',   'FIELD', 2, 'M', 'DISTANCE', 'm', 1, 2, 0, 0, @m5, 2, 45, 1, 1, 'SYSTEM', 502, 1),
  ('五项·200米',  'TRACK', 1, 'M', 'TIME', 's', 0, 2, 1, 1, @m5, 3, 10, 1, 1, 'SYSTEM', 503, 1),
  ('五项·跳高',   'FIELD', 2, 'M', 'HEIGHT', 'm', 1, 2, 0, 0, @m5, 4, 60, 1, 1, 'SYSTEM', 504, 1),
  ('五项·1500米', 'TRACK', 1, 'M', 'TIME', 's', 0, 2, 0, 0, @m5, 5, 22, 1, 1, 'SYSTEM', 505, 1);

-- 4.2 女子五项全能：100米栏、铅球、跳高、跳远、800米
INSERT INTO event_template
  (template_name, event_type, category, gender, result_entry_type, event_unit,
   is_higher_better, result_decimal_places, need_lane_order, has_preliminary,
   team_score_multiplier, estimated_unit_minutes,
   built_in_flag, public_flag, owner_scope, sort_no, status)
VALUES ('女子五项全能', 'COMBINED', 2, 'F', 'POINT', '分', 1, 0, 0, 0, 1.00, 200, 1, 1, 'SYSTEM', 510, 1);
SET @w5 := LAST_INSERT_ID();

INSERT INTO event_template
  (template_name, event_type, category, gender, result_entry_type, event_unit,
   is_higher_better, result_decimal_places, need_lane_order, has_preliminary,
   combined_parent_id, combined_item_order, estimated_unit_minutes,
   built_in_flag, public_flag, owner_scope, sort_no, status)
VALUES
  ('五项·100米栏', 'TRACK', 1, 'F', 'TIME', 's', 0, 2, 1, 0, @w5, 1, 10, 1, 1, 'SYSTEM', 511, 1),
  ('五项·铅球',    'FIELD', 2, 'F', 'DISTANCE', 'm', 1, 2, 0, 0, @w5, 2, 45, 1, 1, 'SYSTEM', 512, 1),
  ('五项·跳高',    'FIELD', 2, 'F', 'HEIGHT', 'm', 1, 2, 0, 0, @w5, 3, 60, 1, 1, 'SYSTEM', 513, 1),
  ('五项·跳远',    'FIELD', 2, 'F', 'DISTANCE', 'm', 1, 2, 0, 1, @w5, 4, 45, 1, 1, 'SYSTEM', 514, 1),
  ('五项·800米',   'TRACK', 1, 'F', 'TIME', 's', 0, 2, 0, 0, @w5, 5, 15, 1, 1, 'SYSTEM', 515, 1);

-- 4.3 男子三项全能：100米、跳远、铅球
INSERT INTO event_template
  (template_name, event_type, category, gender, result_entry_type, event_unit,
   is_higher_better, result_decimal_places, need_lane_order, has_preliminary,
   team_score_multiplier, estimated_unit_minutes,
   built_in_flag, public_flag, owner_scope, sort_no, status)
VALUES ('男子三项全能', 'COMBINED', 2, 'M', 'POINT', '分', 1, 0, 0, 0, 1.00, 120, 1, 1, 'SYSTEM', 520, 1);
SET @m3 := LAST_INSERT_ID();

INSERT INTO event_template
  (template_name, event_type, category, gender, result_entry_type, event_unit,
   is_higher_better, result_decimal_places, need_lane_order, has_preliminary,
   combined_parent_id, combined_item_order, estimated_unit_minutes,
   built_in_flag, public_flag, owner_scope, sort_no, status)
VALUES
  ('三项·100米', 'TRACK', 1, 'M', 'TIME', 's', 0, 2, 1, 1, @m3, 1, 8,  1, 1, 'SYSTEM', 521, 1),
  ('三项·跳远',  'FIELD', 2, 'M', 'DISTANCE', 'm', 1, 2, 0, 1, @m3, 2, 45, 1, 1, 'SYSTEM', 522, 1),
  ('三项·铅球',  'FIELD', 2, 'M', 'DISTANCE', 'm', 1, 2, 0, 0, @m3, 3, 45, 1, 1, 'SYSTEM', 523, 1);

-- 4.4 女子三项全能：100米、跳远、铅球
INSERT INTO event_template
  (template_name, event_type, category, gender, result_entry_type, event_unit,
   is_higher_better, result_decimal_places, need_lane_order, has_preliminary,
   team_score_multiplier, estimated_unit_minutes,
   built_in_flag, public_flag, owner_scope, sort_no, status)
VALUES ('女子三项全能', 'COMBINED', 2, 'F', 'POINT', '分', 1, 0, 0, 0, 1.00, 120, 1, 1, 'SYSTEM', 530, 1);
SET @w3 := LAST_INSERT_ID();

INSERT INTO event_template
  (template_name, event_type, category, gender, result_entry_type, event_unit,
   is_higher_better, result_decimal_places, need_lane_order, has_preliminary,
   combined_parent_id, combined_item_order, estimated_unit_minutes,
   built_in_flag, public_flag, owner_scope, sort_no, status)
VALUES
  ('三项·100米', 'TRACK', 1, 'F', 'TIME', 's', 0, 2, 1, 1, @w3, 1, 8,  1, 1, 'SYSTEM', 531, 1),
  ('三项·跳远',  'FIELD', 2, 'F', 'DISTANCE', 'm', 1, 2, 0, 1, @w3, 2, 45, 1, 1, 'SYSTEM', 532, 1),
  ('三项·铅球',  'FIELD', 2, 'F', 'DISTANCE', 'm', 1, 2, 0, 0, @w3, 3, 45, 1, 1, 'SYSTEM', 533, 1);

-- ============================================================
-- 五、全能评分公式（国际田联 World Athletics 标准公式）
--   径赛：P = A × (B − T)^C        （T = 成绩秒数）
--   田赛：P = A × (M − B)^C        （M = 成绩，跳高/跳远为厘米，投掷为米）
-- ============================================================

-- 5.1 男子径赛
INSERT INTO score_table
  (table_name, table_type, event_key, gender, calculation_type, formula_type,
   coefficient_a, coefficient_b, coefficient_c, input_unit, rounding_mode,
   built_in_flag, owner_scope, remark, status)
VALUES
  ('男子100米全能评分',  'COMBINED', '100M',  'M', 'FORMULA', 'IaAF', 25.4347,  18.0,  1.810, 's',  'FLOOR', 1, 'SYSTEM', '国际田联标准公式 P=A×(B−T)^C', 1),
  ('男子200米全能评分',  'COMBINED', '200M',  'M', 'FORMULA', 'IaAF',  5.8425,  38.0,  1.810, 's',  'FLOOR', 1, 'SYSTEM', '国际田联标准公式', 1),
  ('男子400米全能评分',  'COMBINED', '400M',  'M', 'FORMULA', 'IaAF',  1.53775, 82.0,  1.810, 's',  'FLOOR', 1, 'SYSTEM', '国际田联标准公式', 1),
  ('男子800米全能评分',  'COMBINED', '800M',  'M', 'FORMULA', 'IaAF',  2.14000, 210.0, 1.410, 's',  'FLOOR', 1, 'SYSTEM', '国际田联标准公式', 1),
  ('男子1500米全能评分', 'COMBINED', '1500M', 'M', 'FORMULA', 'IaAF',  0.03768, 480.0, 1.850, 's',  'FLOOR', 1, 'SYSTEM', '国际田联标准公式', 1),
  ('男子110米栏全能评分','COMBINED', '110MH', 'M', 'FORMULA', 'IaAF',  5.74352, 28.5,  1.920, 's',  'FLOOR', 1, 'SYSTEM', '国际田联标准公式', 1);

-- 5.2 男子田赛
INSERT INTO score_table
  (table_name, table_type, event_key, gender, calculation_type, formula_type,
   coefficient_a, coefficient_b, coefficient_c, input_unit, rounding_mode,
   built_in_flag, owner_scope, remark, status)
VALUES
  ('男子跳远全能评分',   'COMBINED', 'LJ',  'M', 'FORMULA', 'IaAF',  0.14354, 220.0, 1.400, 'cm', 'FLOOR', 1, 'SYSTEM', '成绩单位厘米', 1),
  ('男子跳高全能评分',   'COMBINED', 'HJ',  'M', 'FORMULA', 'IaAF',  0.8465,  75.0,  1.420, 'cm', 'FLOOR', 1, 'SYSTEM', '成绩单位厘米', 1),
  ('男子铅球全能评分',   'COMBINED', 'SP',  'M', 'FORMULA', 'IaAF', 51.39,    1.50,  1.050, 'm',  'FLOOR', 1, 'SYSTEM', '成绩单位米', 1),
  ('男子铁饼全能评分',   'COMBINED', 'DT',  'M', 'FORMULA', 'IaAF', 12.91,    4.00,  1.100, 'm',  'FLOOR', 1, 'SYSTEM', '成绩单位米', 1),
  ('男子标枪全能评分',   'COMBINED', 'JT',  'M', 'FORMULA', 'IaAF', 10.14,    7.00,  1.080, 'm',  'FLOOR', 1, 'SYSTEM', '成绩单位米', 1),
  ('男子撑杆跳高全能评分','COMBINED', 'PV',  'M', 'FORMULA', 'IaAF',  0.2797,  100.0, 1.350, 'cm', 'FLOOR', 1, 'SYSTEM', '成绩单位厘米', 1);

-- 5.3 女子径赛
INSERT INTO score_table
  (table_name, table_type, event_key, gender, calculation_type, formula_type,
   coefficient_a, coefficient_b, coefficient_c, input_unit, rounding_mode,
   built_in_flag, owner_scope, remark, status)
VALUES
  ('女子100米全能评分',  'COMBINED', '100M',  'F', 'FORMULA', 'IaAF', 17.857,   21.0,  1.810, 's', 'FLOOR', 1, 'SYSTEM', '国际田联标准公式', 1),
  ('女子200米全能评分',  'COMBINED', '200M',  'F', 'FORMULA', 'IaAF',  4.99087, 42.5,  1.810, 's', 'FLOOR', 1, 'SYSTEM', '国际田联标准公式', 1),
  ('女子400米全能评分',  'COMBINED', '400M',  'F', 'FORMULA', 'IaAF',  1.34285, 91.7,  1.810, 's', 'FLOOR', 1, 'SYSTEM', '国际田联标准公式', 1),
  ('女子800米全能评分',  'COMBINED', '800M',  'F', 'FORMULA', 'IaAF',  0.11193, 254.0, 1.880, 's', 'FLOOR', 1, 'SYSTEM', '国际田联标准公式', 1),
  ('女子100米栏全能评分','COMBINED', '100MH', 'F', 'FORMULA', 'IaAF',  9.23076, 26.7,  1.835, 's', 'FLOOR', 1, 'SYSTEM', '国际田联标准公式', 1);

-- 5.4 女子田赛
INSERT INTO score_table
  (table_name, table_type, event_key, gender, calculation_type, formula_type,
   coefficient_a, coefficient_b, coefficient_c, input_unit, rounding_mode,
   built_in_flag, owner_scope, remark, status)
VALUES
  ('女子跳远全能评分', 'COMBINED', 'LJ', 'F', 'FORMULA', 'IaAF',  0.188807, 210.0, 1.410, 'cm', 'FLOOR', 1, 'SYSTEM', '成绩单位厘米', 1),
  ('女子跳高全能评分', 'COMBINED', 'HJ', 'F', 'FORMULA', 'IaAF',  1.84523,  75.0,  1.348, 'cm', 'FLOOR', 1, 'SYSTEM', '成绩单位厘米', 1),
  ('女子铅球全能评分', 'COMBINED', 'SP', 'F', 'FORMULA', 'IaAF', 56.0211,   1.50,  1.050, 'm',  'FLOOR', 1, 'SYSTEM', '成绩单位米', 1),
  ('女子铁饼全能评分', 'COMBINED', 'DT', 'F', 'FORMULA', 'IaAF', 12.3311,   3.00,  1.100, 'm',  'FLOOR', 1, 'SYSTEM', '成绩单位米', 1),
  ('女子标枪全能评分', 'COMBINED', 'JT', 'F', 'FORMULA', 'IaAF', 15.9803,   3.80,  1.040, 'm',  'FLOOR', 1, 'SYSTEM', '成绩单位米', 1);

SELECT
  (SELECT COUNT(*) FROM event_template WHERE owner_scope = 'SYSTEM') AS 模板数,
  (SELECT COUNT(*) FROM score_table   WHERE owner_scope = 'SYSTEM') AS 评分公式数;
