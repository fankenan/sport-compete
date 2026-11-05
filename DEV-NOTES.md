# DEV-NOTES · 校园体育竞赛管理系统

> 这份文件**跟着源码走**，换工作区、换机器、推到 GitHub 都不会丢。
> 新会话开始时让 AI 先读这里，能立刻接上手。

## 一、系统与运行地址

| 项 | 值 |
|---|---|
| 内网服务器 | `10.128.1.45`（账号 single，Ubuntu 24.04，主机名 ceshi） |
| 后端源码 | `/home/single/sport-compete/server`，端口 `4100`，systemd `sport-compete-backend` |
| 前端产物 | `/home/single/sport-compete/frontend/dist`（Express 同时托管） |
| 外网入口 | `http://150.158.39.237:8083`（腾讯云 nginx，静态页 + `/api` 转发） |
| 腾讯云静态目录 | `/var/www/sport-compete` |
| 数据库 | MySQL，仅 `127.0.0.1:3306`，库 `sport_compete`（59 张表） |

**凭据不在仓库里**：SSH 用本机 `~/.ssh/config`；DB 账号与 `JWT_SECRET` 在服务器 `server/.env`。
**服务器上没有前端源码**，只有 dist——前端源码只在本机与 GitHub，务必保持仓库最新。

> ⚠️ **2026-11-03 起 `JWT_SECRET` 变成硬性要求**：
> 之前 `middleware/auth.js` 里有硬编码兜底 `'sport-compete-<已废弃的旧口令>'`，
> 任何人知道这串字符串就能自己签一个 `role=1`（管理员）的 token 调用所有管理接口。
> 现在改成**缺失即拒绝启动**。部署前必须先在 `server/.env` 配好：
> ```
> JWT_SECRET=<openssl rand -hex 32 的结果>
> ```
> 旧服务器上如果 `.env` 里本来就有 `JWT_SECRET`，直接沿用即可；没有的话必须补。

## 二、起服务与部署

```bash
# 本地开发
cd server && npm install && node index.js          # 注意依赖含 pdfkit
cd frontend && npm install && npm run dev          # vite 已代理 /api → 4100

# 上线：两处 dist 必须同时更新
cd frontend && npm run build
python deploy_fix_1027.py                          # 推内网机 + 腾讯云 + 重启服务
```

运维：`systemctl status sport-compete-backend`、`journalctl -u sport-compete-backend -n 50`

## 三、数据结构铁律

- **`schedule_slot` 与 `match_info` 之间没有外键**。删除槽位/场次必须手动级联：
  `match_result` → `match_referee` → `match_info` → `schedule_slot`。漏删会留孤儿数据。
- `match_info` 的项目字段叫 **`event_item_id`**，不叫 `event_id`；组别是 `band_id`。
- 占位槽 `slot_type=2`（开幕式/体测），比赛槽 `slot_type=1`。
- 项目表 `event_item.home_away=1` 表示主客场双循环（允许同一对队伍打多场）。
- 甘特图接口返回的 `start_time` / `end_time` 是 **`HH:mm`**（后端 slice 过，没秒）。

## 四、踩过的坑（别再犯）

**前端**

1. `http.get(url, { 参数 })` —— 第二参数是 axios **config 不是 query 参数**，参数根本不会拼到 URL，
   导致后端一直报"缺少参数"而前端静默失败（曾造成主客场开关一开就弹回）。必须写 `{ params: { ... } }`。
2. `animation-fill-mode: both` 会永久保留 transform，使该元素成为 `position: fixed` 的包含块，
   弹窗会被裁到页面里 → 入场动画一律用 `backwards`。
3. TDesign Dialog/Drawer **默认不 teleport**，就地渲染会被祖先的 transform/宽度裁剪 → 统一 `attach="body"`。
4. SFC 模板里 `a || b ?? c` 编译报错，必须写成 `a || (b ?? c)`。
5. 顶部筛选只影响比赛卡片显示，**时间槽是全赛事共享资源**不受筛选影响；筛选隐藏比赛时页面要给出"另有 N 场被隐藏"提示，否则用户以为赛程丢了。

**后端 / 数据 / 运维**

6. 造占位的 `/schedule/block` 要求"该场地当天已有时间槽"，空白日期会直接报 400。
7. `mysql -N -e` 多列输出是**制表符**分隔，Python 脚本判断前要 `.replace('\t', '|')`，否则 `in row` 恒为 false。
8. 本机 PortableGit `git push` 报 `remote helper 'https' aborted session`，dulwich 也不稳 —— **一律在服务器上推送**。
9. 部署换 dist 文件名后，旧 SPA 会话请求旧 chunk 会 404 导致页面打不开，已由 `router.onError` 自动 reload 兜底，
   但用户最好 Ctrl+F5 强刷一次。

**测试约定**

10. 破坏性接口（批量删除、清除整段）的实测一律**新建临时赛事隔离**（名称 `__clear_time_test__` 之类），
    跑完全部删除，绝不用真实赛程试手。

## 五、2026-10-27 本轮改动记录

| # | 内容 | 关键文件 |
|---|---|---|
| 1 | 全站 44 个弹窗/抽屉改 `attach="body"`，弹窗不再被裁剪 | 13 个视图 + `attach_dialog_body.py` |
| 2 | 分组编排挂载即回显，自动定位到已有分组的项目 | `views/Grouping.vue` |
| 3 | 赛程拖拽改场地时间，空槽自动建槽 | `routes/schedule.js`、`Schedule.vue` |
| 4 | 主客场开关回弹修复（axios params）+ 全项目 5 处同名问题 | `Schedule.vue`、`MySchedule.vue`、`Screen.vue`、`Standing.vue` |
| 5 | 点空槽直接新增比赛 | `Schedule.vue` |
| 6 | 点左侧时间清除整段（含已录分保护） | `routes/schedule.js` 新增 `POST /schedule/clear-time` |
| 7 | 筛选后比赛全部消失（补 band_id/event_item_id）+ 隐藏数量提示 | `routes/schedule.js`、`Schedule.vue` |
| 8 | 淘汰赛对阵图：公开页 / 大屏 / 赛程编排三处接入 | `BracketTree.vue`、`routes/schedule.js` `/bracket`、`routes/publicMeet.js` |
| 9 | **P0 止血**：清死代码 441 行 + 旧径赛分组路径弃用标记 | 见下节 |
| 10 | 清理孤儿数据 10 条（event_item 76-79 / team_entry 45 / heat_group 14 + heat_member 4） | `cleanup_orphans.py` |
| 11 | **Logo 接入**：favicon / 登录页 / 侧边栏 / 大屏页头四处换为方案 A | `favicon.svg`、`Login.vue`、`Layout.vue`、`Screen.vue` |

