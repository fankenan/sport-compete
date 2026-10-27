<template>
  <div>
    <t-card class="setup-card">
      <t-tabs v-model="activeTab" class="setup-tabs">
        <!-- 竞赛项目 -->
        <t-tab-panel label="竞赛项目" value="items">
          <div class="tb-row">
            <t-button theme="primary" @click="openItemCreate">新增项目</t-button>
            <t-button theme="default" @click="openTemplatePicker">从模板库添加</t-button>
            <t-button variant="outline" @click="loadAll">刷新</t-button>
            <span class="tb-hint">球类项目使用小组赛制参数，径赛/田赛使用分组与道次参数</span>
          </div>

          <div class="table-scroll">
            <t-table
              :data="items"
              :columns="itemColumns"
              row-key="id"
              :loading="loadingItems"
              :empty="'尚未设置竞赛项目'"
              hover
            >
              <template #category="{ row }">
                <t-tag :theme="categoryType(row.category)" size="small" variant="light">
                  {{ categoryLabel(row.category) }}
                </t-tag>
              </template>

              <template #is_relay="{ row }">
                <span v-if="row.is_relay === 1" class="dim">是</span>
                <span v-else class="dim">否</span>
              </template>

              <template #team_params="{ row }">
                <div v-if="row.category === 3" class="param-grid">
                  <span>时长 {{ row.match_minutes }}分</span>
                  <span>间隔 {{ row.slot_interval }}分</span>
                  <span>分组 {{ row.group_count || '自动' }}</span>
                  <span>轮次 {{ row.rounds_per_group || '自动' }}</span>
                  <span>出线 {{ row.advance_count }}人</span>
                  <span>配对 {{ pairingLabel(row.pairing_rule) }}</span>
                  <span>三四名 {{ row.has_third_place ? '有' : '无' }}</span>
                </div>
                <span v-else class="dim">—</span>
              </template>

              <template #track_params="{ row }">
                <div v-if="row.category === 1 || row.category === 2" class="param-grid">
                  <span>道次 {{ row.lane_count }}</span>
                  <span>预赛上限 {{ row.prelim_max }}</span>
                  <span v-if="row.result_entry_type">成绩 {{ entryTypeLabel(row.result_entry_type) }}</span>
                  <span v-if="row.event_unit">单位 {{ row.event_unit }}</span>
                  <span v-if="row.admission_count">录取 {{ row.admission_count }}人</span>
                  <span v-if="row.category === 2">
                    试跳 {{ row.base_attempt_count || 3 }}+{{ row.extra_attempt_count || 3 }}
                  </span>
                </div>
                <span v-else class="dim">—</span>
              </template>

              <template #ops="{ row }">
                <t-button variant="text" theme="primary" size="small" @click="openItemEdit(row)">编辑</t-button>
                <t-button variant="text" theme="danger" size="small" @click="removeItem(row)">删除</t-button>
              </template>
            </t-table>
          </div>
        </t-tab-panel>

        <!-- 组别管理 -->
        <t-tab-panel label="组别管理" value="bands">
          <div class="tb-row">
            <t-button theme="primary" @click="openBandCreate">新增组别</t-button>
            <t-button variant="outline" @click="loadAll">刷新</t-button>
            <span class="tb-hint">组别 = 学段 + 性别 + 自定义标签</span>
          </div>

          <div class="table-scroll">
            <t-table
              :data="bands"
              :columns="bandColumns"
              row-key="id"
              :loading="loadingBands"
              :empty="'尚未设置组别'"
              hover
            >
              <template #band_name="{ row }">
                <span class="band-name">{{ bandLabel(row) }}</span>
              </template>

              <template #stage="{ row }">{{ stageLabel(row.stage) }}</template>

              <template #gender="{ row }">{{ genderLabel(row.gender) }}</template>

              <template #sub="{ row }">
                <span class="dim">{{ subLabel(row) }}</span>
              </template>

              <template #sort_no="{ row }">
                <span class="dim">{{ row.sort_no ?? 0 }}</span>
              </template>

              <template #ops="{ row }">
                <t-button variant="text" theme="primary" size="small" @click="openBandEdit(row)">编辑</t-button>
                <t-button variant="text" theme="danger" size="small" @click="removeBand(row)">删除</t-button>
              </template>
            </t-table>
          </div>
        </t-tab-panel>

        <!-- 场地管理 -->
        <t-tab-panel label="场地管理" value="venues">
          <div class="tb-row">
            <t-button theme="primary" @click="openVenueCreate">新增场地</t-button>
            <t-button variant="outline" @click="loadAll">刷新</t-button>
            <span class="tb-hint">场地编号用于日程表横向排列</span>
          </div>

          <div class="table-scroll">
            <t-table
              :data="venues"
              :columns="venueColumns"
              row-key="id"
              :loading="loadingVenues"
              :empty="'尚未设置场地'"
              hover
            >
              <template #venue_no="{ row }">
                <span class="venue-no">{{ row.venue_no }}</span>
              </template>

              <template #host_school_name="{ row }">
                <span v-if="row.host_school_name" class="dim">{{ row.host_school_name }}</span>
                <span v-else class="dim">未指定</span>
              </template>

              <template #ops="{ row }">
                <t-button variant="text" theme="primary" size="small" @click="openVenueEdit(row)">编辑</t-button>
                <t-button variant="text" theme="danger" size="small" @click="removeVenue(row)">删除</t-button>
              </template>
            </t-table>
          </div>
        </t-tab-panel>
      </t-tabs>
    </t-card>

    <!-- 项目表单 -->
    <t-dialog
      v-model:visible="itemDialog"
      :header="itemForm.id ? '编辑项目' : '新增项目'"
      :width="isMobile ? '94%' : '520px'" attach="body">
      <t-form :data="itemForm" label-width="104px" label-align="right">
        <t-form-item label="项目名称" required-mark>
          <t-input v-model="itemForm.name" placeholder="如 100米 / 篮球" :maxlength="64" />
        </t-form-item>
        <t-form-item label="项目类别" required-mark>
          <t-radio-group v-model="itemForm.category">
            <t-radio :value="1">径赛</t-radio>
            <t-radio :value="2">田赛</t-radio>
            <t-radio :value="3">球类</t-radio>
          </t-radio-group>
        </t-form-item>
        <t-form-item label="接力项目">
          <t-switch v-model="itemForm.is_relay" :custom-value="[1, 0]" />
        </t-form-item>

        <template v-if="itemForm.category === 3">
          <t-form-item label="单场时长">
            <t-input-number v-model="itemForm.match_minutes" :min="1" :max="120" :step="1" />
            <span class="unit">分钟</span>
          </t-form-item>
          <t-form-item label="槽位间隔">
            <t-input-number v-model="itemForm.slot_interval" :min="5" :max="180" :step="5" />
            <span class="unit">分钟</span>
          </t-form-item>
          <t-form-item label="分组数">
            <t-input-number v-model="itemForm.group_count" :min="0" :max="32" :step="1" />
            <span class="unit">组（0 按队数自动）</span>
          </t-form-item>
          <t-form-item label="每组轮次">
            <t-input-number v-model="itemForm.rounds_per_group" :min="0" :max="15" :step="1" />
            <span class="unit">轮（0 按队数自动）</span>
          </t-form-item>
          <t-form-item label="出线人数">
            <t-input-number v-model="itemForm.advance_count" :min="0" :max="64" :step="1" />
            <span class="unit">人</span>
          </t-form-item>
          <t-form-item label="配对规则">
            <t-select v-model="itemForm.pairing_rule" style="width: 100%" :options="PAIRING_LIST" />
          </t-form-item>
          <t-form-item label="打三四名">
            <t-switch v-model="itemForm.has_third_place" :custom-value="[1, 0]" />
          </t-form-item>
        </template>

        <template v-else>
          <t-form-item label="道次数">
            <t-input-number v-model="itemForm.lane_count" :min="1" :max="12" :step="1" />
          </t-form-item>
          <t-form-item label="预赛上限">
            <t-input-number v-model="itemForm.prelim_max" :min="2" :max="64" :step="1" />
            <span class="unit">人（超过加复赛）</span>
          </t-form-item>

          <t-divider align="left">田径参数</t-divider>

          <t-form-item label="成绩形式">
            <t-select v-model="itemForm.result_entry_type" style="width: 100%" :options="ENTRY_TYPE_LIST" @change="onEntryTypeChange" />
          </t-form-item>
          <t-form-item label="单位">
            <t-input v-model="itemForm.event_unit" placeholder="s / m" style="width: 140px" />
          </t-form-item>
          <t-form-item label="越大越好">
            <t-switch v-model="itemForm.is_higher_better" :custom-value="[1, 0]" />
            <span class="unit">田赛开启</span>
          </t-form-item>
          <t-form-item label="小数位">
            <t-input-number v-model="itemForm.result_decimal_places" :min="0" :max="3" :step="1" />
          </t-form-item>
          <t-form-item label="合理区间">
            <t-input-number v-model="itemForm.result_min_value" :min="0" :step="1" style="width: 120px" />
            <span class="unit">~</span>
            <t-input-number v-model="itemForm.result_max_value" :min="0" :step="1" style="width: 120px" />
          </t-form-item>
          <t-form-item label="是否有预赛">
            <t-switch v-model="itemForm.has_preliminary" :custom-value="[1, 0]" />
          </t-form-item>
          <t-form-item label="录取人数">
            <t-input-number v-model="itemForm.admission_count" :min="0" :max="64" :step="1" />
            <span class="unit">人（进入下一轮）</span>
          </t-form-item>

          <template v-if="itemForm.category === 2">
            <t-form-item label="基础试跳（投）">
              <t-input-number v-model="itemForm.base_attempt_count" :min="1" :max="9" :step="1" />
              <span class="unit">次</span>
            </t-form-item>
            <t-form-item label="附加次数">
              <t-input-number v-model="itemForm.extra_attempt_count" :min="0" :max="9" :step="1" />
              <span class="unit">次</span>
            </t-form-item>
            <t-form-item label="进入后三轮">
              <t-input-number v-model="itemForm.extra_qualifier_count" :min="0" :max="64" :step="1" />
              <span class="unit">人</span>
            </t-form-item>
          </template>

          <t-form-item label="团体分倍数">
            <t-input-number v-model="itemForm.team_score_multiplier" :min="0" :max="10" :step="0.5" />
            <span class="unit">接力常设 2</span>
          </t-form-item>
          <t-form-item label="预计用时">
            <t-input-number v-model="itemForm.estimated_unit_minutes" :min="0" :max="300" :step="5" />
            <span class="unit">分钟</span>
          </t-form-item>
        </template>
      </t-form>
      <template #footer>
        <t-button variant="outline" @click="itemDialog = false">取消</t-button>
        <t-button theme="primary" :loading="saving" @click="submitItem">保存</t-button>
      </template>
    </t-dialog>

    <!-- 从模板库批量添加 -->
    <t-dialog
      v-model:visible="tplDialog"
      header="从项目模板库添加"
      :width="isMobile ? '94%' : '760px'"
      :confirm-btn="{ content: '添加所选', theme: 'primary', loading: saving }"
      cancel-btn="取消"
      @confirm="submitTemplates" attach="body">
      <div class="tb-row">
        <t-input v-model="tplKeyword" clearable placeholder="搜索项目名" style="width: 200px" @enter="loadTplList" />
        <t-button variant="outline" @click="loadTplList">搜索</t-button>
        <span class="tb-hint">已选 {{ tplSelected.length }} 项；全能模板会连父项目与子项一起建</span>
      </div>
      <t-table
        :data="tplList"
        :columns="tplColumns"
        row-key="id"
        :loading="tplLoading"
        :selected-row-keys="tplSelected"
        select-on-row-click
        @select-change="onTplSelect"
        empty="暂无模板"
        hover
      >
        <template #event_type="{ row }">
          <t-tag size="small" variant="light">
            {{ { TRACK: '径赛', FIELD: '田赛', RELAY: '接力', COMBINED: '全能', BALL: '球类' }[row.event_type] || row.event_type }}
          </t-tag>
        </template>
        <template #result_entry_type="{ row }">
          <span class="dim">{{ entryTypeLabel(row.result_entry_type) }}</span>
        </template>
      </t-table>
    </t-dialog>

    <!-- 组别表单 -->
    <t-dialog
      v-model:visible="bandDialog"
      :header="bandForm.id ? '编辑组别' : '新增组别'"
      :width="isMobile ? '94%' : '440px'" attach="body">
      <t-form :data="bandForm" label-width="88px" label-align="right">
        <t-form-item label="学段" required-mark>
          <t-select v-model="bandForm.stage" style="width: 100%" :options="STAGE_LIST" />
        </t-form-item>
        <t-form-item label="性别" required-mark>
          <t-radio-group v-model="bandForm.gender">
            <t-radio :value="1">男</t-radio>
            <t-radio :value="2">女</t-radio>
          </t-radio-group>
        </t-form-item>
        <t-form-item label="组别标签">
          <t-input v-model="bandForm.label" placeholder="如 A / B 分组，一般留空" :maxlength="32" />
        </t-form-item>
        <t-form-item label="显示名称">
          <span class="band-preview">{{ bandLabel(bandForm) }}</span>
        </t-form-item>
        <t-form-item label="排序">
          <t-input-number v-model="bandForm.sort_no" :min="0" :max="999" :step="1" />
        </t-form-item>

        <t-divider align="left">报名限制</t-divider>
        <t-form-item label="每队限报人数">
          <t-input-number v-model="bandForm.team_max_total_count" :min="0" :max="200" :step="1" />
          <span class="unit">人（0 或留空表示不限）</span>
        </t-form-item>
        <t-form-item label="其中男生">
          <t-input-number v-model="bandForm.team_max_male_count" :min="0" :max="200" :step="1" />
        </t-form-item>
        <t-form-item label="其中女生">
          <t-input-number v-model="bandForm.team_max_female_count" :min="0" :max="200" :step="1" />
        </t-form-item>
        <t-form-item label="每人限报项目">
          <t-input-number v-model="bandForm.athlete_max_event_count" :min="0" :max="20" :step="1" />
          <span class="unit">项（接力是否计入另议）</span>
        </t-form-item>
        <t-form-item label="限制出生日期">
          <t-switch v-model="bandForm.birth_date_limit_flag" :custom-value="[1, 0]" />
        </t-form-item>
        <template v-if="bandForm.birth_date_limit_flag">
          <t-form-item label="出生日期区间">
            <t-date-picker
              v-model="bandForm.birth_date_start"
              value-type="YYYY-MM-DD"
              placeholder="起始"
              style="width: 150px"
              clearable
            />
            <span class="unit">至</span>
            <t-date-picker
              v-model="bandForm.birth_date_end"
              value-type="YYYY-MM-DD"
              placeholder="截止"
              style="width: 150px"
              clearable
            />
          </t-form-item>
        </template>
      </t-form>
      <template #footer>
        <t-button variant="outline" @click="bandDialog = false">取消</t-button>
        <t-button theme="primary" :loading="saving" @click="submitBand">保存</t-button>
      </template>
    </t-dialog>

    <!-- 场地表单 -->
    <t-dialog
      v-model:visible="venueDialog"
      :header="venueForm.id ? '编辑场地' : '新增场地'"
      :width="isMobile ? '94%' : '440px'" attach="body">
      <t-form :data="venueForm" label-width="88px" label-align="right">
        <t-form-item label="场地名称" required-mark>
          <t-input v-model="venueForm.name" placeholder="如 体育馆主场" :maxlength="64" />
        </t-form-item>
        <t-form-item label="场地编号">
          <t-input-number v-model="venueForm.venue_no" :min="1" :max="99" :step="1" />
        </t-form-item>
        <t-form-item label="所属学校">
          <t-select v-model="venueForm.host_school_id" clearable placeholder="不指定" style="width: 100%">
            <t-option v-for="s in schools" :key="s.id" :label="s.name" :value="s.id" />
          </t-select>
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button variant="outline" @click="venueDialog = false">取消</t-button>
        <t-button theme="primary" :loading="saving" @click="submitVenue">保存</t-button>
      </template>
    </t-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, watch } from 'vue';
