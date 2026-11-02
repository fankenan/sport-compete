<template>
  <div class="bp-page">
    <div class="bp-bg"></div>

    <header class="bp-head">
      <div class="bp-head-left">
        <p class="bp-kicker">对阵与比分</p>
        <h1>{{ compName || '球类项目' }}</h1>
      </div>
      <div class="bp-head-right">
        <button class="bp-tool" @click="load(true)">刷新</button>
      </div>
    </header>

    <div v-if="combos.length" class="bp-tabs">
      <button
        v-for="b in bandTabs" :key="b.key"
        class="bp-tab" :class="{ on: bandKey === b.key }"
        @click="bandKey = b.key"
      >{{ b.label }}</button>
    </div>
    <div v-if="eventTabs.length > 1" class="bp-tabs sub">
      <button
        v-for="e in eventTabs" :key="e.key"
        class="bp-tab ev" :class="{ on: eventKey === e.key }"
        @click="eventKey = e.key"
      >{{ e.label }}</button>
    </div>

    <div v-if="loading" class="bp-empty">加载中…</div>
    <div v-else-if="!combos.length" class="bp-empty">
      当前赛事还没有球类比赛的场次。<br />
      请先到「分组编排」建组，再到「赛程编排」生成赛程。
    </div>

    <template v-else>
      <!-- 进度 -->
      <div class="bp-progress">
        <span class="bp-pl">小组赛 <b>{{ groupDone }}/{{ groupTotal }}</b></span>
        <span class="bp-bar"><i :style="{ width: groupPct + '%' }"></i></span>
        <span class="bp-pl">淘汰赛 <b>{{ koDone }}/{{ koTotal }}</b></span>
        <span class="bp-bar"><i :style="{ width: koPct + '%' }"></i></span>
        <span v-if="champion" class="bp-champ">冠军 {{ champion }}</span>
      </div>

      <!-- 小组赛 -->
      <section v-if="groupGroups.length" class="bp-section">
        <div class="bp-sec-head">
          <span class="bp-sec-title">小组赛</span>
          <span class="bp-sec-tip">点任意一场填写比分；全部打完后自动生成淘汰赛对阵</span>
        </div>
        <div class="bp-groups">
          <div v-for="g in groupGroups" :key="g.id" class="bp-group">
            <div class="bp-group-head">{{ g.label }}<span>{{ g.matches.length }} 场</span></div>
            <div
              v-for="m in g.matches" :key="m.id"
              class="bp-mrow" :class="{ done: m.status === 1 }"
              @click="openScore(m)"
            >
              <span class="bp-t" :class="{ win: isWin(m,'a'), lose: isLose(m,'a') }">{{ m.team_a_name || '待定' }}</span>
              <span class="bp-sc">{{ m.status === 1 ? `${m.score_a} : ${m.score_b}` : '— : —' }}</span>
              <span class="bp-t right" :class="{ win: isWin(m,'b'), lose: isLose(m,'b') }">{{ m.team_b_name || '待定' }}</span>
              <span class="bp-meta">{{ m.venue_name || m.play_date || '' }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 淘汰赛 -->
      <section v-if="koRounds.length" ref="koRef" class="bp-section bp-ko" :class="{ 'is-full': isFull }">
        <div class="bp-sec-head">
          <span class="bp-sec-title">淘汰赛</span>
          <span class="bp-sec-tip">点卡片填比分，本轮全部完成后自动晋级下一轮</span>
          <span class="bp-zoombar">
            <button class="bp-zb" title="缩小（Ctrl + 滚轮）" @click="zoomBy(-1)">−</button>
            <span class="bp-zv">{{ zoomPct }}%</span>
            <button class="bp-zb" title="放大（Ctrl + 滚轮）" @click="zoomBy(1)">＋</button>
            <button class="bp-zb wide" title="缩放到刚好铺满可视宽度" @click="fitZoom">适应</button>
            <button class="bp-zb wide" title="恢复原始大小" @click="resetZoom">1:1</button>
            <button class="bp-zb wide" :title="isFull ? '退出全屏（Esc）' : '全屏查看'" @click="toggleFull">
              {{ isFull ? '退出全屏' : '全屏' }}
            </button>
          </span>
        </div>
        <div
          ref="vpRef"
          class="bp-viewport"
          :class="{ panning }"
          @wheel="onWheel"
          @pointerdown="onPanStart"
          @pointermove="onPanMove"
          @pointerup="onPanEnd"
          @pointercancel="onPanEnd"
        >
          <div class="bp-zoom" :style="{ width: lay.width * zoom + 'px', height: lay.height * zoom + 'px' }">
          <div
            class="bp-bracket"
            :style="{
              width: lay.width + 'px', height: lay.height + 'px',
              transform: `scale(${zoom})`
            }"
          >
            <div
              v-for="(r, i) in koRounds" :key="'h' + i"
              class="bp-rh" :style="{ left: i * COL_STEP + 'px' }"
            >
              <b>{{ r.label }}</b>
            </div>
            <svg class="bp-links" :width="lay.width" :height="lay.height" :viewBox="`0 0 ${lay.width} ${lay.height}`">
              <path v-for="(p, i) in lay.links" :key="'p' + i" :d="p.d" :class="['bp-pk', { gold: p.final }]" />
            </svg>
            <div
              v-for="c in lay.cards" :key="'c' + c.id"
              class="bp-m"
              :class="{
                pre: c.round === 0,
                done: c.status === 1,
                winnable: c.status !== 1 && c.has_both !== false,
                pending: c.has_both === false
              }"
              :style="{ left: c.x + 'px', top: c.y + 'px' }"
              @click="openScore(c)"
            >
              <div class="bp-no">{{ c.seq_no }}</div>
              <div class="bp-ts">
                <div class="bp-t" :class="{ win: isWin(c,'a'), lose: isLose(c,'a') }">{{ c.team_a || '待定' }}</div>
                <div class="bp-t" :class="{ win: isWin(c,'b'), lose: isLose(c,'b') }">{{ c.team_b || '待定' }}</div>
              </div>
              <div class="bp-vn">
                <b v-if="c.status === 1" class="sc">{{ c.score_a }}:{{ c.score_b }}</b>
                <b v-else class="sc dim">填分</b>
                <span>{{ c.start_time || '' }}</span>
              </div>
            </div>
            <div v-if="champion" class="bp-cup" :style="{ left: lay.champX + 'px', top: lay.champY + 'px' }">冠军</div>
          </div>
          </div>
        </div>
      </section>
    </template>

    <!-- 录分弹窗（全屏时挂到全屏容器内，否则原生全屏下会被挡在外层不可见） -->
    <Teleport :to="dialogTarget">
    <div v-if="editing" class="bp-mask" @click.self="closeScore">
      <div class="bp-dialog">
        <div class="bp-dlg-head">
          <span>第 {{ editing.seq_no }} 场 · {{ editing.stage_label || '' }}</span>
          <span class="bp-x" @click="closeScore">✕</span>
        </div>
        <div class="bp-dlg-meta">{{ editing.play_date || '' }} {{ editing.start_time || '' }} {{ editing.venue_name || '' }}</div>

        <div class="bp-score-row">
          <div class="bp-side">
            <div class="bp-team-name" :class="{ win: Number(scoreA) > Number(scoreB) }">{{ editing.team_a_name || '待定' }}</div>
            <input v-model.number="scoreA" type="number" min="0" class="bp-num" :disabled="abandonB" />
            <label class="bp-abandon"><input type="checkbox" v-model="abandonA" /> 弃权</label>
          </div>
          <div class="bp-vs">:</div>
          <div class="bp-side">
            <div class="bp-team-name" :class="{ win: Number(scoreB) > Number(scoreA) }">{{ editing.team_b_name || '待定' }}</div>
            <input v-model.number="scoreB" type="number" min="0" class="bp-num" :disabled="abandonA" />
            <label class="bp-abandon"><input type="checkbox" v-model="abandonB" /> 弃权</label>
          </div>
        </div>

        <input v-model="remark" class="bp-remark" placeholder="备注（选填）" maxlength="100" />

        <div class="bp-dlg-foot">
          <button class="bp-btn" @click="closeScore">取消</button>
          <button class="bp-btn primary" :disabled="saving" @click="saveScore">
            {{ saving ? '保存中…' : '保存比分' }}
          </button>
        </div>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { MessagePlugin } from 'tdesign-vue-next';
