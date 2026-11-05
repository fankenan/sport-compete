# 前端配色与结构升级方案

> 目标：把"能用"提升到"有高级感与质感"，且**不推翻现有 token 体系**
> 基准：`frontend/src/styles.css`（301 行）、`frontend/src/views/Layout.vue`、`Dashboard.vue`
> 状态：**已实施并验证**（2026-11-03）
>
> ## 已实施内容
>
> | # | 改动 | 文件 | 状态 |
> |---|---|---|---|
> | 1 | 冷灰阶中性字 / 四档中性面 / 三档阴影 / 品牌色阶 | `styles.css` | ✅ |
> | 2 | **`.t-card` 加回 1px 边框**（卡片浮起来的关键） | `styles.css` | ✅ |
> | 3 | 补齐圆角(6档)/字号(13档)/间距(13档)阶梯 | `styles.css` | ✅ |
> | 4 | Hero 改深墨蓝 + 细网格纹理 + 左侧品牌色条 | `styles.css` + `Dashboard.vue` | ✅ |
> | 5 | 指标卡图标改 `.icon-tone` 类（**修好暗色模式翻车**） | `styles.css` + `Dashboard.vue` | ✅ |
> | 6 | 顶栏面包屑 + 内容区最大宽度 1440px | `Layout.vue` | ✅ |
> | 7 | 侧边栏激活态改低饱和蓝 + 内描边 | `Layout.vue` | ✅ |
> | 8 | 状态标签改 `.pill-*` 语义色药丸 | `styles.css` + `Dashboard.vue` | ✅ |
> | 9 | **修 bug**：`.panel-head` 缺 `width:100%` → space-between 失效 | `Schedule/Grouping/Rank/Referee/Standing.vue` | ✅ |
> | 10 | **修 bug**：顶栏箭头硬编码 `rgba(0,0,0,.4)` 暗色不可见 | `Layout.vue` | ✅ |
> | 11 | **修 bug**：`/password` 死路由 → 改为改密弹窗 | `Layout.vue` | ✅ |
> | 12 | **修 bug**：`Schedule.vue` 用了 `reactive` 未 import → **赛程页白屏** | `Schedule.vue` | ✅ |
> | 13 | **修 bug**：`keep-alive` + `transition out-in` 死锁 → **后台切页面不生效** | `Layout.vue` | ✅ |
> | 14 | `BracketPlay` / `BracketShow` 配色收敛到品牌蓝深色变体 | 两个视图 | ✅ |
> | 15 | 移动端加「更多」抽屉（补齐田径等半数功能的入口） | `Layout.vue` | ✅ |
> | 16 | 公开页 / 大屏 / 控制端配色统一到 token | `PublicMeet/ScreenControl.vue` | ✅ |
>
> **本地查看方式**：`cd frontend && npm install && npm run dev` → http://localhost:3100
> （已内置 Mock API，无需 MySQL；连真实后端用 `VITE_MOCK=0 npm run dev`）
>
> ### 尚未做（留待后续）
> - MiSans Bold 字重补齐（现在 600/700 仍是浏览器合成加粗，中文偏虚）
> - Dashboard 引入图表库（参赛率环形图 / 项目分布条形）
> - 侧边栏折叠态（64px 图标模式）
> - 大屏版式轮播（队列功能已从控制端移除，等大屏端真正消费后再加回）

---

## 〇、一句话诊断

**底子不差，是几个关键参数把它钉在了"2020 年中后台模板"的观感上。**

`styles.css` 的 token 体系（9 档字号 / 4px 间距网格 / 双档阴影 / 暗色模式 / `prefers-reduced-motion`）
在同类项目里属于中上水平。问题出在**四个具体参数**上：

| # | 参数 | 现状 | 问题 |
|---|---|---|---|
| 1 | **卡片分层** | `.t-card { border: none }` + 3px 模糊/4% 不透明度的阴影 | 卡片与底色几乎同色，**浮不起来**。这是"廉价感"第一来源 |
| 2 | **中性字** | `rgba(0,0,0,.9/.6/.42)` | 纯灰无色相，显闷、显旧 |
| 3 | **底色层次** | `--app-bg:#f5f6f8` vs `--app-bg-2:#f7f8fa` | 差 2 个色阶，表头/hover 反馈形同虚设 |
| 4 | **字体字重** | MiSans 只加载 400/500，全站却用 600/700 | 浏览器 faux-bold 合成加粗，**中文发虚**，跨浏览器不一致 |