import { useUserStore } from '../store/user';
import http from '../api/http';
import { message, confirm } from '../utils/ui';
import { bandLabel, bandSub } from '../utils/band';

const store = useUserStore();

const isMobile = ref(window.innerWidth <= 768);
function onResize() {
  isMobile.value = window.innerWidth <= 768;
}
onMounted(() => window.addEventListener('resize', onResize));
onUnmounted(() => window.removeEventListener('resize', onResize));

const STAGE_LIST = [
  { value: 1, label: '小学' },
  { value: 2, label: '初中' },
  { value: 3, label: '高中' }
];

const PAIRING_LIST = [
  { value: 1, label: '首尾配对' },
  { value: 2, label: '交叉配对' },
  { value: 3, label: '对位配对' }
];

const itemColumns = [
  { colKey: 'name', title: '项目名称', minWidth: 130 },
  { colKey: 'category', title: '类别', width: 90, align: 'center' },
  { colKey: 'is_relay', title: '接力', width: 60, align: 'center' },
  { colKey: 'team_params', title: '球类参数', minWidth: 280 },
  { colKey: 'track_params', title: '径赛参数', minWidth: 150 },
  { colKey: 'ops', title: '操作', width: 140, align: 'center', fixed: 'right' }
];

const bandColumns = [
  { colKey: 'band_name', title: '组别名称', minWidth: 150 },
  { colKey: 'stage', title: '学段', width: 90, align: 'center' },
  { colKey: 'gender', title: '性别', width: 80, align: 'center' },
  { colKey: 'sub', title: '分组', width: 80, align: 'center' },
  { colKey: 'sort_no', title: '排序', width: 80, align: 'center' },
  { colKey: 'team_count', title: '队伍数', width: 90, align: 'center' },
  { colKey: 'athlete_count', title: '人数', width: 90, align: 'center' },
  { colKey: 'ops', title: '操作', width: 140, align: 'center', fixed: 'right' }
];