import http from '../api/http';
import { useUserStore } from '../store/user';

const store = useUserStore();

const CARD_W = 200;
const CARD_H = 66;
const GAP_X = 46;
const COL_STEP = CARD_W + GAP_X;
const ROW_H = 76;
const HEAD = 42;

const loading = ref(true);
const combos = ref([]);
const compName = ref('');
const bandKey = ref('');
const eventKey = ref('');
const allMatches = ref([]);
const bandTabsData = ref([]);

const editing = ref(null);
const scoreA = ref(0);
const scoreB = ref(0);
const abandonA = ref(false);
const abandonB = ref(false);
const remark = ref('');
const saving = ref(false);

/* ---------------- 缩放 / 全屏 ---------------- */
const koRef = ref(null);
const vpRef = ref(null);
const zoom = ref(1);
const isFull = ref(false);
const pseudoFull = ref(false);   // 浏览器不支持原生全屏时的兜底
const panning = ref(false);
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.15;

const zoomPct = computed(() => Math.round(zoom.value * 100));
// 原生全屏时只有全屏元素内部的节点会显示，弹窗必须挂进去
const dialogTarget = computed(() => (isFull.value && koRef.value ? koRef.value : 'body'));

/** 以某个锚点（视口内的相对位置）为中心缩放，缩放后该点保持在原处 */
function applyZoom(next, anchor) {
  const vp = vpRef.value;
  const z0 = zoom.value;
  const z1 = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 100) / 100));
  if (z1 === z0) return;

  let cx = vp ? vp.clientWidth / 2 : 0;
  let cy = vp ? vp.clientHeight / 2 : 0;
  if (anchor && vp) {
    const r = vp.getBoundingClientRect();
    cx = anchor.x - r.left;
    cy = anchor.y - r.top;
  }
  const px = vp ? (vp.scrollLeft + cx) / z0 : 0;
  const py = vp ? (vp.scrollTop + cy) / z0 : 0;

  zoom.value = z1;
  nextTick(() => {
    const v = vpRef.value;
    if (!v) return;
    v.scrollLeft = px * z1 - cx;
    v.scrollTop = py * z1 - cy;
  });
}