## 五·补、P0 止血（2026-10-27 晚）

**先查证再动手**：`probe_dual_track.py`（只读）确认
`track_heat`/`heat_entry` = 0 行、`heat_group`/`heat_member` = 1/4 行（落在篮球项目上，误点脏数据）、
线上只在跑球类（match_info 12、schedule_slot 51、team_entry 13）。
→ **统一径赛分组路径零数据迁移风险**，可以放心改。

**已删死代码（441 行）**
- `services/track-algorithms.js` −264 行：删 `advanceFromHeats` / `standardSeedOrder` /
  `buildByeBracket` / `generateLaneSheet` / `allocateBibNumbers` / `assignLanesBySeed`
  （7 个函数只有 `decideRaceFormat`、`allocateHeats` 真被 `scheduler` 调用，463 → 170 行）
- `services/schedule-algorithms.js` −177 行：删 `generateSlots` / `packSchedule` /
  `advanceToKnockout` 及局部 `addMinutes`（早期原型，线上跑的是 `scheduler.js` 同名实现，555 → 377 行）
- `services/scheduler.js`：移除 import 了却从未调用的 3 个引用

**已加弃用标记（不改行为）**
- `POST /group/track-generate` 加 `console.warn`（写旧表，成绩录入页看不到）
- `Grouping.vue` 点「径赛分组」先弹确认，引导去「成绩录入 → 分组编排」

**教训**：`看起来在用 ≠ 真的在用`。本轮发现 3 个函数是 import 进来了却从未调用。
删任何代码前一律全项目 grep 确认，并保留 `runTests` 做回归。

## 六、待办

- [ ] 移动端（手机）上的甘特图拖拽体验未实测，仅桌面端验证过
- [ ] 服务器上的 dist 与 GitHub 源码尚未建立自动同步，改完代码要手动推一次
- [ ] 报名、秩序册导出等模块的回归没有覆盖自动化测试，改动后建议手工过一遍
- [ ] **P1 整合**（详见 `系统重构规划.md`）：① 统一径赛分组到 `track_heat`/`heat_entry`，
      `Grouping.vue` 田径入口改调 `/track-result/arrange`，旧表 `heat_group`/`heat_member` 转归档
      ② 积分榜 3 端点收敛为 1（复用视图 `v_group_standing`）
      ③ 全能计算收归 `scoreEngine` ④ 抽 `pdfService` 合并重复的 `dataUrlToBuffer`
- [ ] **清理线上脏数据**（需确认后执行）：`heat_group` 1 条 + `heat_member` 4 条（篮球项目误产生）、
      4 个名为「测试篮球」但 `event_type=TRACK` 的 `event_item`（id 76–79）
- [ ] `track-algorithms.js` 现只剩 2 个函数且与 `trackArrange.js` 能力重叠，
      P1 统一路径后应整体并入 `trackArrange.js`，本文件作废

- [ ] 移动端（手机）上的甘特图拖拽体验未实测，仅桌面端验证过
- [ ] 服务器上的 dist 与 GitHub 源码尚未建立自动同步，改完代码要手动推一次
- [ ] 报名、秩序册导出等模块的回归没有覆盖自动化测试，改动后建议手工过一遍

---

## 学校体育活动上报（2026-10-30 新增）

模块路径 `/sport-activity`，菜单分组「体育活动」，角色 1（局端）与 2（学校端）可见，
`SportActivityIndex.vue` 按角色分发到 `SportActivityAdmin`（看板）或 `SportActivity`（填报）。

**数据表**：`school_sport_report`（唯一键 `school_id + term + phase`）、`school_sport_photo`
建表脚本：`server/sql/sport_activity.sql`

**五个板块**（六个上报项合并而来）：
1. 阳光大课间（原「大课间开展情况」+「是否落实15分钟」，后者由时长自动判定）
2. 每天体育活动时间（体育课折算 + 大课间折算 + 课后活动，自动判是否 ≥60 分钟）
3. 校内竞赛（按学期统计）
4. 武术进校园
5. 体育作业

**达标公式**（前后端必须一致：`sportActivity.js` 的 `calcMetrics` 与
`SportActivity.vue` 的 `metrics`）：
```
recess_daily  = round(recess_minutes * min(recess_weekly,5) / 5)
pe_daily      = round(pe_minutes * min(pe_weekly,5) / 5)
daily_minutes = recess_daily + pe_daily + after_class_minutes
recess_ok     = recess_enabled && recess_minutes >= 15
daily_ok      = daily_minutes >= 60
```
达标状态**只在查询时算，不入库**。

### 踩过的坑（重装环境务必照做）

1. **systemd `ProtectHome=read-only` 会让上传目录变只读**，报错是
   `EROFS: read-only file system, open '.../server/uploads/xxx.png'`。
   服务器上已加：
   ```
   # /etc/systemd/system/sport-compete-backend.service
   ProtectHome=read-only
   ReadWritePaths=/home/single/sport-compete/server/uploads
   ```
   改完必须 `systemctl daemon-reload` 再 restart。**换机器部署要记得补这一行**。

2. **新路由必须手动登记**到 `server/index.js`：普通文件名进 `routes` 数组，
   驼峰命名进 `aliasRoutes`（如 `['/api/sport-activity','sportActivity']`）。
   漏登记的表现是接口 404（`Cannot POST /api/upload/photo`）。

3. 图片存 `server/uploads/`，由 `app.use('/uploads', express.static(...))` 提供，
   返回给前端的是相对路径 `/uploads/xxx.png`，与前端同源无需额外配置。

