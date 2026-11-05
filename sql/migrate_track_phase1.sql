-- ============================================================
-- 迁移：田径专项 · 第一期「数据底座」
-- 执行：mysql -ucompete -p<DB_PASSWORD> sport_compete < migrate_track_phase1.sql
-- 说明：全部用 ADD COLUMN，不改已有列；重复执行会报 duplicate，可用下面的
--       幂等存储过程思路，或先 SELECT 确认。此处为一次性迁移脚本。
-- ============================================================

SET NAMES utf8mb4;

-- ============================================================
-- 一、赛事表 competition 扩展
-- ============================================================

ALTER TABLE competition
  ADD COLUMN uuid              VARCHAR(40)  COMMENT '公开分享用 UUID（大屏/公开成绩页）' AFTER id,
  ADD COLUMN meet_level        TINYINT      NOT NULL DEFAULT 3 COMMENT '1国家级 2省级 3市级 4县级 5校级' AFTER stage,
  ADD COLUMN host_unit         VARCHAR(128) COMMENT '主办单位' AFTER end_date,
  ADD COLUMN venue             VARCHAR(128) COMMENT '比赛地点' AFTER host_unit,
  ADD COLUMN contact_person    VARCHAR(32)  COMMENT '联系人' AFTER venue,
  ADD COLUMN contact_phone     VARCHAR(20)  COMMENT '联系电话' AFTER contact_person,
  ADD COLUMN cover_image       VARCHAR(255) COMMENT '封面图 URL' AFTER contact_phone,
  ADD COLUMN logo              VARCHAR(255) COMMENT '赛事 Logo URL' AFTER cover_image,

  -- 场地与计时
  ADD COLUMN straight_lane_count TINYINT NOT NULL DEFAULT 8 COMMENT '直道道次数' AFTER logo,
  ADD COLUMN curve_lane_count    TINYINT NOT NULL DEFAULT 8 COMMENT '弯道道次数' AFTER straight_lane_count,
  ADD COLUMN track_timing_mode   VARCHAR(20) NOT NULL DEFAULT 'SIMPLE_MANUAL'
    COMMENT '计时方式：SIMPLE_MANUAL手计时 ELECTRONIC电计时 MANUAL_PLUS手计时+修正' AFTER curve_lane_count,

  -- 编排核心参数
  ADD COLUMN minimum_rest_minutes INT NOT NULL DEFAULT 30
    COMMENT '同一运动员两项之间的最小休息分钟（兼项冲突判定）' AFTER track_timing_mode,
  ADD COLUMN tie_score_mode       VARCHAR(20) NOT NULL DEFAULT 'RANK'
    COMMENT '并列得分处理：RANK按名次共享分 SHARE平分 NEXT跳号' AFTER minimum_rest_minutes,
  ADD COLUMN deduct_one_flag      TINYINT NOT NULL DEFAULT 0
    COMMENT '减一制录取：1=实际录取人数比配置少一人' AFTER tie_score_mode,

  -- 加分
  ADD COLUMN record_bonus_flag     TINYINT NOT NULL DEFAULT 0 COMMENT '破纪录加分开关' AFTER deduct_one_flag,
  ADD COLUMN record_bonus_strategy VARCHAR(20) COMMENT '破纪录加分策略：FIXED固定 PER_LEVEL按级别' AFTER record_bonus_flag,
  ADD COLUMN record_bonus_value    DECIMAL(6,2) COMMENT '破纪录加分值' AFTER record_bonus_strategy,
  ADD COLUMN grade_bonus_flag      TINYINT NOT NULL DEFAULT 0 COMMENT '达级加分开关' AFTER record_bonus_value,
  ADD COLUMN grade_bonus_strategy  VARCHAR(20) COMMENT '达级加分策略：FIXED固定 PER_LEVEL按等级' AFTER grade_bonus_flag,
  ADD COLUMN grade_bonus_value     DECIMAL(6,2) COMMENT '达级加分值' AFTER grade_bonus_strategy,

  -- 报名
  ADD COLUMN enroll_open_flag      TINYINT NOT NULL DEFAULT 0 COMMENT '报名对外开放' AFTER grade_bonus_value,
  ADD COLUMN enroll_start_time     DATETIME COMMENT '报名开始时间' AFTER enroll_open_flag,
  ADD COLUMN enroll_end_time       DATETIME COMMENT '报名截止时间' AFTER enroll_start_time,
  ADD COLUMN enroll_audit_flag     TINYINT NOT NULL DEFAULT 1 COMMENT '报名需审核' AFTER enroll_end_time,
  ADD COLUMN enroll_field_config   JSON COMMENT '自定义报名字段配置' AFTER enroll_audit_flag,
  ADD COLUMN enroll_material_config JSON COMMENT '报名材料要求（身份证/学籍卡等）' AFTER enroll_field_config,
  ADD COLUMN relay_temporary_selection_flag TINYINT NOT NULL DEFAULT 0
    COMMENT '接力允许临时选拔棒次' AFTER enroll_material_config,

  -- 四把锁
  ADD COLUMN enroll_lock_flag    TINYINT NOT NULL DEFAULT 0 COMMENT '报名锁定' AFTER relay_temporary_selection_flag,
  ADD COLUMN schedule_lock_flag  TINYINT NOT NULL DEFAULT 0 COMMENT '编排锁定' AFTER enroll_lock_flag,
  ADD COLUMN timetable_lock_flag TINYINT NOT NULL DEFAULT 0 COMMENT '日程锁定' AFTER schedule_lock_flag,
  ADD COLUMN order_book_lock_flag TINYINT NOT NULL DEFAULT 0 COMMENT '秩序册锁定' AFTER timetable_lock_flag;

