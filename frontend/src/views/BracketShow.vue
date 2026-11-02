<template>
  <div class="bs-page">
    <div class="bs-bg"></div>

    <header class="bs-header">
      <div class="bs-kicker">{{ kicker }}</div>
      <h1>{{ title }}</h1>
      <div class="bs-meta">
        <span v-if="meta.date">{{ meta.date }}</span>
        <i v-if="meta.date && meta.venue"></i>
        <span v-if="meta.venue">{{ meta.venue }}</span>
        <i v-if="meta.count"></i>
        <span v-if="meta.count">共 {{ meta.count }} 场</span>
      </div>
      <div class="bs-tools">
        <button class="bs-tool" @click="toggleAnim">{{ animOn ? '关闭动画' : '开启动画' }}</button>
        <button class="bs-tool" @click="toggleFull">全屏</button>
        <button class="bs-tool" @click="goBack">返回</button>
      </div>
    </header>

    <div v-if="loading" class="bs-empty">加载中…</div>
    <div v-else-if="!combos.length" class="bs-empty">
      当前赛事还没有淘汰赛对阵。<br />
      小组赛全部结束后，系统会自动生成淘汰赛，届时这里会显示对阵图。
    </div>

    <template v-else>
      <nav class="bs-nav">
        <button
          v-for="b in bandTabs"
          :key="b.key"
          class="bs-tab"
          :class="{ on: bandKey === b.key }"
          @click="bandKey = b.key"
        >{{ b.label }}</button>
      </nav>

      <nav v-if="eventTabs.length > 1" class="bs-nav sub">
        <button
          v-for="e in eventTabs"
          :key="e.key"
          class="bs-tab ev"
          :class="{ on: eventKey === e.key }"
          @click="eventKey = e.key"
        >{{ e.label }}</button>
      </nav>

      <main v-if="current" class="bs-main">
        <div class="bs-vhead">
          <h2>{{ current.band_label }} · {{ current.event_name }}</h2>
          <div class="bs-chips">
            <span class="bs-chip">{{ current.rounds.length }} 轮</span>
            <span class="bs-chip">{{ current.match_count }} 场</span>
            <span v-if="current.champion" class="bs-chip gold">冠军 {{ current.champion }}</span>
          </div>
        </div>

        <div class="bs-scroller">
          <div class="bs-bracket" :style="{ width: lay.width + 'px', height: lay.height + 'px' }">
            <!-- 列标题 -->
            <div
              v-for="(r, i) in visibleRounds"
              :key="'h' + i"
              class="bs-rh"
              :style="{ left: i * COL_STEP + 'px' }"
            >
              <b>{{ r.label }}</b>
              <i v-if="roundDate(r)">{{ roundDate(r) }}</i>
            </div>

            <!-- 连线 -->
            <svg class="bs-links" :width="lay.width" :height="lay.height" :viewBox="`0 0 ${lay.width} ${lay.height}`">
              <path
                v-for="(p, i) in lay.links"
                :key="'p' + i"
                :d="p.d"
                :class="['bs-pk', { gold: p.final }]"
              />
            </svg>

            <!-- 比赛卡片 -->
            <div
              v-for="(c, i) in lay.cards"
              :key="'c' + c.id"
              class="bs-m"
              :class="{ pre: c.round === 0, done: c.status === 1 }"
              :style="{ left: c.x + 'px', top: c.y + 'px', '--d': (i * 0.03) + 's' }"
              :title="`第${c.seq_no}场｜${c.venue || '未安排'} ${c.play_date || ''} ${c.start_time || ''}`"
            >
              <div class="bs-no">{{ c.round === 0 ? '第' + (i + 1) + '场' : '第' + (i + 1) + '场' }}</div>
              <div class="bs-ts">
                <div class="bs-t" :class="{ win: isWin(c, 'a'), lose: isLose(c, 'a') }">{{ c.team_a || '待定' }}</div>
                <div class="bs-t" :class="{ win: isWin(c, 'b'), lose: isLose(c, 'b') }">{{ c.team_b || '待定' }}</div>
              </div>
              <div class="bs-vn">
                <b>{{ c.venue || '未排场' }}</b>
                <span v-if="c.play_date || c.start_time">{{ (c.play_date || '').slice(5) }} {{ c.start_time || '' }}</span>
                <span v-else>待安排</span>
              </div>
            </div>

            <!-- 三四名 -->
            <div
              v-if="lay.third"
              class="bs-m third"
              :style="{ left: lay.third.x + 'px', top: lay.third.y + 'px' }"
              :title="`三四名｜${lay.third.venue || ''}`"
            >
              <div class="bs-no">三·四</div>
              <div class="bs-ts">
                <div class="bs-t" :class="{ win: isWin(lay.third, 'a') }">{{ lay.third.team_a || '待定' }}</div>
                <div class="bs-t" :class="{ win: isWin(lay.third, 'b') }">{{ lay.third.team_b || '待定' }}</div>
              </div>
              <div class="bs-vn">
                <b>{{ lay.third.venue || '未排场' }}</b>
                <span v-if="lay.third.play_date">{{ (lay.third.play_date || '').slice(5) }} {{ lay.third.start_time || '' }}</span>
              </div>
            </div>

            <!-- 冠军 -->
            <div v-if="current.champion" class="bs-champ" :style="{ left: lay.champX + 'px', top: lay.champY + 'px' }">
              <span class="bs-cup">冠军</span>
            </div>
          </div>
        </div>
      </main>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import http from '../api/http';