4. 图片随报表整体提交（`photos: { recess:[url...], ... }`），后端 `replacePhotos` 全量替换，
   没有单独的上传绑定接口；被移除的图片会留在磁盘上成为孤儿文件，量大时需加清理任务。

---

## 迁移到腾讯云（2026-11-02）

内网机 10.128.1.45 失联后，后端整体迁到腾讯云 150.158.39.237。

### 现状
| 项 | 位置 |
|---|---|
| 后端代码 | `/opt/sport-compete/server`（node，端口 4100） |
| 前端 dist | `/var/www/sport-compete`（nginx 8083 / 443） |
| 数据库 | 本机 MariaDB 10.11，库名 `sport_compete`（61 张表） |
| 上传图片 | `/opt/sport-compete/server/uploads` |
| systemd | `sport-compete-backend`（已 enable 开机自启） |
| 日志 | `/var/log/sport-compete.log`、`-error.log` |

### nginx 关键改动
`sites-available/compete-http`（8083）和 `sites-available/sport-compete`（443）里的
`location /api/` 原来 `proxy_pass http://127.0.0.1:8443`（SSH 隧道回内网机），
**已改成 `http://127.0.0.1:4100`**（本机后端）。
备份在 `/root/compete-http.bak.MMDD`、`/root/sport-compete.bak.MMDD`。

### 数据库账号
复用本机 `sport_manage` 的 root 凭据（见 `/root/server/.env` 的 `DB_PASSWORD`）。
本项目自己的配置在 `/opt/sport-compete/server/.env`。

### 表结构是怎么建的
`sql/schema.sql` 只是早期版本（21 表），完整结构要按顺序再跑：
`sql/migrate_*.sql`（10 个）→ `server/sql/sport_activity.sql`，
用 `mysql -f` 容错执行（重复列会报错但不影响），最终 61 张表。

### 数据迁移（未完成，等内网机）
库内目前只有 `sql/seed.sql` 的示例数据（16 学校 / 8 账号 / 1 赛事 / 24 条报名）。
**真实数据仍在失联的内网机上**，恢复后按下面步骤搬：
```bash
# 内网机
mysqldump -u$DB_USER -p$DB_PASSWORD --single-transaction --skip-lock-tables \
  $DB_NAME > /tmp/sc_full.sql
tar czf /tmp/sc_uploads.tgz -C /home/single/sport-compete/server uploads
# 拉到腾讯云后
mysql -uroot -p<PW> -e "DROP DATABASE sport_compete; CREATE DATABASE sport_compete CHARACTER SET utf8mb4;"
mysql -uroot -p<PW> sport_compete < sc_full.sql
tar xzf sc_uploads.tgz -C /opt/sport-compete/server/
```
导入前记得清掉 seed 的示例数据（DROP 重建即可）。

### 账号
管理员 `admin` / `体卫艺科`（迁移后按用户习惯改的，seed 原密码是 admin123）。

---

## 球类编排：按赛制分项目（2026-11-02）

原设计四个球类项目共用一套「分组循环 → 淘汰」，参赛方一律是球队。
乒乓球/羽毛球是个人项目（单打/双打/混双），赛制也不同，因此做了扩展。

### 两个新维度（event_item 上）

| 字段 | 取值 | 含义 |
|---|---|---|
| `schedule_mode` | `GROUP_KO`（默认） | 分组循环 → 淘汰 |
| | `KO` | 纯淘汰，不分小组，报名通过后直接出对阵树 |
| `participant_kind` | `TEAM`（默认） | 学校组队 |
| | `ATHLETE` | 个人单打 |
| | `PAIR` | 双打/混双组合 |

### 关键设计：不新建 contestant 表

「个人」「双打组合」也写一条 `team_entry`，用 `entry_kind` 区分（1球队 2个人 3双打）。
好处是 `match_info.team_a_id/team_b_id` 不用动，**对阵图、录分、自动晋级、积分榜、
秩序册、大屏对阵全部零改动复用**。双打搭档存在 `partner_name` / `partner_athlete_id`。

### 纯淘汰算法（server/services/schedule-ko.js）

```
size = 2^ceil(log2 n)      目标位次
byes = size - n            轮空数
种子位表 seedSlots(size)，把 1..n 号种子放进去，空位即轮空
```
实测：18 人 → 2 场预赛 + 14 轮空（= 16 强）；14 人 → 6 场 + 2 轮空；8 人 → 直接八进四。
与用户那张手工乒乓球对阵图规则一致。

- 轮次用 `match_info.round_no` 表示（1,2,3…），`stage` 固定 2；三四名 stage=6
- **全轮次预生成**（空位待填），轮空者在生成时直接落位到下一轮
- 晋级：按「下一轮空位顺序」填胜者，而不是固定 i/2 配对
  （第 1 轮有轮空时真实比赛不在连续位置，用 i/2 会填错位）
- `advanceKo` 幂等：每次录分调用都从头走一遍，能连续推进多轮

### 踩过的坑

1. **`team_entry` 原唯一索引 `uk_band_event_school` 挡死个人赛**——一校一人。
   已删除，改由 `entry.js` 按 `entry_kind` 校验（球队赛仍一校一队）。
2. **迁移丢字段**：`event_item.home_away / allow_draw / win_points / draw_points`
   是当年在内网机上手工 ALTER 的，没进版本库，迁腾讯云时丢了 →
   `event-config` 接口直接 500，且主客场开关**静默失效**。已补建并写进
   `sql/migrate_schedule_mode.sql` 同类问题的教训：**任何 ALTER 都要落脚本**。
3. **晋级初版只从第 1 轮判起**，导致第 2 轮之后永远推不动。改成幂等遍历。
4. 占位场次（双方还待定）必须拒绝录分，否则会出现 null vs null 有比分的脏数据。

### 接口

- `GET  /api/schedule/ko-preview?competition_id&event_item_id` 剩余人数→轮次/场次/轮空
- `POST /api/schedule/generate-ko` 生成对阵树
- `GET  /api/schedule/bracket-all` KO 模式下按 round_no 分轮，轮次名动态生成

---

## 七·补、2026-11-03 大改：赛制体系 + 统一录分 + 安全加固

