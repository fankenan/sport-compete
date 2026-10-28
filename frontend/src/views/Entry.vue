<template>
  <div>
    <t-card :bordered="true">
      <t-tabs v-model="activeTab" class="entry-tabs">
<!-- 球队报名 -->
    <t-tab-panel value="teams" label="球队报名">
      <div class="tb-row">
        <t-select
          v-if="!store.isAdmin"
          v-model="compId"
          placeholder="选择赛事"
          size="small"
          style="width: 200px"
          @change="onCompChange"
        >
          <t-option v-for="c in competitions" :key="c.id" :label="c.name" :value="Number(c.id)" />
        </t-select>
        <t-select v-model="filterBand" placeholder="全部组别" clearable size="small" style="width: 140px" @change="loadTeams">
              <t-option v-for="b in bands" :key="b.id" :label="bandLabel(b)" :value="b.id" />
            </t-select>
            <t-select v-model="filterEvent" placeholder="全部项目" clearable size="small" style="width: 140px" @change="loadTeams">
              <t-option v-for="e in events" :key="e.id" :label="e.name" :value="e.id" />
            </t-select>
            <t-select
              v-if="store.isAdmin"
              v-model="filterSchool"
              placeholder="全部学校"
              clearable
              filterable
              size="small"
              style="width: 180px"
              @change="loadTeams"
            >
              <t-option v-for="s in schools" :key="s.id" :label="s.short_name || s.name" :value="s.id" />
            </t-select>
            <t-select v-model="filterStatus" placeholder="全部状态" clearable size="small" style="width: 120px" @change="loadTeams">
              <t-option label="待审核" :value="1" />
              <t-option label="已通过" :value="2" />
              <t-option label="已驳回" :value="3" />
            </t-select>
            <t-button v-if="store.isSchool" theme="primary" @click="openTeamCreate">新增报名</t-button>
            <t-button v-if="store.isAdmin" theme="success" variant="outline" @click="batchAudit(2)">批量通过</t-button>
            <t-button v-if="store.isAdmin" theme="danger" variant="outline" @click="batchAudit(3)">批量驳回</t-button>
            <t-button @click="loadTeams">刷新</t-button>
          </div>

          <div class="table-scroll">
            <t-table
              :data="teams"
              :columns="teamColumns"
              row-key="id"
              :loading="loadingTeams"
              :empty="'暂无数据'"
              hover
              @select-change="(keys, ctx) => onSelectChange(ctx?.selectedRowData || [])"
            >
              <template #leader_name="{ row }">
                <span class="dim">{{ row.leader_name || '—' }}</span>
              </template>
              <template #coach_name="{ row }">
                <span class="dim">{{ row.coach_name || '—' }}</span>
              </template>
              <template #roster_count="{ row }">{{ rosterCount(row) }}</template>
              <template #status="{ row }">
                <t-tag :theme="statusType(row.status)" size="small" variant="light">{{ statusLabel(row.status) }}</t-tag>
              </template>
              <template #ops="{ row }">
                <t-button variant="text" theme="primary" size="small" @click="openTeamEdit(row)">编辑</t-button>
                <template v-if="store.isAdmin">
                  <t-button variant="text" theme="success" size="small" @click="auditTeam(row, 2)">通过</t-button>
                  <t-button variant="text" theme="danger" size="small" @click="auditTeam(row, 3)">驳回</t-button>
                </template>
                <t-button v-else variant="text" theme="danger" size="small" @click="removeTeam(row)">删除</t-button>
                <t-button variant="text" size="small" @click="showRoster(row)">名单</t-button>
              </template>
            </t-table>
          </div>
        </t-tab-panel>

        <!-- 个人报名 -->
        <t-tab-panel value="athletes" label="个人报名">
          <div class="tb-row">
            <t-select v-model="filterBand" placeholder="全部组别" clearable size="small" style="width: 140px" @change="loadAthletes">
              <t-option v-for="b in bands" :key="b.id" :label="bandLabel(b)" :value="b.id" />
            </t-select>
