<template>
  <div>
    <t-card class="tr-card">
      <t-tabs v-model="activeTab">
        <!-- ================= 号码簿 ================= -->
        <t-tab-panel label="号码簿" value="bib">
          <div class="tb-row">
            <t-button theme="primary" @click="openBibGen">生成号码</t-button>
            <t-button variant="outline" @click="loadBibs">刷新</t-button>
            <t-button variant="outline" @click="checkMissing">缺号检查</t-button>
            <t-button variant="outline" theme="danger" @click="clearBibs">清空</t-button>
            <t-input v-model="bibKeyword" clearable placeholder="按姓名/号码搜索" style="width: 200px" @enter="loadBibs" />
            <span class="hint">共 {{ bibs.length }} 人</span>
          </div>

          <t-table :data="filteredBibs" :columns="bibCols" row-key="id" :loading="loadingBib" hover>
            <template #bib_no="{ row }">
              <span class="bib-val">{{ row.bib_no }}</span>
            </template>
            <template #ops="{ row }">
              <t-button variant="text" theme="primary" size="small" @click="editBib(row)">改号</t-button>
            </template>
          </t-table>

          <div v-if="missing.noBib && missing.noBib.length" class="miss-box">
            <div class="miss-title">未分配号码（{{ missing.noBib.length }} 人）</div>
            <div class="miss-list">{{ missing.noBib.map((x) => `${x.school_name || ''}${x.name}`).join('、') }}</div>
          </div>
          <div v-if="missing.dup && missing.dup.length" class="miss-box warn">
            <div class="miss-title">重号（{{ missing.dup.length }} 组）</div>
            <div class="miss-list">{{ missing.dup.map((d) => `${d.bib_no} × ${d.c}`).join('、') }}</div>
          </div>
        </t-tab-panel>

        <!-- ================= 临时变更 ================= -->
        <t-tab-panel label="临时变更" value="change">
          <div class="tb-row">
            <t-select v-model="changeFilter.event_item_id" clearable placeholder="全部项目" style="width: 180px" :options="eventOptions" @change="loadChanges" />
            <t-select v-model="changeFilter.change_type" clearable placeholder="全部类型" style="width: 150px" :options="CHANGE_TYPE_LIST" @change="loadChanges" />
            <t-button variant="outline" @click="loadChanges">刷新</t-button>
            <span class="hint">所有变更都可撤销，撤销后自动还原原状态</span>
          </div>

          <div class="change-ops">
            <t-button theme="primary" size="small" @click="openChange('TEMP_ENTRY')">临时报名</t-button>
            <t-button theme="warning" size="small" @click="openChange('WITHDRAWAL')">撤赛</t-button>
            <t-button theme="default" size="small" @click="openChange('REPLACEMENT')">换人</t-button>
            <t-button theme="default" size="small" @click="openChange('EVENT_CHANGE')">改项</t-button>
            <t-button theme="default" size="small" @click="openChange('NAME_CHANGE')">改名</t-button>
          </div>

          <t-table :data="changes" :columns="changeCols" row-key="id" :loading="loadingChange" hover>
            <template #change_type="{ row }">
              <t-tag size="small" variant="light" :theme="changeTheme(row.change_type)">
                {{ changeTypeLabel(row.change_type) }}
              </t-tag>
            </template>
            <template #detail="{ row }">
              <span class="dim">{{ changeDetail(row) }}</span>
            </template>
            <template #ops="{ row }">
              <t-button variant="text" theme="danger" size="small" @click="revokeChange(row)">撤销</t-button>
            </template>
          </t-table>
        </t-tab-panel>

        <!-- ================= 检录表 / 成绩单 ================= -->
        <t-tab-panel label="检录表·成绩单" value="form">
          <div class="tb-row">
            <t-select v-model="formHeatId" filterable clearable placeholder="选择赛次分组" style="width: 340px" :options="heatOptions" @change="loadFormData" />
            <t-radio-group v-model="formType" @change="loadFormData">
              <t-radio value="CHECK_IN">检录表</t-radio>
              <t-radio value="RESULT">成绩单</t-radio>
            </t-radio-group>
            <t-button variant="outline" @click="openFormConfig">打印设置</t-button>
            <t-button theme="primary" @click="printForm">打印</t-button>
            <t-button variant="outline" @click="exportForm">导出 CSV</t-button>
          </div>

          <div v-if="formData" ref="printArea" class="sheet">
            <div class="sheet-head">
              <div class="sh-title">{{ formData.config?.title_text || `${formData.heat.meet_name} ${formType === 'CHECK_IN' ? '检录表' : '成绩单'}` }}</div>
              <div class="sh-sub">
                {{ formData.heat.event_name }} · {{ bandText(formData.heat) }} ·
                {{ formData.heat.heat_name }}
                <template v-if="formData.heat.plan_time"> · {{ formData.heat.plan_time }}</template>
              </div>
            </div>

            <table class="sheet-table">
              <thead>
                <tr>
                  <th v-if="formData.config?.show_lane !== 0" style="width: 56px">{{ formData.heat.event_type === 'FIELD' ? '顺序' : '道次' }}</th>
                  <th v-if="formData.config?.show_bib !== 0" style="width: 70px">号码</th>
                  <th>姓名</th>
                  <th v-if="formData.config?.show_school !== 0">单位</th>
                  <th v-if="formType === 'RESULT'" style="width: 110px">成绩</th>
                  <th v-if="formType === 'RESULT'" style="width: 60px">名次</th>
                  <th v-if="formType === 'CHECK_IN' && formData.config?.show_sign_col !== 0" style="width: 110px">签字</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in formData.entries" :key="e.id">
                  <td class="c">{{ e.lane_no ?? e.sort_no ?? '' }}</td>
                  <td v-if="formData.config?.show_bib !== 0" class="c">{{ e.bib_no || '' }}</td>
                  <td>{{ e.athlete_name }}</td>
                  <td v-if="formData.config?.show_school !== 0">{{ e.school_name }}</td>
                  <td v-if="formType === 'RESULT'" class="c">{{ e.status_code || e.result_text || '' }}</td>
                  <td v-if="formType === 'RESULT'" class="c">{{ e.rank_no || '' }}</td>
                  <td v-if="formType === 'CHECK_IN' && formData.config?.show_sign_col !== 0"></td>
                </tr>
              </tbody>
            </table>

            <div v-if="formType === 'RESULT' && formData.config?.show_referee !== 0" class="sheet-foot">
              <span>裁判长：____________</span>
              <span>记录员：____________</span>
              <span>日期：____________</span>
            </div>
            <div v-if="formData.config?.footer_text" class="sheet-note">{{ formData.config.footer_text }}</div>
          </div>
          <div v-else class="empty-tip">请选择赛次分组</div>
        </t-tab-panel>

        <!-- ================= 成绩公布 ================= -->
        <t-tab-panel label="成绩公布" value="announce">
          <div class="tb-row">
            <t-select v-model="annHeatId" filterable clearable placeholder="选择赛次分组" style="width: 320px" :options="heatOptions" />
            <t-button theme="primary" @click="publishOne">公布该组成绩</t-button>
            <t-button variant="outline" @click="loadAnnouncements">刷新</t-button>
            <div class="switches">
              <t-checkbox v-model="annCfg.announce_flag" :value="1" @change="saveAnnCfg">启用成绩公布</t-checkbox>
              <t-checkbox v-model="annCfg.announce_auto_flag" :value="1" @change="saveAnnCfg">确认后自动公布</t-checkbox>
              <t-checkbox v-model="annCfg.announce_show_school" :value="1" @change="saveAnnCfg">显示单位</t-checkbox>
            </div>
          </div>

          <t-table :data="announcements" :columns="annCols" row-key="id" hover>
            <template #publish_flag="{ row }">
              <t-tag v-if="row.publish_flag === 1" theme="success" size="small" variant="light">已公布</t-tag>
              <t-tag v-else size="small" variant="light">未公布</t-tag>
            </template>
            <template #ops="{ row }">
              <t-button variant="text" theme="primary" size="small" @click="previewAnn(row)">查看</t-button>
              <t-button v-if="row.publish_flag === 1" variant="text" theme="warning" size="small" @click="withdrawAnn(row)">撤回</t-button>
            </template>
          </t-table>
        </t-tab-panel>

        <!-- ================= 裁判员账号 ================= -->
        <t-tab-panel label="裁判员账号" value="referee">
          <div class="tb-row">
            <t-button theme="primary" @click="openRefereeCreate">新增裁判账号</t-button>
            <t-button variant="outline" @click="loadReferees">刷新</t-button>
            <span class="hint">裁判登录后只能录入自己负责的项目</span>
          </div>
          <t-table :data="referees" :columns="refereeCols" row-key="id" hover>
            <template #login_flag="{ row }">
              <t-switch v-model="row.login_flag" :custom-value="[1, 0]" @change="updateReferee(row)" />
            </template>
            <template #ops="{ row }">
              <t-button variant="text" theme="primary" size="small" @click="openRefereeEdit(row)">编辑</t-button>
              <t-button variant="text" theme="default" size="small" @click="resetRefereePwd(row)">重置密码</t-button>
              <t-button variant="text" theme="danger" size="small" @click="removeReferee(row)">删除</t-button>
            </template>
          </t-table>
        </t-tab-panel>
      </t-tabs>
    </t-card>

    <!-- 生成号码 -->
    <t-dialog v-model:visible="bibDialog" header="生成号码簿" :width="isMobile ? '94%' : '520px'" attach="body">
      <t-form :data="bibForm" label-width="110px" label-align="right">
        <t-form-item label="组别">
          <t-select v-model="bibForm.band_id" clearable placeholder="全部组别" style="width: 100%" :options="bandOptions" />
        </t-form-item>
        <t-form-item label="编号方式">
          <t-select v-model="bibForm.mode" style="width: 200px" :options="BIB_MODE_LIST" />
        </t-form-item>
        <t-form-item label="号码位数">
          <t-input-number v-model="bibForm.number_length" :min="2" :max="6" :step="1" />
        </t-form-item>
        <t-form-item label="起始号">
          <t-input-number v-model="bibForm.start_number" :min="1" :max="9999" :step="1" />
        </t-form-item>
        <t-form-item label="前缀">
          <t-select v-model="bibForm.prefix" clearable style="width: 200px" :options="BIB_PREFIX_LIST" />
        </t-form-item>
        <t-form-item label="性别顺序">
          <t-select v-model="bibForm.gender_order" style="width: 160px" :options="[{ value: 'M_F', label: '男先女后' }, { value: 'F_M', label: '女先男后' }]" />
        </t-form-item>
        <t-form-item>
          <span class="warn-text">将覆盖该赛事已有的号码</span>
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button variant="outline" @click="bibDialog = false">取消</t-button>
        <t-button theme="primary" :loading="bibbing" @click="runBib">生成</t-button>
      </template>
    </t-dialog>

    <!-- 临时变更 -->
    <t-dialog v-model:visible="changeDialog" :header="changeTitle" :width="isMobile ? '94%' : '560px'" attach="body">
      <t-form :data="changeForm" label-width="100px" label-align="right">
        <t-form-item label="项目" required-mark>
          <t-select v-model="changeForm.event_item_id" style="width: 100%" :options="eventOptions" @change="loadCandidates" />
        </t-form-item>
        <t-form-item label="组别" required-mark>
          <t-select v-model="changeForm.band_id" style="width: 100%" :options="bandOptions" @change="loadCandidates" />
        </t-form-item>

        <!-- 临时报名 -->
        <template v-if="changeForm.change_type === 'TEMP_ENTRY'">
          <t-form-item label="从名册选">
            <t-select v-model="changeForm.athlete_id" filterable clearable style="width: 100%" :options="allAthleteOptions" />
          </t-form-item>
          <t-form-item label="或现场新增">
            <t-input v-model="changeForm.new_athlete_name" placeholder="姓名" style="width: 140px" />
            <t-select v-model="changeForm.new_school_id" filterable clearable placeholder="学校" style="width: 220px; margin-left: 8px" :options="schoolOptions" />
          </t-form-item>
          <t-form-item label="加入分组">
            <t-select v-model="changeForm.target_heat_id" clearable style="width: 100%" :options="heatOptionsOfCurrent" />
          </t-form-item>
        </template>

        <!-- 撤赛 -->
        <template v-else-if="changeForm.change_type === 'WITHDRAWAL'">
          <t-form-item label="撤下人员" required-mark>
            <t-select v-model="changeForm.old_heat_entry_id" filterable style="width: 100%" :options="candidateOptions" />
          </t-form-item>
        </template>

        <!-- 换人 -->
        <template v-else-if="changeForm.change_type === 'REPLACEMENT'">
          <t-form-item label="换下人员" required-mark>
            <t-select v-model="changeForm.old_heat_entry_id" filterable style="width: 100%" :options="candidateOptions" @change="loadReplaceCandidates" />
          </t-form-item>
          <t-form-item label="换上人员" required-mark>
            <t-select v-model="changeForm.replace_athlete_id" filterable style="width: 100%" :options="replaceOptions" />
          </t-form-item>
        </template>

        <!-- 改项 -->
        <template v-else-if="changeForm.change_type === 'EVENT_CHANGE'">
          <t-form-item label="运动员" required-mark>
            <t-select v-model="changeForm.old_athlete_id" filterable style="width: 100%" :options="candidateOptions" />
          </t-form-item>
          <t-form-item label="改到项目" required-mark>
            <t-select v-model="changeForm.to_event_item_id" style="width: 100%" :options="eventOptions" />
          </t-form-item>
        </template>

        <!-- 改名 -->
        <template v-else-if="changeForm.change_type === 'NAME_CHANGE'">
          <t-form-item label="运动员" required-mark>
            <t-select v-model="changeForm.old_athlete_id" filterable style="width: 100%" :options="allAthleteOptions" />
          </t-form-item>
          <t-form-item label="新姓名" required-mark>
            <t-input v-model="changeForm.after_name" style="width: 200px" />
          </t-form-item>
        </template>

        <t-form-item label="变更原因">
          <t-input v-model="changeForm.reason" :maxlength="200" />
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button variant="outline" @click="changeDialog = false">取消</t-button>
        <t-button theme="primary" :loading="changing" @click="submitChange">提交变更</t-button>
      </template>
    </t-dialog>

    <!-- 打印设置 -->
    <t-dialog v-model:visible="formCfgDialog" header="打印设置" :width="isMobile ? '94%' : '480px'" attach="body">
      <t-form :data="formCfg" label-width="100px" label-align="right">
        <t-form-item label="显示单位"><t-switch v-model="formCfg.show_school" :custom-value="[1, 0]" /></t-form-item>
        <t-form-item label="显示号码"><t-switch v-model="formCfg.show_bib" :custom-value="[1, 0]" /></t-form-item>
        <t-form-item label="显示道次"><t-switch v-model="formCfg.show_lane" :custom-value="[1, 0]" /></t-form-item>
        <t-form-item label="签字栏"><t-switch v-model="formCfg.show_sign_col" :custom-value="[1, 0]" /></t-form-item>
        <t-form-item label="裁判签字栏"><t-switch v-model="formCfg.show_referee" :custom-value="[1, 0]" /></t-form-item>
        <t-form-item label="每页行数">
          <t-input-number v-model="formCfg.rows_per_page" :min="10" :max="60" :step="5" />
        </t-form-item>
        <t-form-item label="表头文字">
          <t-input v-model="formCfg.title_text" :maxlength="128" />
        </t-form-item>
        <t-form-item label="页脚说明">
          <t-input v-model="formCfg.footer_text" :maxlength="128" />
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button variant="outline" @click="formCfgDialog = false">取消</t-button>
        <t-button theme="primary" :loading="savingCfg" @click="saveFormCfg">保存</t-button>
      </template>
    </t-dialog>

    <!-- 裁判账号 -->
    <t-dialog v-model:visible="refereeDialog" :header="refereeForm.id ? '编辑裁判账号' : '新增裁判账号'" :width="isMobile ? '94%' : '520px'" attach="body">
      <t-form :data="refereeForm" label-width="100px" label-align="right">
        <t-form-item label="登录账号" required-mark>
          <t-input v-model="refereeForm.username" :disabled="!!refereeForm.id" :maxlength="32" />
        </t-form-item>
        <t-form-item v-if="!refereeForm.id" label="初始密码">
          <t-input v-model="refereeForm.password" placeholder="默认 123456" />
        </t-form-item>
        <t-form-item label="姓名">
          <t-input v-model="refereeForm.real_name" :maxlength="32" />
        </t-form-item>
        <t-form-item label="负责项目">
          <t-select v-model="refereeForm.event_item_id" clearable style="width: 100%" :options="eventOptions" />
        </t-form-item>
        <t-form-item label="负责组别">
          <t-select v-model="refereeForm.band_id" clearable style="width: 100%" :options="bandOptions" />
        </t-form-item>
        <t-form-item label="职务">
          <t-select v-model="refereeForm.duty" clearable style="width: 200px" :options="DUTY_LIST" />
        </t-form-item>
        <t-form-item label="手机号">
          <t-input v-model="refereeForm.phone" :maxlength="20" />
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button variant="outline" @click="refereeDialog = false">取消</t-button>
        <t-button theme="primary" :loading="savingReferee" @click="submitReferee">保存</t-button>
      </template>
    </t-dialog>

    <!-- 公布内容预览 -->
    <t-dialog v-model:visible="annDialog" header="成绩公布内容" :width="isMobile ? '94%' : '600px'" attach="body">
      <div v-if="annPreview" class="ann-box">
        <div class="ann-title">{{ annPreview.event_name }} {{ annPreview.heat_name }}</div>
        <t-table :data="annPreview.entries" :columns="annEntryCols" row-key="_i" />
      </div>
      <template #footer>
        <t-button variant="outline" @click="annDialog = false">关闭</t-button>
      </template>
    </t-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useUserStore } from '../store/user';