这一轮是按「全市教育局系统」的目标做的一次结构性改造，
起因是三个具体的使用痛点：**赛程编排不知道怎么用、赛程展示不合理、成绩录入不该由裁判做**。

### 7.1 🔴 修掉的严重 Bug（都是「用了才知道」的那种）

| # | Bug | 位置 | 后果 |
|---|---|---|---|
| 1 | **`Schedule.vue` 用了 `reactive` 却没 import** | `views/Schedule.vue` | **赛程编排页直接白屏**（最核心的页面打不开） |
| 2 | **`keep-alive` + `transition mode="out-in"` 死锁** | `views/Layout.vue` | **后台点菜单，页面内容不跟着变**（只有顶栏标题变），永远停在第一次打开的页面 |
| 3 | `.panel-head` 缺 `width:100%` | 5 个视图 | `space-between` 失效，标题与提示文字挤在一起 |
| 4 | `/password` 路由不存在 | `views/Layout.vue` | 用户菜单「修改密码」点了没反应 |
| 5 | `PUT /result/score/:id` 不重写 `match_result` 明细 | `routes/result.js` | 改分后积分榜与主表对不上 |
| 6 | `packSchedule` 只排 `stage=1` | `services/scheduler.js` | **淘汰赛/KO 场次永远排不进日程**，只能逐场手动新增 |
| 7 | 报名被驳回后无法重报 | `routes/entry.js` | 唯一键占位 + status 不重置 → 学校唯一出路是改组别/改项目 |
| 8 | `PublicMeet.vue` 用了 `.id` 取选项（实际是 `.value`） | `views/PublicMeet.vue` | 公开页「淘汰赛对阵」tab 永远停在「请选择组别和项目」 |
| 9 | `BracketShow.vue` 三元两个分支一样 | `views/BracketShow.vue` | 大屏每一列都显示「第1场」，场次号是错的 |
| 10 | 打开大屏控制端会顺手把 `public_flag` 写 0 | `routes/trackStats.js` | 偷偷关掉公开成绩查询 |

> **教训 1**：全项目没有 ESLint / 没有测试，`import` 缺失这种错只有运行时才炸。
> **教训 2**：`keep-alive` + `mode="out-in"` 是 Vue 3 的经典死锁组合，不要用。
> **教训 3**：改动前后各跑一次「全页面渲染冒烟」（见 §7.6）。

### 7.2 赛制体系扩到 4 档

`event_item.schedule_mode` 原来只有两档，现在四档：

| 值 | 名称 | 流程 |
|---|---|---|
| `GROUP_KO` | 分组循环 + 淘汰 | 分组 → 循环 → 出线 → 淘汰赛 → 决赛 |
| `KO` | 纯淘汰 | 报名 → 对阵树 → 逐轮淘汰 → 决赛 |
| `LEAGUE` | **联赛循环**（新增） | 报名 → 每周一轮 → 总积分排名 |
| `ROUND` | **循环赛排名**（新增） | 报名 → 单循环 → 积分排名 |

- 新接口：`POST /api/group/generate-league`（生成大循环场次）
- `tryAdvanceStage` 遇到 LEAGUE/ROUND 走 `writeLeagueRank`（按总积分写 `final_rank`）
- **「联赛」这个词原来被误解了**：系统里的「联赛排期」按钮（`/schedule/league-auto`）
  是**排期方式**（每周一轮、主客轮转），不是赛制。现在两者分开了。

前端「项目与场地 → 编辑项目」里换成了**带说明的赛制模板选择器**：
每种赛制写清楚「怎么打、打多少场、最后怎么排名」，选完立刻显示规模预估
（轮次 / 总场次 / 约需天数），并自动带上该赛制的推荐参数。

### 7.3 积分规则终于能配了

之前 `allow_draw` / `win_points` / `draw_points` **只有后端能写、前端没有任何入口**
（`Schedule.vue` 唯一调用 `/schedule/event-config` 的地方只传 `home_away`）。
也就是说「篮球不允许平局」这个设置管理员根本设不了。

现在：项目表单里直接有积分规则；赛程编排页工具条也有「积分规则」按钮。
后端 `POST /schedule/event-config` 扩展为支持全部字段（带白名单校验）。

### 7.4 新增「编排中心」（解决「不知道下一步做什么」）

`/arrange-center`，菜单在「总览 → 编排中心」。

一个页面看完整条流程，每一步显示**当前状态 + 还差什么 + 下一步按钮**：

```
✓ 配置赛制    4 个项目
✓ 报名审核    12 队通过
✓ 分组/生成对阵  48 场
⚠ 排期        48/48   还有 6 场没排期（其中 2 场要等上一轮赛果）
⑤ 录分与名次  赛程排完后开始录分
```

下面还有「各项目编排状态」明细表，缺什么一目了然。

配套新增 `GET /api/schedule/unplaced` —— **以前系统里没有任何地方能列出「还有哪些比赛没排期」**。
现在赛程编排页顶部有「还有 N 场未排期」面板，可一键排入时间槽、可展开看明细。

### 7.5 成绩统一由管理员录入

**权限收紧**（裁判的写权限全线收回）：

```
routes/result.js        POST /score            (1,3) → (1)
routes/trackResult.js  13 个写端点             (1,3) → (1)
routes/trackRace.js    4 个写端点              (1,3) → (1)
routes/screenControl.js 3 个写端点              (1,3) → (1)
routes/trackStats.js   5 个写端点              (1,3) → (1)
```

裁判端「我的赛程」改为**只读**（还能看自己被指派的场次和比分，不能改）。
新增**管理员统一录分台** `/score-entry`：表格化批量录入、回车跳下一格、
快捷胜负按钮、提交前校验（淘汰赛不能平局）、**确认后成绩才上大屏和公开页**。

后端新增：`POST /result/score-batch`（批量，事务）、`POST /result/confirm`、`POST /result/unconfirm`。
`match_info` 新增 `confirmed` / `confirmed_at` 字段。

> 如果以后要恢复裁判录分：把上面那几处 `roleRequired(1)` 改回 `(1, 3)`，
> 并恢复 `result.js` 里的裁判分支即可。

### 7.6 赛程展示

