# Element Plus → TDesign 迁移规范

> 供页面迁移使用。**只改模板和样式，不要动 script 里的业务逻辑和接口调用。**

## 一、组件映射表

| Element Plus | TDesign | 关键差异 |
|---|---|---|
| `<el-button type="primary">` | `<t-button theme="primary">` | **type → theme** |
| `<el-button link>` | `<t-button variant="text">` | **link → variant="text"** |
| `<el-button plain>` | `<t-button variant="outline">` | plain → variant="outline" |
| `<el-button text>` | `<t-button variant="text">` | |
| `<el-button :loading>` | 同，`:loading` | |
| `<el-button size="small">` | 同，`size="small"` | |
| `<el-input v-model>` | `<t-input v-model>` | 属性基本一致 |
| `<el-input type="textarea" :rows>` | `<t-textarea v-model :autosize="{minRows:2}">` | **textarea 独立组件** |
| `<el-input-number>` | `<t-input-number>` | 属性一致，`theme="normal"` 显示边框 |
| `<el-select>` + `<el-option>` | `<t-select>` + `<t-option>` | 同结构；也可用 `:options` 配置式 |
| `<el-dialog v-model>` | `<t-dialog v-model:visible>` | **v-model → v-model:visible** |
| `<el-dialog title>` | `<t-dialog header>` | **title → header** |
| `<el-dialog :width>` | `<t-dialog :width>` | 同 |
| `<template #footer>` | `<template #footer>` | 同 |
| `<el-form :model>` | `<t-form :data>` | **model → data** |
| `<el-form label-width>` | `<t-form label-width>` | 同 |
| `<el-form-item label required>` | `<t-form-item label name>` | **必填用 rules + name** |
| `<el-form-item #label>` | `<template #label>` | 同 |
| `<el-table>` + `<el-table-column>` | `<t-table :data :columns>` | **配置式，见下** |
| `<el-tabs v-model>` + `<el-tab-pane label name>` | `<t-tabs v-model>` + `<t-tab-panel label value>` | **name → value**；标签是 `t-tab-panel` |
| `<el-card>` + `<template #header>` | `<t-card>` + `<template #header>` | 或用 `:title` |
| `<el-tag type="success">` | `<t-tag theme="success">` | **type → theme** |
| `<el-tag effect="plain">` | `<t-tag variant="light">` | effect="plain" → variant="light" |
| `<el-radio-group>` + `<el-radio :label>` | `<t-radio-group>` + `<t-radio :value>` | **label → value** |
| `<el-checkbox :label>` | `<t-checkbox :value>` | **label → value** |
| `<el-drawer v-model>` | `<t-drawer v-model:visible>` | |
| `<el-progress :percentage>` | `<t-progress :percentage>` | 同；`:stroke-width` → `:stroke-width` |
| `<el-dropdown @command>` | `<t-dropdown :options @click>` | **command → click，参数是 option 对象** |
| `<el-popover>` | `<t-popup>` | |
| `<el-descriptions>` | `<t-descriptions>` + `<t-descriptions-item>` | 同结构 |
| `<el-empty>` | `<t-empty>` | |
| `<el-avatar>` | `<t-avatar>` | |
| `<el-icon><Xxx /></el-icon>` | `<t-icon name="xxx" />` | 用字符串名称 |
| `v-loading` | `:loading` 属性 | **指令变属性** |

## 二、表格迁移（重点）

TDesign 表格是**列配置式**，不能再用 `<el-table-column>` 子标签。

### 写法

```vue
<t-table
  :data="list"
  :columns="columns"
  row-key="id"
  size="small"
  :loading="loading"
  :empty="'暂无数据'"
  hover
>
  <!-- 插槽名 = 列的 cell 值；cell 未设置时 = colKey -->
  <template #status="{ row }">
    <t-tag :theme="row.status === 2 ? 'success' : 'warning'" variant="light" size="small">
      {{ statusLabel(row.status) }}
    </t-tag>
  </template>

  <template #ops="{ row }">
    <t-button variant="text" theme="primary" size="small" @click="edit(row)">修改</t-button>
    <t-button variant="text" theme="danger" size="small" @click="remove(row)">删除</t-button>
  </template>
</t-table>
```

```js
const columns = [
  { colKey: 'name', title: '姓名', width: 120 },
  { colKey: 'gender', title: '性别', width: 80, align: 'center' },
  { colKey: 'school_name', title: '学校', minWidth: 160, ellipsis: true },
  { colKey: 'status', title: '状态', width: 100 },      // cell 未设 → 插槽名 status
  { colKey: 'ops', title: '操作', width: 140, align: 'center', fixed: 'right' }
];
```

