<template>
  <div class="my-schedule">
    <!-- 日期选择 -->
    <div class="date-bar">
      <button
        v-for="d in dateOptions"
        :key="d.value"
        class="date-chip"
        :class="{ active: activeDate === d.value }"
        @click="pickDate(d.value)"
      >
        <span class="d-week">{{ d.week }}</span>
        <span class="d-day">{{ d.day }}</span>
      </button>
    </div>

    <!-- 赛程列表 -->
    <div v-if="loading" class="loading-box">加载中…</div>

    <div v-else-if="list.length === 0" class="empty">
      <p class="empty-title">当日暂无赛程</p>
      <p class="empty-sub">请选择其他日期，或等待组委会发布赛程</p>
    </div>

    <div v-else class="match-list">
      <div v-for="m in list" :key="m.id" class="match-card" :class="{ done: m.status === 1 }">
        <div class="mc-head">
          <span class="mc-seq">第 {{ m.seq_no }} 场</span>
          <span class="mc-band">{{ m.band_label }}</span>
          <span class="mc-stage">{{ m.stage_label }}</span>
          <span v-if="m.status === 1" class="mc-done">已录分</span>
        </div>

        <div class="mc-event">
          <span>{{ m.event_name }}</span>
          <span class="mc-when">{{ m.start_time }} · 场地{{ m.venue_no }}</span>
        </div>

        <div class="mc-teams">
          <div class="team" :class="{ win: m.score_a > m.score_b, lose: m.score_a < m.score_b }">
            <span class="t-school">{{ m.school_a }}</span>
            <span class="t-name">{{ m.team_a_name }}</span>
            <span class="t-score">{{ m.score_a ?? '—' }}</span>
          </div>
          <div class="vs">VS</div>
          <div class="team right" :class="{ win: m.score_b > m.score_a, lose: m.score_b < m.score_a }">
            <span class="t-score">{{ m.score_b ?? '—' }}</span>
            <span class="t-name">{{ m.team_b_name }}</span>
            <span class="t-school">{{ m.school_b }}</span>
          </div>
        </div>

        <div v-if="m.status !== 1" class="mc-actions">
          <t-button theme="primary" size="small" @click="openScore(m)">录入比分</t-button>
        </div>
      </div>
    </div>

    <!-- 录比分 -->
    <t-dialog v-model:visible="scoreVisible" header="录入比分" :width="isMobile ? '94%' : '420px'" attach="body">
      <template v-if="current">
        <div class="score-head">
          <div class="sh-team">
            <span class="sh-name">{{ current.team_a_name }}</span>
            <span class="sh-school">{{ current.school_a }}</span>
          </div>
          <span class="sh-vs">VS</span>
          <div class="sh-team right">
            <span class="sh-school">{{ current.school_b }}</span>
            <span class="sh-name">{{ current.team_b_name }}</span>
          </div>
        </div>

        <!-- 快捷结果：点一下就填好胜负，比分仍可手改 -->
        <div class="quick-row">
          <t-button
            size="small"
            :theme="quickResult === 'A' ? 'primary' : 'default'"
            variant="outline"
            @click="pickQuick('A')"
          >
            {{ current.team_a_name || '甲方' }} 胜
          </t-button>
          <t-button
            v-if="allowDraw"
            size="small"
            :theme="quickResult === 'D' ? 'primary' : 'default'"
            variant="outline"
            @click="pickQuick('D')"
          >
            平
          </t-button>
          <t-button
            size="small"
            :theme="quickResult === 'B' ? 'primary' : 'default'"
            variant="outline"
            @click="pickQuick('B')"
          >
            {{ current.team_b_name || '乙方' }} 胜
          </t-button>
          <span class="quick-tip">点一下快速填结果，再点一次取消</span>
        </div>

        <div class="score-inputs">
          <t-input-number
            v-model="scoreForm.score_a"
            :min="0"
            :max="300"
            theme="normal"
            align="center"
            placeholder="0"
            @change="quickResult = ''"
          />
          <span class="si-colon">:</span>
          <t-input-number
            v-model="scoreForm.score_b"
            :min="0"
            :max="300"
            theme="normal"
            align="center"
            placeholder="0"
            @change="quickResult = ''"
          />
        </div>

        <t-checkbox-group v-model="scoreForm.abandon" class="abandon-group">
          <t-checkbox :value="1">左侧弃权</t-checkbox>
          <t-checkbox :value="2">右侧弃权</t-checkbox>
        </t-checkbox-group>

        <p class="abandon-tip">
          弃权判 0 分告负；同一队第二次弃权，其全部比赛成绩作废。
        </p>

        <t-textarea v-model="scoreForm.remark" :autosize="{ minRows: 2 }" placeholder="备注（选填）" />
      </template>

      <template #footer>
        <t-button variant="outline" @click="scoreVisible = false">取消</t-button>
        <t-button theme="primary" @click="submitScore">保存</t-button>
      </template>
    </t-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useUserStore } from '../store/user';
