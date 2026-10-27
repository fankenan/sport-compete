<template>
  <div>
    <!-- 操作条 -->
    <t-card class="toolbar">
      <div class="tb-row">
        <t-button theme="primary" @click="openCreate">新建赛事</t-button>
        <t-button variant="outline" @click="loadList">刷新</t-button>
        <span class="tb-hint">共 {{ list.length }} 项赛事</span>
      </div>
    </t-card>

    <!-- 赛事列表 -->
    <t-card class="panel-card" header-bordered>
      <template #header>
        <div class="panel-head">
          <span>赛事列表</span>
          <span class="panel-hint">状态切换后可进入对应的筹备阶段</span>
        </div>
      </template>

      <div class="table-scroll">
        <t-table
          :data="list"
          :columns="columns"
          row-key="id"
          :loading="loading"
          :empty="'暂无赛事，请先新建'"
          hover
        >
          <template #stage="{ row }">
            <span class="dim">{{ stageLabel(row.stage) }}</span>
          </template>

          <template #date_range="{ row }">
            <span v-if="row.start_date || row.end_date" class="dim">
              {{ row.start_date || '未定' }} 至 {{ row.end_date || '未定' }}
            </span>
            <span v-else class="dim">未设置</span>
          </template>

          <template #status="{ row }">
            <t-tag :theme="statusType(row.status)" size="small" variant="light">
              {{ statusLabel(row.status) }}
            </t-tag>
          </template>

          <template #status_switch="{ row }">
            <t-select
              :value="row.status"
              size="small"
              style="width: 104px"
              :options="STATUS_LIST"
              @change="(v) => changeStatus(row, v)"
            />
          </template>

          <template #ops="{ row }">
            <t-button variant="text" theme="primary" size="small" @click="openEdit(row)">编辑</t-button>
            <t-button variant="text" theme="danger" size="small" @click="remove(row)">删除</t-button>
          </template>
        </t-table>
      </div>
    </t-card>

    <!-- 新建 / 编辑赛事 -->
    <t-dialog
      v-model:visible="dialogVisible"
      :header="form.id ? '编辑赛事' : '新建赛事'"
      :width="isMobile ? '92%' : '480px'" attach="body">
      <t-form :data="form" label-width="88px" label-align="right">
        <t-form-item label="赛事名称" required-mark>
          <t-input v-model="form.name" placeholder="如 2026年全市中小学生篮球联赛" :maxlength="64" />
        </t-form-item>
        <t-form-item label="年份" required-mark>
          <t-input-number v-model="form.year" :min="2000" :max="2100" :step="1" style="width: 100%" />
        </t-form-item>
        <t-form-item label="学段">
          <t-select v-model="form.stage" style="width: 100%" :options="STAGE_LIST" />
        </t-form-item>
        <t-form-item label="开始日期">
          <LunarDatePicker v-model="form.start_date" placeholder="选择开始日期" />
        </t-form-item>
        <t-form-item label="结束日期">
          <LunarDatePicker v-model="form.end_date" placeholder="选择结束日期" />
        </t-form-item>
        <t-form-item v-if="form.id" label="赛事状态">
          <t-select v-model="form.status" style="width: 100%" :options="STATUS_LIST" />
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button variant="outline" @click="dialogVisible = false">取消</t-button>
        <t-button theme="primary" :loading="saving" @click="submit">保存</t-button>
      </template>
    </t-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue';
import { useUserStore } from '../store/user';
import http from '../api/http';
import { message, confirm } from '../utils/ui';

const store = useUserStore();

const isMobile = ref(window.innerWidth <= 768);
function onResize() {
  isMobile.value = window.innerWidth <= 768;
}
onMounted(() => window.addEventListener('resize', onResize));
onUnmounted(() => window.removeEventListener('resize', onResize));

const STATUS_LIST = [
  { value: 1, label: '报名中', type: 'warning' },
  { value: 2, label: '分组中', type: 'primary' },
  { value: 3, label: '排期中', type: 'default' },
  { value: 4, label: '比赛中', type: 'success' },
  { value: 5, label: '已结束', type: 'danger' }
];

const STAGE_LIST = [
  { value: 0, label: '不限学段' },
  { value: 1, label: '小学' },
  { value: 2, label: '初中' },
  { value: 3, label: '高中' }
];