import { useUserStore } from '../store/user';

const route = useRoute();
const router = useRouter();
const store = useUserStore();

const CARD_W = 214;
const CARD_H = 66;
const GAP_X = 48;
const COL_STEP = CARD_W + GAP_X;
const ROW_H = 76;
const HEAD = 44;

const loading = ref(true);
const animOn = ref(true);
const combos = ref([]);
const bandKey = ref('');
const eventKey = ref('');
const meta = ref({});

const kicker = ref('对阵图');
const kickerText = computed(() => kicker.value);
const title = computed(() => meta.value.name || '比赛对阵图');

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

const current = computed(() => {
  return combos.value.find(
    (c) => String(c.band_id) === bandKey.value && String(c.event_item_id) === eventKey.value
  ) || null;
});

/** 主线轮次（排除三四名） */
const visibleRounds = computed(() => {
  if (!current.value) return [];
  return current.value.rounds.filter((r) => r.stage !== 6);
});

function roundDate(r) {
  const d = r.matches.map((m) => m.play_date).filter(Boolean).sort();
  return d.length ? d[0].slice(5) : '';
}

/** 布局：第 ri 轮第 i 张卡垂直居中于 2^ri 个行高 */
const lay = computed(() => {
  const empty = { cards: [], links: [], third: null, width: CARD_W, height: 200, champX: 0, champY: 0 };
  if (!current.value) return empty;

  const rounds = visibleRounds.value;
  if (!rounds.length) return empty;

  const cards = [];
  rounds.forEach((r, ri) => {
    r.matches.forEach((m, i) => {
      const x = ri * COL_STEP;
      const y = HEAD + (i + 0.5) * (ROW_H * Math.pow(2, ri)) - CARD_H / 2;
      cards.push({ ...m, x, y, round: ri });
    });
  });

  const links = [];
  for (let ri = 0; ri < rounds.length - 1; ri++) {
    const n = rounds[ri].matches.length;
    for (let i = 0; i < n; i++) {
      const x1 = ri * COL_STEP + CARD_W;
      const y1 = HEAD + (i + 0.5) * (ROW_H * Math.pow(2, ri));
      const target = Math.floor(i / 2);
      const x2 = (ri + 1) * COL_STEP;
      const y2 = HEAD + (target + 0.5) * (ROW_H * Math.pow(2, ri + 1));
      links.push({
        d: `M${x1},${y1} C${x1 + 26},${y1} ${x2 - 26},${y2} ${x2},${y2}`,
        final: ri === rounds.length - 2
      });
    }
  }

  // 三四名：放在第一轮下方独立一行，虚线卡
  const thirdRaw = current.value.rounds.find((r) => r.stage === 6);
  const firstCount = rounds[0].matches.length;
  const baseH = HEAD + firstCount * ROW_H;
  const third = thirdRaw && thirdRaw.matches[0]
    ? { ...thirdRaw.matches[0], x: 0, y: baseH + 26 }
    : null;

  const height = (third ? baseH + 26 + CARD_H : baseH) + 27;
  const champX = (rounds.length - 1) * COL_STEP + CARD_W + 26;
  const champY = HEAD + (0.5 * (ROW_H * Math.pow(2, rounds.length - 1))) - CARD_H / 2;

  return {
    cards,
    links,
    third,
    width: current.value.champion ? champX + CARD_W : rounds.length * COL_STEP,
    height: Math.max(height, champY + CARD_H + 20),
    champX,
    champY
  };
});

