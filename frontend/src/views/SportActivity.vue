<template>
  <div class="sa-page">
    <!-- 顶部：学期 + 阶段 -->
    <t-card class="sa-head">
      <div class="sa-head-row">
        <div class="sa-title">
          <span class="sa-title-text">学校体育活动上报</span>
          <span class="sa-school">{{ form.school_name || '—' }}</span>
        </div>
        <div class="sa-head-right">
          <t-select v-model="term" style="width: 210px" @change="onTermChange">
            <t-option v-for="t in termOptions" :key="t.value" :label="t.label" :value="t.value" />
          </t-select>
          <t-tag v-if="form.id || form.status" :theme="statusTheme" variant="light">
            {{ statusText }}
          </t-tag>
        </div>
      </div>

      <div class="sa-phases">
        <div
          v-for="p in phases"
          :key="p.value"
          class="sa-phase"
          :class="{ active: phase === p.value, done: phaseStatus(p.value) > 0 }"
          @click="switchPhase(p.value)"
        >
          <span class="sa-phase-name">{{ p.label }}</span>
          <span class="sa-phase-state">{{ phaseStateText(p.value) }}</span>
        </div>
      </div>

      <t-alert v-if="form.status === 3" theme="error" class="sa-alert">
        退回原因：{{ form.audit_note || '未填写' }}（修改后可重新提交）
      </t-alert>
      <t-alert v-else-if="form.status === 2" theme="success" class="sa-alert">
        本科目已通过审核{{ form.audited_at ? '（' + fmtTime(form.audited_at) + '）' : '' }}，如需修改请联系教育局退回。
      </t-alert>
      <t-alert v-else-if="form.status === 1" theme="info" class="sa-alert">
        已提交，等待教育局审核。
      </t-alert>
    </t-card>

    <t-loading :loading="loading" size="small">
      <!-- 一、阳光大课间 -->
      <t-card class="sa-block">
        <div class="sa-block-head">
          <span class="sa-bar"></span>
          <span class="sa-block-title">一、阳光大课间</span>
          <span class="sa-block-tip">“是否落实15分钟”由时长自动判定，无需单独填报</span>
        </div>
        <t-row :gutter="[16, 12]">
          <t-col :xs="12" :md="4">
            <div class="sa-label">是否开展</div>
            <t-radio-group v-model="form.recess_enabled" :disabled="readonly" @change="onRecessChange">
              <t-radio :value="1">是</t-radio>
              <t-radio :value="0">否</t-radio>
            </t-radio-group>
          </t-col>
          <t-col :xs="12" :md="4">
            <div class="sa-label">每次时长（分钟）</div>
            <div class="sa-inline">
              <t-input-number v-model="form.recess_minutes" :min="0" :max="120" :disabled="readonly || !form.recess_enabled" style="width: 120px" />
              <span v-if="form.recess_enabled" class="sa-badge" :class="metrics.recess_ok ? 'ok' : 'bad'">
                {{ metrics.recess_ok ? '已达标' : '未达15分钟' }}
              </span>
            </div>
          </t-col>
          <t-col :xs="12" :md="4">
            <div class="sa-label">每周次数</div>
            <t-input-number v-model="form.recess_weekly" :min="0" :max="7" :disabled="readonly || !form.recess_enabled" style="width: 120px" />
          </t-col>
          <t-col :xs="24" :md="12">
            <div class="sa-label">主要形式</div>
            <t-checkbox-group v-model="recessForms" :disabled="readonly" @change="(v) => syncList(v, 'recess_forms')">
              <t-checkbox v-for="o in RECESS_FORMS" :key="o" :value="o">{{ o }}</t-checkbox>
            </t-checkbox-group>
          </t-col>
          <t-col :xs="12" :md="6">
            <div class="sa-label">参与年级</div>
            <t-input v-model="form.recess_scope" placeholder="如 全校 / 三至六年级" :disabled="readonly" :maxlength="64" />
          </t-col>
        </t-row>
        <PhotoBox section="recess" :list="photos.recess" :readonly="readonly" @pick="onPick" @remove="removePhoto" />
      </t-card>

      <!-- 二、每天体育活动时间 -->
      <t-card class="sa-block">
        <div class="sa-block-head">
          <span class="sa-bar"></span>
          <span class="sa-block-title">二、每天体育活动时间</span>
          <span class="sa-block-tip">系统自动加总，判断是否达到每天 1 小时</span>
        </div>
        <t-row :gutter="[16, 12]">
          <t-col :xs="12" :md="6">
            <div class="sa-label">体育课 · 每周节数</div>
            <t-input-number v-model="form.pe_weekly" :min="0" :max="20" :disabled="readonly" style="width: 120px" />
          </t-col>
          <t-col :xs="12" :md="6">
            <div class="sa-label">体育课 · 每节分钟</div>
            <t-input-number v-model="form.pe_minutes" :min="0" :max="90" :disabled="readonly" style="width: 120px" />
          </t-col>
          <t-col :xs="12" :md="6">
            <div class="sa-label">大课间（自动带入）</div>
            <div class="sa-readonly">{{ form.recess_enabled ? metrics.recess_daily + ' 分钟/天' : '未开展' }}</div>
          </t-col>
          <t-col :xs="12" :md="6">
            <div class="sa-label">课后体育活动（分钟/天）</div>
            <t-input-number v-model="form.after_class_minutes" :min="0" :max="180" :disabled="readonly" style="width: 120px" />
          </t-col>
        </t-row>
        <div class="sa-summary" :class="metrics.daily_ok ? 'ok' : 'bad'">
          每天合计 <b>{{ metrics.daily_minutes }} 分钟</b>
          <span>{{ metrics.daily_ok ? '已满足 1 小时' : '未达到 60 分钟' }}</span>
        </div>
      </t-card>

      <!-- 三、校内竞赛 -->
      <t-card class="sa-block">
        <div class="sa-block-head">
          <span class="sa-bar"></span>
          <span class="sa-block-title">三、校内竞赛</span>
          <span class="sa-block-tip">按本学期累计</span>
        </div>
        <t-row :gutter="[16, 12]">
          <t-col :xs="12" :md="4">
            <div class="sa-label">本学期举办次数</div>
            <t-input-number v-model="form.comp_count" :min="0" :max="99" :disabled="readonly" style="width: 120px" />
          </t-col>
          <t-col :xs="12" :md="4">
            <div class="sa-label">参与学生数</div>
            <t-input-number v-model="form.comp_join_count" :min="0" :max="99999" :disabled="readonly" style="width: 140px" />
          </t-col>
          <t-col :xs="24" :md="16">
            <div class="sa-label">覆盖项目</div>
            <t-checkbox-group v-model="compSports" :disabled="readonly" @change="(v) => syncList(v, 'comp_sports')">
              <t-checkbox v-for="o in COMP_SPORTS" :key="o" :value="o">{{ o }}</t-checkbox>
            </t-checkbox-group>
          </t-col>
          <t-col :span="24">
            <div class="sa-label">主要做法与亮点</div>
            <t-textarea v-model="form.comp_desc" :disabled="readonly" :maxlength="500" placeholder="如：按年级分组，每月一项，纳入班级考核……" :autosize="{ minRows: 3, maxRows: 6 }" />
          </t-col>
        </t-row>
        <PhotoBox section="comp" :list="photos.comp" :readonly="readonly" @pick="onPick" @remove="removePhoto" />
      </t-card>

      <!-- 四、武术进校园 -->
      <t-card class="sa-block">
        <div class="sa-block-head">
          <span class="sa-bar"></span>
          <span class="sa-block-title">四、武术进校园</span>
        </div>
        <t-row :gutter="[16, 12]">
          <t-col :xs="12" :md="4">
            <div class="sa-label">是否开展</div>
            <t-radio-group v-model="form.wushu_enabled" :disabled="readonly">
              <t-radio :value="1">是</t-radio>
              <t-radio :value="0">否</t-radio>
            </t-radio-group>
          </t-col>
          <t-col :xs="12" :md="4">
            <div class="sa-label">每周次数</div>
            <t-input-number v-model="form.wushu_weekly" :min="0" :max="20" :disabled="readonly || !form.wushu_enabled" style="width: 120px" />
          </t-col>
          <t-col :xs="12" :md="4">
            <div class="sa-label">师资来源</div>
            <t-input v-model="form.wushu_teacher" placeholder="如 校内教师 / 外聘" :disabled="readonly || !form.wushu_enabled" :maxlength="64" />
          </t-col>
          <t-col :span="24">
            <div class="sa-label">开展形式</div>
            <t-checkbox-group v-model="wushuForms" :disabled="readonly || !form.wushu_enabled" @change="(v) => syncList(v, 'wushu_forms')">
              <t-checkbox v-for="o in WUSHU_FORMS" :key="o" :value="o">{{ o }}</t-checkbox>
            </t-checkbox-group>
          </t-col>
          <t-col :xs="12" :md="8">
            <div class="sa-label">覆盖年级</div>
            <t-input v-model="form.wushu_scope" placeholder="如 三至六年级" :disabled="readonly || !form.wushu_enabled" :maxlength="64" />
          </t-col>
          <t-col :span="24">
            <div class="sa-label">成效与特色</div>
            <t-textarea v-model="form.wushu_desc" :disabled="readonly || !form.wushu_enabled" :maxlength="500" :autosize="{ minRows: 2, maxRows: 5 }" />
          </t-col>
        </t-row>
        <PhotoBox section="wushu" :list="photos.wushu" :readonly="readonly || !form.wushu_enabled" @pick="onPick" @remove="removePhoto" />
      </t-card>

      <!-- 五、体育作业 -->
      <t-card class="sa-block">
        <div class="sa-block-head">
          <span class="sa-bar"></span>
          <span class="sa-block-title">五、体育作业</span>
        </div>
        <t-row :gutter="[16, 12]">
          <t-col :xs="12" :md="4">
            <div class="sa-label">是否布置</div>
            <t-radio-group v-model="form.hw_enabled" :disabled="readonly">
              <t-radio :value="1">是</t-radio>
              <t-radio :value="0">否</t-radio>
            </t-radio-group>
          </t-col>
          <t-col :xs="12" :md="4">
            <div class="sa-label">布置频次</div>
            <t-select v-model="form.hw_freq" :disabled="readonly || !form.hw_enabled" clearable placeholder="请选择" style="width: 160px">
              <t-option v-for="o in HW_FREQ" :key="o" :label="o" :value="o" />
            </t-select>
          </t-col>
          <t-col :span="24">
            <div class="sa-label">内容形式</div>
            <t-checkbox-group v-model="hwForms" :disabled="readonly || !form.hw_enabled" @change="(v) => syncList(v, 'hw_forms')">
              <t-checkbox v-for="o in HW_FORMS" :key="o" :value="o">{{ o }}</t-checkbox>
            </t-checkbox-group>
          </t-col>
          <t-col :span="24">
            <div class="sa-label">检查与反馈方式</div>
            <t-input v-model="form.hw_check" placeholder="如 家长拍照打卡、体育课抽查" :disabled="readonly || !form.hw_enabled" :maxlength="200" />
          </t-col>
        </t-row>
        <PhotoBox section="hw" :list="photos.hw" :readonly="readonly || !form.hw_enabled" @pick="onPick" @remove="removePhoto" />
      </t-card>

      <div class="sa-foot">
        <t-button variant="outline" :loading="saving" :disabled="readonly" @click="save(false)">暂存草稿</t-button>
        <t-button theme="primary" :loading="saving" :disabled="readonly" @click="save(true)">提交上报</t-button>
      </div>
    </t-loading>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { MessagePlugin } from 'tdesign-vue-next';