<t-select v-model="filterEvent" placeholder="全部项目" clearable size="small" style="width: 140px" @change="loadAthletes">
          <t-option v-for="e in events" :key="e.id" :label="e.name" :value="e.id" />
        </t-select>
        <t-select
          v-if="store.isAdmin"
          v-model="filterSchool"
          placeholder="全部学校"
          clearable
          filterable
          size="small"
          style="width: 180px"
          @change="loadAthletes"
        >
          <t-option v-for="s in schools" :key="s.id" :label="s.short_name || s.name" :value="s.id" />
        </t-select>
        <t-select
          v-if="!store.isAdmin"
          v-model="compId"
          placeholder="选择赛事"
          size="small"
          style="width: 200px"
          @change="onCompChange"
        >
          <t-option v-for="c in competitions" :key="c.id" :label="c.name" :value="Number(c.id)" />
        </t-select>
        <t-button v-if="store.isSchool" theme="primary" @click="openAthleteEntry">报项</t-button>
            <t-button @click="loadAthletes">刷新</t-button>
          </div>

          <div class="table-scroll">
            <t-table
              :data="athletes"
              :columns="athleteColumns"
              row-key="id"
              :loading="loadingAthletes"
              :empty="'暂无数据'"
              hover
            >
              <template #gender="{ row }">{{ row.gender === 2 ? '女' : '男' }}</template>
              <template #class_name="{ row }">
                <span class="dim">{{ row.class_name || '—' }}</span>
              </template>
              <template #student_no="{ row }">
                <span class="dim">{{ row.student_no || '—' }}</span>
              </template>
              <template #bib_no="{ row }">
                <span class="dim">{{ row.bib_no || '—' }}</span>
              </template>
              <template #status="{ row }">
                <t-tag :theme="statusType(row.status)" size="small" variant="light">{{ statusLabel(row.status) }}</t-tag>
              </template>
              <template #ops="{ row }">
                <t-button variant="text" theme="primary" size="small" @click="openEntryEdit(row)">修改</t-button>
                <template v-if="store.isAdmin">
                  <t-button variant="text" theme="success" size="small" @click="auditAthlete(row, 2)">通过</t-button>
                  <t-button variant="text" theme="danger" size="small" @click="auditAthlete(row, 3)">驳回</t-button>
                </template>
              </template>
            </t-table>
          </div>
        </t-tab-panel>

        <!-- 报名进度 -->
        <t-tab-panel value="progress" label="报名进度">
          <div class="tb-row">
            <t-button @click="loadProgress">刷新</t-button>
            <span class="tb-hint">待审数量为 0 表示该校报名已全部审核通过</span>
          </div>

          <div class="stat-grid">
            <div class="stat-card">
              <p class="stat-label">已报学校</p>
              <p class="stat-value">{{ reportedSchools }}<span class="stat-unit">所</span></p>
            </div>
            <div class="stat-card">
              <p class="stat-label">通过队伍</p>
              <p class="stat-value">{{ totalTeams }}<span class="stat-unit">队</span></p>
            </div>
            <div class="stat-card">
              <p class="stat-label">通过人数</p>
              <p class="stat-value">{{ totalAthletes }}<span class="stat-unit">人</span></p>
            </div>
            <div class="stat-card">
              <p class="stat-label">待审核</p>
              <p class="stat-value">{{ totalPending }}<span class="stat-unit">队</span></p>
            </div>
          </div>

          <div class="table-scroll">
            <t-table
              :data="progressList"
              :columns="progressColumns"
              row-key="id"
              table-layout="fixed"
              :loading="loadingProgress"
              :empty="'暂无数据'"
              hover
            >
              <template #stage="{ row }">{{ stageLabel(row.stage) }}</template>
              <template #short_name="{ row }">
                <span class="dim">{{ row.short_name || '—' }}</span>
              </template>
              <template #pending_count="{ row }">
                <t-tag v-if="row.pending_count > 0" theme="warning" size="small" variant="light">
                  {{ row.pending_count }}
                </t-tag>
                <span v-else class="dim">0</span>
              </template>
              <template #signup="{ row }">
                <t-tag v-if="row.team_count > 0 || row.athlete_count > 0" theme="success" size="small" variant="light">已报名</t-tag>
                <t-tag v-else theme="default" size="small" variant="light">未报名</t-tag>
              </template>
            </t-table>
          </div>
        </t-tab-panel>

        <!-- 名册管理 -->
        <t-tab-panel value="roster" label="名册管理">
          <div class="tb-row">
            <t-button theme="primary" @click="openAthleteCreate">新增运动员</t-button>
            <t-button variant="outline" :loading="printingAll" @click="printBadgesAll">
              打印参赛证
            </t-button>
            <t-button variant="outline" :loading="exporting" @click="exportRoster">
              导出花名册
            </t-button>
            <t-button variant="outline" @click="loadRoster">刷新</t-button>
            <span class="tb-hint">名册随上方赛事筛选，显示该赛事报名的运动员</span>
          </div>

          <div class="table-scroll">
            <t-table
              :data="roster"
              :columns="rosterColumns"
              row-key="id"
              :loading="loadingRoster"
              :empty="'暂无数据'"
              hover
            >
              <template #photo="{ row }">
                <div class="photo-cell" @click="previewPhoto(row)">
                  <img v-if="row.photo" :src="row.photo" class="photo-thumb" alt="照片" />
                  <div v-else class="photo-empty">
                    <span>{{ row.name.slice(0, 1) }}</span>
                  </div>
                </div>
              </template>
              <template #gender="{ row }">{{ row.gender === 2 ? '女' : '男' }}</template>
              <template #class_name="{ row }">
                <span v-if="row.class_name">{{ row.class_name }}</span>
                <span v-else class="dim">—</span>
              </template>
              <template #student_no="{ row }">
                <span v-if="row.student_no">{{ row.student_no }}</span>
                <span v-else class="dim">—</span>
              </template>
              <template #has_card="{ row }">
                <t-button v-if="row.has_card" variant="text" theme="primary" size="small" @click="viewCard(row)">
                  查看
                </t-button>
                <span v-else class="dim">未上传</span>
              </template>
              <template #ops="{ row }">
                <t-button variant="text" theme="primary" size="small" @click="openAthleteEdit(row)">修改</t-button>
                <t-button variant="text" theme="primary" size="small" @click="printBadgeOne(row)">打印</t-button>
                <t-button variant="text" theme="danger" size="small" @click="removeAthlete(row)">删除</t-button>
              </template>
            </t-table>
          </div>
        </t-tab-panel>
      </t-tabs>
    </t-card>

    <!-- 球队报名表单 -->
    <t-dialog
      v-model:visible="teamDialog"
      :header="teamForm.id ? '编辑球队报名' : '新增球队报名'"
      :width="isMobile ? '94%' : '520px'" attach="body">
      <t-form :data="teamForm" label-width="88px" label-align="right">
        <t-alert
          v-if="teamForm.has_match"
          theme="warning"
          :message="'该队已进入赛程，组别与项目不可修改；如确需调整，请先到「赛程编排」删除相关场次'"
          style="margin-bottom: 14px"
        />
        <t-form-item label="组别" name="band_id" :rules="[{ required: true, message: '请选择组别' }]">
          <t-select v-model="teamForm.band_id" :disabled="teamForm.has_match" style="width: 100%">
            <t-option v-for="b in bands" :key="b.id" :label="bandLabel(b)" :value="b.id" />
          </t-select>
        </t-form-item>
        <t-form-item label="项目" name="event_item_id" :rules="[{ required: true, message: '请选择项目' }]">
          <t-select v-model="teamForm.event_item_id" :disabled="teamForm.has_match" style="width: 100%">
            <t-option
              v-for="e in events.filter((x) => x.category === 3)"
              :key="e.id"
              :label="e.name"
              :value="e.id"
            />
          </t-select>
        </t-form-item>
        <t-form-item label="队名" name="team_name" :rules="[{ required: true, message: '请填写队名' }]">
          <t-input v-model="teamForm.team_name" placeholder="如 少先队代表队" :maxlength="64" />
        </t-form-item>
        <t-form-item label="领队" name="leader_name">
          <t-input v-model="teamForm.leader_name" placeholder="选填" :maxlength="32" />
        </t-form-item>
        <t-form-item label="教练员" name="coach_name">
          <t-input v-model="teamForm.coach_name" placeholder="选填" :maxlength="32" />
        </t-form-item>
        <t-form-item label="队员名单" name="roster">
          <div class="roster-edit">
            <div v-for="(m, i) in teamForm.roster" :key="i" class="roster-row">
              <span class="roster-seq">{{ i + 1 }}</span>
              <t-select
                v-model="m.name"
                :options="memberOptions(m)"
                filterable
                creatable
                clearable
                placeholder="点击选择队员"
                class="member-select"
                @change="(v) => onPickMember(m, v)"
              />
              <t-input
                v-model="m.bib_no"
                placeholder="号码"
                class="bib-input"
                :maxlength="6"
              />
              <t-button
                variant="text"
                theme="danger"
                size="small"
                @click="removeMember(i)"
              >删除</t-button>
            </div>
            <div class="roster-foot">
              <t-button size="small" @click="addMember">添加队员</t-button>
              <span v-if="!roster.length" class="roster-tip">
                名册为空，请先到「名册管理」添加运动员
              </span>
              <span v-else class="roster-tip">
                名册共 {{ roster.length }} 人，输入可筛选
              </span>
            </div>
          </div>
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button @click="teamDialog = false">取消</t-button>
        <t-button theme="primary" :loading="saving" @click="submitTeam">提交</t-button>
      </template>
    </t-dialog>

    <!-- 运动员名册表单 -->
    <t-dialog
      v-model:visible="athleteDialog"
      :header="athleteForm.id ? '修改运动员' : '新增运动员'"
      :width="isMobile ? '94%' : '520px'" attach="body">
      <t-form :data="athleteForm" label-width="88px" label-align="right">
        <t-form-item label="照片" name="photo">
          <div class="photo-upload-row">
            <div class="photo-preview" :class="{ empty: !athleteForm.photo }" @click="triggerPhotoPick">
              <img v-if="athleteForm.photo" :src="athleteForm.photo" alt="照片预览" />
              <div v-else class="photo-placeholder">
                <span class="pp-icon">+</span>
                <span class="pp-text">上传照片</span>
              </div>
            </div>
            <div class="photo-actions">
              <t-button size="small" @click="triggerPhotoPick">
                {{ athleteForm.photo ? '重新选择' : '选择照片' }}
              </t-button>
              <t-button v-if="athleteForm.photo" size="small" variant="text" theme="danger" @click="athleteForm.photo = ''">
                移除
              </t-button>
              <p class="photo-tip">JPG / PNG，建议证件照比例</p>
            </div>
            <input ref="photoInput" type="file" accept="image/*" class="hidden-input" @change="onPhotoChange" />
          </div>
        </t-form-item>

        <t-form-item label="姓名" name="name" :rules="[{ required: true, message: '请填写姓名' }]">
          <t-input v-model="athleteForm.name" placeholder="如 张三" :maxlength="32" />
        </t-form-item>
        <t-form-item label="性别" name="gender" :rules="[{ required: true, message: '请选择性别' }]">
          <t-radio-group v-model="athleteForm.gender">
            <t-radio :value="1">男</t-radio>
            <t-radio :value="2">女</t-radio>
          </t-radio-group>
        </t-form-item>
        <t-form-item label="班级" name="class_name">
          <div class="class-row">
            <t-select
              v-model="athleteForm.grade"
              placeholder="年级"
              clearable
              :options="gradeOptions"
              class="class-grade"
              @change="syncClassName"
            />
            <t-select
              v-model="athleteForm.class_no"
              placeholder="班级"
              clearable
              filterable
              :options="classOptions"
              class="class-no"
              @change="syncClassName"
            />
          </div>
          <p class="class-tip">
            {{ gradeHint }}
          </p>
        </t-form-item>
        <t-form-item label="学号" name="student_no">
          <t-input v-model="athleteForm.student_no" placeholder="选填" :maxlength="32" />
        </t-form-item>
        <t-form-item label="身份证号" name="id_card">
          <div class="idcard-wrap">
            <t-input
              v-model="athleteForm.id_card"
              placeholder="用于参赛证出生年月，选填"
              :maxlength="18"
            />
            <div v-if="athleteBirth" class="idcard-birth">出生年月：{{ athleteBirth }}（自动计算）</div>
          </div>
        </t-form-item>
        <t-form-item v-if="store.isAdmin" label="所属学校" name="school_id">
          <t-select v-model="athleteForm.school_id" style="width: 100%" @change="onAthleteSchoolChange">
            <t-option v-for="s in schools" :key="s.id" :label="s.name" :value="s.id" />
          </t-select>
        </t-form-item>

        <t-form-item label="学籍表" name="student_card">
          <div class="card-upload-row">
            <div v-if="athleteForm.student_card_name" class="card-file">
              <span class="card-name" :title="athleteForm.student_card_name">
                {{ athleteForm.student_card_name }}
              </span>
              <t-button variant="text" theme="primary" size="small" @click="previewCardDraft">预览</t-button>
              <t-button variant="text" theme="danger" size="small" @click="clearCardDraft">移除</t-button>
            </div>
            <div v-else class="card-empty">
              <t-button size="small" @click="triggerCardPick">上传学籍表</t-button>
              <span class="card-tip">图片或 PDF，单个不超过 8MB</span>
            </div>
            <input ref="cardInput" type="file" accept="image/*,.pdf,application/pdf" class="hidden-input" @change="onCardChange" />
          </div>
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button @click="athleteDialog = false">取消</t-button>
        <t-button theme="primary" :loading="saving" @click="submitAthlete">保存</t-button>
      </template>
    </t-dialog>

    <!-- 个人报项表单 -->
    <t-dialog
      v-model:visible="entryDialog"
      :header="entryForm.id ? '修改报名' : '田径项目报项'"
      :width="isMobile ? '94%' : '440px'" attach="body">
      <t-form :data="entryForm" label-width="88px" label-align="right">
        <t-alert
          v-if="entryForm.has_heat"
          theme="warning"
          :message="'该报名已进入赛次，组别、项目和运动员均不可修改；如确需调整，请先到「成绩录入」删除相关赛次'"
          style="margin-bottom: 14px"
        />
        <t-form-item label="组别" name="band_id" :rules="[{ required: true, message: '请选择组别' }]">
          <t-select v-model="entryForm.band_id" :disabled="entryForm.has_heat" style="width: 100%">
            <t-option v-for="b in bands" :key="b.id" :label="bandLabel(b)" :value="b.id" />
          </t-select>
        </t-form-item>
        <t-form-item label="项目" name="event_item_id" :rules="[{ required: true, message: '请选择项目' }]">
          <t-select v-model="entryForm.event_item_id" :disabled="entryForm.has_heat" style="width: 100%">
            <t-option
              v-for="e in events.filter((x) => x.category !== 3)"
              :key="e.id"
              :label="e.name"
              :value="e.id"
            />
          </t-select>
        </t-form-item>
        <t-form-item label="运动员" name="athlete_id" :rules="[{ required: true, message: '请选择运动员' }]">
          <t-select
            v-model="entryForm.athlete_id"
            filterable
            :disabled="entryForm.has_heat"
            placeholder="选择本校运动员"
            style="width: 100%"
          >
            <t-option
              v-for="a in roster"
              :key="a.id"
              :label="`${a.name}${a.class_name ? ' · ' + a.class_name : ''}`"
              :value="a.id"
            />
          </t-select>
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button @click="entryDialog = false">取消</t-button>
        <t-button theme="primary" :loading="saving" @click="submitEntry">提交</t-button>
      </template>
    </t-dialog>

    <!-- 名单查看 -->
    <t-dialog v-model:visible="rosterDialog" header="队员名单" :width="isMobile ? '94%' : '420px'" attach="body">
      <div v-if="currentRoster.length === 0" class="empty">暂无队员名单</div>
      <div v-else class="roster-view">
        <div v-for="(m, i) in currentRoster" :key="i" class="roster-item">
          <span class="roster-no">{{ m.bib_no || m.no || i + 1 }}</span>
          <span class="roster-name">{{ m.name }}</span>
        </div>
      </div>
      <template #footer>
        <t-button @click="rosterDialog = false">关闭</t-button>
      </template>
    </t-dialog>

    <!-- 照片大图 -->
    <t-dialog v-model:visible="photoDialog" :header="photoTitle" :width="isMobile ? '94%' : '420px'" attach="body">
      <div class="photo-big-wrap">
        <img :src="photoBig" class="photo-big" alt="照片" />
      </div>
      <template #footer>
        <t-button @click="photoDialog = false">关闭</t-button>
      </template>
    </t-dialog>

    <!-- 学籍表查看 -->
    <t-dialog v-model:visible="cardDialog" :header="cardTitle" :width="isMobile ? '96%' : '720px'" top="6vh" attach="body">
      <div v-if="cardLoading" class="card-loading">加载中…</div>
      <div v-else-if="cardData" class="card-body">
        <img v-if="cardIsImage" :src="cardData" class="card-image" alt="学籍表" />
        <iframe v-else :src="cardData" class="card-frame" title="学籍表" />
      </div>
      <div v-else class="empty">无法加载学籍表</div>
      <template #footer>
        <t-button v-if="cardData" theme="primary" variant="outline" @click="downloadCard">下载</t-button>
        <t-button @click="cardDialog = false">关闭</t-button>
      </template>
    </t-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue';
