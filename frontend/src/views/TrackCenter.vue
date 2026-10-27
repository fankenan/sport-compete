<template>
  <div>
    <t-card class="tc-card">
      <t-tabs v-model="activeTab">
        <!-- ================= 项目模板库 ================= -->
        <t-tab-panel label="项目模板库" value="templates">
          <div class="tb-row">
            <t-button theme="primary" @click="openTemplateCreate">新建模板</t-button>
            <t-select
              v-model="tplFilter.event_type"
              clearable
              placeholder="全部类型"
              style="width: 150px"
              :options="EVENT_TYPE_LIST"
              @change="loadTemplates"
            />
            <t-input v-model="tplFilter.keyword" clearable placeholder="搜索项目名" style="width: 180px" @enter="loadTemplates" />
            <t-button variant="outline" @click="loadTemplates">刷新</t-button>
            <span class="tb-hint">内置模板 45 个（径赛 / 田赛 / 接力 / 全能），可直接选用</span>
          </div>

          <t-table
            :data="templates"
            :columns="tplColumns"
            row-key="id"
            :loading="loadingTpl"
            empty="暂无模板"
            hover
          >
            <template #event_type="{ row }">
              <t-tag :theme="eventTypeTheme(row.event_type)" size="small" variant="light">
                {{ eventTypeLabel(row.event_type) }}
              </t-tag>
            </template>
            <template #result_entry_type="{ row }">
              <span class="dim">{{ entryTypeLabel(row.result_entry_type) }}</span>
            </template>
            <template #is_higher_better="{ row }">
              <span class="dim">{{ row.is_higher_better ? '越大越好' : '越小越好' }}</span>
            </template>
            <template #scope="{ row }">
              <t-tag v-if="row.built_in_flag === 1" size="small" variant="light" theme="primary">内置</t-tag>
              <t-tag v-else size="small" variant="light" theme="success">自定义</t-tag>
              <t-tag v-if="row.public_flag === 1" size="small" variant="outline" theme="warning">公共</t-tag>
            </template>
            <template #ops="{ row }">
              <t-button
                v-if="isAdmin && row.combined_parent_id == null"
                variant="text" theme="primary" size="small"
                @click="applyTemplate(row)"
              >加入赛事</t-button>
              <t-button variant="text" theme="default" size="small" @click="openTemplateEdit(row)">编辑</t-button>
              <t-button
                v-if="row.built_in_flag !== 1"
                variant="text" theme="danger" size="small"
                @click="removeTemplate(row)"
              >删除</t-button>
            </template>
          </t-table>
        </t-tab-panel>

        <!-- ================= 全能项目 ================= -->
        <t-tab-panel label="全能项目" value="combined">
          <div class="tb-row">
            <t-button theme="primary" @click="openCombinedCreate">新建全能项目</t-button>
            <t-button variant="outline" @click="loadCombined">刷新</t-button>
            <span class="tb-hint">子项成绩按国际田联公式自动换算积分并累加</span>
          </div>

          <div v-if="!combined.length" class="empty-tip">当前赛事还没有全能项目</div>
          <div v-for="p in combined" :key="p.id" class="combined-block">
            <div class="cb-head">
              <span class="cb-name">{{ p.name }}</span>
              <t-tag size="small" variant="light" theme="warning">{{ genderText(p.gender_requirement) }}</t-tag>
              <t-button variant="text" theme="primary" size="small" @click="openCombinedEdit(p)">编辑名称</t-button>
              <t-button variant="text" theme="danger" size="small" @click="removeCombined(p)">删除</t-button>
            </div>
            <t-table :data="p.children" :columns="childCols" row-key="id" hover>
              <template #event_type="{ row }">
                <t-tag size="small" variant="light">{{ eventTypeLabel(row.event_type) }}</t-tag>
              </template>
              <template #formula="{ row }">
                <span v-if="row.coefficient_a" class="formula">
                  A={{ row.coefficient_a }} B={{ row.coefficient_b }} C={{ row.coefficient_c }}（{{ row.input_unit }}）
                </span>
                <span v-else class="warn">未绑定评分公式</span>
              </template>
            </t-table>
          </div>
        </t-tab-panel>

        <!-- ================= 评分表与试算 ================= -->
        <t-tab-panel label="评分公式" value="score">
          <div class="tb-row">
            <t-button theme="primary" @click="openScoreTableCreate">新建评分表</t-button>
            <t-select v-model="scoreFilter.gender" clearable placeholder="全部性别" style="width: 130px" :options="GENDER_LIST" @change="loadScoreTables" />
            <t-button variant="outline" @click="loadScoreTables">刷新</t-button>
            <span class="tb-hint">国际田联标准公式：径赛 P=A×(B−T)^C，田赛 P=A×(M−B)^C</span>
          </div>

          <t-table :data="scoreTables" :columns="scoreCols" row-key="id" :loading="loadingScore" hover>
            <template #calc="{ row }">
              <t-tag size="small" variant="light">{{ row.calculation_type === 'TABLE' ? '查表' : '公式' }}</t-tag>
            </template>
            <template #ops="{ row }">
              <t-button variant="text" theme="primary" size="small" @click="openScoreTableEdit(row)">编辑</t-button>
              <t-button variant="text" theme="default" size="small" @click="openPreview(row)">试算</t-button>
            </template>
          </t-table>
        </t-tab-panel>

        <!-- ================= 赛事田径配置 ================= -->
        <t-tab-panel label="赛事田径配置" value="meet">
          <t-form :data="meetForm" label-width="130px" label-align="right" class="meet-form">
            <div class="sec-title">基本信息</div>
            <t-form-item label="主办单位">
              <t-input v-model="meetForm.host_unit" placeholder="如 登封市教育局" :maxlength="128" />
            </t-form-item>
            <t-form-item label="比赛地点">
              <t-input v-model="meetForm.venue" placeholder="如 登封市体育中心" :maxlength="128" />
            </t-form-item>
            <t-form-item label="联系人">
              <t-input v-model="meetForm.contact_person" :maxlength="32" style="width: 180px" />
            </t-form-item>
            <t-form-item label="联系电话">
              <t-input v-model="meetForm.contact_phone" :maxlength="20" style="width: 180px" />
            </t-form-item>
            <t-form-item label="赛事级别">
              <t-select v-model="meetForm.meet_level" style="width: 180px" :options="LEVEL_LIST" />
            </t-form-item>

            <div class="sec-title">场地与计时</div>
            <t-form-item label="直道道次">
              <t-input-number v-model="meetForm.straight_lane_count" :min="4" :max="12" :step="1" />
            </t-form-item>
            <t-form-item label="弯道道次">
              <t-input-number v-model="meetForm.curve_lane_count" :min="4" :max="12" :step="1" />
            </t-form-item>
            <t-form-item label="计时方式">
              <t-select v-model="meetForm.track_timing_mode" style="width: 220px" :options="TIMING_LIST" />
            </t-form-item>

            <div class="sec-title">编排规则</div>
            <t-form-item label="最小休息间隔">
              <t-input-number v-model="meetForm.minimum_rest_minutes" :min="0" :max="240" :step="5" />
              <span class="unit">分钟（同一运动员两项之间，用于兼项冲突判定）</span>
            </t-form-item>
            <t-form-item label="并列得分方式">
              <t-select v-model="meetForm.tie_score_mode" style="width: 220px" :options="TIE_LIST" />
            </t-form-item>
            <t-form-item label="减一制录取">
              <t-switch v-model="meetForm.deduct_one_flag" :custom-value="[1, 0]" />
              <span class="unit">开启后实际录取人数比配置少一人</span>
            </t-form-item>

            <div class="sec-title">加分设置</div>
            <t-form-item label="破纪录加分">
              <t-switch v-model="meetForm.record_bonus_flag" :custom-value="[1, 0]" />
              <t-input-number
                v-if="meetForm.record_bonus_flag"
                v-model="meetForm.record_bonus_value"
                :min="0" :max="100" :step="1" style="margin-left: 12px"
              />
              <span v-if="meetForm.record_bonus_flag" class="unit">分</span>
            </t-form-item>
            <t-form-item label="达级加分">
              <t-switch v-model="meetForm.grade_bonus_flag" :custom-value="[1, 0]" />
              <t-input-number
                v-if="meetForm.grade_bonus_flag"
                v-model="meetForm.grade_bonus_value"
                :min="0" :max="100" :step="1" style="margin-left: 12px"
              />
              <span v-if="meetForm.grade_bonus_flag" class="unit">分</span>
            </t-form-item>

            <div class="sec-title">报名与锁</div>
            <t-form-item label="报名需审核">
              <t-switch v-model="meetForm.enroll_audit_flag" :custom-value="[1, 0]" />
            </t-form-item>
            <t-form-item label="接力临时选拔">
              <t-switch v-model="meetForm.relay_temporary_selection_flag" :custom-value="[1, 0]" />
              <span class="unit">允许赛前临时调整棒次</span>
            </t-form-item>
            <t-form-item label="数据锁定">
              <div class="lock-row">
                <t-checkbox v-model="meetForm.enroll_lock_flag" :value="1">报名</t-checkbox>
                <t-checkbox v-model="meetForm.schedule_lock_flag" :value="1">编排</t-checkbox>
                <t-checkbox v-model="meetForm.timetable_lock_flag" :value="1">日程</t-checkbox>
                <t-checkbox v-model="meetForm.order_book_lock_flag" :value="1">秩序册</t-checkbox>
              </div>
            </t-form-item>

            <t-form-item>
              <t-button theme="primary" :loading="savingMeet" @click="saveMeetConfig">保存配置</t-button>
              <t-button variant="outline" style="margin-left: 8px" @click="loadMeetConfig">重新读取</t-button>
            </t-form-item>
          </t-form>
        </t-tab-panel>
      </t-tabs>
    </t-card>

    <!-- 模板编辑 -->
    <t-dialog v-model:visible="tplDialog" :header="tplForm.id ? '编辑模板' : '新建模板'" :width="isMobile ? '94%' : '620px'" attach="body">
      <t-form :data="tplForm" label-width="110px" label-align="right">
        <t-form-item label="项目名称" required-mark>
          <t-input v-model="tplForm.template_name" placeholder="如 男子100米" :maxlength="64" />
        </t-form-item>
        <t-form-item label="项目类型">
          <t-select v-model="tplForm.event_type" style="width: 100%" :options="EVENT_TYPE_LIST" />
        </t-form-item>
        <t-form-item label="性别">
          <t-select v-model="tplForm.gender" style="width: 140px" :options="GENDER_LIST" />
        </t-form-item>
        <t-form-item label="成绩形式">
          <t-select v-model="tplForm.result_entry_type" style="width: 100%" :options="ENTRY_TYPE_LIST" />
        </t-form-item>
        <t-form-item label="单位">
          <t-input v-model="tplForm.event_unit" placeholder="s / m / 分" style="width: 140px" />
        </t-form-item>
        <t-form-item label="越大越好">
          <t-switch v-model="tplForm.is_higher_better" :custom-value="[1, 0]" />
          <span class="unit">田赛开启，径赛关闭</span>
        </t-form-item>
        <t-form-item label="合理区间">
          <t-input-number v-model="tplForm.result_min_value" :min="0" :step="1" style="width: 120px" />
          <span class="unit">~</span>
          <t-input-number v-model="tplForm.result_max_value" :min="0" :step="1" style="width: 120px" />
        </t-form-item>
        <t-form-item label="小数位">
          <t-input-number v-model="tplForm.result_decimal_places" :min="0" :max="3" :step="1" />
        </t-form-item>
        <template v-if="tplForm.event_type === 'RELAY'">
          <t-form-item label="棒次数">
            <t-input-number v-model="tplForm.relay_leg_count" :min="2" :max="10" :step="1" />
          </t-form-item>
        </template>
        <template v-if="tplForm.event_type === 'FIELD'">
          <t-form-item label="基础试跳（投）">
            <t-input-number v-model="tplForm.base_attempt_count" :min="1" :max="9" :step="1" />
            <span class="unit">次</span>
          </t-form-item>
          <t-form-item label="附加次数">
            <t-input-number v-model="tplForm.extra_attempt_count" :min="0" :max="9" :step="1" />
            <span class="unit">次</span>
          </t-form-item>
          <t-form-item label="进入后三轮">
            <t-input-number v-model="tplForm.extra_qualifier_count" :min="0" :max="64" :step="1" />
            <span class="unit">人</span>
          </t-form-item>
        </template>
        <t-form-item label="预计用时">
          <t-input-number v-model="tplForm.estimated_unit_minutes" :min="0" :max="300" :step="5" />
          <span class="unit">分钟</span>
        </t-form-item>
        <t-form-item label="团体分倍数">
          <t-input-number v-model="tplForm.team_score_multiplier" :min="0" :max="10" :step="0.5" />
        </t-form-item>
        <t-form-item label="纳入公共库">
          <t-switch v-model="tplForm.public_flag" :custom-value="[1, 0]" />
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button variant="outline" @click="tplDialog = false">取消</t-button>
        <t-button theme="primary" :loading="saving" @click="submitTemplate">保存</t-button>
      </template>
    </t-dialog>

    <!-- 全能项目新建 -->
    <t-dialog v-model:visible="combinedDialog" header="新建全能项目" :width="isMobile ? '94%' : '780px'" attach="body">
      <t-form :data="combinedForm" label-width="100px" label-align="right">
        <t-form-item label="项目名称" required-mark>
          <t-input v-model="combinedForm.name" placeholder="如 高中男子五项全能" :maxlength="64" />
        </t-form-item>
        <t-form-item label="性别">
          <t-select v-model="combinedForm.gender" style="width: 140px" :options="GENDER_LIST" />
        </t-form-item>
        <t-form-item label="子项目">
          <div class="child-editor">
            <div v-for="(c, i) in combinedForm.children" :key="i" class="child-row">
              <span class="child-no">{{ i + 1 }}</span>
              <t-input v-model="c.name" placeholder="子项名称" style="width: 120px" />
              <t-select v-model="c.event_type" style="width: 100px" :options="[{ value: 'TRACK', label: '径赛' }, { value: 'FIELD', label: '田赛' }]" @change="onChildTypeChange(c)" />
              <t-select v-model="c.result_entry_type" style="width: 110px" :options="ENTRY_TYPE_LIST" />
              <t-select v-model="c.event_key" clearable filterable placeholder="评分公式" style="width: 200px" :options="scoreKeyOptions(c.event_type)" />
              <t-button variant="text" theme="danger" size="small" @click="removeChild(i)">删除</t-button>
            </div>
            <t-button variant="dashed" size="small" @click="addChild">+ 添加子项</t-button>
          </div>
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button variant="outline" @click="combinedDialog = false">取消</t-button>
        <t-button theme="primary" :loading="saving" @click="submitCombined">创建</t-button>
      </template>
    </t-dialog>

    <!-- 评分表编辑 -->
    <t-dialog v-model:visible="scoreDialog" :header="scoreForm.id ? '编辑评分表' : '新建评分表'" :width="isMobile ? '94%' : '600px'" attach="body">
      <t-form :data="scoreForm" label-width="110px" label-align="right">
        <t-form-item label="表名" required-mark>
          <t-input v-model="scoreForm.table_name" :maxlength="64" />
        </t-form-item>
        <t-form-item label="项目键">
          <t-input v-model="scoreForm.event_key" placeholder="如 100M / LJ / SP" style="width: 160px" />
        </t-form-item>
        <t-form-item label="性别">
          <t-select v-model="scoreForm.gender" style="width: 140px" :options="GENDER_LIST" />
        </t-form-item>
        <t-form-item label="计算方式">
          <t-radio-group v-model="scoreForm.calculation_type">
            <t-radio value="FORMULA">公式</t-radio>
            <t-radio value="TABLE">查表</t-radio>
          </t-radio-group>
        </t-form-item>
        <template v-if="scoreForm.calculation_type === 'FORMULA'">
          <t-form-item label="公式类型">
            <t-select v-model="scoreForm.formula_type" style="width: 200px" :options="FORMULA_LIST" />
          </t-form-item>
          <t-form-item label="系数 A">
            <t-input-number v-model="scoreForm.coefficient_a" :step="0.0001" />
          </t-form-item>
          <t-form-item label="基准 B">
            <t-input-number v-model="scoreForm.coefficient_b" :step="1" />
          </t-form-item>
          <t-form-item label="指数 C">
            <t-input-number v-model="scoreForm.coefficient_c" :step="0.01" />
          </t-form-item>
          <t-form-item label="输入单位">
            <t-select v-model="scoreForm.input_unit" style="width: 140px" :options="[{ value: 's', label: '秒' }, { value: 'm', label: '米' }, { value: 'cm', label: '厘米' }]" />
          </t-form-item>
          <t-form-item label="计时修正">
            <t-input-number v-model="scoreForm.timing_adjustment" :step="0.01" />
            <span class="unit">秒（手计时补正，无则留空）</span>
          </t-form-item>
        </template>
        <t-form-item label="取整方式">
          <t-select v-model="scoreForm.rounding_mode" style="width: 160px" :options="ROUNDING_LIST" />
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button variant="outline" @click="scoreDialog = false">取消</t-button>
        <t-button theme="primary" :loading="saving" @click="submitScoreTable">保存</t-button>
      </template>
    </t-dialog>

    <!-- 试算 -->
    <t-dialog v-model:visible="previewDialog" header="成绩换算试算" :width="isMobile ? '94%' : '440px'" attach="body">
      <t-form :data="previewForm" label-width="90px" label-align="right">
        <t-form-item label="评分表">
          <span class="dim">{{ previewForm.table_name }}</span>
        </t-form-item>
        <t-form-item label="成绩形式">
          <t-select v-model="previewForm.entry_type" style="width: 160px" :options="ENTRY_TYPE_LIST" />
        </t-form-item>
        <t-form-item label="成绩">
          <t-input v-model="previewForm.value" placeholder="如 10.50 / 1:23.45 / 7.50" style="width: 200px" />
        </t-form-item>
        <t-form-item label="换算结果">
          <span class="score-big">{{ previewResult ?? '—' }}</span>
          <span class="unit">分</span>
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button variant="outline" @click="previewDialog = false">关闭</t-button>
        <t-button theme="primary" :loading="previewing" @click="runPreview">换算</t-button>
      </template>
    </t-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue';
