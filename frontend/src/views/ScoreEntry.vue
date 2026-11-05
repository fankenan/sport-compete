<template>
  <div class="se-page">
    <!-- 工具条 -->
    <t-card class="se-toolbar">
      <div class="tb-row">
        <t-select
          v-model="filterBand"
          placeholder="全部组别"
          clearable
          style="width: 140px"
          @change="load"
        >
          <t-option v-for="b in bands" :key="b.id" :label="bandLabel(b)" :value="b.id" />
        </t-select>

        <t-select
          v-model="filterEvent"
          placeholder="全部项目"
          clearable
          style="width: 150px"
          @change="load"
        >
          <t-option v-for="e in events" :key="e.id" :label="e.name" :value="e.id" />
        </t-select>

        <t-select
          v-model="filterStage"
          placeholder="全部阶段"
          clearable
          style="width: 130px"
          @change="load"
        >
          <t-option v-for="(v, k) in STAGE_LABEL" :key="k" :label="v" :value="Number(k)" />
        </t-select>

        <t-select
          v-model="filterDate"
          placeholder="全部日期"
          clearable
          style="width: 150px"
          @change="load"
        >
          <t-option v-for="d in dateOptions" :key="d" :label="d" :value="d" />
        </t-select>

        <span class="tb-divider"></span>

        <t-button variant="outline" :loading="loading" @click="load">
          <template #icon><t-icon name="refresh" /></template>
          刷新
        </t-button>

        <t-button theme="primary" :disabled="!dirtyCount" :loading="saving" @click="submitAll">
          提交 {{ dirtyCount }} 场
        </t-button>

        <t-button
          variant="outline"
          theme="success"
          :disabled="!confirmable.length"
          @click="confirmMatches"
        >
          确认 {{ confirmable.length }} 场
        </t-button>
      </div>

      <p class="se-hint">
        成绩统一由管理员录入。填好后点「提交」；确认后的成绩才会出现在大屏和公开查询页。
        <template v-if="filterEvent">
          · 当前项目{{ allowDraw ? '允许平局' : '不允许平局（淘汰赛出现平局会被拦截）' }}
        </template>
      </p>
    </t-card>

    <!-- 统计 -->
    <div class="se-stats">
      <div class="se-stat"><span class="ss-n">{{ rows.length }}</span><span class="ss-l">总场次</span></div>
      <div class="se-stat"><span class="ss-n ok">{{ doneCount }}</span><span class="ss-l">已录分</span></div>
      <div class="se-stat"><span class="ss-n warn">{{ todoCount }}</span><span class="ss-l">待录分</span></div>
      <div class="se-stat"><span class="ss-n">{{ confirmedCount }}</span><span class="ss-l">已确认</span></div>
    </div>

    <!-- 录分表 -->
    <t-card class="se-card">
      <template #header>
        <div class="panel-head">
          <span class="ph-title">比分录入</span>
          <span class="panel-hint">在比分格里直接填数字，回车跳到下一格</span>
        </div>
      </template>

      <div v-if="loading" class="app-empty">加载中…</div>

      <div v-else-if="rows.length === 0" class="app-empty">
        <t-icon name="edit" class="app-empty-icon" />
        没有符合条件的比赛。<br />
        请先到「编排中心」确认赛制与排期。
      </div>

      <div v-else class="table-scroll">
        <table class="se-table">
          <thead>
            <tr>
              <th class="c-seq">场次</th>
              <th class="c-band">组别</th>
              <th class="c-event">项目</th>
              <th class="c-stage">阶段</th>
              <th class="c-time">时间</th>
              <th class="c-venue">场地</th>
              <th class="c-team">队伍 A</th>
              <th class="c-score">比分</th>
              <th class="c-team">队伍 B</th>
              <th class="c-ops">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="m in rows"
              :key="m.id"
              :class="{ dirty: isDirty(m), locked: m.confirmed, pending: !m.team_a_id || !m.team_b_id }"
            >
              <td class="num">{{ m.seq_no }}</td>
              <td>{{ m.band_label }}</td>
              <td>{{ m.event_name }}</td>
              <td>
                <span class="se-stage">{{ m.stage_label }}</span>
              </td>
              <td class="num c-time">
                <template v-if="m.play_date">
                  {{ String(m.play_date).slice(5) }}
                  <span class="se-t">{{ String(m.start_time || '').slice(0, 5) }}</span>
                </template>
                <template v-else><span class="dim">未排期</span></template>
              </td>
              <td class="c-venue">{{ m.venue_name || '—' }}</td>

              <td class="c-team" :class="{ win: m.score_a > m.score_b, lose: m.score_a < m.score_b }">
                {{ m.team_a_name || m.ref_a || '待定' }}
              </td>

              <td class="c-score">
                <template v-if="!m.team_a_id || !m.team_b_id">
                  <span class="se-wait">待定对手</span>
                </template>
                <template v-else>
                  <div class="score-box">
                    <input
                      class="score-in num"
                      type="number"
                      min="0"
                      :value="draft[m.id]?.score_a ?? ''"
                      :disabled="m.confirmed"
                      placeholder="—"
                      @input="onInput(m, 'score_a', $event.target.value)"
                      @keydown.enter.prevent="focusNext(m, 'score_a')"
                    />
                    <span class="score-sep">:</span>
                    <input
                      class="score-in num"
                      type="number"
                      min="0"
                      :value="draft[m.id]?.score_b ?? ''"
                      :disabled="m.confirmed"
                      placeholder="—"
                      @input="onInput(m, 'score_b', $event.target.value)"
                      @keydown.enter.prevent="focusNext(m, 'score_b')"
                    />
                  </div>
                </template>
              </td>

              <td class="c-team" :class="{ win: m.score_b > m.score_a, lose: m.score_b < m.score_a }">
                {{ m.team_b_name || m.ref_b || '待定' }}
              </td>

              <td class="c-ops">
                <template v-if="m.confirmed">
                  <span class="pill-success">已确认</span>
                </template>
                <template v-else-if="!m.team_a_id || !m.team_b_id">
                  <span class="pill-warning">待赛果</span>
                </template>
                <template v-else>
                  <div class="ops-row">
                    <button class="ops-btn" title="主队胜" @click="quickWin(m, 'a')">A 胜</button>
                    <button class="ops-btn" title="主队负" @click="quickWin(m, 'b')">B 胜</button>
                    <button class="ops-btn" title="双方弃权" @click="quickAbandon(m)">弃权</button>
                  </div>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </t-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useUserStore } from '../store/user';