import { message, confirm } from '../utils/ui';
import { useUserStore } from '../store/user';
import http from '../api/http';
import { bandLabel } from '../utils/band';

const store = useUserStore();

const isMobile = ref(window.innerWidth <= 768);
function onResize() {
  isMobile.value = window.innerWidth <= 768;
}
onMounted(() => window.addEventListener('resize', onResize));
onUnmounted(() => window.removeEventListener('resize', onResize));

const activeTab = ref('teams');

const bands = ref([]);
const events = ref([]);
const schools = ref([]);
const competitions = ref([]);
const compId = ref(store.competitionId);

const teams = ref([]);
const athletes = ref([]);
const progress = ref([]);
const roster = ref([]);       // 名册管理表格用：随赛事筛选
const allRoster = ref([]);    // 全量名册：球队队员下拉用

const loadingTeams = ref(false);
const loadingAthletes = ref(false);
const loadingProgress = ref(false);
const loadingRoster = ref(false);
const saving = ref(false);
const exporting = ref(false);
const printingAll = ref(false);

const filterBand = ref(null);
const filterEvent = ref(null);
const filterStatus = ref(null);
const filterSchool = ref(null);
const selectedRows = ref([]);

const teamDialog = ref(false);
const athleteDialog = ref(false);
const entryDialog = ref(false);
const rosterDialog = ref(false);
const currentRoster = ref([]);