import { useUserStore } from '../store/user';
import http from '../api/http';
import { message, confirm } from '../utils/ui';

const store = useUserStore();
const isAdmin = computed(() => Number(store.user?.role) === 1);

const isMobile = ref(window.innerWidth <= 768);
function onResize() { isMobile.value = window.innerWidth <= 768; }
onMounted(() => window.addEventListener('resize', onResize));
onUnmounted(() => window.removeEventListener('resize', onResize));

const EVENT_TYPE_LIST = [
  { value: 'TRACK', label: '径赛' },
  { value: 'FIELD', label: '田赛' },
  { value: 'RELAY', label: '接力' },
  { value: 'COMBINED', label: '全能' },
  { value: 'BALL', label: '球类' }
];
const GENDER_LIST = [
  { value: 'A', label: '不限' },
  { value: 'M', label: '男子' },
  { value: 'F', label: '女子' }
];
const ENTRY_TYPE_LIST = [
  { value: 'TIME', label: '时间（秒）' },
  { value: 'DISTANCE', label: '远度（米）' },
  { value: 'HEIGHT', label: '高度（米）' },
  { value: 'POINT', label: '分值' }
];
const LEVEL_LIST = [
  { value: 1, label: '国家级' }, { value: 2, label: '省级' }, { value: 3, label: '市级' },
  { value: 4, label: '县级' }, { value: 5, label: '校级' }
];
const TIMING_LIST = [
  { value: 'SIMPLE_MANUAL', label: '手计时' },
  { value: 'ELECTRONIC', label: '电计时' },
  { value: 'MANUAL_PLUS', label: '手计时 + 修正' }
];
const TIE_LIST = [
  { value: 'RANK', label: '并列后跳号（1,2,2,4）' },
  { value: 'SHARE', label: '并列共享名次' },
  { value: 'NEXT', label: '不并列，依次排' }
];
const FORMULA_LIST = [
  { value: 'IaAF', label: '国际田联标准公式' },
  { value: 'LINEAR', label: '线性公式' },
  { value: 'CUSTOM', label: '自定义' }
];
const ROUNDING_LIST = [
  { value: 'FLOOR', label: '向下取整' },
  { value: 'ROUND', label: '四舍五入' },
  { value: 'CEIL', label: '向上取整' }
];

