<template>
  <div>
    <t-card class="tr-card">
      <!-- 筛选条 -->
      <div class="filter-row">
        <t-select
          v-model="filter.event_item_id"
          clearable
          placeholder="全部项目"
          style="width: 180px"
          :options="eventOptions"
          @change="loadHeats"
        />
        <t-select
          v-model="filter.band_id"
          clearable
          placeholder="全部组别"
          style="width: 160px"
          :options="bandOptions"
          @change="loadHeats"
        />
        <t-select
          v-model="filter.round_code"
          clearable
          placeholder="全部赛次"
          style="width: 130px"
          :options="ROUND_LIST"
          @change="loadHeats"
        />
        <t-button theme="primary" @click="loadHeats">查询</t-button>
        <t-button variant="outline" @click="openArrange">分组编排</t-button>
        <t-button variant="outline" @click="openAdvance" :disabled="!filter.event_item_id">晋级录取</t-button>
        <span class="hint">成绩录入支持：11.23 / 1:23.45 / 5.62，未完赛填 DNS·DNF·DQ·NM</span>
      </div>

      <!-- 赛次分组 -->
      <div v-if="!heats.length" class="empty-tip">
        {{ loading ? '加载中…' : '暂无赛次分组，请先「分组编排」' }}
      </div>

      <div v-for="h in heats" :key="h.id" class="heat-block">
        <div class="hb-head">
          <span class="hb-event">{{ h.event_name }}</span>
          <span class="hb-band">{{ bandText(h) }}</span>
          <span class="hb-title">{{ h.heat_name }}</span>
          <t-tag v-if="h.confirm_flag === 1" theme="success" size="small" variant="light">已确认</t-tag>
          <t-tag v-else-if="h.status >= 3" theme="warning" size="small" variant="light">录入中</t-tag>
          <t-tag v-else size="small" variant="light">待录入</t-tag>
          <span class="hb-count">{{ h.entry_count }} 人</span>

          <div class="hb-ops">
            <t-button variant="text" theme="primary" size="small" @click="saveHeat(h)">保存成绩</t-button>
            <t-button
              v-if="h.confirm_flag !== 1"
              variant="text" theme="success" size="small"
              @click="confirmHeat(h)"
            >确认</t-button>
            <t-button
              v-else
              variant="text" theme="warning" size="small"
              @click="revokeHeat(h)"
            >撤销确认</t-button>
            <t-button variant="text" theme="danger" size="small" @click="clearHeat(h)">清空</t-button>
            <t-button variant="text" theme="default" size="small" @click="exportHeat(h)">导出</t-button>
          </div>
        </div>

        <!-- 径赛：道次表 -->
        <t-table
          v-if="h.event_type !== 'FIELD'"
          :data="h.entries"
          :columns="trackCols"
          row-key="id"
          hover
        >
          <template #lane_no="{ row }">
            <span class="lane-badge">{{ row.lane_no ?? '—' }}</span>
          </template>
          <template #athlete="{ row }">
            <div class="ath-cell">
              <span class="ath-name">{{ row.athlete_name }}</span>
              <span class="ath-sub">{{ row.school_name }}<template v-if="row.bib_no"> · {{ row.bib_no }} 号</template></span>
            </div>
          </template>
          <template #result="{ row }">
            <t-input
              v-model="row.result_text"
              size="small"
              style="width: 110px"
              :placeholder="resultPlaceholder(h)"
              :disabled="h.confirm_flag === 1 || row.status_code"
              @blur="onResultBlur(h, row)"
            />
          </template>
          <template #status="{ row }">
            <t-select
              v-model="row.status_code"
              size="small"
              clearable
              placeholder="正常"
              style="width: 100px"
              :options="STATUS_LIST"
              :disabled="h.confirm_flag === 1"
              @change="onStatusChange(row)"
            />
          </template>
          <template #rank="{ row }">
            <span v-if="row.rank_no" class="rank-no">{{ row.rank_no }}</span>
            <span v-else class="dim">—</span>
          </template>
          <template #score="{ row }">
            <span v-if="row.score" class="score-val">{{ row.score }}</span>
            <span v-else class="dim">—</span>
          </template>
          <template #ops="{ row }">
            <t-button
              v-if="isRelay(h)"
              variant="text" theme="primary" size="small"
              @click="openRelay(row)"
            >棒次</t-button>
          </template>
        </t-table>

        <!-- 田赛：出场顺序 + 试跳（投）明细 -->
        <t-table
          v-else
          :data="h.entries"
          :columns="fieldCols"
          row-key="id"
          hover
        >
          <template #sort_no="{ row }">
            <span class="lane-badge">{{ row.sort_no }}</span>
          </template>
          <template #athlete="{ row }">
            <div class="ath-cell">
              <span class="ath-name">{{ row.athlete_name }}</span>
              <span class="ath-sub">{{ row.school_name }}<template v-if="row.bib_no"> · {{ row.bib_no }} 号</template></span>
            </div>
          </template>
          <template #best="{ row }">
            <span v-if="row.result_text" class="best-val">{{ row.result_text }}</span>
            <span v-else class="dim">—</span>
          </template>
          <template #rank="{ row }">
            <span v-if="row.rank_no" class="rank-no">{{ row.rank_no }}</span>
            <span v-else class="dim">—</span>
          </template>
          <template #ops="{ row }">
            <t-button
              variant="text" theme="primary" size="small"
              @click="openAttempts(h, row)"
            >试跳记录</t-button>
          </template>
        </t-table>
      </div>
    </t-card>

    <!-- 分组编排 -->
    <t-dialog v-model:visible="arrangeDialog" header="分组编排" :width="isMobile ? '94%' : '560px'" attach="body">
      <t-form :data="arrangeForm" label-width="110px" label-align="right">
        <t-form-item label="项目" required-mark>
          <t-select v-model="arrangeForm.event_item_id" style="width: 100%" :options="eventOptions" />
        </t-form-item>
        <t-form-item label="组别" required-mark>
          <t-select v-model="arrangeForm.band_id" style="width: 100%" :options="bandOptions" />
        </t-form-item>
        <t-form-item label="赛次">
          <t-select v-model="arrangeForm.round_code" style="width: 160px" :options="ROUND_LIST" />
        </t-form-item>
        <t-divider align="left">编排参数</t-divider>
        <t-form-item label="道次（容量）">
          <t-input-number v-model="arrangeForm.lane_count" :min="1" :max="12" :step="1" />
          <span class="unit">每组最多几人</span>
        </t-form-item>
        <t-form-item label="分组方式">
          <t-select v-model="arrangeForm.round_mode" style="width: 180px" :options="ROUND_MODE_LIST" />
        </t-form-item>
        <t-form-item v-if="arrangeForm.round_mode === 'FIXED'" label="固定组数">
          <t-input-number v-model="arrangeForm.fixed_heat_count" :min="1" :max="32" :step="1" />
        </t-form-item>
        <t-form-item label="道次分配">
          <t-select v-model="arrangeForm.lane_order_mode" style="width: 200px" :options="LANE_MODE_LIST" />
        </t-form-item>
        <t-form-item label="排序依据">
          <t-select v-model="arrangeForm.seed_mode" style="width: 180px" :options="SEED_LIST" />
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button variant="outline" @click="arrangeDialog = false">取消</t-button>
        <t-button theme="primary" :loading="arranging" @click="runArrange">开始编排</t-button>
      </template>
    </t-dialog>

    <!-- 晋级录取 -->
    <t-dialog v-model:visible="advanceDialog" header="晋级录取" :width="isMobile ? '94%' : '560px'" attach="body">
      <t-form :data="advanceForm" label-width="110px" label-align="right">
        <t-form-item label="项目" required-mark>
          <t-select v-model="advanceForm.event_item_id" style="width: 100%" :options="eventOptions" />
        </t-form-item>
        <t-form-item label="组别" required-mark>
          <t-select v-model="advanceForm.band_id" style="width: 100%" :options="bandOptions" />
        </t-form-item>
        <t-form-item label="从哪个赛次">
          <t-select v-model="advanceForm.from_round" style="width: 160px" :options="ROUND_LIST" />
        </t-form-item>
        <t-form-item label="录到哪个赛次">
          <t-select v-model="advanceForm.to_round" style="width: 160px" :options="ROUND_LIST" />
        </t-form-item>
        <t-divider align="left">录取规则</t-divider>
        <t-form-item label="录取方式">
          <t-select v-model="advanceForm.advancement_mode" style="width: 200px" :options="ADV_MODE_LIST" />
        </t-form-item>
        <t-form-item v-if="advanceForm.advancement_mode !== 'BY_RESULT'" label="每组取几名">
          <t-input-number v-model="advanceForm.qualify_by_place" :min="0" :max="16" :step="1" />
          <span class="unit">名</span>
        </t-form-item>
        <t-form-item v-if="advanceForm.advancement_mode !== 'BY_PLACE'" label="成绩递补">
          <t-input-number v-model="advanceForm.qualify_by_result" :min="0" :max="32" :step="1" />
          <span class="unit">人</span>
        </t-form-item>
        <t-form-item label="晋级总数上限">
          <t-input-number v-model="advanceForm.advance_total_count" :min="0" :max="64" :step="1" />
          <span class="unit">人（0 不限）</span>
        </t-form-item>
        <t-form-item label="决赛分几组">
          <t-input-number v-model="advanceForm.next_heat_count" :min="0" :max="16" :step="1" />
          <span class="unit">组（0 按人数自动）</span>
        </t-form-item>
        <t-form-item label="道次分配">
          <t-select v-model="advanceForm.lane_order_mode" style="width: 200px" :options="LANE_MODE_LIST" />
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button variant="outline" @click="advanceDialog = false">取消</t-button>
        <t-button theme="primary" :loading="advancing" @click="runAdvance">生成下一轮</t-button>
      </template>
    </t-dialog>

    <!-- 田赛试跳记录 -->
    <t-dialog
      v-model:visible="attemptDialog"
      :header="`试跳（投）记录 · ${attemptAthlete}`"
      :width="isMobile ? '94%' : '640px'" attach="body">
      <div class="attempt-tip">
        成功填成绩（如 5.62），失败填 X，免跳填 - ；系统自动取最好一次作为最终成绩。
      </div>
      <t-table :data="attempts" :columns="attemptCols" row-key="_k">
        <template #attempt_no="{ row }">
          <span class="lane-badge">{{ row.attempt_no }}</span>
        </template>
        <template #phase="{ row }">
          <t-select v-model="row.phase" size="small" style="width: 100px" :options="PHASE_LIST" />
        </template>
        <template #result_text="{ row }">
          <t-input v-model="row.result_text" size="small" style="width: 110px" placeholder="成绩或 X / -" />
        </template>
        <template #symbol="{ row }">
          <t-select v-model="row.symbol" size="small" style="width: 90px" :options="SYMBOL_LIST" />
        </template>
        <template #height="{ row }">
          <t-input v-model="row.height" size="small" style="width: 90px" placeholder="跳高横杆高度" />
        </template>
        <template #flag="{ row }">
          <t-tag v-if="row.is_best === 1" theme="success" size="small" variant="light">最好</t-tag>
          <span v-else class="dim">—</span>
        </template>
      </t-table>
      <div class="attempt-ops">
        <t-button size="small" variant="dashed" @click="addAttempt">+ 加一次</t-button>
        <t-button size="small" variant="dashed" @click="fillBase">按项目生成 {{ baseCount }} 次基础轮</t-button>
      </div>
      <template #footer>
        <t-button variant="outline" @click="attemptDialog = false">取消</t-button>
        <t-button theme="primary" :loading="savingAttempt" @click="saveAttempts">保存</t-button>
      </template>
    </t-dialog>

    <!-- 接力棒次 -->
    <t-dialog
      v-model:visible="relayDialog"
      :header="`接力棒次 · ${relayTitle}`"
      :width="isMobile ? '94%' : '620px'" attach="body">
      <div v-for="leg in relayLegs" :key="leg.leg_no" class="leg-row">
        <span class="leg-no">第 {{ leg.leg_no }} 棒</span>
        <t-select
          v-model="leg.athlete_id"
          filterable
          clearable
          style="width: 300px"
          :options="relayCandidates"
          @change="onLegPick(leg)"
        />
        <t-checkbox v-model="leg.is_temporary" :value="1">临时</t-checkbox>
      </div>
      <template #footer>
        <t-button variant="outline" @click="relayDialog = false">取消</t-button>
        <t-button theme="primary" :loading="savingRelay" @click="saveRelay">保存</t-button>
      </template>
    </t-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue';