import http from '../api/http';
import { message, confirm as confirmDlg } from '../utils/ui';

const store = useUserStore();

const isMobile = ref(window.innerWidth <= 768);
function onResize() { isMobile.value = window.innerWidth <= 768; }
onMounted(() => window.addEventListener('resize', onResize));
onUnmounted(() => window.removeEventListener('resize', onResize));

const CHANGE_TYPE_LIST = [
  { value: 'TEMP_ENTRY', label: '临时报名' },
  { value: 'WITHDRAWAL', label: '撤赛' },
  { value: 'REPLACEMENT', label: '换人' },
  { value: 'EVENT_CHANGE', label: '改项' },
  { value: 'NAME_CHANGE', label: '改名' }
];
const BIB_MODE_LIST = [
  { value: 'SCHOOL_SEGMENT', label: '按校分段（每校一段号）' },
  { value: 'GLOBAL', label: '全局连续' }
];
const BIB_PREFIX_LIST = [
  { value: 'SCHOOL_CODE', label: '学校序号做前缀（01、02…）' },
  { value: '', label: '无前缀' }
];
const DUTY_LIST = [
  { value: '起点', label: '起点' }, { value: '终点', label: '终点' },
  { value: '计时', label: '计时' }, { value: '跳部', label: '跳部' },
  { value: '投部', label: '投部' }, { value: '检录', label: '检录' },
  { value: '全能', label: '全能' }
];