const activeTab = ref('templates');
const saving = ref(false);

/* ---------- 项目模板库 ---------- */
const templates = ref([]);
const loadingTpl = ref(false);
const tplFilter = reactive({ event_type: '', keyword: '' });
const tplDialog = ref(false);
const tplForm = reactive(blankTemplate());

const tplColumns = [
  { colKey: 'template_name', title: '项目名称', minWidth: 140 },
  { colKey: 'event_type', title: '类型', width: 84, align: 'center' },
  { colKey: 'result_entry_type', title: '成绩形式', width: 110, align: 'center' },
  { colKey: 'event_unit', title: '单位', width: 70, align: 'center' },
  { colKey: 'is_higher_better', title: '优劣方向', width: 100, align: 'center' },
  { colKey: 'scope', title: '来源', width: 130, align: 'center' },
  { colKey: 'ops', title: '操作', width: 190, align: 'center', fixed: 'right' }
];

function blankTemplate() {
  return {
    id: null, template_name: '', event_type: 'TRACK', category: 1, gender: 'A',
    result_entry_type: 'TIME', event_unit: 's', is_higher_better: 0,
    result_min_value: null, result_max_value: null, result_decimal_places: 2,
    need_lane_order: 1, relay_leg_count: 4, has_preliminary: 0, admission_count: null,
    base_attempt_count: 3, extra_attempt_count: 3, extra_qualifier_count: null,
    result_aggregation_mode: 'BEST', team_score_multiplier: 1,
    estimated_unit_minutes: null, public_flag: 0, sort_no: 0
  };
}