import { useUserStore } from '../store/user';
import http from '../api/http';
import { message, confirm as confirmDlg } from '../utils/ui';

const store = useUserStore();

const isMobile = ref(window.innerWidth <= 768);
function onResize() { isMobile.value = window.innerWidth <= 768; }
onMounted(() => window.addEventListener('resize', onResize));
onUnmounted(() => window.removeEventListener('resize', onResize));

const ROUND_LIST = [
  { value: 'PRELIM', label: '预赛' },
  { value: 'SEMI', label: '复赛' },
  { value: 'FINAL', label: '决赛' }
];
const STATUS_LIST = [
  { value: 'DNS', label: 'DNS 未出发' },
  { value: 'DNF', label: 'DNF 未完成' },
  { value: 'DQ', label: 'DQ 取消资格' },
  { value: 'NM', label: 'NM 无成绩' },
  { value: 'WD', label: 'WD 弃权' }
];
const ROUND_MODE_LIST = [
  { value: 'AUTO', label: '按人数自动' },
  { value: 'FIXED', label: '固定组数' }
];
const LANE_MODE_LIST = [
  { value: 'SNAKE', label: '蛇形（依次占道）' },
  { value: 'DRAW', label: '抽签随机' },
  { value: 'BY_RANK', label: '按成绩优者居中' },
  { value: 'SAME_SCHOOL_SPREAD', label: '同校分开' }
];
const SEED_LIST = [
  { value: 'NONE', label: '不排序' },
  { value: 'BY_BIB', label: '按号码' },
  { value: 'BY_RESULT', label: '按历史成绩' }
];
const ADV_MODE_LIST = [
  { value: 'BY_PLACE', label: '按名次取' },
  { value: 'BY_RESULT', label: '按成绩取' },
  { value: 'MIXED', label: '名次 + 成绩递补' }
];
const PHASE_LIST = [
  { value: 'BASE', label: '基础轮' },
  { value: 'EXTRA', label: '附加轮' },
  { value: 'JUMPOFF', label: '跳跃赛' }
];
const SYMBOL_LIST = [
  { value: 'O', label: 'O 成功' },
  { value: 'X', label: 'X 失败' },
  { value: '-', label: '- 免跳' },
  { value: 'r', label: 'r 弃权' }
];

