<template>
  <div>
    <!-- 操作条 -->
    <t-card class="toolbar">
      <div class="tb-row">
        <t-select
          v-model="eventItemId"
          placeholder="选择项目"
          style="width: 160px"
          @change="onEventChange"
        >
          <t-option :value="0" label="全部项目" />
          <t-option v-for="e in events" :key="e.id" :label="e.name" :value="e.id" />
        </t-select>
        <t-select
          v-model="bandId"
          placeholder="选择组别"
          style="width: 150px"
          @change="onBandChange"
        >
          <t-option v-for="b in bands" :key="b.id" :label="bandLabel(b)" :value="b.id" />
        </t-select>
        <t-button theme="primary" @click="doPreview">分组预览</t-button>
        <t-button theme="success" :disabled="!eventItemId" @click="doGenerate">执行分组</t-button>
        <t-button theme="warning" :disabled="!eventItemId" @click="doGenerateMatches">生成小组赛程</t-button>
        <t-button v-if="currentEvent && currentEvent.category === 1" :disabled="!eventItemId" @click="doTrackGenerate">
          径赛分组
        </t-button>
        <t-button variant="outline" @click="loadGroups">刷新</t-button>
      </div>
      <p v-if="currentEvent" class="tb-meta">
        配对规则 {{ pairingLabel(currentEvent.pairing_rule) }} ·
        出线 {{ currentEvent.advance_count }} 人 ·
        {{ currentEvent.has_third_place ? '打三四名' : '不打三四名' }}
      </p>
    </t-card>

    <!-- 分组预览 -->
    <t-card v-if="preview.groups.length" class="panel">
      <template #header>
        <div class="panel-head">
          <span>分组预览</span>
          <div class="ph-right">
            <span class="panel-hint">预览不会保存，点右侧按钮才写入数据库</span>
            <t-button size="small" theme="primary" :disabled="!eventItemId || !preview.groups.length" @click="doGenerate">
              保存为正式分组
            </t-button>
          </div>
        </div>
      </template>
      <t-loading :loading="loadingPreview">
        <div class="group-grid">
          <div v-for="g in preview.groups" :key="`${g.band_id}_${g.group_letter}`" class="group-card">
            <div class="gc-head">
              <span class="gc-letter">{{ g.group_letter }} 组</span>
              <span class="gc-band">{{ g.band_label }}</span>
              <span class="gc-meta">{{ g.team_count }} 队 · {{ g.rounds }} 轮</span>
            </div>
            <ul class="gc-list">
              <li v-for="(t, i) in g.teams" :key="t.id" class="gc-item">
                <span class="gc-seed">{{ i + 1 }}</span>
                <span class="gc-name">{{ t.name }}</span>
                <span class="gc-school">{{ t.school }}</span>
              </li>
            </ul>
          </div>
        </div>
      </t-loading>
    </t-card>

    <!-- 已生成分组 -->
    <t-card class="panel">
      <template #header>
        <div class="panel-head">
          <span>已生成分组</span>
          <span class="panel-hint">
            已存入数据库 · 共 {{ groups.length }} 组 · 可调整组内队伍顺序
          </span>
        </div>
      </template>

      <t-loading :loading="loadingGroups">
        <div v-if="groups.length === 0" class="empty">
          该项目尚未生成分组。先点上方「分组预览」，再点「执行分组」或「保存为正式分组」写入数据库。
        </div>
        <div v-else class="group-grid">
          <div v-for="g in groups" :key="g.id" class="group-card">
            <div class="gc-head">
              <span class="gc-letter">{{ g.group_letter }} 组</span>
              <span class="gc-band">{{ g.band_label }}</span>
              <span class="gc-meta">{{ g.members.length }} 队 · {{ g.rounds }} 轮</span>
            </div>
            <ul class="gc-list">
              <li v-for="m in g.members" :key="m.id" class="gc-item">
                <t-input-number
                  :value="m.seed_no"
                  :min="1"
                  :max="g.members.length"
                  theme="column"
                  size="small"
                  style="width: 84px"
                  @change="(v) => changeSeed(m, v)"
                />
                <span class="gc-name">{{ m.team_name }}</span>
                <span class="gc-school">{{ m.school_name }}</span>
              </li>
            </ul>
          </div>
        </div>
      </t-loading>
    </t-card>

    <!-- 各组积分榜 -->
    <t-card class="panel">
      <template #header>
        <div class="panel-head">
          <span>小组积分榜</span>
          <span class="panel-hint">按所选组别与项目统计</span>
        </div>
      </template>

      <t-loading :loading="loadingStanding">
        <div v-if="standingGroups.length === 0" class="empty">暂无积分数据，请选择组别与项目后刷新</div>
        <div v-else class="standing-wrap">
          <div v-for="g in standingGroups" :key="g.group_id || g.group_letter" class="standing-block">
            <p class="sb-title">
              {{ g.band_label || '' }} {{ g.group_letter }} 组
            </p>
            <div class="table-scroll">
              <t-table
                :data="g.standing"
                :columns="standingColumns"
                row-key="id"
                bordered
                :empty="'暂无成绩'"
              >
                <template #points="{ row }">
                  <span class="pt">{{ row.points }}</span>
                </template>
                <template #diff="{ row }">
                  <span :class="row.diff > 0 ? 'pos' : row.diff < 0 ? 'neg' : 'dim'">
                    {{ row.diff > 0 ? '+' : '' }}{{ row.diff }}
                  </span>
                </template>
                <template #abandonCount="{ row }">
                  <t-tag v-if="row.abandonCount > 0" theme="warning" variant="light" size="small">
                    {{ row.abandonCount }}
                  </t-tag>
                  <span v-else class="dim">0</span>
                </template>
                <template #isVoided="{ row }">
                  <t-tag v-if="row.isVoided" theme="danger" variant="light" size="small">作废</t-tag>
                  <span v-else class="dim">有效</span>
                </template>
              </t-table>
            </div>
          </div>
        </div>
      </t-loading>
    </t-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useUserStore } from '../store/user';
