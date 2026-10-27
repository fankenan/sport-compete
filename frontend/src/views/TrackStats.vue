<template>
  <div class="page">
    <div class="page-head">
      <h2>赛后统计</h2>
      <div class="head-right">
        <t-select v-model="compId" :options="compOptions" placeholder="选择赛事" clearable
                  style="width: 220px" @change="onCompChange" />
      </div>
    </div>

    <t-tabs v-model="tab">
      <!-- ============ 团体总分 ============ -->
      <t-tab-panel value="team" label="团体总分">
        <div class="bar">
          <t-select v-model="ruleId" :options="ruleOptions" placeholder="选择计分方案"
                    style="width: 220px" @change="loadTeamScore" />
          <t-button theme="primary" @click="openRuleDialog()">新建方案</t-button>
          <t-button v-if="ruleId" variant="outline" @click="openRuleDialog(currentRule)">编辑方案</t-button>
          <t-button v-if="ruleId" variant="outline" @click="calcTeamScore">重新计算</t-button>
          <t-button v-if="ruleId" variant="outline" @click="exportTeamScore">导出 CSV</t-button>
          <t-button v-if="ruleId && currentRule?.scope_mode === 'VIRTUAL'" variant="outline"
                    @click="vgDialog = true">虚拟组设置</t-button>
          <t-button v-if="ruleId" theme="danger" variant="outline" @click="delRule">删除方案</t-button>
        </div>

        <t-alert v-if="!ruleId" theme="info" message="先在上方新建或选择一个计分方案" style="margin-bottom:12px" />

        <t-table v-if="ruleId" :data="teamRows" :columns="teamCols" row-key="id"
                 hover :loading="loading" bordered />
      </t-tab-panel>

      <!-- ============ 达级认定 ============ -->
      <t-tab-panel value="grade" label="达级认定">
        <div class="bar">
          <t-button theme="primary" @click="recognizeGrades">批量认定达级</t-button>
          <t-button variant="outline" @click="openStandardDialog()">新建等级标准</t-button>
          <t-button variant="outline" @click="openBonusDialog">达级加分规则</t-button>
          <t-button variant="outline" @click="loadGrade">刷新</t-button>
          <span class="hint">达级需要先在项目上绑定「等级标准」（田径中心 → 项目编辑 → 等级标准）</span>
        </div>

        <t-row :gutter="16" style="margin-bottom:12px">
          <t-col :span="6">
            <t-card title="按等级汇总" size="small">
              <t-table :data="gradeSummary.byGrade || []" :columns="gradeSumCols" row-key="grade_code" bordered />
            </t-card>
          </t-col>
          <t-col :span="6">
            <t-card title="按单位汇总" size="small">
              <t-table :data="gradeSummary.bySchool || []" :columns="schoolSumCols" row-key="school_id" bordered />
            </t-card>
          </t-col>
        </t-row>

        <t-table :data="achievements" :columns="achieveCols" row-key="id" hover
                 :loading="loading" bordered>
          <template #op="{ row }">
            <t-link theme="danger" @click="revokeAchieve(row.id)">撤销</t-link>
          </template>
        </t-table>
      </t-tab-panel>

      <!-- ============ 破纪录 ============ -->
      <t-tab-panel value="record" label="破纪录">
        <div class="bar">
          <t-button theme="primary" @click="detectRecords">自动检测破纪录</t-button>
          <t-button variant="outline" @click="openRecordDialog()">登记纪录</t-button>
          <t-button variant="outline" @click="openRecordBonusDialog">破纪录加分规则</t-button>
          <t-button variant="outline" @click="loadRecords">刷新</t-button>
          <span class="hint">先登记赛会纪录 / 最高纪录，录完成绩后点自动检测</span>
        </div>

        <t-card title="纪录台账" size="small" style="margin-bottom:12px">
          <t-table :data="records" :columns="recordCols" row-key="id" bordered>
            <template #op="{ row }">
              <t-link theme="primary" @click="openRecordDialog(row)">编辑</t-link>
              <t-link theme="danger" @click="delRecord(row.id)" style="margin-left:8px">删除</t-link>
            </template>
          </t-table>
        </t-card>

        <t-card title="破纪录名单" size="small">
          <t-table :data="breaks" :columns="breakCols" row-key="id" bordered>
            <template #op="{ row }">
              <t-link theme="danger" @click="revokeBreak(row.id)">撤销</t-link>
            </template>
          </t-table>
        </t-card>
      </t-tab-panel>

      <!-- ============ 综合查询 ============ -->
      <t-tab-panel value="query" label="综合查询">
        <div class="stat-grid">
          <div class="stat-card"><div class="sn">{{ summary.school_count || 0 }}</div><div class="sl">参赛单位</div></div>
          <div class="stat-card"><div class="sn">{{ summary.athlete_count || 0 }}</div><div class="sl">参赛人数</div></div>
          <div class="stat-card"><div class="sn">{{ summary.entry_count || 0 }}</div><div class="sl">成绩条数</div></div>
          <div class="stat-card"><div class="sn">{{ summary.confirmed_heat_count || 0 }}/{{ summary.heat_count || 0 }}</div><div class="sl">已确认赛次</div></div>
          <div class="stat-card"><div class="sn">{{ summary.grade_count || 0 }}</div><div class="sl">达级人次</div></div>
          <div class="stat-card"><div class="sn">{{ summary.record_break_count || 0 }}</div><div class="sl">破纪录</div></div>
        </div>

        <t-tabs v-model="qtab" size="small">
          <t-tab-panel value="athlete" label="按运动员">
            <div class="bar">
              <t-input v-model="q.keyword" placeholder="姓名关键字" clearable style="width:180px" @enter="loadQuery" />
              <t-select v-model="q.school_id" :options="schoolOptions" placeholder="单位" clearable style="width:180px" />
              <t-select v-model="q.band_id" :options="bandOptions" placeholder="组别" clearable style="width:160px" />
              <t-button theme="primary" @click="loadQuery">查询</t-button>
              <t-button variant="outline" @click="exportAthletes">导出 CSV</t-button>
            </div>
            <t-table :data="athleteRows" :columns="athleteCols" row-key="athlete_id" hover bordered>
              <template #op="{ row }">
                <t-link theme="primary" @click="viewAthlete(row)">查看成绩</t-link>
              </template>
            </t-table>
          </t-tab-panel>

          <t-tab-panel value="school" label="按单位">
            <div class="bar">
              <t-select v-model="q.band_id" :options="bandOptions" placeholder="组别" clearable style="width:160px" />
              <t-button theme="primary" @click="loadQuery">查询</t-button>
            </div>
            <t-table :data="schoolRows" :columns="schoolQueryCols" row-key="school_id" bordered />
          </t-tab-panel>

          <t-tab-panel value="event" label="按项目">
            <div class="bar">
              <t-select v-model="q.band_id" :options="bandOptions" placeholder="组别" clearable style="width:160px" />
              <t-button theme="primary" @click="loadQuery">查询</t-button>
            </div>
            <t-table :data="eventRows" :columns="eventQueryCols" row-key="event_item_id" bordered />
          </t-tab-panel>
        </t-tabs>
      </t-tab-panel>

      <!-- ============ 公开页 ============ -->
      <t-tab-panel value="public" label="公开页">
        <t-card title="公开成绩查询页" size="small">
          <t-form :data="pubForm" label-width="110px">
            <t-form-item label="开放公开查询">
              <t-switch v-model="pubForm.public_flag" :custom-value="[1, 0]" />
              <span class="hint" style="margin-left:8px">关闭后分享链接不可访问</span>
            </t-form-item>
            <t-form-item label="分享码">
              <t-input :value="pubForm.uuid || '（保存后自动生成）'" readonly style="width:280px">
                <template #suffix>
                  <t-link theme="primary" @click="copyLink">复制链接</t-link>
                </template>
              </t-input>
              <t-button variant="outline" style="margin-left:8px" @click="resetUuid">重新生成</t-button>
            </t-form-item>
            <t-form-item label="页面说明">
              <t-input v-model="pubForm.public_note" placeholder="显示在公开页顶部的说明文字" style="width:420px" />
            </t-form-item>
            <t-form-item>
              <t-button theme="primary" @click="savePublic">保存</t-button>
              <t-button variant="outline" style="margin-left:8px" @click="openPublic">打开公开页</t-button>
            </t-form-item>
          </t-form>
        </t-card>
      </t-tab-panel>
    </t-tabs>

    <!-- 方案弹窗 -->
    <t-dialog v-model:visible="ruleDialog" :header="ruleForm.id ? '编辑计分方案' : '新建计分方案'"
              :width="720" :on-confirm="saveRule" :confirm-btn="{ loading }" attach="body">
      <t-form :data="ruleForm" label-width="120px">
        <t-form-item label="方案名称">
          <t-input v-model="ruleForm.scheme_name" placeholder="如 初中组团体总分" />
        </t-form-item>
        <t-form-item label="统计口径">
          <t-radio-group v-model="ruleForm.scope_mode">
            <t-radio value="BAND">按组别分别排名</t-radio>
            <t-radio value="MERGE">合并组别排名</t-radio>
            <t-radio value="VIRTUAL">虚拟组排名</t-radio>
          </t-radio-group>
        </t-form-item>
        <t-form-item label="参与组别">
          <t-checkbox-group v-model="ruleForm.band_ids">
            <t-checkbox v-for="b in bandList" :key="b.id" :value="b.id">{{ b.label || ('组别' + b.id) }}</t-checkbox>
          </t-checkbox-group>
        </t-form-item>
        <t-form-item label="计分来源">
          <t-radio-group v-model="ruleForm.score_source">
            <t-radio value="RANK">按名次计分</t-radio>
            <t-radio value="SCORE_RULE">按项目评分规则</t-radio>
          </t-radio-group>
        </t-form-item>
        <t-form-item v-if="ruleForm.score_source === 'RANK'" label="名次得分">
          <div class="score-table">
            <div v-for="n in 8" :key="n" class="st-cell">
              <span class="st-l">第{{ n }}名</span>
              <t-input-number v-model="ruleForm.score_table[n]" :min="0" :step="1" size="small" style="width:90px" />
            </div>
          </div>
        </t-form-item>
        <t-form-item label="录取名次">
          <t-input-number v-model="ruleForm.rank_limit" :min="0" placeholder="0 或留空=全部" style="width:150px" />
          <span class="hint" style="margin-left:8px">超过该名次不计分</span>
        </t-form-item>
        <t-form-item label="接力倍数">
          <t-input-number v-model="ruleForm.relay_multiplier" :min="1" :step="0.5" style="width:120px" />
        </t-form-item>
        <t-form-item label="计入加分">
          <t-checkbox v-model="ruleForm.include_grade_bonus" :true-value="1" :false-value="0">达级加分</t-checkbox>
          <t-checkbox v-model="ruleForm.include_record_bonus" :true-value="1" :false-value="0" style="margin-left:12px">破纪录加分</t-checkbox>
        </t-form-item>
        <t-form-item label="同分决胜">
          <t-radio-group v-model="ruleForm.tie_break_mode">
            <t-radio value="FIRST">先比第一名个数</t-radio>
            <t-radio value="NONE">不比（并列）</t-radio>
          </t-radio-group>
        </t-form-item>
      </t-form>
    </t-dialog>

    <!-- 虚拟组弹窗 -->
    <t-dialog v-model:visible="vgDialog" header="虚拟组设置" :width="700" :on-confirm="saveVg" attach="body">
      <t-alert theme="info" message="虚拟组把若干学校并成一个队参与排名，例如「市区联队」" style="margin-bottom:12px" />
      <div v-for="(g, i) in vgList" :key="i" class="vg-row">
        <t-input v-model="g.group_name" placeholder="虚拟组名称" style="width:180px" />
        <t-select v-model="g.school_ids" :options="schoolOptions" multiple placeholder="选择并入的学校"
                  style="flex:1;margin:0 8px" />
        <t-button theme="danger" variant="outline" @click="vgList.splice(i, 1)">删除</t-button>
      </div>
      <t-button variant="dashed" block @click="vgList.push({ group_name: '', school_ids: [] })">+ 添加虚拟组</t-button>
    </t-dialog>

    <!-- 基础分调整弹窗 -->
    <t-dialog v-model:visible="adjDialog" header="基础分调整" :width="480" :on-confirm="saveAdjust" attach="body">
      <t-form label-width="90px">
        <t-form-item label="单位">{{ adjRow.unit_name }}</t-form-item>
        <t-form-item label="项目得分">{{ adjRow.total_score }}</t-form-item>
        <t-form-item label="调整分">
          <t-input-number v-model="adjRow.adjust_score" :step="1" style="width:160px" />
          <span class="hint" style="margin-left:8px">可正可负</span>
        </t-form-item>
        <t-form-item label="调整原因">
          <t-input v-model="adjRow.adjust_reason" placeholder="如 违规扣分 / 奖励加分" />
        </t-form-item>
      </t-form>
    </t-dialog>

    <!-- 等级标准弹窗 -->
    <t-dialog v-model:visible="stdDialog" :header="stdForm.id ? '编辑等级标准' : '新建等级标准'"
              :width="760" :on-confirm="saveStandard" attach="body">
      <t-form :data="stdForm" label-width="110px">
        <t-form-item label="项目名称"><t-input v-model="stdForm.event_name" placeholder="如 男子100米" /></t-form-item>
        <t-form-item label="规格说明"><t-input v-model="stdForm.specification" placeholder="如 100米 / 铅球(5kg)" /></t-form-item>
        <t-form-item label="性别">
          <t-radio-group v-model="stdForm.gender">
            <t-radio value="A">不限</t-radio><t-radio value="M">男</t-radio><t-radio value="F">女</t-radio>
          </t-radio-group>
        </t-form-item>
        <t-form-item label="成绩方向">
          <t-radio-group v-model="stdForm.result_direction">
            <t-radio value="LOWER">越小越好（径赛）</t-radio>
            <t-radio value="HIGHER">越大越好（田赛）</t-radio>
          </t-radio-group>
        </t-form-item>
        <t-form-item label="达标阈值">
          <t-table :data="stdRows" :columns="stdCols" row-key="grade_code" bordered />
        </t-form-item>
      </t-form>
    </t-dialog>

    <!-- 达级加分弹窗 -->
    <t-dialog v-model:visible="bonusDialog" header="达级加分规则" :width="560" :on-confirm="saveBonus" attach="body">
      <t-alert theme="info" message="留空则使用等级标准里自带的加分值；填写后以本表为准" style="margin-bottom:12px" />
      <div v-for="b in bonusList" :key="b.grade_code" class="vg-row">
        <span class="bl">{{ b.grade_name }}</span>
        <t-input-number v-model="b.bonus_value" :step="1" style="width:140px" />
      </div>
    </t-dialog>

    <!-- 纪录弹窗 -->
    <t-dialog v-model:visible="recDialog" :header="recForm.id ? '编辑纪录' : '登记纪录'" :width="720"
              :on-confirm="saveRecord" attach="body">
      <t-form :data="recForm" label-width="110px">
        <t-form-item label="项目">
          <t-select v-model="recForm.event_item_id" :options="eventOptions" placeholder="选择项目" style="width:240px" />
        </t-form-item>
        <t-form-item label="组别">
          <t-select v-model="recForm.band_id" :options="bandOptions" placeholder="不选=赛事级" clearable style="width:200px" />
        </t-form-item>
        <t-divider>赛会纪录</t-divider>
        <t-form-item label="成绩"><t-input v-model="recForm.meet_record_value" placeholder="如 11.23 或 1:05.43" style="width:180px" /></t-form-item>
        <t-form-item label="保持者"><t-input v-model="recForm.meet_record_holder" style="width:180px" /></t-form-item>
        <t-form-item label="创造赛事"><t-input v-model="recForm.meet_record_meet_name" style="width:240px" /></t-form-item>
        <t-form-item label="创造日期"><t-date-picker v-model="recForm.meet_record_date" value-type="YYYY-MM-DD" style="width:180px" /></t-form-item>
        <t-divider>最高纪录</t-divider>
        <t-form-item label="成绩"><t-input v-model="recForm.highest_record_value" placeholder="可留空" style="width:180px" /></t-form-item>
        <t-form-item label="保持者"><t-input v-model="recForm.highest_record_holder" style="width:180px" /></t-form-item>
        <t-form-item label="创造赛事"><t-input v-model="recForm.highest_record_meet_name" style="width:240px" /></t-form-item>
        <t-form-item label="创造日期"><t-date-picker v-model="recForm.highest_record_date" value-type="YYYY-MM-DD" style="width:180px" /></t-form-item>
      </t-form>
    </t-dialog>

    <!-- 破纪录加分弹窗 -->
    <t-dialog v-model:visible="recBonusDialog" header="破纪录加分规则" :width="520" :on-confirm="saveRecordBonus" attach="body">
      <div v-for="b in recBonusList" :key="b.record_type" class="vg-row">
        <span class="bl">{{ b.label }}</span>
        <t-input-number v-model="b.bonus_value" :step="1" style="width:140px" />
      </div>
    </t-dialog>

    <!-- 单人成绩弹窗 -->
    <t-dialog v-model:visible="detailDialog" :header="'成绩明细 · ' + detailName" :width="720" :footer="false" attach="body">
      <t-table :data="detailRows" :columns="detailCols" row-key="id" bordered />
    </t-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { MessagePlugin, DialogPlugin } from 'tdesign-vue-next';
