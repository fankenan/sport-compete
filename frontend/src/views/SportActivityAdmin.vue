<template>
  <div class="sa-admin">
    <t-card class="sa-head">
      <div class="sa-head-row">
        <div>
          <p class="sa-title">学校体育活动 · 全区汇总</p>
          <p class="sa-sub">{{ currentTermLabel }} · {{ currentPhaseLabel }}</p>
        </div>
        <div class="sa-head-right">
          <t-select v-model="term" style="width: 200px" @change="load">
            <t-option v-for="t in termOptions" :key="t.value" :label="t.label" :value="t.value" />
          </t-select>
          <t-radio-group v-model="phase" variant="default-filled" @change="load">
            <t-radio-button :value="1">学期初</t-radio-button>
            <t-radio-button :value="2">学期中</t-radio-button>
            <t-radio-button :value="3">学期末</t-radio-button>
          </t-radio-group>
          <t-button variant="outline" :loading="loading" @click="load">刷新</t-button>
          <t-button theme="primary" variant="outline" @click="exportCsv">导出汇总表</t-button>
        </div>
      </div>
    </t-card>

    <div class="sa-metrics">
      <div class="sa-metric">
        <div class="sa-metric-label">已上报</div>
        <div class="sa-metric-value">{{ summary.reported || 0 }}<span class="sa-metric-unit"> / {{ summary.total || 0 }} 所</span></div>
        <div class="sa-metric-foot">待审核 {{ summary.pending || 0 }}，已通过 {{ summary.passed || 0 }}</div>
      </div>
      <div class="sa-metric">
        <div class="sa-metric-label">大课间 ≥15 分钟</div>
        <div class="sa-metric-value">{{ pct(summary.recess_ok) }}</div>
        <div class="sa-metric-foot">{{ summary.recess_ok || 0 }} 所达标</div>
      </div>
      <div class="sa-metric">
        <div class="sa-metric-label">每天 ≥60 分钟</div>
        <div class="sa-metric-value">{{ pct(summary.daily_ok) }}</div>
        <div class="sa-metric-foot">{{ summary.daily_ok || 0 }} 所达标</div>
      </div>
      <div class="sa-metric">
        <div class="sa-metric-label">武术进校园</div>
        <div class="sa-metric-value">{{ pct(summary.wushu_ok) }}</div>
        <div class="sa-metric-foot">{{ summary.wushu_ok || 0 }} 所已开展</div>
      </div>
      <div class="sa-metric">
        <div class="sa-metric-label">体育作业</div>
        <div class="sa-metric-value">{{ pct(summary.hw_ok) }}</div>
        <div class="sa-metric-foot">{{ summary.hw_ok || 0 }} 所已布置</div>
      </div>
    </div>

    <t-card class="sa-table-card">
      <div class="sa-filter">
        <t-select v-model="statusFilter" clearable placeholder="全部状态" style="width: 150px" @change="applyFilter">
          <t-option label="未上报" :value="0" />
          <t-option label="待审核" :value="1" />
          <t-option label="已通过" :value="2" />
          <t-option label="已退回" :value="3" />
        </t-select>
        <t-input v-model="keyword" clearable placeholder="搜索学校" style="width: 200px" @change="applyFilter" />
        <span class="sa-count">共 {{ filtered.length }} 所</span>
      </div>

      <t-table
        :data="paged"
        :columns="columns"
        row-key="school_id"
        :loading="loading"
        size="small"
        hover
        :empty="'暂无数据'"
      >
        <template #recess="{ row }">
          <span v-if="!row.reported" class="dim">—</span>
          <span v-else-if="!row.recess_enabled" class="dim">未开展</span>
          <span v-else :class="{ danger: !row.recess_ok }">{{ row.recess_minutes }} 分</span>
        </template>
        <template #daily="{ row }">
          <span v-if="!row.reported" class="dim">—</span>
          <span v-else :class="{ danger: !row.daily_ok }">{{ row.daily_minutes }} 分</span>
        </template>
        <template #comp="{ row }">
          <span v-if="!row.reported" class="dim">—</span>
          <span v-else>{{ row.comp_count || 0 }} 次</span>
        </template>
        <template #wushu="{ row }">
          <span v-if="!row.reported" class="dim">—</span>
          <span v-else-if="Number(row.wushu_enabled) === 1" class="ok">已开展</span>
          <span v-else class="dim">未开展</span>
        </template>
        <template #hw="{ row }">
          <span v-if="!row.reported" class="dim">—</span>
          <span v-else-if="Number(row.hw_enabled) === 1">{{ row.hw_freq || '已布置' }}</span>
          <span v-else class="dim">未布置</span>
        </template>
        <template #status="{ row }">
          <t-tag :theme="statusTheme(row.status)" size="small" variant="light">{{ statusLabel(row.status, row.reported) }}</t-tag>
        </template>
        <template #ops="{ row }">
          <t-button variant="text" theme="primary" size="small" :disabled="!row.reported" @click="openDetail(row)">查看</t-button>
          <template v-if="Number(row.status) === 1">
            <t-button variant="text" theme="success" size="small" @click="audit(row, 2)">通过</t-button>
            <t-button variant="text" theme="danger" size="small" @click="audit(row, 3)">退回</t-button>
          </template>
        </template>
      </t-table>

      <div class="sa-pager">
        <t-pagination
          v-model="page"
          :total="filtered.length"
          :page-size="pageSize"
          :show-page-size="false"
          :show-jumper="true"
        />
      </div>
    </t-card>

    <!-- 详情抽屉 -->
    <t-drawer v-model:visible="drawerVisible" header="填报详情" size="560px" attach="body" :footer="false">
      <template v-if="current">
        <div class="sa-detail-head">
          <span class="sa-detail-school">{{ current.school_name }}</span>
          <t-tag :theme="statusTheme(current.status)" variant="light" size="small">{{ statusLabel(current.status, current.reported) }}</t-tag>
        </div>

        <div class="sa-section">
          <div class="sa-section-title">一、阳光大课间</div>
          <div class="sa-kv"><span>是否开展</span><b>{{ Number(current.recess_enabled) === 1 ? '是' : '否' }}</b></div>
          <div class="sa-kv"><span>每次时长</span><b :class="{ danger: current.recess_enabled && !current.recess_ok }">{{ current.recess_minutes || 0 }} 分钟{{ current.recess_enabled ? (current.recess_ok ? '（已达标）' : '（未达15分钟）') : '' }}</b></div>
          <div class="sa-kv"><span>每周次数</span><b>{{ current.recess_weekly || 0 }}</b></div>
          <div class="sa-kv"><span>主要形式</span><b>{{ current.recess_forms || '—' }}</b></div>
          <div class="sa-kv"><span>参与年级</span><b>{{ current.recess_scope || '—' }}</b></div>
          <PhotoRow :list="current.photos?.recess" />
        </div>

        <div class="sa-section">
          <div class="sa-section-title">二、每天体育活动时间</div>
          <div class="sa-kv"><span>体育课</span><b>{{ current.pe_weekly || 0 }} 节/周 × {{ current.pe_minutes || 0 }} 分钟</b></div>
          <div class="sa-kv"><span>大课间折算</span><b>{{ current.recess_daily || 0 }} 分钟/天</b></div>
          <div class="sa-kv"><span>课后活动</span><b>{{ current.after_class_minutes || 0 }} 分钟/天</b></div>
          <div class="sa-kv"><span>每天合计</span><b :class="{ danger: !current.daily_ok }">{{ current.daily_minutes || 0 }} 分钟{{ current.daily_ok ? '（达标）' : '（未达60分钟）' }}</b></div>
          <PhotoRow :list="current.photos?.time" />
        </div>

        <div class="sa-section">
          <div class="sa-section-title">三、校内竞赛</div>
          <div class="sa-kv"><span>本学期次数</span><b>{{ current.comp_count || 0 }} 次</b></div>
          <div class="sa-kv"><span>参与学生</span><b>{{ current.comp_join_count || 0 }} 人</b></div>
          <div class="sa-kv"><span>覆盖项目</span><b>{{ current.comp_sports || '—' }}</b></div>
          <div class="sa-kv col"><span>做法与亮点</span><p>{{ current.comp_desc || '—' }}</p></div>
          <PhotoRow :list="current.photos?.comp" />
        </div>

        <div class="sa-section">
          <div class="sa-section-title">四、武术进校园</div>
          <div class="sa-kv"><span>是否开展</span><b>{{ Number(current.wushu_enabled) === 1 ? '是' : '否' }}</b></div>
          <div class="sa-kv"><span>开展形式</span><b>{{ current.wushu_forms || '—' }}</b></div>
          <div class="sa-kv"><span>覆盖年级</span><b>{{ current.wushu_scope || '—' }}</b></div>
          <div class="sa-kv"><span>每周次数</span><b>{{ current.wushu_weekly || 0 }}</b></div>
          <div class="sa-kv"><span>师资来源</span><b>{{ current.wushu_teacher || '—' }}</b></div>
          <div class="sa-kv col"><span>成效与特色</span><p>{{ current.wushu_desc || '—' }}</p></div>
          <PhotoRow :list="current.photos?.wushu" />
        </div>

        <div class="sa-section">
          <div class="sa-section-title">五、体育作业</div>
          <div class="sa-kv"><span>是否布置</span><b>{{ Number(current.hw_enabled) === 1 ? '是' : '否' }}</b></div>
          <div class="sa-kv"><span>频次</span><b>{{ current.hw_freq || '—' }}</b></div>
          <div class="sa-kv"><span>内容形式</span><b>{{ current.hw_forms || '—' }}</b></div>
          <div class="sa-kv"><span>检查方式</span><b>{{ current.hw_check || '—' }}</b></div>
          <PhotoRow :list="current.photos?.hw" />
        </div>

        <div v-if="current.audit_note" class="sa-section">
          <div class="sa-section-title">审核意见</div>
          <p class="sa-note">{{ current.audit_note }}</p>
          <p class="sa-audit-by">{{ current.audited_by }} · {{ fmtTime(current.audited_at) }}</p>
        </div>

        <div v-if="Number(current.status) === 1" class="sa-drawer-actions">
          <t-button theme="success" @click="audit(current, 2)">通过</t-button>
          <t-button theme="danger" variant="outline" @click="openReject(current)">退回整改</t-button>
        </div>
      </template>
    </t-drawer>

    <!-- 退回整改 -->
    <t-dialog v-model:visible="rejectVisible" header="退回整改" :width="'460px'" attach="body">
      <p class="sa-reject-tip">请写明整改意见，学校端会直接看到这条说明。</p>
      <t-textarea
        v-model="rejectNote"
        :autosize="{ minRows: 3, maxRows: 6 }"
        :maxlength="300"
        placeholder="如：大课间仅 10 分钟，未达到 15 分钟要求，请整改后重新提交"
      />
      <template #footer>
        <t-button variant="outline" @click="rejectVisible = false">取消</t-button>
        <t-button theme="danger" :loading="rejecting" @click="doReject">确认退回</t-button>
      </template>
    </t-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, defineComponent, h } from 'vue';
