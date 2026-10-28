<template>
  <div class="page">
    <div class="page-head">
      <h2>日程与秩序册</h2>
      <div class="head-right">
        <t-select v-model="compId" :options="compOptions" placeholder="选择赛事" style="width: 220px"
                  @change="onCompChange" />
      </div>
    </div>

    <t-tabs v-model="tab">
      <!-- ============ 日程编排 ============ -->
      <t-tab-panel value="timetable" label="日程编排">
        <div class="bar">
          <t-button theme="primary" @click="generateUnits">按赛期生成单元</t-button>
          <t-button variant="outline" @click="openUnitDialog()">添加单元</t-button>
          <t-button variant="outline" @click="autoArrange">自动排布</t-button>
          <t-button variant="outline" @click="detectConflicts">检测冲突</t-button>
          <t-button variant="outline" @click="openManualDialog">添加非比赛项</t-button>
          <t-tag v-if="conflictCount" theme="danger" variant="light">{{ conflictCount }} 处冲突</t-tag>
          <span class="hint">待排赛次 {{ pendingCount }} 个</span>
        </div>

        <div class="board">
          <!-- 左侧：待排赛次 -->
          <div class="pool">
            <div class="pool-h">待排赛次（拖到右侧单元）</div>
            <div class="pool-body">
              <div v-for="h in pending" :key="h.id" class="chip" draggable="true"
                   @dragstart="onDragStart($event, h)">
                <span class="ch-ev">{{ h.band_label || '' }}{{ h.event_name }}</span>
                <span class="ch-rd">{{ roundName(h.round_code) }}{{ h.heat_no ? '第' + h.heat_no + '组' : '' }}</span>
                <span class="ch-n">{{ h.entry_count }}人</span>
              </div>
              <div v-if="!pending.length" class="muted center">全部已排入日程</div>
            </div>
          </div>

          <!-- 右侧：按单元分组的日程 -->
          <div class="units">
            <div v-for="u in units" :key="u.id" class="unit">
              <div class="unit-h">
                <span class="uh-d">{{ u.unit_date }}</span>
                <span class="uh-p">{{ periodName(u.period) }}</span>
                <span class="uh-t">{{ (u.start_time || '').slice(0, 5) }}–{{ (u.end_time || '').slice(0, 5) }}</span>
                <div class="uh-op">
                  <t-link theme="primary" size="small" @click="openUnitDialog(u)">编辑</t-link>
                  <t-link theme="danger" size="small" style="margin-left:8px" @click="delUnit(u.id)">删除</t-link>
                </div>
              </div>
              <div class="unit-body" @dragover.prevent @drop="onDrop($event, u)">
                <div v-for="it in itemsOf(u.id)" :key="it.id" class="item" :class="{ conflict: it.conflict_flag, locked: it.locked_flag }">
                  <span class="it-t">{{ (it.start_time || '').slice(0, 5) }}</span>
                  <span class="it-n">{{ it.title }}</span>
                  <span class="it-v">{{ it.venue_name || '未定场地' }}</span>
                  <span class="it-m">{{ it.estimated_minutes }}′</span>
                  <t-tag v-if="it.conflict_flag" theme="danger" size="small" variant="light">冲突</t-tag>
                  <t-tag v-if="it.locked_flag" size="small" variant="light">锁定</t-tag>
                  <div class="it-op">
                    <t-link theme="primary" size="small" @click="openItemDialog(it)">改</t-link>
                    <t-link theme="danger" size="small" style="margin-left:6px" @click="delItem(it.id)">移</t-link>
                  </div>
                </div>
                <div v-if="!itemsOf(u.id).length" class="muted center sm">拖到这里</div>
              </div>
            </div>
            <div v-if="!units.length" class="muted center">还没有日程单元，先点「按赛期生成单元」</div>
          </div>
        </div>

        <!-- 冲突列表 -->
        <t-card v-if="conflicts.length" title="冲突清单" size="small" style="margin-top:14px">
          <t-table :data="conflicts" :columns="conflictCols" row-key="id" bordered>
            <template #op="{ row }">
              <t-link theme="primary" @click="resolveConflict(row.id)">标记已处理</t-link>
            </template>
          </t-table>
        </t-card>
      </t-tab-panel>

      <!-- ============ 秩序册 ============ -->
      <t-tab-panel value="order" label="秩序册">
        <t-row :gutter="16">
          <t-col :span="8">
            <t-card title="章节编排" size="small">
              <t-table :data="sections" :columns="sectionCols" row-key="code" bordered
                       drag-sort="row" @drag-sort="onSectionSort">
                <template #enabled="{ row }">
                  <t-switch v-model="row.enabled" :custom-value="[1, 0]" size="small" />
                </template>
              </t-table>
              <div style="margin-top:12px">
                <t-button theme="primary" @click="saveOrderBook">保存编排</t-button>
                <t-button variant="outline" style="margin-left:8px" @click="genOrderBook">生成秩序册</t-button>
                <t-button theme="primary" style="margin-left:8px" :loading="pdfLoading" @click="downloadOrderPdf">
                  下载 PDF
                </t-button>
                <t-button variant="outline" style="margin-left:8px" @click="previewOrder">网页预览</t-button>
                <t-button variant="outline" style="margin-left:8px" @click="exportOrder">导出 Word</t-button>
              </div>
            </t-card>
          </t-col>
          <t-col :span="4">
            <t-card title="封面与说明" size="small">
              <t-form label-width="80px">
                <t-form-item label="标题"><t-input v-model="obForm.title" placeholder="留空用赛事名" /></t-form-item>
                <t-form-item label="副标题"><t-input v-model="obForm.subtitle" /></t-form-item>
                <t-form-item label="封面说明"><t-textarea v-model="obForm.cover_note" :autosize="{ minRows: 3 }" /></t-form-item>
              </t-form>
            </t-card>
          </t-col>
        </t-row>
      </t-tab-panel>

      <!-- ============ 奖状 ============ -->
      <t-tab-panel value="cert" label="奖状">
        <div class="bar">
          <t-select v-model="tplId" :options="tplOptions" placeholder="选择奖状模板" style="width:220px"
                    @change="loadCertRecords" />
          <t-button theme="primary" @click="openTplDialog()">新建模板</t-button>
          <t-button v-if="tplId" variant="outline" @click="openTplDialog(currentTpl)">编辑模板</t-button>
          <t-button v-if="tplId" variant="outline" @click="genCerts">批量生成</t-button>
          <t-button v-if="tplId && certRecords.length" variant="outline" @click="printCerts">打印</t-button>
          <t-button v-if="tplId && certRecords.length" variant="outline" @click="markPrinted">标记已打印</t-button>
          <t-select v-model="rankLimit" :options="rankOptions" style="width:120px" />
          <t-radio-group v-model="certSource">
            <t-radio value="INDIVIDUAL">个人</t-radio>
            <t-radio value="TEAM">团体</t-radio>
          </t-radio-group>
        </div>

        <t-alert v-if="!tplId" theme="info" message="先新建一个奖状模板" style="margin-bottom:12px" />

        <t-table v-if="tplId" :data="certRecords" :columns="certCols" row-key="id" bordered>
          <template #op="{ row }">
            <t-link theme="danger" @click="delCert(row.id)">删除</t-link>
          </template>
        </t-table>

        <!-- 打印区 -->
        <div v-if="tplId && certRecords.length" id="certPrint" class="cert-print">
          <div v-for="r in certRecords" :key="r.id" class="cert-page"
               :style="certPageStyle">
            <template v-for="f in (currentTpl?.fields_json || [])" :key="f.key">
              <div v-if="fieldValue(r, f.key)" class="cert-field" :style="fieldStyle(f)">
                {{ fieldValue(r, f.key) }}
              </div>
            </template>
          </div>
        </div>
      </t-tab-panel>

      <!-- ============ 改期与锁 ============ -->
      <t-tab-panel value="lock" label="改期与锁">
        <t-row :gutter="16">
          <t-col :span="12">
            <t-card title="赛事四把锁" size="small" style="margin-bottom:14px">
              <t-alert theme="info" message="上锁后对应功能禁止修改，防止赛前数据被误改" style="margin-bottom:12px" />
              <div class="lock-grid">
                <div v-for="l in lockList" :key="l.type" class="lock-card" :class="{ on: l.locked }">
                  <div class="lk-n">{{ l.name }}</div>
                  <div class="lk-s">{{ l.locked ? '已锁定' : '未锁定' }}</div>
                  <t-button size="small" :theme="l.locked ? 'success' : 'default'" variant="outline"
                            @click="toggleLock(l)">
                    {{ l.locked ? '解锁' : '上锁' }}
                  </t-button>
                </div>
              </div>
            </t-card>
          </t-col>
        </t-row>

        <t-row :gutter="16">
          <t-col :span="6">
            <t-card title="赛事整体改期" size="small">
              <t-form label-width="90px">
                <t-form-item label="平移天数">
                  <t-input-number v-model="shiftDays" :min="-60" :max="60" style="width:140px" />
                  <span class="hint" style="margin-left:8px">正数推迟、负数提前</span>
                </t-form-item>
                <t-form-item label="改期原因"><t-input v-model="shiftReason" placeholder="如 因天气原因顺延" /></t-form-item>
                <t-form-item>
                  <t-button theme="warning" @click="doReschedule">确认改期</t-button>
                </t-form-item>
              </t-form>
              <t-divider />
              <div class="hint">改期记录</div>
              <t-list :split="true" size="small">
                <t-list-item v-for="g in rescheduleLogs" :key="g.id">
                  {{ g.old_start_date }} → {{ g.new_start_date }}（{{ g.shift_days > 0 ? '+' : '' }}{{ g.shift_days }}天）
                  · {{ g.reason || '无说明' }} · {{ g.operation_by }}
                </t-list-item>
              </t-list>
            </t-card>
          </t-col>

          <t-col :span="6">
            <t-card title="赛事流程节点" size="small">
              <template #actions>
                <t-button size="small" variant="outline" @click="initFlowNodes">初始化</t-button>
              </template>
              <t-steps :current="currentStep" direction="vertical" size="small">
                <t-step-item v-for="n in flowNodes" :key="n.id"
                             :title="n.node_name"
                             :content="[n.plan_date, n.done_flag ? '已完成' : '待进行'].filter(Boolean).join(' · ')">
                  <template #extra>
                    <t-button size="small" variant="outline"
                              :theme="n.done_flag ? 'success' : 'default'"
                              @click="toggleNode(n)">
                      {{ n.done_flag ? '撤销' : '标记完成' }}
                    </t-button>
                  </template>
                </t-step-item>
              </t-steps>
              <div v-if="!flowNodes.length" class="muted center">点「初始化」生成流程节点</div>
            </t-card>
          </t-col>
        </t-row>
      </t-tab-panel>
    </t-tabs>

    <!-- 单元弹窗 -->
    <t-dialog v-model:visible="unitDialog" :header="unitForm.id ? '编辑单元' : '添加单元'" :width="480"
              :on-confirm="saveUnit" attach="body">
      <t-form :data="unitForm" label-width="90px">
        <t-form-item label="日期"><t-date-picker v-model="unitForm.unit_date" value-type="YYYY-MM-DD" style="width:200px" /></t-form-item>
        <t-form-item label="时段">
          <t-radio-group v-model="unitForm.period">
            <t-radio value="AM">上午</t-radio><t-radio value="PM">下午</t-radio>
            <t-radio value="NIGHT">晚间</t-radio><t-radio value="FULL">全天</t-radio>
          </t-radio-group>
        </t-form-item>
        <t-form-item label="名称"><t-input v-model="unitForm.name" placeholder="留空自动生成" /></t-form-item>
        <t-form-item label="起止时间">
          <t-time-picker v-model="unitForm.start_time" value-type="HH:mm:ss" style="width:130px" />
          <span style="margin:0 8px">—</span>
          <t-time-picker v-model="unitForm.end_time" value-type="HH:mm:ss" style="width:130px" />
        </t-form-item>
      </t-form>
    </t-dialog>

    <!-- 条目弹窗 -->
    <t-dialog v-model:visible="itemDialog" header="调整日程条目" :width="480" :on-confirm="saveItem" attach="body">
      <t-form :data="itemForm" label-width="90px">
        <t-form-item label="标题"><t-input v-model="itemForm.title" /></t-form-item>
        <t-form-item label="单元">
          <t-select v-model="itemForm.unit_id" :options="unitOptions" style="width:220px" />
        </t-form-item>
        <t-form-item label="场地">
          <t-select v-model="itemForm.venue_id" :options="venueOptions" clearable style="width:220px" />
        </t-form-item>
        <t-form-item label="开始时刻"><t-time-picker v-model="itemForm.start_time" value-type="HH:mm:ss" style="width:150px" /></t-form-item>
        <t-form-item label="用时(分)"><t-input-number v-model="itemForm.estimated_minutes" :min="1" style="width:120px" /></t-form-item>
        <t-form-item label="锁定">
          <t-switch v-model="itemForm.locked_flag" :custom-value="[1, 0]" />
          <span class="hint" style="margin-left:8px">锁定后自动排布不会改动</span>
        </t-form-item>
        <t-form-item v-if="itemForm.conflict_note" label="冲突">
          <span class="err">{{ itemForm.conflict_note }}</span>
        </t-form-item>
      </t-form>
    </t-dialog>

    <!-- 非比赛项弹窗 -->
    <t-dialog v-model:visible="manualDialog" header="添加非比赛项" :width="480" :on-confirm="saveManual" attach="body">
      <t-form :data="manualForm" label-width="90px">
        <t-form-item label="标题"><t-input v-model="manualForm.title" placeholder="如 开幕式 / 闭幕式 / 午休" /></t-form-item>
        <t-form-item label="单元"><t-select v-model="manualForm.unit_id" :options="unitOptions" style="width:220px" /></t-form-item>
        <t-form-item label="开始"><t-time-picker v-model="manualForm.start_time" value-type="HH:mm:ss" style="width:150px" /></t-form-item>
        <t-form-item label="用时(分)"><t-input-number v-model="manualForm.estimated_minutes" :min="1" style="width:120px" /></t-form-item>
      </t-form>
    </t-dialog>

    <!-- 奖状模板弹窗 -->
    <t-dialog v-model:visible="tplDialog" :header="tplForm.id ? '编辑奖状模板' : '新建奖状模板'" :width="760"
              :on-confirm="saveTpl" attach="body">
      <t-form :data="tplForm" label-width="100px">
        <t-form-item label="模板名称"><t-input v-model="tplForm.name" style="width:240px" /></t-form-item>
        <t-form-item label="类型">
          <t-radio-group v-model="tplForm.template_type">
            <t-radio value="INDIVIDUAL">个人</t-radio>
            <t-radio value="TEAM">团体</t-radio>
            <t-radio value="REFEREE">裁判</t-radio>
          </t-radio-group>
        </t-form-item>
        <t-form-item label="纸张">
          <t-radio-group v-model="tplForm.page_size">
            <t-radio value="A4">A4</t-radio><t-radio value="A5">A5</t-radio><t-radio value="16K">16K</t-radio>
          </t-radio-group>
          <t-radio-group v-model="tplForm.orientation" style="margin-left:16px">
            <t-radio value="landscape">横向</t-radio><t-radio value="portrait">纵向</t-radio>
          </t-radio-group>
        </t-form-item>
        <t-form-item label="背景图">
          <t-input v-model="tplForm.background_image" placeholder="图片地址，留空用默认底纹" style="width:360px" />
        </t-form-item>
        <t-form-item label="字段布局">
          <t-table :data="tplFields" :columns="fieldCols" row-key="key" bordered />
        </t-form-item>
      </t-form>
    </t-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { MessagePlugin, DialogPlugin } from 'tdesign-vue-next';
