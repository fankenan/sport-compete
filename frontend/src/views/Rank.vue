<template>
  <div>
    <!-- 筛选 -->
    <t-card class="filter-card">
      <div class="filter-row">
        <t-select v-model="filterBand" placeholder="全部组别" clearable style="width: 140px" @change="load">
          <t-option v-for="b in bands" :key="b.id" :label="bandLabel(b)" :value="b.id" />
        </t-select>
        <t-select v-model="filterEvent" placeholder="全部项目" clearable style="width: 140px" @change="load">
          <t-option v-for="e in events" :key="e.id" :label="e.name" :value="e.id" />
        </t-select>
        <t-button variant="outline" @click="load">刷新</t-button>
        <t-button v-if="store.isAdmin" theme="primary" variant="outline" @click="openSet">手动设置名次</t-button>
      </div>
    </t-card>

    <!-- 名次表 -->
    <t-card class="panel">
      <template #header>
        <div class="panel-head">
          <span>最终名次</span>
          <span class="panel-hint">共 {{ ranks.length }} 条</span>
        </div>
      </template>

      <div v-if="ranks.length === 0" class="empty">
        暂无名次记录。小组赛与淘汰赛结束后，系统会自动写入名次。
      </div>

      <div v-else class="rank-groups">
        <div v-for="g in grouped" :key="g.key" class="rank-group">
          <p class="group-title">{{ g.title }}</p>
          <div class="rank-list">
            <div v-for="r in g.items" :key="r.id" class="rank-item" :class="`r${r.rank_no}`">
              <span class="rank-no">{{ r.rank_no }}</span>
              <span class="rank-name">{{ r.team_name }}</span>
              <span class="rank-school">{{ r.school_name }}</span>
            </div>
          </div>
        </div>
      </div>
    </t-card>

    <!-- 设置名次 -->
    <!-- attach="body"：把弹窗挂到 body，避免被页面卡片的宽度 / 祖先 transform 裁掉 -->
    <t-dialog
      v-model:visible="setVisible"
      header="设置名次"
      attach="body"
      :width="isMobile ? '92%' : '520px'"
    >
      <t-form label-width="90px" :data="setForm">
        <t-form-item label="组别">
          <t-select v-model="setForm.band_id" style="width: 100%">
            <t-option v-for="b in bands" :key="b.id" :label="bandLabel(b)" :value="b.id" />
          </t-select>
        </t-form-item>
        <t-form-item label="项目">
          <t-select v-model="setForm.event_item_id" style="width: 100%">
            <t-option v-for="e in events" :key="e.id" :label="e.name" :value="e.id" />
          </t-select>
        </t-form-item>
        <t-form-item label="队伍">
          <t-select v-model="setForm.team_entry_id" filterable style="width: 100%">
            <t-option v-for="t in teams" :key="t.id" :label="`${t.team_name}（${t.school_name}）`" :value="t.id" />
          </t-select>
        </t-form-item>
        <t-form-item label="名次">
          <t-input-number v-model="setForm.rank_no" :min="1" :max="20" />
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button variant="outline" @click="setVisible = false">取消</t-button>
        <t-button theme="primary" @click="doSet">保存</t-button>
      </template>
    </t-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useUserStore } from '../store/user';
import http from '../api/http';
import { message } from '../utils/ui';
import { bandLabel } from '../utils/band';

const store = useUserStore();
const isMobile = ref(window.innerWidth <= 768);

const ranks = ref([]);
const bands = ref([]);
const events = ref([]);
const teams = ref([]);
const filterBand = ref(null);
const filterEvent = ref(null);

const setVisible = ref(false);
const setForm = ref({ band_id: null, event_item_id: null, team_entry_id: null, rank_no: 1 });

const grouped = computed(() => {
  const map = new Map();
  ranks.value.forEach((r) => {
    const key = `${r.band_id}_${r.event_item_id}`;
    if (!map.has(key)) {
      map.set(key, { key, title: `${r.band_label} ${r.event_name}`, items: [] });
    }
    map.get(key).items.push(r);
  });
  return [...map.values()];
});


async function load() {
  if (!store.competitionId) return;
  try {
    ranks.value = await http.get('/rank/list', {
      params: {
        competition_id: store.competitionId,
        band_id: filterBand.value || undefined,
        event_item_id: filterEvent.value || undefined
      }
    });
  } catch (e) {
    message.error(e.message);
  }
}

async function loadBase() {
  if (!store.competitionId) return;
  try {
    bands.value = await http.get('/event/bands', { params: { competition_id: store.competitionId } });
    events.value = await http.get('/event/items', { params: { competition_id: store.competitionId } });
    const entries = await http.get('/entry/list', {
      params: { competition_id: store.competitionId, status: 2 }
    });
    teams.value = entries.map((e) => ({
      id: e.id,
      team_name: e.team_name,
      school_name: e.school_name
    }));
  } catch (e) { console.error(e); }
}

function openSet() {
  setForm.value = {
    band_id: filterBand.value || bands.value[0]?.id,
    event_item_id: filterEvent.value || events.value[0]?.id,
    team_entry_id: null,
    rank_no: 1
  };
  setVisible.value = true;
}

async function doSet() {
  if (!setForm.value.team_entry_id) {
    message.warning('请选择队伍');
    return;
  }
  try {
    await http.post('/rank/set', {
      competition_id: store.competitionId,
      ...setForm.value
    });
    message.success('名次已保存');
    setVisible.value = false;
    load();
  } catch (e) {
    message.error(e.message);
  }
}

onMounted(() => { loadBase(); load(); });
watch(() => store.competitionId, () => { loadBase(); load(); });
</script>

<style scoped>
.filter-card,
.panel {
  border-color: var(--app-border);
  border-radius: 8px;
}

.filter-card {
  margin-bottom: 14px;
}

.filter-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
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

.empty {
  text-align: center;
  padding: 50px 20px;
  color: var(--app-text-3);
  font-size: 13px;
}

.rank-groups {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}

.rank-group {
  background: var(--app-bg-2);
  border: 1px solid var(--app-border);
  border-radius: 8px;
  padding: 12px;
}

.group-title {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 500;
  color: var(--app-text-1);
}

.rank-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.rank-item {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--app-surface);
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 13px;
}

.rank-no {
  width: 20px;
  height: 20px;
  border-radius: 3px;
  background: var(--app-bg-2);
  color: var(--app-text-3);
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.rank-item.r1 .rank-no { background: #f5dab1; color: #b88230; }
.rank-item.r2 .rank-no { background: #dfe4ea; color: #6b7b8d; }
.rank-item.r3 .rank-no { background: #f0d9c8; color: #a8703f; }

.rank-name {
  color: var(--app-text-1);
  font-weight: 500;
  flex-shrink: 0;
}

.rank-school {
  color: var(--app-text-3);
  font-size: 11px;
  margin-left: auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