const teamColumns = computed(() => {
  const cols = [];
  if (store.isAdmin) cols.push({ colKey: 'row-select', type: 'multiple', width: 42 });
  cols.push(
    { colKey: 'school_name', title: '学校', minWidth: 140, ellipsis: true },
    { colKey: 'band_label', title: '组别', width: 90, align: 'center' },
    { colKey: 'event_name', title: '项目', minWidth: 110, ellipsis: true },
    { colKey: 'team_name', title: '队名', minWidth: 140, ellipsis: true },
    { colKey: 'leader_name', title: '领队', width: 90 },
    { colKey: 'coach_name', title: '教练', width: 90 },
    { colKey: 'roster_count', title: '队员数', width: 80, align: 'center' },
    { colKey: 'status', title: '状态', width: 90, align: 'center' },
    { colKey: 'ops', title: '操作', width: 240, align: 'center', fixed: 'right' }
  );
  return cols;
});

const athleteColumns = computed(() => {
  const cols = [
    { colKey: 'school_name', title: '学校', minWidth: 140, ellipsis: true },
    { colKey: 'band_label', title: '组别', width: 90, align: 'center' },
    { colKey: 'event_name', title: '项目', minWidth: 110, ellipsis: true },
    { colKey: 'name', title: '姓名', width: 100 },
    { colKey: 'gender', title: '性别', width: 70, align: 'center' },
    { colKey: 'class_name', title: '班级', width: 100 },
    { colKey: 'student_no', title: '学号', width: 110 },
    { colKey: 'bib_no', title: '号码', width: 80, align: 'center' },
    { colKey: 'status', title: '状态', width: 90, align: 'center' }
  ];
  if (store.isAdmin) cols.push({ colKey: 'ops', title: '操作', width: 210, align: 'center', fixed: 'right' });
  return cols;
});

const progressColumns = [
  // 所有列都给明确 width，配合 table-layout="fixed"，剩余空间按比例分给各列，
  // 不会出现「学校列吃掉大半个表格」的情况
  { colKey: 'name', title: '学校', width: 280, ellipsis: true },
  { colKey: 'stage', title: '学段', width: 88, align: 'center' },
  { colKey: 'short_name', title: '简称', width: 160, ellipsis: true },
  { colKey: 'team_count', title: '队伍数', width: 88, align: 'center' },
  { colKey: 'athlete_count', title: '人数', width: 88, align: 'center' },
  { colKey: 'pending_count', title: '待审核', width: 88, align: 'center' },
  { colKey: 'signup', title: '报名状态', width: 108, align: 'center' }
];

const rosterColumns = [
  { colKey: 'photo', title: '照片', width: 72, align: 'center' },
  { colKey: 'name', title: '姓名', minWidth: 90 },
  { colKey: 'gender', title: '性别', width: 66, align: 'center' },
  { colKey: 'class_name', title: '班级', width: 100 },
  { colKey: 'student_no', title: '学号', width: 110 },
  { colKey: 'id_card', title: '身份证号', width: 165 },
  { colKey: 'birth', title: '出生年月', width: 96 },
  { colKey: 'school_name', title: '所属学校', minWidth: 140, ellipsis: true },
  { colKey: 'has_card', title: '学籍表', width: 90, align: 'center' },
  { colKey: 'ops', title: '操作', width: 160, align: 'center', fixed: 'right' }
];

const teamForm = reactive({
  id: null,
  band_id: null,
  event_item_id: null,
  team_name: '',
  leader_name: '',
  coach_name: '',
  roster: [],
  // 已进入赛程的报名不能改组别/项目
  has_match: false
});

const athleteForm = reactive({
  id: null,
  name: '',
  gender: 1,
  class_name: '',
  grade: '',      // 年级，如「三年级」
  class_no: '',   // 班级序号，如「2」→ 存库时拼成「三年级2班」
  student_no: '',
  id_card: '',
  school_id: null,
  photo: '',
  student_card: '',
  student_card_name: '',
  student_card_type: ''
});

/* ---------- 年级 / 班级下拉 ---------- */

const GRADE_TEXT = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '七年级', '八年级', '九年级'];

/** 当前运动员所属学校的学段：1小学 2初中 3高中 */
const athleteSchoolStage = computed(() => {
  const sid = athleteForm.school_id || store.user?.school_id || null;
  if (!sid) return null;
  const s = schools.value.find((x) => Number(x.id) === Number(sid));
  return s ? Number(s.stage) : null;
});

/** 年级候选：小学一~六年级 / 初中七~九年级 / 高中一~三年级 */
const gradeOptions = computed(() => {
  const stage = athleteSchoolStage.value;
  let list;
  if (stage === 1) list = GRADE_TEXT.slice(0, 6);        // 一年级…六年级
  else if (stage === 2) list = GRADE_TEXT.slice(6, 9);   // 七年级…九年级
  else if (stage === 3) list = GRADE_TEXT.slice(0, 3);   // 一年级…三年级（高中）
  else list = GRADE_TEXT.slice();                        // 学段未知时全给
  return list.map((g) => ({ label: g, value: g }));
});

/** 班级候选：统一 1~30 班 */
const classOptions = computed(() =>
  Array.from({ length: 30 }, (_, i) => {
    const n = String(i + 1);
    return { label: `${n}班`, value: n };
  })
);

const gradeHint = computed(() => {
  const stage = athleteSchoolStage.value;
  if (stage === 1) return '小学：一年级至六年级';
  if (stage === 2) return '初中：七年级至九年级';
  if (stage === 3) return '高中：一年级至三年级';
  return '请先选择所属学校，年级按学校学段给出';
});