const columns = [
  { colKey: 'name', title: '赛事名称', minWidth: 180, ellipsis: true },
  { colKey: 'year', title: '年份', width: 80, align: 'center' },
  { colKey: 'stage', title: '学段', width: 90, align: 'center' },
  { colKey: 'date_range', title: '起止日期', minWidth: 180 },
  { colKey: 'status', title: '状态', width: 110, align: 'center' },
  { colKey: 'status_switch', title: '切换状态', width: 130, align: 'center' },
  { colKey: 'ops', title: '操作', width: 140, align: 'center', fixed: 'right' }
];

const list = ref([]);
const loading = ref(false);
const dialogVisible = ref(false);
const saving = ref(false);

const form = reactive({
  id: null,
  name: '',
  year: new Date().getFullYear(),
  stage: 0,
  start_date: '',
  end_date: '',
  status: 1
});

let currentRow = null;

function statusLabel(v) {
  return STATUS_LIST.find((s) => s.value === v)?.label || '未知';
}

function statusType(v) {
  return STATUS_LIST.find((s) => s.value === v)?.type || 'default';
}

function stageLabel(v) {
  return STAGE_LIST.find((s) => s.value === v)?.label || '不限学段';
}

async function loadList() {
  loading.value = true;
  try {
    list.value = await http.get('/competition/list');
  } catch (e) {
    message.error(e.message);
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  form.id = null;
  form.name = '';
  form.year = new Date().getFullYear();
  form.stage = 0;
  form.start_date = '';
  form.end_date = '';
  form.status = 1;
}

function openCreate() {
  resetForm();
  dialogVisible.value = true;
}

function openEdit(row) {
  currentRow = row;
  form.id = row.id;
  form.name = row.name;
  form.year = row.year;
  form.stage = row.stage ?? 0;
  form.start_date = row.start_date || '';
  form.end_date = row.end_date || '';
  form.status = row.status ?? 1;
  dialogVisible.value = true;
}

async function submit() {
  if (!form.name || !form.name.trim()) {
    message.warning('请填写赛事名称');
    return;
  }
  saving.value = true;
  try {
    const payload = {
      name: form.name.trim(),
      year: form.year,
      stage: form.stage,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      status: form.status
    };
    if (form.id) {
      await http.put(`/competition/${form.id}`, {
        ...payload,
        config_json: currentRow?.config_json
      });
      message.success('已保存');
    } else {
      const r = await http.post('/competition', payload);
      message.success('赛事已创建');
      if (r?.id) store.setCompetition(r.id);
    }
    dialogVisible.value = false;
    loadList();
  } catch (e) {
    message.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function changeStatus(row, status) {
  try {
    await http.put(`/competition/${row.id}`, {
      name: row.name,
      year: row.year,
      stage: row.stage ?? 0,
      start_date: row.start_date || null,
      end_date: row.end_date || null,
      status,
      config_json: row.config_json
    });
    row.status = status;
    message.success(`「${row.name}」已切换为${statusLabel(status)}`);
  } catch (e) {
    message.error(e.message);
  }
}

async function remove(row) {
  let okDelete = false;
  await confirm(
    `确定删除赛事「${row.name}」？该赛事下的报名、分组、赛程数据会一并清除。`,
    '删除确认',
    { confirmBtn: '确定删除', cancelBtn: '取消' }
  )
    .then(() => { okDelete = true; })
    .catch(() => {});
  if (!okDelete) return;

  try {
    await http.delete(`/competition/${row.id}`);
    message.success('已删除');
    if (String(store.competitionId) === String(row.id)) {
      store.setCompetition('');
    }
    loadList();
  } catch (e) {
    message.error(e.message);
  }
}

onMounted(loadList);
</script>

<style scoped>
.toolbar {
  margin-bottom: 14px;
  border-radius: 8px;
}

.panel-card {
  border-radius: 8px;
}

.tb-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tb-hint {
  font-size: 12px;
  color: var(--app-text-3);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  font-size: 14px;
  font-weight: 500;
  color: var(--app-text-1);
}

.panel-hint {
  font-size: 12px;
  font-weight: 400;
  color: var(--app-text-3);
}

.dim {
  font-size: 13px;
  color: var(--app-text-2);
}

.table-scroll {
  overflow-x: auto;
}

@media (max-width: 768px) {
  .panel-hint {
    display: none;
  }
}
</style>
