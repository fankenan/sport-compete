<template>
  <div>
    <t-tabs v-model="tab" class="tabs">
      <!-- 裁判库 -->
      <t-tab-panel value="referees" label="裁判库">
        <t-card :bordered="true">
          <template #header>
            <div class="panel-head">
              <span>裁判名录</span>
              <t-button theme="primary" size="small" @click="openReferee">新增裁判</t-button>
            </div>
          </template>

          <t-table
            :data="referees"
            :columns="refereeColumns"
            row-key="id"
            :loading="loading"
            :empty="'暂无数据'"
            hover
          >
            <template #level="{ row }">
              <t-tag v-if="row.level" size="small" variant="light">{{ row.level }}</t-tag>
              <span v-else class="muted">—</span>
            </template>
            <template #school_name="{ row }">{{ row.school_name || '—' }}</template>
            <template #phone="{ row }">{{ row.phone || '—' }}</template>
            <template #account="{ row }">
              <t-tag v-if="hasAccount(row.id)" theme="success" size="small" variant="light">已开通</t-tag>
              <t-button v-else size="small" variant="text" theme="primary" @click="createAccount(row)">开通</t-button>
            </template>
            <template #ops="{ row }">
              <t-button size="small" variant="text" theme="primary" @click="openReferee(row)">编辑</t-button>
              <t-button size="small" variant="text" theme="danger" @click="removeReferee(row)">停用</t-button>
            </template>
          </t-table>
        </t-card>
      </t-tab-panel>

      <!-- 场次指派 -->
      <t-tab-panel value="assign" label="场次指派">
        <t-card :bordered="true">
          <template #header>
            <div class="panel-head">
              <span>裁判指派</span>
              <div class="head-actions">
                <t-select v-model="batchReferee" placeholder="选择裁判" size="small" style="width: 150px" filterable>
                  <t-option v-for="r in referees" :key="r.id" :label="r.name" :value="r.id" />
                </t-select>
                <t-select v-model="batchDate" placeholder="全部日期" size="small" style="width: 140px" clearable>
                  <t-option v-for="d in dates" :key="d" :label="d" :value="d" />
                </t-select>
                <t-button theme="primary" size="small" :disabled="!batchReferee" @click="doBatchAssign">批量指派</t-button>
              </div>
            </div>
          </template>

          <t-table
            :data="assignments"
            :columns="assignColumns"
            row-key="id"
            :loading="loading"
            :empty="'暂无数据'"
            hover
          >
            <template #versus="{ row }">
              {{ row.team_a_name || '—' }} <span class="muted">对阵</span> {{ row.team_b_name || '—' }}
            </template>
            <template #time="{ row }">
              <span v-if="row.play_date">{{ row.play_date }} {{ (row.start_time || '').slice(0, 5) }}</span>
              <span v-else class="muted">未排期</span>
            </template>
            <template #referee_name="{ row }">{{ row.referee_name || '—' }}</template>
            <template #ops="{ row }">
              <t-button v-if="row.id" size="small" variant="text" theme="danger" @click="removeAssign(row)">取消</t-button>
              <span v-else class="muted">未指派</span>
            </template>
          </t-table>
        </t-card>
      </t-tab-panel>

      <!-- 组委会名单 -->
      <t-tab-panel value="committee" label="组委会名单">
        <t-card :bordered="true">
          <template #header>
            <div class="panel-head">
              <span>组委会与工作机构</span>
              <t-button theme="primary" size="small" @click="openCommittee">添加成员</t-button>
            </div>
          </template>

          <div v-for="cat in committeeCategories" :key="cat.value" class="cat-block">
            <p class="cat-title">{{ cat.label }}</p>
            <div class="member-grid">
              <div v-for="m in committeeByCat(cat.value)" :key="m.id" class="member-chip">
                <span class="member-name">{{ m.name }}</span>
                <span v-if="m.position" class="member-pos">{{ m.position }}</span>
                <t-button size="small" variant="text" theme="danger" @click="removeCommittee(m)">×</t-button>
              </div>
              <span v-if="committeeByCat(cat.value).length === 0" class="muted small">暂无</span>
            </div>
          </div>
        </t-card>
      </t-tab-panel>
    </t-tabs>

    <!-- 裁判编辑 -->
    <t-dialog
      v-model:visible="refereeVisible"
      :header="refereeForm.id ? '编辑裁判' : '新增裁判'"
      :width="isMobile ? '92%' : '440px'" attach="body">
      <t-form :data="refereeForm" label-width="80px" label-align="right">
        <t-form-item label="姓名" name="name" :rules="[{ required: true, message: '请填写裁判姓名' }]">
          <t-input v-model="refereeForm.name" placeholder="裁判姓名" />
        </t-form-item>
        <t-form-item label="级别" name="level">
          <t-select v-model="refereeForm.level" placeholder="选择级别" clearable style="width: 100%">
            <t-option label="国家级" value="国家级" />
            <t-option label="市级" value="市级" />
            <t-option label="县级" value="县级" />
          </t-select>
        </t-form-item>
        <t-form-item label="所属学校" name="school_id">
          <t-select v-model="refereeForm.school_id" placeholder="选择学校" clearable filterable style="width: 100%">
            <t-option v-for="s in schools" :key="s.id" :label="s.name" :value="s.id" />
          </t-select>
        </t-form-item>
        <t-form-item label="联系电话" name="phone">
          <t-input v-model="refereeForm.phone" placeholder="手机号" />
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button @click="refereeVisible = false">取消</t-button>
        <t-button theme="primary" @click="saveReferee">保存</t-button>
      </template>
    </t-dialog>

    <!-- 组委会成员 -->
    <t-dialog v-model:visible="committeeVisible" header="添加组委会成员" :width="isMobile ? '92%' : '420px'" attach="body">
      <t-form :data="committeeForm" label-width="90px" label-align="right">
        <t-form-item label="类别" name="category">
          <t-select v-model="committeeForm.category" style="width: 100%">
            <t-option v-for="c in committeeCategories" :key="c.value" :label="c.label" :value="c.value" />
          </t-select>
        </t-form-item>
        <t-form-item label="姓名" name="name" :rules="[{ required: true, message: '请填写姓名' }]">
          <t-input v-model="committeeForm.name" placeholder="姓名" />
        </t-form-item>
        <t-form-item label="职务" name="position">
          <t-input v-model="committeeForm.position" placeholder="如 体育局青少处处长" />
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button @click="committeeVisible = false">取消</t-button>
        <t-button theme="primary" @click="saveCommittee">保存</t-button>
      </template>
    </t-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { message, confirm, alert } from '../utils/ui';