function zoomBy(dir) {
  applyZoom(zoom.value + dir * ZOOM_STEP);
}

function resetZoom() {
  applyZoom(1);
  nextTick(() => {
    if (vpRef.value) { vpRef.value.scrollLeft = 0; vpRef.value.scrollTop = 0; }
  });
}

function fitZoom() {
  const vp = vpRef.value;
  if (!vp || !lay.value.width) return;
  const w = vp.clientWidth - 24;
  applyZoom(Math.max(MIN_ZOOM, Math.min(1, w / lay.value.width)));
  nextTick(() => {
    if (vpRef.value) { vpRef.value.scrollLeft = 0; vpRef.value.scrollTop = 0; }
  });
}

function onWheel(e) {
  if (!e.ctrlKey && !e.metaKey) return;   // 普通滚轮保持滚动
  e.preventDefault();
  applyZoom(zoom.value + (e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP), { x: e.clientX, y: e.clientY });
}

/* 空白处按住拖动平移 */
let drag = null;
function onPanStart(e) {
  if (e.button !== 0) return;
  if (e.target.closest('.bp-m')) return;   // 卡片留给点击录分
  const vp = vpRef.value;
  if (!vp) return;
  drag = { x: e.clientX, y: e.clientY, l: vp.scrollLeft, t: vp.scrollTop };
  panning.value = true;
  try { vp.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
}
function onPanMove(e) {
  if (!drag) return;
  const vp = vpRef.value;
  if (!vp) return;
  vp.scrollLeft = drag.l - (e.clientX - drag.x);
  vp.scrollTop = drag.t - (e.clientY - drag.y);
}
function onPanEnd() {
  drag = null;
  panning.value = false;
}

const canNativeFull = () =>
  typeof document !== 'undefined' &&
  !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);

async function toggleFull() {
  const el = koRef.value;
  if (!el) return;
  if (!isFull.value) {
    if (canNativeFull()) {
      try {
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        await req.call(el);
      } catch (err) {
        pseudoFull.value = true;
        isFull.value = true;
      }
    } else {
      pseudoFull.value = true;
      isFull.value = true;
    }
  } else {
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch (err) { /* ignore */ }
    }
    pseudoFull.value = false;
    isFull.value = false;
  }
  nextTick(() => { if (isFull.value) fitZoom(); });
}

function onFsChange() {
  const native = !!document.fullscreenElement && document.fullscreenElement === koRef.value;
  isFull.value = native || pseudoFull.value;
  if (isFull.value) nextTick(fitZoom);
}

function onKeyDown(e) {
  if (e.key === 'Escape' && pseudoFull.value) {
    pseudoFull.value = false;
    isFull.value = false;
  }
}