import http from '../api/http';
import { useUserStore } from '../store/user';

const store = useUserStore();
const tab = ref('team');
const qtab = ref('athlete');
const loading = ref(false);

const compId = ref(store.competitionId);
const compOptions = ref([]);
const bandList = ref([]);
const schoolOptions = ref([]);
const eventOptions = ref([]);
const bandOptions = computed(() => bandList.value.map((b) => ({ label: b.label || ('组别' + b.id), value: b.id })));

// ---------- 团体总分 ----------
const ruleId = ref(null);
const rules = ref([]);
const teamRows = ref([]);
const ruleOptions = computed(() => rules.value.map((r) => ({ label: r.scheme_name, value: r.id })));
const currentRule = computed(() => rules.value.find((r) => r.id === ruleId.value) || null);

const teamCols = [
  { colKey: 'rank_no', title: '名次', width: 70, align: 'center' },
  { colKey: 'unit_name', title: '参赛单位', minWidth: 160 },
  { colKey: 'total_score', title: '项目得分', width: 100, align: 'right' },
  { colKey: 'grade_bonus', title: '达级加分', width: 100, align: 'right' },
  { colKey: 'record_bonus', title: '破纪录加分', width: 110, align: 'right' },
  { colKey: 'adjust_score', title: '基础分调整', width: 110, align: 'right' },
  { colKey: 'final_score', title: '总分', width: 100, align: 'right' },
  { colKey: 'first_count', title: '第一名', width: 80, align: 'center' },
  { colKey: 'second_count', title: '第二名', width: 80, align: 'center' },
  { colKey: 'third_count', title: '第三名', width: 80, align: 'center' },
  { colKey: 'op', title: '操作', width: 90, align: 'center' }
];
// 操作列用插槽，补一个 cell 渲染
teamCols[teamCols.length - 1].cell = 'op';

