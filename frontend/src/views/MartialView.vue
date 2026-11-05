<template>
  <div class="ma-page">
    <!-- 工具条 -->
    <t-card class="ma-toolbar">
      <div class="tb-row">
        <t-select
          v-model="filter.event_item_id"
          placeholder="选择武术项目"
          style="width: 200px"
          @change="onEventChange"
        >
          <t-option v-for="e in martialEvents" :key="e.id" :label="e.name" :value="e.id" />
        </t-select>

        <t-select
          v-model="filter.band_id"
          placeholder="选择组别"
          style="width: 170px"
          @change="load"
        >
          <t-option v-for="b in bands" :key="b.id" :label="bandLabel(b)" :value="b.id" />
        </t-select>

        <t-select v-model="filter.round_code" style="width: 130px" :options="ROUND_LIST" @change="load" />

        <span class="tb-divider"></span>

        <t-button theme="primary" @click="openArrange">
          <template #icon><t-icon name="edit" /></template>
          编排出场顺序
        </t-button>

        <t-button variant="outline" :loading="loading" @click="load">
          <template #icon><t-icon name="refresh" /></template>
          刷新
        </t-button>
      </div>

      <p class="ma-hint">
        武术为<strong>评分制</strong>：每位裁判独立打分，去掉一个最高分和一个最低分后取平均，按总分排名。
        报名在「报名管理」审核通过后，这里才能编排。
      </p>
    </t-card>

    <t-loading :loading="loading" size="small">
      <div v-if="!heats.length" class="app-empty">
        <t-icon name="usergroup" class="app-empty-icon" />
        还没有编排武术赛次。<br />
        请先到「报名管理」审核武术项目报名，再点「编排出场顺序」。
      </div>

      <div v-else class="ma-list">
        <t-card v-for="h in heats" :key="h.id" class="ma-card">
          <template #header>
            <div class="panel-head">
              <div class="ph-left">
                <span class="ph-title">{{ h.heat_name }}</span>
                <span class="ph-band">{{ h.band_label }}</span>
                <span class="ph-count">{{ h.entry_count }} 支队伍 · {{ h.judge_count }} 位裁判</span>
              </div>
              <div class="ph-right">
                <span v-if="h.confirm_flag === 1" class="pill-success">已确认</span>
                <span v-else class="pill-warning">评分中</span>
                <t-button
                  v-if="h.confirm_flag !== 1"
                  size="small"
                  theme="primary"
                  variant="outline"
                  :disabled="!allScored(h)"
                  @click="confirmHeat(h)"
                >确认成绩</t-button>
                <t-button
                  v-else
                  size="small"
                  variant="text"
                  @click="revokeHeat(h)"
                >撤销确认</t-button>
              </div>
            </div>
          </template>

          <!-- 参赛队与打分 -->
          <table class="ma-table">
            <thead>
              <tr>
                <th style="width:64px">顺序</th>
                <th style="width:64px">名次</th>
                <th>代表队</th>
                <th style="width:130px">领队</th>
                <th style="width:300px">各裁判打分</th>
                <th style="width:150px">最终得分</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in h.entries" :key="e.id">
                <td class="num">{{ e.order_no }}</td>
                <td>
                  <span v-if="e.rank_no" class="ma-rank" :class="'r' + e.rank_no">{{ e.rank_no }}</span>
                  <span v-else class="dim">—</span>
                </td>
                <td class="ma-team">{{ e.team_name }}</td>
                <td>{{ e.leader_name || '—' }}</td>
                <td>
                  <div class="ma-scores">
                    <div v-for="(s, i) in scoreList(e)" :key="i" class="ma-score-item">
                      <t-input-number
                        :model-value="s.score"
                        :min="0"
                        :max="10"
                        :step="0.1"
                        :decimal-digits="2"
                        :controls="false"
                        size="small"
                        style="width:74px"
                        :disabled="h.confirm_flag === 1"
                        @change="(v) => onScoreChange(e, i, v)"
                      />
                      <t-input
                        :model-value="s.judge"
                        size="small"
                        style="width:110px"
                        placeholder="裁判姓名"
                        :disabled="h.confirm_flag === 1"
                        @change="(v) => onJudgeNameChange(e, i, v)"
                      />
                    </div>
                    <div v-if="scoreList(e).length < h.judge_count" class="ma-add">
                      <t-button size="small" variant="text" @click="addScore(e)">+ 加一位裁判</t-button>
                    </div>
                  </div>
                </td>
                <td>
                  <div v-if="e.total_score !== null" class="ma-total">
                    <b>{{ e.total_score }}</b>
                    <span v-if="e.score_detail" class="ma-detail">{{ e.score_detail }}</span>
                  </div>
                  <span v-else class="dim">{{ e.reason || '待评分' }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </t-card>
      </div>
    </t-loading>

    <!-- 编排弹窗 -->
    <t-dialog
      v-model:visible="arrangeVisible"
      header="编排出场顺序"
      :width="isMobile ? '94%' : '480px'"
      attach="body"
      :confirm-btn="{ content: '开始编排', loading: arranging }"
      @confirm="runArrange"
    >
      <t-alert theme="warning" style="margin-bottom: 14px">
        重新编排会清掉本项目本组别本赛次已编好的出场顺序与成绩。
      </t-alert>
      <t-form :data="arrangeForm" label-width="100px" label-align="right">
        <t-form-item label="每组队伍">
          <t-input-number v-model="arrangeForm.heat_size" :min="0" :max="60" :step="1" />
          <span class="unit">0 = 全部一组</span>
        </t-form-item>
        <t-form-item label="裁判人数">
          <t-input-number v-model="arrangeForm.judge_count" :min="3" :max="11" :step="2" />
          <span class="unit">用于去极值计算</span>
        </t-form-item>
      </t-form>
    </t-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useUserStore } from '../store/user';