import http from '../api/http';
import { useUserStore } from '../store/user';

const store = useUserStore();
const tab = ref('timetable');
const compId = ref(store.competitionId);
const compOptions = ref([]);

// ---------- 日程 ----------
const units = ref([]);
const items = ref([]);
const pending = ref([]);
const conflicts = ref([]);
const venues = ref([]);
let dragHeat = null;

const pendingCount = computed(() => pending.value.length);
const conflictCount = computed(() => conflicts.value.filter((c) => !c.resolved_flag).length);
const unitOptions = computed(() => units.value.map((u) => ({ label: `${u.unit_date} ${periodName(u.period)}`, value: u.id })));
const venueOptions = computed(() => venues.value.map((v) => ({ label: v.name, value: v.id })));

function periodName(p) { return { AM: '上午', PM: '下午', NIGHT: '晚间', FULL: '全天' }[p] || p; }
function roundName(c) { return { PRELIM: '预赛', SEMI: '复赛', FINAL: '决赛' }[c] || ''; }
function itemsOf(uid) { return items.value.filter((i) => i.unit_id === uid); }

const conflictCols = [
  { colKey: 'conflict_type', title: '类型', width: 100, cell: (h, { row }) => ({ VENUE: '场地重叠', ATHLETE: '兼项冲突', REST: '休息不足' }[row.conflict_type] || row.conflict_type) },
  { colKey: 'item_title', title: '条目', minWidth: 170 },
  { colKey: 'other_title', title: '冲突条目', minWidth: 170 },
  { colKey: 'athlete_name', title: '涉及人', width: 90 },
  { colKey: 'detail', title: '说明', minWidth: 220 },
  { colKey: 'op', title: '操作', width: 100, align: 'center', cell: 'op' }
];

