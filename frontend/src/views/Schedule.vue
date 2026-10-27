<template>
  <div>
    <!-- 操作条 -->
    <t-card class="toolbar">
      <div class="tb-row">
        <t-radio-group v-model="arrangeMode" variant="default-filled" size="small">
          <t-radio-button value="auto">自动编排</t-radio-button>
          <t-radio-button value="manual">手动编排</t-radio-button>
        </t-radio-group>

        <span class="tb-divider"></span>

        <t-select v-model="filterBand" placeholder="全部组别" clearable style="width: 130px" @change="onFilterChange">
          <t-option v-for="b in bands" :key="b.id" :label="bandLabel(b)" :value="b.id" />
        </t-select>
        <t-select v-model="filterEvent" placeholder="全部项目" clearable style="width: 130px" @change="onFilterChange">
          <t-option v-for="e in events" :key="e.id" :label="e.name" :value="e.id" />
        </t-select>

        <template v-if="arrangeMode === 'auto'">
          <t-button theme="primary" @click="openSlots">生成时间槽</t-button>
          <t-button variant="outline" @click="doPack">自动装箱</t-button>
        </template>
        <template v-else>
          <t-button theme="primary" @click="openManual()">新增场次</t-button>
        </template>

        <t-button variant="outline" @click="openBlock">添加占位</t-button>
        <t-button variant="outline" @click="doCleanEmpty">清理空槽</t-button>
        <t-button variant="outline" @click="loadGantt">刷新</t-button>

        <span class="tb-divider"></span>

        <span class="ha-label">主客场制</span>
        <t-switch
          v-model="homeAway"
          :loading="savingHomeAway"
          :disabled="!filterEvent"
          @change="toggleHomeAway"
        >
          <template #label="slot">{{ homeAway ? '开' : '关' }}</template>
        </t-switch>
      </div>

      <p class="mode-hint">
        <template v-if="arrangeMode === 'auto'">
          先「生成时间槽」规划每天有哪些时段可用，再「自动装箱」把比赛按规则铺进去；铺完可以点格子微调。
        </template>
        <template v-else>
          「新增场次」逐场指定日期、时间（精确到分钟）、场地和对阵双方；不需要先生成时间槽。
        </template>
        <template v-if="homeAway">
          <span class="ha-on">已开启主客场制：同一对队伍可安排多场比赛（主、客各一场），主队填在「主队（A）」位。</span>
        </template>
        <template v-if="!filterEvent">
          <span class="ha-warn">主客场按项目设置：请先在上方「全部项目」里选一个项目，再开关。</span>
        </template>
        <template v-else-if="estimate">
          <span class="ha-est">
            规模预估：{{ estimate.teamCount }} 队 ·
            单循环 {{ estimate.rounds }} 轮 {{ estimate.matches }} 场<template v-if="estimate.byePerRound">（每轮 1 队轮空）</template>
            · 双循环 {{ estimate.roundsDouble }} 轮 {{ estimate.matchesDouble }} 场
          </span>
        </template>
      </p>
    </t-card>

    <!-- 甘特视图 -->
    <t-card class="gantt-card">
      <template #header>
        <div class="panel-head">
          <span>赛程编排工作台</span>
          <span class="panel-hint">
            拖动比赛卡片到空格子即可改日期 / 时间 / 场地；点空槽可加比赛；点左侧时间可清除整段
          </span>
        </div>
      </template>

      <div v-if="hiddenCount > 0" class="filter-hint">
        当前只显示所选组别 / 项目的比赛，另有 <b>{{ hiddenCount }}</b> 场被隐藏；把组别和项目清空（选回「全部」）即可看到全部比赛。
      </div>

      <div v-if="gantt.dates.length === 0" class="empty">
        尚未生成时间槽。点击「生成时间槽」先规划比赛日期与场地时段。
      </div>

      <div v-else class="gantt-scroll">
        <table class="gantt">
          <thead>
            <tr>
              <th class="time-col">时间</th>
              <th v-for="v in gantt.venues" :key="v.id" class="venue-col" :title="v.name">
                <span class="venue-name">{{ v.name }}</span>
                <span class="venue-no">场地{{ v.venue_no }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="grp in dateGroups" :key="grp.date">
              <tr class="date-row">
                <td :colspan="gantt.venues.length + 1">
                  <span class="dr-date">{{ formatDateCn(parseDate(grp.date)) }}</span>
                  <span class="dr-count">{{ grp.matchCount }} 场</span>
                </td>
              </tr>
              <tr v-for="row in grp.rows" :key="grp.date + '_' + row.time">
                <td
                  class="time-col time-clearable"
                  title="点击清除该时段的所有比赛与槽位"
                  @click="onTimeClick(grp, row)"
                >
                  <span class="tc-time">{{ row.time }}</span>
                  <span v-if="row.endTime" class="tc-end">~{{ row.endTime }}</span>
                  <span class="tc-del">✕</span>
                </td>
                <td
                  v-for="v in gantt.venues"
                  :key="v.id + '_' + row.time"
                  class="cell"
                  :class="cellDropClass(grp.date, row.time, v.venue_no)"
                  :title="cellTitle(grp.date, row.time, v.venue_no)"
                  @click="onCellClick(grp.date, row.time, v, $event)"
                  @dragover.prevent="onDragOver(grp.date, row.time, v.venue_no)"
                  @dragenter.prevent="onDragOver(grp.date, row.time, v.venue_no)"
                  @dragleave="onDragLeave(grp.date, row.time, v.venue_no)"
                  @drop.prevent="onDrop(grp.date, row.time, v)"
                >
                  <div
                    v-for="c in cellsAt(grp.date, row.time, v.venue_no)"
                    :key="c.slot_id"
                    class="slot"
                    :class="{
                      block: c.slot_type === 2,
                      done: c.match && c.match.status === 1,
                      pending: c.match && c.match.status === 0,
                      'is-empty': c.slot_type !== 2 && !c.match,
                      dragging: dragMatch && dragMatch.id === c.match?.id
                    }"
                    :draggable="!!c.match"
                    @dragstart="onDragStart(c)"
                    @dragend="onDragEnd"
                    @click="onSlotClick(c)"
                  >
                    <template v-if="c.slot_type === 2">
                      <span class="block-label">{{ c.occupation }}</span>
                    </template>
                    <template v-else-if="c.match">
                      <div class="m-head">
                        <span class="m-seq">{{ c.match.seq_no }}</span>
                        <span class="m-band">{{ c.match.band_label }}</span>
                        <span class="m-stage">{{ c.match.stage_label }}</span>
                      </div>
                      <div class="m-teams">
                        <span :class="{ win: c.match.score_a > c.match.score_b }">{{ c.match.team_a }}</span>
                        <span class="m-score">{{ c.match.score_a ?? '-' }} : {{ c.match.score_b ?? '-' }}</span>
                        <span :class="{ win: c.match.score_b > c.match.score_a }">{{ c.match.team_b }}</span>
                      </div>
                    </template>
                    <template v-else>
                      <span class="empty-slot">
                        <span class="es-plus">＋</span>
                        <span class="es-text">添加比赛</span>
                      </span>
                    </template>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </t-card>

    <!-- 场次详情抽屉 -->
    <t-drawer v-model:visible="drawerVisible" header="场次详情" size="420px" attach="body">
      <template v-if="currentMatch">
        <t-descriptions :column="1" bordered size="small">
          <t-descriptions-item label="场序">{{ currentMatch.seq_no }}</t-descriptions-item>
          <t-descriptions-item label="项目">{{ currentMatch.event_name }}</t-descriptions-item>
          <t-descriptions-item label="组别">{{ currentMatch.band_label }}</t-descriptions-item>
          <t-descriptions-item label="阶段">{{ currentMatch.stage_label }}</t-descriptions-item>
          <t-descriptions-item label="对阵">
            {{ currentMatch.team_a || currentMatch.ref_a }} 对阵 {{ currentMatch.team_b || currentMatch.ref_b }}
          </t-descriptions-item>
          <t-descriptions-item label="时间">
            {{ currentMatch.play_date || '未排期' }} {{ currentMatch.start_time || '' }}
          </t-descriptions-item>
          <t-descriptions-item label="场地">{{ currentMatch.venue_name || '未安排' }}</t-descriptions-item>
        </t-descriptions>

        <div class="drawer-section">
          <p class="drawer-title">调整时间槽</p>
          <t-select v-model="newSlotId" placeholder="选择目标时间槽" style="width: 100%">
            <t-option
              v-for="c in gantt.cells"
              :key="c.slot_id"
              :label="`${c.date} ${c.start_time} 场地${c.venue_no}`"
              :value="c.slot_id"
              :disabled="c.match && c.match.id !== currentMatch.id"
            />
          </t-select>
          <t-button theme="primary" size="small" class="drawer-btn" @click="doMove">确认调整</t-button>
        </div>

        <div class="drawer-section">
          <p class="drawer-title">裁判指派</p>
          <t-select v-model="newReferee" placeholder="选择裁判" style="width: 100%" filterable>
            <t-option v-for="r in referees" :key="r.id" :label="`${r.name}${r.level ? ' · ' + r.level : ''}`" :value="r.id" />
          </t-select>
          <t-button theme="primary" size="small" class="drawer-btn" @click="doAssign">指派</t-button>
        </div>

        <div class="drawer-danger">
          <t-button
            variant="outline"
            theme="danger"
            size="small"
            block
            @click="removeCurrentMatch"
          >删除这一场</t-button>
        </div>
      </template>
    </t-drawer>

    <!-- 手动编排：新增场次 -->
    <t-dialog
      v-model:visible="manualVisible"
      :header="manualTitle"
      :width="isMobile ? '94%' : '540px'" attach="body">
      <div v-if="manualHint" class="manual-hint">{{ manualHint }}</div>
      <t-form :data="manualForm" label-width="92px" label-align="right">
        <t-form-item label="组别" required>
          <t-select
            v-model="manualForm.band_id"
            placeholder="选择组别"
            :options="bandOptions"
            style="width: 100%"
            @change="loadManualTeams"
          />
        </t-form-item>

        <t-form-item label="项目" required>
          <t-select
            v-model="manualForm.event_item_id"
            placeholder="选择项目"
            :options="eventOptions"
            style="width: 100%"
            @change="loadManualTeams"
          />
        </t-form-item>

        <t-form-item label="比赛日期" required>
          <LunarDatePicker v-model="manualForm.play_date" placeholder="选择比赛日期" />
        </t-form-item>

        <t-form-item label="开赛时间" required>
          <div class="time-row">
            <t-time-picker
              v-model="manualForm.start_time"
              format="HH:mm"
              :steps="[1, 1]"
              placeholder="精确到分钟"
              style="flex: 1"
            />
            <span v-if="estimatedEnd" class="time-end">预计 {{ estimatedEnd }} 结束</span>
          </div>
        </t-form-item>

        <t-form-item label="场地" required>
          <t-select
            v-model="manualForm.venue_id"
            placeholder="选择场地"
            :options="venueOptions"
            style="width: 100%"
          />
        </t-form-item>

        <t-form-item :label="homeAway ? '主队（A）' : '对阵 A 方'" required>
          <t-select
            v-model="manualForm.team_a_id"
            placeholder="选择队伍"
            :options="teamOptionsForA"
            filterable
            style="width: 100%"
          />
        </t-form-item>

        <t-form-item :label="homeAway ? '客队（B）' : '对阵 B 方'" required>
          <t-select
            v-model="manualForm.team_b_id"
            placeholder="选择队伍"
            :options="teamOptionsForB"
            filterable
            style="width: 100%"
          />
        </t-form-item>

        <t-form-item label="比赛阶段">
          <t-select v-model="manualForm.stage" :options="stageOptions" style="width: 100%" />
        </t-form-item>

        <div v-if="manualTeams.length === 0 && manualForm.band_id && manualForm.event_item_id" class="manual-tip">
          该组别该项目还没有队伍报名，请先到「报名管理」录入。
        </div>
      </t-form>

      <template #footer>
        <t-button variant="outline" @click="manualVisible = false">取消</t-button>
        <t-button theme="primary" :loading="manualSaving" @click="submitManual">排定</t-button>
      </template>
    </t-dialog>

    <!-- 清除整个时间段 -->
    <t-dialog v-model:visible="clearVisible" header="清除时间段" width="460px" attach="body">
      <div class="clear-box">
        <p class="clear-line">
          确定清除 <b>{{ clearTitle }}</b> 吗？
        </p>

        <div class="clear-stats">
          <span>槽位 <b>{{ clearStats.slots }}</b> 个</span>
          <span>比赛 <b>{{ clearStats.matches }}</b> 场</span>
          <span v-if="clearStats.blocks">占位 <b>{{ clearStats.blocks }}</b> 个</span>
          <span v-if="clearStats.scored" class="danger">已录分 <b>{{ clearStats.scored }}</b> 场</span>
        </div>

        <t-radio-group v-model="clearForm.scope" class="clear-scope">
          <t-radio value="day">仅 {{ clearDateCn }} 这一天</t-radio>
          <t-radio value="all">所有日期的 {{ clearForm.time }}</t-radio>
        </t-radio-group>

        <p class="clear-warn">
          清除后，该时段在<b>所有场地</b>的槽位都会被删除，槽上的比赛一并取消（含裁判指派与成绩记录）。此操作不可撤销。
        </p>

        <template v-if="clearStats.scored">
          <p class="clear-danger">
            其中有 {{ clearStats.scored }} 场已录入成绩，默认会被保留；只有勾选下方选项才会连同一起删除。
          </p>
          <t-checkbox v-model="clearForm.force">连同已录分的场次一起删除</t-checkbox>
        </template>
      </div>

      <template #footer>
        <t-button variant="outline" @click="clearVisible = false">取消</t-button>
        <t-button theme="danger" :loading="clearSaving" @click="submitClear">确定清除</t-button>
      </template>
    </t-dialog>

    <!-- 生成时间槽对话框 -->
    <t-dialog v-model:visible="slotsVisible" header="生成时间槽" width="440px" attach="body">
      <t-form label-width="92px" :data="slotForm">
        <t-form-item label="比赛日期">
          <t-date-picker
            v-model="slotForm.dates"
            multiple
            :enable-time-picker="false"
            format="YYYY-MM-DD"
            value-type="YYYY-MM-DD"
            placeholder="可多选日期"
            style="width: 100%"
          />
        </t-form-item>
        <t-form-item label="槽位间隔">
          <t-input-number v-model="slotForm.slotInterval" :min="30" :max="120" :step="5" />
          <span class="unit">分钟</span>
        </t-form-item>
        <t-form-item label="上午开始">
          <t-time-picker v-model="slotForm.amStart" format="HH:mm" />
        </t-form-item>
        <t-form-item label="下午开始">
          <t-time-picker v-model="slotForm.pmStart" format="HH:mm" />
        </t-form-item>
        <t-form-item label="每天槽位">
          <t-input-number v-model="slotForm.slotCount" :min="2" :max="20" />
          <span class="unit">个（上午下午各半）</span>
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button variant="outline" @click="slotsVisible = false">取消</t-button>
        <t-button theme="primary" @click="doGenerateSlots">生成</t-button>
      </template>
    </t-dialog>

    <!-- 占位对话框 -->
    <t-dialog v-model:visible="blockVisible" header="添加非比赛占位" width="420px" attach="body">
      <t-form label-width="90px" :data="blockForm">
        <t-form-item label="日期">
          <t-date-picker v-model="blockForm.play_date" format="YYYY-MM-DD" value-type="YYYY-MM-DD" style="width: 100%" />
        </t-form-item>
        <t-form-item label="场地">
          <t-select v-model="blockForm.venue_id" style="width: 100%">
            <t-option v-for="v in gantt.venues" :key="v.id" :label="`场地${v.venue_no} ${v.name}`" :value="v.id" />
          </t-select>
        </t-form-item>
        <t-form-item label="占位名称">
          <t-input v-model="blockForm.occupation" placeholder="如 开幕式、体测" />
        </t-form-item>
        <t-form-item label="占用范围">
          <t-radio-group v-model="blockForm.slot_type">
            <t-radio :value="2">一个时间槽</t-radio>
            <t-radio :value="3">全天占用</t-radio>
          </t-radio-group>
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button variant="outline" @click="blockVisible = false">取消</t-button>
        <t-button theme="primary" @click="doAddBlock">添加</t-button>
      </template>
    </t-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useUserStore } from '../store/user';