function isWin(m, side) {
  return m.status === 1 && m.winner_id && (
    (side === 'a' && m.winner_id === m.team_a_id) || (side === 'b' && m.winner_id === m.team_b_id)
  );
}
function isLose(m, side) {
  return m.status === 1 && m.winner_id && (
    (side === 'a' && m.winner_id === m.team_b_id) || (side === 'b' && m.winner_id === m.team_a_id)
  );
}

function toggleAnim() {
  animOn.value = !animOn.value;
  document.documentElement.classList.toggle('bs-no-anim', !animOn.value);
}

function toggleFull() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}

function goBack() {
  if (window.history.length > 1) router.back();
  else router.push('/schedule');
}

async function load() {
  loading.value = true;
  try {
    const cid = Number(route.query.competition_id) || store.competitionId;
    if (!cid) {
      combos.value = [];
      return;
    }
    const [list, comp] = await Promise.all([
      http.get('/schedule/bracket-all', { params: { competition_id: cid } }),
      http.get('/competition/list').catch(() => null)
    ]);
    combos.value = Array.isArray(list) ? list : [];

    const info = (comp || []).find((c) => Number(c.id) === Number(cid)) || {};
    const dates = info.start_date && info.end_date
      ? `${(info.start_date || '').slice(5)} — ${(info.end_date || '').slice(5)}`
      : '';
    meta.value = {
      name: info.name || '比赛对阵图',
      date: dates,
      venue: info.venue || '',
      count: combos.value.reduce((s, c) => s + (c.match_count || 0), 0)
    };
    kicker.value = (info.year ? info.year + ' · ' : '') + '淘汰赛对阵';

    if (bandTabs.value.length) bandKey.value = bandTabs.value[0].key;
  } catch (e) {
    combos.value = [];
  } finally {
    loading.value = false;
  }
}

// 切换组别时，项目默认取第一个
watch(bandKey, () => {
  if (eventTabs.value.length) eventKey.value = eventTabs.value[0].key;
});

onMounted(load);
</script>

<style>
/* 深色页面：需要覆盖全局浅色底 */
html.bs-no-anim .bs-m,
html.bs-no-anim .bs-champ {
  animation: none !important;
  opacity: 1 !important;
  transform: none !important;
}
</style>

<style scoped>
.bs-page {
  --tx: #e9efff;
  --dm: #8494b5;
  --card: rgba(255, 255, 255, .075);
  --cb: rgba(150, 180, 255, .24);
  --cy: #2ee6d6;
  --pu: #9b5cff;
  --gd: #ffc531;
  position: relative;
  min-height: 100vh;
  padding: 0 0 56px;
  background: #05070e;
  color: var(--tx);
  overflow-x: hidden;
  font-family: "HarmonyOS Sans SC", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
}

.bs-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(900px 620px at 10% -12%, rgba(46, 230, 214, .17), transparent 62%),
    radial-gradient(820px 600px at 92% -6%, rgba(155, 92, 255, .20), transparent 62%),
    radial-gradient(1100px 700px at 50% 118%, rgba(255, 197, 49, .09), transparent 62%);
}

.bs-header, .bs-nav, .bs-main { position: relative; z-index: 1; }

