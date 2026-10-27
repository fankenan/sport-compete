<template>
  <div class="dash">
    <!-- 顶部欢迎区 -->
    <div class="hero rise-in">
      <div class="hero-left">
        <h2 class="hero-title">{{ greeting }}{{ store.user?.real_name ? '，' + store.user.real_name : '' }}</h2>
        <p class="hero-sub">
          {{ competitionName || '尚未选择赛事' }}
          <template v-if="todayText"> · {{ todayText }}</template>
          <template v-if="lunarText"> · {{ lunarText }}</template>
        </p>
      </div>
      <div class="hero-right">
        <t-button
          v-if="store.isAdmin"
          variant="outline"
          theme="default"
          size="medium"
          @click="refreshAll"
        >
          <template #icon><t-icon name="refresh" /></template>
          刷新数据
        </t-button>
      </div>
    </div>

    <!-- 指标卡 -->
    <div class="stat-grid stagger">
      <div class="stat-card" v-for="card in statCards" :key="card.label">
        <div class="stat-top">
          <div class="stat-icon" :style="{ background: card.iconBg }">
            <t-icon :name="card.icon" size="20px" :style="{ color: card.iconColor }" />
          </div>
          <div class="stat-meta">
            <p class="stat-label">{{ card.label }}</p>
            <p class="stat-value num">{{ card.value }}<span class="stat-unit">{{ card.unit }}</span></p>
          </div>
        </div>
        <div v-if="card.hint" class="stat-hint">{{ card.hint }}</div>
        <div v-if="card.pct !== null" class="progress-bar">
          <div class="progress-fill" :style="{ width: card.pct + '%', background: card.barColor }"></div>
        </div>
      </div>
    </div>

    <div class="two-col">
      <!-- 各组别情况 -->
      <t-card class="panel" header-bordered>
        <template #header>
          <div class="panel-head">
            <span class="ph-title">各组别参赛情况</span>
            <t-tag v-if="bands.length" size="small" variant="light" theme="primary">{{ bands.length }} 个组别</t-tag>
          </div>
        </template>
        <t-table
          :data="bands"
          :columns="bandColumns"
          row-key="id"
          hover
          :empty="'尚未设置组别'"
        >
          <template #progress="{ row }">
            <div class="cell-progress">
              <t-progress
                :percentage="row.match_count ? Math.round(row.match_done / row.match_count * 100) : 0"
                :stroke-width="6"
                :label="false"
              />
              <span class="progress-text num">{{ row.match_done }}/{{ row.match_count }}</span>
            </div>
          </template>
        </t-table>
      </t-card>

      <!-- 右列：阶段推进 + 最近赛况 -->
      <div class="right-col">
        <t-card class="panel" header-bordered>
          <template #header>
            <div class="panel-head">
              <span class="ph-title">赛程阶段</span>
            </div>
          </template>
          <div v-if="advanceList.length === 0" class="app-empty">
            <t-icon name="calendar" class="app-empty-icon" />
            暂无赛程数据
          </div>
          <div v-else class="stage-list">
            <div v-for="a in advanceList" :key="a.band_id + '_' + a.event_id" class="stage-row">
              <span class="stage-dot" :class="{ done: a.complete }"></span>
              <div class="stage-info">
                <span class="stage-name">{{ a.band_label }} {{ a.event_name }}</span>
                <span class="stage-step">{{ a.stage_label }}</span>
              </div>
              <div class="stage-right">
                <span class="stage-count num">{{ a.done }}/{{ a.total }}</span>
                <t-tag v-if="a.complete" theme="success" size="small" variant="light">已完成</t-tag>
                <t-tag v-else theme="warning" size="small" variant="light">进行中</t-tag>
              </div>
            </div>
          </div>
        </t-card>

        <t-card class="panel" header-bordered>
          <template #header>
            <div class="panel-head">
              <span class="ph-title">最近赛况</span>
            </div>
          </template>
          <div v-if="recentMatches.length === 0" class="app-empty">
            <t-icon name="time" class="app-empty-icon" />
            暂无比赛记录
          </div>
          <div v-else class="match-list">
            <div v-for="m in recentMatches" :key="m.id" class="match-row">
              <div class="match-when">
                <span class="mw-date num">{{ shortDate(m.date) }}</span>
                <span class="mw-time num">{{ shortTime(m.start_time) }}</span>
              </div>
              <div class="match-body">
                <p class="match-vs">
                  <span class="mv-team" :class="{ win: winnerOf(m) === 'a' }">{{ m.team_a }}</span>
                  <span class="mv-score num" :class="{ void: m.status === 2 }">{{ scoreText(m) }}</span>
                  <span class="mv-team" :class="{ win: winnerOf(m) === 'b' }">{{ m.team_b }}</span>
                </p>
                <p class="match-meta">
                  {{ m.band_label }}{{ m.event_name ? ' · ' + m.event_name : '' }}{{ m.venue ? ' · ' + m.venue : '' }}
                </p>
              </div>
            </div>
          </div>
        </t-card>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useUserStore } from '../store/user';
