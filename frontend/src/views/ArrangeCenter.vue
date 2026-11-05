<template>
  <div class="arrange-center">
    <!-- 头部：当前赛事 + 刷新 -->
    <div class="ac-head">
      <div>
        <h2 class="ac-title">编排中心</h2>
        <p class="ac-sub">按流程一步步把赛程编排出来。每一步都会告诉你「现在到哪了、还差什么」。</p>
      </div>
      <t-button variant="outline" :loading="loading" @click="loadAll">
        <template #icon><t-icon name="refresh" /></template>
        刷新
      </t-button>
    </div>

    <t-loading :loading="loading" size="small">
      <!-- 项目类型切换：球类 / 田径 / 武术 -->
      <div class="ac-tabs">
        <button
          type="button"
          class="ac-tab"
          :class="{ on: scope === 'ball' }"
          @click="scope = 'ball'"
        >
          球类项目
          <span v-if="ballRows.length" class="ac-tab-n">{{ ballRows.length }}</span>
        </button>
        <button
          type="button"
          class="ac-tab"
          :class="{ on: scope === 'track' }"
          @click="scope = 'track'"
        >
          田径项目
          <span v-if="trackRows.length" class="ac-tab-n">{{ trackRows.length }}</span>
        </button>
        <button
          type="button"
          class="ac-tab"
          :class="{ on: scope === 'martial' }"
          @click="scope = 'martial'"
        >
          武术项目
          <span v-if="martialRows.length" class="ac-tab-n">{{ martialRows.length }}</span>
        </button>
      </div>

      <!-- 步骤条 -->
      <div class="steps">
        <div
          v-for="(s, i) in steps"
          :key="s.key"
          class="step"
          :class="s.state"
        >
          <div class="st-mark">
            <t-icon v-if="s.state === 'done'" name="check" size="15px" />
            <span v-else>{{ i + 1 }}</span>
          </div>
          <div class="st-body">
            <div class="st-title">
              {{ s.title }}
              <span v-if="s.badge" class="st-badge" :class="s.badgeType">{{ s.badge }}</span>
            </div>
            <div class="st-desc">{{ s.desc }}</div>
            <div v-if="s.hint" class="st-hint">{{ s.hint }}</div>
          </div>
          <div class="st-actions">
            <t-button
              v-for="a in s.actions"
              :key="a.text"
              size="small"
              :theme="a.primary ? 'primary' : 'default'"
              :variant="a.primary ? 'outline' : 'text'"
              @click="a.run"
            >
              {{ a.text }}
            </t-button>
          </div>
        </div>
      </div>

      <!-- 明细：按项目列出还差什么 -->
      <t-card class="ac-card" header-bordered>
        <template #header>
          <div class="panel-head">
            <span class="ph-title">
              {{ scope === 'ball' ? '各球类项目编排状态' : '各田径项目编排状态' }}
            </span>
            <span class="panel-hint">点项目名可直接跳到该项目的编排页</span>
          </div>
        </template>

        <div v-if="projectRows.length === 0" class="app-empty">
          <t-icon name="app" class="app-empty-icon" />
          {{
            scope === 'ball'
              ? '当前赛事还没有配置球类项目，请先到「项目与场地」添加'
              : '当前赛事还没有配置田径项目，请先到「项目与场地」添加'
          }}
        </div>

        <table v-else class="ac-table">
          <thead>
            <tr>
              <th>项目</th>
              <th>{{ scope === 'ball' ? '赛制' : '类型' }}</th>
              <th>{{ scope === 'ball' ? '参赛队' : '参赛人数' }}</th>
              <th>{{ scope === 'ball' ? '场次' : '赛次' }}</th>
              <th>已排期</th>
              <th>待排期</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in projectRows" :key="r.event_item_id">
              <td>
                <a class="ac-link" @click="goSchedule(r)">{{ r.event_name }}</a>
              </td>
              <td><span class="ac-mode">{{ r.mode_label }}</span></td>
              <td class="num">{{ r.teams }}</td>
              <td class="num">{{ r.matches }}</td>
              <td class="num">{{ r.scheduled }}</td>
              <td class="num">
                <span :class="{ warn: r.unplaced > 0 }">{{ r.unplaced }}</span>
              </td>
              <td>
                <span class="ac-state" :class="r.state">{{ r.state_label }}</span>
              </td>
              <td>
                <t-button size="small" variant="text" @click="goSchedule(r)">去编排</t-button>
              </td>
            </tr>
          </tbody>
        </table>
      </t-card>
    </t-loading>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '../store/user';