const unitDialog = ref(false);
const unitForm = reactive({ id: null, unit_date: '', period: 'AM', name: '', start_time: '08:30:00', end_time: '11:30:00' });
const itemDialog = ref(false);
const itemForm = reactive({ id: null, title: '', unit_id: null, venue_id: null, start_time: '', estimated_minutes: 10, locked_flag: 0, conflict_note: '' });
const manualDialog = ref(false);
const manualForm = reactive({ title: '', unit_id: null, start_time: '08:30:00', estimated_minutes: 20 });

// ---------- 秩序册 ----------
const sections = ref([]);
const obForm = reactive({ title: '', subtitle: '', cover_note: '' });
const sectionCols = [
  { colKey: 'name', title: '章节', minWidth: 180 },
  { colKey: 'code', title: '编码', width: 130 },
  { colKey: 'enabled', title: '启用', width: 90, align: 'center', cell: 'enabled' }
];

// ---------- 奖状 ----------
const tplId = ref(null);
const templates = ref([]);
const certRecords = ref([]);
const rankLimit = ref(3);
const certSource = ref('INDIVIDUAL');
const tplOptions = computed(() => templates.value.map((t) => ({ label: t.name, value: t.id })));
const currentTpl = computed(() => templates.value.find((t) => t.id === tplId.value) || null);
const rankOptions = [1, 2, 3, 4, 5, 6, 8].map((n) => ({ label: `前 ${n} 名`, value: n }));
const certCols = [
  { colKey: 'rank_no', title: '名次', width: 70, align: 'center' },
  { colKey: 'winner_name', title: '获奖人', width: 120 },
  { colKey: 'winner_school', title: '单位', minWidth: 160 },
  { colKey: 'award_name', title: '奖项', minWidth: 180 },
  { colKey: 'result_text', title: '成绩', width: 90, align: 'right' },
  { colKey: 'printed_flag', title: '打印', width: 70, align: 'center', cell: (h, { row }) => row.printed_flag ? '已打' : '未打' },
  { colKey: 'op', title: '操作', width: 70, align: 'center', cell: 'op' }
];
const tplDialog = ref(false);
const tplForm = reactive({ id: null, name: '', template_type: 'INDIVIDUAL', page_size: 'A4', orientation: 'landscape', background_image: '' });
const tplFields = ref([]);
const fieldCols = [
  { colKey: 'label', title: '字段', width: 110 },
  { colKey: 'x', title: 'X', width: 80, edit: { component: 'input-number' } },
  { colKey: 'y', title: 'Y', width: 80, edit: { component: 'input-number' } },
  { colKey: 'font_size', title: '字号', width: 80, edit: { component: 'input-number' } },
  { colKey: 'align', title: '对齐', width: 90, edit: { component: 'input' } }
];