import { MessagePlugin } from 'tdesign-vue-next';
import http from '../api/http';

/** 抽屉里的图片行 */
const PhotoRow = defineComponent({
  props: { list: { type: Array, default: () => [] } },
  setup(props) {
    return () => {
      if (!props.list || !props.list.length) return null;
      return h('div', { class: 'sa-photos' },
        props.list.map((p) => h('img', { src: p.url || p, class: 'sa-photo' })));
    };
  }
});

const termOptions = (() => {
  const now = new Date();
  const y = now.getFullYear();
  const startYear = now.getMonth() + 1 >= 9 ? y : y - 1;
  const list = [];
  for (let i = 0; i < 2; i++) {
    const sy = startYear - i;
    list.push({ label: `${sy}—${sy + 1}学年 第一学期`, value: `${sy}-${sy + 1}-1` });
    list.push({ label: `${sy}—${sy + 1}学年 第二学期`, value: `${sy}-${sy + 1}-2` });
  }
  return list;
})();

const term = ref(termOptions[0].value);
const phase = ref(1);
const loading = ref(false);
const rawList = ref([]);
const summary = ref({});
const statusFilter = ref(null);
const keyword = ref('');
const page = ref(1);
const pageSize = 20;
const drawerVisible = ref(false);
const current = ref(null);