- **公开页补上球类数据**：原来只读 `heat_entry`/`track_heat`（田径表），
  球类赛事打开公开页三个 tab 全空。现在接入 `final_rank`（球类名次）。
- 新增公开接口 `GET /api/public/meet/:uuid/standing`（球类小组积分榜）
- 新增公开接口 `GET /api/public/meet/:uuid/schedule`（**赛程总表** —— 观众最想要的那张表）
- 公开页新增「赛程总表」「小组积分」两个 tab；对阵 tab 只列球类项目
- hero 的「已公布项目」口径修正（原来显示的是「项目×组别」的组合数）
- 大屏与成绩查询页互链；控制端补上「成绩查询」分享链接
- **清掉了大屏控制端的 4 个假开关**：`layout`（版式）、`show_upcoming`（待赛）、
  `dwell_seconds`/`loop_flag`（队列轮播）、以及整个「播放队列」卡片 ——
  它们在大屏端从未被消费，留着只会让管理员以为配好了

### 7.7 安全加固

| # | 问题 | 处理 |
|---|---|---|
| 1 | **11 个 py 脚本硬编码服务器密码 `（旧 SSH 口令，已废弃，需轮换）` + MySQL 密码 `（旧数据库口令，已废弃，需轮换）`** | 全部改成环境变量（`SPORT_SSH_PASSWORD` 等），41 个脚本复查无明文 |
| 2 | `JWT_SECRET` 硬编码兜底 | 改成**缺失即拒绝启动** |
| 3 | 登录无限流 | 加 `express-rate-limit`（IP 30 次/10 分钟）+ 按账号失败锁定（8 次/10 分钟） |
| 4 | 密码用 `sha256(pwd+固定盐)` | 改 bcrypt（10 轮）；**老哈希登录时自动升级**，无需迁移 |
| 5 | **裁判可改删任意学校的报名** | `entry.js` 全部写接口加 `roleRequired(1,2)`，跨校检查改成白名单（非管理员只能动本校） |
| 6 | 接力棒次可跨校修改 | 加归属校验 + 棒次运动员必须本校 |
| 7 | 学校账号能看到当天全部场次 | `my-schedule` 加学校过滤 |
| 8 | 审核接口状态无校验 | 白名单只收 2/3；驳回原因落库（`athlete_entry` 新增 `reject_reason`） |
| 9 | `trackStats/public-config` 副作用 | 只传 `generate_uuid` 时不再改 `public_flag` |
| 10 | `/public/screen/:uuid` 不校验 `public_flag` | 与 `/public/meet/:uuid` 统一口径 |

> ⚠️ **密码已经在仓库里出现过 = 已泄露，务必去服务器改密码**
> （内网机 `single` 与 MySQL `compete`）。改完再把新密码配进环境变量。

### 7.8 事务与工程

- `db.js` 的 `transaction(fn)` 改成传入**同一连接**的 `tx` 对象
  （原来传的是裸 conn，事务内的 `query/execute` 走连接池，不在同一事务里，rollback 无效）
- 「删旧建新」类编排操作全部包事务：`generateGroups`、`generateGroupMatches`、
  `generateLeagueMatches`、`generateKo`
- 后端加了 `sql/migrate_security_fields.sql`（`reject_reason`、`schedule_mode`、
  `league_rank_rule`、`match_info.confirmed`、索引）

### 7.9 视觉升级（详见同目录 `DESIGN-SYSTEM-UPGRADE.md`）

- 中性字改实色冷灰、中性面四档、阴影三档、品牌色 `#0052d9` → `#2563eb` + 补色阶
- **`.t-card` 加回 1px 边框**（原来 `border:none` + 几乎不可见的阴影 → 卡片浮不起来）
- Hero 改深墨蓝 + 细网格纹理 + 左侧品牌色条
- 指标卡图标改 `.icon-tone` 类（**修好了暗色模式下 4 块刺眼浅色块**）
- 顶栏加面包屑、内容区 `max-width:1440px`、侧边栏激活态改低饱和蓝
- `BracketPlay` / `BracketShow` 的「电竞霓虹风」收敛到品牌蓝深色变体（保留深色，字体回 MiSans）
- 移动端加「更多」抽屉（原来 tabbar 只有 4 个槽，**田径全流程手机进不去**）

### 7.10 新增：本地 Mock API（无 MySQL 也能看界面）

`frontend/mock/plugin.js`，只在 `vite dev` 生效，不进生产构建。

```bash
cd frontend && npm install && npm run dev   # → http://localhost:3100
# 登录：admin / 任意密码
```

- 想连真实后端：`VITE_MOCK=0 npm run dev`
- 数据是**写死的示例数据**，不是真实赛事

### 7.11 回归自测清单（改完必做）

```bash
# 1) 后端语法
cd server && for f in routes/*.js services/*.js middleware/*.js utils/*.js; do node --check "$f"; done

# 2) 前端构建
cd frontend && npm run build

# 3) 全页面渲染冒烟
#    启动 dev server 后，逐个访问 20 个路由，确认内容区有内容且 console 无报错
#    路由清单见 §7.6 与 §7.4
```

> 建议把这套冒烟做成脚本（`test_*.py` 已有雏形，但都是手工 curl），
> 或者直接给项目加 ESLint + vitest —— 这次 10 个 bug 里有一半是 lint 能查出来的。

---

## 八、数据库迁移清单（部署时按顺序跑）

```bash
cd server
mysql -u<user> -p<pwd> sport_compete < ../sql/migrate_security_fields.sql
```

`migrate_security_fields.sql` 包含：
`athlete_entry.reject_reason`、`team_entry.reject_reason`（补齐）、
`event_item.schedule_mode`（已有则跳过）、`event_item.league_rank_rule`、
`match_info.confirmed` / `confirmed_at`、`match_info` 索引 `idx_slot_stage`。

全部用 `information_schema` 判断后再 ALTER，**可重复执行**。

---

## 九、2026-11-03 球类编排改造：从「固定时间槽」到「连续时间轴」

这一轮把球类的赛程编排模型整个换掉了。起因是一个观察：

> `event_item.match_minutes`（单场时长，篮球 24 / 排球 30 / 羽毛球 15）
> **在整个后端零引用**。