import http from '../api/http';
import { message, confirm } from '../utils/ui';
import { formatDateCn, parseDate } from '../utils/lunar';
import { bandLabel } from '../utils/band';

const store = useUserStore();

/** 后端原始数据（不含筛选），拖拽落位判断必须以它为准 */
const ganttRaw = ref({ dates: [], venues: [], cells: [] });
const bands = ref([]);
const events = ref([]);
const referees = ref([]);
const filterBand = ref(null);
const filterEvent = ref(null);

const drawerVisible = ref(false);
const currentMatch = ref(null);
const newSlotId = ref(null);
const newReferee = ref(null);

const slotsVisible = ref(false);
const slotForm = ref({
  dates: [], slotInterval: 45, amStart: '08:30', pmStart: '13:30', slotCount: 10
});

const blockVisible = ref(false);
const blockForm = ref({ play_date: '', venue_id: null, occupation: '', slot_type: 2 });

/* ---------- 编排方式：自动 / 手动 ---------- */
const arrangeMode = ref('auto');

/* ---------- 主客场制（按项目设置） ---------- */
const homeAway = ref(false);
const savingHomeAway = ref(false);
const estimate = ref(null);

/** 顶部筛选变化：重画甘特图，并按新项目重读主客场设置与规模预估 */
function onFilterChange() {
  loadGantt();
  loadHomeAway();
}