import http from '../api/http';
import { message } from '../utils/ui';

const router = useRouter();
const store = useUserStore();

const loading = ref(false);
const bands = ref([]);
const events = ref([]);
const entryCounts = ref({});      // event_item_id -> 已审核通过队伍数
const matchStats = ref({});      // event_item_id -> { total, done, scheduled, groups }
const trackOverview = ref({ total: 0, items: [], units: 0 });
const martialOverview = ref({ total: 0, items: [] });

/** 当前看球类还是田径 */
const scope = ref('ball');

const MODE_LABEL = {
  GROUP_KO: '分组循环 + 淘汰',
  KO: '纯淘汰',
  LEAGUE: '联赛循环',
  ROUND: '循环赛排名'
};

const TRACK_TYPE_LABEL = { 1: '径赛', 2: '田赛' };

/** 球类项目的编排状态 */
const ballRows = computed(() => {
  return events.value
    .filter((e) => e.category === 3)
    .map((e) => {
      const teams = entryCounts.value[e.id] || 0;
      const st = matchStats.value[e.id] || { total: 0, done: 0, scheduled: 0, groups: 0 };
      const unplaced = Math.max(0, st.total - st.scheduled);

      let state = 'todo';
      let stateLabel = '未开始';
      if (teams === 0) { state = 'todo'; stateLabel = '待报名'; }
      else if (st.total === 0) { state = 'doing'; stateLabel = '待生成对阵'; }
      else if (unplaced > 0) { state = 'doing'; stateLabel = '待排期'; }
      else if (st.scheduled < st.total) { state = 'doing'; stateLabel = '待排期'; }
      else { state = 'done'; stateLabel = '已排期'; }

      return {
        event_item_id: e.id,
        event_name: e.name,
        mode_label: MODE_LABEL[e.schedule_mode] || MODE_LABEL.GROUP_KO,
        teams,
        matches: st.total,
        scheduled: st.scheduled,
        unplaced,
        groups: st.groups,
        state,
        state_label: stateLabel
      };
    });
});

/** 田径项目的编排状态 */
const trackRows = computed(() => {
  return (trackOverview.value.items || []).map((x) => ({
    event_item_id: x.event_item_id,
    event_name: x.event_name,
    mode_label: TRACK_TYPE_LABEL[Number(x.category)] || '田径',
    teams: x.athletes,
    matches: x.heats,
    scheduled: x.scheduled,
    unplaced: x.unplaced,
    groups: 0,
    state: x.state,
    state_label: x.state_label
  }));
});

/** 武术项目的编排状态（评分制） */
const martialRows = computed(() => {
  return (martialOverview.value.items || []).map((x) => ({
    event_item_id: x.event_item_id,
    event_name: x.event_name,
    mode_label: '评分制',
    teams: x.teams,
    matches: x.heats,
    scheduled: x.scheduled,
    unplaced: x.unplaced,
    groups: 0,
    state: x.state,
    state_label: x.state_label
  }));
});

/** 当前作用域的项目明细 */
const projectRows = computed(() => {
  if (scope.value === 'ball') return ballRows.value;
  if (scope.value === 'track') return trackRows.value;
  return martialRows.value;
});