const ruleDialog = ref(false);
const ruleForm = reactive({
  id: null, scheme_name: '', scope_mode: 'BAND', band_ids: [], score_source: 'RANK',
  score_table: { 1: 9, 2: 7, 3: 6, 4: 5, 5: 4, 6: 3, 7: 2, 8: 1 },
  rank_limit: 8, relay_multiplier: 2, include_grade_bonus: 0, include_record_bonus: 0,
  tie_break_mode: 'FIRST'
});
const DEFAULT_TABLE = { 1: 9, 2: 7, 3: 6, 4: 5, 5: 4, 6: 3, 7: 2, 8: 1 };

const vgDialog = ref(false);
const vgList = ref([]);

const adjDialog = ref(false);
const adjRow = reactive({ id: null, unit_name: '', total_score: 0, adjust_score: 0, adjust_reason: '' });

// ---------- 达级 ----------
const achievements = ref([]);
const gradeSummary = ref({ byGrade: [], bySchool: [] });
const stdDialog = ref(false);
const stdForm = reactive({ id: null, event_name: '', specification: '', gender: 'A', result_direction: 'LOWER', result_entry_type: 'TIME' });
const stdRows = ref([
  { grade_code: 'MASTER', grade_name: '运动健将', result_value: '', bonus_value: 0 },
  { grade_code: 'L1', grade_name: '一级运动员', result_value: '', bonus_value: 0 },
  { grade_code: 'L2', grade_name: '二级运动员', result_value: '', bonus_value: 0 },
  { grade_code: 'L3', grade_name: '三级运动员', result_value: '', bonus_value: 0 },
  { grade_code: 'YOUTH', grade_name: '少年级', result_value: '', bonus_value: 0 }
]);
const stdCols = [
  { colKey: 'grade_name', title: '等级', width: 120 },
  { colKey: 'result_value', title: '达标成绩', width: 160, edit: { component: 'input' } },
  { colKey: 'bonus_value', title: '加分', width: 120, edit: { component: 'input-number' } }
];
const bonusDialog = ref(false);
const bonusList = ref([]);