const currentTermLabel = computed(() => (termOptions.find((t) => t.value === term.value) || {}).label || '');
const currentPhaseLabel = computed(() => ({ 1: '学期初', 2: '学期中', 3: '学期末' }[phase.value] || ''));

const columns = [
  { colKey: 'school_name', title: '学校', minWidth: 180, ellipsis: true },
  { colKey: 'recess', title: '大课间', width: 100, align: 'center' },
  { colKey: 'daily', title: '每天时长', width: 100, align: 'center' },
  { colKey: 'comp', title: '竞赛', width: 84, align: 'center' },
  { colKey: 'wushu', title: '武术', width: 92, align: 'center' },
  { colKey: 'hw', title: '体育作业', width: 100, align: 'center' },
  { colKey: 'status', title: '状态', width: 92, align: 'center' },
  { colKey: 'ops', title: '操作', width: 160, align: 'center', fixed: 'right' }
];

const filtered = computed(() => {
  let list = rawList.value;
  if (statusFilter.value !== null && statusFilter.value !== undefined && statusFilter.value !== '') {
    list = list.filter((x) => Number(x.status) === Number(statusFilter.value));
  }
  const kw = keyword.value.trim();
  if (kw) list = list.filter((x) => (x.school_name || '').includes(kw));
  return list;
});

