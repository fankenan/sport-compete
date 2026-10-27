<template>
  <div>
    <!-- 筛选条 -->
    <t-card class="toolbar">
      <div class="tb-row">
        <t-select
          v-if="!store.isAdmin"
          v-model="compId"
          placeholder="选择赛事"
          style="width: 160px"
          @change="onCompChange"
        >
          <t-option v-for="c in competitions" :key="c.id" :label="c.name" :value="c.id" />
        </t-select>
        <t-select
          v-model="bandId"
          placeholder="全部组别"
          clearable
          style="width: 150px"
          @change="loadStandings"
        >
          <t-option v-for="b in bands" :key="b.id" :label="bandLabel(b)" :value="b.id" />
        </t-select>
        <t-select
          v-model="eventItemId"
          placeholder="全部项目"
          clearable
          style="width: 150px"
          @change="loadStandings"
        >
          <t-option v-for="e in events" :key="e.id" :label="e.name" :value="e.id" />
        </t-select>
        <t-button theme="primary" @click="loadStandings">查询</t-button>
        <t-button variant="outline" @click="resetFilter">重置</t-button>
        <t-checkbox v-if="store.isSchool" v-model="onlyMine" class="mine-check">仅看本校</t-checkbox>

        <span class="tb-divider"></span>
        <t-button variant="outline" :disabled="standings.length === 0" @click="exportCsv">导出 CSV</t-button>
        <t-button variant="outline" @click="printPage">打印</t-button>
      </div>
      <p class="tb-meta">
        排名规则：积分 → 相互战绩（积分/净胜分/得分）→ 总净胜分 → 总得分 → 弃权少者优先；积分相同时下方小字写出判定依据
      </p>
    </t-card>

    <!-- 各小组积分榜 -->
    <t-card class="panel">
      <template #header>
        <div class="panel-head">
          <span>小组积分榜</span>
          <span class="panel-hint">共 {{ standings.length }} 个小组</span>
        </div>
      </template>

      <t-loading :loading="loading">
        <div v-if="standings.length === 0" class="empty">
          暂无积分数据。需先生成小组并录入比赛成绩。
        </div>
        <div v-else class="standing-wrap">
          <div v-for="g in standings" :key="g.group_id || g.group_letter" class="standing-block">
            <p class="sb-title">
              {{ g.band_label || '未分组别' }} {{ g.group_letter }} 组
              <span class="sb-count">{{ filterStanding(g.standing).length }} 队</span>
            </p>
            <div class="table-scroll">
              <t-table
                :data="filterStanding(g.standing)"
                :columns="standingColumns"
                row-key="id"
                bordered
                :empty="'暂无成绩'"
              >
                <template #rank="{ row }">
                  <span :class="rankClass(row.rank)">{{ row.rank }}</span>
                </template>
                <template #team_name="{ row }">
                  <div>
                    <span>{{ row.team_name || '—' }}</span>
                    <span v-if="row.rankReason" class="rank-reason">{{ row.rankReason }}</span>
                  </div>
                </template>
                <template #points="{ row }">
                  <span class="pt">{{ row.points }}</span>
                </template>
                <template #diff="{ row }">
                  <span :class="row.diff > 0 ? 'pos' : row.diff < 0 ? 'neg' : 'dim'">
                    {{ row.diff > 0 ? '+' : '' }}{{ row.diff }}
                  </span>
                </template>
                <template #abandonCount="{ row }">
                  <t-tag v-if="row.abandonCount > 0" theme="warning" variant="light" size="small">
                    {{ row.abandonCount }}
                  </t-tag>
                  <span v-else class="dim">0</span>
                </template>
                <template #isVoided="{ row }">
                  <t-tag v-if="row.isVoided" theme="danger" variant="light" size="small">作废</t-tag>
                  <span v-else class="dim">有效</span>
                </template>
              </t-table>
            </div>
          </div>
        </div>
      </t-loading>
    </t-card>

    <!-- 单组总览 -->
    <t-card v-if="bandId && eventItemId" class="panel">
      <template #header>
        <div class="panel-head">
          <span>单组总览</span>
          <span class="panel-hint">所选组别与项目的全部参赛队</span>
        </div>
      </template>

      <t-loading :loading="loadingOverview">
        <div v-if="overview.length === 0" class="empty">该组别暂无积分数据</div>
        <div v-else class="table-scroll">
          <t-table
            :data="overview"
            :columns="overviewColumns"
            row-key="id"
            bordered
            :empty="'暂无成绩'"
          >
            <template #points="{ row }">
              <span class="pt">{{ row.points }}</span>
            </template>
            <template #diff="{ row }">
              <span :class="row.diff > 0 ? 'pos' : row.diff < 0 ? 'neg' : 'dim'">
                {{ row.diff > 0 ? '+' : '' }}{{ row.diff }}
              </span>
            </template>
            <template #isVoided="{ row }">
              <t-tag v-if="row.isVoided" theme="danger" variant="light" size="small">作废</t-tag>
              <span v-else class="dim">有效</span>
            </template>
          </t-table>
        </div>
      </t-loading>
    </t-card>

    <!-- 对阵矩阵（交叉表） -->
    <t-card v-if="matrices.length" class="panel">
      <template #header>
        <div class="panel-head">
          <span>对阵矩阵</span>
          <span class="panel-hint">行为主队、列为客队，格子内是该场比分</span>
        </div>
      </template>

      <div v-for="mt in matrices" :key="mt.key" class="matrix-block">
        <p class="sb-title">{{ mt.title }}</p>
        <div class="table-scroll">
          <table class="matrix">
            <thead>
              <tr>
                <th class="corner">主 ＼ 客</th>
                <th v-for="t in mt.teams" :key="t">{{ t }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in mt.teams" :key="r">
                <th class="row-head">{{ r }}</th>
                <td v-for="c in mt.teams" :key="c" :class="cellClass(r, c, mt)">
                  {{ cellText(r, c, mt) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </t-card>

    <!-- 小组赛程（按轮次，标出轮空） -->
    <t-card v-if="roundGroups.length" class="panel">
      <template #header>
        <div class="panel-head">
          <span>小组赛程</span>
          <span class="panel-hint">按轮次排列，奇数队时标出本轮轮空</span>
        </div>
      </template>

      <div v-for="g in roundGroups" :key="g.group_id" class="round-block">
        <p class="sb-title">
          {{ g.band_label }} {{ g.group_letter }} 组
          <span class="sb-count">{{ g.rounds.length }} 轮</span>
        </p>
        <div v-for="r in g.rounds" :key="r.round_no" class="round-row">
          <span class="rr-no">第 {{ r.round_no }} 轮</span>
          <span v-for="m in r.matches" :key="m.id" class="rr-match" :class="{ done: m.status === 1 }">
            {{ m.team_a }}
            <b>{{ m.status === 1 ? `${m.score_a} : ${m.score_b}` : 'VS' }}</b>
            {{ m.team_b }}
            <span v-if="m.start_time" class="rr-when">{{ m.play_date }} {{ m.start_time }}</span>
          </span>
          <span v-if="r.bye" class="rr-bye">本轮轮空：{{ r.bye }}</span>
        </div>
      </div>
    </t-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useUserStore } from '../store/user';
import http from '../api/http';
import { message } from '../utils/ui';
import { bandLabel } from '../utils/band';

const store = useUserStore();

const bands = ref([]);
const events = ref([]);
const competitions = ref([]);
const compId = ref(store.competitionId);
const bandId = ref(null);
const eventItemId = ref(null);
const onlyMine = ref(true);

const standings = ref([]);
const overview = ref([]);
const loading = ref(false);
const loadingOverview = ref(false);

const standingColumns = [
  { colKey: 'rank', title: '名次', width: 60, align: 'center' },
  { colKey: 'team_name', title: '队名', minWidth: 140, ellipsis: true },
  { colKey: 'school_name', title: '学校', minWidth: 140, ellipsis: true },
  { colKey: 'played', title: '场', width: 52, align: 'center' },
  { colKey: 'win', title: '胜', width: 52, align: 'center' },
  { colKey: 'draw', title: '平', width: 52, align: 'center' },
  { colKey: 'lose', title: '负', width: 52, align: 'center' },
  { colKey: 'points', title: '积分', width: 62, align: 'center' },
  { colKey: 'scored', title: '得分', width: 62, align: 'center' },
  { colKey: 'conceded', title: '失分', width: 62, align: 'center' },
  { colKey: 'diff', title: '净胜分', width: 70, align: 'center' },
  { colKey: 'abandonCount', title: '弃权', width: 70, align: 'center' },
  { colKey: 'isVoided', title: '状态', width: 80, align: 'center' }
];

const overviewColumns = [
  { colKey: 'rank', title: '名次', width: 60, align: 'center' },
  { colKey: 'team_name', title: '队名', minWidth: 150, ellipsis: true },
  { colKey: 'school_name', title: '学校', minWidth: 150, ellipsis: true },
  { colKey: 'played', title: '场', width: 52, align: 'center' },
  { colKey: 'win', title: '胜', width: 52, align: 'center' },
  { colKey: 'draw', title: '平', width: 52, align: 'center' },
  { colKey: 'lose', title: '负', width: 52, align: 'center' },
  { colKey: 'points', title: '积分', width: 62, align: 'center' },
  { colKey: 'diff', title: '净胜分', width: 70, align: 'center' },
  { colKey: 'isVoided', title: '状态', width: 80, align: 'center' }
];


/* ---------- 对阵矩阵 / 小组赛程 ---------- */
const roundGroups = ref([]);
const matrices = ref([]);

async function loadRounds() {
  if (!store.competitionId) return;
  try {
    roundGroups.value = await http.get('/schedule/rounds', {
      params: {
        competition_id: store.competitionId,
        band_id: bandId.value || undefined,
        event_item_id: eventItemId.value || undefined
      }
    });
  } catch (e) {
    roundGroups.value = [];
  }
  buildMatrices();
}

/** 用小组赛程构建交叉表：matrices = [{ key, title, teams, map }] */
function buildMatrices() {
  matrices.value = (roundGroups.value || []).map((g) => {
    const names = [];
    const map = new Map(); // `${a}|${b}` → '3 : 1'
    for (const r of g.rounds) {
      for (const m of r.matches) {
        if (!names.includes(m.team_a)) names.push(m.team_a);
        if (!names.includes(m.team_b)) names.push(m.team_b);
        if (m.status === 1 && m.score_a != null && m.score_b != null) {
          map.set(`${m.team_a}|${m.team_b}`, `${m.score_a} : ${m.score_b}`);
          map.set(`${m.team_b}|${m.team_a}`, `${m.score_b} : ${m.score_a}`);
        }
      }
    }
    return {
      key: `${g.group_id}`,
      title: `${g.band_label || ''} ${g.group_letter} 组`.trim(),
      teams: names,
      map
    };
  }).filter((m) => m.teams.length > 1);
}

function cellText(r, c, mt) {
  if (r === c) return '—';
  return mt.map.get(`${r}|${c}`) || '';
}

function cellClass(r, c, mt) {
  if (r === c) return 'self';
  const v = mt.map.get(`${r}|${c}`);
  if (!v) return 'none';
  const [a, b] = v.split(':').map((s) => Number(s.trim()));
  if (a > b) return 'win';
  if (a < b) return 'lose';
  return 'draw';
}

/* ---------- 导出 / 打印 ---------- */
function exportCsv() {
  const rows = [];
  rows.push(['小组', '名次', '队名', '学校', '场', '胜', '平', '负', '积分', '得分', '失分', '净胜分', '弃权', '状态', '排名依据']);
  for (const g of standings.value) {
    for (const r of filterStanding(g.standing)) {
      rows.push([
        `${g.band_label || ''} ${g.group_letter} 组`.trim(),
        r.rank, r.team_name || '', r.school_name || '', r.played, r.win, r.draw, r.lose,
        r.points, r.scored, r.conceded, r.diff, r.abandonCount,
        r.isVoided ? '作废' : '有效', r.rankReason || ''
      ]);
    }
  }
  const csv = rows
    .map((cols) => cols.map((c) => {
      const s = String(c ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))
    .join('\r\n');

  // BOM：Excel 打开不乱码
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `积分榜_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  message.success('已导出 CSV');
}

function printPage() {
  window.print();
}

function rankClass(rank) {
  if (rank === 1) return 'rank-1';
  if (rank === 2) return 'rank-2';
  if (rank === 3) return 'rank-3';
  return 'dim';
}

function filterStanding(list) {
  const arr = Array.isArray(list) ? list : [];
  if (!store.isSchool || !onlyMine.value) return arr;
  const name = store.user?.school_name;
  if (!name) return arr;
  return arr.filter((r) => r.school_name === name);
}

async function loadBase() {
  if (!store.competitionId) return;
  try {
    bands.value = await http.get('/event/bands', { params: { competition_id: store.competitionId } });
    events.value = await http.get('/event/items', { params: { competition_id: store.competitionId } });
  } catch (e) {
    message.error(e.message);
  }
}

async function loadStandings() {
  if (!store.competitionId) return;
  loading.value = true;
  try {
    const data = await http.get('/stats/standings', {
      params: {
        competition_id: store.competitionId,
        band_id: bandId.value || undefined,
        event_item_id: eventItemId.value || undefined
      }
    });
    standings.value = Array.isArray(data) ? data : [];
    await loadRounds(); // 对阵矩阵 + 小组赛程（含轮空）
  } catch (e) {
    message.error(e.message);
  } finally {
    loading.value = false;
  }
  loadOverview();
}

async function loadOverview() {
  if (!store.competitionId || !bandId.value || !eventItemId.value) {
    overview.value = [];
    return;
  }
  loadingOverview.value = true;
  try {
    const data = await http.get('/group/standing', {
      params: {
        competition_id: store.competitionId,
        band_id: bandId.value,
        event_item_id: eventItemId.value
      }
    });
    const arr = Array.isArray(data) ? data : [];
    overview.value = store.isSchool && onlyMine.value && store.user?.school_name
      ? arr.filter((r) => r.school_name === store.user.school_name)
      : arr;
  } catch (e) {
    message.error(e.message);
  } finally {
    loadingOverview.value = false;
  }
}

function resetFilter() {
  bandId.value = null;
  eventItemId.value = null;
  loadStandings();
}

// 非管理员端（学校/裁判）顶栏没有赛事选择器，页面内自行选择
async function loadCompetitions() {
  if (store.isAdmin) return;
  try {
    competitions.value = await http.get('/competition/list');
    if (!store.competitionId && competitions.value.length) {
      store.setCompetition(competitions.value[0].id);
    } else {
      compId.value = store.competitionId;
    }
  } catch (e) {
    competitions.value = [];
  }
}

function onCompChange(id) {
  bandId.value = null;
  eventItemId.value = null;
  store.setCompetition(id);
}

onMounted(() => {
  loadCompetitions();
  loadBase();
  loadStandings();
});
watch(() => store.competitionId, (v) => {
  compId.value = v;
  standings.value = [];
  overview.value = [];
  loadBase();
  loadStandings();
});
watch(onlyMine, () => {
  loadOverview();
});
</script>

<style scoped>
.toolbar,
.panel {
  border-color: var(--app-border);
  border-radius: 8px;
}

.toolbar {
  margin-bottom: 14px;
}

.tb-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.mine-check {
  margin-left: 4px;
}

.tb-meta {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--app-text-3);
}

.panel {
  margin-bottom: 14px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 500;
  color: var(--app-text-1);
}

.panel-hint {
  font-size: 12px;
  font-weight: 400;
  color: var(--app-text-3);
}

.standing-wrap {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.standing-block {
  border: 1px solid var(--app-border);
  border-radius: 8px;
  padding: 12px;
}

.sb-title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--app-text-1);
}

.sb-count {
  font-size: 11px;
  font-weight: 400;
  color: var(--app-text-3);
  margin-left: 6px;
}

.table-scroll {
  overflow-x: auto;
}

.rank-1,
.rank-2,
.rank-3 {
  display: inline-block;
  width: 20px;
  height: 20px;
  line-height: 20px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 500;
  color: #fff;
  text-align: center;
}

.rank-1 {
  background: var(--td-brand-color);
}

.rank-2 {
  background: #8b8b8b;
}

.rank-3 {
  background: #b5b5b5;
}

.pt {
  font-weight: 500;
  color: var(--td-brand-color);
}

.pos {
  color: var(--app-success);
}

.neg {
  color: #e34d59;
}

.dim {
  font-size: 13px;
  color: var(--app-text-3);
}

.empty {
  text-align: center;
  padding: 40px 0;
  color: var(--app-text-3);
  font-size: 13px;
}

.rank-reason {
  display: block;
  font-size: 11px;
  color: var(--td-warning-color, var(--app-warning));
  margin-top: 1px;
}

.tb-divider {
  display: inline-block;
  width: 1px;
  height: 18px;
  background: var(--app-border);
  margin: 0 6px;
  vertical-align: middle;
}

/* 对阵矩阵 */
.matrix-block {
  margin-bottom: 18px;
}

.matrix {
  border-collapse: collapse;
  font-size: 13px;
  min-width: 100%;
}

.matrix th,
.matrix td {
  border: 1px solid var(--app-border);
  padding: 5px 8px;
  text-align: center;
  white-space: nowrap;
}

.matrix .corner {
  background: var(--app-bg-2, #f5f7fa);
  font-weight: normal;
  color: var(--app-text-3);
}

.matrix .row-head {
  background: var(--app-bg-2, #f5f7fa);
  font-weight: 500;
  text-align: left;
}

.matrix td.self { background: var(--app-bg-2); color: #bbb; }
.matrix td.none { color: #ccc; }
.matrix td.win { color: var(--app-error); font-weight: 600; }
.matrix td.lose { color: #8a8a8a; }
.matrix td.draw { color: var(--app-success); }

/* 小组赛程 */
.round-block {
  margin-bottom: 16px;
}

.round-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--app-border);
  font-size: 13px;
}

.rr-no {
  width: 62px;
  color: var(--app-text-3);
  font-size: 12px;
}

.rr-match {
  padding: 3px 8px;
  border: 1px solid var(--app-border);
  border-radius: 4px;
}

.rr-match.done {
  border-color: var(--app-success);
  color: var(--app-success);
}

.rr-when {
  margin-left: 6px;
  font-size: 11px;
  color: var(--app-text-3);
}

.rr-bye {
  font-size: 12px;
  color: var(--app-warning);
}

@media (max-width: 768px) {
  .panel-hint {
    display: none;
  }
  .tb-meta {
    display: none;
  }
}

/* 打印：只留表格，隐藏筛选条与按钮 */
@media print {
  .toolbar,
  .panel-hint,
  .tb-divider {
    display: none !important;
  }

  .panel {
    border: none !important;
    box-shadow: none !important;
    break-inside: avoid;
  }

  body {
    background: var(--app-surface);
  }
}
</style>