const venueColumns = [
  { colKey: 'venue_no', title: '场地编号', width: 100, align: 'center' },
  { colKey: 'name', title: '场地名称', minWidth: 160 },
  { colKey: 'host_school_name', title: '所属学校', minWidth: 160 },
  { colKey: 'ops', title: '操作', width: 140, align: 'center', fixed: 'right' }
];

const activeTab = ref('items');

const items = ref([]);
const bands = ref([]);
const venues = ref([]);
const schools = ref([]);
const loadingItems = ref(false);
const loadingBands = ref(false);
const loadingVenues = ref(false);
const saving = ref(false);

const itemDialog = ref(false);
const bandDialog = ref(false);
const venueDialog = ref(false);

const itemForm = reactive({
  id: null,
  name: '',
  category: 3,
  is_relay: 0,
  match_minutes: 24,
  slot_interval: 45,
  group_count: 0,
  rounds_per_group: 0,
  advance_count: 4,
  pairing_rule: 1,
  has_third_place: 1,
      lane_count: 8,
  prelim_max: 16,
  // 田径参数
  event_type: 'TRACK',
  result_entry_type: 'TIME',
  event_unit: 's',
  is_higher_better: 0,
  result_min_value: null,
  result_max_value: null,
  result_decimal_places: 2,
  has_preliminary: 0,
  admission_count: null,
  base_attempt_count: 3,
  extra_attempt_count: 3,
  extra_qualifier_count: null,
  team_score_multiplier: 1,
  estimated_unit_minutes: null
});