import http from '../api/http';
import { useUserStore } from '../store/user';
import PhotoBox from '../components/PhotoBox.vue';

const store = useUserStore();

const RECESS_FORMS = ['跑操', '广播操', '武术操', '自编操', '球类活动', '跳绳', '其他'];
const COMP_SPORTS = ['篮球', '足球', '排球', '乒乓球', '羽毛球', '田径', '跳绳', '拔河', '趣味运动', '其他'];
const WUSHU_FORMS = ['武术课', '大课间融入', '社团活动', '校队训练', '展演比赛'];
const HW_FREQ = ['每天', '每周3次以上', '每周1-2次', '不固定'];
const HW_FORMS = ['跳绳', '跑步', '力量练习', '仰卧起坐', '亲子运动', '球类', '其他'];

const termOptions = (() => {
  const now = new Date();
  const y = now.getFullYear();
  const startYear = now.getMonth() + 1 >= 9 ? y : y - 1;
  const list = [];
  for (let i = 0; i < 2; i++) {
    const sy = startYear - i;
    list.push({ label: `${sy}—${sy + 1}学年 第一学期`, value: `${sy}-${sy + 1}-1` });
    list.push({ label: `${sy}—${sy + 1}学年 第二学期`, value: `${sy}-${sy + 1}-2` });
  }
  return list;
})();