import http from '../api/http';
import { message, confirm } from '../utils/ui';
import { bandLabel } from '../utils/band';

const store = useUserStore();

const STAGE_LABEL = {
  1: '小组赛', 2: '八进四', 3: '半决赛', 4: '排位赛', 5: '决赛', 6: '三四名'
};

const loading = ref(false);
const saving = ref(false);
const bands = ref([]);
const events = ref([]);
const rows = ref([]);
const draft = reactive({});          // match_id -> { score_a, score_b }
const filterBand = ref(null);
const filterEvent = ref(null);
const filterStage = ref(null);
const filterDate = ref(null);
const allowDraw = ref(false);

/** 有多少场被改过但还没提交 */
const dirtyCount = computed(() => {
  let n = 0;
  for (const m of rows.value) {
    if (isDirty(m)) n++;
  }
  return n;
});

const doneCount = computed(() => rows.value.filter((m) => m.status === 1).length);
const todoCount = computed(() => rows.value.filter((m) => m.status !== 1 && m.team_a_id && m.team_b_id).length);
const confirmedCount = computed(() => rows.value.filter((m) => m.confirmed).length);

/** 已录分但还没确认的场次（可确认） */
const confirmable = computed(() => rows.value.filter((m) => m.status === 1 && !m.confirmed));

const dateOptions = computed(() => {
  const s = new Set();
  rows.value.forEach((m) => { if (m.play_date) s.add(m.play_date); });
  return [...s].sort();
});

function isDirty(m) {
  const d = draft[m.id];
  if (!d) return false;
  const origA = m.score_a ?? '';
  const origB = m.score_b ?? '';
  return String(d.score_a ?? '') !== String(origA) || String(d.score_b ?? '') !== String(origB);
}

function onInput(m, field, value) {
  if (!draft[m.id]) draft[m.id] = { score_a: m.score_a ?? '', score_b: m.score_b ?? '' };
  draft[m.id][field] = value === '' ? '' : Number(value);
  // 分数变了就清掉确认状态（本地草稿层面，提交时后端会重置）
  if (m.confirmed) m.confirmed = 0;
}