字段设了但用不上，说明模型表达不了「每场时长不同」。顺着这条线查下去，
发现根因是 `schedule_slot` 的**固定格子**设计。

### 9.1 老模型的三个硬约束

```sql
UNIQUE KEY uk_date_venue_slot (play_date, venue_id, slot_index)
```
```js
// scheduler.js:264-265
const start = addMinutes(amStart/pmStart, idx * interval);  // interval 固定 45
const end   = addMinutes(start, interval - 10);             // 每格固定 35 分钟
```

| 约束 | 后果 |
|---|---|
| 一格一场（`slot_id` 是 Map 的 key，一对一） | 同时间同场地不能并行 |
| 格子等距 | `match_minutes` 字段废了 |
| 「生成时间槽」是所有编排的前置门槛 | **这一步和"谁跟谁比"毫无关系，却必须先做** |

### 9.2 新模型

**场次自带时间地点**：
```
match_info.play_date / start_time / end_time / venue_id / locked_flag
```

**`schedule_slot` 语义改为「可用时间窗」**：
- `slot_type=1` → 可排比赛的时间窗（每天某场地在哪些时段能打）
- `slot_type=2` → 非比赛占位（开幕式/体测），该时段不可排
- 新增 `kind` 字段区分

**排期算法**（`server/services/ballTimeline.js`，全新文件）：
```
按「日期 × 场地 × 时间窗」用分钟游标连续排
  · 每场时长 = 项目的 match_minutes（终于用上了）
  · 同一队伍不能同时在两个场地
  · 同一队伍两场之间留 minimum_rest_minutes（默认 90）
  · 场地不重叠（游标连续推进，天然不重叠）
```

**这套代码的思路和田径的 `services/timetable.js` 是同一套**（那边早就是"日程单元 + 游标 + 冲突检测"），
现在两边终于一致了 —— 项目里最大的架构不一致消除。

### 9.3 对阵表与赛程表解耦（新增 `/lineup`）

新增接口 `GET /api/schedule/lineup` 与新增页面 **「对阵表」**（菜单：球类项目 → 对阵表）。

```
阶段一 · 定对阵（不碰时间地点）—— 对阵表
阶段二 · 定时间地点（随时可做）—— 赛程编排
```

| 变化 | 效果 |
|---|---|
| 淘汰赛生成后立刻可见 | 以前藏在甘特图外，管理员根本不知道有 16 强 |
| 「待排期」清单天然存在 | 对阵已定、时间未定 |
| 对阵表可直接印秩序册 | — |
| 编排流程从 6 步降到 4 步 | 配置赛制 → 报名审核 → 生成对阵 → 排期 → 录分 → 榜单 |

### 9.4 新增/改动的接口

| 接口 | 说明 |
|---|---|
| `GET /api/schedule/gantt` | **返回结构变了**：`{ dates, venues, windows[], matches[], unplaced[] }`（原来只有 `cells[]`） |
| `GET /api/schedule/lineup` | **新增**：对阵表（轮次矩阵 + 淘汰轮次） |
| `GET /api/schedule/conflicts` | **新增**：冲突检测（VENUE / TEAM / REST 三类） |
| `POST /api/schedule/pack` | 走新引擎，支持淘汰赛一起排 |
| `POST /api/schedule/slots` | 语义变为「设置可用时间窗」，路径不变 |
| `POST /api/schedule/clear-schedule` | **新增**：清空排期（保留时间窗） |
| `PUT /api/schedule/match/:id` | 拖拽落位改用 `{ play_date, start_time, venue_id }`，**不需要 slot_id**；带场地/队伍冲突校验 |
| `PATCH /api/schedule/match/:id/time` | 改的是**这一场**的时间（原来改 slot 的时间，语义是错的） |
| `POST /api/group/generate-league` | **新增**：生成联赛大循环赛程 |
| `POST /api/schedule/league-auto` | 适配新模型，不再新建格子 |

### 9.5 联赛：赛制 + 排期方式都支持

- **赛制**：`schedule_mode` 扩到 4 档 —— `GROUP_KO` / `KO` / `LEAGUE`（联赛循环）/ `ROUND`（循环赛排名）
- **排期方式**：`/schedule/league-auto` —— 每周一轮 + 主场排在本校场地
- 「分组编排」页按赛制显示对应按钮（分组循环 → 「生成小组赛程」，联赛 → 「生成联赛赛程」）
- 联赛全部打完后由 `writeLeagueRank` 按总积分写 `final_rank`

### 9.6 迁移

```bash
cd server
mysql -u<user> -p<pwd> sport_compete < ../sql/migrate_ball_timeline.sql
```

`migrate_ball_timeline.sql` 内容：
- `match_info` 加 `play_date` / `start_time` / `end_time` / `venue_id` / `locked_flag`
- `match_info` 加索引 `idx_comp_day_venue`、`idx_team_a`、`idx_team_b`
- `schedule_slot` 加 `kind` 字段
- **数据回填**：把老数据从 slot 同步到新字段（老赛程升级后照常能显示）
- `competition` 加 `match_gap_minutes`（默认 10）、`minimum_rest_minutes`（默认 90）

全部用 `information_schema` 判断后再 ALTER，**可重复执行**。

### 9.7 向后兼容

- `match_info.slot_id` 保留，老数据仍在
- `/schedule/gantt` 在服务端对老数据做回填（从窗口借时间与场地）
- 前端甘特图渲染统一走新结构，老数据经服务端回填后正常显示

### 9.8 注意

改造后**「生成时间槽」这个说法全部改成了「比赛日程」**：
- 前端按钮、弹窗标题、提示文案
- 后端 `generateWindows` 的返回值 `count` 含义从"槽位数"变成"时段数"

如果部署时看到「已生成 N 个时间槽」，说明前端 dist 没更新，重新 build 一次。

---

## 十、2026-11-03 田径子系统整理

球类改造完之后，回头看田径。**结论：田径的排期模型不用重写** —— 它早就是时间轴模型
（`schedule_unit` + `timetable_item` + `timetable.js` 游标引擎 + `detectConflicts`），
和球类改造后的方向一致。田径的问题不在模型，在**入口与数据源**。