再叠加两个"手法重复"：
- **Hero 的"高饱和三色渐变 + 右上装饰圆"**在 `Dashboard.vue:301-317` 和 `Login.vue:219-249` 各用了一次 —— 第一次是亮点，第二次变成套路
- **`BracketPlay.vue:557-571` / `BracketShow.vue` 自建了一套"电竞霓虹"变量**（`--cy:#2ee6d6` 荧光青、`--pu:#9b5cff` 紫、`#05070e` 近黑底），还把字体栈改回 HarmonyOS Sans 绕开 MiSans —— 点进去像换了另一个产品

---

## 一、配色：四组具体改动

### 1.1 中性字：rgba 黑 → 实色冷灰

**原理**：带一点蓝相的灰（slate 系）在浅灰底上更"通透"，纯灰会显闷。

```css
/* 现状 styles.css:32-34 */
--app-text-1: rgba(0, 0, 0, 0.9);
--app-text-2: rgba(0, 0, 0, 0.6);
--app-text-3: rgba(0, 0, 0, 0.42);

/* 改为 */
--app-text-1: #0f172a;   /* 主文字：深墨蓝黑 */
--app-text-2: #475569;   /* 次要文字 */
--app-text-3: #8a94a6;   /* 辅助/占位 */
```

> 注意：`--app-text-3` 从有效对比度 4.6:1 降到 3.1:1。**辅助文字建议同时从 12px 提到 12.5px 并限制使用场景**（占位符、禁用态可以，承载信息的辅助文字不行）。

### 1.2 中性面与分割线：拉开层次

```css
/* 现状 */
--app-bg: #f5f6f8;
--app-bg-2: #f7f8fa;      /* 与 bg 只差 2 级 */
--app-border: #e7e7e7;
--app-border-2: #f0f0f0;

/* 改为 */
--app-bg: #f6f7f9;        /* 页面底：冷调浅灰 */
--app-bg-2: #f1f3f7;      /* 表头/工具条：明显下沉一档 */
--app-surface: #ffffff;   /* 卡片面 */
--app-surface-2: #fafbfc; /* 卡片内嵌块 */
--app-surface-3: #f4f6f9; /* 卡片内分组底（新增） */
--app-border: #e4e8ef;    /* 主分割：冷灰 */
--app-border-2: #eef1f5;  /* 弱分割 */
--app-border-strong: #d5dbe5; /* 强分割（新增：hover/选中行） */
```

### 1.3 卡片分层：把边框加回来，阴影改成三档

**这是本次改动里收益最大的一条。**

```css
/* 现状 styles.css:138-150 —— 删了边框，又几乎看不见阴影 */
.t-card {
  border-radius: var(--radius-l);
  border: none;                                    /* ← 删掉这行 */
  box-shadow: var(--shadow-1);
}

/* 改为 */
.t-card {
  border-radius: var(--radius-lg);
  border: 1px solid var(--app-border);            /* ← 加回 */
  box-shadow: var(--shadow-1);
}
.t-card--hover:hover {
  box-shadow: var(--shadow-2);
  transform: translateY(-1px);                    /* 2px → 1px，更克制 */
}
```

三档阴影：

```css
--shadow-1: 0 1px 2px rgba(15, 23, 42, 0.04);
--shadow-2: 0 1px 2px rgba(15, 23, 42, 0.04),
            0 6px 16px -4px rgba(15, 23, 42, 0.10);
--shadow-3: 0 12px 32px -8px rgba(15, 23, 42, 0.22);
```

> 阴影 `-4px` 的负偏移是关键：让阴影向上收，视觉上卡片是"浮"起来的而不是"糊"开一片。

### 1.4 品牌色：补全色阶，降饱和

现在只有一个 `--td-brand-color`，导致"淡品牌底"到处硬编码（`Dashboard.vue:301` 的 `#0b3ba5`、`Layout.vue:446` 的 `rgba(0,82,217,.28)`）。