const bandForm = reactive({
  id: null, stage: 1, gender: 1, label: '', sort_no: 0,
  team_max_total_count: null, team_max_male_count: null, team_max_female_count: null,
  athlete_max_event_count: null,
  birth_date_limit_flag: 0, birth_date_start: '', birth_date_end: ''
});

const venueForm = reactive({ id: null, name: '', venue_no: 1, host_school_id: null });

function categoryLabel(v) {
  return { 1: '径赛', 2: '田赛', 3: '球类' }[v] || '其他';
}

function categoryType(v) {
  return { 1: 'warning', 2: 'success', 3: 'primary' }[v] || 'default';
}

function pairingLabel(v) {
  return PAIRING_LIST.find((p) => p.value === v)?.label || '首尾配对';
}

function stageLabel(v) {
  return STAGE_LIST.find((s) => s.value === v)?.label || '未知';
}

function genderLabel(v) {
  return { 1: '男子', 2: '女子' }[v] || '未知';
}

function subLabel(row) {
  const s = bandSub(row);
  return s || '—';
}

async function loadItems() {
  if (!store.competitionId) return;
  loadingItems.value = true;
  try {
    items.value = await http.get('/event/items', { params: { competition_id: store.competitionId } });
  } catch (e) {
    message.error(e.message);
  } finally {
    loadingItems.value = false;
  }
}

