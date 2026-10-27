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
          <div><b>{{ data.results.length }}</b><span>已公布项目</span></div>
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
            </template>
            <t-table :data="g.rows" :columns="cols" row-key="rank" bordered :hover="true" />
          </t-card>
        </t-tab-panel>

        <t-tab-panel value="team" label="团体总分">
          <div v-if="!teamRows.length" class="center muted">该赛事尚未发布团体总分</div>
          <t-table v-else :data="teamRows" :columns="teamCols" row-key="unit_name" bordered />
        </t-tab-panel>

        <t-tab-panel value="bracket" label="淘汰赛对阵">
          <div class="filter">
            <t-select v-model="bkBandId" :options="bandOptions" placeholder="选择组别" style="width:160px" />
            <t-select v-model="bkEventId" :options="eventOptions" placeholder="选择项目" style="width:180px" />
          </div>
          <div v-if="bkLoading" class="center muted"><t-loading text="加载对阵..." /></div>
          <div v-else-if="!bkBandId || !bkEventId" class="center muted">选择组别和项目后查看对阵图</div>
          <BracketTree v-else :rounds="bkRounds" :champion="bkChampion" />
        </t-tab-panel>
      </t-tabs>

      <div class="foot">本页面为公开只读页，无需登录 · 数据来源：体育竞赛管理系统</div>
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

const cols = [
  { colKey: 'rank', title: '名次', width: 70, align: 'center' },
  { colKey: 'name', title: '运动员', width: 120 },
  { colKey: 'school', title: '单位', minWidth: 150 },
  { colKey: 'result', title: '成绩', width: 110, align: 'right' },
  { colKey: 'score', title: '积分', width: 80, align: 'right' },
  { colKey: 'heat', title: '赛次', width: 110 }
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
const updatedText = computed(() => {
  const t = data.value.updated_at;
  return t ? String(t).slice(11, 16) : '—';
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
watch(tab, (t) => { if (t === 'bracket' && !bkBandId.value) { bkBandId.value = bandId.value || (bandOptions.value[0]?.id ?? null); bkEventId.value = eventId.value || (eventOptions.value[0]?.id ?? null); } });

// 自动刷新（每 60 秒）
let timer = null;
onMounted(() => { timer = setInterval(load, 60000); });
import { onUnmounted } from 'vue';
onUnmounted(() => { if (timer) clearInterval(timer); });
</script>

<style scoped>
.pub { min-height: 100vh; background: #f3f5f8; padding: 20px 16px 40px; }
.wrap { max-width: 1100px; margin: 0 auto; }
.center { display: flex; justify-content: center; align-items: center; padding: 80px 0; }
.muted { color: var(--app-text-3); font-size: 14px; }
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