function quickWin(m, side) {
  const d = draft[m.id] || (draft[m.id] = { score_a: m.score_a ?? '', score_b: m.score_b ?? '' });
  if (side === 'a') { d.score_a = 10; d.score_b = 0; }
  else { d.score_a = 0; d.score_b = 10; }
  m.confirmed = 0;
}

function quickAbandon(m) {
  const d = draft[m.id] || (draft[m.id] = { score_a: m.score_a ?? '', score_b: m.score_b ?? '' });
  d.score_a = 0; d.score_b = 0;
  m.abandon = 1;
  m.confirmed = 0;
}

/** 回车跳到下一场的比分格 */
function focusNext(m, field) {
  const idx = rows.value.findIndex((x) => x.id === m.id);
  for (let i = idx + 1; i < rows.value.length; i++) {
    const next = rows.value[i];
    if (!next.team_a_id || !next.team_b_id) continue;
    const sel = field === 'score_a' ? 'td.c-score .score-in:first-child' : 'td.c-score .score-in:last-child';
    const el = document.querySelectorAll('.se-table tbody tr')[i]?.querySelector(sel);
    if (el) { el.focus(); el.select?.(); return; }
  }
}

async function load() {
  if (!store.competitionId) return;
  loading.value = true;
  try {
    const cid = store.competitionId;
    const [b, e] = await Promise.all([
      http.get('/event/bands', { params: { competition_id: cid } }),
      http.get('/event/items', { params: { competition_id: cid } })
    ]);
    bands.value = Array.isArray(b) ? b : [];
    events.value = Array.isArray(e) ? e : [];

    const params = { competition_id: cid };
    if (filterBand.value) params.band_id = filterBand.value;
    if (filterEvent.value) params.event_item_id = filterEvent.value;
    if (filterStage.value) params.stage = filterStage.value;
    if (filterDate.value) params.play_date = filterDate.value;

    const list = await http.get('/schedule/list', { params });
    rows.value = (Array.isArray(list) ? list : []).map((m) => ({
      ...m,
      stage_label: STAGE_LABEL[m.stage] || `阶段${m.stage}`,
      band_label: m.band_label || '',
      event_name: m.event_name || '',
      confirmed: Number(m.confirmed) === 1
    }));

    // 初始化草稿
    Object.keys(draft).forEach((k) => delete draft[k]);
    rows.value.forEach((m) => {
      draft[m.id] = { score_a: m.score_a ?? '', score_b: m.score_b ?? '' };
    });

    // 读当前项目的积分规则（用于提示）
    if (filterEvent.value) {
      try {
        const cfg = await http.get('/schedule/event-config', { params: { event_item_id: filterEvent.value } });
        allowDraw.value = Number(cfg?.allow_draw) === 1;
      } catch (e) { allowDraw.value = false; }
    } else {
      allowDraw.value = false;
    }
  } catch (e) {
    message.error(e.message);
  } finally {
    loading.value = false;
  }
}

async function submitAll() {
  const dirty = rows.value.filter((m) => isDirty(m) && m.team_a_id && m.team_b_id);
  if (!dirty.length) return;

  // 前端先做一轮校验，避免明显的错误提交到后端
  const bad = [];
  for (const m of dirty) {
    const d = draft[m.id];
    if (d.score_a === '' || d.score_b === '') {
      bad.push(`第 ${m.seq_no} 场比分没填全`);
      continue;
    }
    if (m.stage >= 2 && Number(d.score_a) === Number(d.score_b)) {
      bad.push(`第 ${m.seq_no} 场是${m.stage_label}，不允许平局`);
    }
  }
  if (bad.length) {
    message.warning(`有 ${bad.length} 场需要修正：${bad.slice(0, 2).join('；')}`);
    return;
  }

  saving.value = true;
  try {
    const payload = dirty.map((m) => ({
      match_id: m.id,
      score_a: Number(draft[m.id].score_a),
      score_b: Number(draft[m.id].score_b),
      abandon_a: m.abandon ? 1 : 0,
      abandon_b: 0
    }));
    const r = await http.post('/result/score-batch', { matches: payload });
    message.success(r?.message || '已提交');
    await load();
  } catch (e) {
    message.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function confirmMatches() {
  const ids = confirmable.value.map((m) => m.id);
  if (!ids.length) return;
  try {
    await confirm(`确认 ${ids.length} 场成绩？确认后这些成绩会出现在大屏和公开查询页。`, '确认成绩');
  } catch (e) { return; }
  try {
    const r = await http.post('/result/confirm', { match_ids: ids });
    message.success(r?.message || '已确认');
    await load();
  } catch (e) {
    message.error(e.message);
  }
}

onMounted(load);
watch(() => store.competitionId, load);
</script>

<style scoped>
.se-page {
  max-width: 1440px;
  margin: 0 auto;
  padding: var(--sp-6);
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.se-toolbar { border-radius: var(--radius-l); }

.tb-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tb-divider {
  width: 1px;
  height: 18px;
  background: var(--app-border);
  margin: 0 2px;
}

.se-hint {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--app-text-3);
}

/* ---------- 统计 ---------- */
.se-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--sp-3);
}
@media (max-width: 720px) { .se-stats { grid-template-columns: repeat(2, 1fr); } }