async function loadTemplates() {
  loadingTpl.value = true;
  try {
    const params = {};
    if (tplFilter.event_type) params.event_type = tplFilter.event_type;
    if (tplFilter.keyword) params.keyword = tplFilter.keyword;
    templates.value = await http.get('/track/templates', { params });
  } catch (e) {
    message.error(e.message);
  } finally {
    loadingTpl.value = false;
  }
}

function openTemplateCreate() {
  Object.assign(tplForm, blankTemplate());
  tplDialog.value = true;
}

function openTemplateEdit(row) {
  Object.assign(tplForm, blankTemplate(), {
    id: row.id,
    template_name: row.template_name,
    event_type: row.event_type,
    category: row.category,
    gender: row.gender,
    result_entry_type: row.result_entry_type,
    event_unit: row.event_unit || '',
    is_higher_better: row.is_higher_better ?? 0,
    result_min_value: row.result_min_value,
    result_max_value: row.result_max_value,
    result_decimal_places: row.result_decimal_places ?? 2,
    relay_leg_count: row.relay_leg_count ?? 4,
    base_attempt_count: row.base_attempt_count ?? 3,
    extra_attempt_count: row.extra_attempt_count ?? 3,
    extra_qualifier_count: row.extra_qualifier_count,
    team_score_multiplier: row.team_score_multiplier ?? 1,
    estimated_unit_minutes: row.estimated_unit_minutes,
    public_flag: row.public_flag ?? 0,
    sort_no: row.sort_no ?? 0
  });
  tplDialog.value = true;
}