/** 换学校后，若原年级不在新学段的候选里就清掉，避免出现「高三年级」这种不存在的组合 */
function onAthleteSchoolChange() {
  if (athleteForm.grade && !gradeOptions.value.some((o) => o.value === athleteForm.grade)) {
    athleteForm.grade = '';
  }
  syncClassName();
}

/** 选完年级/班级后合成 class_name */
function syncClassName() {
  const g = athleteForm.grade || '';
  const c = athleteForm.class_no || '';
  athleteForm.class_name = g && c ? `${g}${c}班` : (g || (c ? `${c}班` : ''));
}

/** 把库里的 class_name（如「三年级2班」）拆回年级 + 班级 */
function parseClassName(v) {
  const s = String(v || '');
  if (!s) return { grade: '', class_no: '' };
  const gm = s.match(/([一二三四五六七八九])年级/);
  const cm = s.match(/(\d{1,2})班/);
  return { grade: gm ? `${gm[1]}年级` : '', class_no: cm ? cm[1] : '' };
}

/**
 * 从身份证号推算出生年月（前端提示用，最终以后端为准）
 */
function birthFromIdCard(idCard) {
  const s = String(idCard || '').trim().toUpperCase();
  let m = s.match(/^\d{6}(\d{4})(\d{2})\d{2}\d{3}[\dX]$/);
  if (!m) return '';
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return '';
  return `${year}年${month}月`;
}

const athleteBirth = computed(() => birthFromIdCard(athleteForm.id_card));

// 照片与学籍表
const photoInput = ref(null);
const cardInput = ref(null);
const photoDialog = ref(false);
const photoBig = ref('');
const photoTitle = ref('照片');
const cardDialog = ref(false);
const cardTitle = ref('学籍表');
const cardData = ref('');
const cardIsImage = ref(true);
const cardLoading = ref(false);

/**
 * 触发选择照片
 */
function triggerPhotoPick() {
  photoInput.value?.click();
}

function triggerCardPick() {
  cardInput.value?.click();
}

/**
 * 照片选择：压缩后转 base64
 * 证件照不需要原图，压缩到 400px 宽足够看清人脸
 */
function onPhotoChange(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    message.warning('请选择图片文件');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    message.warning('照片不能超过 10MB');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const MAX = 400;
      let { width, height } = img;
      if (width > height && width > MAX) {
        height = Math.round((height * MAX) / width);
        width = MAX;
      } else if (height >= width && height > MAX) {
        width = Math.round((width * MAX) / height);
        height = MAX;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      athleteForm.photo = canvas.toDataURL('image/jpeg', 0.82);
      message.success('照片已就绪');
    };
    img.onerror = () => message.error('图片解析失败，请换一张');
    img.src = reader.result;
  };
  reader.onerror = () => message.error('文件读取失败');
  reader.readAsDataURL(file);
}

/**
 * 学籍表选择：图片压缩，PDF 原样转 base64
 */
function onCardChange(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;

  const isPdf = file.type === 'application/pdf';
  const isImg = file.type.startsWith('image/');
  if (!isPdf && !isImg) {
    message.warning('学籍表请上传图片或 PDF');
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    message.warning('学籍表不能超过 8MB');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    if (isPdf) {
      athleteForm.student_card = reader.result;
      athleteForm.student_card_name = file.name;
      athleteForm.student_card_type = 'application/pdf';
      message.success('学籍表已就绪');
      return;
    }
    // 图片压缩到 1600px，保证扫描件字迹可辨
    const img = new Image();
    img.onload = () => {
      const MAX = 1600;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) {
          height = Math.round((height * MAX) / width);
          width = MAX;
        } else {
          width = Math.round((width * MAX) / height);
          height = MAX;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      athleteForm.student_card = canvas.toDataURL('image/jpeg', 0.85);
      athleteForm.student_card_name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
      athleteForm.student_card_type = 'image/jpeg';
      message.success('学籍表已就绪');
    };
    img.onerror = () => message.error('学籍表解析失败');
    img.src = reader.result;
  };
  reader.onerror = () => message.error('文件读取失败');
  reader.readAsDataURL(file);
}

/**
 * 预览表单里还没保存的学籍表
 */
function previewCardDraft() {
  const d = athleteForm.student_card;
  if (!d) return;
  openCardPreview(d, athleteForm.student_card_type, athleteForm.student_card_name);
}

function clearCardDraft() {
  athleteForm.student_card = '';
  athleteForm.student_card_name = '';
  athleteForm.student_card_type = '';
}

/**
 * 统一打开学籍表预览
 */
function openCardPreview(data, type, name) {
  cardTitle.value = name ? `学籍表 · ${name}` : '学籍表';
  cardData.value = data;
  cardIsImage.value = (type || '').startsWith('image/') || data.startsWith('data:image');
  cardDialog.value = true;
}

/**
 * 列表里查看学籍表（按需加载，不在列表接口返回正文）
 */
async function viewCard(row) {
  cardTitle.value = `学籍表 · ${row.name}`;
  cardData.value = '';
  cardLoading.value = true;
  cardDialog.value = true;
  try {
    const r = await http.get(`/entry/athletes/${row.id}/card`);
    openCardPreview(r.data, r.file_type, r.file_name || row.student_card_name);
  } catch (e) {
    message.error(e.message);
    cardDialog.value = false;
  } finally {
    cardLoading.value = false;
  }
}

/**
 * 下载学籍表
 */