// ---------- 改期与锁 ----------
const lockState = ref({});
const lockList = computed(() => [
  { type: 'ENROLL', name: '报名锁', locked: Number(lockState.value.enroll_lock_flag) === 1 },
  { type: 'SCHEDULE', name: '编排锁', locked: Number(lockState.value.schedule_lock_flag) === 1 },
  { type: 'TIMETABLE', name: '日程锁', locked: Number(lockState.value.timetable_lock_flag) === 1 },
  { type: 'ORDER_BOOK', name: '秩序册锁', locked: Number(lockState.value.order_book_lock_flag) === 1 }
]);
const shiftDays = ref(1);
const shiftReason = ref('');
const rescheduleLogs = ref([]);
const flowNodes = ref([]);
const currentStep = computed(() => {
  const i = flowNodes.value.findIndex((n) => !n.done_flag);
  return i < 0 ? flowNodes.value.length : i;
});

// ============================================================
onMounted(async () => {
  const list = await http.get('/competition/list') || [];
  compOptions.value = list.map((c) => ({ label: c.name, value: c.id }));
  if (compId.value) await onCompChange();
});

watch(tab, async (v) => {
  if (!compId.value) return;
  if (v === 'timetable') await loadTimetable();
  if (v === 'order') await loadOrderBook();
  if (v === 'cert') await Promise.all([loadTemplates(), loadCertRecords()]);
  if (v === 'lock') await Promise.all([loadLocks(), loadRescheduleLogs(), loadFlowNodes()]);
});

async function onCompChange() {
  store.setCompetition(compId.value);
  await Promise.all([loadTimetable(), loadVenues(), loadOrderBook(), loadTemplates(),
    loadLocks(), loadRescheduleLogs(), loadFlowNodes()]);
}

async function loadVenues() {
  venues.value = await http.get('/venue/list', { params: { competition_id: compId.value } }) || [];
}

async function loadTimetable() {
  units.value = await http.get('/track-plan/units', { params: { competition_id: compId.value } }) || [];
  items.value = await http.get('/track-plan/items', { params: { competition_id: compId.value } }) || [];
  pending.value = await http.get('/track-plan/pending-heats', { params: { competition_id: compId.value } }) || [];
  conflicts.value = await http.get('/track-plan/conflicts', { params: { competition_id: compId.value } }) || [];
}

async function generateUnits() {
  const r = await http.post('/track-plan/units/generate', { competition_id: compId.value, periods: ['AM', 'PM'] });
  MessagePlugin.success(r?.message || '已生成');
  await loadTimetable();
}

