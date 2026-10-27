<template>
  <div class="bracket-wrap" :class="{ compact }">
    <div v-if="!rounds.length" class="bk-empty">
      小组赛全部结束后，系统会自动生成淘汰赛对阵，届时这里会显示对阵图。
    </div>

    <div v-else class="bk-scroll">
      <svg :width="svgW" :height="svgH" :viewBox="`0 0 ${svgW} ${svgH}`" class="bk-svg" role="img">
        <title>淘汰赛对阵图</title>

        <!-- 冠军横幅 -->
        <g v-if="champion">
          <rect
            :x="svgW / 2 - champW / 2" y="8" :width="champW" height="34" rx="17"
            fill="#FAC775" stroke="#854F0B" stroke-width="0.5"
          />
          <path
            :d="`M ${svgW / 2 - champW / 2 + 18} 18
                 h 12 v 8 a 6 6 0 0 1 -12 0 z
                 M ${svgW / 2 + champW / 2 - 30} 18 h 12 v 8 a 6 6 0 0 1 -12 0 z`"
            fill="#633806" stroke="none"
          />
          <text
            :x="svgW / 2" y="26" text-anchor="middle" dominant-baseline="central"
            font-size="14" font-weight="500" fill="#412402"
          >冠军 · {{ champion }}</text>
        </g>

        <!-- 轮次标题 -->
        <text
          v-for="(r, ci) in treeRounds" :key="'h' + r.stage"
          :x="colX(ci) + colW / 2" :y="headerY" text-anchor="middle"
          font-size="13" font-weight="500" fill="var(--app-text-2, #666)"
        >{{ r.label }}（{{ r.matches.length }}场）</text>

        <!-- 主干连线 -->
        <path
          v-for="p in trunkLinks" :key="'l' + p.key"
          :d="p.d" fill="none" :stroke="p.done ? 'var(--td-brand-color, #185FA5)' : 'var(--app-border, #ccc)'"
          stroke-width="1.2"
        />

        <!-- 三四名连线（半决赛败者汇聚） -->
        <path
          v-for="p in sideLinks" :key="'s' + p.key"
          :d="p.d" fill="none" stroke="var(--app-border, #ccc)" stroke-width="1.2" stroke-dasharray="4 3"
        />

        <!-- 节点 -->
        <g v-for="n in allNodes" :key="'n' + n.round.stage + '_' + n.match.id">
          <rect
            :x="n.x" :y="n.y" :width="colW" :height="nodeH" rx="8"
            :fill="nodeFill(n)" :stroke="nodeStroke(n)" stroke-width="1"
          />
          <!-- 两队两行 -->
          <text
            :x="n.x + 12" :y="n.y + 17" font-size="12.5" font-weight="500"
            :fill="teamColor(n, 'a')" dominant-baseline="central"
          >{{ short(n.match.team_a, 11) }}</text>
          <text
            :x="n.x + colW - 12" :y="n.y + 17" text-anchor="end" font-size="12.5" font-weight="500"
            :fill="scoreColor(n)" dominant-baseline="central" font-variant-numeric="tabular-nums"
          >{{ scoreText(n, 'a') }}</text>

          <text
            :x="n.x + 12" :y="n.y + 37" font-size="12.5" font-weight="500"
            :fill="teamColor(n, 'b')" dominant-baseline="central"
          >{{ short(n.match.team_b, 11) }}</text>
          <text
            :x="n.x + colW - 12" :y="n.y + 37" text-anchor="end" font-size="12.5" font-weight="500"
            :fill="scoreColor(n)" dominant-baseline="central" font-variant-numeric="tabular-nums"
          >{{ scoreText(n, 'b') }}</text>

          <line
            :x1="n.x + 10" :y1="n.y + 26" :x2="n.x + colW - 10" :y2="n.y + 26"
            stroke="var(--app-border, #ddd)" stroke-width="0.5"
          />

          <!-- 状态脚注 -->
          <text
            :x="n.x + colW / 2" :y="n.y + nodeH + 13" text-anchor="middle"
            font-size="10.5" fill="var(--app-text-3, #999)" dominant-baseline="central"
          >{{ footText(n) }}</text>
        </g>
      </svg>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  rounds: { type: Array, default: () => [] },
  champion: { type: String, default: '' },
  compact: { type: Boolean, default: false }
});

const colW = 216;
const nodeH = 54;
const gapX = 78;
const gapY = 26;
const padX = 24;
const headerY = 66;
const champH = 50; // 冠军横幅区高度（无冠军时也保留，布局稳定）

/* 主干列（不含三四名这类旁支） */
const treeRounds = computed(() => props.rounds.filter((r) => !r.side));
const sideRounds = computed(() => props.rounds.filter((r) => r.side));

/* 每列节点坐标 */
const colHeights = computed(() =>
  treeRounds.value.map((r) => r.matches.length * nodeH + (r.matches.length - 1) * gapY)
);

const bodyTop = computed(() => headerY + 24);

const layout = computed(() => {
  const cols = [];
  const maxH = Math.max(0, ...colHeights.value);
  treeRounds.value.forEach((r, ci) => {
    const n = r.matches.length;
    const colH = colHeights.value[ci];
    const start = bodyTop.value + (maxH - colH) / 2;
    r.matches.forEach((m, i) => {
      cols.push({
        round: r, match: m,
        x: padX + ci * (colW + gapX),
        y: start + i * (nodeH + gapY + 16)
      });
    });
  });
  return cols;
});

/* 三四名旁支节点坐标：放在最后一列右侧延伸，或最后一列下方 */
const sideLayout = computed(() => {
  const out = [];
  if (!sideRounds.value.length || !treeRounds.value.length) return out;
  const lastCi = treeRounds.value.length - 1;
  const lastX = padX + lastCi * (colW + gapX);
  const maxH = Math.max(0, ...colHeights.value);
  const baseY = bodyTop.value + maxH + 46;
  sideRounds.value.forEach((r, k) => {
    r.matches.forEach((m, i) => {
      out.push({
        round: r, match: m,
        x: lastX,
        y: baseY + k * (nodeH + gapY + 16) + i * (nodeH + gapY + 16)
      });
    });
  });
  return out;
});

const allNodes = computed(() => [...layout.value, ...sideLayout.value]);

const svgW = computed(() => {
  const cols = treeRounds.value.length;
  return padX * 2 + cols * colW + (cols - 1) * gapX;
});

const svgH = computed(() => {
  const sideBottom = sideLayout.value.reduce((mx, n) => Math.max(mx, n.y + nodeH + 26), 0);
  const trunkBottom = bodyTop.value + Math.max(0, ...colHeights.value) + 26;
  return Math.max(trunkBottom, sideBottom, 200);
});

/* 主干连线：上一列第 2i、2i+1 场 → 当前列第 i 场 */
const trunkLinks = computed(() => {
  const links = [];
  for (let ci = 1; ci < treeRounds.value.length; ci++) {
    const prev = layout.value.filter((n) => treeRounds.value.indexOf(n.round) === ci - 1);
    const cur = layout.value.filter((n) => treeRounds.value.indexOf(n.round) === ci);
    cur.forEach((cn, i) => {
      const parents = [prev[2 * i], prev[2 * i + 1]].filter(Boolean);
      const midX = cn.x - gapX / 2;
      const done = parents.length && parents.every((pn) => pn.match.winner_id) && cn.match.team_a_id && cn.match.team_b_id;
      parents.forEach((pn, k) => {
        const d =
          `M ${pn.x + colW} ${pn.y + nodeH / 2}` +
          ` L ${midX} ${pn.y + nodeH / 2}` +
          ` L ${midX} ${cn.y + nodeH / 2}` +
          ` L ${cn.x} ${cn.y + nodeH / 2}`;
        links.push({ key: `${ci}_${i}_${k}`, d, done });
      });
    });
  }
  return links;
});

/* 三四名连线：半决赛（倒数第二主干列）各场败者 → 三四名 */
const sideLinks = computed(() => {
  if (!sideLayout.value.length || treeRounds.value.length < 2) return [];
  const feeder = layout.value.filter((n) => treeRounds.value.indexOf(n.round) === treeRounds.value.length - 2);
  const out = [];
  sideLayout.value.forEach((sn, i) => {
    feeder.forEach((pn, k) => {
      const midX = sn.x - gapX / 2;
      const startY = pn.y + nodeH / 2 + (k === 0 ? 14 : -14);
      const d =
        `M ${pn.x + colW} ${startY}` +
        ` L ${midX} ${startY}` +
        ` L ${midX} ${sn.y + nodeH / 2}` +
        ` L ${sn.x} ${sn.y + nodeH / 2}`;
      out.push({ key: `s_${i}_${k}`, d });
    });
  });
  return out;
});

/* ---------- 节点样式 ---------- */
function nodeFill(n) {
  if (n.round.stage === 5) return 'var(--td-brand-color-light, #F2F3FF)';
  return 'var(--app-bg-2, #fafafa)';
}
function nodeStroke(n) {
  if (n.round.stage === 5) return 'var(--td-brand-color, #185FA5)';
  if (n.match.winner_id) return 'var(--td-brand-color, #185FA5)';
  return 'var(--app-border, #d4d4d4)';
}
function teamColor(n, side) {
  const id = side === 'a' ? n.match.team_a_id : n.match.team_b_id;
  if (n.match.winner_id) {
    return id === n.match.winner_id ? 'var(--app-text-1, #222)' : 'var(--app-text-3, #999)';
  }
  return 'var(--app-text-2, #444)';
}
function scoreColor(n) {
  return n.match.winner_id ? 'var(--td-brand-color, #185FA5)' : 'var(--app-text-3, #999)';
}
function scoreText(n, side) {
  const v = side === 'a' ? n.match.score_a : n.match.score_b;
  return v == null ? (n.match.status === 1 ? '-' : '') : v;
}
function footText(n) {
  const m = n.match;
  if (!m.play_date) return `第 ${m.seq_no} 场 · 待排期`;
  return `第 ${m.seq_no} 场 · ${m.play_date} ${m.start_time || ''}${m.venue ? ' · ' + m.venue : ''}`;
}
function short(s, n) {
  s = String(s || '待定');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
const champW = computed(() => (props.champion ? props.champion.length * 14 + 96 : 0));
</script>

<style scoped>
.bracket-wrap {
  width: 100%;
}

.bk-scroll {
  overflow-x: auto;
  padding-bottom: 8px;
}

.bk-svg {
  display: block;
}

.bk-empty {
  padding: 48px 20px;
  text-align: center;
  color: var(--app-text-3, #999);
  font-size: 13px;
  line-height: 1.7;
}
</style>