function downloadCard() {
  if (!cardData.value) return;
  const a = document.createElement('a');
  a.href = cardData.value;
  a.download = cardTitle.value.replace(/^学籍表 · /, '') || '学籍表';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * 预览列表里的照片
 */
function previewPhoto(row) {
  if (!row.photo) {
    message.info(`${row.name} 未上传照片`);
    return;
  }
  photoTitle.value = `${row.name} 的照片`;
  photoBig.value = row.photo;
  photoDialog.value = true;
}

const entryForm = reactive({
  id: null,
  band_id: null,
  event_item_id: null,
  athlete_id: null,
  // 已进入赛次的报名不能改组别/项目/运动员
  has_heat: false
});

// 学校角色只看本校进度
const progressList = computed(() => {
  if (!store.isSchool) return progress.value;
  const name = store.user?.school_name;
  if (!name) return progress.value;
  return progress.value.filter((r) => r.name === name);
});

const totalTeams = computed(() => progressList.value.reduce((s, r) => s + (r.team_count || 0), 0));
const totalAthletes = computed(() => progressList.value.reduce((s, r) => s + (r.athlete_count || 0), 0));
const totalPending = computed(() => progressList.value.reduce((s, r) => s + (r.pending_count || 0), 0));
const reportedSchools = computed(
  () => progressList.value.filter((r) => (r.team_count || 0) > 0 || (r.athlete_count || 0) > 0).length
);


function stageLabel(v) {
  return { 1: '小学', 2: '初中', 3: '高中' }[v] || '未知';
}

function statusLabel(v) {
  return { 1: '待审核', 2: '已通过', 3: '已驳回' }[v] || '未知';
}

function statusType(v) {
  return { 1: 'warning', 2: 'success', 3: 'danger' }[v] || 'default';
}

function parseRoster(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch (e) {
    return [];
  }
}

function rosterCount(row) {
  return parseRoster(row.roster_json).length;
}

async function loadBase() {
  if (!store.competitionId) return;
  try {
    bands.value = await http.get('/event/bands', { params: { competition_id: store.competitionId } });
    events.value = await http.get('/event/items', { params: { competition_id: store.competitionId } });
  } catch (e) {
    message.error(e.message);
  }
}

// 学校端顶栏没有赛事选择器，页面内自行选择
async function loadCompetitions() {
  if (store.isAdmin) return;
  try {
    competitions.value = await http.get('/competition/list');
    if (!store.competitionId && competitions.value.length) {
      onCompChange(competitions.value[0].id);
    } else {
      compId.value = store.competitionId;
    }
  } catch (e) {
    competitions.value = [];
  }
}

function onCompChange(id) {
  filterBand.value = null;
  filterEvent.value = null;
  filterSchool.value = null;
  store.setCompetition(id);
}

async function loadSchools() {
  try {
    schools.value = await http.get('/school/list');
  } catch (e) {
    schools.value = [];
  }
}

async function loadTeams() {
  if (!store.competitionId) return;
  loadingTeams.value = true;
  try {
    teams.value = await http.get('/entry/list', {
      params: {
        competition_id: store.competitionId,
        band_id: filterBand.value || undefined,
        event_item_id: filterEvent.value || undefined,
        status: filterStatus.value || undefined,
        school_id: filterSchool.value || undefined
      }
    });
  } catch (e) {
    message.error(e.message);
  } finally {
    loadingTeams.value = false;
  }
}

async function loadAthletes() {
  if (!store.competitionId) return;
  loadingAthletes.value = true;
  try {
    athletes.value = await http.get('/entry/athlete-list', {
      params: {
        competition_id: store.competitionId,
        band_id: filterBand.value || undefined,
        event_item_id: filterEvent.value || undefined,
        school_id: filterSchool.value || undefined
      }
    });
  } catch (e) {
    message.error(e.message);
  } finally {
    loadingAthletes.value = false;
  }
}

async function loadProgress() {
  if (!store.competitionId) return;
  loadingProgress.value = true;
  try {
    progress.value = await http.get('/entry/progress', {
      params: { competition_id: store.competitionId }
    });
  } catch (e) {
    message.error(e.message);
  } finally {
    loadingProgress.value = false;
  }
}

/**
 * 名册列表（随赛事筛选）
 */
async function loadRoster() {
  loadingRoster.value = true;
  try {
    roster.value = await http.get('/entry/athletes', {
      params: store.competitionId ? { competition_id: store.competitionId } : {}
    });
  } catch (e) {
    message.error(e.message);
  } finally {
    loadingRoster.value = false;
  }
}

/**
 * 全量名册（球队队员下拉依赖，不做赛事过滤）
 */
async function loadAllRoster() {
  if (allRoster.value.length) return;
  try {
    allRoster.value = await http.get('/entry/athletes');
  } catch (e) {
    console.warn('[全量名册加载失败]', e.message);
  }
}

function onSelectChange(rows) {
  selectedRows.value = rows;
}

/**
 * 导出花名册 PDF
 * 按学校分组，每个学校一页：标题 + 学校名称条 + 5 列网格（照片 + 姓名/班级/号码）
 */
async function exportRoster() {
  if (!store.competitionId) {
    message.warning('请先选择赛事');
    return;
  }
  if (!allRoster.value.length) {
    message.warning('名册为空，请先添加运动员');
    return;
  }

  exporting.value = true;
  try {
    const blob = await http.get('/entry/roster-pdf', {
      params: { competition_id: store.competitionId },
      responseType: 'blob',
      timeout: 120000
    });

    // 后端出错时会返回 JSON，需要识别出来
    if (blob && blob.type && blob.type.includes('json')) {
      const text = await blob.text();
      let msg = '导出失败';
      try { msg = JSON.parse(text).message || msg; } catch (e) { /* ignore */ }
      throw new Error(msg);
    }

    const comp = competitions.value.find((c) => c.id === Number(store.competitionId));
    const filename = `${comp?.name || '赛事'}运动员名单.pdf`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);

    message.success('已导出花名册');
  } catch (e) {
    message.error(e.message || '导出失败');
  } finally {
    exporting.value = false;
  }
}

/**
 * 下载参赛证 PDF（批量 / 单个共用）
 */
async function downloadBadgePdf(params, loadingRef) {
  if (!store.competitionId) {
    message.warning('请先选择赛事');
    return;
  }
  loadingRef.value = true;
  try {
    const blob = await http.get('/entry/badge-pdf', {
      params: { competition_id: store.competitionId, ...params },
      responseType: 'blob',
      timeout: 120000
    });

    // 后端出错时会返回 JSON，需要识别出来
    if (blob && blob.type && blob.type.includes('json')) {
      const text = await blob.text();
      let msg = '生成失败';
      try { msg = JSON.parse(text).message || msg; } catch (e) { /* ignore */ }
      throw new Error(msg);
    }

    const comp = competitions.value.find((c) => c.id === Number(store.competitionId));
    const suffix = params.athlete_id ? '参赛证' : `${comp?.name || '赛事'}参赛证`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${suffix}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);

    message.success('参赛证已生成，正在下载');
  } catch (e) {
    message.error(e.message || '生成失败');
  } finally {
    loadingRef.value = false;
  }
}

/**
 * 打印全部参赛证（当前赛事报名的所有运动员，A4 一页 4 证）
 */
function printBadgesAll() {
  downloadBadgePdf({}, printingAll);
}

/**
 * 打印单个运动员参赛证
 */
const printingOne = ref(false);
function printBadgeOne(row) {
  downloadBadgePdf({ athlete_id: row.id }, printingOne);
}

/**
 * 确保全量名册已加载（球队报名的队员下拉依赖它）
 * 静默失败，不打断用户填写
 */
async function ensureRoster() {
  if (allRoster.value.length) return;
  await loadAllRoster();
}

async function openTeamCreate() {
  await ensureRoster();
  teamForm.id = null;
  teamForm.band_id = bands.value.length ? bands.value[0].id : null;
  teamForm.event_item_id = null;
  teamForm.team_name = '';
  teamForm.leader_name = '';
  teamForm.coach_name = '';
  teamForm.roster = [{ name: '', bib_no: '' }];
  teamForm.has_match = false;
  teamDialog.value = true;
}

/* ---------- 队员名单：从名册选择 ---------- */

/**
 * 当前行可选的名册队员
 * 已在本队其他行选过的，不再列出
 */
function memberOptions(current) {
  const taken = new Set(
    teamForm.roster
      .filter((x) => x !== current && x.name && String(x.name).trim())
      .map((x) => String(x.name).trim())
  );
  return allRoster.value
    .filter((a) => !taken.has(a.name))
    .map((a) => ({
      label: a.class_name ? `${a.name} · ${a.class_name}` : a.name,
      value: a.name
    }));
}