const bandTabs = computed(() => {
  const m = new Map();
  for (const c of combos.value) {
    const k = String(c.band_id);
    if (!m.has(k)) m.set(k, { key: k, label: c.band_label || '未命名组别' });
  }
  return [...m.values()];
});

const eventTabs = computed(() => {
  const m = new Map();
  for (const c of combos.value) {
    if (String(c.band_id) !== bandKey.value) continue;
    const k = String(c.event_item_id);
    if (!m.has(k)) m.set(k, { key: k, label: c.event_name });
  }
  return [...m.values()];
});

const current = computed(() =>
  combos.value.find((c) => String(c.band_id) === bandKey.value && String(c.event_item_id) === eventKey.value) || null);

/** 当前组合的全部比赛（含小组赛） */
const currentMatches = computed(() =>
  allMatches.value.filter(
    (m) => String(m.band_id) === bandKey.value && String(m.event_item_id) === eventKey.value));

const groupMatches = computed(() => currentMatches.value.filter((m) => Number(m.stage) === 1));

/** 小组赛按 heat_group_id 分组 */
const groupGroups = computed(() => {
  const map = new Map();
  for (const m of groupMatches.value) {
    const k = m.heat_group_id || 0;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(m);
  }
  const keys = [...map.keys()].sort((a, b) => a - b);
  return keys.map((k, i) => ({
    id: k,
    label: keys.length > 1 ? `${String.fromCharCode(65 + (i % 26))} 组` : '本组',
    matches: map.get(k).sort((a, b) => a.seq_no - b.seq_no)
  }));
});

const koRounds = computed(() => {
  if (!current.value) return [];
  return (current.value.rounds || []).filter((r) => r.stage !== 6);
});
const champion = computed(() => current.value?.champion || '');

const groupTotal = computed(() => groupMatches.value.length);
const groupDone = computed(() => groupMatches.value.filter((m) => Number(m.status) === 1).length);
const groupPct = computed(() => (groupTotal.value ? Math.round((groupDone.value / groupTotal.value) * 100) : 0));

const koTotal = computed(() => koRounds.value.reduce((s, r) => s + r.matches.length, 0));
const koDone = computed(() => koRounds.value.reduce((s, r) => s + r.matches.filter((m) => m.status === 1).length, 0));
const koPct = computed(() => (koTotal.value ? Math.round((koDone.value / koTotal.value) * 100) : 0));

const lay = computed(() => {
  const rounds = koRounds.value;
  const empty = { cards: [], links: [], width: 300, height: 220, champX: 0, champY: 0 };
  if (!rounds.length) return empty;

  const cards = [];
  rounds.forEach((r, ri) => {
    r.matches.forEach((m, i) => {
      cards.push({
        ...m,
        round: ri,
        x: ri * COL_STEP,
        y: HEAD + (i + 0.5) * (ROW_H * Math.pow(2, ri)) - CARD_H / 2
      });
    });
  });

  const links = [];
  for (let ri = 0; ri < rounds.length - 1; ri++) {
    rounds[ri].matches.forEach((m, i) => {
      const x1 = ri * COL_STEP + CARD_W;
      const y1 = HEAD + (i + 0.5) * (ROW_H * Math.pow(2, ri));
      const t = Math.floor(i / 2);
      const x2 = (ri + 1) * COL_STEP;
      const y2 = HEAD + (t + 0.5) * (ROW_H * Math.pow(2, ri + 1));
      links.push({ d: `M${x1},${y1} C${x1 + 24},${y1} ${x2 - 24},${y2} ${x2},${y2}`, final: ri === rounds.length - 2 });
    });
  }

  const firstCount = rounds[0].matches.length;
  const champX = (rounds.length - 1) * COL_STEP + CARD_W + 24;
  const champY = HEAD + (0.5 * (ROW_H * Math.pow(2, rounds.length - 1))) - CARD_H / 2;
  return {
    cards, links,
    width: (champion.value ? champX + CARD_W : rounds.length * COL_STEP),
    height: HEAD + firstCount * ROW_H,
    champX, champY
  };
});