import http from '../api/http';
import { message, confirm } from '../utils/ui';
import { bandLabel } from '../utils/band';

const store = useUserStore();

const events = ref([]);
const bands = ref([]);
const eventItemId = ref(null);
const bandId = ref(null);

const preview = ref({ groups: [], pairing_rule: 1, advance_count: 4, has_third_place: 1 });
const groups = ref([]);
const standingGroups = ref([]);

const loadingPreview = ref(false);
const loadingGroups = ref(false);
const loadingStanding = ref(false);

const standingColumns = [
  { colKey: 'rank', title: '名次', width: 60, align: 'center' },
  { colKey: 'team_name', title: '队名', minWidth: 140, ellipsis: true },
  { colKey: 'school_name', title: '学校', minWidth: 140, ellipsis: true },
  { colKey: 'played', title: '场', width: 52, align: 'center' },
  { colKey: 'win', title: '胜', width: 52, align: 'center' },
  { colKey: 'draw', title: '平', width: 52, align: 'center' },
  { colKey: 'lose', title: '负', width: 52, align: 'center' },
  { colKey: 'points', title: '积分', width: 62, align: 'center' },
  { colKey: 'scored', title: '得分', width: 62, align: 'center' },
  { colKey: 'conceded', title: '失分', width: 62, align: 'center' },
  { colKey: 'diff', title: '净胜分', width: 70, align: 'center' },
  { colKey: 'abandonCount', title: '弃权', width: 70, align: 'center' },
  { colKey: 'isVoided', title: '状态', width: 80, align: 'center' }
];

const currentEvent = computed(() => events.value.find((e) => e.id === eventItemId.value) || null);


function pairingLabel(v) {
  return { 1: '首尾配对', 2: '交叉配对', 3: '对位配对' }[v] || '首尾配对';
}