-- 给现有赛事补 UUID
UPDATE competition SET uuid = REPLACE(UUID(), '-', '') WHERE uuid IS NULL OR uuid = '';
-- 理想情况下应唯一，加索引（若已有重复会失败，这里用普通索引）
ALTER TABLE competition ADD KEY idx_uuid (uuid);

-- ============================================================
-- 二、组别表 group_band 扩展（报名自动校验的基石）
-- ============================================================

ALTER TABLE group_band
  ADD COLUMN group_type             VARCHAR(20) NOT NULL DEFAULT 'NORMAL'
    COMMENT '分组类型：NORMAL普通 VIRTUAL虚拟组' AFTER gender,
  ADD COLUMN team_max_total_count   INT COMMENT '每队限报总人数' AFTER group_type,
  ADD COLUMN team_max_male_count    INT COMMENT '每队限报男生数' AFTER team_max_total_count,
  ADD COLUMN team_max_female_count  INT COMMENT '每队限报女生数' AFTER team_max_male_count,
  ADD COLUMN athlete_max_event_count INT COMMENT '每人限报项目数' AFTER team_max_female_count,
  ADD COLUMN birth_date_limit_flag  TINYINT NOT NULL DEFAULT 0 COMMENT '是否限制出生日期' AFTER athlete_max_event_count,
  ADD COLUMN birth_date_start       DATE COMMENT '出生日期下限' AFTER birth_date_limit_flag,
  ADD COLUMN birth_date_end         DATE COMMENT '出生日期上限' AFTER birth_date_start;

-- ============================================================
-- 三、项目表 event_item 扩展（田径核心）
-- ============================================================