const loading = ref(false);
const heats = ref([]);
const events = ref([]);
const bands = ref([]);

const filter = reactive({ event_item_id: null, band_id: null, round_code: '' });

const trackCols = [
  { colKey: 'lane_no', title: '道次', width: 62, align: 'center' },
  { colKey: 'athlete', title: '运动员', minWidth: 170 },
  { colKey: 'result', title: '成绩', width: 130 },
  { colKey: 'status', title: '状态', width: 120 },
  { colKey: 'rank', title: '名次', width: 66, align: 'center' },
  { colKey: 'score', title: '积分', width: 70, align: 'center' },
  { colKey: 'ops', title: '操作', width: 80, align: 'center' }
];
const fieldCols = [
  { colKey: 'sort_no', title: '顺序', width: 62, align: 'center' },
  { colKey: 'athlete', title: '运动员', minWidth: 200 },
  { colKey: 'best', title: '最好成绩', width: 120, align: 'center' },
  { colKey: 'rank', title: '名次', width: 70, align: 'center' },
  { colKey: 'ops', title: '操作', width: 100, align: 'center' }
];
const attemptCols = [
  { colKey: 'attempt_no', title: '第几次', width: 74, align: 'center' },
  { colKey: 'phase', title: '轮次', width: 110 },
  { colKey: 'height', title: '高度', width: 100 },
  { colKey: 'result_text', title: '成绩 / 符号', width: 130 },
  { colKey: 'symbol', title: '判定', width: 110 },
  { colKey: 'flag', title: '最好', width: 74, align: 'center' }
];

