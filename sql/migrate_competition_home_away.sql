-- 赛程编排：篮球主客场制开关
-- home_away = 1 时，同一对队伍可以安排多场比赛（主、客各一场），不再限制重复对阵
ALTER TABLE competition
  ADD COLUMN home_away TINYINT NOT NULL DEFAULT 0
  COMMENT '球类主客场制：0单循环 1主客场（允许同一对队伍多次对阵）' AFTER status;