async function loadBands() {
  if (!store.competitionId) return;
  loadingBands.value = true;
  try {
    bands.value = await http.get('/event/bands', { params: { competition_id: store.competitionId } });
  } catch (e) {
    message.error(e.message);
  } finally {
    loadingBands.value = false;
  }
}

async function loadVenues() {
  if (!store.competitionId) return;
  loadingVenues.value = true;
  try {
    venues.value = await http.get('/event/venues', { params: { competition_id: store.competitionId } });
  } catch (e) {
    message.error(e.message);
  } finally {
    loadingVenues.value = false;
  }
}

async function loadSchools() {
  try {
    schools.value = await http.get('/school/list');
  } catch (e) {
    schools.value = [];
  }
}

async function loadAll() {
  await Promise.all([loadItems(), loadBands(), loadVenues()]);
}

function openItemCreate() {
  itemForm.id = null;
  itemForm.name = '';
  itemForm.category = 3;
  itemForm.is_relay = 0;
  itemForm.match_minutes = 24;
  itemForm.slot_interval = 45;
  itemForm.group_count = 0;
  itemForm.rounds_per_group = 0;
  itemForm.advance_count = 4;
  itemForm.pairing_rule = 1;
  itemForm.has_third_place = 1;
  itemForm.lane_count = 8;
  itemForm.prelim_max = 16;
  resetTrackFields();
  itemDialog.value = true;
}

const ENTRY_TYPE_LIST = [
  { value: 'TIME', label: '时间（秒）' },
  { value: 'DISTANCE', label: '远度（米）' },
  { value: 'HEIGHT', label: '高度（米）' },
  { value: 'POINT', label: '分值' }
];

function entryTypeLabel(v) {
  return { TIME: '时间', DISTANCE: '远度', HEIGHT: '高度', POINT: '分值', SCORE: '比分' }[v] || '';
}