const activeTab = ref('bib');
const events = ref([]);
const bands = ref([]);
const schools = ref([]);

const eventOptions = computed(() =>
  events.value.filter((e) => e.category === 1 || e.category === 2).map((e) => ({ value: e.id, label: e.name }))
);
const bandOptions = computed(() =>
  bands.value.map((b) => ({
    value: b.id,
    label: `${b.gender === 1 ? '男' : '女'}${b.stage === 1 ? '小' : b.stage === 2 ? '初' : '高'}${b.label || ''}`
  }))
);
const schoolOptions = computed(() => schools.value.map((s) => ({ value: s.id, label: s.name })));

function bandText(h) {
  const b = bands.value.find((x) => x.id === h.band_id);
  if (!b) return '';
  return `${b.gender === 1 ? '男子' : '女子'}${b.stage === 1 ? '小学' : b.stage === 2 ? '初中' : '高中'}${b.label || ''}`;
}

/* ---------- 号码簿 ---------- */
const bibs = ref([]);
const loadingBib = ref(false);
const bibKeyword = ref('');
const bibDialog = ref(false);
const bibbing = ref(false);
const missing = reactive({ noBib: null, dup: null });
const bibForm = reactive({
  band_id: null, mode: 'SCHOOL_SEGMENT', number_length: 4,
  start_number: 1, prefix: 'SCHOOL_CODE', gender_order: 'M_F'
});