ALTER TABLE event_item
  -- 项目类型与成绩形态
  ADD COLUMN event_type            VARCHAR(20) NOT NULL DEFAULT 'TRACK'
    COMMENT 'TRACK径赛 FIELD田赛 COMBINED全能 RELAY接力 BALL球类' AFTER category,
  ADD COLUMN result_entry_type     VARCHAR(20) NOT NULL DEFAULT 'TIME'
    COMMENT '成绩录入形式：TIME时间 DISTANCE远度 HEIGHT高度 POINT分值 SCORE比分' AFTER event_type,
  ADD COLUMN event_unit            VARCHAR(10) COMMENT '单位：秒(s) 米(m) 分 个' AFTER result_entry_type,
  ADD COLUMN is_higher_better      TINYINT NOT NULL DEFAULT 0
    COMMENT '1=数值越大越好（田赛） 0=越小越好（径赛）' AFTER event_unit,
  ADD COLUMN result_min_value      DECIMAL(10,3) COMMENT '成绩合理下限，防误录' AFTER is_higher_better,
  ADD COLUMN result_max_value      DECIMAL(10,3) COMMENT '成绩合理上限，防误录' AFTER result_min_value,
  ADD COLUMN result_decimal_places TINYINT NOT NULL DEFAULT 2 COMMENT '成绩小数位数' AFTER result_max_value,
  ADD COLUMN gender_requirement    VARCHAR(10) COMMENT 'M男 F女 A不限' AFTER result_decimal_places,

  -- 编排
  ADD COLUMN need_lane_order  TINYINT NOT NULL DEFAULT 1 COMMENT '是否需要排道次' AFTER gender_requirement,
  ADD COLUMN relay_leg_count  TINYINT NOT NULL DEFAULT 4 COMMENT '接力棒次数' AFTER need_lane_order,
  ADD COLUMN has_preliminary  TINYINT NOT NULL DEFAULT 0 COMMENT '是否有预赛' AFTER relay_leg_count,
  ADD COLUMN admission_count  INT COMMENT '录取人数（进入下一轮）' AFTER has_preliminary,
  ADD COLUMN estimated_unit_minutes INT COMMENT '单个单元预计用时（分钟），排日程用' AFTER admission_count,

  -- 田赛轮次
  ADD COLUMN base_attempt_count   TINYINT NOT NULL DEFAULT 3 COMMENT '基础试跳（投）次数' AFTER estimated_unit_minutes,
  ADD COLUMN extra_attempt_count  TINYINT NOT NULL DEFAULT 3 COMMENT '附加试跳（投）次数' AFTER base_attempt_count,
  ADD COLUMN extra_qualifier_count TINYINT COMMENT '进入后三轮的人数' AFTER extra_attempt_count,

  -- 计分
  ADD COLUMN result_aggregation_mode VARCHAR(20) NOT NULL DEFAULT 'BEST'
    COMMENT '取值方式：BEST取最好 AVG取平均 LAST取最后一次' AFTER extra_qualifier_count,
  ADD COLUMN scoring_scheme        VARCHAR(30) COMMENT '计分方案码（如 TRACK_9_7_6 / FIELD_STANDARD）' AFTER result_aggregation_mode,
  ADD COLUMN scoring_scheme_custom VARCHAR(200) COMMENT '自定义计分：逗号分隔，如 9,7,6,5,4,3,2,1' AFTER scoring_scheme,
  ADD COLUMN team_score_multiplier DECIMAL(5,2) NOT NULL DEFAULT 1 COMMENT '团体分倍数（接力常 2）' AFTER scoring_scheme_custom,

  -- 限报
  ADD COLUMN max_total_count  INT COMMENT '单项限报总人数' AFTER team_score_multiplier,
  ADD COLUMN max_male_count   INT COMMENT '单项限报男生数' AFTER max_total_count,
  ADD COLUMN max_female_count INT COMMENT '单项限报女生数' AFTER max_male_count,

  -- 全能
  ADD COLUMN combined_parent_id   INT COMMENT '全能父项目 id（子项填，父项为 0）' AFTER max_female_count,
  ADD COLUMN combined_item_name   VARCHAR(64) COMMENT '全能子项名称（如 100米）' AFTER combined_parent_id,
  ADD COLUMN combined_item_order  INT COMMENT '全能子项顺序' AFTER combined_item_name,

  -- 关联
  ADD COLUMN grade_standard_id INT COMMENT '关联等级标准 id（达级判定）' AFTER combined_item_order,
  ADD COLUMN template_id       INT COMMENT '来源项目模板 id' AFTER grade_standard_id,
  ADD COLUMN score_rule_id     INT COMMENT '关联评分规则 id' AFTER template_id,
  ADD COLUMN sort_no           INT NOT NULL DEFAULT 0 COMMENT '排序' AFTER score_rule_id;

ALTER TABLE event_item ADD KEY idx_parent (combined_parent_id);

-- 把已有项目按 category 回填 event_type：1径赛 2田赛 3球类
UPDATE event_item SET event_type = CASE category
  WHEN 1 THEN 'TRACK' WHEN 2 THEN 'FIELD' WHEN 3 THEN 'BALL' ELSE 'TRACK' END
WHERE event_type = 'TRACK';

-- 田赛默认越大越好，径赛默认越小越好
UPDATE event_item SET is_higher_better = 1 WHERE category = 2;
UPDATE event_item SET event_unit = CASE
  WHEN category = 1 THEN 's'
  WHEN category = 2 THEN 'm'
  ELSE NULL END
WHERE event_unit IS NULL;

-- ============================================================
-- 四、项目模板库 event_template（内置 + 自定义 + 公共）
-- ============================================================