const eventOptions = computed(() =>
  events.value
    .filter((e) => e.category === 1 || e.category === 2)
    .map((e) => ({ value: e.id, label: e.name }))
);
const bandOptions = computed(() =>
  bands.value.map((b) => ({
    value: b.id,
    label: `${b.gender === 1 ? '男' : '女'}${b.stage === 1 ? '小' : b.stage === 2 ? '初' : '高'}${b.label || ''}`
  }))
);

function bandText(h) {
  const b = bands.value.find((x) => x.id === h.band_id);
  if (!b) return '';
  return `${b.gender === 1 ? '男子' : '女子'}${b.stage === 1 ? '小学' : b.stage === 2 ? '初中' : '高中'}${b.label || ''}`;
}

function isRelay(h) {
  const e = events.value.find((x) => x.id === h.event_item_id);
  return e && (e.is_relay === 1 || e.event_type === 'RELAY');
}

function resultPlaceholder(h) {
  if (h.result_entry_type === 'TIME') return '11.23 / 1:23';
  if (h.result_entry_type === 'HEIGHT') return '1.75';
  return '5.62';
}

async function loadMeta() {
  if (!store.competitionId) return;
  try {
    events.value = await http.get('/event/items', { params: { competition_id: store.competitionId } });
    bands.value = await http.get('/event/bands', { params: { competition_id: store.competitionId } });
  } catch (e) {
    message.error(e.message);
  }
}

