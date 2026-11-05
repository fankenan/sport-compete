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
            <!--
              【清理假开关】原来这里有 4 个在大屏端从未被消费的设置：
                主要版式(layout) —— Screen.vue 里零引用
                待赛(show_upcoming) —— uuid 模式没有对应版块，接口也不返回
                每屏停留(dwell_seconds) / 循环播放(loop_flag) —— 只驱动 scIndex，
                  而 scIndex 从未出现在模板里，队列轮播是死功能
              给管理员留假开关比不给更糟：他会以为大屏已经配好了。
              现在只保留真正生效的项；版式轮播留待后续实现。
            -->
            <t-form-item label="显示板块">
              <t-checkbox v-model="cfg.show_team_score" :true-value="1" :false-value="0">团体总分</t-checkbox>
              <t-checkbox v-model="cfg.show_latest" :true-value="1" :false-value="0" style="margin-left:12px">最新成绩</t-checkbox>
              <t-checkbox v-model="cfg.show_record" :true-value="1" :false-value="0" style="margin-left:12px">破纪录滚动</t-checkbox>
            </t-form-item>
            <t-form-item label="刷新间隔">
              <t-input-number v-model="cfg.refresh_seconds" :min="5" :max="300" style="width:120px" />
              <span class="hint" style="margin-left:8px">秒</span>
            </t-form-item>
            <t-form-item label="最新成绩条数">
              <t-input-number v-model="cfg.latest_count" :min="3" :max="50" style="width:120px" />
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
          <div class="share-row">
            <span class="share-label">赛事大屏</span>
            <t-input :value="screenUrl" readonly style="flex:1">
              <template #suffix>
                <t-link theme="primary" @click="copyText(screenUrl, '大屏链接')">复制</t-link>
              </template>
            </t-input>
            <t-button size="small" variant="outline" @click="openScreen">打开</t-button>
          </div>

          <!-- 原来只有大屏链接，观众拿到链接后看不到成绩页 -->
          <div class="share-row" style="margin-top:8px">
            <span class="share-label">成绩查询</span>
            <t-input :value="publicUrl" readonly style="flex:1">
              <template #suffix>
                <t-link theme="primary" @click="copyText(publicUrl, '成绩查询链接')">复制</t-link>
              </template>
            </t-input>
            <t-button size="small" variant="outline" @click="openPublic">打开</t-button>
          </div>

          <div class="hint" style="margin-top:8px">
            任何人拿到链接都能查看，无需登录。成绩查询页包含赛程总表、成绩、小组积分与淘汰赛对阵。
          </div>
        </t-card>
      </t-col>
    </t-row>

    <!--
      【清理】原「播放队列」卡片也已移除：
      队列数据存在 screen_config.queue 里，但大屏端 Screen.vue 的 scIndex
      从未出现在模板中 —— 队列轮播是死功能，管理员改了没有任何效果。
      版式/队列轮播计划后续单独实现（需要大屏端按队列取不同板块的数据）。
    -->
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
/** 公开成绩查询页链接 —— 原来只有大屏链接，观众找不到成绩页 */
const publicUrl = computed(() => {
  if (!uuid.value) return '（保存后生成）';
  return `${location.origin}${location.pathname}#/public/${uuid.value}`;
});

function copyText(text, label) {
  if (!text || text.startsWith('（')) {
    message.warning('请先保存设置生成分享码');
    return;
  }
  const done = () => message.success(`${label}已复制`);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { message.error('复制失败，请手动复制'); }
  document.body.removeChild(ta);
}

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
    // 【副作用修复】原来这里顺手写 public_flag: 0 ——
    // 「打开大屏控制端」变成一个会偷偷把公开成绩查询关掉的操作，
    // 管理员之后想开公开页会被这个隐藏写入卡住。
    // 现在只生成 uuid，不动 public_flag。
    const r = await http.put('/track-stats/public-config', { competition_id: compId.value, generate_uuid: 1 });
    uuid.value = r?.data?.uuid || r?.uuid || '';
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

function openPublic() {
  if (!uuid.value) { MessagePlugin.warning('分享码未生成'); return; }
  window.open(publicUrl.value, '_blank');
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

/* 分享链接行 */
.share-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.share-label {
  font-size: 13px;
  color: var(--app-text-2);
  min-width: 62px;
  flex-shrink: 0;
}
.insert-bar { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.q-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.q-i { width: 24px; height: 24px; line-height: 24px; text-align: center; border-radius: 4px;
       background: #e7eaff; color: var(--td-brand-color); font-size: 12px; font-weight: 600; }
.center { padding: 20px 0; text-align: center; }
.muted { color: var(--app-text-3); font-size: 13px; }
</style>
