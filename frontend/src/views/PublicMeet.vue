<template>
  <div class="pub">
    <div v-if="loading" class="center"><t-loading text="加载中..." /></div>

    <div v-else-if="err" class="center">
      <t-result theme="warning" :title="err" description="请确认链接是否正确，或联系赛事主办方开放公开查询" />
    </div>

    <div v-else class="wrap">
      <div class="hero">
        <div class="hero-main">
          <h1>{{ data.competition.name }}</h1>
          <div class="meta">
            <span v-if="data.competition.year">{{ data.competition.year }} 年</span>
            <span v-if="data.competition.start_date">{{ data.competition.start_date }} 至 {{ data.competition.end_date }}</span>
            <span v-if="data.competition.host_unit">主办：{{ data.competition.host_unit }}</span>
            <span v-if="data.competition.venue">地点：{{ data.competition.venue }}</span>
          </div>
          <p v-if="data.competition.note" class="note">{{ data.competition.note }}</p>
        </div>
        <div class="hero-stat">
          <div><b>{{ publishedEventCount }}</b><span>已公布项目</span></div>
          <div><b>{{ publishedGroupCount }}</b><span>组别</span></div>
          <div><b>{{ updatedText }}</b><span>更新时间</span></div>
        </div>
      </div>

      <t-tabs v-model="tab">
        <t-tab-panel value="result" label="成绩查询">
          <div class="filter">
            <t-input v-model="keyword" placeholder="搜索运动员姓名 / 单位" clearable style="width:240px" />
            <t-select v-model="bandId" :options="bandOptions" placeholder="全部组别" clearable style="width:160px" />
            <t-select v-model="eventId" :options="eventOptions" placeholder="全部项目" clearable style="width:180px" />
          </div>

          <div v-if="!filtered.length" class="center muted">暂无符合条件的成绩</div>

          <t-card v-for="g in filtered" :key="g.event_item_id + '-' + g.band_id" size="small" class="card">
            <template #title>
              <span class="ct">{{ g.event_name }}</span>
              <t-tag v-if="g.band_label" size="small" theme="primary" variant="light" style="margin-left:8px">
                {{ g.band_label }}
              </t-tag>
              <t-tag v-if="g.kind === 'ball'" size="small" theme="warning" variant="light" style="margin-left:6px">
                球类
              </t-tag>
            </template>
            <t-table :data="g.rows" :columns="cols" row-key="rank" bordered :hover="true" />
          </t-card>
        </t-tab-panel>

        <!-- 赛程总表：观众最需要的一张表（原来系统里根本没有） -->
        <t-tab-panel value="schedule" label="赛程总表">
          <div class="filter">
            <t-select v-model="scBandId" :options="bandOptions" placeholder="全部组别" clearable style="width:160px" />
            <t-select v-model="scEventId" :options="eventOptions" placeholder="全部项目" clearable style="width:180px" />
          </div>

          <div v-if="scLoading" class="center muted"><t-loading text="加载赛程..." /></div>
          <div v-else-if="!scheduleDays.length" class="center muted">赛程尚未发布</div>

          <div v-else class="sched">
            <div v-for="day in scheduleDays" :key="day.date" class="sched-day">
              <div class="sd-head">
                <span class="sd-date">{{ day.date }}</span>
                <span class="sd-count">{{ day.rows.length }} 场</span>
              </div>
              <table class="sd-table">
                <thead>
                  <tr>
                    <th style="width:56px">时间</th>
                    <th style="width:120px">场地</th>
                    <th style="width:80px">组别</th>
                    <th>对阵</th>
                    <th style="width:90px">比分</th>
                    <th style="width:80px">阶段</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in day.rows" :key="r.id">
                    <td class="num">{{ r.time }}</td>
                    <td>{{ r.venue }}</td>
                    <td>{{ r.band_label }}</td>
                    <td>
                      <span class="sd-a" :class="{ win: r.score_a > r.score_b }">{{ r.team_a }}</span>
                      <span class="sd-vs">vs</span>
                      <span class="sd-b" :class="{ win: r.score_b > r.score_a }">{{ r.team_b }}</span>
                    </td>
                    <td class="num">
                      <template v-if="r.status === 1">{{ r.score_a }} : {{ r.score_b }}</template>
                      <template v-else><span class="dim">未开始</span></template>
                    </td>
                    <td><span class="sd-stage">{{ r.stage_label }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </t-tab-panel>

        <!-- 球类小组积分榜 -->
        <t-tab-panel value="standing" label="小组积分">
          <div class="filter">
            <t-select v-model="stBandId" :options="bandOptions" placeholder="全部组别" clearable style="width:160px" />
            <t-select v-model="stEventId" :options="ballEventOptions" placeholder="选择项目" style="width:180px" />
          </div>

          <div v-if="stLoading" class="center muted"><t-loading text="加载积分榜..." /></div>
          <div v-else-if="!standingGroups.length" class="center muted">
            {{ stEventId ? '该组别暂无已录分的比赛' : '请选择一个球类项目' }}
          </div>

          <div v-else class="stand">
            <t-card v-for="g in standingGroups" :key="g.group_id" size="small" class="card">
              <template #title>
                <span class="ct">{{ g.group_letter }} 组</span>
                <t-tag v-if="g.band_label" size="small" theme="primary" variant="light" style="margin-left:8px">
                  {{ g.band_label }}
                </t-tag>
              </template>
              <t-table :data="g.rows" :columns="standCols" row-key="rank" bordered :hover="true" />
            </t-card>
          </div>
        </t-tab-panel>

        <t-tab-panel value="team" label="团体总分">
          <div v-if="!teamRows.length" class="center muted">该赛事尚未发布团体总分</div>
          <t-table v-else :data="teamRows" :columns="teamCols" row-key="unit_name" bordered />
        </t-tab-panel>

        <t-tab-panel value="bracket" label="淘汰赛对阵">
          <div class="filter">
            <t-select v-model="bkBandId" :options="bandOptions" placeholder="选择组别" style="width:160px" />
            <t-select v-model="bkEventId" :options="ballEventOptions" placeholder="选择项目" style="width:180px" />
          </div>
          <div v-if="bkLoading" class="center muted"><t-loading text="加载对阵..." /></div>
          <div v-else-if="!bkBandId || !bkEventId" class="center muted">选择组别和项目后查看对阵图</div>
          <BracketTree v-else :rounds="bkRounds" :champion="bkChampion" />
        </t-tab-panel>
      </t-tabs>

      <div class="foot">
        <span>本页面为公开只读页，无需登录 · 数据来源：体育竞赛管理系统</span>
        <a class="foot-link" :href="`#/screen/${uuid}`" target="_blank">打开赛事大屏 ↗</a>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import http from '../api/http';
import BracketTree from '../components/BracketTree.vue';

const route = useRoute();
const uuid = computed(() => route.params.uuid);
const loading = ref(true);
const err = ref('');
const data = ref({ competition: {}, events: [], bands: [], results: [] });
const tab = ref('result');
const keyword = ref('');
const bandId = ref(null);
const eventId = ref(null);
const teamRows = ref([]);

/* 淘汰赛对阵 */
const bkBandId = ref(null);
const bkEventId = ref(null);
const bkLoading = ref(false);
const bkRounds = ref([]);
const bkChampion = ref('');

/* 球类小组积分榜 */
const stBandId = ref(null);
const stEventId = ref(null);
const stLoading = ref(false);
const standingGroups = ref([]);

/* 赛程总表 */
const scBandId = ref(null);
const scEventId = ref(null);
const scLoading = ref(false);
const scheduleRows = ref([]);

const cols = [
  { colKey: 'rank', title: '名次', width: 70, align: 'center' },
  { colKey: 'name', title: '运动员', width: 120 },
  { colKey: 'school', title: '单位', minWidth: 150 },
  { colKey: 'result', title: '成绩', width: 110, align: 'right' },
  { colKey: 'score', title: '积分', width: 80, align: 'right' },
  { colKey: 'heat', title: '赛次', width: 110 }
];
const standCols = [
  { colKey: 'rank', title: '名次', width: 62, align: 'center' },
  { colKey: 'team_name', title: '队伍', minWidth: 130 },
  { colKey: 'played', title: '场', width: 52, align: 'center' },
  { colKey: 'win', title: '胜', width: 52, align: 'center' },
  { colKey: 'draw', title: '平', width: 52, align: 'center' },
  { colKey: 'lose', title: '负', width: 52, align: 'center' },
  { colKey: 'points', title: '积分', width: 62, align: 'center' },
  { colKey: 'scored', title: '得分', width: 62, align: 'right' },
  { colKey: 'conceded', title: '失分', width: 62, align: 'right' },
  { colKey: 'diff', title: '净胜', width: 66, align: 'right' }
];
const teamCols = [
  { colKey: 'rank_no', title: '名次', width: 70, align: 'center' },
  { colKey: 'unit_name', title: '参赛单位', minWidth: 180 },
  { colKey: 'total_score', title: '项目得分', width: 100, align: 'right' },
  { colKey: 'grade_bonus', title: '达级加分', width: 100, align: 'right' },
  { colKey: 'record_bonus', title: '破纪录加分', width: 110, align: 'right' },
  { colKey: 'adjust_score', title: '调整', width: 80, align: 'right' },
  { colKey: 'final_score', title: '总分', width: 100, align: 'right' },
  { colKey: 'first_count', title: '第一', width: 70, align: 'center' },
  { colKey: 'second_count', title: '第二', width: 70, align: 'center' },
  { colKey: 'third_count', title: '第三', width: 70, align: 'center' }
];

const bandOptions = computed(() => (data.value.bands || []).map((b) => ({ label: b.label || ('组别' + b.id), value: b.id })));
const eventOptions = computed(() => (data.value.events || []).map((e) => ({ label: e.name, value: e.id })));
/** 球类项目（分类 3）—— 只有球类才有积分榜和淘汰赛对阵 */
const ballEventOptions = computed(() =>
  (data.value.events || []).filter((e) => Number(e.category) === 3).map((e) => ({ label: e.name, value: e.id }))
);
const updatedText = computed(() => {
  const t = data.value.updated_at;
  return t ? String(t).slice(11, 16) : '—';
});

/**
 * 已公布的项目数 / 组别数
 * 原来直接显示 data.results.length —— 那是「项目 × 组别」的**组合数**，
 * 比如 3 个项目 6 个组别会显示成 18，口径是错的。
 */
const publishedEventCount = computed(() =>
  new Set((data.value.results || []).map((g) => g.event_item_id)).size
);
const publishedGroupCount = computed(() =>
  new Set((data.value.results || []).map((g) => g.band_id)).size
);

/** 赛程按日期分组 */
const scheduleDays = computed(() => {
  const byDate = new Map();
  for (const r of scheduleRows.value) {
    const d = r.date || '未定日期';
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(r);
  }
  return [...byDate.entries()]
    .map(([date, rows]) => ({ date, rows }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
});

const filtered = computed(() => {
  const kw = (keyword.value || '').trim();
  return (data.value.results || []).filter((g) => {
    if (bandId.value && g.band_id !== bandId.value) return false;
    if (eventId.value && g.event_item_id !== eventId.value) return false;
    if (!kw) return true;
    return g.rows.some((r) => (r.name || '').includes(kw) || (r.school || '').includes(kw));
  }).map((g) => {
    if (!kw) return g;
    return { ...g, rows: g.rows.filter((r) => (r.name || '').includes(kw) || (r.school || '').includes(kw)) };
  }).filter((g) => g.rows.length);
});

async function load() {
  loading.value = true;
  err.value = '';
  try {
    const r = await http.get(`/public/meet/${uuid.value}`);
    if (r && r.code === 0 && r.data) {
      data.value = r.data;
      const t = await http.get(`/public/meet/${uuid.value}/team-score`);
      teamRows.value = (t?.data?.rows) || [];
    } else {
      err.value = r?.message || '加载失败';
    }
  } catch (e) {
    err.value = e?.response?.data?.message || '无法连接服务器';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  load();
  // URL 参数直达：?tab=bracket&band=12&event=11 （大屏/分享用）
  const q = route.query;
  if (q.tab === 'bracket') {
    tab.value = 'bracket';
    if (q.band) bkBandId.value = Number(q.band);
    if (q.event) bkEventId.value = Number(q.event);
  }
});
watch(uuid, load);

/* 淘汰赛对阵加载 */
async function loadBracket() {
  if (!bkBandId.value || !bkEventId.value || !uuid.value) return;
  bkLoading.value = true;
  try {
    const d = await http.get(`/public/meet/${uuid.value}/bracket`, {
      params: { event_item_id: bkEventId.value, band_id: bkBandId.value }
    });
    bkRounds.value = d?.rounds || [];
    bkChampion.value = d?.champion || '';
  } catch (e) {
    bkRounds.value = [];
  } finally {
    bkLoading.value = false;
  }
}
watch([bkBandId, bkEventId], loadBracket);

/**
 * 【Bug 修复】原来写的是 `bandOptions.value[0]?.id`，
 * 但 bandOptions 的元素是 `{ label, value }`，没有 .id 字段，
 * 结果永远取到 undefined —— 观众点「淘汰赛对阵」tab 会一直停在
 * 「选择组别和项目后查看对阵图」，而且深链 ?tab=bracket 基本不可用。
 * 现在改成 .value，并且切到该 tab 时自动选中第一组球类项目。
 */
watch(tab, (t) => {
  if (t === 'bracket' && !bkBandId.value) {
    bkBandId.value = bandId.value || (bandOptions.value[0]?.value ?? null);
    bkEventId.value = eventId.value || (ballEventOptions.value[0]?.value ?? null);
  }
  if (t === 'standing' && !stEventId.value) {
    stEventId.value = (ballEventOptions.value[0]?.value ?? null);
  }
  if (t === 'schedule' && !scheduleRows.value.length) {
    loadSchedule();
  }
});

/* 球类小组积分榜 */
async function loadStanding() {
  if (!uuid.value || !stEventId.value) { standingGroups.value = []; return; }
  stLoading.value = true;
  try {
    const d = await http.get(`/public/meet/${uuid.value}/standing`, {
      params: { event_item_id: stEventId.value, band_id: stBandId.value || undefined }
    });
    standingGroups.value = Array.isArray(d) ? d : [];
  } catch (e) {
    standingGroups.value = [];
  } finally {
    stLoading.value = false;
  }
}
watch([stEventId, stBandId], loadStanding);

/* 赛程总表 */
async function loadSchedule() {
  if (!uuid.value) return;
  scLoading.value = true;
  try {
    const d = await http.get(`/public/meet/${uuid.value}/schedule`, {
      params: {
        band_id: scBandId.value || undefined,
        event_item_id: scEventId.value || undefined
      }
    });
    scheduleRows.value = Array.isArray(d) ? d : [];
  } catch (e) {
    scheduleRows.value = [];
  } finally {
    scLoading.value = false;
  }
}
watch([scBandId, scEventId], loadSchedule);

// 自动刷新（每 60 秒）
let timer = null;
onMounted(() => { timer = setInterval(load, 60000); });
import { onUnmounted } from 'vue';
onUnmounted(() => { if (timer) clearInterval(timer); });
</script>

<style scoped>
.pub { min-height: 100vh; background: var(--app-bg); padding: 20px 16px 40px; }
.wrap { max-width: 1100px; margin: 0 auto; }
.center { display: flex; justify-content: center; align-items: center; padding: 80px 0; }
.muted { color: var(--app-text-3); font-size: 14px; }

/* ---------- 赛程总表 ---------- */
.sched { display: flex; flex-direction: column; gap: 16px; }
.sched-day {
  border: 1px solid var(--app-border);
  border-radius: var(--radius-l);
  overflow: hidden;
  background: var(--app-surface);
  box-shadow: var(--shadow-1);
}
.sd-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 11px 16px;
  background: var(--app-surface-2);
  border-bottom: 1px solid var(--app-border);
}
.sd-date { font-size: 14px; font-weight: 600; color: var(--app-text-1); }
.sd-count { font-size: 12px; color: var(--app-text-3); }

.sd-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.sd-table th {
  text-align: left; padding: 8px 12px; font-weight: 500; font-size: 11.5px;
  color: var(--app-text-2); background: var(--app-surface-2);
  border-bottom: 1px solid var(--app-border);
}
.sd-table td {
  padding: 8px 12px; border-bottom: 1px solid var(--app-border-2); color: var(--app-text-1);
}
.sd-table tbody tr:last-child td { border-bottom: none; }
.sd-table tbody tr:hover { background: var(--app-bg-2); }
.sd-table .num { font-variant-numeric: tabular-nums; }
.sd-a { font-weight: 500; }
.sd-b { font-weight: 500; }
.sd-a.win { color: var(--app-success); }
.sd-b.win { color: var(--app-success); }
.sd-vs { color: var(--app-text-3); margin: 0 7px; font-size: 11px; }
.sd-stage {
  font-size: 11px; padding: 2px 7px; border-radius: var(--radius-xs);
  background: var(--app-bg-2); color: var(--app-text-2); white-space: nowrap;
}

.stand { display: flex; flex-direction: column; gap: 14px; }

.hero { background: linear-gradient(135deg, var(--td-brand-color), #0d6efd); color: #fff; border-radius: 8px;
        padding: 24px 28px; display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 16px; flex-wrap: wrap; gap: 16px; }
.hero h1 { margin: 0 0 8px; font-size: 24px; font-weight: 600; }
.hero .meta { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; opacity: .9; }
.hero .note { margin: 10px 0 0; font-size: 13px; opacity: .85; }
.hero-stat { display: flex; gap: 28px; text-align: center; }
.hero-stat b { display: block; font-size: 26px; font-weight: 600; }
.hero-stat span { font-size: 12px; opacity: .85; }
.filter { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.card { margin-bottom: 12px; }
.ct { font-size: 15px; font-weight: 600; }
.foot { text-align: center; color: #a6a6a6; font-size: 12px; margin-top: 24px; }
</style>