const achieveCols = [
  { colKey: 'athlete_name', title: '运动员', width: 110 },
  { colKey: 'team_name', title: '单位', minWidth: 140 },
  { colKey: 'event_name', title: '项目', width: 120 },
  { colKey: 'band_label', title: '组别', width: 100 },
  { colKey: 'result_text', title: '成绩', width: 100, align: 'right' },
  { colKey: 'grade_name', title: '认定等级', width: 110 },
  { colKey: 'bonus_value', title: '加分', width: 70, align: 'right' },
  { colKey: 'op', title: '操作', width: 70, align: 'center', cell: 'op' }
];
const gradeSumCols = [
  { colKey: 'grade_name', title: '等级', minWidth: 120 },
  { colKey: 'c', title: '人次', width: 80, align: 'right' }
];
const schoolSumCols = [
  { colKey: 'team_name', title: '单位', minWidth: 130 },
  { colKey: 'c', title: '合计', width: 70, align: 'right' },
  { colKey: 'master_count', title: '健将', width: 60, align: 'center' },
  { colKey: 'l1_count', title: '一级', width: 60, align: 'center' },
  { colKey: 'l2_count', title: '二级', width: 60, align: 'center' },
  { colKey: 'l3_count', title: '三级', width: 60, align: 'center' },
  { colKey: 'youth_count', title: '少年级', width: 70, align: 'center' },
  { colKey: 'bonus_total', title: '加分合计', width: 90, align: 'right' }
];