import http from '../api/http';
import { message } from '../utils/ui';

const store = useUserStore();
const isMobile = ref(window.innerWidth <= 768);

const list = ref([]);
const loading = ref(false);
const activeDate = ref('');
const dateOptions = ref([]);

const scoreVisible = ref(false);
const current = ref(null);
const scoreForm = ref({ score_a: 0, score_b: 0, abandon: [], remark: '' });
const quickResult = ref('');   // A / D / B，空表示没用快捷按钮
const allowDraw = ref(true);   // 该项目是否允许平局（篮球为 false）

/**
 * 快捷录结果：只帮着把比分填成能体现胜负的形态，真实比分仍可手改
 * 再点一次当前按钮 = 撤销回 0:0
 */
function pickQuick(kind) {
  if (quickResult.value === kind) {
    quickResult.value = '';
    scoreForm.value.score_a = 0;
    scoreForm.value.score_b = 0;
    return;
  }
  const a = Number(scoreForm.value.score_a) || 0;
  const b = Number(scoreForm.value.score_b) || 0;
  const base = Math.max(a, b);

  if (kind === 'A') {
    scoreForm.value.score_a = base < 1 ? 2 : (a > b ? a : b + 1);
    scoreForm.value.score_b = base < 1 ? 0 : b;
  } else if (kind === 'B') {
    scoreForm.value.score_b = base < 1 ? 2 : (b > a ? b : a + 1);
    scoreForm.value.score_a = base < 1 ? 0 : a;
  } else {
    const v = base || 1;
    scoreForm.value.score_a = v;
    scoreForm.value.score_b = v;
  }
  quickResult.value = kind;
}

const weekMap = ['日', '一', '二', '三', '四', '五', '六'];

/** 生成最近一周的日期选项 */
function buildDateOptions() {
  const opts = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    opts.push({
      value,
      week: i === 0 ? '今天' : `周${weekMap[d.getDay()]}`,
      day: `${d.getMonth() + 1}/${d.getDate()}`
    });
  }
  dateOptions.value = opts;
  if (!activeDate.value) activeDate.value = opts[0].value;
}

function pickDate(d) {
  activeDate.value = d;
  load();
}

async function load() {
  loading.value = true;
  try {
    const params = {};
    if (activeDate.value) params.date = activeDate.value;
    list.value = await http.get('/result/my-schedule', { params });
  } catch (e) {
    message.error(e.message);
    list.value = [];
  } finally {
    loading.value = false;
  }
}

async function openScore(m) {
  current.value = m;
  scoreForm.value = { score_a: 0, score_b: 0, abandon: [], remark: '' };
  quickResult.value = '';
  allowDraw.value = true;
  scoreVisible.value = true;

  // 读项目赛制：篮球等不允许平局的项目不显示「平」
  if (m.event_item_id) {
    try {
      const cfg = await http.get('/schedule/event-config', {
        params: { event_item_id: m.event_item_id }
      });
      allowDraw.value = Number(cfg?.allow_draw) !== 0;
    } catch (e) { /* 读不到就按允许平局处理 */ }
  }
}

async function submitScore() {
  try {
    const r = await http.post('/result/score', {
      match_id: current.value.id,
      score_a: scoreForm.value.score_a,
      score_b: scoreForm.value.score_b,
      abandon_a: scoreForm.value.abandon.includes(1) ? 1 : 0,
      abandon_b: scoreForm.value.abandon.includes(2) ? 1 : 0,
      remark: scoreForm.value.remark
    });

    let msg = '比分已录入';
    if (r.voided) msg = '比分已录入（该队 2 次弃权，成绩作废）';
    else if (r.advanced) msg = '比分已录入，已自动生成下一阶段赛程';
    message.success(msg);

    scoreVisible.value = false;
    load();
  } catch (e) {
    message.error(e.message);
  }
}