import http from '../api/http';
import { message, confirm } from '../utils/ui';
import { bandLabel } from '../utils/band';

const store = useUserStore();

const isMobile = ref(window.innerWidth <= 768);
function onResize() { isMobile.value = window.innerWidth <= 768; }
onMounted(() => window.addEventListener('resize', onResize));

const ROUND_LIST = [
  { value: 'PRELIM', label: '预赛' },
  { value: 'SEMI', label: '复赛' },
  { value: 'FINAL', label: '决赛' }
];

const loading = ref(false);
const arranging = ref(false);
const heats = ref([]);
const bands = ref([]);
const events = ref([]);
const arrangeVisible = ref(false);

const filter = reactive({ event_item_id: null, band_id: null, round_code: 'FINAL' });
const arrangeForm = reactive({ heat_size: 0, judge_count: 5 });

/** 武术项目（category = 4） */
const martialEvents = computed(() =>
  events.value.filter((e) => Number(e.category) === 4)
);

/** 该组所有队都评分了才能确认 */
function allScored(h) {
  return h.entries.length > 0 && h.entries.every((e) => e.total_score !== null);
}

/** 取该队的打分列表（保证数组） */
function scoreList(e) {
  return Array.isArray(e.scores) ? e.scores : [];
}

function onEventChange() {
  const ev = martialEvents.value.find((e) => Number(e.id) === Number(filter.event_item_id));
  if (ev?.martial_judge_count) arrangeForm.judge_count = Number(ev.martial_judge_count);
  load();
}

function openArrange() {
  if (!filter.event_item_id || !filter.band_id) {
    message.warning('请先选择项目与组别');
    return;
  }
  arrangeVisible.value = true;
}

async function runArrange() {
  arranging.value = true;
  try {
    const r = await http.post('/martial/arrange', {
      competition_id: store.competitionId,
      event_item_id: filter.event_item_id,
      band_id: filter.band_id,
      round_code: filter.round_code,
      heat_size: arrangeForm.heat_size,
      judge_count: arrangeForm.judge_count
    });
    message.success(r?.message || '编排完成');
    arrangeVisible.value = false;
    await load();
  } catch (e) {
    message.error(e.message);
  } finally {
    arranging.value = false;
  }
}

async function onScoreChange(entry, idx, value) {
  const scores = scoreList(entry).map((s, i) => (i === idx ? { ...s, score: value } : s));
  await saveScores(entry, scores);
}

async function onJudgeNameChange(entry, idx, value) {
  const scores = scoreList(entry).map((s, i) => (i === idx ? { ...s, judge: value } : s));
  await saveScores(entry, scores);
}

function addScore(entry) {
  const scores = [...scoreList(entry), { judge: '', score: 0 }];
  entry.scores = scores;
}

async function saveScores(entry, scores) {
  try {
    const r = await http.put(`/martial/entry/${entry.id}/scores`, { scores });
    entry.scores = scores;
    if (r?.total_score !== undefined) {
      entry.total_score = r.total_score;
      entry.score_detail = r.score_detail;
      entry.rank_no = r.rank_no;
    }
  } catch (e) {
    message.error(e.message);
  }
}