/** 球类流程步骤 */
const ballSteps = computed(() => {
  const rows = ballRows.value;
  const totalTeams = rows.reduce((s, r) => s + r.teams, 0);
  const totalMatches = rows.reduce((s, r) => s + r.matches, 0);
  const totalScheduled = rows.reduce((s, r) => s + r.scheduled, 0);
  const totalUnplaced = rows.reduce((s, r) => s + r.unplaced, 0);

  const steps = [];

  steps.push({
    key: 'event',
    title: '配置赛制',
    desc: '为每个球类项目选好赛制模板（分组循环 / 纯淘汰 / 联赛）',
    state: rows.length ? 'done' : 'todo',
    badge: rows.length ? `${rows.length} 个项目` : '',
    badgeType: 'ok',
    hint: rows.length ? '' : '还没有球类项目',
    actions: [{ text: '去配置', primary: true, run: () => router.push('/event-setup') }]
  });

  steps.push({
    key: 'entry',
    title: '报名审核',
    desc: '学校提交报名，管理员审核通过后才能编排',
    state: totalTeams > 0 ? 'done' : (rows.length ? 'doing' : 'todo'),
    badge: totalTeams ? `${totalTeams} 队通过` : '',
    badgeType: totalTeams ? 'ok' : 'warn',
    hint: totalTeams ? '' : '还没有审核通过的队伍',
    actions: [{ text: '去审核', primary: true, run: () => router.push('/entry') }]
  });

  steps.push({
    key: 'group',
    title: '分组 / 生成对阵',
    desc: totalTeams > 0
      ? '按赛制生成分组与小组赛程；出线后自动生成淘汰赛对阵'
      : '按赛制生成分组或对阵树',
    state: totalMatches > 0 ? 'done' : (totalTeams > 0 ? 'doing' : 'todo'),
    badge: totalMatches ? `${totalMatches} 场` : '',
    badgeType: totalMatches ? 'ok' : 'warn',
    hint: totalMatches ? '' : '还没生成任何场次',
    actions: [
      { text: '分组编排', run: () => router.push('/grouping') },
      { text: '看对阵表', primary: true, run: () => router.push('/lineup') }
    ]
  });

  steps.push({
    key: 'schedule',
    title: '排期',
    desc: '设定比赛日期与每天的可用时段，把场次铺进「日期 × 场地 × 时间」',
    state: totalScheduled > 0 && totalScheduled >= totalMatches ? 'done' : (totalMatches > 0 ? 'doing' : 'todo'),
    badge: totalMatches ? `${totalScheduled}/${totalMatches}` : '',
    badgeType: totalUnplaced > 0 ? 'warn' : 'ok',
    hint: totalUnplaced > 0
      ? `还有 ${totalUnplaced} 场没排期（其中一部分要等上一轮赛果）`
      : (totalMatches ? '' : '先生成场次'),
    actions: [{ text: '去排期', primary: true, run: () => router.push('/schedule') }]
  });

  steps.push({
    key: 'score',
    title: '录分与名次',
    desc: '管理员统一录入成绩，确认后自动推进到下一轮',
    state: totalMatches === 0 ? 'todo' : 'doing',
    badge: '',
    hint: '赛程排完后开始录分',
    actions: [
      { text: '去录分', primary: true, run: () => router.push('/score-entry') },
      { text: '积分榜', run: () => router.push('/standing') }
    ]
  });

  return steps;
});

