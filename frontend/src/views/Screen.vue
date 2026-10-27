<template>
  <div class="screen">
    <!-- 顶部标题条 -->
    <header class="sc-head">
      <div class="sc-title">
        <h1>{{ sc ? sc.competition.name : (board.competition?.name || '赛事得分大屏') }}</h1>
        <span v-if="!sc && board.competition?.year" class="sc-year">{{ board.competition.year }}</span>
        <span v-else-if="sc?.competition?.venue" class="sc-year">{{ sc.competition.venue }}</span>
      </div>

      <div class="sc-meta">
        <select v-if="!uuid" v-model="cid" class="sc-select" @change="reload">
          <option v-for="c in competitions" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <span class="sc-time">更新于 {{ updatedText }}</span>
        <span class="sc-clock">{{ clockText }}</span>
        <span class="sc-tick">{{ countdown }}s 后刷新</span>
        <button class="sc-btn" @click="copyLink">复制链接</button>
      </div>
    </header>

    <!-- 主体 -->
    <div v-if="loading" class="sc-empty">正在加载…</div>
    <div v-else-if="errMsg" class="sc-empty">{{ errMsg }}</div>
    <div v-else-if="board.boards.length === 0" class="sc-empty">
      本赛事还没有已录入的比赛数据，先去「成绩录入」录几场就有内容了。
    </div>

    <!-- ===== 田径大屏（uuid 模式：主题 / 队列 / 插播） ===== -->
    <div v-else-if="sc" :class="['sc2', 'theme-' + String(sc.config.theme || 'DARK').toLowerCase()]">
      <!-- 插播横幅 -->
      <div v-if="sc.insert" class="sc2-insert">
        <span class="ins-tag">紧急插播</span>
        <span class="ins-text">{{ sc.insert.text }}</span>
      </div>

      <div class="sc2-grid">
        <!-- 团体总分 -->
        <section v-if="sc.config.show_team_score && sc.teamScore" class="sc2-card">
          <h2 class="sc2-title">团体总分 · {{ sc.teamScore.rule.scheme_name }}</h2>
          <table class="sc2-table">
            <thead>
              <tr><th class="w-rank">名次</th><th>参赛单位</th><th class="w-pt">总分</th><th class="w-n">第一</th><th class="w-n">第二</th><th class="w-n">第三</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in sc.teamScore.rows" :key="r.unit_name" :class="{ top3: r.rank_no <= 3 }">
                <td class="w-rank">{{ r.rank_no }}</td>
                <td class="tl">{{ r.unit_name }}</td>
                <td class="w-pt">{{ r.final_score }}</td>
                <td class="w-n">{{ r.first_count }}</td>
                <td class="w-n">{{ r.second_count }}</td>
                <td class="w-n">{{ r.third_count }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- 最新成绩 -->
        <section v-if="sc.config.show_latest && sc.latest.length" class="sc2-card">
          <h2 class="sc2-title">最新成绩</h2>
          <ul class="sc2-list">
            <li v-for="r in sc.latest" :key="r.id">
              <span class="l-ev">{{ r.event_name }}</span>
              <span class="l-nm">{{ r.athlete_name }}</span>
              <span class="l-sc">{{ r.school_name }}</span>
              <span class="l-rk" :class="{ gold: r.rank_no === 1 }">{{ r.rank_no ? '第' + r.rank_no + '名' : '' }}</span>
              <span class="l-rs">{{ r.result_text }}{{ r.event_unit || '' }}</span>
            </li>
          </ul>
        </section>
      </div>

      <!-- 破纪录滚动 -->
      <div v-if="sc.config.show_record && sc.records.length" class="sc2-marquee">
        <span class="mq-tag">破纪录</span>
        <div class="mq-track">
          <span v-for="r in sc.records" :key="r.id" class="mq-item">
            {{ r.event_name }} · {{ r.athlete_name }} 以 {{ r.result_text }} 打破{{ r.record_type === 'MEET' ? '赛会' : '最高' }}纪录（原 {{ r.old_value }}）
          </span>
        </div>
      </div>
    </div>

    <!-- ===== 旧版球类大屏 ===== -->
    <div v-else class="sc-body">
      <section v-for="(b, i) in board.boards" :key="i" class="sc-card">
        <h2 class="sc-card-title">
          <span class="sc-tag" :class="b.type">{{ typeLabel(b.type) }}</span>
          {{ b.event_name }}
          <span v-if="b.band_label" class="sc-band">{{ b.band_label }}</span>
        </h2>

        <!-- 积分榜 -->
        <table v-if="b.type === 'standing'" class="sc-table">
          <thead>
            <tr>
              <th class="c-rank">名次</th>
              <th class="c-name">参赛单位</th>
              <th>场</th>
              <th>胜</th>
              <th v-if="showDraw(b)">平</th>
              <th>负</th>
              <th class="c-pt">积分</th>
              <th>净胜</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in b.rows" :key="r.team_name + r.rank" :class="{ 'top3': r.rank <= 3, 'voided': r.is_voided }">
              <td class="c-rank">{{ r.rank }}</td>
              <td class="c-name">
                {{ r.team_name || r.school_name }}
                <span v-if="r.rank_reason" class="sc-reason">{{ r.rank_reason }}</span>
                <span v-if="r.is_voided" class="sc-void">成绩作废</span>
              </td>
              <td>{{ r.played }}</td>
              <td>{{ r.win }}</td>
              <td v-if="showDraw(b)">{{ r.draw }}</td>
              <td>{{ r.lose }}</td>
              <td class="c-pt">{{ r.points }}</td>
              <td>{{ r.diff > 0 ? '+' + r.diff : r.diff }}</td>
            </tr>
          </tbody>
        </table>

        <!-- 最新赛果 -->
        <ul v-else-if="b.type === 'results'" class="sc-list">
          <li v-for="r in b.rows" :key="'r' + r.seq_no">
            <span class="li-seq">第{{ r.seq_no }}场</span>
            <span class="li-team" :class="{ win: r.score_a > r.score_b }">{{ r.team_a }}</span>
            <span class="li-score">{{ r.score_a }} : {{ r.score_b }}</span>
            <span class="li-team right" :class="{ win: r.score_b > r.score_a }">{{ r.team_b }}</span>
            <span class="li-when">{{ r.play_date }} {{ r.start_time }}</span>
          </li>
        </ul>

        <!-- 待赛 -->
        <ul v-else class="sc-list">
          <li v-for="r in b.rows" :key="'u' + r.seq_no">
            <span class="li-seq">第{{ r.seq_no }}场</span>
            <span class="li-team">{{ r.team_a }}</span>
            <span class="li-score vs">VS</span>
            <span class="li-team right">{{ r.team_b }}</span>
            <span class="li-when">{{ r.play_date }} {{ r.start_time }}<template v-if="r.venue"> · {{ r.venue }}</template></span>
          </li>
        </ul>
      </section>
    </div>

    <footer class="sc-foot">
      {{ sc ? sc.competition.name + ' · ' : '' }}登封市教育局体育竞赛管理系统 · 本页为公开只读大屏，无需登录
    </footer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import http from '../api/http';

const route = useRoute();
const uuid = computed(() => route.params.uuid);

const competitions = ref([]);
const cid = ref(null);
const board = ref({ competition: null, boards: [] });
const sc = ref(null);            // uuid 模式的田径大屏数据
const scIndex = ref(0);          // 队列轮播位置
const loading = ref(true);
const errMsg = ref('');
const updatedText = ref('—');
const countdown = ref(60);
const clockText = ref('');

let timer = null;
let tick = null;
let carousel = null;
let clockTimer = null;

// 队列轮播：按 dwell_seconds 切换高亮项
function startCarousel() {
  if (carousel) clearInterval(carousel);
  const cfg = sc.value?.config;
  if (!cfg || !Array.isArray(cfg.queue) || cfg.queue.length < 2 || !cfg.loop_flag) return;
  carousel = setInterval(() => {
    scIndex.value = (scIndex.value + 1) % cfg.queue.length;
  }, (Number(cfg.dwell_seconds) || 12) * 1000);
}

const typeLabel = (t) => ({ standing: '积分榜', results: '最新赛果', upcoming: '待赛' }[t] || '');
const showDraw = (b) => (Number(b.draw_points) > 0);

function pad(n) { return String(n).padStart(2, '0'); }

async function loadCompetitions() {
  try {
    competitions.value = await http.get('/screen/competitions');
    const q = Number(new URLSearchParams(location.hash.split('?')[1] || '').get('cid'));
    if (q) cid.value = q;
    else if (competitions.value.length) cid.value = Number(competitions.value[0].id);
  } catch (e) {
    errMsg.value = e.message;
  }
}

/** uuid 模式：拉田径大屏数据 */
async function loadScreen() {
  loading.value = true;
  errMsg.value = '';
  try {
    const d = await http.get(`/public/screen/${uuid.value}`);
    sc.value = d;
    const t = new Date();
    updatedText.value = `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
    startCarousel();
  } catch (e) {
    errMsg.value = e.message;
    sc.value = null;
  } finally {
    loading.value = false;
    countdown.value = Number(sc.value?.config?.refresh_seconds) || 30;
  }
}

async function loadBoard() {
  if (!cid.value) return;
  loading.value = true;
  errMsg.value = '';
  try {
    const d = await http.get('/screen/board', { params: { competition_id: cid.value } });
    board.value = d;
    const t = new Date();
    updatedText.value = `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
  } catch (e) {
    errMsg.value = e.message;
  } finally {
    loading.value = false;
    countdown.value = 60;
  }
}

function reload() {
  if (uuid.value) { loadScreen(); return; }
  // 把赛事写进地址栏，方便直接分享
  const base = location.hash.split('?')[0] || '#/screen';
  location.hash = `${base}?cid=${cid.value}`;
  loadBoard();
}

function copyLink() {
  const url = uuid.value
    ? `${location.origin}${location.pathname}#/screen/${uuid.value}`
    : `${location.origin}${location.pathname}#/screen?cid=${cid.value}`;
  const done = () => alert(`大屏链接已复制：\n${url}`);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(done).catch(() => prompt('复制这个链接分享给别人：', url));
  } else {
    prompt('复制这个链接分享给别人：', url);
  }
}