```css
/* TDesign 默认 #0052d9 饱和度偏高、偏"电商蓝"。换成现代工作台的 #2563eb */
--td-brand-color:        #2563eb;
--td-brand-color-hover:  #3b82f6;
--td-brand-color-active: #1d4ed8;
--td-brand-color-light:  #eff4ff;   /* 淡底 */
--td-brand-color-focus:  #dbe6ff;   /* 聚焦环 */
--td-brand-color-border: #c7d9fe;   /* 描边 */
--td-brand-color-light-2:#f6f8ff;   /* 更淡的底 */
```

功能色同步降饱和（现在的 `#ed7b2f` 偏橘、`#d54941` 偏砖红）：

```css
--app-success:       #059669;  --app-success-light: #e8f6f0;
--app-warning:       #d97706;  --app-warning-light: #fef3e6;
--app-error:         #dc2626;  --app-error-light:   #fdecec;
```

### 1.5 补全刻度：圆角 / 字号 / 间距

现在的阶梯太稀，导致各页面各写各的。

```css
/* 圆角：补语义层级 */
--radius-xs:   2px;   /* 徽章/小色块 */
--radius-s:    6px;   /* 标签/输入框 */
--radius-m:    8px;   /* 按钮/小卡片 */
--radius-l:   12px;   /* 卡片/弹窗 */
--radius-xl:  16px;   /* 大面板/Hero */
--radius-full: 999px; /* 头像/药丸 */

/* 字号：补 15/18/22，26 与 34 之间不再是断崖 */
--fs-11: 11px; --fs-12: 12px; --fs-13: 13px;
--fs-14: 14px; --fs-15: 15px; --fs-16: 16px;
--fs-18: 18px; --fs-20: 20px; --fs-22: 22px;
--fs-26: 26px; --fs-34: 34px;

/* 间距：补大留白档，页面级呼吸感 */
--sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px;
--sp-5: 20px; --sp-6: 24px; --sp-7: 28px; --sp-8: 32px;
--sp-10: 40px; --sp-12: 48px;
```

---

## 二、字体：补 MiSans Bold（这是"质感"的隐形杀手）

**现状**：`public/fonts/misans/` 只有 Regular(400) 和 Medium(500)，但全站大量使用 `font-weight: 600/700`
（`Layout.vue:382`、`Dashboard.vue:327`、`Screen.vue:545`、`BracketPlay.vue:576` 等）。

浏览器只能做 faux-bold 合成 —— 中文笔画会**发虚、发糊**，这恰恰是"不高级"最直接的来源。

**方案（择一）**：

- **A（推荐）**：从 MiSans 官网补 `MiSans-Bold.min.css` + 对应 woff2 分片，放入 `public/fonts/misans/`
- **B（零成本）**：把全站 `600/700` 统一降到 `500`（Medium 已有），视觉会立刻变"细"、变"现代"，且立刻消除合成加粗
  > 代价：标题的视觉权重下降。**建议 A、B 组合**：正文大标题用真实 Bold，界面内文字用 500

---

## 三、结构：四个层级问题

### 3.1 没有全局页面容器

`App.vue` 只有 `<router-view />`（8 行），每个页面自己发明容器（`Dashboard.vue` 的 `.dash`、`.two-col`、`.panel`；`Schedule.vue` 的 `.toolbar`、`.gantt-card`），间距/圆角/阴影各写一遍。

**建议**：在 `styles.css` 定义统一的页面骨架。

```css
.page {
  max-width: 1440px;         /* 关键：1920 宽屏上不要无限拉伸 */
  margin: 0 auto;
  padding: var(--sp-6);
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--sp-4);
  margin-bottom: var(--sp-1);
}
.page-title { font-size: var(--fs-20); font-weight: 600; letter-spacing: .2px; }
.page-desc  { font-size: var(--fs-13); color: var(--app-text-2); margin-top: 2px; }
```

> 现在 `Layout.vue` 的内容区 padding 是 20/24px 且**没有最大宽度**。在 1920 宽屏上表格会拉得极宽、左右两侧大片留白松散 —— 这是"显得不专业"的常见原因。