const bibCols = [
  { colKey: 'bib_no', title: '号码', width: 90, align: 'center' },
  { colKey: 'athlete_name', title: '姓名', minWidth: 120 },
  { colKey: 'school_name', title: '单位', minWidth: 180 },
  { colKey: 'team_name', title: '代表队', minWidth: 140 },
  { colKey: 'ops', title: '操作', width: 80, align: 'center' }
];

const filteredBibs = computed(() => {
  const k = bibKeyword.value.trim();
  if (!k) return bibs.value;
  return bibs.value.filter((b) =>
    (b.athlete_name || '').includes(k) || String(b.bib_no || '').includes(k)
  );
});

async function loadBibs() {
  if (!store.competitionId) return;
  loadingBib.value = true;
  try {
    bibs.value = await http.get('/track-race/bibs', { params: { competition_id: store.competitionId } });
  } catch (e) {
    message.error(e.message);
  } finally {
    loadingBib.value = false;
  }
}

function openBibGen() { bibDialog.value = true; }

async function runBib() {
  bibbing.value = true;
  try {
    const r = await http.post('/track-race/bibs/generate', {
      competition_id: store.competitionId, ...bibForm
    });
    message.success(r?.message || '已生成');
    bibDialog.value = false;
    loadBibs();
  } catch (e) {
    message.error(e.message);
  } finally {
    bibbing.value = false;
  }
}