import { useUserStore } from '../store/user';
import http from '../api/http';

const store = useUserStore();
const isMobile = ref(window.innerWidth <= 768);
const tab = ref('referees');

const referees = ref([]);
const schools = ref([]);
const assignments = ref([]);
const committee = ref([]);
const users = ref([]);
const dates = ref([]);

const loading = ref(false);
const refereeVisible = ref(false);
const refereeForm = ref({});
const committeeVisible = ref(false);
const committeeForm = ref({});
const batchReferee = ref(null);
const batchDate = ref('');

const refereeColumns = [
  { colKey: 'name', title: '姓名', width: 120 },
  { colKey: 'level', title: '级别', width: 100 },
  { colKey: 'school_name', title: '所属学校', minWidth: 160 },
  { colKey: 'phone', title: '联系电话', width: 130 },
  { colKey: 'account', title: '账号', width: 110 },
  { colKey: 'ops', title: '操作', width: 130, fixed: 'right' }
];

const assignColumns = [
  { colKey: 'seq_no', title: '场序', width: 70, align: 'center' },
  { colKey: 'event_name', title: '项目', width: 110 },
  { colKey: 'band_label', title: '组别', width: 100 },
  { colKey: 'versus', title: '对阵', minWidth: 200 },
  { colKey: 'time', title: '时间', width: 150 },
  { colKey: 'referee_name', title: '裁判', width: 100 },
  { colKey: 'ops', title: '操作', width: 100, fixed: 'right' }
];

const committeeCategories = [
  { value: '主任', label: '主任' },
  { value: '副主任', label: '副主任' },
  { value: '委员', label: '委员' },
  { value: '仲裁委员会', label: '仲裁委员会' },
  { value: '裁判委员会', label: '裁判委员会' },
  { value: '竞赛组', label: '竞赛组' },
  { value: '场地器材组', label: '场地器材组' },
  { value: '安全保障组', label: '安全保障组' },
  { value: '媒体宣传组', label: '媒体宣传组' }
];

const committeeByCat = (cat) => committee.value.filter((c) => c.category === cat);
const hasAccount = (refereeId) => users.value.some((u) => u.referee_id === refereeId);

async function loadReferees() {
  loading.value = true;
  try {
    referees.value = await http.get('/referee/list');
  } catch (e) {
    message.error(e.message);
  } finally {
    loading.value = false;
  }
}