// ---------- 破纪录 ----------
const records = ref([]);
const breaks = ref([]);
const recDialog = ref(false);
const recForm = reactive({
  id: null, event_item_id: null, band_id: null,
  meet_record_value: '', meet_record_holder: '', meet_record_meet_name: '', meet_record_date: '',
  highest_record_value: '', highest_record_holder: '', highest_record_meet_name: '', highest_record_date: ''
});
const recBonusDialog = ref(false);
const recBonusList = ref([
  { record_type: 'MEET', label: '破赛会纪录', bonus_value: 0 },
  { record_type: 'HIGHEST', label: '破最高纪录', bonus_value: 0 }
]);
const recordCols = [
  { colKey: 'event_name', title: '项目', width: 120 },
  { colKey: 'band_label', title: '组别', width: 100 },
  { colKey: 'meet_record_value', title: '赛会纪录', width: 100, align: 'right' },
  { colKey: 'meet_record_holder', title: '保持者', width: 100 },
  { colKey: 'highest_record_value', title: '最高纪录', width: 100, align: 'right' },
  { colKey: 'highest_record_holder', title: '保持者', width: 100 },
  { colKey: 'op', title: '操作', width: 110, align: 'center', cell: 'op' }
];
const breakCols = [
  { colKey: 'athlete_name', title: '运动员', width: 110 },
  { colKey: 'school_name', title: '单位', minWidth: 140 },
  { colKey: 'event_name', title: '项目', width: 120 },
  { colKey: 'result_text', title: '新纪录', width: 100, align: 'right' },
  { colKey: 'old_value', title: '原纪录', width: 100, align: 'right' },
  { colKey: 'record_type', title: '类型', width: 100, cell: (h, { row }) => row.record_type === 'MEET' ? '赛会纪录' : '最高纪录' },
  { colKey: 'bonus_value', title: '加分', width: 70, align: 'right' },
  { colKey: 'op', title: '操作', width: 70, align: 'center', cell: 'op' }
];

// ---------- 综合查询 ----------
const summary = ref({});
const q = reactive({ keyword: '', school_id: null, band_id: null, event_item_id: null });
const athleteRows = ref([]);
const schoolRows = ref([]);
const eventRows = ref([]);
const detailDialog = ref(false);
const detailName = ref('');
const detailRows = ref([]);
const detailCols = [
  { colKey: 'event_name', title: '项目', width: 130 },
  { colKey: 'band_label', title: '组别', width: 100 },
  { colKey: 'heat_name', title: '赛次', width: 110 },
  { colKey: 'result_text', title: '成绩', width: 100, align: 'right' },
  { colKey: 'rank_no', title: '名次', width: 70, align: 'center' },
  { colKey: 'score', title: '积分', width: 70, align: 'right' }
];
const athleteCols = [
  { colKey: 'athlete_name', title: '运动员', width: 110 },
  { colKey: 'school_name', title: '单位', minWidth: 140 },
  { colKey: 'band_label', title: '组别', width: 100 },
  { colKey: 'event_count', title: '参赛项数', width: 90, align: 'center' },
  { colKey: 'first_count', title: '第一', width: 60, align: 'center' },
  { colKey: 'second_count', title: '第二', width: 60, align: 'center' },
  { colKey: 'third_count', title: '第三', width: 60, align: 'center' },
  { colKey: 'abnormal_count', title: '未完赛', width: 80, align: 'center' },
  { colKey: 'op', title: '操作', width: 90, align: 'center', cell: 'op' }
];
const schoolQueryCols = [
  { colKey: 'school_name', title: '单位', minWidth: 160 },
  { colKey: 'athlete_count', title: '人数', width: 80, align: 'center' },
  { colKey: 'event_count', title: '项目数', width: 80, align: 'center' },
  { colKey: 'entry_count', title: '成绩条数', width: 90, align: 'center' },
  { colKey: 'first_count', title: '第一', width: 60, align: 'center' },
  { colKey: 'second_count', title: '第二', width: 60, align: 'center' },
  { colKey: 'third_count', title: '第三', width: 60, align: 'center' },
  { colKey: 'score_total', title: '积分合计', width: 100, align: 'right' }
];
const eventQueryCols = [
  { colKey: 'event_name', title: '项目', minWidth: 130 },
  { colKey: 'band_label', title: '组别', width: 100 },
  { colKey: 'entry_count', title: '参赛人次', width: 90, align: 'center' },
  { colKey: 'ranked_count', title: '已取名次', width: 90, align: 'center' },
  { colKey: 'abnormal_count', title: '未完赛', width: 80, align: 'center' }
];