### 10.1 诊断结果

| # | 问题 | 严重度 |
|---|---|---|
| 1 | **径赛分组是"数据黑洞"** | 🔴 高 |
| 2 | **分组编排入口藏在「成绩录入」里**，与球类不对称 | 🟠 中 |
| 3 | **公开页看不到田径日程** —— `timetable_item` 不在任何公开接口的数据源里 | 🟠 中 |
| 4 | **编排中心只管球类** —— `filter(e => e.category === 3)`，田径完全不在流程里 | 🟠 中 |
| 5 | 模块职责与路由名错配 + 10 组端点语义重名 | 🟡 低 |
| 6 | **武术没有竞赛模块**（见 §10.6） | 🔴 高 |

### 10.2 P0：堵住径赛分组的"数据黑洞"

**问题**：`Grouping.vue` 有个「径赛分组」按钮 → `POST /group/track-generate` →
把分组写进旧表 `heat_group` / `heat_member`，而成绩录入页读的是新表
`track_heat` / `heat_entry` —— **两边互不可见**。

原后端只 `console.warn` 然后**照常执行**，前端还弹确认框问「仍按旧方式生成？」。
最恶劣的地方：它返回「已生成 N 个径赛分组」的**成功提示**，
**告诉用户成功了，数据却进了黑洞**。

**处理**：
- `Grouping.vue` 的按钮改成「径赛分组编排 →」，直接跳到新页面
- `POST /group/track-generate` **直接返回 410 错误**，不再执行
- 删掉 `scheduler.generateTrackHeats`（唯一调用方就是这个弃用端点）

> ⚠️ **注意**：`heat_group` / `heat_member` 这两张表**不能归档** ——
> 它们被**球类**正常使用（分组赛的小组）。只有**径赛**那条写入路径是废弃的。
> 球类和径赛共用同名表，这是最容易踩的坑。

### 10.3 P1：独立「田径分组编排」页（与球类对称）

新增 `/track-arrange`（菜单：田径项目 → 分组编排）。

原来「分组编排」是 `TrackResult.vue` 里的一个弹窗 —— 但**编排属于赛前环节**，
藏在「成绩录入」里本来就不好找；而球类的分组编排是独立页面，两边不对称。

新页面做四件事：
1. 选项目 / 组别 / 赛次（预赛 / 复赛 / 决赛）
2. 看已编排的赛次（径赛按**道次**看，田赛按**出场顺序**看）
3. 编排分组（分组方式 / 道次数 / 道次分配方式 / 排序依据）
4. 跳「成绩录入」

`TrackResult.vue` 里的分组编排弹窗与相关代码已删除，只留录分，按钮改成跳转。

### 10.4 P1：公开页补上田径赛程

`GET /api/public/meet/:uuid/schedule` 现在同时返回两类数据：

| 类型 | 数据源 | 字段 |
|---|---|---|
| 球类 | `match_info`（自带日期/时间/场地） | 场次、比分、对阵、阶段 |
| 田径 | `timetable_item` + `track_heat` | 赛次名、人数、时刻、场地 |

之前 `timetable_item` / `schedule_unit` **完全不在公开页任何接口的数据源里** ——
观众能看到田径成绩，但**看不到田径的日程**（哪天几点哪个项目第几组）。

### 10.5 P1：编排中心加入田径分支

`ArrangeCenter.vue` 现在有「球类项目 / 田径项目」两个 Tab，各自一套流程：

```
球类：配置赛制 → 报名审核 → 分组/生成对阵 → 排期 → 录分与名次        (5 步)
田径：田径配置 → 报名审核 → 分组编排 → 日程编排 → 赛中控台 → 录分与统计 (6 步)
```

新增接口 `GET /api/track/overview`：一次给出田径各项目的
报名人数 / 赛次数 / 已录分 / 已排期 / 待排期，以及日程单元数。

### 10.6 ⚠️ 武术：目前没有竞赛模块

全项目搜索「武术 / martial / wushu / 散打 / 套路 / 太极」，
只在**体育活动上报**模块命中（`sportActivity.js` / `SportActivity.vue`）——
那是「**武术进校园**」的上报统计，属于学校体育工作开展情况，
**不是武术比赛**。

需求里的「武术比赛的赛程编排、赛程管理、赛程展示」**目前完全没有实现**。
如果要做，它是一个新的一级项目类型（参考 `event_item.category`）：
- 不适合用分组循环+淘汰（武术比赛通常是**评分制/名次制**，不是输赢淘汰）
- 更接近「田赛」模式：报名 → 出场顺序 → 评分 → 排名
- 工作量：一个新的编排路径 + 评分录入 + 名次生成 + 秩序册

### 10.7 尚未处理（低优先）

- **模块重命名**：`track-result` → 实际是成绩录入、`track-race` → 赛中控台、
  `track-plan` → 日程编排+秩序册、`track` → 模板库配置
  （用户自己的 `系统重构规划.md` 已列出）
- **端点语义重名 10 组**，其中三组是实质隐患：
  `post /arrange`（trackPlan 日程排布 vs trackResult 分组编排）、
  `get /conflicts`（schedule 球类 vs trackPlan 田径）、
  `post /confirm`（result 球类 vs trackResult 田径）
- **`announce_auto_flag` 空承诺**：配置项「确认后自动公布」只写不读
- **旧表 `heat_group`/`heat_member` 的球类用途**需要文档化（与径赛同名不同义）

---

## 十一、2026-11-03 收尾：空承诺兑现 + 端点消歧 + 死代码清理 + 武术模块

### 11.1 announce_auto_flag —— 空承诺变成真功能

原来 `competition.announce_auto_flag`（"确认后自动公布"）**只写不读**：
全后端只有 `trackRace.js:687` 一处写入，没有任何地方读它 —— 配了这个开关系统什么也不会做。

**现在**：
- 公布逻辑从 `routes/trackRace.js` 的端点里抽到 `services/announcement.js`
  （`publishHeats` / `withdrawHeats` / `autoPublishIfEnabled`）