async function loadSchools() {
  try {
    schools.value = await http.get('/school/list');
  } catch (e) { console.error(e); }
}

async function loadUsers() {
  try {
    users.value = await http.get('/school/users');
  } catch (e) { console.error(e); }
}

async function loadAssignments() {
  if (!store.competitionId) return;
  loading.value = true;
  try {
    assignments.value = await http.get('/referee/assign', { params: { competition_id: store.competitionId } });
    const set = new Set(assignments.value.map((a) => a.play_date).filter(Boolean));
    dates.value = [...set].sort();
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
}

async function loadCommittee() {
  if (!store.competitionId) return;
  try {
    committee.value = await http.get('/referee/committee', { params: { competition_id: store.competitionId } });
  } catch (e) { console.error(e); }
}

function openReferee(row) {
  refereeForm.value = row
    ? { ...row }
    : { name: '', level: '', school_id: null, phone: '' };
  refereeVisible.value = true;
}

async function saveReferee() {
  if (!refereeForm.value.name) {
    message.warning('请填写裁判姓名');
    return;
  }
  try {
    if (refereeForm.value.id) {
      await http.put(`/referee/${refereeForm.value.id}`, refereeForm.value);
    } else {
      await http.post('/referee', refereeForm.value);
    }
    message.success('已保存');
    refereeVisible.value = false;
    loadReferees();
  } catch (e) {
    message.error(e.message);
  }
}

async function removeReferee(row) {
  const ok = await confirm(`确定停用「${row.name}」？`, '提示')
    .then(() => true)
    .catch(() => false);
  if (!ok) return;
  try {
    await http.delete(`/referee/${row.id}`);
    message.success('已停用');
    loadReferees();
  } catch (e) {
    message.error(e.message);
  }
}

async function createAccount(row) {
  try {
    const r = await http.post('/referee/account', { referee_id: row.id, real_name: row.name });
    await alert(
      `账号：${r.username}\n初始密码：${r.password}\n\n请转告裁判本人，首次登录后修改密码。`,
      '账号已创建',
      { confirmBtn: '知道了' }
    );
    loadUsers();
  } catch (e) {
    message.error(e.message);
  }
}

async function doBatchAssign() {
  try {
    const r = await http.post('/referee/assign-batch', {
      competition_id: store.competitionId,
      referee_id: batchReferee.value,
      play_date: batchDate.value || undefined
    });
    message.success(`已指派 ${r.count} 场`);
    loadAssignments();
  } catch (e) {
    message.error(e.message);
  }
}

async function removeAssign(row) {
  try {
    await http.delete(`/referee/assign/${row.id}`);
    message.success('已取消');
    loadAssignments();
  } catch (e) {
    message.error(e.message);
  }
}

function openCommittee() {
  committeeForm.value = { category: '委员', name: '', position: '' };
  committeeVisible.value = true;
}

async function saveCommittee() {
  if (!committeeForm.value.name) {
    message.warning('请填写姓名');
    return;
  }
  try {
    await http.post('/referee/committee', {
      competition_id: store.competitionId,
      ...committeeForm.value
    });
    message.success('已添加');
    committeeVisible.value = false;
    loadCommittee();
  } catch (e) {
    message.error(e.message);
  }
}

async function removeCommittee(m) {
  try {
    await http.delete(`/referee/committee/${m.id}`);
    loadCommittee();
  } catch (e) {
    message.error(e.message);
  }
}

onMounted(() => { loadReferees(); loadSchools(); loadUsers(); loadAssignments(); loadCommittee(); });
watch(() => store.competitionId, () => { loadAssignments(); loadCommittee(); });
</script>

<style scoped>
.tabs {
  background: var(--app-surface);
  border-radius: 8px;
  padding: 0 14px 14px;
  border: 1px solid var(--app-border);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 500;
}

.head-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.cat-block {
  margin-bottom: 18px;
}

.cat-title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--app-text-2);
}

.member-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.member-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--app-bg);
  border-radius: 6px;
  padding: 4px 8px 4px 10px;
  font-size: 12px;
}

.member-name {
  color: var(--app-text-1);
}

.member-pos {
  color: var(--app-text-3);
  font-size: 11px;
}

.muted {
  color: var(--app-text-3);
}

.small {
  font-size: 12px;
}

@media (max-width: 768px) {
  .head-actions {
    width: 100%;
    margin-top: 8px;
  }
  .head-actions :deep(.t-select) {
    flex: 1;
    min-width: 100px;
  }
}
</style>
