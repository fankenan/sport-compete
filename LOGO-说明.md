# Logo 方案说明

> 生成日期：2026-10-27　预览：打开根目录 `logo-preview.html`
>
> **当前状态：已采用方案 A 并完成全站接入（2026-10-27，commit 57036b9）**

## 已接入的三处

| 位置 | 文件 | 尺寸 | 说明 |
|---|---|---|---|
| 浏览器标签 favicon | `frontend/public/favicon.svg` | 16/32 | 已替换原「#409eff + 竞字」版本 |
| 登录页品牌区 | `Login.vue` `.brand-logo` | 40px | 去掉了半透明白底容器，加投影 |
| 侧边栏顶部 | `Layout.vue` `.brand-mark` | 34px | 去掉了渐变底和「竞」字 |
| 赛事大屏页头 | `Screen.vue` `.sc-logo` | 36px（移动端 28px） | 新增，`.sc-title` 改 flex |

**未加**：`PublicMeet.vue` 公开查询页 —— 该页以赛事信息为主体，加系统 logo 会分散注意力。

## 为什么三处都用 A、不混搭

原计划「大屏用 B、登录页用 C」，实施时改了：

- 登录页品牌区是**蓝色渐变**底，方案 C 的奖牌内圈也是 `#0052D9`，放上去内圈会融进背景，只剩金环，38px 下细节过密。
- 方案 A 的金杯 + 白色跑道弧在蓝底上反而是最突出的，且 `#0052D9` 恰是那层渐变的中间色，方底边界几乎看不出来。
- 一个系统只用一套主标，品牌识别更统一。**方案 B 保留**在 `logo-b-sprint.svg`，将来做学生端、活动物料或赛事专题页时可直接换。

## 文件清单

| 方案 | 文件 | 风格 | 建议用途 |
|---|---|---|---|
| **A** 奖杯与跑道 | `frontend/public/logo-a-trophy.svg` | 正统通用 | 系统主标、favicon |
| **B** 冲刺与终点线 | `frontend/public/logo-b-sprint.svg` | 动感年轻 | 大屏、公开页、学生端 |
| **C** 奖牌与绶带 | `frontend/public/logo-c-medal.svg` | 荣誉感 | 白色导航栏（唯一透明底） |
| **D** 盾徽与跑道 | `frontend/public/logo-d-shield.svg` | 官方权威 | 教育局对外平台主标 |

全部为 64×64 viewBox 的纯 SVG，无字体依赖（跨平台渲染一致），可直接缩放。

## 配色

| 用途 | 色值 | 说明 |
|---|---|---|
| 主色 | `#0052D9` | 与系统 `--td-brand-color` 完全一致 |
| 辅色（金） | `#FFC53D` | 奖杯 / 奖牌 / 金星 |
| 点缀（红） | `#E34D59` | 仅方案 B 的终点线 |
| 浅蓝 | `#4A8CF7` | 仅方案 C 的右侧绶带 |

## 现有 favicon 的问题

当前 `frontend/public/favicon.svg` 是一个蓝色圆角方块 + 白色「竞」字：

```svg
<rect width="32" height="32" rx="7" fill="#409eff"/>
<text x="16" y="22" font-size="18" font-family="sans-serif" fill="#fff">竞</text>
```

两个问题：① 用的 `#409eff` 和系统主色 `#0052D9` **不是一个蓝**；② 依赖 `sans-serif` 渲染汉字，不同系统下「竞」字形态不一致，16px 下容易糊。

## 选定后的替换步骤

1. `cp frontend/public/logo-{选定}.svg frontend/public/favicon.svg`
2. `Login.vue` 的 `.brand-logo`（现为「竞」字方块）换成图标
3. `Layout.vue` 侧边栏顶部换成图标
4. `npx vite build`
5. **两处 dist 都要更新**：内网机 `10.128.1.45` + 腾讯云 `150.158.39.237:8083`（只更一处会表现为"改了没生效"）

## 如需横式组合标

图标 + 中文名一行排开，用于大屏页头、外发材料、公文附件。需要单独出，横版要考虑：
- 中文名用 MiSans Medium，字号约为图标高度的 0.45
- 图标与文字间距 = 图标宽度的 0.3
- 副标题「登封市教育局 · 体卫艺科」用 0.6 倍字号、60% 透明