onMounted(() => { buildDateOptions(); load(); });
watch(() => store.competitionId, load);
</script>

<style scoped>
.my-schedule {
  padding-bottom: 4px;
}

.date-bar {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 10px;
  margin-bottom: 4px;
  scrollbar-width: none;
}

.date-bar::-webkit-scrollbar {
  display: none;
}

.date-chip {
  flex-shrink: 0;
  min-width: 60px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: 8px;
  padding: 8px 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  -webkit-tap-highlight-color: transparent;
}

.date-chip.active {
  background: var(--td-brand-color);
  border-color: var(--td-brand-color);
}

.d-week {
  font-size: 11px;
  color: var(--app-text-3);
  line-height: 1.2;
}

.d-day {
  font-size: 15px;
  font-weight: 500;
  color: var(--app-text-1);
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.date-chip.active .d-week {
  color: rgba(255, 255, 255, 0.75);
}

.date-chip.active .d-day {
  color: #fff;
}

.loading-box {
  text-align: center;
  padding: 40px 0;
  color: var(--app-text-3);
  font-size: 13px;
}

.empty {
  text-align: center;
  padding: 60px 20px;
}

.empty-title {
  margin: 0 0 6px;
  font-size: 14px;
  color: var(--app-text-2);
}

.empty-sub {
  margin: 0;
  font-size: 12px;
  color: var(--app-text-3);
}

.match-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.match-card {
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: 10px;
  padding: 12px 14px;
}

.match-card.done {
  background: var(--app-bg-2);
}

.mc-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.mc-seq {
  font-size: 11px;
  color: #fff;
  background: #8b8b8b;
  border-radius: 3px;
  padding: 1px 6px;
}

.mc-band {
  font-size: 12px;
  color: var(--td-brand-color);
  font-weight: 500;
}

.mc-stage {
  font-size: 11px;
  color: var(--app-text-3);
}

.mc-done {
  margin-left: auto;
  font-size: 11px;
  color: var(--app-success);
}

.mc-event {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
  color: var(--app-text-2);
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--app-border-2);
}

.mc-when {
  font-size: 12px;
  color: var(--app-text-3);
  flex-shrink: 0;
}

.mc-teams {
  display: flex;
  align-items: stretch;
  gap: 10px;
}

.team {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.team.right {
  align-items: flex-end;
  text-align: right;
}

.t-school {
  font-size: 11px;
  color: var(--app-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.t-name {
  font-size: 15px;
  color: var(--app-text-1);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.team.win .t-name {
  color: var(--app-success);
}

.team.lose .t-name {
  color: var(--app-text-2);
}

.t-score {
  font-size: 20px;
  font-weight: 500;
  color: var(--app-text-1);
  font-variant-numeric: tabular-nums;
  margin-top: 2px;
  line-height: 1.2;
}

.team.win .t-score {
  color: var(--app-success);
}

.team.lose .t-score {
  color: var(--app-text-3);
}

.vs {
  align-self: center;
  font-size: 11px;
  color: var(--app-text-3);
  flex-shrink: 0;
}

.mc-actions {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}

/* 录比分弹窗 */
.score-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}

.sh-team {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.sh-team.right {
  align-items: flex-end;
  text-align: right;
}

.sh-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--app-text-1);
}

.sh-school {
  font-size: 11px;
  color: var(--app-text-3);
}

.sh-vs {
  font-size: 12px;
  color: var(--app-text-3);
}

.quick-row {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.quick-tip {
  font-size: 11px;
  color: var(--app-text-3);
  margin-left: 2px;
}

.score-inputs {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 16px;
}

.score-inputs :deep(.t-input-number) {
  width: 96px;
}

.score-inputs :deep(.t-input) {
  height: 48px;
}

.score-inputs :deep(.t-input__inner) {
  text-align: center;
  font-size: 22px;
  font-weight: 500;
  height: 46px;
}

.si-colon {
  font-size: 20px;
  color: var(--app-text-3);
}

.abandon-group {
  display: flex;
  gap: 16px;
  margin-bottom: 6px;
}

.abandon-tip {
  font-size: 11px;
  color: var(--app-warning);
  margin: 0 0 14px;
  line-height: 1.6;
}

@media (max-width: 768px) {
  .sh-name {
    font-size: 13px;
  }

  .t-name {
    font-size: 14px;
  }

  .t-score {
    font-size: 20px;
  }
}
</style>