/** 田径流程步骤 */
const trackSteps = computed(() => {
  const rows = trackRows.value;
  const totalAthletes = rows.reduce((s, r) => s + r.teams, 0);
  const totalHeats = rows.reduce((s, r) => s + r.matches, 0);
  const totalScheduled = rows.reduce((s, r) => s + r.scheduled, 0);
  const totalUnplaced = rows.reduce((s, r) => s + r.unplaced, 0);
  const units = Number(trackOverview.value.units || 0);

  const steps = [];

  steps.push({
    key: 'config',
    title: '田径配置',
    desc: '项目模板、评分表、达级标准、全能配置',
    state: rows.length ? 'done' : 'todo',
    badge: rows.length ? `${rows.length} 个项目` : '',
    badgeType: 'ok',
    hint: rows.length ? '' : '还没有田径项目',
    actions: [{ text: '去配置', primary: true, run: () => router.push('/track') }]
  });

  steps.push({
    key: 'entry',
    title: '报名审核',
    desc: '学生报名参赛项目，管理员审核通过',
    state: totalAthletes > 0 ? 'done' : (rows.length ? 'doing' : 'todo'),
    badge: totalAthletes ? `${totalAthletes} 人通过` : '',
    badgeType: totalAthletes ? 'ok' : 'warn',
    hint: totalAthletes ? '' : '还没有审核通过的人员',
    actions: [{ text: '去审核', primary: true, run: () => router.push('/entry') }]
  });

  steps.push({
    key: 'arrange',
    title: '分组编排',
    desc: '按规则切组、排道次（径赛按道次，田赛按出场顺序）',
    state: totalHeats > 0 ? 'done' : (totalAthletes > 0 ? 'doing' : 'todo'),
    badge: totalHeats ? `${totalHeats} 个赛次` : '',
    badgeType: totalHeats ? 'ok' : 'warn',
    hint: totalHeats ? '' : '还没编排赛次',
    actions: [{ text: '去编排', primary: true, run: () => router.push('/track-arrange') }]
  });

  steps.push({
    key: 'plan',
    title: '日程编排',
    desc: '设定比赛日与时段，把赛次排进「日期 × 场地 × 时刻」',
    state: totalScheduled > 0 && totalScheduled >= totalHeats ? 'done' : (totalHeats > 0 ? 'doing' : 'todo'),
    badge: totalHeats ? `${totalScheduled}/${totalHeats}` : '',
    badgeType: totalUnplaced > 0 ? 'warn' : 'ok',
    hint: units ? `已设 ${units} 个日程单元` : '还没设比赛日',
    actions: [{ text: '去排期', primary: true, run: () => router.push('/track-plan') }]
  });

  steps.push({
    key: 'race',
    title: '赛中控台',
    desc: '号码簿、检录表、临时变更、成绩公布',
    state: 'doing',
    badge: '',
    hint: '赛前现场使用',
    actions: [{ text: '去控台', primary: true, run: () => router.push('/track-race') }]
  });

  steps.push({
    key: 'score',
    title: '录分与统计',
    desc: '录入成绩、确认、晋级录取、团体总分与破纪录',
    state: totalHeats === 0 ? 'todo' : 'doing',
    badge: '',
    hint: '赛次编排后开始录分',
    actions: [
      { text: '去录分', primary: true, run: () => router.push('/track-result') },
      { text: '赛后统计', run: () => router.push('/track-stats') }
    ]
  });

  return steps;
});

/** 武术流程步骤（评分制） */
const martialSteps = computed(() => {
  const rows = martialRows.value;
  const totalTeams = rows.reduce((s, r) => s + r.teams, 0);
  const totalHeats = rows.reduce((s, r) => s + r.matches, 0);
  const totalScheduled = rows.reduce((s, r) => s + r.scheduled, 0);
  const totalUnplaced = rows.reduce((s, r) => s + r.unplaced, 0);

  const steps = [];

  steps.push({
    key: 'config',
    title: '武术配置',
    desc: '设置裁判人数、去极值规则与演练时长上限',
    state: rows.length ? 'done' : 'todo',
    badge: rows.length ? `${rows.length} 个项目` : '',
    badgeType: 'ok',
    hint: rows.length ? '' : '还没有武术项目',
    actions: [{ text: '去配置', primary: true, run: () => router.push('/event-setup') }]
  });

  steps.push({
    key: 'entry',
    title: '报名审核',
    desc: '学校组队报名，管理员审核通过',
    state: totalTeams > 0 ? 'done' : (rows.length ? 'doing' : 'todo'),
    badge: totalTeams ? `${totalTeams} 队通过` : '',
    badgeType: totalTeams ? 'ok' : 'warn',
    hint: totalTeams ? '' : '还没有审核通过的参赛队',
    actions: [{ text: '去审核', primary: true, run: () => router.push('/entry') }]
  });

  steps.push({
    key: 'arrange',
    title: '编排出场顺序',
    desc: '按报名顺序分组编排，确定各队出场次序',
    state: totalHeats > 0 ? 'done' : (totalTeams > 0 ? 'doing' : 'todo'),
    badge: totalHeats ? `${totalHeats} 个赛次` : '',
    badgeType: totalHeats ? 'ok' : 'warn',
    hint: totalHeats ? '' : '还没编排赛次',
    actions: [{ text: '去编排', primary: true, run: () => router.push('/martial') }]
  });

  steps.push({
    key: 'score',
    title: '评分与排名',
    desc: '各裁判独立打分，去极值后取平均，按总分排名',
    state: totalHeats === 0 ? 'todo' : 'doing',
    badge: totalHeats ? `${totalScheduled}/${totalHeats}` : '',
    badgeType: totalUnplaced > 0 ? 'warn' : 'ok',
    hint: totalUnplaced > 0 ? `还有 ${totalUnplaced} 个赛次没完成` : '赛次编排后开始评分',
    actions: [{ text: '去评分', primary: true, run: () => router.push('/martial') }]
  });

  return steps;
});