const paged = computed(() => {
  const s = (page.value - 1) * pageSize;
  return filtered.value.slice(s, s + pageSize);
});

function pct(v) {
  const rep = Number(summary.value.reported) || 0;
  if (!rep) return '—';
  return Math.round(((Number(v) || 0) / rep) * 100) + '%';
}

function statusLabel(status, reported) {
  if (!reported && Number(status) === 0) return '未上报';
  return ({ 0: '草稿', 1: '待审核', 2: '已通过', 3: '已退回' })[status] || '未上报';
}
function statusTheme(status) {
  return ({ 0: 'default', 1: 'warning', 2: 'success', 3: 'danger' })[status] || 'default';
}
function fmtTime(s) {
  return s ? String(s).replace('T', ' ').slice(0, 16) : '';
}
function applyFilter() {
  page.value = 1;
}

async function load() {
  loading.value = true;
  try {
    const r = await http.get('/sport-activity/list', { params: { term: term.value, phase: phase.value } });
    rawList.value = r.list || [];
    summary.value = r.summary || {};
    page.value = 1;
  } catch (e) {
    MessagePlugin.error(e.message);
  } finally {
    loading.value = false;
  }
}

function openDetail(row) {
  current.value = row;
  drawerVisible.value = true;
}

const rejectVisible = ref(false);
const rejectNote = ref('');
const rejecting = ref(false);
const rejectTarget = ref(null);

function openReject(row) {
  rejectTarget.value = row;
  rejectNote.value = '';
  rejectVisible.value = true;
}

async function doReject() {
  if (!rejectNote.value.trim()) {
    MessagePlugin.warning('请填写整改意见');
    return;
  }
  rejecting.value = true;
  try {
    await http.post(`/sport-activity/${rejectTarget.value.id}/audit`, {
      status: 3,
      note: rejectNote.value.trim()
    });
    MessagePlugin.success('已退回');
    rejectVisible.value = false;
    drawerVisible.value = false;
    load();
  } catch (e) {
    MessagePlugin.error(e.message);
  } finally {
    rejecting.value = false;
  }
}

async function audit(row, st) {
  if (st === 3) {
    openReject(row);
    return;
  }
  try {
    await http.post(`/sport-activity/${row.id}/audit`, { status: 2 });
    MessagePlugin.success('已通过');
    drawerVisible.value = false;
    load();
  } catch (e) {
    MessagePlugin.error(e.message);
  }
}