onMounted(async () => {
  if (uuid.value) {
    await loadScreen();
    timer = setInterval(loadScreen, (Number(sc.value?.config?.refresh_seconds) || 30) * 1000);
  } else {
    await loadCompetitions();
    await loadBoard();
    timer = setInterval(loadBoard, 60000);
  }
  tick = setInterval(() => { if (countdown.value > 0) countdown.value--; }, 1000);
  clockTimer = setInterval(() => {
    const d = new Date();
    clockText.value = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }, 1000);
});

onUnmounted(() => {
  clearInterval(timer);
  clearInterval(tick);
  clearInterval(clockTimer);
  if (carousel) clearInterval(carousel);
});
</script>

<style scoped>
.screen {
  min-height: 100vh;
  background: radial-gradient(1200px 600px at 50% -10%, #16304d 0%, #0b1220 55%, #070c15 100%);
  color: #eaf2ff;
  padding: 18px 22px 60px;
  font-family: 'Microsoft YaHei', 'PingFang SC', system-ui, sans-serif;
}

.sc-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  padding-bottom: 12px;
}

.sc-title h1 {
  margin: 0;
  font-size: 30px;
  letter-spacing: 1px;
}

.sc-year {
  margin-left: 10px;
  font-size: 16px;
  color: #8fb6e8;
}