async function confirmHeat(h) {
  try {
    await confirm(`确认「${h.heat_name}」的成绩？确认后将进入秩序册与公开成绩页。`, '确认成绩');
  } catch (e) { return; }
  try {
    await http.post(`/martial/heat/${h.id}/confirm`);
    message.success('成绩已确认');
    await load();
  } catch (e) {
    message.error(e.message);
  }
}

async function revokeHeat(h) {
  try {
    await http.post(`/martial/heat/${h.id}/revoke`);
    message.success('已撤销确认');
    await load();
  } catch (e) {
    message.error(e.message);
  }
}

async function load() {
  if (!store.competitionId || !filter.event_item_id) {
    heats.value = [];
    return;
  }
  loading.value = true;
  try {
    const d = await http.get('/martial/heats', {
      params: {
        competition_id: store.competitionId,
        event_item_id: filter.event_item_id,
        band_id: filter.band_id || undefined,
        round_code: filter.round_code || undefined
      }
    });
    heats.value = Array.isArray(d) ? d : [];
  } catch (e) {
    heats.value = [];
  } finally {
    loading.value = false;
  }
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
    if (!filter.event_item_id && martialEvents.value.length) {
      filter.event_item_id = martialEvents.value[0].id;
      if (martialEvents.value[0].martial_judge_count) {
        arrangeForm.judge_count = Number(martialEvents.value[0].martial_judge_count);
      }
    }
    if (!filter.band_id && bands.value.length) filter.band_id = bands.value[0].id;
  } catch (e) { /* 忽略 */ }
}

onMounted(async () => {
  await loadBase();
  await load();
});

watch(() => store.competitionId, async () => {
  await loadBase();
  await load();
});
</script>

<style scoped>
.ma-page {
  max-width: 1440px;
  margin: 0 auto;
  padding: var(--sp-6);
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.ma-toolbar { border-radius: var(--radius-l); }
.tb-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tb-divider { width: 1px; height: 18px; background: var(--app-border); margin: 0 2px; }
.ma-hint { margin: 10px 0 0; font-size: 12px; line-height: 1.6; color: var(--app-text-3); }

.ma-list { display: flex; flex-direction: column; gap: var(--sp-4); }
.ma-card { border-radius: var(--radius-l); }

.panel-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; width: 100%; flex-wrap: wrap;
}
.ph-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ph-title { font-size: 15px; font-weight: 600; color: var(--app-text-1); }
.ph-band {
  font-size: 11.5px; padding: 2px 8px; border-radius: var(--radius-xs);
  background: var(--td-brand-color-light); color: var(--td-brand-color);
}
.ph-count { font-size: 12px; color: var(--app-text-3); }
.ph-right { display: flex; align-items: center; gap: 8px; }

.ma-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.ma-table th {
  text-align: left; padding: 8px 12px; font-weight: 500; font-size: 11.5px;
  color: var(--app-text-2); background: var(--app-surface-2);
  border-bottom: 1px solid var(--app-border);
}
.ma-table td {
  padding: 9px 12px; border-bottom: 1px solid var(--app-border-2);
  color: var(--app-text-1); vertical-align: top;
}
.ma-table tbody tr:last-child td { border-bottom: none; }
.ma-table tbody tr:hover { background: var(--app-bg-2); }
.ma-table .num { font-variant-numeric: tabular-nums; }
.ma-team { font-weight: 500; }

.ma-rank {
  display: inline-grid; place-items: center;
  width: 22px; height: 22px; border-radius: 50%;
  font-size: 12px; font-weight: 700;
  background: var(--app-bg-2); color: var(--app-text-3);
}
.ma-rank.r1 { background: #fef3e6; color: #b45309; }
.ma-rank.r2 { background: #f1f3f7; color: #475569; }
.ma-rank.r3 { background: #fdf1e7; color: #a16207; }

.ma-scores { display: flex; flex-direction: column; gap: 5px; }
.ma-score-item { display: flex; gap: 5px; }
.ma-add { margin-top: 2px; }

.ma-total { display: flex; flex-direction: column; gap: 2px; }
.ma-total b {
  font-size: 15px; color: var(--td-brand-color);
  font-variant-numeric: tabular-nums;
}
.ma-detail { font-size: 10.5px; color: var(--app-text-3); }
</style>