function exportCsv() {
  const head = ['学校', '大课间(分钟)', '大课间是否达标', '每天时长(分钟)', '每天是否达标', '竞赛次数', '武术进校园', '体育作业', '状态'];
  const rows = filtered.value.map((r) => [
    r.school_name,
    r.reported && r.recess_enabled ? r.recess_minutes : '',
    r.reported ? (r.recess_ok ? '是' : '否') : '',
    r.reported ? r.daily_minutes : '',
    r.reported ? (r.daily_ok ? '是' : '否') : '',
    r.reported ? (r.comp_count || 0) : '',
    r.reported ? (Number(r.wushu_enabled) === 1 ? '是' : '否') : '',
    r.reported ? (Number(r.hw_enabled) === 1 ? (r.hw_freq || '是') : '否') : '',
    statusLabel(r.status, r.reported)
  ]);
  const csv = [head, ...rows].map((r) => r.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `学校体育活动汇总_${currentTermLabel.value}_${currentPhaseLabel.value}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  MessagePlugin.success('已导出');
}

onMounted(load);
</script>

<style scoped>
.sa-admin { padding-bottom: 24px; }
.sa-head { margin-bottom: 12px; }
.sa-head-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.sa-title { font-size: 15px; font-weight: 500; margin: 0; }
.sa-sub { font-size: 12px; color: var(--app-text-2); margin: 4px 0 0; }
.sa-head-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

.sa-metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-bottom: 12px; }
.sa-metric { background: var(--app-bg-2); border-radius: 8px; padding: 12px 14px; }
.sa-metric-label { font-size: 12px; color: var(--app-text-2); margin-bottom: 6px; }
.sa-metric-value { font-size: 22px; font-weight: 500; line-height: 1.2; }
.sa-metric-unit { font-size: 12px; font-weight: 400; color: var(--app-text-3); }
.sa-metric-foot { font-size: 11px; color: var(--app-text-3); margin-top: 4px; }

.sa-table-card { margin-bottom: 12px; }
.sa-filter { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.sa-count { font-size: 12px; color: var(--app-text-3); }
.sa-pager { display: flex; justify-content: flex-end; padding-top: 14px; }

.ok { color: var(--td-success-color); }
.danger { color: var(--td-error-color); }
.dim { color: var(--app-text-3); }

.sa-detail-head { display: flex; align-items: center; gap: 10px; padding-bottom: 12px; border-bottom: 1px solid var(--app-border); margin-bottom: 14px; }
.sa-detail-school { font-size: 15px; font-weight: 500; }

.sa-section { margin-bottom: 18px; }
.sa-section-title { font-size: 13px; font-weight: 500; margin-bottom: 10px; padding-left: 8px; border-left: 3px solid var(--td-brand-color); }
.sa-kv { display: flex; gap: 12px; font-size: 12px; padding: 5px 0; }
.sa-kv > span { width: 88px; color: var(--app-text-2); flex-shrink: 0; }
.sa-kv > b { font-weight: 400; color: var(--app-text-1); }
.sa-kv.col { flex-direction: column; gap: 4px; }
.sa-kv.col > p { margin: 0; line-height: 1.6; color: var(--app-text-1); white-space: pre-wrap; }

.sa-photos { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.sa-photo { width: 96px; height: 72px; object-fit: cover; border-radius: 6px; border: 1px solid var(--app-border); }

.sa-note { font-size: 12px; line-height: 1.7; margin: 0; white-space: pre-wrap; }
.sa-audit-by { font-size: 11px; color: var(--app-text-3); margin: 6px 0 0; }

.sa-reject-tip { font-size: 12px; color: var(--app-text-2); margin: 0 0 10px; }
.sa-drawer-actions { display: flex; gap: 10px; justify-content: flex-end; padding-top: 8px; border-top: 1px solid var(--app-border); }

@media (max-width: 1100px) {
  .sa-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