.bs-header { padding: 30px 26px 14px; text-align: center; }
.bs-kicker {
  font-size: 12px; letter-spacing: .42em; color: var(--cy);
  text-transform: uppercase; margin-bottom: 10px; opacity: .9;
}
.bs-header h1 {
  font-size: 34px; font-weight: 800; letter-spacing: .05em; line-height: 1.14; margin: 0;
  background: linear-gradient(100deg, #2ee6d6 0%, #7dd3fc 26%, #9b5cff 58%, #ffc531 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 6px 30px rgba(46, 230, 214, .22));
}
.bs-meta { margin-top: 10px; font-size: 13px; color: var(--dm); letter-spacing: .1em; }
.bs-meta i {
  display: inline-block; width: 4px; height: 4px; border-radius: 50%;
  background: var(--pu); margin: 0 12px; vertical-align: middle; opacity: .85;
}
.bs-tools { margin-top: 14px; display: flex; gap: 10px; justify-content: center; }

.bs-tool {
  appearance: none; border: 1px solid var(--cb); background: rgba(255, 255, 255, .04);
  color: var(--dm); font: inherit; font-size: 12.5px; letter-spacing: .06em;
  padding: 6px 16px; border-radius: 999px; cursor: pointer; transition: .2s;
}
.bs-tool:hover { color: #fff; border-color: rgba(46, 230, 214, .5); background: rgba(46, 230, 214, .08); }

.bs-nav { display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; padding: 0 26px; margin-bottom: 10px; }
.bs-nav.sub { margin-bottom: 18px; }

.bs-tab {
  appearance: none; border: 1px solid var(--cb); background: rgba(255, 255, 255, .03);
  color: var(--dm); font: inherit; font-size: 14px; letter-spacing: .06em;
  padding: 9px 22px; border-radius: 999px; cursor: pointer; transition: .22s;
}
.bs-tab:hover { color: #fff; border-color: rgba(46, 230, 214, .5); background: rgba(46, 230, 214, .07); }
.bs-tab.on {
  color: #04121a; font-weight: 700; border-color: transparent;
  background: linear-gradient(120deg, #2ee6d6, #5eead4);
  box-shadow: 0 8px 26px -8px rgba(46, 230, 214, .75);
}
.bs-tab.ev.on {
  background: linear-gradient(120deg, #9b5cff, #c4a2ff); color: #0b0424;
  box-shadow: 0 8px 26px -8px rgba(155, 92, 255, .8);
}

.bs-main { padding: 0 0 10px; }
.bs-vhead {
  max-width: 1500px; margin: 0 auto 12px; padding: 0 34px;
  display: flex; align-items: baseline; gap: 18px; flex-wrap: wrap;
}
.bs-vhead h2 { font-size: 19px; font-weight: 700; letter-spacing: .06em; margin: 0; color: var(--tx); }
.bs-chips { display: flex; gap: 8px; flex-wrap: wrap; }
.bs-chip {
  font-size: 11.5px; color: var(--dm); letter-spacing: .05em;
  border: 1px solid rgba(140, 170, 255, .14); border-radius: 6px;
  padding: 3px 9px; background: rgba(255, 255, 255, .025);
}
.bs-chip.gold { color: #ffd873; border-color: rgba(255, 197, 49, .35); background: rgba(255, 197, 49, .08); }

.bs-scroller { overflow-x: auto; padding: 0 34px 22px; }
.bs-scroller::-webkit-scrollbar { height: 8px; }
.bs-scroller::-webkit-scrollbar-thumb { background: rgba(140, 170, 255, .25); border-radius: 4px; }

.bs-bracket { position: relative; margin: 0 auto; }

.bs-rh { position: absolute; top: 0; display: flex; flex-direction: column; gap: 3px; }
.bs-rh b { font-size: 12.5px; font-weight: 700; letter-spacing: .16em; color: #a9b8d8; }
.bs-rh i { font-style: normal; font-size: 11px; letter-spacing: .04em; color: #6b7b9c; }
.bs-rh b::after {
  content: ""; display: block; width: 40px; height: 1px; margin-top: 6px;
  background: linear-gradient(90deg, rgba(46, 230, 214, .75), transparent);
}

.bs-links { position: absolute; left: 0; top: 0; pointer-events: none; overflow: visible; }
.bs-pk {
  fill: none; stroke: rgba(130, 180, 255, .42); stroke-width: 1.8;
  filter: drop-shadow(0 0 4px rgba(46, 230, 214, .28));
}
.bs-pk.gold {
  stroke: rgba(255, 197, 49, .7); stroke-width: 2.2;
  filter: drop-shadow(0 0 8px rgba(255, 197, 49, .55));
}

.bs-m {
  position: absolute; width: 214px; height: 66px; display: flex; overflow: hidden;
  border-radius: 11px; border: 1px solid var(--cb); background: var(--card);
  box-shadow: 0 6px 18px -10px rgba(0, 0, 0, .8);
  transition: transform .22s, box-shadow .22s, border-color .22s;
  animation: bs-pop .42s cubic-bezier(.2, .9, .3, 1) both;
  animation-delay: var(--d, 0s);
}
@keyframes bs-pop {
  from { opacity: 0; transform: translateY(9px) scale(.97); }
  to { opacity: 1; transform: none; }
}
.bs-m:hover {
  transform: translateY(-3px) scale(1.02); z-index: 5;
  border-color: rgba(46, 230, 214, .62);
  box-shadow: 0 16px 36px -14px rgba(46, 230, 214, .62), 0 0 0 1px rgba(46, 230, 214, .18);
}
.bs-m.pre { border-color: rgba(255, 197, 49, .34); background: rgba(255, 197, 49, .05); }
.bs-m.third { border-style: dashed; border-color: rgba(140, 170, 255, .24); opacity: .94; }

.bs-no {
  width: 38px; flex: 0 0 38px; display: flex; align-items: center; justify-content: center;
  font-size: 10.5px; color: #7f90b3; text-align: center; line-height: 1.15;
  background: linear-gradient(180deg, rgba(140, 170, 255, .10), rgba(140, 170, 255, .03));
  border-right: 1px solid rgba(140, 170, 255, .12);
}
.bs-ts { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.bs-t {
  flex: 1; display: flex; align-items: center; padding: 0 9px;
  font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  color: #dbe5ff;
}
.bs-t + .bs-t { border-top: 1px solid rgba(140, 170, 255, .09); }
.bs-t.win { color: var(--cy); font-weight: 600; }
.bs-t.lose { color: #6b7b9c; }

.bs-vn {
  flex: 0 0 62px; width: 62px; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 3px; text-align: center; padding: 0 2px;
  background: linear-gradient(180deg, rgba(255, 197, 49, .10), rgba(255, 197, 49, .03));
  border-left: 1px solid rgba(255, 197, 49, .16); line-height: 1.1;
}
.bs-vn b { font-size: 9.5px; font-weight: 600; color: #e2c274; }
.bs-vn span { font-size: 8.5px; color: #8593b3; }

.bs-champ {
  position: absolute; width: 214px; height: 66px; border-radius: 11px;
  border: 1px solid rgba(255, 197, 49, .55);
  background: linear-gradient(135deg, rgba(255, 197, 49, .20), rgba(255, 120, 40, .05));
  display: flex; align-items: center; justify-content: center;
  animation: bs-glow 2.6s ease-in-out infinite;
}
@keyframes bs-glow {
  0%, 100% { box-shadow: 0 0 30px rgba(255, 197, 49, .24), inset 0 0 24px rgba(255, 197, 49, .08); }
  50% { box-shadow: 0 0 52px rgba(255, 197, 49, .46), inset 0 0 30px rgba(255, 197, 49, .16); }
}
.bs-cup {
  font-size: 20px; font-weight: 800; letter-spacing: .1em;
  background: linear-gradient(120deg, #ffe58a, #ffc531);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}

.bs-empty {
  position: relative; z-index: 1; text-align: center; color: var(--dm);
  font-size: 14px; line-height: 2; padding: 80px 20px;
}

@media (max-width: 820px) {
  .bs-header h1 { font-size: 24px; }
  .bs-header { padding: 24px 18px 12px; }
  .bs-vhead { padding: 0 18px; }
  .bs-scroller { padding: 0 18px 20px; }
  .bs-tab { padding: 8px 15px; font-size: 13px; }
}
</style>