function isWin(m, side) {
  if (Number(m.status) !== 1) return false;
  const a = Number(m.score_a), b = Number(m.score_b);
  if (m.abandon_a && !m.abandon_b) return side === 'b';
  if (m.abandon_b && !m.abandon_a) return side === 'a';
  return side === 'a' ? a > b : b > a;
}
function isLose(m, side) {
  if (Number(m.status) !== 1) return false;
  const a = Number(m.score_a), b = Number(m.score_b);
  if (m.abandon_a && !m.abandon_b) return side === 'a';
  if (m.abandon_b && !m.abandon_a) return side === 'b';
  return side === 'a' ? a < b : b < a;
}

function openScore(m) {
  // 纯淘汰预生成的占位场次：双方还是「待定」，等上一轮赛果
  if (m.has_both === false || (!m.team_a_name && !m.team_b_name)) {
    MessagePlugin.warning('对阵双方尚未确定，等上一轮赛果出来后再录分');
    return;
  }
  editing.value = m;
  scoreA.value = m.score_a ?? 0;
  scoreB.value = m.score_b ?? 0;
  abandonA.value = !!m.abandon_a;
  abandonB.value = !!m.abandon_b;
  remark.value = m.remark || '';
}

function closeScore() {
  editing.value = null;
}

async function saveScore() {
  if (!editing.value) return;
  if (!abandonA.value && !abandonB.value && scoreA.value === scoreB.value) {
    MessagePlugin.warning('比分不能相同（如需判平局请按项目规则处理，或标记弃权）');
    return;
  }
  saving.value = true;
  try {
    const r = await http.post('/result/score', {
      match_id: editing.value.id,
      score_a: scoreA.value,
      score_b: scoreB.value,
      abandon_a: abandonA.value,
      abandon_b: abandonB.value,
      remark: remark.value || undefined
    });
    const msg = r?.voided
      ? '比分已录入（该队 2 次弃权，全部成绩作废）'
      : (r?.advanced ? `比分已录入，${r.advancedTo ? '已晋级到 ' + r.advancedTo : '本轮已完成并晋级'}！` : '比分已录入');
    MessagePlugin.success(msg);
    closeScore();
    await load();
  } catch (e) {
    MessagePlugin.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function load(showTip) {
  loading.value = true;
  try {
    const cid = store.competitionId;
    if (!cid) return;
    const [brk, ms] = await Promise.all([
      http.get('/schedule/bracket-all', { params: { competition_id: cid } }),
      http.get('/result/matches', { params: { competition_id: cid } })
    ]);
    combos.value = Array.isArray(brk) ? brk : [];
    allMatches.value = Array.isArray(ms) ? ms : [];

    if (!compName.value) {
      const list = await http.get('/competition/list').catch(() => []);
      const c = (list || []).find((x) => Number(x.id) === Number(cid));
      compName.value = c?.name || '';
    }

    if (!bandKey.value && bandTabs.value.length) bandKey.value = bandTabs.value[0].key;
    if (showTip) MessagePlugin.success('已刷新');
  } catch (e) {
    MessagePlugin.error(e.message);
  } finally {
    loading.value = false;
  }
}

watch(bandKey, () => {
  if (eventTabs.value.length) eventKey.value = eventTabs.value[0].key;
});

// 切组别/项目后对阵尺寸变了，全屏状态下重新铺满
watch([bandKey, eventKey], () => {
  if (isFull.value) nextTick(fitZoom);
});

onMounted(() => {
  load();
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  window.addEventListener('keydown', onKeyDown);
});

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFsChange);
  document.removeEventListener('webkitfullscreenchange', onFsChange);
  window.removeEventListener('keydown', onKeyDown);
  if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); }
});
</script>

<style scoped>
.bp-page {
  --tx: #e9efff; --dm: #8494b5; --card: rgba(255,255,255,.07); --cb: rgba(150,180,255,.24);
  --cy: #2ee6d6; --pu: #9b5cff; --gd: #ffc531;
  position: relative; min-height: 100vh; padding: 0 0 40px;
  background: #05070e; color: var(--tx); overflow-x: hidden;
  font-family: "HarmonyOS Sans SC", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
}
.bp-bg {
  position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background:
    radial-gradient(900px 620px at 10% -12%, rgba(46,230,214,.15), transparent 62%),
    radial-gradient(820px 600px at 92% -6%, rgba(155,92,255,.18), transparent 62%),
    radial-gradient(1100px 700px at 50% 118%, rgba(255,197,49,.08), transparent 62%);
}
.bp-head, .bp-tabs, .bp-progress, .bp-section, .bp-empty { position: relative; z-index: 1; }