async function editBib(row) {
  const v = window.prompt('输入新号码', row.bib_no);
  if (v === null || !v.trim() || v === row.bib_no) return;
  try {
    await http.put(`/track-race/bibs/${row.id}`, { bib_no: v.trim() });
    message.success('已更新');
    loadBibs();
  } catch (e) {
    message.error(e.message);
  }
}

async function checkMissing() {
  try {
    const r = await http.get('/track-race/bibs/missing', { params: { competition_id: store.competitionId } });
    missing.noBib = r.noBib;
    missing.dup = r.dup;
    if (!r.noBib.length && !r.dup.length) message.success('号码完整，无缺失无重号');
  } catch (e) {
    message.error(e.message);
  }
}

async function clearBibs() {
  let go = false;
  await confirmDlg('确定清空该赛事的全部号码？', '清空确认', { confirmBtn: '确定清空' }).then(() => { go = true; }).catch(() => {});
  if (!go) return;
  try {
    await http.delete('/track-race/bibs/clear', { params: { competition_id: store.competitionId } });
    message.success('已清空');
    loadBibs();
  } catch (e) {
    message.error(e.message);
  }
}

/* ---------- 临时变更 ---------- */
const changes = ref([]);
const loadingChange = ref(false);
const changeDialog = ref(false);
const changing = ref(false);
const changeFilter = reactive({ event_item_id: null, change_type: '' });
const candidates = ref([]);
const replaceCandidates = ref([]);
const allAthletes = ref([]);
const heatList = ref([]);

const changeForm = reactive({
  change_type: 'TEMP_ENTRY', event_item_id: null, band_id: null,
  athlete_id: null, new_athlete_name: '', new_school_id: null,
  target_heat_id: null, old_heat_entry_id: null, replace_athlete_id: null,
  old_athlete_id: null, to_event_item_id: null, after_name: '', reason: ''
});

const changeCols = [
  { colKey: 'change_type', title: '类型', width: 96, align: 'center' },
  { colKey: 'event_name', title: '项目', minWidth: 110 },
  { colKey: 'detail', title: '变更内容', minWidth: 300 },
  { colKey: 'created_by', title: '操作人', width: 90, align: 'center' },
  { colKey: 'created_at', title: '时间', width: 150, align: 'center' },
  { colKey: 'ops', title: '操作', width: 80, align: 'center' }
];

const candidateOptions = computed(() =>
  candidates.value.map((c) => ({
    value: c.heat_entry_id || c.athlete_id,
    label: `${c.athlete_name}（${c.school_name || ''}${c.heat_name ? ' · ' + c.heat_name : ''}）`
  }))
);
const replaceOptions = computed(() =>
  replaceCandidates.value.map((c) => ({
    value: c.athlete_id, label: `${c.athlete_name}（${c.school_name || ''}）`
  }))
);
const allAthleteOptions = computed(() =>
  allAthletes.value.map((a) => ({ value: a.id, label: `${a.name}（${a.school_name || ''}）` }))
);
const heatOptions = computed(() =>
  heatList.value.map((h) => ({ value: h.id, label: `${h.event_name} ${h.heat_name}` }))
);
const heatOptionsOfCurrent = computed(() =>
  heatList.value
    .filter((h) => h.event_item_id === changeForm.event_item_id && h.band_id === changeForm.band_id)
    .map((h) => ({ value: h.id, label: h.heat_name }))
);

function changeTypeLabel(v) {
  return { TEMP_ENTRY: '临时报名', WITHDRAWAL: '撤赛', REPLACEMENT: '换人', EVENT_CHANGE: '改项', NAME_CHANGE: '改名' }[v] || v;
}
function changeTheme(v) {
  return { TEMP_ENTRY: 'primary', WITHDRAWAL: 'danger', REPLACEMENT: 'warning', EVENT_CHANGE: 'default', NAME_CHANGE: 'default' }[v] || 'default';
}
function changeDetail(row) {
  if (row.change_type === 'TEMP_ENTRY') return `新增 ${row.new_athlete_name}（${row.new_school_name || ''}）`;
  if (row.change_type === 'WITHDRAWAL') return `${row.old_athlete_name} 撤赛`;
  if (row.change_type === 'REPLACEMENT') return `${row.old_athlete_name} → ${row.replace_athlete_name}`;
  if (row.change_type === 'EVENT_CHANGE') return `${row.old_athlete_name}：${row.from_event_name} → ${row.to_event_name}`;
  if (row.change_type === 'NAME_CHANGE') return `${row.before_name} → ${row.after_name}`;
  return '';
}