// ---------- 公开页 ----------
const pubForm = reactive({ public_flag: 0, public_note: '', uuid: '' });

// ============================================================
onMounted(async () => {
  await loadComps();
  if (compId.value) await onCompChange();
});

watch(tab, async (v) => {
  if (!compId.value) return;
  if (v === 'grade') await loadGrade();
  if (v === 'record') await loadRecords();
  if (v === 'query') await loadQuery();
  if (v === 'public') await loadPublic();
});

async function loadComps() {
  const list = await http.get('/competition/list');
  compOptions.value = (list || []).map((c) => ({ label: c.name, value: c.id }));
}

async function onCompChange() {
  store.setCompetition(compId.value);
  await Promise.all([loadBands(), loadSchools(), loadEvents(), loadRules()]);
  if (tab.value === 'grade') await loadGrade();
  if (tab.value === 'record') await loadRecords();
  if (tab.value === 'query') await loadQuery();
  if (tab.value === 'public') await loadPublic();
  if (ruleId.value) await loadTeamScore();
}

async function loadBands() {
  bandList.value = await http.get('/band/list', { params: { competition_id: compId.value } }) || [];
}
async function loadSchools() {
  const list = await http.get('/school/list') || [];
  schoolOptions.value = list.map((s) => ({ label: s.name, value: s.id }));
}
async function loadEvents() {
  const list = await http.get('/event/items', { params: { competition_id: compId.value } }) || [];
  eventOptions.value = list.map((e) => ({ label: e.name, value: e.id }));
}

// ---------- 团体总分 ----------
async function loadRules() {
  rules.value = await http.get('/track-stats/team-score-rules', { params: { competition_id: compId.value } }) || [];
  if (!ruleId.value && rules.value.length) ruleId.value = rules.value[0].id;
}

async function loadTeamScore() {
  if (!ruleId.value) { teamRows.value = []; return; }
  loading.value = true;
  try {
    teamRows.value = await http.get('/track-stats/team-score/total', { params: { rule_id: ruleId.value } }) || [];
  } finally { loading.value = false; }
}

function openRuleDialog(r) {
  Object.assign(ruleForm, {
    id: r?.id || null,
    scheme_name: r?.scheme_name || '',
    scope_mode: r?.scope_mode || 'BAND',
    band_ids: r?.band_ids ? [...r.band_ids] : bandList.value.map((b) => b.id),
    score_source: r?.score_source || 'RANK',
    score_table: { ...DEFAULT_TABLE, ...(r?.score_table || {}) },
    rank_limit: r?.rank_limit ?? 8,
    relay_multiplier: r?.relay_multiplier ?? 2,
    include_grade_bonus: r?.include_grade_bonus ?? 0,
    include_record_bonus: r?.include_record_bonus ?? 0,
    tie_break_mode: r?.tie_break_mode || 'FIRST'
  });
  ruleDialog.value = true;
}

async function saveRule() {
  if (!ruleForm.scheme_name) { MessagePlugin.warning('请填写方案名称'); return; }
  loading.value = true;
  try {
    const r = await http.post('/track-stats/team-score-rules', { ...ruleForm, competition_id: compId.value });
    MessagePlugin.success(r?.message || '已保存');
    ruleDialog.value = false;
    await loadRules();
    if (r?.data?.id) { ruleId.value = r.data.id; await loadTeamScore(); }
  } finally { loading.value = false; }
}

async function delRule() {
  const d = await DialogPlugin.confirm({ header: '确认删除', body: '删除方案会同时清除已计算的团体总分，确定吗？' });
  d.hide();
  await new Promise((res) => {
    d.on('confirm', async () => { await http.delete(`/track-stats/team-score-rules/${ruleId.value}`); res(); });
    d.on('cancel', () => res());
  });
  ruleId.value = null;
  teamRows.value = [];
  await loadRules();
  MessagePlugin.success('已删除');
}

async function calcTeamScore() {
  loading.value = true;
  try {
    const r = await http.post('/track-stats/team-score/calc', { competition_id: compId.value, rule_id: ruleId.value });
    MessagePlugin.success(r?.message || '计算完成');
    await loadTeamScore();
  } finally { loading.value = false; }
}

async function openVgOrSave() { /* 占位，实际用 vgDialog */ }

async function saveVg() {
  for (const g of vgList.value) {
    if (!g.group_name) continue;
    await http.post('/track-stats/virtual-groups', {
      ...g, competition_id: compId.value, rule_id: ruleId.value
    });
  }
  vgDialog.value = false;
  MessagePlugin.success('虚拟组已保存');
  await calcTeamScore();
}