.sc-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: #9fb6d4;
}

.sc-clock {
  font-size: 15px;
  font-weight: 600;
  color: #eaf2ff;
  font-variant-numeric: tabular-nums;
  letter-spacing: 1px;
}

.sc-select {
  background: #12243b;
  color: #eaf2ff;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
}

.sc-btn {
  background: #1f6feb;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 13px;
}

.sc-btn:hover { background: #2b7fff; }

.sc-body {
  margin-top: 18px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(460px, 1fr));
  gap: 16px;
}

.sc-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 14px 16px 16px;
}

.sc-card-title {
  margin: 0 0 10px;
  font-size: 17px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.sc-tag {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  background: #24405f;
  color: #bcd8ff;
}

.sc-tag.standing { background: #1f6feb; color: #fff; }
.sc-tag.results { background: #1f8f5f; color: #fff; }
.sc-tag.upcoming { background: #8a6d1f; color: #fff; }

.sc-band { font-size: 13px; color: #8fb6e8; font-weight: normal; }

.sc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 15px;
}

.sc-table th {
  text-align: center;
  font-weight: normal;
  font-size: 13px;
  color: #8fb6e8;
  padding: 6px 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
}

.sc-table td {
  text-align: center;
  padding: 7px 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.sc-table .c-name { text-align: left; padding-left: 6px; }
.sc-table .c-rank { width: 46px; }
.sc-table .c-pt { font-weight: bold; color: #ffd75e; }
.sc-table tr.top3 .c-rank { color: #ffd75e; font-weight: bold; }
.sc-table tr.voided { opacity: 0.55; }

.sc-reason {
  display: block;
  font-size: 11px;
  color: #7fa8d8;
}

.sc-void {
  display: inline-block;
  margin-left: 6px;
  font-size: 11px;
  color: #ff9a9a;
}

.sc-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.sc-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 2px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 15px;
}

.li-seq { font-size: 12px; color: #7fa8d8; width: 58px; }
.li-team { flex: 1; text-align: left; }
.li-team.right { text-align: right; }
.li-team.win { color: #ffd75e; font-weight: bold; }
.li-score { font-size: 18px; font-weight: bold; color: #ffd75e; min-width: 70px; text-align: center; }
.li-score.vs { font-size: 13px; color: #8fb6e8; }
.li-when { font-size: 12px; color: #7fa8d8; width: 150px; text-align: right; }

.sc-empty {
  margin-top: 60px;
  text-align: center;
  color: #8fb6e8;
  font-size: 17px;
}

.sc-foot {
  margin-top: 26px;
  text-align: center;
  font-size: 12px;
  color: #5d7a9e;
}

@media (max-width: 900px) {
  .sc-body { grid-template-columns: 1fr; }
  .sc-title h1 { font-size: 22px; }
  .li-when { display: none; }
}

/* ===== 田径大屏（uuid 模式） ===== */
.sc2 { margin-top: 16px; }
.sc2-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(440px, 1fr));
  gap: 16px;
}
.sc2-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  padding: 16px 18px 18px;
  backdrop-filter: blur(6px);
  animation: screen-rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.sc2-card:nth-child(2) { animation-delay: 0.12s; }
.sc2-card:nth-child(3) { animation-delay: 0.22s; }

@keyframes screen-rise {
  from { opacity: 0; transform: translateY(22px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.sc2-title {
  margin: 0 0 12px;
  font-size: 17px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 10px;
}
.sc2-title::before {
  content: '';
  width: 4px;
  height: 16px;
  border-radius: 2px;
  background: linear-gradient(180deg, #ffd75e, #ff9f43);
  flex: none;
}
.sc2-table { width: 100%; border-collapse: collapse; font-size: 15px; }
.sc2-table th {
  text-align: center; font-weight: normal; font-size: 13px; opacity: .7;
  padding: 6px 4px; border-bottom: 1px solid rgba(255, 255, 255, 0.16);
}
.sc2-table td {
  text-align: center; padding: 8px 4px; border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
.sc2-table .tl { text-align: left; padding-left: 6px; }
.sc2-table .w-rank { width: 52px; }
.sc2-table .w-pt { width: 80px; font-weight: bold; color: #ffd75e; }
.sc2-table .w-n { width: 56px; }
/* 前三名徽章 */
.sc2-table tr.top3 .w-rank,
.sc-table tr.top3 .c-rank {
  display: inline-block;
  width: 26px; height: 26px; line-height: 26px;
  border-radius: 50%;
  color: #fff !important; font-weight: 700;
}
.sc2-table tr.top3:nth-of-type(1) .w-rank,
.sc-table tr.top3:nth-of-type(1) .c-rank { background: linear-gradient(135deg, #f7c948, #d99a1f); }
.sc2-table tr.top3:nth-of-type(2) .w-rank,
.sc-table tr.top3:nth-of-type(2) .c-rank { background: linear-gradient(135deg, #c8ced8, #97a1b0); }
.sc2-table tr.top3:nth-of-type(3) .w-rank,
.sc-table tr.top3:nth-of-type(3) .c-rank { background: linear-gradient(135deg, #e0a37e, #b56f43); }

.sc2-list { list-style: none; margin: 0; padding: 0; }
.sc2-list li {
  display: flex; align-items: center; gap: 10px; padding: 8px 2px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07); font-size: 15px;
}
.l-ev { width: 110px; font-size: 13px; opacity: .75; }
.l-nm { width: 110px; font-weight: 600; }
.l-sc { flex: 1; font-size: 13px; opacity: .8; }
.l-rk { width: 60px; text-align: center; font-size: 13px; }
.l-rk.gold { color: #ffd75e; font-weight: bold; }
.l-rs { width: 110px; text-align: right; font-weight: bold; color: #ffd75e; }

.sc2-marquee {
  margin-top: 16px; display: flex; align-items: center; gap: 12px;
  background: linear-gradient(90deg, rgba(255, 120, 60, .25), rgba(255, 120, 60, .05));
  border: 1px solid rgba(255, 160, 60, .35); border-radius: 10px; padding: 10px 14px;
  overflow: hidden;
}
.mq-tag {
  flex: none; background: #ff7a3d; color: #fff; font-size: 13px; font-weight: 600;
  padding: 3px 10px; border-radius: 4px;
}
.mq-track { display: flex; gap: 40px; white-space: nowrap; animation: mq 28s linear infinite; }
.mq-item { font-size: 15px; color: #ffd7a8; }
@keyframes mq {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}

.sc2-insert {
  display: flex; align-items: center; gap: 12px; margin-bottom: 14px;
  background: linear-gradient(90deg, #d5491b, #e8632c); color: #fff;
  border-radius: 10px; padding: 14px 18px;
  font-size: 20px; font-weight: 600; box-shadow: 0 6px 20px rgba(213, 73, 27, .35);
  animation: insert-blink 1.6s ease-in-out infinite;
}
@keyframes insert-blink {
  0%, 100% { box-shadow: 0 6px 20px rgba(213, 73, 27, .35); }
  50% { box-shadow: 0 6px 32px rgba(213, 73, 27, .65); }
}
.ins-tag {
  flex: none; background: rgba(255, 255, 255, .22); font-size: 14px;
  padding: 4px 10px; border-radius: 4px;
}
.ins-text { line-height: 1.4; }

/* 主题配色 */
.theme-light { color: #1d2129; }
.theme-light .sc2-card { background: #fff; border-color: #e5e6eb; }
.theme-light .sc2-table th,
.theme-light .sc2-table td { color: #1d2129; border-color: #e5e6eb; }
.theme-light .sc2-table .w-pt { color: #d5491b; }
.theme-light .sc2-table tr.top3 .w-rank { color: #d5491b; }
.theme-light .l-rs { color: #d5491b; }
.theme-light .sc2-list li { border-color: #e5e6eb; }

.theme-blue .sc2-card { background: rgba(0, 82, 217, .12); border-color: rgba(0, 82, 217, .35); }
.theme-red .sc2-card { background: rgba(213, 73, 27, .12); border-color: rgba(213, 73, 27, .35); }
.theme-green .sc2-card { background: rgba(0, 168, 112, .12); border-color: rgba(0, 168, 112, .35); }

@media (max-width: 900px) {
  .sc2-grid { grid-template-columns: 1fr; }
  .l-sc { display: none; }
}
</style>