async function loadHomeAway() {
  if (!filterEvent.value) {
    homeAway.value = false;
    estimate.value = null;
    return;
  }
  try {
    const r = await http.get('/schedule/event-config', {
      params: { event_item_id: filterEvent.value }
    });
    homeAway.value = Number(r?.home_away) === 1;
  } catch (e) {
    console.warn('[赛制读取失败]', e.message);
  }
  try {
    estimate.value = await http.get('/schedule/estimate', {
      params: {
        competition_id: store.competitionId,
        band_id: filterBand.value || undefined,
        event_item_id: filterEvent.value
      }
    });
  } catch (e) {
    estimate.value = null;
  }
}

async function toggleHomeAway(val) {
  if (!filterEvent.value) {
    homeAway.value = false;
    message.warning('请先在「全部项目」里选择一个项目');
    return;
  }
  const want = val === true || val === 1;
  savingHomeAway.value = true;
  try {
    await http.post('/schedule/event-config', {
      event_item_id: filterEvent.value,
      home_away: want ? 1 : 0
    });
    homeAway.value = want;
    message.success(want ? '已开启主客场制：同一对队伍可安排多场（主、客各一场）' : '已关闭主客场制');
    loadHomeAway(); // 预估随赛制变化
  } catch (e) {
    homeAway.value = !want; // 回滚开关状态
    message.error(e.message);
  } finally {
    savingHomeAway.value = false;
  }
}