watch(vgDialog, async (v) => {
  if (v) vgList.value = await http.get('/track-stats/virtual-groups', { params: { competition_id: compId.value, rule_id: ruleId.value } }) || [];
});

function openAdjust(row) {
  Object.assign(adjRow, {
    id: row.id, unit_name: row.unit_name, total_score: row.total_score,
    adjust_score: Number(row.adjust_score) || 0, adjust_reason: row.adjust_reason || ''
  });
  adjDialog.value = true;
}

async function saveAdjust() {
  await http.put('/track-stats/team-score/adjust', { ...adjRow });
  MessagePlugin.success('已调整');
  adjDialog.value = false;
  await loadTeamScore();
}

function exportTeamScore() {
  const head = ['名次', '参赛单位', '项目得分', '达级加分', '破纪录加分', '基础分调整', '总分', '第一名', '第二名', '第三名'];
  const lines = [head.join(',')];
  teamRows.value.forEach((r) => {
    lines.push([r.rank_no, r.unit_name, r.total_score, r.grade_bonus, r.record_bonus,
      r.adjust_score, r.final_score, r.first_count, r.second_count, r.third_count].join(','));
  });
  download(`团体总分_${currentRule.value?.scheme_name || ''}.csv`, lines.join('\n'));
}

// ---------- 达级 ----------
async function loadGrade() {
  loading.value = true;
  try {
    achievements.value = await http.get('/track-stats/grade-achievements', { params: { competition_id: compId.value } }) || [];
    gradeSummary.value = await http.get('/track-stats/grade/summary', { params: { competition_id: compId.value } }) || { byGrade: [], bySchool: [] };
  } finally { loading.value = false; }
}

async function recognizeGrades() {
  loading.value = true;
  try {
    const r = await http.post('/track-stats/grade/recognize', { competition_id: compId.value });
    MessagePlugin.success(r?.message || '认定完成');
    await loadGrade();
  } finally { loading.value = false; }
}

async function revokeAchieve(id) {
  await http.post(`/track-stats/grade-achievements/${id}/revoke`);
  MessagePlugin.success('已撤销');
  await loadGrade();
}

function openStandardDialog() {
  Object.assign(stdForm, { id: null, event_name: '', specification: '', gender: 'A', result_direction: 'LOWER', result_entry_type: 'TIME' });
  stdRows.value.forEach((r) => { r.result_value = ''; r.bonus_value = 0; });
  stdDialog.value = true;
}

async function saveStandard() {
  if (!stdForm.event_name) { MessagePlugin.warning('请填写项目名称'); return; }
  const r = await http.post('/track-stats/grade-standards', { ...stdForm });
  const sid = r?.data?.id;
  if (sid) {
    await http.put('/track-stats/grade-thresholds', {
      standard_id: sid,
      rows: stdRows.value.filter((x) => x.result_value !== '' && x.result_value !== null)
    });
  }
  MessagePlugin.success('标准已保存');
  stdDialog.value = false;
}

watch(bonusDialog, async (v) => {
  if (!v) return;
  const exist = await http.get('/track-stats/grade-bonus-rules', { params: { competition_id: compId.value } }) || [];
  const map = Object.fromEntries(exist.map((x) => [x.grade_code, Number(x.bonus_value) || 0]));
  bonusList.value = [
    { grade_code: 'MASTER', grade_name: '运动健将', bonus_value: map.MASTER || 0 },
    { grade_code: 'L1', grade_name: '一级运动员', bonus_value: map.L1 || 0 },
    { grade_code: 'L2', grade_name: '二级运动员', bonus_value: map.L2 || 0 },
    { grade_code: 'L3', grade_name: '三级运动员', bonus_value: map.L3 || 0 },
    { grade_code: 'YOUTH', grade_name: '少年级', bonus_value: map.YOUTH || 0 }
  ];
});
function openBonusDialog() { bonusDialog.value = true; }

async function saveBonus() {
  await http.put('/track-stats/grade-bonus-rules', { competition_id: compId.value, rows: bonusList.value });
  MessagePlugin.success('加分规则已保存');
  bonusDialog.value = false;
}

// ---------- 破纪录 ----------
async function loadRecords() {
  loading.value = true;
  try {
    records.value = await http.get('/track-stats/records', { params: { competition_id: compId.value } }) || [];
    breaks.value = await http.get('/track-stats/record-breaks', { params: { competition_id: compId.value } }) || [];
  } finally { loading.value = false; }
}

async function detectRecords() {
  loading.value = true;
  try {
    const r = await http.post('/track-stats/record/detect', { competition_id: compId.value });
    MessagePlugin.success(r?.message || '检测完成');
    await loadRecords();
  } finally { loading.value = false; }
}

function openRecordDialog(r) {
  Object.assign(recForm, {
    id: r?.id || null,
    event_item_id: r?.event_item_id ?? (eventOptions.value[0]?.value ?? null),
    band_id: r?.band_id ?? null,
    meet_record_value: r?.meet_record_value || '',
    meet_record_holder: r?.meet_record_holder || '',
    meet_record_meet_name: r?.meet_record_meet_name || '',
    meet_record_date: r?.meet_record_date || '',
    highest_record_value: r?.highest_record_value || '',
    highest_record_holder: r?.highest_record_holder || '',
    highest_record_meet_name: r?.highest_record_meet_name || '',
    highest_record_date: r?.highest_record_date || ''
  });
  recDialog.value = true;
}