function openUnitDialog(u) {
  Object.assign(unitForm, {
    id: u?.id || null,
    unit_date: u?.unit_date || String(new Date().toISOString().slice(0, 10)),
    period: u?.period || 'AM',
    name: u?.name || '',
    start_time: u?.start_time || '08:30:00',
    end_time: u?.end_time || '11:30:00'
  });
  unitDialog.value = true;
}

async function saveUnit() {
  if (!unitForm.unit_date) { MessagePlugin.warning('请选择日期'); return; }
  const r = await http.post('/track-plan/units', { ...unitForm, competition_id: compId.value });
  MessagePlugin.success(r?.message || '已保存');
  unitDialog.value = false;
  await loadTimetable();
}

async function delUnit(id) {
  await http.delete(`/track-plan/units/${id}`);
  MessagePlugin.success('已删除');
  await loadTimetable();
}

async function autoArrange() {
  const r = await http.post('/track-plan/arrange', { competition_id: compId.value, clear: true });
  MessagePlugin.success(r?.message || '排布完成');
  await loadTimetable();
}

async function detectConflicts() {
  const r = await http.post('/track-plan/detect', { competition_id: compId.value });
  MessagePlugin.success(r?.message || '检测完成');
  await loadTimetable();
}

async function resolveConflict(id) {
  await http.post(`/track-plan/conflicts/${id}/resolve`);
  MessagePlugin.success('已标记');
  await loadTimetable();
}

function onDragStart(ev, h) { dragHeat = h; ev.dataTransfer.effectAllowed = 'move'; }

async function onDrop(ev, u) {
  if (!dragHeat) return;
  // 放到该单元末尾
  const list = itemsOf(u.id);
  let start = (u.start_time || '08:30:00').slice(0, 5);
  if (list.length) {
    const last = list[list.length - 1];
    start = last.end_time ? last.end_time.slice(0, 5) : start;
  }
  const mins = dragHeat.event_type === 'FIELD' ? Math.max(20, (dragHeat.entry_count || 0) * 2 + 10)
    : Math.max(8, Math.round((dragHeat.entry_count || 0) * 0.8) + 5);
  await http.post('/track-plan/item', {
    competition_id: compId.value,
    unit_id: u.id,
    title: `${dragHeat.band_label || ''}${dragHeat.event_name} ${roundName(dragHeat.round_code)}${dragHeat.heat_no ? '第' + dragHeat.heat_no + '组' : ''}`.trim(),
    start_time: start + ':00',
    estimated_minutes: mins
  });
  // 关联赛次
  const fresh = await http.get('/track-plan/pending-heats', { params: { competition_id: compId.value } }) || [];
  dragHeat = null;
  MessagePlugin.success('已加入日程');
  await loadTimetable();
}

function openItemDialog(it) {
  Object.assign(itemForm, {
    id: it.id, title: it.title, unit_id: it.unit_id, venue_id: it.venue_id,
    start_time: it.start_time || '08:30:00', estimated_minutes: it.estimated_minutes || 10,
    locked_flag: Number(it.locked_flag) || 0, conflict_note: it.conflict_note || ''
  });
  itemDialog.value = true;
}

async function saveItem() {
  await http.put(`/track-plan/item/${itemForm.id}`, { ...itemForm });
  MessagePlugin.success('已更新');
  itemDialog.value = false;
  await loadTimetable();
}

async function delItem(id) {
  await http.delete(`/track-plan/item/${id}`);
  MessagePlugin.success('已移除');
  await loadTimetable();
}

function openManualDialog() {
  Object.assign(manualForm, { title: '', unit_id: units.value[0]?.id ?? null, start_time: '08:30:00', estimated_minutes: 20 });
  manualDialog.value = true;
}

async function saveManual() {
  if (!manualForm.title) { MessagePlugin.warning('请填写标题'); return; }
  await http.post('/track-plan/item', { ...manualForm, competition_id: compId.value });
  MessagePlugin.success('已添加');
  manualDialog.value = false;
  await loadTimetable();
}

// ---------- 秩序册 ----------
async function loadOrderBook() {
  const b = await http.get('/track-plan/order-book', { params: { competition_id: compId.value } });
  if (b) {
    sections.value = b.sections_json || [];
    Object.assign(obForm, { title: b.title || '', subtitle: b.subtitle || '', cover_note: b.cover_note || '' });
  }
}

function onSectionSort({ newData }) { sections.value = newData; }

async function saveOrderBook() {
  await http.put('/track-plan/order-book', {
    competition_id: compId.value, ...obForm, sections_json: sections.value
  });
  MessagePlugin.success('已保存');
}

async function genOrderBook() {
  await http.post('/track-plan/order-book/generate', { competition_id: compId.value });
  MessagePlugin.success('秩序册已生成');
}