const term = ref(termOptions[0].value);
const phase = ref(1);
const phases = [
  { label: '学期初', value: 1 },
  { label: '学期中', value: 2 },
  { label: '学期末', value: 3 }
];

const loading = ref(false);
const saving = ref(false);
const history = ref({});

const blank = () => ({
  id: null, school_id: null, school_name: '', term: term.value, phase: phase.value,
  status: 0, audit_note: '',
  recess_enabled: 1, recess_minutes: 20, recess_weekly: 5, recess_forms: '', recess_scope: '全校',
  pe_weekly: 3, pe_minutes: 40, after_class_minutes: 0,
  comp_count: 0, comp_sports: '', comp_join_count: 0, comp_desc: '',
  wushu_enabled: 0, wushu_forms: '', wushu_scope: '', wushu_weekly: 0, wushu_teacher: '', wushu_desc: '',
  hw_enabled: 0, hw_freq: '', hw_forms: '', hw_check: ''
});

const form = reactive(blank());
const photos = reactive({ recess: [], time: [], comp: [], wushu: [], hw: [] });

const recessForms = ref([]);
const compSports = ref([]);
const wushuForms = ref([]);
const hwForms = ref([]);

const readonly = computed(() => Number(form.status) === 2);

const statusText = computed(() => {
  if (!form.id) return '未填报';
  return ({ 0: '草稿', 1: '待审核', 2: '已通过', 3: '已退回' })[form.status] || '未填报';
});
const statusTheme = computed(() => ({ 0: 'default', 1: 'warning', 2: 'success', 3: 'danger' })[form.status] || 'default');