/**
 * 选中名册队员后自动带出号码（已有号码则不覆盖）
 */
function onPickMember(m, name) {
  if (!name) return;
  const a = allRoster.value.find((x) => x.name === name);
  if (a && a.bib_no && !m.bib_no) {
    m.bib_no = String(a.bib_no);
  }
}

function addMember() {
  teamForm.roster.push({ name: '', bib_no: '' });
}

function removeMember(i) {
  teamForm.roster.splice(i, 1);
}

async function openTeamEdit(row) {
  await ensureRoster();
  teamForm.id = row.id;
  teamForm.band_id = row.band_id;
  teamForm.event_item_id = row.event_item_id;
  teamForm.team_name = row.team_name;
  teamForm.leader_name = row.leader_name || '';
  teamForm.coach_name = row.coach_name || '';
  teamForm.has_match = !!row.has_match;
  // 兼容历史数据：老记录只有 { no, name }，号码从 no 里取
  teamForm.roster = parseRoster(row.roster_json).map((m) => ({
    name: m.name || '',
    bib_no: m.bib_no != null ? String(m.bib_no) : (m.no != null ? String(m.no) : '')
  }));
  teamDialog.value = true;
}

async function submitTeam() {
  if (!teamForm.band_id || !teamForm.event_item_id) {
    message.warning('请选择组别和项目');
    return;
  }
  if (!teamForm.team_name.trim()) {
    message.warning('请填写队名');
    return;
  }
  saving.value = true;
  try {
    const rosterPayload = teamForm.roster
      .filter((m) => m.name && String(m.name).trim())
      .map((m, i) => ({
        no: String(i + 1),
        name: String(m.name).trim(),
        bib_no: m.bib_no != null && String(m.bib_no).trim() !== ''
          ? String(m.bib_no).trim()
          : ''
      }));

    // 同队重名校验
    const names = rosterPayload.map((m) => m.name);
    const dupName = names.find((n, i) => names.indexOf(n) !== i);
    if (dupName) {
      message.warning(`队员「${dupName}」重复，请检查`);
      saving.value = false;
      return;
    }

    // 号码重复校验
    const bibs = rosterPayload.map((m) => m.bib_no).filter(Boolean);
    const dupBib = bibs.find((b, i) => bibs.indexOf(b) !== i);
    if (dupBib) {
      message.warning(`号码「${dupBib}」重复，请检查`);
      saving.value = false;
      return;
    }

    const payload = {
      competition_id: store.competitionId,
      band_id: teamForm.band_id,
      event_item_id: teamForm.event_item_id,
      team_name: teamForm.team_name.trim(),
      leader_name: teamForm.leader_name || null,
      coach_name: teamForm.coach_name || null,
      roster: rosterPayload
    };
    if (teamForm.id) {
      await http.put(`/entry/team/${teamForm.id}`, payload);
      message.success('已保存');
    } else {
      await http.post('/entry/team', payload);
      message.success('报名已提交，等待审核');
    }
    teamDialog.value = false;
    loadTeams();
  } catch (e) {
    message.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function removeTeam(row) {
  const ok = await confirm(`确定删除报名「${row.team_name}」？`, '删除确认', {
    confirmBtn: '确定删除',
    cancelBtn: '取消'
  })
    .then(() => true)
    .catch(() => false);
  if (!ok) return;
  try {
    await http.delete(`/entry/${row.id}`);
    message.success('已删除');
    loadTeams();
  } catch (e) {
    message.error(e.message);
  }
}

async function auditTeam(row, status) {
  try {
    await http.post('/entry/audit', { id: row.id, status });
    message.success(status === 2 ? '已通过' : '已驳回');
    loadTeams();
  } catch (e) {
    message.error(e.message);
  }
}

async function batchAudit(status) {
  if (selectedRows.value.length === 0) {
    message.warning('请先选择要审核的报名');
    return;
  }
  const ids = selectedRows.value.map((r) => r.id);
  try {
    await http.post('/entry/audit-batch', { ids, status });
    message.success(`已处理 ${ids.length} 条`);
    loadTeams();
  } catch (e) {
    message.error(e.message);
  }
}

async function auditAthlete(row, status) {
  try {
    await http.post('/entry/athlete-audit', { id: row.id, status });
    message.success(status === 2 ? '已通过' : '已驳回');
    loadAthletes();
  } catch (e) {
    message.error(e.message);
  }
}

function showRoster(row) {
  currentRoster.value = parseRoster(row.roster_json);
  rosterDialog.value = true;
}

function openAthleteCreate() {
  Object.assign(athleteForm, {
    id: null,
    name: '',
    gender: 1,
    class_name: '',
    grade: '',
    class_no: '',
    student_no: '',
    id_card: '',
    school_id: store.isAdmin && schools.value.length ? schools.value[0].id : (store.user?.school_id ?? null),
    photo: '',
    student_card: '',
    student_card_name: '',
    student_card_type: ''
  });
  athleteDialog.value = true;
}

/**
 * 打开修改对话框，回填已有资料
 * 列表接口不返回学籍表正文，需要单独取
 */
async function openAthleteEdit(row) {
  Object.assign(athleteForm, {
    id: row.id,
    name: row.name || '',
    gender: row.gender || 1,
    class_name: row.class_name || '',
    ...parseClassName(row.class_name),
    student_no: row.student_no || '',
    id_card: row.id_card || '',
    school_id: row.school_id || null,
    photo: row.photo || '',
    student_card: '',
    student_card_name: row.student_card_name || '',
    student_card_type: row.student_card_type || ''
  });
  athleteDialog.value = true;

  // 已有学籍表则懒加载正文，便于直接预览
  if (row.has_card) {
    try {
      const r = await http.get(`/entry/athletes/${row.id}/card`);
      athleteForm.student_card = r.data;
      athleteForm.student_card_type = r.file_type || '';
      athleteForm.student_card_name = r.file_name || row.student_card_name || '';
    } catch (e) {
      console.warn('学籍表加载失败', e.message);
    }
  }
}

async function submitAthlete() {
  if (!athleteForm.name.trim()) {
    message.warning('请填写姓名');
    return;
  }
  saving.value = true;
  try {
    syncClassName(); // 年级 + 班级 → class_name
    const payload = {
      name: athleteForm.name.trim(),
      gender: athleteForm.gender,
      class_name: athleteForm.class_name || null,
      student_no: athleteForm.student_no || null,
      id_card: String(athleteForm.id_card || '').trim().toUpperCase() || null,
      school_id: athleteForm.school_id || undefined,
      photo: athleteForm.photo || '',
      student_card: athleteForm.student_card || '',
      student_card_name: athleteForm.student_card_name || '',
      student_card_type: athleteForm.student_card_type || ''
    };

    if (athleteForm.id) {
      await http.put(`/entry/athletes/${athleteForm.id}`, payload);
      message.success('已保存');
    } else {
      await http.post('/entry/athletes', payload);
      message.success('已添加');
    }
    athleteDialog.value = false;
    loadRoster();
  } catch (e) {
    message.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function removeAthlete(row) {
  const ok = await confirm(`确定删除运动员「${row.name}」？其报项记录也会被清除。`, '删除确认', {
    confirmBtn: '确定删除',
    cancelBtn: '取消'
  })
    .then(() => true)
    .catch(() => false);
  if (!ok) return;
  try {
    await http.delete(`/entry/athletes/${row.id}`);
    message.success('已删除');
    loadRoster();
  } catch (e) {
    message.error(e.message);
  }
}

function openAthleteEntry() {
  entryForm.id = null;
  entryForm.band_id = bands.value.length ? bands.value[0].id : null;
  entryForm.event_item_id = null;
  entryForm.athlete_id = null;
  entryForm.has_heat = false;
  entryDialog.value = true;
}

function openEntryEdit(row) {
  entryForm.id = row.id;
  entryForm.band_id = row.band_id;
  entryForm.event_item_id = row.event_item_id;
  entryForm.athlete_id = row.athlete_id;
  entryForm.has_heat = !!row.has_heat;
  entryDialog.value = true;
}

async function submitEntry() {
  if (!entryForm.band_id || !entryForm.event_item_id || !entryForm.athlete_id) {
    message.warning('请选择组别、项目和运动员');
    return;
  }
  saving.value = true;
  try {
    if (entryForm.id) {
      await http.put(`/entry/athlete-entry/${entryForm.id}`, {
        band_id: entryForm.band_id,
        athlete_id: entryForm.athlete_id,
        event_item_id: entryForm.event_item_id
      });
      message.success('已保存');
    } else {
      await http.post('/entry/athlete', {
        competition_id: store.competitionId,
        band_id: entryForm.band_id,
        athlete_id: entryForm.athlete_id,
        event_item_id: entryForm.event_item_id
      });
      message.success('报项已提交');
    }
    entryDialog.value = false;
    loadAthletes();
  } catch (e) {
    message.error(e.message);
  } finally {
    saving.value = false;
  }
}

watch(activeTab, (v) => {
  if (v === 'teams') loadTeams();
  if (v === 'athletes') loadAthletes();
  if (v === 'progress') loadProgress();
  if (v === 'roster') loadRoster();
});

onMounted(() => {
  loadCompetitions();
  loadBase();
  loadTeams();
  loadSchools();
  // 全量名册提前加载：球队报名的队员下拉要用它
  loadAllRoster();
  loadRoster();
});
watch(() => store.competitionId, (v) => {
  compId.value = v;
  loadBase();
  loadTeams();
  loadAthletes();
  loadProgress();
  // 名册随赛事切换自动筛选
  loadRoster();
});
</script>

<style scoped>
.entry-tabs :deep(.t-tabs__header) {
  margin-bottom: 12px;
}

.tb-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.tb-hint {
  font-size: 12px;
  color: var(--app-text-3);
}

.idcard-wrap {
  width: 100%;
}

.idcard-birth {
  margin-top: 4px;
  font-size: 12px;
  color: var(--td-success-color, var(--app-success));
}

.class-row {
  display: flex;
  gap: 8px;
  width: 100%;
}

.class-grade,
.class-no {
  flex: 1;
  min-width: 0;
}

.class-tip {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--app-text-3);
}

.dim {
  font-size: 13px;
  color: var(--app-text-2);
}

.table-scroll {
  overflow-x: auto;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.stat-card {
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: 8px;
  padding: 12px 14px;
}

.stat-label {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--app-text-3);
}

.stat-value {
  margin: 0;
  font-size: 22px;
  font-weight: 500;
  color: var(--app-text-1);
  line-height: 1.1;
}

.stat-unit {
  font-size: 13px;
  font-weight: 400;
  color: var(--app-text-3);
  margin-left: 3px;
}

.roster-edit {
  width: 100%;
}

.roster-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

/* 队员序号 */
.roster-seq {
  flex-shrink: 0;
  width: 18px;
  text-align: center;
  font-size: 12px;
  color: var(--app-text-3);
  font-variant-numeric: tabular-nums;
}

/* 队员姓名下拉 */
.member-select {
  flex: 1;
  min-width: 0;
}

/* 号码输入框 */
.bib-input {
  flex-shrink: 0;
  width: 78px;
}

.roster-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 2px;
}

.roster-tip {
  margin: 0;
  font-size: 12px;
  color: var(--app-text-3);
  line-height: 1.5;
}

.roster-view {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.roster-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border: 1px solid var(--app-border);
  border-radius: 8px;
  background: var(--app-bg-2);
  font-size: 13px;
}

.roster-no {
  min-width: 26px;
  text-align: center;
  font-size: 12px;
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
  border-radius: 4px;
  padding: 1px 5px;
}

.roster-name {
  color: var(--app-text-1);
}

.empty {
  text-align: center;
  padding: 30px 0;
  color: var(--app-text-3);
  font-size: 13px;
}

@media (max-width: 768px) {
  .tb-hint {
    display: none;
  }
  .stat-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .stat-value {
    font-size: 20px;
  }
  .entry-tabs :deep(.t-tabs__nav-item) {
    font-size: 13px;
    padding: 0 10px;
  }
}

/* ---------- 照片 ---------- */
.photo-cell {
  width: 38px;
  height: 46px;
  margin: 0 auto;
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
  background: var(--app-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--app-border);
  transition: border-color 0.15s;
}

.photo-cell:hover {
  border-color: var(--td-brand-color);
}

.photo-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.photo-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--app-text-3);
  font-size: 14px;
  background: var(--app-bg-2);
}