const manualVisible = ref(false);
const manualSaving = ref(false);
const manualTeams = ref([]);
/** 是否是从某个已存在的空槽点进来的（决定提示文案） */
const manualFromSlot = ref(false);
/** 该时间点还没有时间槽，保存时后端会自动建 */
const manualCreateSlot = ref(false);
const manualForm = ref({
  band_id: null,
  event_item_id: null,
  play_date: '',
  start_time: '',
  venue_id: null,
  team_a_id: null,
  team_b_id: null,
  stage: 1
});

const isMobile = ref(window.innerWidth <= 768);

/**
 * 甘特图行：按「日期 + 开始时间」分组
 * 这样手动编排填的任意时间点（如 10:07）也能正确成行，
 * 同一时刻不同场地会自动对齐到同一行
 */
/** 叠加顶部筛选后的甘特数据（仅影响显示，不影响拖拽落位判断） */
const gantt = computed(() => {
  const data = ganttRaw.value;
  if (!filterBand.value && !filterEvent.value) return data;
  return {
    ...data,
    cells: data.cells.map((c) => {
      if (!c.match) return c;
      const hide = (filterBand.value && Number(c.match.band_id) !== Number(filterBand.value)) ||
                   (filterEvent.value && Number(c.match.event_item_id) !== Number(filterEvent.value));
      return hide ? { ...c, match: null } : c;
    })
  };
});

/** 被筛选隐藏的比赛场数（提示条用） */
const hiddenCount = computed(() => {
  if (!filterBand.value && !filterEvent.value) return 0;
  const all = ganttRaw.value.cells.filter((c) => c.match).length;
  const shown = gantt.value.cells.filter((c) => c.match).length;
  return all - shown;
});