- `trackRace.js` 的手动公布/撤回端点改为调用它
- `trackResult.js` 的 `/confirm` 在确认成绩后调用 `autoPublishIfEnabled` ——
  **开关开了就自动上公告栏**，并在提示里说明

### 11.2 端点消歧

`/api/track-result/arrange`（径赛**分组编排**）与 `/api/track-plan/arrange`（**日程排布**）
名字太像，都叫"编排"，容易调错。前者重命名为：

| 旧 | 新 |
|---|---|
| `POST /api/track-result/arrange` | `POST /api/track-result/group-arrange` |
| `GET/PUT /api/track-result/arrange-rule` | `GET/PUT /api/track-result/group-arrange-rule` |
| `PUT /api/track-result/arrange/adjust` | `PUT /api/track-result/group-arrange/adjust` |
| `PUT /api/track-result/arrange/move` | `PUT /api/track-result/group-arrange/move` |

前后端已同步改完，全局复查无残留。

> **其余的"同名端点"是有意设计，不是 bug**：
> `GET /api/schedule/conflicts`（球类）与 `GET /api/track-plan/conflicts`（田径）、
> `POST /api/result/confirm`（球类）与 `POST /api/track-result/confirm`（田径）
> —— 不同路由前缀下的同名资源，是 REST 的正常用法，各自实现各自的冲突/确认逻辑。
> 详见 §11.6 的职责对照表。

### 11.3 死代码清理

| 删除项 | 原因 |
|---|---|
| `scheduler.generateTrackHeats` | 唯一入口 `/group/track-generate` 已停止执行（写旧表，成绩录入页看不到） |
| `services/track-algorithms.js`（整个文件，170 行） | 里面的 `decideRaceFormat` / `allocateHeats` 只服务于 `generateTrackHeats`，跟着变成死代码 |
| `trackRace.js` 的 `verifyPwd` | 定义了从未使用 |
| `trackRace.js` 自带的 `hashPwd`（sha256 + '::sport'） | 统一走 `utils/helpers` 的 bcrypt（与主体系一致） |

### 11.4 武术模块（新增）

**背景**：需求里的"武术比赛的赛程编排、赛程管理、赛程展示"此前完全没有实现
（原来只有"武术进校园"的体育活动上报，不是比赛）。

**设计取舍**：武术是**评分制 / 名次制**，与球类（输赢淘汰）、田径（时间/距离）都不同：
- 径赛的 `track_heat` 有 `lane_no`（道次）、`heat_entry` 有 `bib_no`（号码布）、
  `field_attempt` 是"试跳/试投明细" —— 语义都对不上，硬套会让以后维护的人抓狂
- 所以**单独建表**，但**报名复用 `team_entry`**（学校组队，一校一队）→ 与球类共用报名审核流程

**新表**（`sql/migrate_martial.sql`）：

```
martial_heat   武术赛次分组（轮次/组号/裁判人数/确认状态）
martial_entry  参赛单位 + 各裁判打分（scores_json）+ 算分 + 名次
```

**新增字段**（`event_item`）：`martial_judge_count` / `martial_drop_highest` / `martial_minutes`

**评分算法**（`services/martialScore.js`）：
```
去掉一个最高分和一个最低分 → 其余取平均（国内武术比赛常规做法）
同分按出场顺序（先出场靠前）
打分不足 5 位裁判 → 不计分，提示还差几位
```

**新页面** `/martial`（菜单：武术项目 → 武术编排与评分）—— 编排、评分、排名一页搞定：
- 选项目 / 组别 / 轮次（预赛 / 复赛 / 决赛）
- 一键编排出场顺序（可按每组队数分批）
- 每队每裁判一个打分格 + 裁判姓名
- 实时显示算分明细（`9.40（去 9.20/9.70）`）与名次
- 全部评分完才能确认成绩

**新接口**（`/api/martial/*`）：`overview` / `heats` / `arrange` / `standing` / `schedule` /
`entry/:id/order` / `entry/:id/scores` / `heat/:id/confirm` / `heat/:id/revoke`

**集成**：菜单新增「武术项目」分组 · 编排中心新增「武术项目」Tab（4 步流程）·
公开页成绩新增武术排名 · `event_item.category` 新增 `4 = 武术`（EventSetup 里可选并配参数）

### 11.5 其它

- `referee_account` 的密码哈希统一为 bcrypt（原来自己一套 sha256 + '::sport'）
- 公开页 `/api/public/meet/:uuid/meet` 新增武术已确认成绩

### 11.6 模块职责对照表（路由名 vs 实际职责）

路由名是历史遗留，与实际职责不完全对应。**界面上的菜单名已经准确**，这里记一份对照，
免得以后看代码时对不上：

| 路由前缀 | 界面名 | 实际职责 |
|---|---|---|
| `/api/track` | 田径中心 | 项目模板库、评分表、全能配置、赛事田径参数 |
| `/api/track-result` | 成绩录入 | **分组编排**（group-arrange）+ 成绩录入 + 晋级录取 + 全能 |
| `/api/track-race` | 赛中控台 | 号码簿、检录表、临时变更、成绩公布 |
| `/api/track-plan` | 日程与秩序册 | 日程单元、自动排期、冲突检测、秩序册、奖状 |
| `/api/track-stats` | 赛后统计 | 团体总分、达级认定、破纪录、综合查询、公开页配置 |
| `/api/martial` | 武术编排与评分 | 武术出场顺序编排、裁判打分、算分排名 |

**为什么没改路由名**：改名要前后端 137 个端点同步改，风险高、收益低
（界面上的名字已经准确了）。除非将来要做 API 文档对外发布，再统一改一轮。

### 11.7 部署

```bash
# 1) 数据库迁移（武术 + 上一轮的赛制扩展）
cd server
mysql -u<user> -p<pwd> sport_compete < ../sql/migrate_martial.sql
mysql -u<user> -p<pwd> sport_compete < ../sql/migrate_security_fields.sql

# 2) 重建前端（新增 /martial 页面 + 菜单 + 编排中心 Tab）
cd ../frontend && npm run build
```

⚠️ `/api/track-result/arrange` 已重命名为 `/api/track-result/group-arrange`，
**前后端必须同时更新**，否则分组编排会 404。