async function saveRecord() {
  if (!recForm.event_item_id) { MessagePlugin.warning('请选择项目'); return; }
  const r = await http.post('/track-stats/records', { ...recForm, competition_id: compId.value });
  MessagePlugin.success(r?.message || '已保存');
  recDialog.value = false;
  await loadRecords();
}

async function delRecord(id) {
  await http.delete(`/track-stats/records/${id}`);
  MessagePlugin.success('已删除');
  await loadRecords();
}

async function revokeBreak(id) {
  await http.post(`/track-stats/record-breaks/${id}/revoke`);
  MessagePlugin.success('已撤销');
  await loadRecords();
}

watch(recBonusDialog, async (v) => {
  if (!v) return;
  const exist = await http.get('/track-stats/record-bonus-rules', { params: { competition_id: compId.value } }) || [];
  const map = Object.fromEntries(exist.map((x) => [x.record_type, Number(x.bonus_value) || 0]));
  recBonusList.value = [
    { record_type: 'MEET', label: '破赛会纪录', bonus_value: map.MEET || 0 },
    { record_type: 'HIGHEST', label: '破最高纪录', bonus_value: map.HIGHEST || 0 }
  ];
});
function openRecordBonusDialog() { recBonusDialog.value = true; }

async function saveRecordBonus() {
  await http.put('/track-stats/record-bonus-rules', { competition_id: compId.value, rows: recBonusList.value });
  MessagePlugin.success('已保存');
  recBonusDialog.value = false;
}

// ---------- 综合查询 ----------
async function loadQuery() {
  loading.value = true;
  try {
    summary.value = await http.get('/track-stats/query/summary', { params: { competition_id: compId.value } }) || {};
    athleteRows.value = await http.get('/track-stats/query/athletes', {
      params: { competition_id: compId.value, keyword: q.keyword || undefined, school_id: q.school_id || undefined, band_id: q.band_id || undefined }
    }) || [];
    schoolRows.value = await http.get('/track-stats/query/schools', {
      params: { competition_id: compId.value, band_id: q.band_id || undefined }
    }) || [];
    eventRows.value = await http.get('/track-stats/query/events', {
      params: { competition_id: compId.value, band_id: q.band_id || undefined }
    }) || [];
  } finally { loading.value = false; }
}

async function viewAthlete(row) {
  detailName.value = row.athlete_name || '';
  detailRows.value = await http.get(`/track-stats/query/athlete/${row.athlete_id}/detail`, {
    params: { competition_id: compId.value }
  }) || [];
  detailDialog.value = true;
}

function exportAthletes() {
  const head = ['运动员', '单位', '组别', '参赛项数', '第一名', '第二名', '第三名', '未完赛'];
  const lines = [head.join(',')];
  athleteRows.value.forEach((r) => {
    lines.push([r.athlete_name, r.school_name, r.band_label, r.event_count,
      r.first_count, r.second_count, r.third_count, r.abnormal_count].join(','));
  });
  download('运动员成绩汇总.csv', lines.join('\n'));
}

// ---------- 公开页 ----------
async function loadPublic() {
  const c = await http.get('/track-stats/public-config', { params: { competition_id: compId.value } });
  if (c) Object.assign(pubForm, { public_flag: Number(c.public_flag) || 0, public_note: c.public_note || '', uuid: c.uuid || '' });
}
async function savePublic() {
  const r = await http.put('/track-stats/public-config', { ...pubForm, competition_id: compId.value });
  if (r?.data?.uuid) pubForm.uuid = r.data.uuid;
  MessagePlugin.success('已保存');
}
async function resetUuid() {
  const r = await http.post('/track-stats/public-config/reset-uuid', { competition_id: compId.value });
  pubForm.uuid = r?.data?.uuid || '';
  MessagePlugin.success('分享码已重新生成');
}
function publicUrl() {
  const base = location.origin + location.pathname;
  return `${base}#/public/${pubForm.uuid}`;
}
async function copyLink() {
  try { await navigator.clipboard.writeText(publicUrl()); MessagePlugin.success('链接已复制'); }
  catch { MessagePlugin.info(publicUrl()); }
}
function openPublic() {
  if (!pubForm.uuid) { MessagePlugin.warning('请先保存生成分享码'); return; }
  window.open(publicUrl(), '_blank');
}

// ---------- 工具 ----------
function download(name, content) {
  const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
</script>

<style scoped>
.page { padding: 16px; }
.page-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
.page-head h2 { margin: 0; font-size: 20px; font-weight: 600; }
.bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
.hint { font-size: 12px; color: var(--app-text-3); }
.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 16px; }
.stat-card { background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 6px; padding: 14px; text-align: center; }
.stat-card .sn { font-size: 24px; font-weight: 600; color: var(--td-brand-color); }
.stat-card .sl { font-size: 12px; color: var(--app-text-3); margin-top: 4px; }
.score-table { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; width: 100%; }
.st-cell { display: flex; align-items: center; gap: 6px; }
.st-l { font-size: 13px; color: #4b5b76; min-width: 48px; }
.vg-row { display: flex; align-items: center; margin-bottom: 10px; }
.vg-row .bl { min-width: 110px; font-size: 14px; }
</style>