/** 与后端 calcMetrics 保持一致 */
const metrics = computed(() => {
  const rm = Number(form.recess_minutes) || 0;
  const rw = Number(form.recess_weekly) || 0;
  const pw = Number(form.pe_weekly) || 0;
  const pm = Number(form.pe_minutes) || 0;
  const ac = Number(form.after_class_minutes) || 0;
  const recessDaily = Math.round((rm * Math.min(rw, 5)) / 5);
  const peDaily = Math.round((pm * Math.min(pw, 5)) / 5);
  const daily = recessDaily + peDaily + ac;
  return {
    recess_ok: Number(form.recess_enabled) === 1 && rm >= 15,
    recess_daily: recessDaily,
    daily_minutes: daily,
    daily_ok: daily >= 60
  };
});

function syncList(arr, key) {
  form[key] = (arr || []).join('、');
}
function toArr(s) {
  return s ? String(s).split('、').filter(Boolean) : [];
}
function fmtTime(s) {
  return s ? String(s).replace('T', ' ').slice(0, 16) : '';
}
function phaseStatus(p) {
  const h = history.value[p];
  return h ? Number(h.status) : -1;
}
function phaseStateText(p) {
  if (p === phase.value) return '正在填报';
  const h = history.value[p];
  if (!h) return '未填报';
  return ({ 0: '草稿', 1: '待审核', 2: '已通过', 3: '已退回' })[h.status] || '未填报';
}

function onRecessChange(v) {
  if (!v) {
    form.recess_minutes = 0;
    form.recess_weekly = 0;
  } else if (!form.recess_minutes) {
    form.recess_minutes = 20;
    form.recess_weekly = 5;
  }
}

function fill(data) {
  Object.assign(form, blank(), data || {});
  for (const k of ['recess', 'time', 'comp', 'wushu', 'hw']) {
    photos[k] = (data?.photos?.[k] || []).map((x) => x.url);
  }
  recessForms.value = toArr(form.recess_forms);
  compSports.value = toArr(form.comp_sports);
  wushuForms.value = toArr(form.wushu_forms);
  hwForms.value = toArr(form.hw_forms);
}