async function loadBase() {
  if (!store.competitionId) return;
  try {
    events.value = await http.get('/event/items', { params: { competition_id: store.competitionId } });
    bands.value = await http.get('/event/bands', { params: { competition_id: store.competitionId } });
    if (!eventItemId.value && events.value.length) {
      eventItemId.value = events.value.find((e) => e.category === 3)?.id ?? events.value[0].id;
    }
    if (!bandId.value && bands.value.length) {
      bandId.value = bands.value[0].id;
    }
  } catch (e) {
    message.error(e.message);
  }
}

async function loadGroups() {
  if (!store.competitionId) return;
  loadingGroups.value = true;
  try {
    const data = await http.get('/group/list', {
      params: {
        competition_id: store.competitionId,
        // 0 = 全部项目，不传该参数
        event_item_id: eventItemId.value || undefined
      }
    });
    groups.value = Array.isArray(data) ? data : [];
  } catch (e) {
    message.error(e.message);
  } finally {
    loadingGroups.value = false;
  }
}

/**
 * 自动定位到「已经存有分组」的项目/组别
 * —— 换账号、刷新页面后默认选中的是第一个项目，
 *    如果分组是在别的项目下生成的，页面会一片空白，看起来像"没保存"。
 */
async function autoPickSaved() {
  if (!store.competitionId) return;
  try {
    const all = await http.get('/group/list', {
      params: { competition_id: store.competitionId }
    });
    if (!Array.isArray(all) || all.length === 0) return;

    // 当前项目下已有分组就不用动
    if (eventItemId.value && all.some((g) => g.event_item_id === eventItemId.value)) {
      const bands = all.filter((g) => g.event_item_id === eventItemId.value).map((g) => g.band_id);
      if (bands.length && !bands.includes(bandId.value)) bandId.value = bands[0];
      return;
    }

    // 否则切到第一个有分组的项目
    const eventIds = [...new Set(all.map((g) => g.event_item_id))];
    const hit = eventIds.find((id) => events.value.some((e) => e.id === id));
    if (hit != null) {
      eventItemId.value = hit;
      const bands = [...new Set(all.filter((g) => g.event_item_id === hit).map((g) => g.band_id))];
      if (bands.length) bandId.value = bands[0];
    }
  } catch (e) { /* 定位失败不影响主流程 */ }
}

/** 初始化：加载基础数据 → 自动定位 → 回显已保存分组与积分榜 */
async function initAll() {
  if (!store.competitionId) return;
  await loadBase();
  await autoPickSaved();
  await loadGroups();
  await loadStanding();
}

async function loadStanding() {
  if (!store.competitionId || !bandId.value || !eventItemId.value) {
    standingGroups.value = [];
    return;
  }
  loadingStanding.value = true;
  try {
    const data = await http.get('/group/group-standing', {
      params: {
        competition_id: store.competitionId,
        band_id: bandId.value,
        event_item_id: eventItemId.value
      }
    });
    standingGroups.value = Array.isArray(data) ? data : [];
  } catch (e) {
    message.error(e.message);
  } finally {
    loadingStanding.value = false;
  }
}

async function doPreview() {
  if (!eventItemId.value) {
    message.warning('请先选择项目');
    return;
  }
  loadingPreview.value = true;
  try {
    const data = await http.get('/group/preview', {
      params: {
        competition_id: store.competitionId,
        event_item_id: eventItemId.value
      }
    });
    preview.value = {
      groups: data.groups || [],
      pairing_rule: data.pairing_rule,
      advance_count: data.advance_count,
      has_third_place: data.has_third_place
    };
    if (preview.value.groups.length === 0) {
      message.warning('该项目下没有已审核通过的队伍');
    }
  } catch (e) {
    message.error(e.message);
  } finally {
    loadingPreview.value = false;
  }
}