function resetTrackFields() {
  itemForm.event_type = itemForm.category === 2 ? 'FIELD' : 'TRACK';
  itemForm.result_entry_type = itemForm.category === 2 ? 'DISTANCE' : 'TIME';
  itemForm.event_unit = itemForm.category === 2 ? 'm' : 's';
  itemForm.is_higher_better = itemForm.category === 2 ? 1 : 0;
  itemForm.result_min_value = null;
  itemForm.result_max_value = null;
  itemForm.result_decimal_places = 2;
  itemForm.has_preliminary = 0;
  itemForm.admission_count = null;
  itemForm.base_attempt_count = 3;
  itemForm.extra_attempt_count = 3;
  itemForm.extra_qualifier_count = null;
  itemForm.team_score_multiplier = 1;
  itemForm.estimated_unit_minutes = null;
}

function onEntryTypeChange(v) {
  if (v === 'DISTANCE' || v === 'HEIGHT') {
    itemForm.event_unit = 'm';
    itemForm.is_higher_better = 1;
  } else if (v === 'TIME') {
    itemForm.event_unit = 's';
    itemForm.is_higher_better = 0;
  }
}

/* ---------- 从模板库批量添加 ---------- */
const tplDialog = ref(false);
const tplLoading = ref(false);
const tplList = ref([]);
const tplSelected = ref([]);
const tplKeyword = ref('');

const tplColumns = [
  { colKey: 'template_name', title: '项目名称', minWidth: 140 },
  { colKey: 'event_type', title: '类型', width: 90, align: 'center' },
  { colKey: 'result_entry_type', title: '成绩形式', width: 110, align: 'center' },
  { colKey: 'event_unit', title: '单位', width: 70, align: 'center' }
];

async function openTemplatePicker() {
  if (!store.competitionId) {
    message.warning('请先选择赛事');
    return;
  }
  tplSelected.value = [];
  tplDialog.value = true;
  await loadTplList();
}

async function loadTplList() {
  tplLoading.value = true;
  try {
    const params = {};
    if (tplKeyword.value) params.keyword = tplKeyword.value;
    tplList.value = await http.get('/track/templates', { params });
  } catch (e) {
    message.error(e.message);
  } finally {
    tplLoading.value = false;
  }
}

async function submitTemplates() {
  if (!tplSelected.value.length) {
    message.warning('请先勾选要添加的项目');
    return;
  }
  saving.value = true;
  try {
    const r = await http.post('/track/events/from-template', {
      competition_id: store.competitionId,
      template_ids: tplSelected.value
    });
    message.success(r?.message || '已添加');
    tplDialog.value = false;
    loadItems();
  } catch (e) {
    message.error(e.message);
  } finally {
    saving.value = false;
  }
}

function openItemEdit(row) {
  itemForm.id = row.id;
  itemForm.name = row.name;
  itemForm.category = row.category;
  itemForm.is_relay = row.is_relay ?? 0;
  itemForm.match_minutes = row.match_minutes ?? 24;
  itemForm.slot_interval = row.slot_interval ?? 45;
  itemForm.group_count = row.group_count ?? 0;
  itemForm.rounds_per_group = row.rounds_per_group ?? 0;
  itemForm.advance_count = row.advance_count ?? 4;
  itemForm.pairing_rule = row.pairing_rule ?? 1;
  itemForm.has_third_place = row.has_third_place ?? 1;
  itemForm.lane_count = row.lane_count ?? 8;
  itemForm.prelim_max = row.prelim_max ?? 16;
  // 田径参数
  itemForm.event_type = row.event_type || (row.category === 2 ? 'FIELD' : 'TRACK');
  itemForm.result_entry_type = row.result_entry_type || (row.category === 2 ? 'DISTANCE' : 'TIME');
  itemForm.event_unit = row.event_unit || (row.category === 2 ? 'm' : 's');
  itemForm.is_higher_better = row.is_higher_better ?? (row.category === 2 ? 1 : 0);
  itemForm.result_min_value = row.result_min_value ?? null;
  itemForm.result_max_value = row.result_max_value ?? null;
  itemForm.result_decimal_places = row.result_decimal_places ?? 2;
  itemForm.has_preliminary = row.has_preliminary ?? 0;
  itemForm.admission_count = row.admission_count ?? null;
  itemForm.base_attempt_count = row.base_attempt_count ?? 3;
  itemForm.extra_attempt_count = row.extra_attempt_count ?? 3;
  itemForm.extra_qualifier_count = row.extra_qualifier_count ?? null;
  itemForm.team_score_multiplier = row.team_score_multiplier ?? 1;
  itemForm.estimated_unit_minutes = row.estimated_unit_minutes ?? null;
  itemDialog.value = true;
}