async function load() {
  loading.value = true;
  try {
    const [cur, his] = await Promise.all([
      http.get('/sport-activity/mine', { params: { term: term.value, phase: phase.value } }),
      http.get('/sport-activity/mine/history', { params: { term: term.value } })
    ]);
    fill(cur);
    history.value = his?.list || {};
  } catch (e) {
    MessagePlugin.error(e.message);
  } finally {
    loading.value = false;
  }
}

function switchPhase(p) {
  if (p === phase.value) return;
  phase.value = p;
  load();
}

function onTermChange() {
  load();
}

async function onPick(file, section) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    MessagePlugin.error('图片超过 5MB，请压缩后再上传');
    return;
  }
  const fd = new FormData();
  fd.append('file', file);
  try {
    const r = await http.post('/upload/photo', fd);
    photos[section].push(r.url);
  } catch (e) {
    MessagePlugin.error(e.message);
  }
}

function removePhoto(section, idx) {
  photos[section].splice(idx, 1);
}

function payload() {
  return {
    term: term.value,
    phase: phase.value,
    ...form,
    photos: {
      recess: photos.recess,
      time: photos.time,
      comp: photos.comp,
      wushu: photos.wushu,
      hw: photos.hw
    }
  };
}

async function save(submit) {
  saving.value = true;
  try {
    const url = submit ? '/sport-activity/submit' : '/sport-activity/mine';
    const r = submit
      ? await http.post(url, payload())
      : await http.put(url, payload());
    MessagePlugin.success(submit ? '已提交，等待审核' : '已保存');
    fill(r);
    const his = await http.get('/sport-activity/mine/history', { params: { term: term.value } });
    history.value = his?.list || {};
  } catch (e) {
    MessagePlugin.error(e.message);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.sa-page { padding: 0 0 24px; }
.sa-head { margin-bottom: 12px; }
.sa-head-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.sa-title { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.sa-title-text { font-size: 16px; font-weight: 500; }
.sa-school { font-size: 13px; color: var(--app-text-2); }
.sa-head-right { display: flex; align-items: center; gap: 10px; }

.sa-phases { display: flex; gap: 8px; margin: 14px 0 10px; flex-wrap: wrap; }
.sa-phase {
  display: flex; flex-direction: column; gap: 2px;
  padding: 8px 16px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--app-border);
  background: var(--app-bg-2);
  transition: border-color .15s ease, background-color .15s ease;
}
.sa-phase:hover { border-color: var(--td-brand-color); }
.sa-phase.active { border-color: var(--td-brand-color); background: var(--td-brand-color-light); }
.sa-phase-name { font-size: 13px; font-weight: 500; }
.sa-phase-state { font-size: 11px; color: var(--app-text-3); }
.sa-phase.done .sa-phase-state { color: var(--td-brand-color); }

.sa-alert { margin-top: 4px; }

.sa-block { margin-bottom: 12px; }
.sa-block-head { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
.sa-bar { width: 3px; height: 14px; border-radius: 2px; background: var(--td-brand-color); }
.sa-block-title { font-size: 14px; font-weight: 500; }
.sa-block-tip { font-size: 12px; color: var(--app-text-3); }

.sa-label { font-size: 12px; color: var(--app-text-2); margin-bottom: 6px; }
.sa-inline { display: flex; align-items: center; gap: 8px; }
.sa-badge { font-size: 11px; padding: 2px 8px; border-radius: 4px; white-space: nowrap; }
.sa-badge.ok { background: var(--td-success-color-light); color: var(--td-success-color); }
.sa-badge.bad { background: var(--td-error-color-light); color: var(--td-error-color); }
.sa-readonly { font-size: 13px; color: var(--app-text-3); padding: 6px 0; }

.sa-summary {
  margin-top: 14px; padding: 10px 14px; border-radius: 8px;
  font-size: 13px; display: flex; align-items: center; gap: 10px;
  background: var(--app-bg-2);
}
.sa-summary.ok { background: var(--td-success-color-light); color: var(--td-success-color); }
.sa-summary.bad { background: var(--td-error-color-light); color: var(--td-error-color); }
.sa-summary b { font-size: 16px; }

.sa-foot { display: flex; justify-content: flex-end; gap: 10px; padding-top: 4px; }

@media (max-width: 768px) {
  .sa-head-right { width: 100%; }
  .sa-foot { position: sticky; bottom: 0; background: var(--app-bg); padding: 10px 0; }
}
</style>