const steps = computed(() => {
  if (scope.value === 'martial') return martialSteps.value;
  return scope.value === 'ball' ? ballSteps.value : trackSteps.value;
});

function goSchedule(r) {
  // 球类跳「赛程编排」，田径跳「分组编排」，武术跳「武术编排与评分」
  if (scope.value === 'ball') {
    router.push({ path: '/schedule', query: { event: r.event_item_id } });
  } else if (scope.value === 'track') {
    router.push({ path: '/track-arrange', query: { event_item_id: r.event_item_id } });
  } else {
    router.push({ path: '/martial', query: { event_item_id: r.event_item_id } });
  }
}

async function loadAll() {
  if (!store.competitionId) return;
  loading.value = true;
  try {
    const cid = store.competitionId;
    const [b, e, entries, lineup, trackOv, martialOv] = await Promise.all([
      http.get('/event/bands', { params: { competition_id: cid } }),
      http.get('/event/items', { params: { competition_id: cid } }),
      http.get('/entry/list', { params: { competition_id: cid } }),
      http.get('/schedule/lineup', { params: { competition_id: cid } }),
      http.get('/track/overview', { params: { competition_id: cid } }),
      http.get('/martial/overview', { params: { competition_id: cid } })
    ]);

    bands.value = Array.isArray(b) ? b : [];
    events.value = Array.isArray(e) ? e : [];
    trackOverview.value = trackOv || { total: 0, items: [], units: 0 };
    martialOverview.value = martialOv || { total: 0, items: [] };

    // 各项目已审核通过的队伍数
    const counts = {};
    for (const row of (Array.isArray(entries) ? entries : [])) {
      if (Number(row.status) !== 2) continue;
      const k = row.event_item_id;
      counts[k] = (counts[k] || 0) + 1;
    }
    entryCounts.value = counts;

    // 对阵表统计：总场次 / 已录分 / 已排期 / 分组数
    const stats = {};
    for (const c of (lineup?.combos || [])) {
      const k = c.event_item_id;
      if (!stats[k]) stats[k] = { total: 0, done: 0, scheduled: 0, groups: 0 };
      stats[k].total += c.total || 0;
      stats[k].done += c.done || 0;
      stats[k].scheduled += c.scheduled || 0;
      stats[k].groups += (c.groups || []).filter((g) => g.stage === 1).length;
    }
    matchStats.value = stats;
  } catch (e) {
    message.error(e.message);
  } finally {
    loading.value = false;
  }
}

onMounted(loadAll);
watch(() => store.competitionId, loadAll);
</script>

<style scoped>
.arrange-center {
  max-width: 1440px;
  margin: 0 auto;
  padding: var(--sp-6);
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.ac-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-4);
  flex-wrap: wrap;
}

.ac-title {
  margin: 0;
  font-size: var(--fs-20);
  font-weight: 600;
  letter-spacing: 0.2px;
  color: var(--app-text-1);
}

.ac-sub {
  margin: 4px 0 0;
  font-size: var(--fs-13);
  color: var(--app-text-2);
}