async function doGenerate() {
  if (!eventItemId.value) {
    message.warning('请先选择项目');
    return;
  }
  let accepted = true;
  await confirm('执行分组会覆盖该项目已有的分组与小组赛程，确定继续？', '执行分组', {
    confirmBtn: '确定执行'
  }).catch(() => { accepted = false; });
  if (!accepted) return;

  try {
    const r = await http.post('/group/generate', {
      competition_id: store.competitionId,
      event_item_id: eventItemId.value
    });
    const n = Array.isArray(r) ? r.length : 0;
    message.success(`已生成 ${n} 个小组`);
    loadGroups();
  } catch (e) {
    message.error(e.message);
  }
}

async function doGenerateMatches() {
  if (!eventItemId.value) {
    message.warning('请先选择项目');
    return;
  }
  try {
    const r = await http.post('/group/generate-matches', {
      competition_id: store.competitionId,
      event_item_id: eventItemId.value
    });
    message.success(`已生成 ${r.count || 0} 场小组赛（场序 ${r.seqFrom}-${r.seqTo}）`);
    loadStanding();
  } catch (e) {
    message.error(e.message);
  }
}

async function doTrackGenerate() {
  if (!eventItemId.value) {
    message.warning('请先选择项目');
    return;
  }
  try {
    await http.post('/group/track-generate', {
      competition_id: store.competitionId,
      event_item_id: eventItemId.value
    });
    message.success('径赛分组已生成');
    loadGroups();
  } catch (e) {
    message.error(e.message);
  }
}

async function changeSeed(member, seed) {
  if (seed == null) return;
  try {
    await http.put(`/group/member/${member.id}`, { seed_no: seed });
    message.success('已调整');
    loadGroups();
  } catch (e) {
    message.error(e.message);
  }
}

function onEventChange() {
  preview.value = { groups: [], pairing_rule: 1, advance_count: 4, has_third_place: 1 };
  loadGroups();
  loadStanding();
}

function onBandChange() {
  loadStanding();
}

onMounted(() => {
  initAll();
});
watch(() => store.competitionId, () => {
  preview.value = { groups: [], pairing_rule: 1, advance_count: 4, has_third_place: 1 };
  groups.value = [];
  standingGroups.value = [];
  initAll();
});
</script>

<style scoped>
.toolbar,
.panel {
  border-color: var(--app-border);
  border-radius: 8px;
}

.toolbar {
  margin-bottom: 14px;
}

.tb-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tb-meta {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--app-text-3);
}

.panel {
  margin-bottom: 14px;
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

.ph-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.group-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

.group-card {
  border: 1px solid var(--app-border);
  border-radius: 8px;
  padding: 12px;
  background: var(--app-surface);
}

.gc-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-bottom: 8px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--app-border-2);
}

.gc-letter {
  font-size: 13px;
  font-weight: 500;
  color: var(--td-brand-color);
}

.gc-band {
  font-size: 12px;
  color: var(--app-text-1);
  background: var(--app-bg);
  padding: 1px 7px;
  border-radius: 3px;
}

.gc-meta {
  font-size: 11px;
  color: var(--app-text-3);
  margin-left: auto;
}

.gc-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.gc-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  font-size: 13px;
}

.gc-seed {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 3px;
  background: var(--td-brand-color-light);
  color: var(--td-brand-color);
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.gc-name {
  color: var(--app-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gc-school {
  font-size: 11px;
  color: var(--app-text-3);
  margin-left: auto;
  flex-shrink: 0;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.standing-wrap {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sb-title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--app-text-1);
}

.table-scroll {
  overflow-x: auto;
}

.pt {
  font-weight: 500;
  color: var(--td-brand-color);
}

.pos {
  color: var(--app-success);
}

.neg {
  color: #e34d59;
}

.dim {
  font-size: 13px;
  color: var(--app-text-3);
}

.empty {
  text-align: center;
  padding: 40px 0;
  color: var(--app-text-3);
  font-size: 13px;
}

@media (max-width: 768px) {
  .group-grid {
    grid-template-columns: 1fr;
  }
  .panel-hint {
    display: none;
  }
  .tb-meta {
    display: none;
  }
}
</style>