import http from '../api/http';

const store = useUserStore();
const stats = ref({});
const advanceList = ref([]);
const recentMatches = ref([]);
const competitionName = ref('');

const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 9) return '早上好';
  if (h < 12) return '上午好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
});

const todayText = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });

/* 农历（lunar-javascript 已在依赖中，异步加载不阻塞首屏） */
const lunarText = ref('');
import('lunar-javascript')
  .then(({ Solar }) => {
    lunarText.value = Solar.fromDate(new Date()).getLunar().toString();
  })
  .catch(() => { /* 农历失败不影响页面 */ });

const statCards = computed(() => {
  const s = stats.value;
  const total = Number(s.school_total || 0);
  const joined = Number(s.school_joined || 0);
  const pct = total ? Math.round(joined / total * 100) : null;
  return [
    {
      label: '参赛学校',
      value: joined,
      unit: `/ ${total}`,
      icon: 'usergroup',
      iconBg: 'linear-gradient(135deg, #e8f0fe, #f2f6ff)',
      iconColor: 'var(--td-brand-color)',
      barColor: 'linear-gradient(90deg, #366ef4, var(--td-brand-color))',
      pct,
      hint: total ? `参赛率 ${pct}%` : ''
    },
    {
      label: '参赛队伍',
      value: s.team_count || 0,
      unit: '队',
      icon: 'flag',
      iconBg: 'linear-gradient(135deg, #e6f7f0, #f0fbf7)',
      iconColor: 'var(--app-success)',
      pct: null,
      hint: `待审核 ${s.team_pending || 0} 队`
    },
    {
      label: '参赛人数',
      value: s.athlete_count || 0,
      unit: '人',
      icon: 'user-circle',
      iconBg: 'linear-gradient(135deg, #fff4e6, #fff9f2)',
      iconColor: 'var(--app-warning)',
      pct: null,
      hint: `${s.group_count || 0} 个小组`
    },
    {
      label: '比赛场次',
      value: s.match_done || 0,
      unit: `/ ${s.match_count || 0}`,
      icon: 'chart-bar',
      iconBg: 'linear-gradient(135deg, #f0eefe, #f6f3ff)',
      iconColor: '#7b61ff',
      pct: s.match_count ? Math.round((s.match_done || 0) / s.match_count * 100) : null,
      hint: s.referee_count ? `${s.referee_count} 名裁判执裁` : ''
    }
  ];
});

const bands = computed(() => stats.value.bands || []);

const bandColumns = [
  { colKey: 'band_label', title: '组别', width: 110 },
  { colKey: 'team_count', title: '队伍', width: 80, align: 'center' },
  { colKey: 'athlete_count', title: '人数', width: 80, align: 'center' },
  { colKey: 'progress', title: '赛程进度', minWidth: 150 }
];

function shortDate(d) {
  if (!d) return '—';
  return String(d).slice(5).replace('-', '/');
}

function shortTime(t) {
  if (!t) return '';
  return String(t).slice(0, 5);
}

function scoreText(m) {
  if (m.status === 0) return 'vs';
  if (m.status === 2) return '作废';
  if (m.abandon_a) return `弃 ${m.score_b ?? 0}`;
  if (m.abandon_b) return `${m.score_a ?? 0} 弃`;
  return `${m.score_a ?? '-'} : ${m.score_b ?? '-'}`;
}

function winnerOf(m) {
  if (m.status !== 1) return '';
  if (m.abandon_a) return 'b';
  if (m.abandon_b) return 'a';
  if ((m.score_a ?? -1) > (m.score_b ?? -1)) return 'a';
  if ((m.score_b ?? -1) > (m.score_a ?? -1)) return 'b';
  return '';
}

async function loadStats() {
  if (!store.competitionId) return;
  try {
    stats.value = await http.get('/stats/overview', { params: { competition_id: store.competitionId } });
  } catch (e) { console.error(e); }
}

async function loadAdvance() {
  if (!store.competitionId) return;
  try {
    advanceList.value = await http.get('/schedule/advance-status', { params: { competition_id: store.competitionId } });
  } catch (e) { console.error(e); }
}

async function loadRecent() {
  if (!store.competitionId) return;
  try {
    recentMatches.value = await http.get('/stats/recent-matches', { params: { competition_id: store.competitionId } });
  } catch (e) { console.error(e); }
}

async function loadCompName() {
  try {
    const list = await http.get('/competition/list');
    const cur = (list || []).find((c) => Number(c.id) === Number(store.competitionId));
    competitionName.value = cur?.name || '';
  } catch (e) { /* 非管理员可能无权限，忽略 */ }
}

function refreshAll() {
  loadStats();
  loadAdvance();
  loadRecent();
}

onMounted(() => { loadStats(); loadAdvance(); loadRecent(); loadCompName(); });
watch(() => store.competitionId, () => { loadStats(); loadAdvance(); loadRecent(); loadCompName(); });
</script>