### 3.2 顶栏没有面包屑、没有全局锚点

`Layout.vue` 的 56px 顶栏目前只有"赛事切换 + 用户菜单"，信息密度低。

**建议**：

```
[赛事切换 ▾]  /  赛事组织  /  赛程编排                    [🔍 全局搜索]  [大屏预览]  [头像]
```

- 加面包屑（`总览 / 赛事组织 / 赛程编排`），让管理员任何时候知道自己在哪
- 加"当前赛事"chip 徽标，把"当前操作的是哪一届"这个关键上下文常驻
- 顺带修 `Layout.vue:327` 的 `/password` 死路由（菜单里"修改密码"点了没反应）

### 3.3 侧边栏：加折叠 + 强化激活态

```css
/* 现状 Layout.vue:446 —— 纯色块，边界生硬 */
.nav-item.active { background: rgba(0, 82, 217, .28); color: #fff; }

/* 建议：低饱和填充 + 内描边 + 左侧指示条 */
.nav-item.active {
  background: rgba(59, 130, 246, .16);
  box-shadow: inset 0 0 0 1px rgba(96, 165, 250, .22);
  color: #fff;
  font-weight: 600;
}
```

另：216px 侧栏 + 17 项平铺偏挤，**加折叠态**（64px 图标模式）比继续压缩字号更有效。

### 3.4 Hero 区：去掉"三色渐变 + 装饰圆"

`Dashboard.vue:301` 的 `linear-gradient(120deg, #0b3ba5 0%, #0052d9 50%, #2669e8 100%)` + `::after` 装饰圆，
在 `Login.vue` 重复了一遍。**建议改为深墨蓝 + 细网格纹理 + 左侧品牌色强调条**：

```css
.hero {
  position: relative;
  border-radius: var(--radius-xl);
  padding: var(--sp-5) var(--sp-6);
  color: #fff;
  background:
    linear-gradient(0deg,  rgba(255,255,255,.028) 1px, transparent 1px) 0 0 / 100% 22px,
    linear-gradient(90deg, rgba(255,255,255,.028) 1px, transparent 1px) 0 0 / 22px 100%,
    linear-gradient(135deg, #0b1220 0%, #10233f 55%, #14356b 100%);
  box-shadow: var(--shadow-3);
}
.hero::before {            /* 左侧品牌色强调条，替代右上装饰圆 */
  content: '';
  position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
  background: linear-gradient(180deg, #60a5fa, #2563eb);
  border-radius: var(--radius-xl) 0 0 var(--radius-xl);
}
```

**为什么这个更好**：
1. 深色 Hero 在浅色工作台里形成明确的"主次分区"，不再是"一块蓝色"
2. 网格纹理给工业/体育气质，替代空洞的装饰圆
3. 左侧 3px 强调条是**方向性**的，视觉重心从右上角移到左侧，与面包屑的方向一致
4. Hero 右侧的空白改成**真实数据**（参赛学校数 / 报名人数），而不是浪费

### 3.5 清理硬编码色值

全站 26 个视图里约 183 行含硬编码 hex，**主力页面已经 token 化**（Schedule 40 token / 8 hex），
但三个页面完全脱管：

| 文件 | 硬编码 hex 行数 | token 使用 | 处理 |
|---|---|---|---|
| `BracketPlay.vue` | 40 | 0 | 🔴 **重写样式层**，收敛到品牌色暗色变体 |
| `BracketShow.vue` | 21 | 0 | 🔴 同上 |
| `Screen.vue` | 46 | 0 | 🟡 大屏可豁免，但 `theme-light` 分支要跟主站对齐 |
| `Dashboard.vue` | 11 | 25 | 🟡 图标底色改 CSS class |
| `Standing.vue` | 10 | 27 | 🟡 杂色收敛 |

**具体三处**：