async function submitTemplate() {
  if (!tplForm.template_name.trim()) { message.warning('请填写项目名称'); return; }
  saving.value = true;
  try {
    const payload = { ...tplForm };
    payload.category = tplForm.event_type === 'FIELD' ? 2 : 1;
    if (tplForm.id) {
      await http.put(`/track/templates/${tplForm.id}`, payload);
      message.success('已保存');
    } else {
      await http.post('/track/templates', payload);
      message.success('模板已创建');
    }
    tplDialog.value = false;
    loadTemplates();
  } catch (e) {
    message.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function applyTemplate(row) {
  if (!store.competitionId) { message.warning('请先在右上角选择赛事'); return; }
  try {
    const r = await http.post('/track/events/from-template', {
      competition_id: store.competitionId,
      template_ids: [row.id]
    });
    message.success(r?.message || '已加入赛事');
  } catch (e) {
    message.error(e.message);
  }
}

async function removeTemplate(row) {
  let go = false;
  await confirm(`确定删除模板「${row.template_name}」？`, '删除确认', { confirmBtn: '确定删除' }).then(() => { go = true; }).catch(() => {});
  if (!go) return;
  try {
    await http.delete(`/track/templates/${row.id}`);
    message.success('已删除');
    loadTemplates();
  } catch (e) {
    message.error(e.message);
  }
}

/* ---------- 全能项目 ---------- */
const combined = ref([]);
const combinedDialog = ref(false);
const combinedForm = reactive({ name: '', gender: 'M', children: [] });

const childCols = [
  { colKey: 'combined_item_order', title: '顺序', width: 70, align: 'center' },
  { colKey: 'combined_item_name', title: '子项名称', minWidth: 130 },
  { colKey: 'event_type', title: '类型', width: 80, align: 'center' },
  { colKey: 'event_unit', title: '单位', width: 70, align: 'center' },
  { colKey: 'formula', title: '评分公式', minWidth: 240 }
];

async function loadCombined() {
  if (!store.competitionId) { combined.value = []; return; }
  try {
    combined.value = await http.get('/track/combined', { params: { competition_id: store.competitionId } });
  } catch (e) {
    message.error(e.message);
  }
}

function openCombinedCreate() {
  if (!store.competitionId) { message.warning('请先选择赛事'); return; }
  combinedForm.name = '';
  combinedForm.gender = 'M';
  combinedForm.children = [
    { name: '跳远', event_type: 'FIELD', result_entry_type: 'DISTANCE', event_key: 'LJ' },
    { name: '铅球', event_type: 'FIELD', result_entry_type: 'DISTANCE', event_key: 'SP' },
    { name: '200米', event_type: 'TRACK', result_entry_type: 'TIME', event_key: '200M' }
  ];
  combinedDialog.value = true;
}

function addChild() {
  combinedForm.children.push({ name: '', event_type: 'TRACK', result_entry_type: 'TIME', event_key: '' });
}
function removeChild(i) { combinedForm.children.splice(i, 1); }
function onChildTypeChange(c) {
  c.result_entry_type = c.event_type === 'FIELD' ? 'DISTANCE' : 'TIME';
  c.event_key = '';
}

function scoreKeyOptions(type) {
  return scoreTables.value
    .filter((t) => {
      if (type === 'FIELD') return ['LJ', 'HJ', 'SP', 'DT', 'JT', 'PV'].includes(t.event_key);
      return ['100M', '200M', '400M', '800M', '1500M', '110MH', '100MH'].includes(t.event_key);
    })
    .map((t) => ({ value: t.event_key, label: `${t.table_name}（${t.gender === 'M' ? '男' : t.gender === 'F' ? '女' : '通用'}）` }));
}

async function submitCombined() {
  if (!combinedForm.name.trim()) { message.warning('请填写全能项目名称'); return; }
  if (!combinedForm.children.length) { message.warning('至少添加一个子项'); return; }
  saving.value = true;
  try {
    await http.post('/track/combined', {
      competition_id: store.competitionId,
      name: combinedForm.name.trim(),
      gender: combinedForm.gender,
      children: combinedForm.children.map((c) => ({
        name: c.name,
        event_type: c.event_type,
        result_entry_type: c.result_entry_type,
        event_unit: c.event_type === 'FIELD' ? 'm' : 's',
        event_key: c.event_key || null,
        result_decimal_places: c.event_type === 'FIELD' ? 2 : 2
      }))
    });
    message.success('全能项目已创建');
    combinedDialog.value = false;
    loadCombined();
  } catch (e) {
    message.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function openCombinedEdit(p) {
  const name = await new Promise((resolve) => {
    const val = window.prompt('全能项目名称', p.name);
    resolve(val);
  });
  if (name === null || !name.trim() || name === p.name) return;
  try {
    await http.put(`/track/combined/${p.id}`, { name: name.trim() });
    message.success('已保存');
    loadCombined();
  } catch (e) {
    message.error(e.message);
  }
}

async function removeCombined(p) {
  let go = false;
  await confirm(`确定删除「${p.name}」？子项目会一并删除。`, '删除确认', { confirmBtn: '确定删除' }).then(() => { go = true; }).catch(() => {});
  if (!go) return;
  try {
    await http.delete(`/track/combined/${p.id}`);
    message.success('已删除');
    loadCombined();
  } catch (e) {
    message.error(e.message);
  }
}

/* ---------- 评分表 ---------- */
const scoreTables = ref([]);
const loadingScore = ref(false);
const scoreFilter = reactive({ gender: '' });
const scoreDialog = ref(false);
const scoreForm = reactive({
  id: null, table_name: '', table_type: 'COMBINED', event_key: '', gender: 'A',
  calculation_type: 'FORMULA', formula_type: 'IaAF',
  coefficient_a: null, coefficient_b: null, coefficient_c: null,
  input_unit: 's', rounding_mode: 'FLOOR', timing_adjustment: null, remark: ''
});

const scoreCols = [
  { colKey: 'table_name', title: '评分表', minWidth: 160 },
  { colKey: 'event_key', title: '项目键', width: 90, align: 'center' },
  { colKey: 'gender', title: '性别', width: 70, align: 'center' },
  { colKey: 'calc', title: '方式', width: 80, align: 'center' },
  { colKey: 'coefficient_a', title: 'A', width: 100, align: 'right' },
  { colKey: 'coefficient_b', title: 'B', width: 80, align: 'right' },
  { colKey: 'coefficient_c', title: 'C', width: 80, align: 'right' },
  { colKey: 'input_unit', title: '单位', width: 70, align: 'center' },
  { colKey: 'ops', title: '操作', width: 130, align: 'center', fixed: 'right' }
];

async function loadScoreTables() {
  loadingScore.value = true;
  try {
    const params = {};
    if (scoreFilter.gender) params.gender = scoreFilter.gender;
    scoreTables.value = await http.get('/track/score-tables', { params });
  } catch (e) {
    message.error(e.message);
  } finally {
    loadingScore.value = false;
  }
}

function openScoreTableCreate() {
  Object.assign(scoreForm, {
    id: null, table_name: '', table_type: 'COMBINED', event_key: '', gender: 'A',
    calculation_type: 'FORMULA', formula_type: 'IaAF',
    coefficient_a: null, coefficient_b: null, coefficient_c: null,
    input_unit: 's', rounding_mode: 'FLOOR', timing_adjustment: null, remark: ''
  });
  scoreDialog.value = true;
}

function openScoreTableEdit(row) {
  Object.assign(scoreForm, {
    id: row.id, table_name: row.table_name, table_type: row.table_type,
    event_key: row.event_key || '', gender: row.gender,
    calculation_type: row.calculation_type, formula_type: row.formula_type,
    coefficient_a: row.coefficient_a, coefficient_b: row.coefficient_b, coefficient_c: row.coefficient_c,
    input_unit: row.input_unit || 's', rounding_mode: row.rounding_mode, timing_adjustment: row.timing_adjustment
  });
  scoreDialog.value = true;
}

async function submitScoreTable() {
  if (!scoreForm.table_name.trim()) { message.warning('请填写评分表名称'); return; }
  saving.value = true;
  try {
    if (scoreForm.id) {
      await http.put(`/track/score-tables/${scoreForm.id}`, scoreForm);
      message.success('已保存');
    } else {
      await http.post('/track/score-tables', scoreForm);
      message.success('评分表已创建');
    }
    scoreDialog.value = false;
    loadScoreTables();
  } catch (e) {
    message.error(e.message);
  } finally {
    saving.value = false;
  }
}

/* ---------- 试算 ---------- */
const previewDialog = ref(false);
const previewing = ref(false);
const previewResult = ref(null);
const previewForm = reactive({ score_table_id: null, table_name: '', entry_type: 'TIME', value: '' });

function openPreview(row) {
  previewForm.score_table_id = row.id;
  previewForm.table_name = row.table_name;
  previewForm.entry_type = ['LJ', 'HJ', 'SP', 'DT', 'JT', 'PV'].includes(row.event_key)
    ? (row.event_key === 'HJ' ? 'HEIGHT' : 'DISTANCE')
    : 'TIME';
  previewForm.value = '';
  previewResult.value = null;
  previewDialog.value = true;
}

async function runPreview() {
  if (!previewForm.value.trim()) { message.warning('请输入成绩'); return; }
  previewing.value = true;
  try {
    const r = await http.post('/track/score/preview', {
      score_table_id: previewForm.score_table_id,
      entry_type: previewForm.entry_type,
      value: previewForm.value.trim()
    });
    previewResult.value = r?.score ?? 0;
  } catch (e) {
    message.error(e.message);
  } finally {
    previewing.value = false;
  }
}

/* ---------- 赛事配置 ---------- */
const savingMeet = ref(false);
const meetForm = reactive({
  host_unit: '', venue: '', contact_person: '', contact_phone: '', meet_level: 3,
  straight_lane_count: 8, curve_lane_count: 8, track_timing_mode: 'SIMPLE_MANUAL',
  minimum_rest_minutes: 30, tie_score_mode: 'RANK', deduct_one_flag: 0,
  record_bonus_flag: 0, record_bonus_value: null,
  grade_bonus_flag: 0, grade_bonus_value: null,
  enroll_audit_flag: 1, relay_temporary_selection_flag: 0,
  enroll_lock_flag: 0, schedule_lock_flag: 0, timetable_lock_flag: 0, order_book_lock_flag: 0
});

async function loadMeetConfig() {
  if (!store.competitionId) return;
  try {
    const d = await http.get('/track/meet-config', { params: { competition_id: store.competitionId } });
    if (d) Object.assign(meetForm, {
      host_unit: d.host_unit || '', venue: d.venue || '',
      contact_person: d.contact_person || '', contact_phone: d.contact_phone || '',
      meet_level: d.meet_level ?? 3,
      straight_lane_count: d.straight_lane_count ?? 8,
      curve_lane_count: d.curve_lane_count ?? 8,
      track_timing_mode: d.track_timing_mode || 'SIMPLE_MANUAL',
      minimum_rest_minutes: d.minimum_rest_minutes ?? 30,
      tie_score_mode: d.tie_score_mode || 'RANK',
      deduct_one_flag: d.deduct_one_flag ?? 0,
      record_bonus_flag: d.record_bonus_flag ?? 0,
      record_bonus_value: d.record_bonus_value ?? null,
      grade_bonus_flag: d.grade_bonus_flag ?? 0,
      grade_bonus_value: d.grade_bonus_value ?? null,
      enroll_audit_flag: d.enroll_audit_flag ?? 1,
      relay_temporary_selection_flag: d.relay_temporary_selection_flag ?? 0,
      enroll_lock_flag: d.enroll_lock_flag ?? 0,
      schedule_lock_flag: d.schedule_lock_flag ?? 0,
      timetable_lock_flag: d.timetable_lock_flag ?? 0,
      order_book_lock_flag: d.order_book_lock_flag ?? 0
    });
  } catch (e) {
    message.error(e.message);
  }
}

async function saveMeetConfig() {
  if (!store.competitionId) { message.warning('请先选择赛事'); return; }
  savingMeet.value = true;
  try {
    await http.put('/track/meet-config', { competition_id: store.competitionId, ...meetForm });
    message.success('赛事配置已保存');
  } catch (e) {
    message.error(e.message);
  } finally {
    savingMeet.value = false;
  }
}

/* ---------- 工具 ---------- */
function eventTypeLabel(v) {
  return { TRACK: '径赛', FIELD: '田赛', RELAY: '接力', COMBINED: '全能', BALL: '球类' }[v] || v || '—';
}
function eventTypeTheme(v) {
  return { TRACK: 'warning', FIELD: 'success', RELAY: 'danger', COMBINED: 'primary', BALL: 'default' }[v] || 'default';
}
function entryTypeLabel(v) {
  return { TIME: '时间', DISTANCE: '远度', HEIGHT: '高度', POINT: '分值', SCORE: '比分' }[v] || v || '—';
}
function genderText(v) {
  return { M: '男子', F: '女子', A: '不限' }[v] || '不限';
}

onMounted(() => {
  loadTemplates();
  loadScoreTables();
  loadCombined();
  loadMeetConfig();
});
watch(() => store.competitionId, () => {
  loadCombined();
  loadMeetConfig();
});
</script>

<style scoped>
.tc-card { border-radius: 8px; }

.tb-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.tb-hint { font-size: 12px; color: var(--app-text-3); }
.dim { font-size: 13px; color: var(--app-text-2); }
.unit { font-size: 12px; color: var(--app-text-3); margin-left: 6px; }

.empty-tip {
  padding: 28px;
  text-align: center;
  color: var(--app-text-3);
  font-size: 13px;
}

.combined-block {
  margin-bottom: 16px;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  overflow: hidden;
}
.cb-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--app-bg);
  border-bottom: 1px solid var(--app-border);
}
.cb-name { font-weight: 600; color: var(--app-text-1); }
.formula { font-size: 12px; color: var(--app-text-2); font-family: Consolas, monospace; }
.warn { font-size: 12px; color: var(--app-error); }

.meet-form { max-width: 780px; }
.sec-title {
  margin: 14px 0 10px;
  padding-left: 8px;
  border-left: 3px solid var(--td-brand-color);
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text-1);
}
.sec-title:first-child { margin-top: 0; }

.lock-row { display: flex; gap: 16px; flex-wrap: wrap; }

.child-editor { width: 100%; }
.child-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.child-no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--app-bg);
  font-size: 12px;
  color: var(--app-text-2);
}

.score-big {
  font-size: 22px;
  font-weight: 700;
  color: var(--td-brand-color);
}

@media (max-width: 768px) {
  .tb-hint { display: none; }
}
</style>