async function loadHeats() {
  if (!store.competitionId) return;
  loading.value = true;
  try {
    const params = { competition_id: store.competitionId };
    if (filter.event_item_id) params.event_item_id = filter.event_item_id;
    if (filter.band_id) params.band_id = filter.band_id;
    if (filter.round_code) params.round_code = filter.round_code;
    heats.value = await http.get('/track-result/workbench', { params });
  } catch (e) {
    message.error(e.message);
  } finally {
    loading.value = false;
  }
}

function onStatusChange(row) {
  if (row.status_code) row.result_text = row.status_code;
}

function onResultBlur(h, row) {
  if (!row.result_text) return;
  const t = String(row.result_text).trim().toUpperCase();
  if (['DNS', 'DNF', 'DQ', 'NM', 'WD'].includes(t)) {
    row.status_code = t;
  } else {
    row.status_code = null;
  }
}

async function saveHeat(h) {
  try {
    await http.post('/track-result/save', {
      heat_id: h.id,
      entries: h.entries.map((e) => ({
        id: e.id,
        result_text: e.result_text,
        status_code: e.status_code,
        manual_rank_flag: e.manual_rank_flag,
        rank_no: e.rank_no,
        remark: e.remark
      }))
    });
    message.success(`${h.heat_name} 成绩已保存`);
    loadHeats();
  } catch (e) {
    message.error(e.message);
  }
}

async function confirmHeat(h) {
  try {
    await http.post('/track-result/confirm', { heat_id: h.id });
    message.success('已确认');
    loadHeats();
  } catch (e) {
    message.error(e.message);
  }
}

async function revokeHeat(h) {
  try {
    await http.post('/track-result/revoke', { heat_id: h.id });
    message.success('已撤销确认');
    loadHeats();
  } catch (e) {
    message.error(e.message);
  }
}

async function clearHeat(h) {
  let go = false;
  await confirmDlg(`确定清空「${h.heat_name}」的全部成绩？`, '清空确认', { confirmBtn: '确定清空' })
    .then(() => { go = true; }).catch(() => {});
  if (!go) return;
  try {
    await http.delete(`/track-result/clear/${h.id}`);
    message.success('已清空');
    loadHeats();
  } catch (e) {
    message.error(e.message);
  }
}