```css
/* Dashboard.vue:31 —— 动态色值改 class */
<!-- 改前 -->
<div class="stat-icon" :style="{ background: card.iconBg }">
<!-- 改后 -->
<div class="stat-icon" :class="card.iconTone">   <!-- tone: 'blue'|'green'|'orange'|'violet' -->
```
```css
.stat-icon.tone-blue   { background: #eff4ff; color: #1d4ed8; }
.stat-icon.tone-green  { background: #e8f6f0; color: #047857; }
.stat-icon.tone-orange { background: #fef2e8; color: #b45309; }
.stat-icon.tone-violet { background: #f3eefe; color: #6d28d9; }
```
> 这一条同时解决 **Dashboard 暗色模式翻车**（现状 4 块浅色渐变硬编码在暗色下刺眼）。

```css
/* Layout.vue:64 —— 顶栏下拉箭头 */
<!-- 改前 --> style="color: rgba(0,0,0,.4)"
<!-- 改后 --> style="color: var(--app-text-3)"
```

**杂色统一表**：
| 现状 | 位置 | 改为 |
|---|---|---|
| `#8b8b8b`（作废/轮空灰） | Standing:562 / Schedule:1631 / MySchedule:391 | `var(--app-text-3)` |
| `#e37318` | TrackRace:992 | `var(--app-warning)` |
| `#00a870` | TrackPlan:941 | `var(--app-success)` |
| `#0d6efd` | PublicMeet:196 | `var(--td-brand-color)` |
| `#f5dab1/#dfe4ea/#f0d9c8` | Rank:264-266 奖牌色 | 重调为 TDesign 金银铜 |

---

## 四、移动端：补"更多"入口

**现状**：`Layout.vue:243` 的 tabbar 取 `slice(0, 4)`，管理员手机端只能进：
**赛事总览 · 报名管理 · 学校体育活动 · 赛程编排**

进不去：田径全流程（田径中心/日程与秩序册/赛中控台/成绩录入/赛后统计）、分组编排、项目与场地、学校与账号、裁判管理、大屏控制端、名次表。

**而登录页写着"手机现场也能录"（Login.vue:17-18）** —— 自我矛盾。

**方案**：tabbar 改为 4 个主项 + 1 个「更多」，点开复用现有 `comp-drawer`（`Layout.vue:94-124`）弹出全量菜单分组。

---

## 五、落地顺序

| 批次 | 内容 | 预估 | 风险 |
|---|---|---|---|
| **P0-1** | 中性字/中性面/边框/阴影/品牌色 → 替换 `styles.css` 第 1-86 行 | 0.5 天 | 低（纯 token，视觉立刻变好） |
| **P0-2** | `.t-card` 加回 1px 边框；Hero 改深墨蓝 + 强调条 | 0.5 天 | 低 |
| **P0-3** | Dashboard 图标改 class + 暗色修复；Layout 顶栏箭头 | 0.5 天 | 低 |
| **P0-4** | 补 MiSans Bold（或全站 600→500） | 0.5 天 | 低 |
| **P1-1** | 补齐圆角/字号/间距阶梯 + 全站硬编码色清理 | 1-2 天 | 中 |
| **P1-2** | `BracketPlay` / `BracketShow` 视觉收敛 | 1-2 天 | 中 |
| **P1-3** | 全局 `.page` 容器 + 页面骨架 + 内容最大宽度 | 1 天 | 中 |
| **P1-4** | 顶栏面包屑 + 当前赛事 chip + 修 `/password` 死路由 | 0.5 天 | 低 |
| **P2-1** | 侧边栏折叠态 | 1 天 | 中 |
| **P2-2** | 移动端"更多"抽屉 | 1 天 | 中 |
| **P2-3** | 引入图表库（Dashboard 参赛率环形图 / 项目分布条形） | 1 天 | 低 |

---

## 六、需要您确认的三点

1. **品牌主色**：现在是 TDesign 默认蓝 `#0052d9`。换成现代工作台蓝 `#2563eb` 观感更好，但会让 TDesign 组件的默认色也跟着变（可通过覆盖 `--td-brand-color` 集中控制）。**接受吗？**
2. **Hero 风格**：深墨蓝 + 网格纹理（沉稳、专业）还是保持现在的亮蓝渐变（活泼、赛事感强）？我倾向前者。
3. **字重方案**：补 MiSans Bold 文件，还是全站 600→500 走细字重路线？