.bp-head { display: flex; justify-content: space-between; align-items: flex-end; padding: 22px 30px 6px; }
.bp-kicker { font-size: 11.5px; letter-spacing: .34em; color: var(--cy); margin: 0 0 6px; }
.bp-head h1 { font-size: 24px; font-weight: 700; margin: 0; letter-spacing: .04em; }
.bp-tool {
  appearance: none; border: 1px solid var(--cb); background: rgba(255,255,255,.04);
  color: var(--dm); font: inherit; font-size: 12.5px; padding: 6px 16px;
  border-radius: 999px; cursor: pointer; transition: .2s;
}
.bp-tool:hover { color: #fff; border-color: rgba(46,230,214,.5); }

.bp-tabs { display: flex; gap: 9px; flex-wrap: wrap; padding: 10px 30px 0; }
.bp-tabs.sub { padding-top: 8px; margin-bottom: 4px; }
.bp-tab {
  appearance: none; border: 1px solid var(--cb); background: rgba(255,255,255,.03);
  color: var(--dm); font: inherit; font-size: 13px; padding: 7px 18px;
  border-radius: 999px; cursor: pointer; transition: .2s;
}
.bp-tab:hover { color: #fff; border-color: rgba(46,230,214,.5); }
.bp-tab.on {
  color: #04121a; font-weight: 700; border-color: transparent;
  background: linear-gradient(120deg, #2ee6d6, #5eead4);
  box-shadow: 0 8px 24px -10px rgba(46,230,214,.8);
}
.bp-tab.ev.on {
  background: linear-gradient(120deg, #9b5cff, #c4a2ff); color: #0b0424;
  box-shadow: 0 8px 24px -10px rgba(155,92,255,.8);
}

.bp-progress {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin: 14px 30px 0; padding: 10px 16px; border-radius: 10px;
  border: 1px solid var(--cb); background: rgba(255,255,255,.035); font-size: 12px; color: var(--dm);
}
.bp-pl b { color: var(--tx); font-size: 13px; }
.bp-bar { width: 110px; height: 5px; border-radius: 3px; background: rgba(140,170,255,.16); overflow: hidden; }
.bp-bar i { display: block; height: 100%; background: linear-gradient(90deg, #2ee6d6, #5eead4); }
.bp-champ {
  margin-left: auto; color: #ffd873; border: 1px solid rgba(255,197,49,.4);
  background: rgba(255,197,49,.09); border-radius: 999px; padding: 3px 12px; font-size: 12px;
}

.bp-section { padding: 18px 30px 0; }
.bp-sec-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 10px; }
.bp-sec-title { font-size: 14px; font-weight: 700; letter-spacing: .1em; color: #a9b8d8; }
.bp-sec-tip { font-size: 11.5px; color: #6b7b9c; }

.bp-groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 12px; }
.bp-group { border: 1px solid var(--cb); border-radius: 10px; background: rgba(255,255,255,.03); overflow: hidden; }
.bp-group-head {
  display: flex; justify-content: space-between; padding: 8px 12px;
  font-size: 12px; font-weight: 700; letter-spacing: .12em; color: #a9b8d8;
  background: rgba(140,170,255,.07); border-bottom: 1px solid rgba(140,170,255,.12);
}
.bp-group-head span { font-weight: 400; color: #6b7b9c; letter-spacing: 0; }

.bp-mrow {
  display: grid; grid-template-columns: 1fr 64px 1fr 66px;
  align-items: center; gap: 6px; padding: 7px 12px;
  font-size: 12.5px; cursor: pointer; transition: background .15s;
}
.bp-mrow + .bp-mrow { border-top: 1px solid rgba(140,170,255,.07); }
.bp-mrow:hover { background: rgba(46,230,214,.07); }
.bp-mrow .bp-t.right { text-align: right; }
.bp-sc {
  text-align: center; font-variant-numeric: tabular-nums; color: #7f90b3;
  border: 1px dashed rgba(140,170,255,.22); border-radius: 5px; padding: 1px 0; font-size: 12px;
}
.bp-mrow.done .bp-sc { color: var(--tx); border-style: solid; border-color: rgba(140,170,255,.3); }
.bp-meta { font-size: 10.5px; color: #5d6b88; text-align: right; }

/* ---------- 淘汰赛视口：缩放 / 平移 / 全屏 ---------- */
.bp-ko .bp-sec-head { align-items: center; flex-wrap: wrap; row-gap: 8px; }
.bp-zoombar { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.bp-zb {
  appearance: none; border: 1px solid var(--cb); background: rgba(255,255,255,.04);
  color: var(--dm); font: inherit; font-size: 12px; line-height: 1;
  min-width: 26px; height: 26px; padding: 0 8px; border-radius: 7px;
  cursor: pointer; transition: .18s;
}
.bp-zb.wide { padding: 0 11px; }
.bp-zb:hover { color: #fff; border-color: rgba(46,230,214,.5); background: rgba(46,230,214,.12); }
.bp-zv {
  min-width: 46px; text-align: center; font-size: 12px; color: #a9b8d8;
  font-variant-numeric: tabular-nums;
}

.bp-viewport {
  position: relative; overflow: auto; max-height: 64vh;
  padding: 4px 0 14px; cursor: grab; touch-action: pan-x pan-y;
}
.bp-viewport.panning { cursor: grabbing; user-select: none; }
.bp-viewport::-webkit-scrollbar { width: 8px; height: 8px; }
.bp-viewport::-webkit-scrollbar-thumb { background: rgba(140,170,255,.25); border-radius: 4px; }
.bp-viewport::-webkit-scrollbar-corner { background: transparent; }
.bp-zoom { position: relative; }
.bp-bracket { position: absolute; left: 0; top: 0; transform-origin: 0 0; }

/* 全屏（原生全屏与兜底模式共用同一套布局） */
.bp-ko.is-full {
  position: fixed; inset: 0; z-index: 900; margin: 0;
  display: flex; flex-direction: column; overflow: hidden;
  padding: 16px 24px 18px; border-radius: 0;
  background:
    radial-gradient(900px 620px at 10% -12%, rgba(46,230,214,.15), transparent 62%),
    radial-gradient(820px 600px at 92% -6%, rgba(155,92,255,.18), transparent 62%),
    #05070e;
}
.bp-ko.is-full .bp-sec-head { flex: 0 0 auto; }
.bp-ko.is-full .bp-viewport { flex: 1 1 auto; max-height: none; min-height: 0; }
.bp-rh { position: absolute; top: 0; display: flex; flex-direction: column; }
.bp-rh b { font-size: 12px; font-weight: 700; letter-spacing: .16em; color: #a9b8d8; }
.bp-rh b::after { content: ""; display: block; width: 36px; height: 1px; margin-top: 6px; background: linear-gradient(90deg, rgba(46,230,214,.7), transparent); }
.bp-links { position: absolute; left: 0; top: 0; pointer-events: none; overflow: visible; }
.bp-pk { fill: none; stroke: rgba(130,180,255,.4); stroke-width: 1.8; filter: drop-shadow(0 0 4px rgba(46,230,214,.25)); }
.bp-pk.gold { stroke: rgba(255,197,49,.7); stroke-width: 2.2; filter: drop-shadow(0 0 8px rgba(255,197,49,.5)); }

.bp-m {
  position: absolute; width: 200px; height: 66px; display: flex; overflow: hidden;
  border-radius: 10px; border: 1px solid var(--cb); background: var(--card);
  transition: transform .18s, box-shadow .18s, border-color .18s; cursor: pointer;
}
.bp-m.winnable:hover {
  transform: translateY(-2px) scale(1.015); z-index: 5;
  border-color: rgba(46,230,214,.7);
  box-shadow: 0 14px 30px -14px rgba(46,230,214,.65);
}
/* 双方待定：还没轮到录分 */
.bp-m.pending { cursor: not-allowed; opacity: .5; background: rgba(255,255,255,.025); }
.bp-m.pre { border-color: rgba(255,197,49,.3); background: rgba(255,197,49,.05); }
.bp-no {
  width: 34px; flex: 0 0 34px; display: flex; align-items: center; justify-content: center;
  font-size: 10.5px; color: #7f90b3;
  background: linear-gradient(180deg, rgba(140,170,255,.10), rgba(140,170,255,.03));
  border-right: 1px solid rgba(140,170,255,.12);
}
.bp-ts { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.bp-t {
  flex: 1; display: flex; align-items: center; padding: 0 8px; font-size: 12px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #dbe5ff;
}
.bp-t + .bp-t { border-top: 1px solid rgba(140,170,255,.09); }
.bp-t.win { color: var(--cy); font-weight: 600; }
.bp-t.lose { color: #6b7b9c; }
.bp-vn {
  flex: 0 0 54px; width: 54px; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 2px;
  background: linear-gradient(180deg, rgba(255,197,49,.10), rgba(255,197,49,.03));
  border-left: 1px solid rgba(255,197,49,.16); line-height: 1.1;
}
.bp-vn .sc { font-size: 12px; font-weight: 700; color: #ffd873; font-variant-numeric: tabular-nums; }
.bp-vn .sc.dim { color: #8a9ab8; font-weight: 500; font-size: 11px; }
.bp-vn span { font-size: 8.5px; color: #8593b3; }

.bp-cup {
  position: absolute; width: 200px; height: 66px; border-radius: 10px;
  border: 1px solid rgba(255,197,49,.55);
  background: linear-gradient(135deg, rgba(255,197,49,.2), rgba(255,120,40,.05));
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 800; letter-spacing: .16em;
  background-clip: padding-box; color: #ffd873;
  animation: bpg 2.6s ease-in-out infinite;
}
@keyframes bpg {
  0%, 100% { box-shadow: 0 0 26px rgba(255,197,49,.22), inset 0 0 22px rgba(255,197,49,.07); }
  50% { box-shadow: 0 0 48px rgba(255,197,49,.44), inset 0 0 28px rgba(255,197,49,.15); }
}

.bp-empty { text-align: center; color: var(--dm); font-size: 14px; line-height: 2; padding: 70px 20px; }

.bp-mask {
  position: fixed; inset: 0; z-index: 1000; background: rgba(2,4,10,.72);
  display: flex; align-items: center; justify-content: center; padding: 20px;
  backdrop-filter: blur(3px);
}
.bp-dialog {
  width: 100%; max-width: 420px; border-radius: 14px;
  border: 1px solid rgba(150,180,255,.3); background: #0b1120;
  box-shadow: 0 30px 80px -20px rgba(0,0,0,.9); padding: 16px 18px 18px;
}
.bp-dlg-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: #a9b8d8; }
.bp-x { cursor: pointer; color: #6b7b9c; font-size: 14px; }
.bp-x:hover { color: #fff; }
.bp-dlg-meta { font-size: 11.5px; color: #6b7b9c; margin-top: 4px; }

.bp-score-row { display: flex; align-items: center; gap: 10px; margin: 18px 0 12px; }
.bp-side { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.bp-team-name {
  font-size: 12.5px; color: #dbe5ff; text-align: center; min-height: 34px;
  display: flex; align-items: center; line-height: 1.3;
}
.bp-team-name.win { color: var(--cy); font-weight: 600; }
.bp-num {
  width: 84px; height: 52px; text-align: center; font-size: 24px; font-weight: 700;
  color: #fff; background: rgba(255,255,255,.07);
  border: 1px solid rgba(150,180,255,.3); border-radius: 10px; outline: none;
  font-variant-numeric: tabular-nums;
}
.bp-num:focus { border-color: var(--cy); box-shadow: 0 0 0 3px rgba(46,230,214,.15); }
.bp-num:disabled { opacity: .45; }
.bp-vs { font-size: 20px; color: #6b7b9c; padding-top: 22px; }
.bp-abandon { font-size: 11px; color: #7f90b3; display: flex; align-items: center; gap: 4px; cursor: pointer; }
.bp-abandon input { accent-color: #ff6b6b; }

.bp-remark {
  width: 100%; height: 34px; padding: 0 10px; font-size: 12px; color: var(--tx);
  background: rgba(255,255,255,.05); border: 1px solid rgba(150,180,255,.2);
  border-radius: 8px; outline: none;
}
.bp-remark:focus { border-color: rgba(46,230,214,.5); }
.bp-dlg-foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
.bp-btn {
  appearance: none; border: 1px solid var(--cb); background: rgba(255,255,255,.04);
  color: var(--dm); font: inherit; font-size: 13px; padding: 8px 20px;
  border-radius: 8px; cursor: pointer; transition: .2s;
}
.bp-btn:hover { color: #fff; }
.bp-btn.primary {
  border-color: transparent; color: #04121a; font-weight: 700;
  background: linear-gradient(120deg, #2ee6d6, #5eead4);
}
.bp-btn.primary:disabled { opacity: .6; cursor: not-allowed; }

@media (max-width: 820px) {
  .bp-head { padding: 16px 18px 4px; }
  .bp-head h1 { font-size: 19px; }
  .bp-tabs, .bp-section { padding-left: 18px; padding-right: 18px; }
  .bp-progress { margin-left: 18px; margin-right: 18px; }
}
</style>