const dateGroups = computed(() => {
  const byDate = new Map();

  for (const c of gantt.value.cells) {
    if (!byDate.has(c.date)) byDate.set(c.date, new Map());
    const timeMap = byDate.get(c.date);
    const t = c.start_time || '';
    if (!timeMap.has(t)) {
      timeMap.set(t, { time: t, endTime: c.end_time || '', matchCount: 0 });
    }
    if (c.match) timeMap.get(t).matchCount += 1;
  }

  return [...byDate.entries()]
    .map(([date, timeMap]) => {
      const rows = [...timeMap.values()].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
      const matchCount = rows.reduce((s, r) => s + r.matchCount, 0);
      return { date, rows, matchCount };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
});

/** 取某个日期、某个时间点、某个场地的所有槽（用于显示） */
function cellsAt(date, time, venueNo) {
  return gantt.value.cells.filter(
    (c) => c.date === date && c.start_time === time && c.venue_no === venueNo
  );
}

/* ---------- 拖拽改场地 / 时间 ---------- */
/** 正在被拖动的场次（含来源槽位信息） */
const dragMatch = ref(null);
/** 当前悬停的格子 key：`日期|时间|场地号` */
const dragOverKey = ref('');

function cellKey(date, time, venueNo) {
  return `${date}|${time}|${venueNo}`;
}

/** 用未筛选数据判断目标格能不能放（避免筛选把占用场次藏起来导致误判） */
function slotsAt(date, time, venueNo) {
  return ganttRaw.value.cells.filter(
    (c) => c.date === date && c.start_time === time && c.venue_no === venueNo
  );
}

/** 返回 { ok, reason }：ok=true 可落位 */
function dropState(date, time, venueNo) {
  const list = slotsAt(date, time, venueNo);
  if (list.length === 0) return { ok: true, reason: '' };          // 空格子，会自动建槽
  const c = list[0];
  if (Number(c.slot_type) === 2) {
    return { ok: false, reason: `该槽是「${c.occupation || '占位'}」，不能放比赛` };
  }
  if (c.match) {
    return { ok: false, reason: `该槽已有第 ${c.match.seq_no} 场（${c.match.team_a || '待定'} 对 ${c.match.team_b || '待定'}）` };
  }
  return { ok: true, reason: '' };
}

function cellDropClass(date, time, venueNo) {
  if (!dragMatch.value) return '';
  if (dragOverKey.value !== cellKey(date, time, venueNo)) return '';
  return dropState(date, time, venueNo).ok ? 'drop-ok' : 'drop-bad';
}

function onDragStart(c) {
  if (!c.match) return;
  dragMatch.value = {
    id: c.match.id,
    seq_no: c.match.seq_no,
    slot_id: c.slot_id,
    date: c.date,
    start_time: c.start_time,
    venue_no: c.venue_no
  };
}

function onDragEnd() {
  dragMatch.value = null;
  dragOverKey.value = '';
}

function onDragOver(date, time, venueNo) {
  if (!dragMatch.value) return;
  dragOverKey.value = cellKey(date, time, venueNo);
}

function onDragLeave(date, time, venueNo) {
  if (dragOverKey.value === cellKey(date, time, venueNo)) dragOverKey.value = '';
}

async function onDrop(date, time, venue) {
  const m = dragMatch.value;
  dragOverKey.value = '';
  dragMatch.value = null;
  if (!m) return;

  // 原地放下，什么也不做
  if (m.date === date && m.start_time === time && m.venue_no === venue.venue_no) return;

  const state = dropState(date, time, venue.venue_no);
  if (!state.ok) {
    message.warning(state.reason);
    return;
  }

  const list = slotsAt(date, time, venue.venue_no);
  const payload = list.length
    ? { slot_id: list[0].slot_id }
    : { play_date: date, start_time: time, venue_id: venue.id };

  try {
    await http.put(`/schedule/match/${m.id}`, payload);
    message.success(
      `第 ${m.seq_no} 场已改到 ${formatDateCn(parseDate(date))} ${time} · 场地${venue.venue_no}${venue.name ? `（${venue.name}）` : ''}`
    );
    loadGantt();
  } catch (e) {
    message.error(e.message);
  }
}

/* ---------- 手动编排的下拉数据 ---------- */
const bandOptions = computed(() =>
  bands.value.map((b) => ({ label: bandLabel(b), value: b.id }))
);

const eventOptions = computed(() =>
  events.value.map((e) => ({ label: e.name, value: e.id }))
);

const venueOptions = computed(() =>
  gantt.value.venues.map((v) => ({ label: `场地${v.venue_no} ${v.name}`, value: v.id }))
);

const stageOptions = [
  { label: '小组赛', value: 1 },
  { label: '八进四', value: 2 },
  { label: '半决赛', value: 3 },
  { label: '排位赛', value: 4 },
  { label: '决赛', value: 5 },
  { label: '三四名', value: 6 }
];

/** A 方可选队伍（排除已选为 B 方的） */
const teamOptionsForA = computed(() =>
  manualTeams.value
    .filter((t) => t.id !== manualForm.value.team_b_id)
    .map((t) => ({ label: teamOptionLabel(t), value: t.id }))
);

/** B 方可选队伍（排除已选为 A 方的） */
const teamOptionsForB = computed(() =>
  manualTeams.value
    .filter((t) => t.id !== manualForm.value.team_a_id)
    .map((t) => ({ label: teamOptionLabel(t), value: t.id }))
);

function teamOptionLabel(t) {
  return t.school_name ? `${t.school_name}（${t.team_name}）` : t.team_name;
}

/** 根据项目时长推算结束时间 */
const estimatedEnd = computed(() => {
  const st = manualForm.value.start_time;
  if (!st) return '';
  const ev = events.value.find((e) => e.id === manualForm.value.event_item_id);
  const minutes = Number(ev?.match_minutes) > 0 ? Number(ev.match_minutes) : 40;
  const [hh, mm] = String(st).slice(0, 5).split(':').map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return '';
  const total = hh * 60 + mm + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
});

/** 对话框标题带上位置，点空槽进来时一眼能看出排在哪 */
const manualTitle = computed(() => {
  const f = manualForm.value;
  if (!f.play_date || !f.start_time) return '手动编排场次';
  return `新增场次 · ${manualPlace.value || ''}`.replace(/·\s*$/, '').trim();
});

const manualPlace = computed(() => {
  const f = manualForm.value;
  if (!f.play_date) return '';
  let d = f.play_date;
  try { d = formatDateCn(parseDate(f.play_date)); } catch (e) { /* 保持原样 */ }
  const v = venueOptions.value.find((o) => o.value === f.venue_id);
  return `${d}${f.start_time ? ' ' + f.start_time : ''}${v ? ' · ' + v.label : ''}`;
});

const manualHint = computed(() => {
  if (!manualPlace.value) return '';
  return manualCreateSlot.value
    ? `将在 ${manualPlace.value} 安排这一场；该时段暂无时间槽，保存后会自动创建一个。`
    : `将在 ${manualPlace.value} 安排这一场。`;
});

/** 格子悬浮提示 */
function cellTitle(date, time, venueNo) {
  const list = slotsAt(date, time, venueNo);
  if (list.length === 0) return `${time} 暂无时间槽，点击可新增比赛`;
  const empty = list.find((c) => Number(c.slot_type) !== 2 && !c.match);
  if (empty) return `${time} 空槽，点击添加比赛`;
  const c = list[0];
  if (Number(c.slot_type) === 2) return `已被「${c.occupation || '占位'}」占用`;
  return `已有第 ${c.match?.seq_no ?? ''} 场`;
}


async function loadGantt() {
  if (!store.competitionId) return;
  try {
    const data = await http.get('/schedule/gantt', { params: { competition_id: store.competitionId } });
    // 存原始数据；显示用的筛选交给 computed gantt 处理
    ganttRaw.value = data;
  } catch (e) { console.error(e); }
}

async function loadRefs() {
  try {
    referees.value = await http.get('/referee/list');
  } catch (e) { console.error(e); }
}

function openSlots() {
  const comp = store.competitionId;
  slotsVisible.value = true;
}

async function doGenerateSlots() {
  if (!slotForm.value.dates || slotForm.value.dates.length === 0) {
    message.warning('请选择比赛日期');
    return;
  }
  try {
    const r = await http.post('/schedule/slots', {
      competition_id: store.competitionId,
      playDates: slotForm.value.dates,
      ...slotForm.value
    });
    message.success(`已生成 ${r.count} 个时间槽`);
    slotsVisible.value = false;
    loadGantt();
  } catch (e) {
    message.error(e.message);
  }
}

async function doPack() {
  try {
    const r = await http.post('/schedule/pack', { competition_id: store.competitionId });
    message.success(`已排入 ${r.placed} 场${r.unplaced ? `，${r.unplaced} 场未排入` : ''}`);
    loadGantt();
  } catch (e) {
    message.error(e.message);
  }
}

function openBlock() {
  if (gantt.value.venues.length === 0) {
    message.warning('请先生成时间槽');
    return;
  }
  blockForm.value = {
    play_date: gantt.value.dates[0],
    venue_id: gantt.value.venues[0].id,
    occupation: '',
    slot_type: 2
  };
  blockVisible.value = true;
}

/* ---------- 手动编排 ---------- */

/**
 * 打开「新增场次」。可传入预填：
 * opts = { play_date, start_time, venue_id, slot_id, createSlot }
 * createSlot=true 表示这个时间点还没有时间槽，保存时后端会自动建一个
 */
function openManual(opts = {}) {
  if (gantt.value.venues.length === 0) {
    message.warning('还没有场地，请先到「项目与场地」添加场地');
    return;
  }

  manualForm.value = {
    // 带上顶部的筛选条件，减少填写量
    band_id: filterBand.value || (bands.value[0]?.id ?? null),
    event_item_id: filterEvent.value || (events.value[0]?.id ?? null),
    play_date: opts.play_date || gantt.value.dates[0] || todayStr(),
    start_time: opts.start_time || '',
    venue_id: opts.venue_id || (gantt.value.venues[0]?.id ?? null),
    team_a_id: null,
    team_b_id: null,
    stage: 1
  };
  manualFromSlot.value = Boolean(opts.slot_id);
  manualCreateSlot.value = Boolean(opts.createSlot);
  manualTeams.value = [];
  manualVisible.value = true;

  if (manualForm.value.band_id && manualForm.value.event_item_id) {
    loadManualTeams();
  }
}

/** 从某个空槽点进来：预填该槽的日期 / 时间 / 场地 */
function openManualAt(cell, venue) {
  openManual({
    play_date: cell.date,
    start_time: String(cell.start_time || '').slice(0, 5),
    venue_id: venue?.id ?? gantt.value.venues.find((v) => v.venue_no === cell.venue_no)?.id ?? null,
    slot_id: cell.slot_id
  });
}

/** 点击格子的空白处（该时间点该场地还没有任何槽） */
function onCellClick(date, time, venue, e) {
  // 点到具体槽位时交给槽位自己的 click 处理
  if (e?.target?.closest?.('.slot')) return;

  // 用未筛选数据判断，避免顶部筛选把已有安排藏起来
  const list = slotsAt(date, time, venue.venue_no);
  if (list.length === 0) {
    openManual({ play_date: date, start_time: time, venue_id: venue.id, createSlot: true });
    return;
  }
  const empty = list.find((c) => Number(c.slot_type) !== 2 && !c.match);
  if (empty) {
    openManualAt(empty, venue);
    return;
  }
  const c = list[0];
  if (Number(c.slot_type) === 2) {
    message.warning(`该时段已被「${c.occupation || '占位'}」占用，请先取消占位`);
  } else {
    message.warning(`该时段已有第 ${c.match?.seq_no ?? ''} 场，可拖动它改时间，或先删除`);
  }
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 按组别 + 项目拉取已报名的队伍 */
async function loadManualTeams() {
  manualForm.value.team_a_id = null;
  manualForm.value.team_b_id = null;

  const { band_id, event_item_id } = manualForm.value;
  if (!band_id || !event_item_id || !store.competitionId) {
    manualTeams.value = [];
    return;
  }

  try {
    manualTeams.value = await http.get('/entry/list', {
      params: {
        competition_id: store.competitionId,
        band_id,
        event_item_id
      }
    });
  } catch (e) {
    manualTeams.value = [];
    message.error(e.message);
  }
}

async function submitManual() {
  const f = manualForm.value;

  if (!f.band_id) return message.warning('请选择组别');
  if (!f.event_item_id) return message.warning('请选择项目');
  if (!f.play_date) return message.warning('请选择比赛日期');
  if (!f.start_time) return message.warning('请填写开赛时间');
  if (!f.venue_id) return message.warning('请选择场地');
  if (!f.team_a_id || !f.team_b_id) return message.warning('请选择对阵双方');

  manualSaving.value = true;
  try {
    const r = await http.post('/schedule/manual', {
      competition_id: store.competitionId,
      band_id: f.band_id,
      event_item_id: f.event_item_id,
      play_date: f.play_date,
      start_time: String(f.start_time).slice(0, 5),
      venue_id: f.venue_id,
      team_a_id: f.team_a_id,
      team_b_id: f.team_b_id,
      stage: f.stage || 1
    });
    message.success(`已排定第 ${r.seq_no} 场（${r.start_time}–${r.end_time}）`);

    // 排完一场后保留组别/项目/日期/场地，方便连续录入
    f.team_a_id = null;
    f.team_b_id = null;
    f.start_time = '';
    manualVisible.value = false;
    loadGantt();
  } catch (e) {
    message.error(e.message);
  } finally {
    manualSaving.value = false;
  }
}

/* ---------- 清除整个时间段（点左侧时间） ---------- */
const clearVisible = ref(false);
const clearSaving = ref(false);
const clearForm = ref({ date: '', time: '', scope: 'day', force: false });

function onTimeClick(grp, row) {
  clearForm.value = { date: grp.date, time: row.time, scope: 'day', force: false };
  clearVisible.value = true;
}

/** 影响面统计：一律用未筛选的 ganttRaw，避免顶部筛选把已排的比赛藏起来 */
const clearStats = computed(() => {
  const { date, time, scope } = clearForm.value;
  if (!time) return { slots: 0, matches: 0, blocks: 0, scored: 0 };

  const list = ganttRaw.value.cells.filter(
    (c) => c.start_time === time && (scope === 'all' || c.date === date)
  );
  const slotIds = new Set(list.map((c) => c.slot_id));
  const withMatch = list.filter((c) => c.match);

  return {
    slots: slotIds.size,
    matches: withMatch.length,
    blocks: list.filter((c) => Number(c.slot_type) === 2).length,
    scored: withMatch.filter((c) => Number(c.match.status) === 1).length
  };
});

const clearDateCn = computed(() => {
  try {
    return formatDateCn(parseDate(clearForm.value.date));
  } catch (e) {
    return clearForm.value.date || '';
  }
});

const clearTitle = computed(() =>
  clearForm.value.scope === 'all'
    ? `所有日期的 ${clearForm.value.time} 时段`
    : `${clearDateCn.value} ${clearForm.value.time} 时段`
);

async function submitClear() {
  if (clearStats.value.slots === 0) {
    message.info('该时段没有内容可清除');
    clearVisible.value = false;
    return;
  }

  clearSaving.value = true;
  try {
    const r = await http.post('/schedule/clear-time', {
      competition_id: store.competitionId,
      start_time: clearForm.value.time,
      play_date: clearForm.value.scope === 'day' ? clearForm.value.date : undefined,
      force: clearForm.value.force ? 1 : 0
    });
    message.success(`已清除 ${r?.slots ?? 0} 个槽位、${r?.matches ?? 0} 场比赛`);
    clearVisible.value = false;
    loadGantt();
  } catch (e) {
    message.error(e.message);
  } finally {
    clearSaving.value = false;
  }
}

/** 清理没有比赛的空时间槽 */
async function doCleanEmpty() {
  const emptyCount = gantt.value.cells.filter((c) => c.slot_type === 1 && !c.match).length;
  if (emptyCount === 0) {
    message.info('没有需要清理的空槽');
    return;
  }

  let okClean = false;
  await confirm(
    `将清理 ${emptyCount} 个没有比赛的空时间槽，占位（如开幕式）会保留。继续？`,
    '清理空槽',
    { confirmBtn: '确定清理', cancelBtn: '取消' }
  )
    .then(() => { okClean = true; })
    .catch(() => {});
  if (!okClean) return;

  try {
    const r = await http.post('/schedule/clean-empty', { competition_id: store.competitionId });
    message.success(r.count ? `已清理 ${r.count} 个空槽` : '没有需要清理的空槽');
    loadGantt();
  } catch (e) {
    message.error(e.message);
  }
}

/** 删除当前抽屉里的这一场 */
async function removeCurrentMatch() {
  const m = currentMatch.value;
  if (!m) return;

  let okDel = false;
  await confirm(
    `确定删除第 ${m.seq_no} 场（${m.team_a || m.ref_a} 对 ${m.team_b || m.ref_b}）？`,
    '删除场次',
    { confirmBtn: '确定删除', cancelBtn: '取消' }
  )
    .then(() => { okDel = true; })
    .catch(() => {});
  if (!okDel) return;

  try {
    await http.delete(`/schedule/match/${m.id}`);
    message.success('已删除');
    drawerVisible.value = false;
    currentMatch.value = null;
    loadGantt();
  } catch (e) {
    message.error(e.message);
  }
}

async function doAddBlock() {
  try {
    const r = await http.post('/schedule/block', {
      competition_id: store.competitionId,
      ...blockForm.value
    });
    message.success(`已占用 ${r.count} 个时间槽`);
    blockVisible.value = false;
    loadGantt();
  } catch (e) {
    message.error(e.message);
  }
}

function onSlotClick(cell) {
  if (cell.slot_type === 2) {
    confirm(`取消「${cell.occupation}」的占位？`, '提示')
      .then(async () => {
        await http.delete(`/schedule/block/${cell.slot_id}`);
        loadGantt();
      })
      .catch(() => {});
    return;
  }
  // 空槽：直接在这个位置新增比赛（日期 / 时间 / 场地已预填）
  if (!cell.match) {
    const venue = gantt.value.venues.find((v) => v.venue_no === cell.venue_no);
    openManualAt(cell, venue);
    return;
  }
  // 把槽位的日期/时间/场地补给比赛对象，抽屉里才显示得出来
  currentMatch.value = {
    ...cell.match,
    play_date: cell.date,
    start_time: cell.start_time,
    end_time: cell.end_time,
    venue_name: cell.venue_name || `场地${cell.venue_no}`
  };
  newSlotId.value = cell.slot_id;
  newReferee.value = null;
  drawerVisible.value = true;
}

async function doMove() {
  if (!newSlotId.value) {
    message.warning('请选择目标时间槽');
    return;
  }
  try {
    await http.put(`/schedule/match/${currentMatch.value.id}`, { slot_id: newSlotId.value });
    message.success('已调整');
    drawerVisible.value = false;
    loadGantt();
  } catch (e) {
    message.error(e.message);
  }
}

async function doAssign() {
  if (!newReferee.value) {
    message.warning('请选择裁判');
    return;
  }
  try {
    await http.post('/referee/assign', {
      match_id: currentMatch.value.id,
      referee_id: newReferee.value,
      role: 1
    });
    message.success('已指派');
    newReferee.value = null;
  } catch (e) {
    message.error(e.message);
  }
}

async function loadBase() {
  if (!store.competitionId) return;
  try {
    bands.value = await http.get('/event/bands', { params: { competition_id: store.competitionId } });
    events.value = await http.get('/event/items', { params: { competition_id: store.competitionId } });
  } catch (e) { console.error(e); }
}

function onResize() {
  isMobile.value = window.innerWidth <= 768;
}

onMounted(() => {
  window.addEventListener('resize', onResize);
  loadBase();
  loadGantt();
  loadRefs();
  loadHomeAway();
});
onUnmounted(() => window.removeEventListener('resize', onResize));
watch(() => store.competitionId, () => {
  loadBase();
  loadGantt();
  loadHomeAway();
});
</script>

<style scoped>
.toolbar,
.gantt-card {
  border-color: var(--app-border);
  border-radius: 8px;
}

.toolbar {
  margin-bottom: 14px;
}

.tb-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.tb-divider {
  width: 1px;
  height: 18px;
  background: var(--app-border);
  margin: 0 2px;
}

.mode-hint {
  margin: 9px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--app-text-3);
}

.ha-label {
  font-size: 13px;
  color: var(--app-text-2);
  margin-right: 2px;
}

.ha-on {
  display: block;
  margin-top: 3px;
  color: var(--app-primary, var(--td-brand-color));
}

.ha-warn {
  display: block;
  margin-top: 3px;
  color: #d9822b;
}

.ha-est {
  display: block;
  margin-top: 3px;
}

.gantt-card :deep(.t-card__body) {
  padding: 0;
}

.gantt-scroll {
  overflow-x: auto;
}

.gantt {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  min-width: 900px;
}

.gantt th {
  background: var(--app-bg);
  padding: 9px 8px;
  text-align: center;
  font-weight: 500;
  color: var(--app-text-2);
  border-bottom: 1px solid var(--app-border);
  border-right: 1px solid var(--app-border);
}

.time-col {
  width: 68px;
  min-width: 68px;
  background: var(--app-bg-2);
  color: var(--app-text-3);
  font-size: 11px;
}

.venue-col {
  min-width: 200px;
}

/* 场地名称在上（主），编号在下（次） */
.venue-name {
  display: block;
  font-size: 12px;
  color: var(--app-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.venue-no {
  display: block;
  font-size: 10px;
  color: var(--app-text-3);
  font-weight: 400;
  margin-top: 1px;
}

.date-row td {
  background: var(--td-brand-color-light);
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--td-brand-color);
}

.gantt td {
  border-bottom: 1px solid var(--app-border-2);
  border-right: 1px solid var(--app-border-2);
  padding: 3px;
  vertical-align: top;
}

.cell {
  height: 58px;
}

.slot {
  height: 100%;
  border-radius: 4px;
  padding: 4px 6px;
  cursor: pointer;
  background: var(--app-bg-2);
  border: 1px solid transparent;
  transition: all 0.15s;
  overflow: hidden;
}

.slot:hover {
  border-color: var(--td-brand-color);
  background: var(--td-brand-color-light);
}

/* ---------- 拖拽改场地 / 时间 ---------- */
.slot[draggable='true'] {
  cursor: grab;
}

.slot[draggable='true']:active {
  cursor: grabbing;
}

.slot.dragging {
  opacity: 0.4;
  border-style: dashed;
}

.cell.drop-ok {
  outline: 2px dashed var(--app-success);
  outline-offset: -3px;
  background: rgba(43, 164, 113, 0.08);
}

.cell.drop-bad {
  outline: 2px dashed var(--app-error);
  outline-offset: -3px;
  background: rgba(213, 73, 65, 0.08);
}

.slot.pending {
  background: #fdf3e8;
  border-color: #f7ddc2;
}

.slot.done {
  background: #e8f7f0;
  border-color: #c6e9d8;
}

.slot.block {
  background: var(--app-bg);
  border-color: var(--app-border);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.block-label {
  font-size: 11px;
  color: var(--app-text-3);
  text-align: center;
}

.m-head {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 3px;
}

.m-seq {
  font-size: 10px;
  color: #fff;
  background: #8b8b8b;
  border-radius: 2px;
  padding: 0 4px;
}

.m-band {
  font-size: 10px;
  color: var(--td-brand-color);
  font-weight: 500;
}

.m-stage {
  font-size: 10px;
  color: var(--app-text-3);
  margin-left: auto;
}

.m-teams {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--app-text-2);
}

.m-teams .win {
  color: var(--app-success);
  font-weight: 500;
}

.m-score {
  font-size: 11px;
  color: var(--app-text-3);
  font-variant-numeric: tabular-nums;
}

.empty-slot {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: 100%;
  color: var(--app-text-3);
  opacity: 0.45;
  font-size: 11px;
  transition: opacity 0.15s var(--ease-out), color 0.15s var(--ease-out);
}

.es-plus {
  font-size: 14px;
  line-height: 1;
}

.es-text {
  display: none;
  white-space: nowrap;
}

/* 空槽悬浮：提示可以点击添加比赛 */
.slot.is-empty:hover .empty-slot {
  opacity: 1;
  color: var(--td-brand-color);
}

.slot.is-empty:hover .es-text {
  display: inline;
}

.manual-hint {
  margin: 0 0 12px;
  padding: 7px 10px;
  background: var(--td-brand-color-light);
  border: 1px solid var(--td-brand-color-focus);
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--td-brand-color);
}

.empty {
  text-align: center;
  padding: 50px 20px;
  color: var(--app-text-3);
  font-size: 13px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 500;
  color: var(--app-text-1);
}

.panel-hint {
  font-size: 12px;
  font-weight: 400;
  color: var(--app-text-3);
}

.drawer-section {
  margin-top: 22px;
}

.drawer-title {
  font-size: 13px;
  font-weight: 500;
  margin: 0 0 10px;
  color: var(--app-text-1);
}

.drawer-btn {
  margin-top: 8px;
}

.unit {
  font-size: 12px;
  color: var(--app-text-3);
  margin-left: 6px;
}

/* ---------- 日期行 ---------- */
.dr-date {
  font-weight: 500;
}

.dr-count {
  margin-left: 8px;
  font-size: 11px;
  font-weight: 400;
  color: var(--app-text-3);
}

/* ---------- 时间列 ---------- */
.tc-time {
  display: block;
  font-variant-numeric: tabular-nums;
}

.tc-end {
  display: block;
  font-size: 10px;
  color: var(--app-text-3);
  font-variant-numeric: tabular-nums;
  margin-top: 1px;
}

/* 时间列可点击清除：平时低调，悬浮显手段 */
.time-clearable {
  position: relative;
  cursor: pointer;
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out);
}

.time-clearable:hover {
  background: rgba(217, 48, 48, 0.1);
  color: var(--td-error-color);
}

.tc-del {
  display: none;
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 3px;
  background: var(--td-error-color);
  color: #fff;
}

.time-clearable:hover .tc-del {
  display: inline-block;
}

/* ---------- 清除时间段对话框 ---------- */
.filter-hint {
  margin-bottom: 10px;
  padding: 7px 10px;
  border-radius: 4px;
  background: var(--td-brand-color-light);
  border: 1px solid var(--td-brand-color-focus);
  color: var(--td-brand-color);
  font-size: 12px;
  line-height: 1.7;
}

.filter-hint b {
  font-weight: 600;
}

.clear-box {
  font-size: 13px;
  line-height: 1.7;
}

.clear-line b {
  color: var(--td-brand-color);
}

.clear-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 10px 0 14px;
}

