<template>
  <div class="lu-page">
    <!-- 头部 -->
    <div class="lu-head">
      <div>
        <h2 class="lu-title">对阵表</h2>
        <p class="lu-sub">
          这里只管「谁跟谁比」，不管「什么时候在哪打」。
          对阵定下来之后，再到「赛程编排」排期。
        </p>
      </div>
      <div class="lu-head-right">
        <t-select
          v-model="filterBand"
          placeholder="全部组别"
          clearable
          style="width: 150px"
          @change="load"
        >
          <t-option v-for="b in bands" :key="b.id" :label="bandLabel(b)" :value="b.id" />
        </t-select>
        <t-select
          v-model="filterEvent"
          placeholder="全部项目"
          clearable
          style="width: 160px"
          @change="load"
        >
          <t-option v-for="e in events" :key="e.id" :label="e.name" :value="e.id" />
        </t-select>
        <t-button variant="outline" :loading="loading" @click="load">
          <template #icon><t-icon name="refresh" /></template>
          刷新
        </t-button>
      </div>
    </div>

    <t-loading :loading="loading" size="small">
      <div v-if="combos.length === 0" class="app-empty">
        <t-icon name="view-list" class="app-empty-icon" />
        还没有生成对阵。<br />
        请先到「分组编排」生成小组赛程，或在「赛程编排」对纯淘汰项目生成对阵树。
      </div>

      <div v-else class="lu-list">
        <t-card v-for="c in combos" :key="`${c.band_id}-${c.event_item_id}`" class="lu-card" header-bordered>
          <template #header>
            <div class="panel-head">
              <div class="ph-left">
                <span class="ph-title">{{ c.event_name }}</span>
                <span class="ph-band">{{ c.band_label }}</span>
                <span class="ph-mode">{{ modeLabel(c.schedule_mode) }}</span>
              </div>
              <div class="ph-right">
                <span class="ph-stat">共 {{ c.total }} 场</span>
                <span class="ph-stat ok">已录 {{ c.done }}</span>
                <span class="ph-stat" :class="{ warn: c.total - c.scheduled > 0 }">
                  已排期 {{ c.scheduled }}
                </span>
              </div>
            </div>
          </template>

          <!-- 进度条：一眼看出还差多少 -->
          <div class="lu-progress">
            <div class="lp-track">
              <i class="lp-done" :style="{ width: pct(c.done, c.total) + '%' }"></i>
              <i class="lp-sched" :style="{ width: pct(c.scheduled, c.total) + '%' }"></i>
            </div>
            <span class="lp-text">
              {{ c.done }}/{{ c.total }} 已录分
              <template v-if="c.total - c.scheduled > 0">
                · {{ c.total - c.scheduled }} 场待排期
              </template>
            </span>
          </div>

          <!-- 小组赛：轮次矩阵 -->
          <div v-for="g in groupStages(c)" :key="g.key" class="lu-group">
            <div class="lg-head">
              <span class="lg-letter">{{ g.group_letter || g.stage_label }}</span>
              <span class="lg-meta">
                {{ g.stage_label }}
                <template v-if="g.rounds.length"> · {{ g.rounds.length }} 轮</template>
              </span>
            </div>

            <!-- 按轮次横向排，像经典的对阵表 -->
            <div class="lg-rounds">
              <div v-for="r in g.rounds" :key="r.round_no" class="lg-round">
                <div class="lr-title">第 {{ r.round_no }} 轮</div>
                <div
                  v-for="m in r.matches"
                  :key="m.id"
                  class="lr-match"
                  :class="{
                    done: m.status === 1,
                    pending: m.status === 0 && !m.scheduled,
                    scheduled: m.status === 0 && m.scheduled
                  }"
                >
                  <div class="lr-row">
                    <span class="lr-name" :class="{ win: m.score_a > m.score_b }">{{ m.team_a }}</span>
                    <span class="lr-score num">{{ m.score_a ?? '-' }}</span>
                  </div>
                  <div class="lr-row">
                    <span class="lr-name" :class="{ win: m.score_b > m.score_a }">{{ m.team_b }}</span>
                    <span class="lr-score num">{{ m.score_b ?? '-' }}</span>
                  </div>
                  <div class="lr-foot">
                    <span class="lr-seq">第 {{ m.seq_no }} 场</span>
                    <span v-if="m.scheduled" class="lr-when">{{ m.play_date }} {{ m.start_time }}</span>
                    <span v-else-if="m.team_a === '待定' || m.team_b === '待定'" class="lr-wait">待赛果</span>
                    <span v-else class="lr-noslot">未排期</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </t-card>
      </div>
    </t-loading>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useUserStore } from '../store/user';
import http from '../api/http';
import { bandLabel } from '../utils/band';

const store = useUserStore();

const loading = ref(false);
const bands = ref([]);
const events = ref([]);
const combos = ref([]);
const filterBand = ref(null);
const filterEvent = ref(null);

const MODE_LABEL = {
  GROUP_KO: '分组循环 + 淘汰',
  KO: '纯淘汰',
  LEAGUE: '联赛循环',
  ROUND: '循环赛排名'
};

