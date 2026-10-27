<template>
  <div class="page">
    <div class="page-head">
      <h2>大屏控制端</h2>
      <div class="head-right">
        <t-select v-model="compId" :options="compOptions" placeholder="选择赛事" style="width: 220px"
                  @change="onCompChange" />
        <t-button theme="primary" @click="openScreen">打开大屏</t-button>
      </div>
    </div>

    <t-row :gutter="16">
      <t-col :span="7">
        <t-card title="播放设置" size="small">
          <t-form :data="cfg" label-width="110px">
            <t-form-item label="主题配色">
              <t-radio-group v-model="cfg.theme">
                <t-radio value="DARK">深色</t-radio>
                <t-radio value="LIGHT">浅色</t-radio>
                <t-radio value="BLUE">科技蓝</t-radio>
                <t-radio value="RED">中国红</t-radio>
                <t-radio value="GREEN">运动绿</t-radio>
              </t-radio-group>
            </t-form-item>
            <t-form-item label="主要版式">
              <t-radio-group v-model="cfg.layout">
                <t-radio value="MIXED">综合</t-radio>
                <t-radio value="TEAM_SCORE">团体总分</t-radio>
                <t-radio value="LATEST">最新成绩</t-radio>
                <t-radio value="RECORD">破纪录</t-radio>
              </t-radio-group>
            </t-form-item>
            <t-form-item label="显示板块">
              <t-checkbox v-model="cfg.show_team_score" :true-value="1" :false-value="0">团体总分</t-checkbox>
              <t-checkbox v-model="cfg.show_latest" :true-value="1" :false-value="0" style="margin-left:12px">最新成绩</t-checkbox>
              <t-checkbox v-model="cfg.show_upcoming" :true-value="1" :false-value="0" style="margin-left:12px">待赛</t-checkbox>
              <t-checkbox v-model="cfg.show_record" :true-value="1" :false-value="0" style="margin-left:12px">破纪录滚动</t-checkbox>
            </t-form-item>
            <t-form-item label="每屏停留">
              <t-input-number v-model="cfg.dwell_seconds" :min="3" :max="120" style="width:120px" />
              <span class="hint" style="margin-left:8px">秒</span>
            </t-form-item>
            <t-form-item label="刷新间隔">
              <t-input-number v-model="cfg.refresh_seconds" :min="5" :max="300" style="width:120px" />
              <span class="hint" style="margin-left:8px">秒</span>
            </t-form-item>
            <t-form-item label="最新成绩条数">
              <t-input-number v-model="cfg.latest_count" :min="3" :max="50" style="width:120px" />
            </t-form-item>
            <t-form-item label="循环播放">
              <t-switch v-model="cfg.loop_flag" :custom-value="[1, 0]" />
            </t-form-item>
            <t-form-item>
              <t-button theme="primary" :loading="saving" @click="saveConfig">保存设置</t-button>
            </t-form-item>
          </t-form>
        </t-card>
      </t-col>

      <t-col :span="5">
        <t-card title="紧急插播" size="small">
          <t-alert theme="warning" :message="cfg.insert_flag ? '插播进行中' : '当前无插播'"
                   style="margin-bottom:12px" />
          <t-textarea v-model="insertText" placeholder="输入要插播到大屏的文字，如：请各代表队领队到主席台开会"
                      :autosize="{ minRows: 3, maxRows: 6 }" />
          <div class="insert-bar">
            <t-input-number v-model="insertMinutes" :min="1" :max="120" style="width:110px" />
            <span class="hint">分钟后自动关闭</span>
            <t-button theme="warning" style="margin-left:auto" @click="sendInsert">立即插播</t-button>
            <t-button variant="outline" @click="clearInsert">关闭插播</t-button>
          </div>
          <div v-if="cfg.insert_until" class="hint">截止：{{ cfg.insert_until }}</div>
        </t-card>

        <t-card title="分享链接" size="small" style="margin-top:12px">
          <t-input :value="screenUrl" readonly>
            <template #suffix>
              <t-link theme="primary" @click="copyLink">复制</t-link>
            </template>
          </t-input>
          <div class="hint" style="margin-top:8px">任何人拿到链接都能查看，无需登录</div>
        </t-card>
      </t-col>
    </t-row>

    <t-card title="播放队列" size="small" style="margin-top:16px">
      <template #subtitle>
        <span class="hint">留空 = 自动播放全部已确认项目；勾选后按勾选顺序播放</span>
      </template>
      <template #actions>
        <t-button size="small" variant="outline" @click="selectAllConfirmed">自动填入已确认项目</t-button>
        <t-button size="small" variant="outline" @click="queue = []" style="margin-left:8px">清空</t-button>
      </template>

      <div v-if="!queue.length" class="center muted">队列为空，大屏将自动播放全部项目</div>
      <div v-for="(q, i) in queue" :key="i" class="q-row">
        <span class="q-i">{{ i + 1 }}</span>
        <t-select v-model="q.event_item_id" :options="eventOptions" placeholder="项目" style="width:180px" />
        <t-select v-model="q.band_id" :options="bandOptions" placeholder="组别（可空）" clearable style="width:160px" />
        <t-input-number v-model="q.seconds" :min="3" :max="120" style="width:100px" />
        <span class="hint">秒</span>
        <t-button theme="danger" variant="outline" size="small" @click="queue.splice(i, 1)">删除</t-button>
      </div>
      <t-button variant="dashed" block style="margin-top:10px"
                @click="queue.push({ event_item_id: null, band_id: null, seconds: 12 })">+ 添加一项</t-button>
      <div style="margin-top:12px">
        <t-button theme="primary" :loading="saving" @click="saveConfig">保存队列</t-button>
      </div>
    </t-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { MessagePlugin } from 'tdesign-vue-next';