async function submitItem() {
  if (!itemForm.name || !itemForm.name.trim()) {
    message.warning('请填写项目名称');
    return;
  }
  saving.value = true;
  try {
    const payload = {
      competition_id: store.competitionId,
      name: itemForm.name.trim(),
      category: itemForm.category,
      is_relay: itemForm.is_relay,
      match_minutes: itemForm.match_minutes,
      slot_interval: itemForm.slot_interval,
      group_count: itemForm.group_count,
      rounds_per_group: itemForm.rounds_per_group,
      advance_count: itemForm.advance_count,
      pairing_rule: itemForm.pairing_rule,
      has_third_place: itemForm.has_third_place,
      lane_count: itemForm.lane_count,
      prelim_max: itemForm.prelim_max
    };
    // 径赛/田赛追加田径参数
    if (itemForm.category !== 3) {
      Object.assign(payload, {
        event_type: itemForm.event_type,
        result_entry_type: itemForm.result_entry_type,
        event_unit: itemForm.event_unit,
        is_higher_better: itemForm.is_higher_better,
        result_min_value: itemForm.result_min_value,
        result_max_value: itemForm.result_max_value,
        result_decimal_places: itemForm.result_decimal_places,
        has_preliminary: itemForm.has_preliminary,
        admission_count: itemForm.admission_count,
        base_attempt_count: itemForm.base_attempt_count,
        extra_attempt_count: itemForm.extra_attempt_count,
        extra_qualifier_count: itemForm.extra_qualifier_count,
        team_score_multiplier: itemForm.team_score_multiplier,
        estimated_unit_minutes: itemForm.estimated_unit_minutes
      });
    }
    if (itemForm.id) {
      await http.put(`/event/items/${itemForm.id}`, payload);
      message.success('已保存');
    } else {
      await http.post('/event/items', payload);
      message.success('项目已添加');
    }
    itemDialog.value = false;
    loadItems();
  } catch (e) {
    message.error(e.message);
  } finally {
    saving.value = false;
  }
}

function onTplSelect(keys) {
  tplSelected.value = keys;
}

async function removeItem(row) {
  let okDelete = false;
  await confirm(`确定删除项目「${row.name}」？`, '删除确认', { confirmBtn: '确定删除', cancelBtn: '取消' })
    .then(() => { okDelete = true; })
    .catch(() => {});
  if (!okDelete) return;

  try {
    await http.delete(`/event/items/${row.id}`);
    message.success('已删除');
    loadItems();
  } catch (e) {
    message.error(e.message);
  }
}

function openBandCreate() {
  bandForm.id = null;
  bandForm.stage = 1;
  bandForm.gender = 1;
  bandForm.label = '';
  bandForm.sort_no = bands.value.length + 1;
  bandForm.team_max_total_count = null;
  bandForm.team_max_male_count = null;
  bandForm.team_max_female_count = null;
  bandForm.athlete_max_event_count = null;
  bandForm.birth_date_limit_flag = 0;
  bandForm.birth_date_start = '';
  bandForm.birth_date_end = '';
  bandDialog.value = true;
}

function openBandEdit(row) {
  bandForm.id = row.id;
  bandForm.stage = row.stage;
  bandForm.gender = row.gender;
  bandForm.label = row.label || '';
  bandForm.sort_no = row.sort_no ?? 0;
  bandForm.team_max_total_count = row.team_max_total_count ?? null;
  bandForm.team_max_male_count = row.team_max_male_count ?? null;
  bandForm.team_max_female_count = row.team_max_female_count ?? null;
  bandForm.athlete_max_event_count = row.athlete_max_event_count ?? null;
  bandForm.birth_date_limit_flag = row.birth_date_limit_flag ?? 0;
  bandForm.birth_date_start = row.birth_date_start || '';
  bandForm.birth_date_end = row.birth_date_end || '';
  bandDialog.value = true;
}

