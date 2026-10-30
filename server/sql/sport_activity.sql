-- 学校体育活动上报：主表（一个学校 × 一个学期 × 一个阶段 一条）
CREATE TABLE IF NOT EXISTS school_sport_report (
  id INT AUTO_INCREMENT PRIMARY KEY,
  school_id INT NOT NULL,
  term VARCHAR(16) NOT NULL COMMENT '学年学期，如 2026-2027-1',
  phase TINYINT NOT NULL DEFAULT 1 COMMENT '1学期初 2学期中 3学期末',
  status TINYINT NOT NULL DEFAULT 0 COMMENT '0草稿 1已提交 2已通过 3退回',

  -- 一、阳光大课间（含"是否落实15分钟"由 recess_minutes 自动判定）
  recess_enabled TINYINT DEFAULT 0,
  recess_minutes INT DEFAULT 0,
  recess_weekly INT DEFAULT 0,
  recess_forms VARCHAR(255) DEFAULT NULL,
  recess_scope VARCHAR(64) DEFAULT NULL,

  -- 二、每天体育活动时间（每天时长 = 体育课折算 + 大课间 + 课后活动）
  pe_weekly INT DEFAULT 0,
  pe_minutes INT DEFAULT 0,
  after_class_minutes INT DEFAULT 0,

  -- 三、校内竞赛（按学期统计）
  comp_count INT DEFAULT 0,
  comp_sports VARCHAR(255) DEFAULT NULL,
  comp_join_count INT DEFAULT 0,
  comp_desc TEXT,

  -- 四、武术进校园
  wushu_enabled TINYINT DEFAULT 0,
  wushu_forms VARCHAR(255) DEFAULT NULL,
  wushu_scope VARCHAR(64) DEFAULT NULL,
  wushu_weekly INT DEFAULT 0,
  wushu_teacher VARCHAR(64) DEFAULT NULL,
  wushu_desc TEXT,

  -- 五、体育作业
  hw_enabled TINYINT DEFAULT 0,
  hw_freq VARCHAR(32) DEFAULT NULL,
  hw_forms VARCHAR(255) DEFAULT NULL,
  hw_check VARCHAR(255) DEFAULT NULL,

  submitted_at DATETIME DEFAULT NULL,
  submitted_by VARCHAR(32) DEFAULT NULL,
  audited_at DATETIME DEFAULT NULL,
  audited_by VARCHAR(32) DEFAULT NULL,
  audit_note VARCHAR(500) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_school_term_phase (school_id, term, phase),
  KEY idx_term_phase (term, phase)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学校体育活动上报';

-- 图片（每个板块最多 3 张，单张 5MB 由上传接口限制）
CREATE TABLE IF NOT EXISTS school_sport_photo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  report_id INT NOT NULL,
  section VARCHAR(16) NOT NULL COMMENT 'recess/time/comp/wushu/hw',
  url VARCHAR(255) NOT NULL,
  sort_no INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_report_section (report_id, section)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='体育活动上报图片';