import http from '../api/http';
import { useUserStore } from '../store/user';

const store = useUserStore();
const compId = ref(store.competitionId);
const compOptions = ref([]);
const saving = ref(false);
const bandList = ref([]);
const eventList = ref([]);
const queue = ref([]);
const insertText = ref('');
const insertMinutes = ref(5);
const uuid = ref('');

const cfg = reactive({
  theme: 'DARK', layout: 'MIXED', loop_flag: 1, dwell_seconds: 12,
  show_team_score: 1, show_latest: 1, show_upcoming: 1, show_record: 1,
  latest_count: 12, refresh_seconds: 30,
  insert_flag: 0, insert_text: null, insert_until: null
});

const bandOptions = computed(() => bandList.value.map((b) => ({ label: b.label || ('组别' + b.id), value: b.id })));
const eventOptions = computed(() => eventList.value.map((e) => ({ label: e.name, value: e.id })));
const screenUrl = computed(() => {
  if (!uuid.value) return '（保存后生成）';
  return `${location.origin}${location.pathname}#/screen/${uuid.value}`;
});

onMounted(async () => {
  const list = await http.get('/competition/list') || [];
  compOptions.value = list.map((c) => ({ label: c.name, value: c.id }));
  if (compId.value) await onCompChange();
});

async function onCompChange() {
  store.setCompetition(compId.value);
  await Promise.all([loadBands(), loadEvents(), loadConfig(), loadUuid()]);
}

async function loadBands() {
  bandList.value = await http.get('/band/list', { params: { competition_id: compId.value } }) || [];
}
async function loadEvents() {
  eventList.value = await http.get('/event/items', { params: { competition_id: compId.value } }) || [];
}
async function loadUuid() {
  const c = await http.get('/track-stats/public-config', { params: { competition_id: compId.value } });
  uuid.value = c?.uuid || '';
  if (!uuid.value) {
    const r = await http.put('/track-stats/public-config', { competition_id: compId.value, public_flag: 0 });
    uuid.value = r?.data?.uuid || '';
  }
}

async function loadConfig() {
  const c = await http.get('/screen-control/config', { params: { competition_id: compId.value } });
  if (c) {
    Object.assign(cfg, {
      theme: c.theme || 'DARK',
      layout: c.layout || 'MIXED',
      loop_flag: Number(c.loop_flag) || 0,
      dwell_seconds: Number(c.dwell_seconds) || 12,
      show_team_score: Number(c.show_team_score) || 0,
      show_latest: Number(c.show_latest) || 0,
      show_upcoming: Number(c.show_upcoming) || 0,
      show_record: Number(c.show_record) || 0,
      latest_count: Number(c.latest_count) || 12,
      refresh_seconds: Number(c.refresh_seconds) || 30,
      insert_flag: Number(c.insert_flag) || 0,
      insert_text: c.insert_text || null,
      insert_until: c.insert_until || null
    });
    queue.value = c.queue_json || [];
    insertText.value = c.insert_text || '';
  }
}

async function saveConfig() {
  saving.value = true;
  try {
    const valid = queue.value.filter((q) => q.event_item_id);
    await http.put('/screen-control/config', {
      competition_id: compId.value,
      theme: cfg.theme, layout: cfg.layout, loop_flag: cfg.loop_flag,
      dwell_seconds: cfg.dwell_seconds, refresh_seconds: cfg.refresh_seconds,
      show_team_score: cfg.show_team_score, show_latest: cfg.show_latest,
      show_upcoming: cfg.show_upcoming, show_record: cfg.show_record,
      latest_count: cfg.latest_count,
      queue_json: valid
    });
    MessagePlugin.success('大屏配置已保存');
  } finally { saving.value = false; }
}

async function selectAllConfirmed() {
  const items = await http.get('/screen-control/queue-items', { params: { competition_id: compId.value } }) || [];
  queue.value = items.filter((i) => Number(i.confirmed_count) > 0)
    .map((i) => ({ event_item_id: i.event_item_id, band_id: i.band_id, seconds: 12 }));
  MessagePlugin.success(`已填入 ${queue.value.length} 项`);
}

async function sendInsert() {
  if (!insertText.value) { MessagePlugin.warning('请填写插播内容'); return; }
  const r = await http.post('/screen-control/insert', {
    competition_id: compId.value, insert_text: insertText.value, minutes: insertMinutes.value
  });
  MessagePlugin.success(r?.message || '插播已开启');
  await loadConfig();
}

async function clearInsert() {
  await http.post('/screen-control/insert/clear', { competition_id: compId.value });
  MessagePlugin.success('插播已关闭');
  await loadConfig();
}

function openScreen() {
  if (!uuid.value) { MessagePlugin.warning('分享码未生成'); return; }
  window.open(screenUrl.value, '_blank');
}

async function copyLink() {
  try { await navigator.clipboard.writeText(screenUrl.value); MessagePlugin.success('链接已复制'); }
  catch { MessagePlugin.info(screenUrl.value); }
}
</script>

<style scoped>
.page { padding: 16px; }
.page-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
.page-head h2 { margin: 0; font-size: 20px; font-weight: 600; }
.head-right { display: flex; gap: 8px; align-items: center; }
.hint { font-size: 12px; color: var(--app-text-3); }
.insert-bar { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.q-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.q-i { width: 24px; height: 24px; line-height: 24px; text-align: center; border-radius: 4px;
       background: #e7eaff; color: var(--td-brand-color); font-size: 12px; font-weight: 600; }
.center { padding: 20px 0; text-align: center; }
.muted { color: var(--app-text-3); font-size: 13px; }
</style>