function modeLabel(m) {
  return MODE_LABEL[m] || MODE_LABEL.GROUP_KO;
}

function pct(a, b) {
  return b ? Math.min(100, Math.round((a / b) * 100)) : 0;
}

/** 小组赛的小组（按 group_letter 归拢） */
function groupStages(c) {
  return (c.groups || []).filter((g) => g.stage === 1);
}

/** 淘汰赛的轮次（按 round_no 归拢） */
function koStages(c) {
  return (c.groups || []).filter((g) => g.stage !== 1);
}

async function load() {
  if (!store.competitionId) return;
  loading.value = true;
  try {
    const cid = store.competitionId;
    const [b, e, r] = await Promise.all([
      http.get('/event/bands', { params: { competition_id: cid } }),
      http.get('/event/items', { params: { competition_id: cid } }),
      http.get('/schedule/lineup', {
        params: {
          competition_id: cid,
          band_id: filterBand.value || undefined,
          event_item_id: filterEvent.value || undefined
        }
      })
    ]);
    bands.value = Array.isArray(b) ? b : [];
    events.value = Array.isArray(e) ? e : [];
    combos.value = r?.combos || [];
  } catch (e) {
    combos.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => store.competitionId, load);
</script>

<style scoped>
.lu-page {
  max-width: 1440px;
  margin: 0 auto;
  padding: var(--sp-6);
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.lu-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-4);
  flex-wrap: wrap;
}
.lu-title { margin: 0; font-size: var(--fs-20); font-weight: 600; letter-spacing: .2px; color: var(--app-text-1); }
.lu-sub { margin: 4px 0 0; font-size: var(--fs-13); color: var(--app-text-2); max-width: 640px; line-height: 1.6; }
.lu-head-right { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

.lu-list { display: flex; flex-direction: column; gap: var(--sp-4); }
.lu-card { border-radius: var(--radius-l); }

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  flex-wrap: wrap;
}
.ph-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ph-title { font-size: 15px; font-weight: 600; color: var(--app-text-1); }
.ph-band {
  font-size: 11.5px; padding: 2px 8px; border-radius: var(--radius-xs);
  background: var(--td-brand-color-light); color: var(--td-brand-color);
}
.ph-mode {
  font-size: 11.5px; padding: 2px 8px; border-radius: var(--radius-xs);
  background: var(--app-bg-2); color: var(--app-text-2);
}
.ph-right { display: flex; gap: 10px; align-items: center; }
.ph-stat { font-size: 12px; color: var(--app-text-3); font-variant-numeric: tabular-nums; }
.ph-stat.ok { color: var(--app-success); }
.ph-stat.warn { color: var(--app-warning); font-weight: 600; }

/* 进度 */
.lu-progress { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.lp-track {
  position: relative; flex: 1; height: 5px; border-radius: 3px;
  background: var(--app-bg-2); overflow: hidden;
}
.lp-done {
  position: absolute; left: 0; top: 0; height: 100%; border-radius: 3px;
  background: var(--app-success);
}
.lp-sched {
  position: absolute; left: 0; top: 0; height: 100%; border-radius: 3px;
  background: var(--td-brand-color); opacity: .38;
}
.lp-text { font-size: 11.5px; color: var(--app-text-3); white-space: nowrap; }

/* 小组 */
.lu-group { margin-bottom: 16px; }
.lu-group:last-child { margin-bottom: 0; }
.lg-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.lg-letter {
  font-size: 13px; font-weight: 700; color: var(--app-text-1);
  min-width: 44px;
}
.lg-meta { font-size: 12px; color: var(--app-text-3); }

/* 轮次横向排 */
.lg-rounds {
  display: flex;
  gap: var(--sp-3);
  overflow-x: auto;
  padding-bottom: 6px;
  scrollbar-width: thin;
}
.lg-round { flex: 0 0 auto; min-width: 190px; }
.lr-title {
  font-size: 11.5px; color: var(--app-text-2); font-weight: 500;
  margin-bottom: 6px; padding-left: 2px;
}
.lr-match {
  border: 1px solid var(--app-border);
  border-radius: var(--radius-s);
  background: var(--app-surface);
  padding: 7px 9px;
  margin-bottom: 6px;
  transition: border-color var(--dur-fast) ease, background var(--dur-fast) ease;
}
.lr-match.done { background: var(--app-success-light); border-color: transparent; }
.lr-match.scheduled { border-color: var(--td-brand-color-border); }
.lr-match.pending { opacity: .82; }
.lr-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.lr-name { font-size: 12.5px; color: var(--app-text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lr-name.win { color: var(--app-success); font-weight: 600; }
.lr-score { font-size: 12.5px; color: var(--app-text-2); min-width: 22px; text-align: right; }
.lr-foot {
  display: flex; align-items: center; justify-content: space-between;
  gap: 6px; margin-top: 5px; padding-top: 5px;
  border-top: 1px dashed var(--app-border-2);
  font-size: 10.5px; color: var(--app-text-3);
}
.lr-when { color: var(--td-brand-color); font-variant-numeric: tabular-nums; }
.lr-wait { color: var(--app-warning); }
</style>