async function previewOrder() {
  const d = await http.get('/track-plan/order-book/data', { params: { competition_id: compId.value } });
  const b = await http.get('/track-plan/order-book', { params: { competition_id: compId.value } });
  const html = buildOrderHtml(b, d);
  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

/** 直接下载带赛事水印的秩序册 PDF（正式打印用这个） */
const pdfLoading = ref(false);
async function downloadOrderPdf() {
  pdfLoading.value = true;
  try {
    const blob = await http.get('/track-plan/order-book/pdf', {
      params: { competition_id: compId.value },
      responseType: 'blob'
    });
    const d = await http.get('/track-plan/order-book', { params: { competition_id: compId.value } });
    const name = (d && d.title) || '秩序册';
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    MessagePlugin.success('PDF 已生成（含赛事水印）');
  } catch (e) {
    MessagePlugin.error(e.message || '生成失败');
  } finally {
    pdfLoading.value = false;
  }
}

async function exportOrder() {
  const d = await http.get('/track-plan/order-book/data', { params: { competition_id: compId.value } });
  const b = await http.get('/track-plan/order-book', { params: { competition_id: compId.value } });
  const html = buildOrderHtml(b, d, true);
  const blob = new Blob(['\ufeff' + html], { type: 'application/msword;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${b?.title || d?.competition?.name || '秩序册'}.doc`;
  a.click();
  URL.revokeObjectURL(a.href);
  MessagePlugin.success('已导出 Word');
}

function buildOrderHtml(book, data, forWord) {
  const c = data?.competition || {};
  const enabled = (book?.sections_json || []).filter((s) => Number(s.enabled) === 1)
    .sort((a, b2) => (a.sort_no || 0) - (b2.sort_no || 0));
  const title = book?.title || c.name || '秩序册';
  const css = `
    <style>
      body{font-family:'Microsoft YaHei',SimSun,sans-serif;margin:0;padding:0;}
      .page{padding:36px 40px;position:relative;z-index:1;}
      /* 赛事水印：固定在视口上，打印时每页都会重复出现 */
      .wm-layer{position:fixed;inset:0;pointer-events:none;display:flex;flex-wrap:wrap;
        align-items:center;justify-content:center;gap:74px 46px;transform:rotate(-28deg);
        overflow:hidden;font-size:24px;font-weight:700;letter-spacing:2px;
        color:rgba(0,0,0,0.055);z-index:0;}
      .wm-layer span{white-space:nowrap;}
      @media print{.wm-layer{position:fixed;}}
      h1{text-align:center;font-size:30px;margin:60px 0 10px;}
      .sub{text-align:center;font-size:15px;color: var(--app-text-2);margin-bottom:40px;}
      h2{font-size: 20px;border-left:4px solid var(--td-brand-color);padding-left:10px;margin:26px 0 12px;}
      table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px;}
      th,td{border:1px solid #999;padding:5px 7px;text-align:left;}
      th{background:#f0f3fa;}
      .cover-note{text-align:center;color:#666;margin-top:30px;font-size:13px;}
      .pb{page-break-after:always;}
      .foot{text-align:center;color: var(--app-text-3);font-size:12px;margin-top:30px;}
    </style>`;
  let body = '';

  // 水印文字取赛事全称
  const wmLabel = String(c.name || title || '').trim();
  // 预览/打印：整层平铺（fixed 在打印时每页重复）
  // 导出 Word：Word 对 fixed + rotate 支持差，改成每页右上角浅色标注
  const wmLayer = (!forWord && wmLabel)
    ? `<div class="wm-layer">${Array.from({ length: 14 }, () => `<span>${wmLabel}</span>`).join('')}</div>`
    : '';

  for (const s of enabled) {
    body += `<div class="page${forWord ? ' pb' : ''}">`;
    if (forWord && wmLabel) {
      body += `<div style="position:absolute;top:10px;right:16px;font-size:11px;color:#c9c9c9;letter-spacing:1px">${wmLabel}</div>`;
    }
    if (s.code === 'COVER') {
      body += `<h1>${title}</h1><div class="sub">${book?.subtitle || ''}</div>
               <div class="cover-note">${book?.cover_note || ''}</div>
               <div style="margin-top:80px;text-align:center;color:#666">
                 ${c.host_unit ? '主办单位：' + c.host_unit + '<br>' : ''}
                 ${c.venue ? '比赛地点：' + c.venue + '<br>' : ''}
                 ${c.start_date ? '比赛时间：' + c.start_date + ' 至 ' + c.end_date : ''}
               </div>`;
    } else if (s.code === 'REGULATION') {
      body += `<h2>竞赛规程</h2>
        <table><tr><th style="width:120px">赛事名称</th><td>${c.name || ''}</td></tr>
        <tr><th>主办单位</th><td>${c.host_unit || '—'}</td></tr>
        <tr><th>比赛地点</th><td>${c.venue || '—'}</td></tr>
        <tr><th>比赛时间</th><td>${c.start_date || ''} 至 ${c.end_date || ''}</td></tr>
        <tr><th>直道 / 弯道</th><td>${c.straight_lane_count || 8} / ${c.curve_lane_count || 8} 道</td></tr>
        <tr><th>最小休息间隔</th><td>${c.minimum_rest_minutes || 30} 分钟</td></tr>
        <tr><th>联系人</th><td>${c.contact_person || '—'} ${c.contact_phone || ''}</td></tr></table>`;
    } else if (s.code === 'ORGANIZATION') {
      body += `<h2>组织机构</h2><table><tr><th>主办单位</th><td>${c.host_unit || '—'}</td></tr>
        <tr><th>比赛地点</th><td>${c.venue || '—'}</td></tr></table>`;
    } else if (s.code === 'SCHOOL_LIST') {
      body += `<h2>参赛单位名单</h2><table><tr><th style="width:60px">序号</th><th>单位名称</th></tr>`;
      (data?.schools || []).forEach((s2, i) => { body += `<tr><td>${i + 1}</td><td>${s2.name}</td></tr>`; });
      body += `</table>`;
    } else if (s.code === 'ATHLETE_LIST') {
      body += `<h2>运动员名单</h2><table>
        <tr><th>姓名</th><th>单位</th><th>组别</th><th>班级</th><th>参赛项目</th></tr>`;
      (data?.athletes || []).forEach((a) => {
        body += `<tr><td>${a.name}</td><td>${a.school_name}</td><td>${a.band_label || ''}</td>
                 <td>${a.class_name || ''}</td><td>${a.events || ''}</td></tr>`;
      });
      body += `</table>`;
    } else if (s.code === 'TIMETABLE') {
      body += `<h2>竞赛日程</h2><table>
        <tr><th>日期</th><th>时段</th><th>时间</th><th>项目</th><th>场地</th></tr>`;
      (data?.timetable || []).forEach((t) => {
        body += `<tr><td>${t.unit_date || ''}</td><td>${periodName(t.period)}</td>
                 <td>${(t.start_time || '').slice(0, 5)}</td><td>${t.title || t.event_name || ''}</td>
                 <td>${t.venue_name || ''}</td></tr>`;
      });
      body += `</table>`;
    } else if (s.code === 'HEAT_LIST') {
      body += `<h2>分组名单</h2>`;
      (data?.heats || []).forEach((h) => {
        body += `<h3 style="font-size:15px;margin:14px 0 6px">${h.band_label || ''}${h.event_name} ${roundName(h.round_code)}${h.heat_no ? '第' + h.heat_no + '组' : ''}</h3>
          <table><tr><th style="width:60px">道次</th><th>姓名</th><th>单位</th><th>号码</th></tr>`;
        (h.entries || []).forEach((e) => {
          body += `<tr><td>${e.lane_no ?? e.sort_no ?? ''}</td><td>${e.athlete_name}</td>
                   <td>${e.school_name || ''}</td><td>${e.bib_no ?? ''}</td></tr>`;
        });
        body += `</table>`;
      });
    } else if (s.code === 'RECORD') {
      body += `<h2>纪录一览</h2><table>
        <tr><th>项目</th><th>组别</th><th>赛会纪录</th><th>保持者</th><th>最高纪录</th><th>保持者</th></tr>`;
      (data?.records || []).forEach((r) => {
        body += `<tr><td>${r.event_name || ''}</td><td>${r.band_label || ''}</td>
                 <td>${r.meet_record_value || '—'}</td><td>${r.meet_record_holder || ''}</td>
                 <td>${r.highest_record_value || '—'}</td><td>${r.highest_record_holder || ''}</td></tr>`;
      });
      body += `</table>`;
    } else if (s.code === 'NOTICE') {
      body += `<h2>注意事项</h2><ol style="font-size:14px;line-height:2">
        <li>各参赛单位须于赛前 30 分钟到检录处检录，三次点名不到者按弃权处理。</li>
        <li>运动员须佩戴号码簿，服装、钉鞋须符合田径竞赛规则。</li>
        <li>径赛项目不得串道、不得带跑，违者取消该项比赛资格。</li>
        <li>田赛项目试跳（掷）次数按规程执行，无故延误按失败计。</li>
        <li>对成绩有异议须在该项比赛结束后 30 分钟内向仲裁委员会书面提出。</li>
        <li>兼项冲突时，运动员须向检录处报告，由裁判长按最小休息间隔协调。</li></ol>`;
    }
    body += `</div>`;
  }
  body += `<div class="foot">${title}</div>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>${css}</head><body>${wmLayer}${body}</body></html>`;
}

// ---------- 奖状 ----------
async function loadTemplates() {
  templates.value = await http.get('/track-plan/cert-templates', { params: { competition_id: compId.value } }) || [];
  if (!tplId.value && templates.value.length) tplId.value = templates.value[0].id;
}

async function loadCertRecords() {
  if (!tplId.value) { certRecords.value = []; return; }
  certRecords.value = await http.get('/track-plan/cert-records',
    { params: { competition_id: compId.value, template_id: tplId.value } }) || [];
}

const DEFAULT_TPL_FIELDS = [
  { key: 'winner_name', label: '获奖人', x: 400, y: 300, font_size: 32, align: 'center', bold: 1 },
  { key: 'award_name', label: '奖项', x: 400, y: 370, font_size: 22, align: 'center', bold: 0 },
  { key: 'winner_school', label: '单位', x: 400, y: 420, font_size: 18, align: 'center', bold: 0 },
  { key: 'competition_name', label: '赛事名', x: 400, y: 620, font_size: 16, align: 'center', bold: 0 },
  { key: 'date_text', label: '日期', x: 400, y: 660, font_size: 14, align: 'center', bold: 0 }
];

function openTplDialog(t) {
  Object.assign(tplForm, {
    id: t?.id || null, name: t?.name || '', template_type: t?.template_type || 'INDIVIDUAL',
    page_size: t?.page_size || 'A4', orientation: t?.orientation || 'landscape',
    background_image: t?.background_image || ''
  });
  tplFields.value = (t?.fields_json && t.fields_json.length) ? JSON.parse(JSON.stringify(t.fields_json)) : JSON.parse(JSON.stringify(DEFAULT_TPL_FIELDS));
  tplDialog.value = true;
}

async function saveTpl() {
  if (!tplForm.name) { MessagePlugin.warning('请填写模板名称'); return; }
  const r = await http.post('/track-plan/cert-templates', {
    ...tplForm, competition_id: compId.value, fields_json: tplFields.value
  });
  MessagePlugin.success(r?.message || '已保存');
  tplDialog.value = false;
  await loadTemplates();
  if (r?.data?.id) { tplId.value = r.data.id; await loadCertRecords(); }
}

async function genCerts() {
  const r = await http.post('/track-plan/cert/generate', {
    competition_id: compId.value, template_id: tplId.value,
    rank_limit: rankLimit.value, source: certSource.value
  });
  MessagePlugin.success(r?.message || '已生成');
  await loadCertRecords();
}

async function delCert(id) {
  await http.delete(`/track-plan/cert-records/${id}`);
  await loadCertRecords();
}

async function markPrinted() {
  await http.post('/track-plan/cert-records/printed', { competition_id: compId.value, template_id: tplId.value });
  MessagePlugin.success('已标记');
  await loadCertRecords();
}

function fieldValue(r, key) {
  if (key === 'competition_name') return compOptions.value.find((c) => c.value === compId.value)?.label || '';
  if (key === 'date_text') return new Date().toISOString().slice(0, 10);
  return r[key];
}

function certPageStyle() {
  const t = currentTpl.value;
  const w = t?.orientation === 'portrait' ? 794 : 1123;
  const h = t?.orientation === 'portrait' ? 1123 : 794;
  const bg = t?.background_image ? `url(${t.background_image})` : 'linear-gradient(160deg,#fffdf5,#f7edcf)';
  return { width: w + 'px', height: h + 'px', background: bg, backgroundSize: 'cover' };
}

function fieldStyle(f) {
  return {
    position: 'absolute',
    left: (f.x || 0) + 'px',
    top: (f.y || 0) + 'px',
    fontSize: (f.font_size || 16) + 'px',
    textAlign: f.align || 'center',
    fontWeight: f.bold ? 'bold' : 'normal',
    width: 'calc(100% - ' + (f.x || 0) * 2 + 'px)'
  };
}

function printCerts() {
  const el = document.getElementById('certPrint');
  if (!el) return;
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>奖状打印</title>
    <style>
      @page { size: ${currentTpl.value?.orientation === 'portrait' ? 'A4 portrait' : 'A4 landscape'}; margin: 0; }
      body { margin:0; font-family:'Microsoft YaHei',SimSun,sans-serif; }
      .cert-page { position:relative; page-break-after:always; }
      .cert-page:last-child { page-break-after:auto; }
    </style></head><body>${el.innerHTML}</body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 500);
}

// ---------- 改期与锁 ----------
async function loadLocks() {
  lockState.value = await http.get('/track-plan/locks', { params: { competition_id: compId.value } }) || {};
}

async function toggleLock(l) {
  await http.put('/track-plan/locks', {
    competition_id: compId.value, lock_type: l.type,
    action: l.locked ? 'UNLOCK' : 'LOCK'
  });
  MessagePlugin.success(l.locked ? '已解锁' : '已锁定');
  await loadLocks();
}

async function loadRescheduleLogs() {
  rescheduleLogs.value = await http.get('/track-plan/reschedule-logs', { params: { competition_id: compId.value } }) || [];
}

async function doReschedule() {
  if (!shiftDays.value) { MessagePlugin.warning('请填写平移天数'); return; }
  const d = await DialogPlugin.confirm({
    header: '确认改期',
    body: `确定把整个赛事${shiftDays.value > 0 ? '推迟' : '提前'} ${Math.abs(shiftDays.value)} 天吗？所有日程单元、球类时段、赛次计划日期将同步平移。`
  });
  d.hide();
  await new Promise((res) => {
    d.on('confirm', async () => {
      const r = await http.post('/track-plan/reschedule', {
        competition_id: compId.value, shift_days: shiftDays.value, reason: shiftReason.value
      });
      MessagePlugin.success(r?.message || '改期完成');
      await Promise.all([loadRescheduleLogs(), loadFlowNodes()]);
      res();
    });
    d.on('cancel', () => res());
  });
}

async function loadFlowNodes() {
  flowNodes.value = await http.get('/track-plan/flow-nodes', { params: { competition_id: compId.value } }) || [];
}

async function initFlowNodes() {
  await http.post('/track-plan/flow-nodes/init', { competition_id: compId.value });
  MessagePlugin.success('已初始化');
  await loadFlowNodes();
}

async function toggleNode(n) {
  await http.put(`/track-plan/flow-nodes/${n.id}`, { done_flag: n.done_flag ? 0 : 1, plan_date: n.plan_date, plan_time: n.plan_time });
  await loadFlowNodes();
}
</script>

<style scoped>
.page { padding: 16px; }
.page-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
.page-head h2 { margin: 0; font-size: 20px; font-weight: 600; }
.bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
.hint { font-size: 12px; color: var(--app-text-3); }
.muted { color: var(--app-text-3); font-size: 13px; }
.center { text-align: center; padding: 16px 0; }
.center.sm { padding: 8px 0; font-size: 12px; }
.err { color: var(--app-error); font-size: 12px; }

.board { display: flex; gap: 14px; align-items: flex-start; }
.pool { width: 240px; flex: none; background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 6px; }
.pool-h { padding: 8px 12px; font-size: 13px; font-weight: 600; border-bottom: 1px solid var(--app-border); background: var(--app-bg-2); }
.pool-body { padding: 8px; max-height: 520px; overflow: auto; }
.chip { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding: 6px 8px; margin-bottom: 6px;
        background: #e7eaff; border: 1px solid #c7d1f5; border-radius: 4px; cursor: grab; font-size: 12px; }
.chip:active { cursor: grabbing; }
.ch-ev { font-weight: 600; }
.ch-rd { color: var(--td-brand-color); }
.ch-n { color: var(--app-text-3); }

.units { flex: 1; display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; }
.unit { background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 6px; }
.unit-h { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--app-border); background: var(--app-bg-2); font-size: 13px; }
.uh-d { font-weight: 600; }
.uh-p { color: var(--td-brand-color); }
.uh-t { color: var(--app-text-3); font-size: 12px; }
.uh-op { margin-left: auto; }
.unit-body { padding: 8px; min-height: 90px; }
.item { display: flex; align-items: center; gap: 6px; padding: 6px 8px; margin-bottom: 6px;
        border: 1px solid var(--app-border); border-radius: 4px; font-size: 12px; background: var(--app-bg-2); }
.item.conflict { border-color: var(--app-error); background: #fff3ef; }
.item.locked { background: #f0f7ff; }
.it-t { font-weight: 600; width: 40px; }
.it-n { flex: 1; }
.it-v, .it-m { color: var(--app-text-3); }
.it-op { margin-left: auto; }

.lock-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.lock-card { border: 1px solid var(--app-border); border-radius: 6px; padding: 14px; text-align: center; }
.lock-card.on { border-color: #00a870; background: #e8f8f2; }
.lk-n { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
.lk-s { font-size: 12px; color: var(--app-text-3); margin-bottom: 8px; }

.cert-print { position: absolute; left: -9999px; top: 0; }
.cert-page { position: relative; overflow: hidden; }
.cert-field { position: absolute; }
</style>