async function submitBand() {
  saving.value = true;
  try {
    const payload = {
      competition_id: store.competitionId,
      stage: bandForm.stage,
      gender: bandForm.gender,
      label: bandForm.label,
      sort_no: bandForm.sort_no
    };
    if (bandForm.id) {
      await http.put(`/event/bands/${bandForm.id}`, payload);
      // 限报配置走独立接口
      await http.put(`/track/band/${bandForm.id}/limits`, {
        team_max_total_count: bandForm.team_max_total_count,
        team_max_male_count: bandForm.team_max_male_count,
        team_max_female_count: bandForm.team_max_female_count,
        athlete_max_event_count: bandForm.athlete_max_event_count,
        birth_date_limit_flag: bandForm.birth_date_limit_flag,
        birth_date_start: bandForm.birth_date_start || null,
        birth_date_end: bandForm.birth_date_end || null
      });
      message.success('已保存');
    } else {
      const r = await http.post('/event/bands', payload);
      if (r?.id && (bandForm.team_max_total_count || bandForm.athlete_max_event_count || bandForm.birth_date_limit_flag)) {
        await http.put(`/track/band/${r.id}/limits`, {
          team_max_total_count: bandForm.team_max_total_count,
          team_max_male_count: bandForm.team_max_male_count,
          team_max_female_count: bandForm.team_max_female_count,
          athlete_max_event_count: bandForm.athlete_max_event_count,
          birth_date_limit_flag: bandForm.birth_date_limit_flag,
          birth_date_start: bandForm.birth_date_start || null,
          birth_date_end: bandForm.birth_date_end || null
        });
      }
      message.success('组别已添加');
    }
    bandDialog.value = false;
    loadBands();
  } catch (e) {
    message.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function removeBand(row) {
  let okDelete = false;
  await confirm(
    `确定删除组别「${genderLabel(row.gender)}${stageLabel(row.stage)}${row.label || ''}」？`,
    '删除确认',
    { confirmBtn: '确定删除', cancelBtn: '取消' }
  )
    .then(() => { okDelete = true; })
    .catch(() => {});
  if (!okDelete) return;

  try {
    await http.delete(`/event/bands/${row.id}`);
    message.success('已删除');
    loadBands();
  } catch (e) {
    message.error(e.message);
  }
}

function openVenueCreate() {
  venueForm.id = null;
  venueForm.name = '';
  venueForm.venue_no = venues.value.length + 1;
  venueForm.host_school_id = null;
  venueDialog.value = true;
}

function openVenueEdit(row) {
  venueForm.id = row.id;
  venueForm.name = row.name;
  venueForm.venue_no = row.venue_no;
  venueForm.host_school_id = row.host_school_id ?? null;
  venueDialog.value = true;
}

async function submitVenue() {
  if (!venueForm.name || !venueForm.name.trim()) {
    message.warning('请填写场地名称');
    return;
  }
  saving.value = true;
  try {
    const payload = {
      competition_id: store.competitionId,
      name: venueForm.name.trim(),
      venue_no: venueForm.venue_no,
      host_school_id: venueForm.host_school_id || null
    };
    if (venueForm.id) {
      await http.put(`/event/venues/${venueForm.id}`, payload);
      message.success('已保存');
    } else {
      await http.post('/event/venues', payload);
      message.success('场地已添加');
    }
    venueDialog.value = false;
    loadVenues();
  } catch (e) {
    message.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function removeVenue(row) {
  let okDelete = false;
  await confirm(`确定删除场地「${row.name}」？`, '删除确认', { confirmBtn: '确定删除', cancelBtn: '取消' })
    .then(() => { okDelete = true; })
    .catch(() => {});
  if (!okDelete) return;

  try {
    await http.delete(`/event/venues/${row.id}`);
    message.success('已删除');
    loadVenues();
  } catch (e) {
    message.error(e.message);
  }
}

onMounted(() => {
  loadAll();
  loadSchools();
});
watch(() => store.competitionId, loadAll);
</script>

<style scoped>
.setup-card {
  border-radius: 8px;
}

.setup-tabs :deep(.t-tabs__header) {
  margin-bottom: 12px;
}

.tb-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.band-name {
  font-weight: 500;
  color: var(--app-text-1);
}

.band-preview {
  display: inline-block;
  padding: 2px 10px;
  background: var(--td-brand-color-light);
  border-radius: 4px;
  font-size: 13px;
  color: var(--td-brand-color);
  font-weight: 500;
}

.tb-hint {
  font-size: 12px;
  color: var(--app-text-3);
}

.dim {
  font-size: 13px;
  color: var(--app-text-2);
}

.venue-no {
  display: inline-block;
  min-width: 24px;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--app-bg);
  color: var(--td-brand-color);
  font-size: 12px;
  font-weight: 500;
}

.param-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-size: 12px;
  color: var(--app-text-2);
}

.unit {
  font-size: 12px;
  color: var(--app-text-3);
  margin-left: 6px;
}

.table-scroll {
  overflow-x: auto;
}

@media (max-width: 768px) {
  .tb-hint {
    display: none;
  }
  .setup-tabs :deep(.t-tabs__nav-item) {
    font-size: 13px;
    padding: 0 10px;
  }
}
</style>