async function loadChanges() {
  if (!store.competitionId) return;
  loadingChange.value = true;
  try {
    const params = { competition_id: store.competitionId };
    if (changeFilter.event_item_id) params.event_item_id = changeFilter.event_item_id;
    if (changeFilter.change_type) params.change_type = changeFilter.change_type;
    changes.value = await http.get('/track-race/changes', { params });
  } catch (e) {
    message.error(e.message);
  } finally {
    loadingChange.value = false;
  }
}

const changeTitle = computed(() => `临时变更 · ${changeTypeLabel(changeForm.change_type)}`);

function openChange(type) {
  changeForm.change_type = type;
  changeForm.event_item_id = changeFilter.event_item_id;
  changeForm.band_id = null;
  changeForm.athlete_id = null;
  changeForm.new_athlete_name = '';
  changeForm.new_school_id = null;
  changeForm.target_heat_id = null;
  changeForm.old_heat_entry_id = null;
  changeForm.replace_athlete_id = null;
  changeForm.old_athlete_id = null;
  changeForm.to_event_item_id = null;
  changeForm.after_name = '';
  changeForm.reason = '';
  candidates.value = [];
  replaceCandidates.value = [];
  changeDialog.value = true;
}

async function loadCandidates() {
  if (!changeForm.event_item_id || !changeForm.band_id) return;
  try {
    candidates.value = await http.get('/track-race/changes/candidates', {
      params: {
        competition_id: store.competitionId,
        band_id: changeForm.band_id,
        event_item_id: changeForm.event_item_id
      }
    });
  } catch (e) {
    message.error(e.message);
  }
}

async function loadReplaceCandidates() {
  try {
    replaceCandidates.value = await http.get('/track-race/changes/candidates', {
      params: {
        competition_id: store.competitionId,
        band_id: changeForm.band_id,
        event_item_id: changeForm.event_item_id,
        kind: 'replace'
      }
    });
  } catch (e) {
    message.error(e.message);
  }
}

async function submitChange() {
  if (!changeForm.event_item_id || !changeForm.band_id) {
    message.warning('请选择项目与组别');
    return;
  }
  changing.value = true;
  try {
    const payload = { competition_id: store.competitionId, ...changeForm };
    await http.post('/track-race/changes', payload);
    message.success('变更已记录');
    changeDialog.value = false;
    loadChanges();
    loadHeats();
  } catch (e) {
    message.error(e.message);
  } finally {
    changing.value = false;
  }
}

async function revokeChange(row) {
  let go = false;
  await confirmDlg(`确定撤销这条「${changeTypeLabel(row.change_type)}」变更？`, '撤销确认', { confirmBtn: '确定撤销' })
    .then(() => { go = true; }).catch(() => {});
  if (!go) return;
  try {
    await http.post(`/track-race/changes/${row.id}/revoke`);
    message.success('已撤销');
    loadChanges();
    loadHeats();
  } catch (e) {
    message.error(e.message);
  }
}

/* ---------- 检录表 / 成绩单 ---------- */
const formHeatId = ref(null);
const formType = ref('CHECK_IN');
const formData = ref(null);
const formCfgDialog = ref(false);
const savingCfg = ref(false);
const printArea = ref(null);
const formCfg = reactive({
  show_school: 1, show_bib: 1, show_lane: 1, show_gender: 0,
  show_sign_col: 1, show_referee: 1, rows_per_page: 30,
  title_text: '', footer_text: ''
});

async function loadFormData() {
  if (!formHeatId.value) { formData.value = null; return; }
  try {
    const r = await http.get('/track-race/form-data', {
      params: { heat_id: formHeatId.value, form_type: formType.value }
    });
    formData.value = r;
    Object.assign(formCfg, {
      show_school: r.config?.show_school ?? 1,
      show_bib: r.config?.show_bib ?? 1,
      show_lane: r.config?.show_lane ?? 1,
      show_gender: r.config?.show_gender ?? 0,
      show_sign_col: r.config?.show_sign_col ?? 1,
      show_referee: r.config?.show_referee ?? 1,
      rows_per_page: r.config?.rows_per_page ?? 30,
      title_text: r.config?.title_text || '',
      footer_text: r.config?.footer_text || ''
    });
  } catch (e) {
    message.error(e.message);
  }
}

function openFormConfig() { formCfgDialog.value = true; }

async function saveFormCfg() {
  savingCfg.value = true;
  try {
    await http.put('/track-race/form-config', {
      competition_id: store.competitionId, form_type: formType.value, ...formCfg
    });
    message.success('已保存');
    formCfgDialog.value = false;
    loadFormData();
  } catch (e) {
    message.error(e.message);
  } finally {
    savingCfg.value = false;
  }
}