.photo-upload-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.photo-preview {
  width: 88px;
  height: 112px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px dashed #dcdcdc;
  background: var(--app-bg-2);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: border-color 0.15s;
}

.photo-preview:hover {
  border-color: var(--td-brand-color);
}

.photo-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.photo-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  color: var(--app-text-3);
}

.pp-icon {
  font-size: 20px;
  line-height: 1;
  color: var(--app-text-3);
}

.pp-text {
  font-size: 11px;
}

.photo-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding-top: 2px;
}

.photo-tip {
  margin: 0;
  font-size: 11px;
  color: var(--app-text-3);
  line-height: 1.5;
}

.hidden-input {
  display: none;
}

.photo-big-wrap {
  text-align: center;
  background: var(--app-bg-2);
  border-radius: 6px;
  padding: 12px;
}

.photo-big {
  max-width: 100%;
  max-height: 60vh;
  border-radius: 4px;
  display: inline-block;
}

/* ---------- 学籍表 ---------- */
.card-upload-row {
  width: 100%;
}

.card-file {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--app-bg);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
}

.card-name {
  flex: 1;
  min-width: 0;
  color: var(--app-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-empty {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.card-tip {
  font-size: 11px;
  color: var(--app-text-3);
}

.card-loading {
  text-align: center;
  padding: 60px 0;
  color: var(--app-text-3);
  font-size: 13px;
}

.card-body {
  width: 100%;
  min-height: 300px;
  background: var(--app-bg-2);
  border-radius: 6px;
  padding: 8px;
  text-align: center;
}

.card-image {
  max-width: 100%;
  max-height: 68vh;
  display: inline-block;
  border-radius: 4px;
}

.card-frame {
  width: 100%;
  height: 68vh;
  border: none;
  border-radius: 4px;
  background: var(--app-surface);
}
</style>