<style scoped>
/* ---------- 欢迎区 ---------- */
.hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  padding: 22px 24px;
  background: linear-gradient(120deg, #0b3ba5 0%, var(--td-brand-color) 50%, #2669e8 100%);
  border-radius: var(--radius-l);
  color: #fff;
  position: relative;
  overflow: hidden;
}

.hero::after {
  content: '';
  position: absolute;
  width: 260px;
  height: 260px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  right: -80px;
  top: -120px;
}

.hero-left {
  position: relative;
  z-index: 1;
}

.hero-title {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.hero-sub {
  margin: 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.75);
}

.hero-right {
  position: relative;
  z-index: 1;
}

.hero-right :deep(.t-button--variant-outline) {
  background: transparent;
  color: #fff;
  border-color: rgba(255, 255, 255, 0.45);
  --ripple-color: transparent;
}

.hero-right :deep(.t-button--variant-outline:hover) {
  background: rgba(255, 255, 255, 0.14);
  border-color: #fff;
  color: #fff;
}

/* ---------- 指标卡 ---------- */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}

.stat-card {
  background: var(--app-surface);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-1);
  padding: 18px 18px 16px;
  transition: box-shadow var(--dur-mid) var(--ease-out), transform var(--dur-mid) var(--ease-out);
}

.stat-card:hover {
  box-shadow: var(--shadow-2);
  transform: translateY(-2px);
}

.stat-top {
  display: flex;
  align-items: center;
  gap: 13px;
}

.stat-icon {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-m);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stat-label {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--app-text-3);
}

.stat-value {
  margin: 0;
  font-size: 26px;
  font-weight: 600;
  color: var(--app-text-1);
  line-height: 1.1;
}

.stat-unit {
  font-size: 13px;
  font-weight: 400;
  color: var(--app-text-3);
  margin-left: 4px;
}

.stat-hint {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--app-text-3);
}

.progress-bar {
  height: 5px;
  background: var(--app-bg-2);
  border-radius: 3px;
  margin-top: 12px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.6s var(--ease-out);
}

/* ---------- 双栏 ---------- */
.two-col {
  display: grid;
  grid-template-columns: 1.25fr 1fr;
  gap: 16px;
  align-items: start;
}

.two-col > * {
  min-width: 0;
}

.right-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.panel {
  border-radius: var(--radius-l);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.ph-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--app-text-1);
}

.cell-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cell-progress :deep(.t-progress) {
  flex: 1;
  margin: 0;
}

.cell-progress :deep(.t-progress__info) {
  display: none;
}

/* ---------- 阶段时间轴 ---------- */
.stage-list {
  max-height: 340px;
  overflow-y: auto;
}

.stage-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0 10px 4px;
}

.stage-row:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 4.5px;
  top: 24px;
  bottom: -6px;
  width: 1px;
  background: var(--app-border-2);
}

.stage-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--app-warning);
  box-shadow: 0 0 0 3px rgba(237, 123, 47, 0.15);
  flex-shrink: 0;
}

.stage-dot.done {
  background: var(--app-success);
  box-shadow: 0 0 0 3px rgba(43, 164, 113, 0.15);
}

.stage-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.stage-name {
  font-size: 13px;
  color: var(--app-text-1);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stage-step {
  font-size: 11px;
  color: var(--app-text-3);
  background: var(--app-bg-2);
  padding: 1px 7px;
  border-radius: 10px;
  white-space: nowrap;
  flex-shrink: 0;
}

.stage-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.stage-count {
  font-size: 12px;
  color: var(--app-text-2);
}

.progress-text {
  font-size: 12px;
  color: var(--app-text-3);
  white-space: nowrap;
}

/* ---------- 最近赛况 ---------- */
.match-list {
  max-height: 380px;
  overflow-y: auto;
}

.match-row {
  display: flex;
  gap: 14px;
  padding: 10px 0;
}

.match-row:not(:last-child) {
  border-bottom: 1px solid var(--app-border-2);
}

.match-when {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex-shrink: 0;
  width: 52px;
  padding-top: 1px;
}

.mw-date {
  font-size: 12px;
  color: var(--app-text-2);
}

.mw-time {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-1);
}

.match-body {
  flex: 1;
  min-width: 0;
}

.match-vs {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 3px;
  font-size: 13px;
}

.mv-team {
  color: var(--app-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mv-team.win {
  color: var(--app-text-1);
  font-weight: 600;
}

.mv-score {
  flex-shrink: 0;
  font-weight: 600;
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
  padding: 0 8px;
  border-radius: 10px;
  line-height: 20px;
}

.mv-score.void {
  color: var(--app-text-3);
  background: var(--app-bg-2);
}

.match-meta {
  margin: 0;
  font-size: 12px;
  color: var(--app-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- 响应式 ---------- */
@media (max-width: 1024px) {
  .two-col {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .hero {
    padding: 18px 18px;
  }

  .hero-title {
    font-size: 20px;
  }

  .stat-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }

  .stat-value {
    font-size: 22px;
  }
}
</style>