.se-stat {
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-1);
  padding: 13px 16px;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.ss-n {
  font-size: 22px;
  font-weight: 700;
  color: var(--app-text-1);
  font-variant-numeric: tabular-nums;
}
.ss-n.ok { color: var(--app-success); }
.ss-n.warn { color: var(--app-warning); }
.ss-l { font-size: 12px; color: var(--app-text-3); }

/* ---------- 表 ---------- */
.se-card { border-radius: var(--radius-l); }

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.ph-title { font-size: 15px; font-weight: 600; color: var(--app-text-1); }
.panel-hint { font-size: 12px; color: var(--app-text-3); }

.se-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.se-table th {
  text-align: left;
  padding: 9px 12px;
  font-weight: 500;
  font-size: 12px;
  color: var(--app-text-2);
  background: var(--app-surface-2);
  border-bottom: 1px solid var(--app-border);
  white-space: nowrap;
}
.se-table td {
  padding: 7px 12px;
  border-bottom: 1px solid var(--app-border-2);
  color: var(--app-text-1);
  vertical-align: middle;
}
.se-table tbody tr:hover { background: var(--app-bg-2); }
.se-table tbody tr.dirty { background: var(--td-brand-color-light); }
.se-table tbody tr.dirty:hover { background: var(--td-brand-color-focus); }
.se-table tbody tr.locked { opacity: .72; }
.se-table tbody tr.pending td { color: var(--app-text-3); }

.se-table .num { font-variant-numeric: tabular-nums; }
.c-seq { width: 54px; }
.c-band { width: 86px; }
.c-event { width: 96px; }
.c-stage { width: 84px; }
.c-time { width: 96px; white-space: nowrap; }
.c-venue { width: 110px; color: var(--app-text-2); }
.c-team { min-width: 130px; font-weight: 500; }
.c-score { width: 130px; }
.c-ops { width: 150px; }

.se-t { color: var(--app-text-3); margin-left: 4px; }

.se-stage {
  font-size: 11.5px;
  padding: 2px 7px;
  border-radius: var(--radius-xs);
  background: var(--app-bg-2);
  color: var(--app-text-2);
  white-space: nowrap;
}

.win { color: var(--app-success); }
.lose { color: var(--app-text-3); }

.score-box {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.score-in {
  width: 46px;
  height: 28px;
  padding: 0 6px;
  border-radius: var(--radius-s);
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  color: var(--app-text-1);
  font-size: 13px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-family: inherit;
}
.score-in:focus {
  outline: none;
  border-color: var(--td-brand-color);
  box-shadow: 0 0 0 2px var(--td-brand-color-focus);
}
.score-in:disabled {
  background: var(--app-bg-2);
  color: var(--app-text-3);
  cursor: not-allowed;
}
.score-sep { color: var(--app-text-3); font-weight: 600; }

.se-wait { font-size: 11.5px; color: var(--app-text-3); }

.ops-row { display: flex; gap: 4px; }
.ops-btn {
  font: inherit;
  font-size: 11.5px;
  padding: 3px 8px;
  border-radius: var(--radius-xs);
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  color: var(--app-text-2);
  cursor: pointer;
  transition: border-color var(--dur-fast) ease, color var(--dur-fast) ease;
}
.ops-btn:hover {
  border-color: var(--td-brand-color);
  color: var(--td-brand-color);
}
</style>