async function printForm() {
  if (!formData.value) { message.warning('请先选择赛次分组'); return; }
  await nextTick();
  const el = printArea.value;
  if (!el) return;
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { message.warning('浏览器阻止了弹窗，请允许后重试'); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${formType.value === 'CHECK_IN' ? '检录表' : '成绩单'}</title>
    <style>
      @page { size: A4; margin: 14mm; }
      body { font-family: "Microsoft YaHei", SimSun, sans-serif; color:#000; }
      .sheet-head { text-align:center; margin-bottom:14px; }
      .sh-title { font-size: 20px; font-weight:700; }
      .sh-sub { font-size:13px; margin-top:6px; }
      table { width:100%; border-collapse:collapse; font-size:13px; }
      th, td { border:1px solid #000; padding:6px 8px; }
      th { background:#f2f2f2; font-weight:600; }
      td.c { text-align:center; }
      .sheet-foot { margin-top:22px; display:flex; gap:40px; font-size:13px; }
      .sheet-note { margin-top:14px; font-size:12px; color:#555; }
    </style></head><body>${el.outerHTML}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 300);
}

function exportForm() {
  if (!formData.value) { message.warning('请先选择赛次分组'); return; }
  const isResult = formType.value === 'RESULT';
  const head = ['道次/顺序', '号码', '姓名', '单位'];
  if (isResult) head.push('成绩', '名次');
  const rows = formData.value.entries.map((e) => {
    const r = [e.lane_no ?? e.sort_no ?? '', e.bib_no || '', e.athlete_name, e.school_name || ''];
    if (isResult) r.push(e.status_code || e.result_text || '', e.rank_no || '');
    return r;
  });
  const csv = '\ufeff' + [head, ...rows].map((r) => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${formData.value.heat.event_name}_${formData.value.heat.heat_name}_${isResult ? '成绩单' : '检录表'}.csv`;
  a.click();
}

/* ---------- 成绩公布 ---------- */
const announcements = ref([]);
const annHeatId = ref(null);
const annDialog = ref(false);
const annPreview = ref(null);
const annCfg = reactive({ announce_flag: 0, announce_auto_flag: 0, announce_show_school: 1 });

const annCols = [
  { colKey: 'title', title: '标题', minWidth: 220 },
  { colKey: 'event_name', title: '项目', width: 120 },
  { colKey: 'publish_flag', title: '状态', width: 90, align: 'center' },
  { colKey: 'published_by', title: '公布人', width: 100, align: 'center' },
  { colKey: 'published_at', title: '时间', width: 160, align: 'center' },
  { colKey: 'ops', title: '操作', width: 130, align: 'center' }
];
const annEntryCols = [
  { colKey: 'rank', title: '名次', width: 70, align: 'center' },
  { colKey: 'name', title: '姓名', minWidth: 110 },
  { colKey: 'school', title: '单位', minWidth: 160 },
  { colKey: 'result', title: '成绩', width: 100, align: 'center' },
  { colKey: 'score', title: '积分', width: 80, align: 'center' }
];

async function loadAnnouncements() {
  if (!store.competitionId) return;
  try {
    announcements.value = await http.get('/track-race/announcement', {
      params: { competition_id: store.competitionId }
    });
    const c = await http.get('/track/meet-config', { params: { competition_id: store.competitionId } });
    if (c) {
      annCfg.announce_flag = c.announce_flag ?? 0;
      annCfg.announce_auto_flag = c.announce_auto_flag ?? 0;
      annCfg.announce_show_school = c.announce_show_school ?? 1;
    }
  } catch (e) {
    message.error(e.message);
  }
}

async function saveAnnCfg() {
  try {
    await http.put('/track-race/announcement/config', {
      competition_id: store.competitionId, ...annCfg
    });
    message.success('已保存');
  } catch (e) {
    message.error(e.message);
  }
}

async function publishOne() {
  if (!annHeatId.value) { message.warning('请选择赛次分组'); return; }
  try {
    await http.post('/track-race/announcement/publish', { heat_id: annHeatId.value });
    message.success('已公布');
    loadAnnouncements();
  } catch (e) {
    message.error(e.message);
  }
}

async function withdrawAnn(row) {
  try {
    await http.post('/track-race/announcement/withdraw', { heat_id: row.heat_id });
    message.success('已撤回');
    loadAnnouncements();
  } catch (e) {
    message.error(e.message);
  }
}

function previewAnn(row) {
  try {
    annPreview.value = typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json;
    annPreview.value.entries = annPreview.value.entries.map((e, i) => ({ ...e, _i: i }));
    annDialog.value = true;
  } catch (e) {
    message.error('内容解析失败');
  }
}

/* ---------- 裁判员账号 ---------- */
const referees = ref([]);
const refereeDialog = ref(false);
const savingReferee = ref(false);
const refereeForm = reactive({
  id: null, username: '', password: '', real_name: '',
  event_item_id: null, band_id: null, duty: '', phone: ''
});
const refereeCols = [
  { colKey: 'username', title: '登录账号', width: 130 },
  { colKey: 'real_name', title: '姓名', width: 110 },
  { colKey: 'event_name', title: '负责项目', minWidth: 130 },
  { colKey: 'duty', title: '职务', width: 90, align: 'center' },
  { colKey: 'phone', title: '手机号', width: 130, align: 'center' },
  { colKey: 'login_flag', title: '允许登录', width: 100, align: 'center' },
  { colKey: 'ops', title: '操作', width: 190, align: 'center' }
];

async function loadReferees() {
  if (!store.competitionId) return;
  try {
    referees.value = await http.get('/track-race/referee-accounts', {
      params: { competition_id: store.competitionId }
    });
  } catch (e) {
    message.error(e.message);
  }
}

function openRefereeCreate() {
  Object.assign(refereeForm, {
    id: null, username: '', password: '', real_name: '',
    event_item_id: null, band_id: null, duty: '', phone: ''
  });
  refereeDialog.value = true;
}

function openRefereeEdit(row) {
  Object.assign(refereeForm, {
    id: row.id, username: row.username, password: '', real_name: row.real_name || '',
    event_item_id: row.event_item_id || null, band_id: row.band_id || null,
    duty: row.duty || '', phone: row.phone || ''
  });
  refereeDialog.value = true;
}

async function submitReferee() {
  if (!refereeForm.username.trim()) { message.warning('请填写登录账号'); return; }
  savingReferee.value = true;
  try {
    const payload = { competition_id: store.competitionId, ...refereeForm };
    if (refereeForm.id) {
      await http.put(`/track-race/referee-accounts/${refereeForm.id}`, payload);
      message.success('已保存');
    } else {
      await http.post('/track-race/referee-accounts', payload);
      message.success('裁判账号已创建');
    }
    refereeDialog.value = false;
    loadReferees();
  } catch (e) {
    message.error(e.message);
  } finally {
    savingReferee.value = false;
  }
}

async function updateReferee(row) {
  try {
    await http.put(`/track-race/referee-accounts/${row.id}`, {
      competition_id: store.competitionId,
      real_name: row.real_name, event_item_id: row.event_item_id,
      band_id: row.band_id, duty: row.duty, phone: row.phone,
      login_flag: row.login_flag, sort_no: row.sort_no, status: row.status
    });
  } catch (e) {
    message.error(e.message);
  }
}

async function resetRefereePwd(row) {
  const p = window.prompt(`重置「${row.username}」的密码`, '123456');
  if (p === null) return;
  try {
    await http.put(`/track-race/referee-accounts/${row.id}/reset-password`, { password: p });
    message.success('密码已重置');
  } catch (e) {
    message.error(e.message);
  }
}

async function removeReferee(row) {
  let go = false;
  await confirmDlg(`确定删除裁判账号「${row.username}」？`, '删除确认', { confirmBtn: '确定删除' }).then(() => { go = true; }).catch(() => {});
  if (!go) return;
  try {
    await http.delete(`/track-race/referee-accounts/${row.id}`);
    message.success('已删除');
    loadReferees();
  } catch (e) {
    message.error(e.message);
  }
}

/* ---------- 公共 ---------- */
async function loadHeats() {
  if (!store.competitionId) return;
  try {
    heatList.value = await http.get('/track-result/workbench', {
      params: { competition_id: store.competitionId }
    });
  } catch (e) {
    heatList.value = [];
  }
}

async function loadMeta() {
  if (!store.competitionId) return;
  try {
    events.value = await http.get('/event/items', { params: { competition_id: store.competitionId } });
    bands.value = await http.get('/event/bands', { params: { competition_id: store.competitionId } });
    schools.value = await http.get('/school/list');
    allAthletes.value = await http.get('/entry/athletes', { params: { competition_id: store.competitionId } })
      .catch(() => []);
  } catch (e) {
    message.error(e.message);
  }
}

onMounted(async () => {
  await loadMeta();
  await Promise.all([loadBibs(), loadChanges(), loadHeats(), loadAnnouncements(), loadReferees()]);
});
watch(() => store.competitionId, async () => {
  await loadMeta();
  await Promise.all([loadBibs(), loadChanges(), loadHeats(), loadAnnouncements(), loadReferees()]);
});
</script>

<style scoped>
.tr-card { border-radius: 8px; }
.tb-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.hint { font-size: 12px; color: var(--app-text-3); }
.dim { font-size: 13px; color: var(--app-text-2); }
.unit { font-size: 12px; color: var(--app-text-3); margin-left: 6px; }
.warn-text { font-size: 12px; color: var(--app-error); }
.empty-tip { padding: 40px; text-align: center; color: var(--app-text-3); font-size: 13px; }

.bib-val { font-weight: 700; color: var(--td-brand-color); font-family: Consolas, monospace; }

.miss-box {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--app-error);
  border-radius: 4px;
  background: #fff5f5;
}
.miss-box.warn { border-color: #e37318; background: #fff8f0; }
.miss-title { font-size: 13px; font-weight: 600; color: var(--app-error); margin-bottom: 4px; }
.miss-box.warn .miss-title { color: #e37318; }
.miss-list { font-size: 12px; color: var(--app-text-2); line-height: 1.6; }

.change-ops { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }

.switches { display: flex; gap: 16px; flex-wrap: wrap; margin-left: auto; }

/* 打印表 */
.sheet { padding: 10px 0; }
.sheet-head { text-align: center; margin-bottom: 14px; }
.sh-title { font-size: 20px; font-weight: 700; color: #000; }
.sh-sub { font-size: 13px; margin-top: 6px; color: #333; }
.sheet-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.sheet-table th, .sheet-table td { border: 1px solid #000; padding: 6px 8px; }
.sheet-table th { background: #f2f2f2; font-weight: 600; }
.sheet-table td.c { text-align: center; }
.sheet-foot { margin-top: 22px; display: flex; gap: 40px; font-size: 13px; }
.sheet-note { margin-top: 14px; font-size: 12px; color: var(--app-text-2); }

.ann-title { font-size: 15px; font-weight: 600; margin-bottom: 10px; }

@media (max-width: 768px) {
  .hint, .switches { display: none; }
}
</style>