DROP TABLE IF EXISTS event_template;
CREATE TABLE event_template (
  id                    INT PRIMARY KEY AUTO_INCREMENT,
  template_name         VARCHAR(64)  NOT NULL COMMENT '项目名称，如 男子100米',
  event_type            VARCHAR(20)  NOT NULL DEFAULT 'TRACK' COMMENT 'TRACK/FIELD/COMBINED/RELAY/BALL',
  category              TINYINT      NOT NULL COMMENT '1径赛 2田赛 3球类',
  gender                VARCHAR(10)  NOT NULL DEFAULT 'A' COMMENT 'M男 F女 A不限',
  result_entry_type     VARCHAR(20)  NOT NULL DEFAULT 'TIME' COMMENT 'TIME/DISTANCE/HEIGHT/POINT',
  event_unit            VARCHAR(10)  COMMENT '单位',
  is_higher_better      TINYINT      NOT NULL DEFAULT 0,
  result_min_value      DECIMAL(10,3),
  result_max_value      DECIMAL(10,3),
  result_decimal_places TINYINT      NOT NULL DEFAULT 2,
  need_lane_order       TINYINT      NOT NULL DEFAULT 1,
  relay_leg_count       TINYINT      DEFAULT 4,
  has_preliminary       TINYINT      NOT NULL DEFAULT 0,
  base_attempt_count    TINYINT      NOT NULL DEFAULT 3,
  extra_attempt_count   TINYINT      NOT NULL DEFAULT 3,
  extra_qualifier_count TINYINT,
  result_aggregation_mode VARCHAR(20) NOT NULL DEFAULT 'BEST',
  team_score_multiplier DECIMAL(5,2) NOT NULL DEFAULT 1,
  estimated_unit_minutes INT         COMMENT '预计用时（分钟）',
  combined_parent_id    INT          COMMENT '全能父模板 id',
  combined_item_order   INT          COMMENT '全能子项顺序',
  built_in_flag         TINYINT      NOT NULL DEFAULT 0 COMMENT '1内置模板（不可删）',
  public_flag           TINYINT      NOT NULL DEFAULT 0 COMMENT '1公共库模板（跨赛事可见）',
  owner_scope           VARCHAR(20)  NOT NULL DEFAULT 'SYSTEM' COMMENT 'SYSTEM系统 CUSTOM自定义',
  created_by            INT          COMMENT '创建人（自定义模板）',
  sort_no               INT          NOT NULL DEFAULT 0,
  status                TINYINT      NOT NULL DEFAULT 1,
  created_at            DATETIME     DEFAULT CURRENT_TIMESTAMP,
  KEY idx_type (event_type, category),
  KEY idx_scope (owner_scope, public_flag)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目模板库';

-- ============================================================
-- 五、评分表 score_table（查表 / 公式两种）
-- ============================================================

DROP TABLE IF EXISTS score_table_detail;
DROP TABLE IF EXISTS score_table;
CREATE TABLE score_table (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  table_name      VARCHAR(64) NOT NULL COMMENT '表名，如 男子100米全能评分',
  table_type      VARCHAR(20) NOT NULL DEFAULT 'COMBINED' COMMENT 'COMBINED全能 SINGLE单项',
  event_template_id INT       COMMENT '关联项目模板 id',
  event_key       VARCHAR(64) COMMENT '项目键，如 100M / LJ / SP（用于按项目取公式）',
  gender          VARCHAR(10) NOT NULL DEFAULT 'A' COMMENT 'M男 F女 A通用',
  calculation_type VARCHAR(20) NOT NULL DEFAULT 'FORMULA' COMMENT 'FORMULA公式 TABLE查表',
  formula_type    VARCHAR(30) COMMENT '公式类型：IaAF全能标准公式 LINEAR线性 CUSTOM自定义',
  coefficient_a   DECIMAL(18,8) COMMENT '系数 A',
  coefficient_b   DECIMAL(18,8) COMMENT '系数 B',
  coefficient_c   DECIMAL(18,8) COMMENT '系数 C',
  input_unit      VARCHAR(10) COMMENT '输入单位 s / m',
  rounding_mode   VARCHAR(20) NOT NULL DEFAULT 'FLOOR' COMMENT 'FLOOR向下 ROUND四舍五入 CEIL向上',
  timing_adjustment DECIMAL(6,3) COMMENT '计时修正值（手计时 +0.24）',
  built_in_flag   TINYINT     NOT NULL DEFAULT 0,
  owner_scope     VARCHAR(20) NOT NULL DEFAULT 'SYSTEM',
  created_by      INT,
  remark          VARCHAR(255),
  status          TINYINT     NOT NULL DEFAULT 1,
  created_at      DATETIME    DEFAULT CURRENT_TIMESTAMP,
  KEY idx_type (table_type, calculation_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='评分表（成绩换算积分）';

CREATE TABLE score_table_detail (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  score_table_id INT           NOT NULL,
  result_value   DECIMAL(10,3) NOT NULL COMMENT '成绩值（秒/米）',
  score_value    INT           NOT NULL COMMENT '对应分值',
  sort_no        INT           NOT NULL DEFAULT 0,
  KEY idx_table (score_table_id, result_value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='评分表明细（calculation_type=TABLE 时用）';

-- 项目-评分规则绑定
DROP TABLE IF EXISTS event_score_rule;
CREATE TABLE event_score_rule (
  id                 INT PRIMARY KEY AUTO_INCREMENT,
  event_item_id      INT          NOT NULL COMMENT '绑定 event_item.id',
  source_score_table_id INT       COMMENT '来源评分表 id',
  score_type         VARCHAR(20)  NOT NULL DEFAULT 'COMBINED' COMMENT 'COMBINED全能 SINGLE单项',
  calculation_type   VARCHAR(20)  NOT NULL DEFAULT 'FORMULA',
  formula_type       VARCHAR(30),
  coefficient_a      DECIMAL(18,8),
  coefficient_b      DECIMAL(18,8),
  coefficient_c      DECIMAL(18,8),
  input_unit         VARCHAR(10),
  rounding_mode      VARCHAR(20)  NOT NULL DEFAULT 'FLOOR',
  timing_adjustment  DECIMAL(6,3),
  status             TINYINT      NOT NULL DEFAULT 1,
  created_at         DATETIME     DEFAULT CURRENT_TIMESTAMP,
  KEY idx_event (event_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目评分规则';

-- ============================================================
-- 六、等级标准 grade_standard（达级用）
-- ============================================================

DROP TABLE IF EXISTS grade_standard_threshold;
DROP TABLE IF EXISTS grade_standard;
CREATE TABLE grade_standard (
  id               INT PRIMARY KEY AUTO_INCREMENT,
  standard_code    VARCHAR(32) NOT NULL COMMENT '标准代码，如 NATIONAL_2025',
  event_name       VARCHAR(64) NOT NULL COMMENT '项目名称',
  event_category   VARCHAR(20) COMMENT 'TRACK/FIELD/COMBINED',
  specification    VARCHAR(64) COMMENT '规格说明，如 100米/铅球(5kg)',
  gender           VARCHAR(10) NOT NULL DEFAULT 'A',
  result_unit      VARCHAR(10) COMMENT '成绩单位',
  result_direction VARCHAR(10) NOT NULL DEFAULT 'LOWER' COMMENT 'LOWER越小越好 HIGHER越大越好',
  result_entry_type VARCHAR(20) NOT NULL DEFAULT 'TIME',
  display_note     VARCHAR(255),
  source_document  VARCHAR(128) COMMENT '依据文件',
  status           TINYINT     NOT NULL DEFAULT 1,
  created_at       DATETIME    DEFAULT CURRENT_TIMESTAMP,
  KEY idx_code (standard_code),
  KEY idx_event (event_name, gender)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='运动员等级标准项';

CREATE TABLE grade_standard_threshold (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  standard_id    INT          NOT NULL,
  grade_code     VARCHAR(20)  NOT NULL COMMENT '等级：MASTER运动健将 L1一级 L2二级 L3三级 YOUTH少年级',
  grade_name     VARCHAR(32)  COMMENT '等级名称',
  result_value   DECIMAL(10,3) NOT NULL COMMENT '达标成绩',
  bonus_value    DECIMAL(6,2) COMMENT '该等级加分值',
  sort_no        INT          NOT NULL DEFAULT 0,
  KEY idx_std (standard_id, sort_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='等级达标阈值';

-- 赛事级达级加分规则
DROP TABLE IF EXISTS meet_grade_bonus_rule;
CREATE TABLE meet_grade_bonus_rule (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT          NOT NULL,
  grade_code     VARCHAR(20)  NOT NULL,
  grade_name     VARCHAR(32),
  event_category VARCHAR(20)  COMMENT '限定项目类别，空=不限',
  bonus_value    DECIMAL(6,2) NOT NULL DEFAULT 0,
  status         TINYINT      NOT NULL DEFAULT 1,
  created_at     DATETIME     DEFAULT CURRENT_TIMESTAMP,
  KEY idx_comp (competition_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='赛事达级加分规则';

-- 破纪录加分规则
DROP TABLE IF EXISTS meet_record_bonus_rule;
CREATE TABLE meet_record_bonus_rule (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT          NOT NULL,
  record_type    VARCHAR(20)  NOT NULL COMMENT 'MEET赛会纪录 HIGHEST最高纪录',
  event_category VARCHAR(20)  COMMENT '限定项目类别，空=不限',
  bonus_value    DECIMAL(6,2) NOT NULL DEFAULT 0,
  status         TINYINT      NOT NULL DEFAULT 1,
  created_at     DATETIME     DEFAULT CURRENT_TIMESTAMP,
  KEY idx_comp (competition_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='赛事破纪录加分规则';

-- 破纪录登记（赛会纪录 / 最高纪录 双轨）
DROP TABLE IF EXISTS meet_record;
CREATE TABLE meet_record (
  id                        INT PRIMARY KEY AUTO_INCREMENT,
  competition_id            INT          NOT NULL,
  band_id                   INT          COMMENT '组别，空=赛事级',
  event_item_id             INT          NOT NULL,
  gender                    VARCHAR(10)  COMMENT 'M男 F女',
  meet_record_value         VARCHAR(32)  COMMENT '赛会纪录·显示值（如 11"23）',
  meet_record_result_value  DECIMAL(10,3) COMMENT '赛会纪录·可比较数值',
  meet_record_holder        VARCHAR(64)  COMMENT '赛会纪录保持者',
  meet_record_unit          VARCHAR(10),
  meet_record_meet_name     VARCHAR(128) COMMENT '创造赛会纪录的赛事名',
  meet_record_date          DATE,
  highest_record_value      VARCHAR(32)  COMMENT '最高纪录·显示值',
  highest_record_result_value DECIMAL(10,3),
  highest_record_holder     VARCHAR(64),
  highest_record_unit       VARCHAR(10),
  highest_record_meet_name  VARCHAR(128),
  highest_record_date       DATE,
  sort_no                   INT          NOT NULL DEFAULT 0,
  status                    TINYINT      NOT NULL DEFAULT 1,
  created_at                DATETIME     DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_comp_event (competition_id, event_item_id, band_id),
  KEY idx_comp (competition_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='纪录登记（赛会纪录与最高纪录）';

-- 达级认定结果
DROP TABLE IF EXISTS grade_achievement;
CREATE TABLE grade_achievement (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT          NOT NULL,
  band_id        INT,
  event_item_id  INT          NOT NULL,
  athlete_id     INT          NOT NULL,
  athlete_name   VARCHAR(64),
  school_id      INT,
  team_name      VARCHAR(64),
  result_value   DECIMAL(10,3) COMMENT '成绩数值',
  result_text    VARCHAR(32)  COMMENT '成绩显示值',
  grade_code     VARCHAR(20)  COMMENT '认定等级',
  grade_name     VARCHAR(32),
  bonus_value    DECIMAL(6,2) NOT NULL DEFAULT 0,
  confirm_flag   TINYINT      NOT NULL DEFAULT 1 COMMENT '1已认定 0撤销',
  created_at     DATETIME     DEFAULT CURRENT_TIMESTAMP,
  KEY idx_comp (competition_id, event_item_id),
  KEY idx_athlete (athlete_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='达级认定结果';

-- 破纪录登记结果
DROP TABLE IF EXISTS record_break;
CREATE TABLE record_break (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT          NOT NULL,
  band_id        INT,
  event_item_id  INT          NOT NULL,
  athlete_id     INT          NOT NULL,
  athlete_name   VARCHAR(64),
  school_id      INT,
  team_name      VARCHAR(64),
  result_value   DECIMAL(10,3),
  result_text    VARCHAR(32),
  record_type    VARCHAR(20)  COMMENT 'MEET赛会 HIGHEST最高',
  old_value      VARCHAR(32)  COMMENT '原纪录',
  bonus_value    DECIMAL(6,2) NOT NULL DEFAULT 0,
  confirm_flag   TINYINT      NOT NULL DEFAULT 1,
  created_at     DATETIME     DEFAULT CURRENT_TIMESTAMP,
  KEY idx_comp (competition_id, event_item_id),
  KEY idx_athlete (athlete_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='破纪录登记结果';

SELECT '田径数据底座迁移完成' AS result;