.clear-stats span {
  padding: 4px 10px;
  border-radius: 4px;
  background: var(--app-bg-2);
  border: 1px solid var(--app-border);
  font-size: 12px;
  color: var(--app-text-2);
}

.clear-stats span.danger {
  background: rgba(217, 48, 48, 0.08);
  border-color: rgba(217, 48, 48, 0.35);
  color: var(--td-error-color);
}

.clear-scope {
  margin-bottom: 12px;
}

.clear-warn,
.clear-danger {
  margin: 0 0 10px;
  padding: 8px 10px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.7;
}

.clear-warn {
  background: rgba(237, 123, 47, 0.08);
  border: 1px solid rgba(237, 123, 47, 0.35);
  color: var(--app-warning);
}

.clear-danger {
  background: rgba(217, 48, 48, 0.08);
  border: 1px solid rgba(217, 48, 48, 0.35);
  color: var(--td-error-color);
}

/* ---------- 手动编排表单 ---------- */
.time-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.time-end {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--app-text-3);
  white-space: nowrap;
}

.manual-tip {
  margin: 4px 0 0 92px;
  padding: 7px 10px;
  background: rgba(237, 123, 47, 0.08);
  border: 1px solid rgba(237, 123, 47, 0.35);
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--app-warning);
}

/* ---------- 抽屉删除区 ---------- */
.drawer-danger {
  margin-top: 26px;
  padding-top: 16px;
  border-top: 1px solid var(--app-border-2);
}
</style>