/* ---------- 项目类型切换（球类 / 田径） ---------- */
.ac-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: var(--sp-1);
}
.ac-tab {
  font: inherit;
  font-size: 13px;
  padding: 7px 14px;
  border-radius: var(--radius-m);
  border: 1px solid transparent;
  background: transparent;
  color: var(--app-text-2);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  transition: all var(--dur-fast) ease;
}
.ac-tab:hover { color: var(--app-text-1); background: var(--app-surface); }
.ac-tab.on {
  background: var(--app-surface);
  border-color: var(--app-border);
  color: var(--app-text-1);
  font-weight: 600;
  box-shadow: var(--shadow-1);
}
.ac-tab-n {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: var(--radius-full);
  background: var(--app-bg-2);
  color: var(--app-text-3);
  font-variant-numeric: tabular-nums;
}
.ac-tab.on .ac-tab-n {
  background: var(--td-brand-color-light);
  color: var(--td-brand-color);
}

/* ---------- 步骤条 ---------- */
.steps {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-1);
  overflow: hidden;
}

.step {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--app-border-2);
  position: relative;
}
.step:last-child { border-bottom: none; }

/* 步骤之间的连接线 */
.step:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 32px;
  bottom: -1px;
  width: 2px;
  height: 0;
}

.st-mark {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 600;
  background: var(--app-bg-2);
  color: var(--app-text-3);
  border: 1px solid var(--app-border);
}
.step.done .st-mark {
  background: var(--app-success-light);
  color: var(--app-success);
  border-color: transparent;
}
.step.doing .st-mark {
  background: var(--td-brand-color-light);
  color: var(--td-brand-color);
  border-color: var(--td-brand-color-border);
}

.st-body { flex: 1; min-width: 0; }

.st-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text-1);
  display: flex;
  align-items: center;
  gap: 8px;
}
.step.todo .st-title { color: var(--app-text-2); }

.st-badge {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  background: var(--app-bg-2);
  color: var(--app-text-2);
}
.st-badge.ok { background: var(--app-success-light); color: var(--app-success); }
.st-badge.warn { background: var(--app-warning-light); color: var(--app-warning); }

.st-desc {
  font-size: 12.5px;
  color: var(--app-text-2);
  margin-top: 3px;
}

.st-hint {
  font-size: 12px;
  color: var(--app-warning);
  margin-top: 4px;
}

.st-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* ---------- 明细表 ---------- */
.ac-card { border-radius: var(--radius-l); }

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.ph-title { font-size: 15px; font-weight: 600; color: var(--app-text-1); }
.panel-hint { font-size: 12px; color: var(--app-text-3); }

.ac-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.ac-table th {
  text-align: left;
  padding: 9px 14px;
  font-weight: 500;
  font-size: 12px;
  color: var(--app-text-2);
  background: var(--app-surface-2);
  border-bottom: 1px solid var(--app-border);
}
.ac-table td {
  padding: 9px 14px;
  border-bottom: 1px solid var(--app-border-2);
  color: var(--app-text-1);
}
.ac-table .num { font-variant-numeric: tabular-nums; }
.ac-table .warn { color: var(--app-warning); font-weight: 600; }

.ac-link {
  color: var(--td-brand-color);
  cursor: pointer;
  font-weight: 500;
}
.ac-link:hover { text-decoration: underline; }

.ac-mode {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  background: var(--app-bg-2);
  color: var(--app-text-2);
}

.ac-state {
  font-size: 11.5px;
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  font-weight: 500;
}
.ac-state.done { background: var(--app-success-light); color: var(--app-success); }
.ac-state.doing { background: var(--app-warning-light); color: var(--app-warning); }
.ac-state.todo { background: var(--app-bg-2); color: var(--app-text-3); }

@media (max-width: 860px) {
  .arrange-center { padding: var(--sp-4); }
  .step { flex-wrap: wrap; gap: 10px; }
  .st-actions { width: 100%; padding-left: 42px; }
}
</style>
