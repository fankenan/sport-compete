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
