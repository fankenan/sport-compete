-- ============================================================
-- 第五期：日程与秩序册
--   22 日程可视化编排（单元 / 条目 / 自动排 / 拖拽 / 冲突检测）
--   23 秩序册章节编排 + 导出
--   24 奖状模板 + 批量生成打印
--   25 赛事改期 + 四把锁 + 流程节点
-- ============================================================

-- ---------- 22. 日程单元（半天：上午 / 下午 / 晚间）----------
DROP TABLE IF EXISTS schedule_unit;
CREATE TABLE schedule_unit (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT      NOT NULL,
  unit_date      DATE     NOT NULL COMMENT '单元日期',
  period         VARCHAR(10) NOT NULL DEFAULT 'AM' COMMENT 'AM上午 PM下午 NIGHT晚间 FULL全天',
  name           VARCHAR(64) COMMENT '单元名，如 第一天上午',
  start_time     TIME     COMMENT '单元开始时间',
  end_time       TIME     COMMENT '单元结束时间',
  sort_no        INT      NOT NULL DEFAULT 0,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_comp (competition_id, unit_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='日程单元';

-- ---------- 22b. 日程条目（把赛次排进具体时间）----------
DROP TABLE IF EXISTS timetable_item;
CREATE TABLE timetable_item (
  id                INT PRIMARY KEY AUTO_INCREMENT,
  competition_id    INT      NOT NULL,
  unit_id           INT      COMMENT '所属单元',
  venue_id          INT      COMMENT '场地',
  heat_id           INT      COMMENT '关联的赛次 track_heat.id',
  event_item_id     INT      NOT NULL,
  band_id           INT,
  round_code        VARCHAR(20),
  heat_no           INT,
  title             VARCHAR(128) COMMENT '显示标题，如 初中男子100米 预赛第1组',
  start_time        TIME     COMMENT '开始时刻',
  end_time          TIME     COMMENT '结束时刻',
  estimated_minutes INT      COMMENT '预计用时',
  participant_count INT      NOT NULL DEFAULT 0,
  locked_flag       TINYINT  NOT NULL DEFAULT 0 COMMENT '1锁定，自动排布时不动',
  conflict_flag     TINYINT  NOT NULL DEFAULT 0 COMMENT '1有冲突',
  conflict_note     VARCHAR(255),
  sort_no           INT      NOT NULL DEFAULT 0,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_heat (heat_id),
  KEY idx_comp (competition_id),
  KEY idx_unit (unit_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='日程条目';

-- ---------- 22c. 冲突记录 ----------
DROP TABLE IF EXISTS timetable_conflict;
CREATE TABLE timetable_conflict (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT      NOT NULL,
  conflict_type  VARCHAR(20) NOT NULL COMMENT 'VENUE场地重叠 ATHLETE兼项 REST休息不足',
  item_id        INT      NOT NULL,
  other_item_id  INT,
  athlete_id     INT      COMMENT '兼项冲突时涉及的人',
  athlete_name   VARCHAR(64),
  detail         VARCHAR(255),
  resolved_flag  TINYINT  NOT NULL DEFAULT 0,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_comp (competition_id, resolved_flag)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='日程冲突记录';

-- ---------- 23. 秩序册 ----------
DROP TABLE IF EXISTS order_book;
CREATE TABLE order_book (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT      NOT NULL,
  title          VARCHAR(128) COMMENT '秩序册标题',
  subtitle       VARCHAR(255) COMMENT '副标题',
  sections_json  JSON     COMMENT '章节编排 [{code,name,enabled,sort_no,options}]',
  cover_note     VARCHAR(255) COMMENT '封面说明',
  status         TINYINT  NOT NULL DEFAULT 0 COMMENT '0草稿 1已生成',
  generated_at   DATETIME,
  generated_by   VARCHAR(32),
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_comp (competition_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='秩序册';

-- ---------- 24. 奖状模板 ----------
DROP TABLE IF EXISTS certificate_template;
CREATE TABLE certificate_template (
  id               INT PRIMARY KEY AUTO_INCREMENT,
  competition_id   INT      NOT NULL,
  name             VARCHAR(64) NOT NULL COMMENT '模板名',
  template_type    VARCHAR(20) NOT NULL DEFAULT 'INDIVIDUAL' COMMENT 'INDIVIDUAL个人 TEAM团体 REFEREE裁判',
  page_size        VARCHAR(10) NOT NULL DEFAULT 'A4',
  orientation      VARCHAR(10) NOT NULL DEFAULT 'landscape',
  background_image VARCHAR(255) COMMENT '背景图',
  fields_json      JSON     COMMENT '字段布局 [{key,label,x,y,font_size,align,bold,color}]',
  remark           VARCHAR(255),
  sort_no          INT      NOT NULL DEFAULT 0,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_comp (competition_id, template_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='奖状模板';

-- ---------- 24b. 奖状记录 ----------
DROP TABLE IF EXISTS certificate_record;
CREATE TABLE certificate_record (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT      NOT NULL,
  template_id    INT      NOT NULL,
  source_type    VARCHAR(20) NOT NULL DEFAULT 'INDIVIDUAL',
  athlete_id     INT,
  school_id      INT,
  award_name     VARCHAR(128) COMMENT '奖项名，如 初中男子100米第一名',
  rank_no        INT,
  event_name     VARCHAR(64),
  band_label     VARCHAR(32),
  winner_name    VARCHAR(64),
  winner_school  VARCHAR(128),
  result_text    VARCHAR(32),
  printed_flag   TINYINT  NOT NULL DEFAULT 0,
  printed_at     DATETIME,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_comp (competition_id, template_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='奖状记录';

-- ---------- 25. 赛事流程节点 ----------
DROP TABLE IF EXISTS meet_flow_node;
CREATE TABLE meet_flow_node (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT      NOT NULL,
  node_code      VARCHAR(20) NOT NULL COMMENT 'ENROLL报名 ARRANGE编排 TIMETABLE日程 RACE比赛 SCORE统计 CLOSE闭幕',
  node_name      VARCHAR(64) NOT NULL,
  plan_date      DATE,
  plan_time      TIME,
  done_flag      TINYINT  NOT NULL DEFAULT 0,
  done_at        DATETIME,
  operator       VARCHAR(32),
  remark         VARCHAR(255),
  sort_no        INT      NOT NULL DEFAULT 0,
  KEY idx_comp (competition_id, sort_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='赛事流程节点';

-- ---------- 25b. 改期日志 ----------
DROP TABLE IF EXISTS meet_reschedule_log;
CREATE TABLE meet_reschedule_log (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT      NOT NULL,
  old_start_date DATE,
  old_end_date   DATE,
  new_start_date DATE,
  new_end_date   DATE,
  shift_days     INT      COMMENT '平移天数，正数往后',
  affected_units INT      NOT NULL DEFAULT 0 COMMENT '影响的日程单元数',
  affected_slots INT      NOT NULL DEFAULT 0 COMMENT '影响的球类时段数',
  affected_heats INT      NOT NULL DEFAULT 0 COMMENT '影响的田径赛次数',
  reason         VARCHAR(255),
  operation_by   VARCHAR(32),
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_comp (competition_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='赛事改期日志';

-- ---------- 25c. 锁操作日志 ----------
DROP TABLE IF EXISTS meet_lock_log;
CREATE TABLE meet_lock_log (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  competition_id INT      NOT NULL,
  lock_type      VARCHAR(20) NOT NULL COMMENT 'ENROLL报名 SCHEDULE编排 TIMETABLE日程 ORDER_BOOK秩序册',
  action         VARCHAR(10) NOT NULL COMMENT 'LOCK上锁 UNLOCK解锁',
  operation_by   VARCHAR(32),
  reason         VARCHAR(255),
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_comp (competition_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='赛事锁操作日志';

SELECT '第五期表结构迁移完成' AS msg;

-- ---------- 补漏（幂等）：非比赛项没有 event_item_id ----------
ALTER TABLE timetable_item MODIFY COLUMN event_item_id INT NULL;
SELECT '第五期补漏完成' AS msg2;