### 要点

- `colKey` 对应数据字段名；不需要显示的列可给它个任意 key（如 `ops`）
- 单元格插槽名 = `cell` 的值；若 `cell` 没设，就是 `colKey`
- **`row-key` 必须设置为数据里的唯一字段**（如 `"id"`），否则行选中会全选
- 纯文本列不用写插槽，TDesign 自动渲染 `row[colKey]`
- 空内容用 `:empty="'暂无数据'"`，不是 `empty-text`
- 需要横向滚动时，外层包 `<div class="table-scroll">`

## 三、消息与确认框

**不要再用 `ElMessage` / `ElMessageBox`。** 改用 `src/utils/ui.js`：

```js
import { message, confirm, alert, notify } from '../utils/ui';

message.success('已保存');
message.error(e.message);
message.warning('请填写姓名');

// 确认框（返回 Promise，确认 resolve，取消 reject）
confirm('确定删除？', '提示')
  .then(() => { /* 用户确认 */ })
  .catch(() => { /* 取消，无需处理 */ });

// 单按钮提示
await alert('账号已创建：xxx / 123456', '创建成功');
```

⚠️ `confirm` 取消时会 reject，**必须加 `.catch(() => {})`**，否则控制台会报未捕获的 Promise 拒绝。

## 四、样式规范

### 颜色

| 用途 | 值 |
|---|---|
| 主色 | `#0052d9` |
| 主色悬浮 | `#366ef4` |
| 危险 | `#e34d59` |
| 成功 | `#2ba471` |
| 警告 | `#ed7b2f` |
| 页面背景 | `var(--app-bg)` = `#f3f3f3` |
| 卡片白 | `#fff` |
| 边框 | `var(--app-border)` = `#e7e7e7` / 浅 `#f0f0f0` |
| 主文字 | `var(--app-text-1)` = `rgba(0,0,0,.9)` |
| 次文字 | `var(--app-text-2)` = `rgba(0,0,0,.6)` |
| 弱文字 | `var(--app-text-3)` = `rgba(0,0,0,.4)` |

**不要再写 `#409eff`、`#67c23a`、`#f56c6c`、`#e6a23c` 这些 Element 配色。**

### API 变量改名

| Element | TDesign |
|---|---|
| `--color-primary` | `#0052d9` 或 `var(--td-brand-color)` |
| `--color-text-primary` | `var(--app-text-1)` |
| `--color-text-secondary` | `var(--app-text-2)` |
| `--color-text-placeholder` | `var(--app-text-3)` |
| `--color-border` | `var(--app-border)` |
| `--color-background-tertiary` | `var(--app-bg)` |
| `--radius-lg` | `8px`（TDesign 圆角偏小） |

### 圆角

TDesign 圆角比 Element 小：卡片 6-8px，按钮/输入框 3-6px，标签 3px。

## 五、必须保留

1. **所有业务逻辑、接口路径、字段名一律不动**
2. **响应式**：`@media (max-width: 768px)` 里的规则保留，表格外层 `table-scroll` 保留
3. **`isMobile` 判断**保留（dialog 宽度用它）
4. 页面结构、信息层级、文案不改
5. `store.isAdmin` / `store.isSchool` 等角色判断不改

## 六、图标

用 `<t-icon name="xxx" />`，常用名称：

`add` `delete` `edit` `search` `refresh` `chevron-down` `chevron-left` `chevron-right`
`chevron-left-double` `chevron-right-double` `close` `check` `calendar` `user` `lock-on`
`upload` `download` `image` `file` `more` `filter` `setting` `logout` `view-list` `chart`

不确定名称时，宁可不加图标，也不要写错。

## 七、检查清单

改完每个文件后自查：

- [ ] 没有 `el-` 开头的标签残留
- [ ] 没有 `ElMessage` / `ElMessageBox` 引用
- [ ] 没有 `#409eff` / `#67c23a` / `#f56c6c` / `#e6a23c` 残留
- [ ] 没有 `--color-primary` 等 Element CSS 变量残留
- [ ] 表格用了 `columns` 配置 + `row-key`
- [ ] dialog 用 `v-model:visible`、`header` 属性
- [ ] tabs 用 `t-tab-panel` 和 `value`
- [ ] `confirm()` 调用都有 `.catch`
- [ ] script 部分业务逻辑未被改动
