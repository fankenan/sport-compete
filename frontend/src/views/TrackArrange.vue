<template>
  <div class="ta-page">
    <!-- 工具条 -->
    <t-card class="ta-toolbar">
      <div class="tb-row">
        <t-select
          v-model="form.event_item_id"
          placeholder="选择项目"
          style="width: 190px"
          @change="onTargetChange"
        >
          <t-option v-for="e in trackEvents" :key="e.id" :label="e.name" :value="e.id" />
        </t-select>

        <t-select
          v-model="form.band_id"
          placeholder="选择组别"
          style="width: 170px"
          @change="load"
        >
          <t-option v-for="b in bands" :key="b.id" :label="bandLabel(b)" :value="b.id" />
        </t-select>

        <t-select v-model="form.round_code" style="width: 130px" :options="ROUND_LIST" @change="load" />

        <span class="tb-divider"></span>

        <t-button theme="primary" :loading="arranging" @click="openArrange">
          <template #icon><t-icon name="edit" /></template>
          编排分组
        </t-button>

        <t-button variant="outline" :loading="loading" @click="load">
          <template #icon><t-icon name="refresh" /></template>
          刷新
        </t-button>

        <t-button variant="outline" @click="goScoreEntry">
          <template #icon><t-icon name="check-circle" /></template>
          去录成绩
        </t-button>
      </div>

      <p class="ta-hint">
        这里负责「谁和谁一组、站第几道」。编排完成后到「成绩录入」录成绩、到「赛后统计」出团体总分。
        <template v-if="summary.heats"> 当前共 {{ summary.heats }} 组、{{ summary.entries }} 人次已编排。</template>
      </p>
    </t-card>

    <!-- 已编排的赛次 -->
    <t-card class="ta-card">
      <template #header>
        <div class="panel-head">
          <span class="ph-title">已编排赛次</span>
          <span class="panel-hint">径赛按组看道次，田赛按出场顺序看</span>
        </div>
      </template>

      <div v-if="loading" class="app-empty">加载中…</div>

      <div v-else-if="!heats.length" class="app-empty">
        <t-icon name="view-list" class="app-empty-icon" />
        还没有编排分组。<br />
        选好项目与组别后点「编排分组」。
      </div>

      <div v-else class="ta-heat-list">
        <div v-for="h in heats" :key="h.id" class="ta-heat">
          <div class="th-head">
            <span class="th-name">{{ h.heat_name || `第${h.heat_no}组` }}</span>
            <span class="th-meta">
              {{ h.entry_count }} 人
              <template v-if="h.lane_count"> · {{ h.lane_count }} 道</template>
              <template v-if="h.plan_date"> · {{ h.plan_date }} {{ (h.plan_time || '').slice(0, 5) }}</template>
            </span>
            <span class="th-status" :class="statusClass(h.status)">{{ statusLabel(h.status) }}</span>
          </div>

          <table class="th-table">
            <thead>
              <tr>
                <th style="width:64px">{{ isField ? '顺序' : '道次' }}</th>
                <th>运动员</th>
                <th style="width:150px">学校</th>
                <th style="width:110px">号码</th>
                <th style="width:110px">成绩</th>
                <th style="width:70px">名次</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in h.entries" :key="e.id">
                <td class="num">{{ isField ? e.sort_no : e.lane_no }}</td>
                <td class="th-athlete">{{ e.athlete_name }}</td>
                <td>{{ e.school_name || '—' }}</td>
                <td class="num">{{ e.bib_no || '—' }}</td>
                <td class="num">{{ e.result_text || '—' }}</td>
                <td class="num">{{ e.rank_no || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </t-card>

    <!-- 编排规则 -->
    <t-dialog
      v-model:visible="arrangeDialog"
      header="编排分组"
      :width="isMobile ? '94%' : '560px'"
      attach="body"
    >
      <t-alert theme="warning" style="margin-bottom: 14px">
        重新编排会<strong>清掉本项目本组别本赛次已编好的分组与道次</strong>，已录入的成绩也会一并清除。
        确认无误再继续。
      </t-alert>

      <t-form :data="form" label-width="110px" label-align="right">
        <t-divider align="left">编排参数</t-divider>
        <t-form-item label="道次（容量）">
          <t-input-number v-model="form.lane_count" :min="1" :max="12" :step="1" />
          <span class="unit">每组最多几人</span>
        </t-form-item>
        <t-form-item label="分组方式">
          <t-select v-model="form.round_mode" style="width: 180px" :options="ROUND_MODE_LIST" />
        </t-form-item>
        <t-form-item v-if="form.round_mode === 'FIXED'" label="固定组数">
          <t-input-number v-model="form.fixed_heat_count" :min="1" :max="32" :step="1" />
        </t-form-item>
        <t-form-item label="道次分配">
          <t-select v-model="form.lane_order_mode" style="width: 200px" :options="LANE_MODE_LIST" />
        </t-form-item>
        <t-form-item label="排序依据">
          <t-select v-model="form.seed_mode" style="width: 180px" :options="SEED_LIST" />
        </t-form-item>
      </t-form>

      <template #footer>
        <t-button variant="outline" @click="arrangeDialog = false">取消</t-button>
        <t-button theme="primary" :loading="arranging" @click="runArrange">开始编排</t-button>
      </template>
    </t-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUserStore } from '../store/user';
import http from '../api/http';
import { message, confirm } from '../utils/ui';
import { bandLabel } from '../utils/band';

const store = useUserStore();
const route = useRoute();
const router = useRouter();

const isMobile = ref(window.innerWidth <= 768);
function onResize() { isMobile.value = window.innerWidth <= 768; }
onMounted(() => window.addEventListener('resize', onResize));
onUnmounted(() => window.removeEventListener('resize', onResize));

const ROUND_LIST = [
  { value: 'PRELIM', label: '预赛' },
  { value: 'SEMI', label: '复赛' },
  { value: 'FINAL', label: '决赛' }
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

const loading = ref(false);
const arranging = ref(false);
const heats = ref([]);
const events = ref([]);
const bands = ref([]);
const arrangeDialog = ref(false);

const form = reactive({
  event_item_id: null,
  band_id: null,
  round_code: 'FINAL',
  lane_count: 8,
  round_mode: 'AUTO',
  fixed_heat_count: 0,
  lane_order_mode: 'SNAKE',
  seed_mode: 'NONE'
});

/** 只列田径类项目（径赛 + 田赛） */
const trackEvents = computed(() =>
  events.value.filter((e) => Number(e.category) === 1 || Number(e.category) === 2)
);

const currentEvent = computed(() =>
  trackEvents.value.find((e) => Number(e.id) === Number(form.event_item_id)) || null
);

/** 当前项目是田赛（按出场顺序）还是径赛（按道次） */
const isField = computed(() => Number(currentEvent.value?.category) === 2);

const summary = computed(() => {
  let h = 0, e = 0;
  for (const x of heats.value) { h++; e += (x.entries || []).length; }
  return { heats: h, entries: e };
});

function statusLabel(s) {
  return { 1: '待编排', 2: '已编排', 3: '录入中', 4: '已确认' }[s] || '—';
}
function statusClass(s) {
  return { 1: 'todo', 2: 'doing', 3: 'doing', 4: 'done' }[s] || 'todo';
}

function onTargetChange() {
  // 换项目时重置道次数为该项目的默认道次
  const ev = currentEvent.value;
  if (ev?.lane_count) form.lane_count = Number(ev.lane_count);
  load();
}

function openArrange() {
  if (!form.event_item_id || !form.band_id) {
    message.warning('请先选择项目与组别');
    return;
  }
  arrangeDialog.value = true;
}

async function runArrange() {
  arranging.value = true;
  try {
    // 先保存编排规则
    await http.put('/track-result/group-arrange-rule', {
      event_item_id: form.event_item_id,
      band_id: form.band_id,
      round_code: form.round_code,
      round_mode: form.round_mode,
      lane_count: form.lane_count,
      heat_capacity: form.lane_count,
      fixed_heat_count: form.fixed_heat_count,
      lane_order_mode: form.lane_order_mode,
      seed_mode: form.seed_mode
    });

    // 再执行编排（会清掉本轮旧编排）
    const r = await http.post('/track-result/group-arrange', {
      competition_id: store.competitionId,
      event_item_id: form.event_item_id,
      band_id: form.band_id,
      round_code: form.round_code
    });
    message.success(r?.message || '分组已编排');
    arrangeDialog.value = false;
    await load();
  } catch (e) {
    message.error(e.message);
  } finally {
    arranging.value = false;
  }
}

async function load() {
  if (!store.competitionId || !form.event_item_id) {
    heats.value = [];
    return;
  }
  loading.value = true;
  try {
    const params = {
      competition_id: store.competitionId,
      event_item_id: form.event_item_id,
      band_id: form.band_id || undefined,
      round_code: form.round_code || undefined
    };
    const d = await http.get('/track-result/workbench', { params });
    // 真实接口返回的是数组（每个元素自带 entries / attempts）
    heats.value = Array.isArray(d) ? d : (d?.heats || d?.groups || []);
  } catch (e) {
    heats.value = [];
  } finally {
    loading.value = false;
  }
}

function goScoreEntry() {
  router.push({
    path: '/track-result',
    query: {
      event_item_id: form.event_item_id || undefined,
      band_id: form.band_id || undefined
    }
  });
}

async function loadBase() {
  try {
    const cid = store.competitionId;
    const [b, e] = await Promise.all([
      http.get('/event/bands', { params: { competition_id: cid } }),
      http.get('/event/items', { params: { competition_id: cid } })
    ]);
    bands.value = Array.isArray(b) ? b : [];
    events.value = Array.isArray(e) ? e : [];

    if (!form.event_item_id && trackEvents.value.length) {
      form.event_item_id = trackEvents.value[0].id;
      if (trackEvents.value[0].lane_count) form.lane_count = Number(trackEvents.value[0].lane_count);
    }
    if (!form.band_id && bands.value.length) {
      form.band_id = bands.value[0].id;
    }
  } catch (e) { /* 忽略 */ }
}

onMounted(async () => {
  await loadBase();
  // 支持从「分组编排」页带参数跳过来
  const q = route.query;
  if (q.event_item_id) form.event_item_id = Number(q.event_item_id);
  if (q.band_id) form.band_id = Number(q.band_id);
  await load();
});

watch(() => store.competitionId, async () => {
  await loadBase();
  await load();
});
</script>

<style scoped>
.ta-page {
  max-width: 1440px;
  margin: 0 auto;
  padding: var(--sp-6);
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.ta-toolbar { border-radius: var(--radius-l); }
.tb-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tb-divider { width: 1px; height: 18px; background: var(--app-border); margin: 0 2px; }
.ta-hint { margin: 10px 0 0; font-size: 12px; line-height: 1.6; color: var(--app-text-3); }

.ta-card { border-radius: var(--radius-l); }
.panel-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; width: 100%;
}
.ph-title { font-size: 15px; font-weight: 600; color: var(--app-text-1); }
.panel-hint { font-size: 12px; color: var(--app-text-3); }

.ta-heat-list { display: flex; flex-direction: column; gap: var(--sp-3); }

.ta-heat {
  border: 1px solid var(--app-border);
  border-radius: var(--radius-m);
  overflow: hidden;
}
.th-head {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 14px;
  background: var(--app-surface-2);
  border-bottom: 1px solid var(--app-border);
}
.th-name { font-size: 13.5px; font-weight: 600; color: var(--app-text-1); }
.th-meta { font-size: 12px; color: var(--app-text-3); }
.th-status {
  margin-left: auto;
  font-size: 11px; padding: 2px 8px; border-radius: var(--radius-xs); font-weight: 500;
}
.th-status.todo { background: var(--app-bg-2); color: var(--app-text-3); }
.th-status.doing { background: var(--app-warning-light); color: var(--app-warning); }
.th-status.done { background: var(--app-success-light); color: var(--app-success); }

.th-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.th-table th {
  text-align: left; padding: 7px 14px; font-weight: 500; font-size: 11.5px;
  color: var(--app-text-2); background: var(--app-surface-2);
  border-bottom: 1px solid var(--app-border);
}
.th-table td {
  padding: 7px 14px; border-bottom: 1px solid var(--app-border-2); color: var(--app-text-1);
}
.th-table tbody tr:last-child td { border-bottom: none; }
.th-table tbody tr:hover { background: var(--app-bg-2); }
.th-table .num { font-variant-numeric: tabular-nums; color: var(--app-text-2); }
.th-athlete { font-weight: 500; }
</style>