function exportHeat(h) {
  const head = ['名次', '道次/顺序', '号码', '姓名', '单位', '成绩', '状态', '积分'];
  const rows = h.entries.map((e) => [
    e.rank_no ?? '', e.lane_no ?? e.sort_no ?? '', e.bib_no ?? '',
    e.athlete_name ?? '', e.school_name ?? '', e.result_text ?? '', e.status_code ?? '', e.score ?? ''
  ]);
  const csv = '\ufeff' + [head, ...rows].map((r) => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${h.event_name}_${h.heat_name}.csv`;
  a.click();
}

/* ---------- 分组编排 ---------- */
const arrangeDialog = ref(false);
const arranging = ref(false);
const arrangeForm = reactive({
  event_item_id: null, band_id: null, round_code: 'PRELIM',
  round_mode: 'AUTO', lane_count: 8, heat_capacity: null,
  fixed_heat_count: null, lane_order_mode: 'SNAKE', seed_mode: 'NONE'
});

function openArrange() {
  arrangeForm.event_item_id = filter.event_item_id;
  arrangeForm.band_id = filter.band_id;
  arrangeDialog.value = true;
}

async function runArrange() {
  if (!arrangeForm.event_item_id || !arrangeForm.band_id) {
    message.warning('请选择项目与组别');
    return;
  }
  arranging.value = true;
  try {
    await http.put('/track-result/arrange-rule', {
      competition_id: store.competitionId,
      event_item_id: arrangeForm.event_item_id,
      band_id: arrangeForm.band_id,
      round_code: arrangeForm.round_code,
      round_mode: arrangeForm.round_mode,
      lane_count: arrangeForm.lane_count,
      heat_capacity: arrangeForm.heat_capacity,
      fixed_heat_count: arrangeForm.fixed_heat_count,
      lane_order_mode: arrangeForm.lane_order_mode,
      seed_mode: arrangeForm.seed_mode
    });
    const r = await http.post('/track-result/arrange', {
      competition_id: store.competitionId,
      event_item_id: arrangeForm.event_item_id,
      band_id: arrangeForm.band_id,
      round_code: arrangeForm.round_code
    });
    message.success(r?.message || '编排完成');
    arrangeDialog.value = false;
    filter.event_item_id = arrangeForm.event_item_id;
    filter.band_id = arrangeForm.band_id;
    loadHeats();
  } catch (e) {
    message.error(e.message);
  } finally {
    arranging.value = false;
  }
}

/* ---------- 晋级录取 ---------- */
const advanceDialog = ref(false);
const advancing = ref(false);
const advanceForm = reactive({
  event_item_id: null, band_id: null, from_round: 'PRELIM', to_round: 'FINAL',
  advancement_mode: 'MIXED', qualify_by_place: 2, qualify_by_result: 4,
  advance_total_count: 8, next_heat_count: 0, lane_order_mode: 'BY_RANK'
});

function openAdvance() {
  advanceForm.event_item_id = filter.event_item_id;
  advanceForm.band_id = filter.band_id;
  advanceDialog.value = true;
}

async function runAdvance() {
  if (!advanceForm.event_item_id || !advanceForm.band_id) {
    message.warning('请选择项目与组别');
    return;
  }
  advancing.value = true;
  try {
    await http.put('/track-result/advancement-rule', {
      event_item_id: advanceForm.event_item_id,
      band_id: advanceForm.band_id,
      round_code: advanceForm.from_round,
      advancement_mode: advanceForm.advancement_mode,
      qualify_by_place: advanceForm.qualify_by_place,
      qualify_by_result: advanceForm.qualify_by_result,
      advance_total_count: advanceForm.advance_total_count,
      next_round_code: advanceForm.to_round,
      next_heat_count: advanceForm.next_heat_count || null,
      lane_order_mode: advanceForm.lane_order_mode
    });
    const r = await http.post('/track-result/advancement/generate', {
      competition_id: store.competitionId,
      event_item_id: advanceForm.event_item_id,
      band_id: advanceForm.band_id,
      from_round: advanceForm.from_round,
      to_round: advanceForm.to_round,
      to_heat_count: advanceForm.next_heat_count || null
    });
    message.success(r?.message || '已生成');
    advanceDialog.value = false;
    filter.round_code = advanceForm.to_round;
    loadHeats();
  } catch (e) {
    message.error(e.message);
  } finally {
    advancing.value = false;
  }
}

/* ---------- 田赛试跳 ---------- */
const attemptDialog = ref(false);
const savingAttempt = ref(false);
const attempts = ref([]);
const attemptEntryId = ref(null);
const attemptAthlete = ref('');
const baseCount = ref(3);

function openAttempts(h, row) {
  attemptEntryId.value = row.id;
  attemptAthlete.value = row.athlete_name || '';
  baseCount.value = Number(h.base_attempt_count) || 3;
  const existing = row.attempts || [];
  if (existing.length) {
    attempts.value = existing.map((a, i) => ({ ...a, _k: i + 1 }));
  } else {
    attempts.value = Array.from({ length: baseCount.value }, (_, i) => ({
      _k: i + 1, attempt_no: i + 1, phase: 'BASE', result_text: '', symbol: 'O', height: ''
    }));
  }
  attemptDialog.value = true;
}

function addAttempt() {
  const n = attempts.value.length + 1;
  attempts.value.push({
    _k: Date.now(), attempt_no: n, phase: 'BASE', result_text: '', symbol: 'O', height: ''
  });
}

function fillBase() {
  attempts.value = Array.from({ length: baseCount.value }, (_, i) => ({
    _k: i + 1, attempt_no: i + 1, phase: 'BASE', result_text: '', symbol: 'O', height: ''
  }));
}

async function saveAttempts() {
  savingAttempt.value = true;
  try {
    await http.put(`/track-result/attempts/${attemptEntryId.value}`, {
      attempts: attempts.value.map((a) => ({
        attempt_no: a.attempt_no,
        phase: a.phase,
        result_text: a.result_text,
        symbol: a.symbol,
        height: a.height || null
      }))
    });
    message.success('试跳记录已保存');
    attemptDialog.value = false;
    loadHeats();
  } catch (e) {
    message.error(e.message);
  } finally {
    savingAttempt.value = false;
  }
}

/* ---------- 接力棒次 ---------- */
const relayDialog = ref(false);
const savingRelay = ref(false);
const relayEntryId = ref(null);
const relayTitle = ref('');
const relayLegs = ref([]);
const relayCandidates = ref([]);

async function openRelay(row) {
  relayEntryId.value = row.id;
  relayTitle.value = row.athlete_name || row.team_name || '';
  try {
    const cands = await http.get('/track-result/relay/candidates', {
      params: {
        competition_id: store.competitionId,
        band_id: row.band_id,
        event_item_id: row.event_item_id
      }
    });
    relayCandidates.value = (cands || []).map((c) => ({
      value: c.athlete_id,
      label: `${c.athlete_name}（${c.school_name || ''}）`
    }));
    const saved = await http.get(`/track-result/relay/${row.id}`);
    relayLegs.value = Array.from({ length: 4 }, (_, i) => {
      const hit = (saved || []).find((s) => s.leg_no === i + 1);
      return {
        leg_no: i + 1,
        athlete_id: hit ? hit.athlete_id : null,
        is_temporary: hit ? (hit.is_temporary ? 1 : 0) : 0
      };
    });
    relayDialog.value = true;
  } catch (e) {
    message.error(e.message);
  }
}

function onLegPick(leg) {
  void leg;
}

async function saveRelay() {
  savingRelay.value = true;
  try {
    await http.put(`/track-result/relay/${relayEntryId.value}`, {
      legs: relayLegs.value.map((l) => ({
        leg_no: l.leg_no,
        athlete_id: l.athlete_id,
        is_temporary: l.is_temporary
      }))
    });
    message.success('棒次已保存');
    relayDialog.value = false;
  } catch (e) {
    message.error(e.message);
  } finally {
    savingRelay.value = false;
  }
}

onMounted(async () => {
  await loadMeta();
  await loadHeats();
});
watch(() => store.competitionId, async () => {
  await loadMeta();
  await loadHeats();
});
</script>

<style scoped>
.tr-card { border-radius: 8px; }

.filter-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.hint { font-size: 12px; color: var(--app-text-3); }

.empty-tip {
  padding: 40px;
  text-align: center;
  color: var(--app-text-3);
  font-size: 13px;
}

.heat-block {
  margin-bottom: 16px;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  overflow: hidden;
}
.hb-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--app-bg);
  border-bottom: 1px solid var(--app-border);
  flex-wrap: wrap;
}
.hb-event { font-weight: 600; color: var(--app-text-1); }
.hb-band { font-size: 13px; color: var(--app-text-2); }
.hb-title { font-size: 13px; color: var(--td-brand-color); font-weight: 500; }
.hb-count { font-size: 12px; color: var(--app-text-3); }
.hb-ops { margin-left: auto; display: flex; gap: 2px; flex-wrap: wrap; }

.lane-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--app-bg);
  color: var(--td-brand-color);
  font-weight: 600;
  font-size: 12px;
}

.ath-cell { display: flex; flex-direction: column; line-height: 1.35; }
.ath-name { font-weight: 500; color: var(--app-text-1); }
.ath-sub { font-size: 12px; color: var(--app-text-3); }

.rank-no { font-weight: 700; color: var(--td-brand-color); }
.best-val { font-weight: 600; color: var(--app-text-1); }
.score-val { font-weight: 600; color: #00a870; }
.dim { color: var(--app-text-3); }
.unit { font-size: 12px; color: var(--app-text-3); margin-left: 6px; }

.attempt-tip {
  margin-bottom: 10px;
  padding: 8px 10px;
  background: var(--app-bg);
  border-radius: 4px;
  font-size: 12px;
  color: var(--app-text-2);
}
.attempt-ops { margin-top: 10px; display: flex; gap: 8px; }

.leg-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.leg-no { width: 62px; font-size: 13px; color: var(--app-text-2); }

@media (max-width: 768px) {
  .hint { display: none; }
  .hb-ops { margin-left: 0; width: 100%; }
}
</style>
