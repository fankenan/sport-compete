<template>
  <div>
    <t-card :bordered="true">
      <t-tabs v-model="activeTab" class="school-tabs">
        <!-- 学校列表 -->
        <t-tab-panel value="schools" label="学校列表">
          <div class="tb-row">
            <t-button theme="primary" @click="openSchoolCreate">新增学校</t-button>
            <t-button @click="loadSchools">刷新</t-button>
            <span class="tb-hint">共 {{ schools.length }} 所学校</span>
          </div>

          <div class="table-scroll">
            <t-table
              :data="schools"
              :columns="schoolColumns"
              row-key="id"
              :loading="loadingSchools"
              :empty="'暂无数据'"
              hover
            >
              <template #stage="{ row }">
                <t-tag size="small" variant="light" :theme="stageType(row.stage)">
                  {{ stageLabel(row.stage) }}
                </t-tag>
              </template>
              <template #short_name="{ row }">
                <span class="dim">{{ row.short_name || '—' }}</span>
              </template>
              <template #principal="{ row }">
                <span class="dim">{{ row.principal || '—' }}</span>
              </template>
              <template #phone="{ row }">
                <span class="dim">{{ row.phone || '—' }}</span>
              </template>
              <template #ops="{ row }">
                <t-button variant="text" theme="primary" size="small" @click="openSchoolEdit(row)">编辑</t-button>
                <t-button variant="text" theme="primary" size="small" @click="openAccountCreate(row)">加账号</t-button>
                <t-button variant="text" theme="danger" size="small" @click="removeSchool(row)">删除</t-button>
              </template>
            </t-table>
          </div>
        </t-tab-panel>

        <!-- 账号列表 -->
        <t-tab-panel value="users" label="账号列表">
          <div class="tb-row">
            <t-button @click="loadUsers">刷新</t-button>
            <span class="tb-hint">停用后账号无法登录，重置密码会生成新的初始密码</span>
          </div>

          <div class="table-scroll">
            <t-table
              :data="users"
              :columns="userColumns"
              row-key="id"
              :loading="loadingUsers"
              :empty="'暂无数据'"
              hover
            >
              <template #role="{ row }">
                <t-tag size="small" variant="light" :theme="roleType(row.role)">{{ roleLabel(row.role) }}</t-tag>
              </template>
              <template #school_name="{ row }">
                <span class="dim">{{ row.school_name || '教育局' }}</span>
              </template>
              <template #is_active="{ row }">
                <t-tag :theme="row.is_active ? 'success' : 'default'" size="small" variant="light">
                  {{ row.is_active ? '启用' : '停用' }}
                </t-tag>
              </template>
              <template #last_login_at="{ row }">
                <span class="dim">{{ row.last_login_at ? formatTime(row.last_login_at) : '从未登录' }}</span>
              </template>
              <template #ops="{ row }">
                <t-button variant="text" theme="primary" size="small" @click="openUserEdit(row)">修改</t-button>
                <t-button variant="text" theme="danger" size="small" @click="removeUser(row)">删除</t-button>
                <t-button variant="text" theme="primary" size="small" @click="resetPassword(row)">重置密码</t-button>
                <t-button
                  variant="text"
                  :theme="row.is_active ? 'warning' : 'success'"
                  size="small"
                  @click="toggleStatus(row)"
                >
                  {{ row.is_active ? '停用' : '启用' }}
                </t-button>
              </template>
            </t-table>
          </div>
        </t-tab-panel>

        <!-- 组委会名单 -->
        <t-tab-panel value="committee" label="组委会名单">
          <div class="tb-row">
            <t-button theme="primary" @click="openCommitteeCreate">添加成员</t-button>
            <t-button @click="loadCommittee">刷新</t-button>
            <span class="tb-hint">用于秩序册与荣誉册</span>
          </div>

          <t-loading :loading="loadingCommittee" size="small">
            <div v-if="committeeGroups.length === 0" class="empty">尚未添加组委会成员</div>
            <div v-for="g in committeeGroups" :key="g.category" class="cm-group">
              <p class="cm-title">{{ g.category }}</p>
              <div class="cm-list">
                <div v-for="m in g.members" :key="m.id" class="cm-item">
                  <span class="cm-name">{{ m.name }}</span>
                  <span v-if="m.position" class="cm-pos">{{ m.position }}</span>
                  <t-button variant="text" theme="danger" size="small" @click="removeCommittee(m)">删除</t-button>
                </div>
              </div>
            </div>
          </t-loading>
        </t-tab-panel>
      </t-tabs>
    </t-card>

    <!-- 新建 / 编辑学校 -->
    <t-dialog
      v-model:visible="schoolDialog"
      :header="schoolForm.id ? '编辑学校' : '新增学校'"
      :width="isMobile ? '94%' : '480px'" attach="body">
      <t-form :data="schoolForm" label-width="88px" label-align="right">
        <t-form-item label="学校名称" name="name" :rules="[{ required: true, message: '请填写学校名称' }]">
          <t-input v-model="schoolForm.name" placeholder="如 城关第一小学" :maxlength="64" />
        </t-form-item>
        <t-form-item label="学段" name="stage" :rules="[{ required: true, message: '请选择学段' }]">
          <t-select v-model="schoolForm.stage" style="width: 100%">
            <t-option v-for="s in STAGE_LIST" :key="s.value" :label="s.label" :value="s.value" />
          </t-select>
        </t-form-item>
        <t-form-item label="简称" name="short_name">
          <t-input v-model="schoolForm.short_name" placeholder="秩序册用简称" :maxlength="32" />
        </t-form-item>
        <t-form-item label="负责人" name="principal">
          <t-input v-model="schoolForm.principal" placeholder="如 张三" :maxlength="32" />
        </t-form-item>
        <t-form-item label="联系电话" name="phone">
          <t-input v-model="schoolForm.phone" placeholder="选填" :maxlength="20" />
        </t-form-item>
        <t-form-item v-if="!schoolForm.id" label="创建账号" name="createAccount">
          <t-checkbox v-model="schoolForm.createAccount">同时创建学校端账号</t-checkbox>
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button @click="schoolDialog = false">取消</t-button>
        <t-button theme="primary" :loading="saving" @click="submitSchool">保存</t-button>
      </template>
    </t-dialog>

    <!-- 新建账号 -->
    <t-dialog
      v-model:visible="accountDialog"
      :header="`为「${accountForm.school_name || ''}」创建账号`"
      :width="isMobile ? '94%' : '440px'" attach="body">
      <t-form :data="accountForm" label-width="88px" label-align="right">
        <t-form-item label="所属学校" name="school_name">
          <t-input v-model="accountForm.school_name" disabled />
        </t-form-item>
        <t-form-item label="联系人" name="real_name" :rules="[{ required: true, message: '请填写联系人' }]">
          <t-input v-model="accountForm.real_name" placeholder="如 李四" :maxlength="32" />
        </t-form-item>
        <t-form-item label="登录账号" name="username">
          <t-input v-model="accountForm.username" placeholder="留空由系统生成" :maxlength="32" />
        </t-form-item>
        <t-form-item label="联系电话" name="phone">
          <t-input v-model="accountForm.phone" placeholder="选填" :maxlength="20" />
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button @click="accountDialog = false">取消</t-button>
        <t-button theme="primary" :loading="saving" @click="submitAccount">创建</t-button>
      </template>
    </t-dialog>

    <!-- 修改账号 -->
    <t-dialog
      v-model:visible="userEditDialog"
      header="修改账号"
      :width="isMobile ? '94%' : '440px'" attach="body">
      <t-form :data="userEditForm" label-width="88px" label-align="right">
        <t-form-item label="登录账号" name="username">
          <t-input v-model="userEditForm.username" placeholder="用于登录" :maxlength="32" />
        </t-form-item>
        <t-form-item label="姓名" name="real_name">
          <t-input v-model="userEditForm.real_name" placeholder="如 李四" :maxlength="32" />
        </t-form-item>
        <t-form-item label="角色" name="role">
          <t-select v-model="userEditForm.role" style="width: 100%" @change="onUserRoleChange">
            <t-option v-for="r in ROLE_LIST" :key="r.value" :label="r.label" :value="r.value" />
          </t-select>
        </t-form-item>
        <t-form-item v-if="userEditForm.role === 2" label="所属学校" name="school_id">
          <t-select v-model="userEditForm.school_id" style="width: 100%" filterable>
            <t-option v-for="s in schools" :key="s.id" :label="s.name" :value="s.id" />
          </t-select>
        </t-form-item>
        <t-form-item label="联系电话" name="phone">
          <t-input v-model="userEditForm.phone" placeholder="选填" :maxlength="20" />
        </t-form-item>
        <t-form-item label="状态" name="is_active">
          <t-tag :theme="userEditForm.is_active ? 'success' : 'default'" size="small" variant="light">
            {{ userEditForm.is_active ? '启用' : '停用' }}
          </t-tag>
          <span class="tb-hint" style="margin-left: 8px">启用/停用请在列表里操作</span>
        </t-form-item>
        <t-form-item label="最后登录" name="last_login_at">
          <span class="dim">{{ userEditForm.last_login_at ? formatTime(userEditForm.last_login_at) : '从未登录' }}</span>
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button @click="userEditDialog = false">取消</t-button>
        <t-button theme="primary" :loading="saving" @click="submitUserEdit">保存</t-button>
      </template>
    </t-dialog>

    <!-- 新增组委会成员 -->
    <t-dialog
      v-model:visible="committeeDialog"
      header="添加组委会成员"
      :width="isMobile ? '94%' : '440px'" attach="body">
      <t-form :data="committeeForm" label-width="88px" label-align="right">
        <t-form-item label="所属组别" name="category" :rules="[{ required: true, message: '请选择所属组别' }]">
          <t-select v-model="committeeForm.category" style="width: 100%">
            <t-option v-for="c in COMMITTEE_CATEGORIES" :key="c" :label="c" :value="c" />
          </t-select>
        </t-form-item>
        <t-form-item label="姓名" name="name" :rules="[{ required: true, message: '请填写姓名' }]">
          <t-input v-model="committeeForm.name" placeholder="如 王五" :maxlength="32" />
        </t-form-item>
        <t-form-item label="职务" name="position">
          <t-input v-model="committeeForm.position" placeholder="如 副主任" :maxlength="64" />
        </t-form-item>
        <t-form-item label="排序" name="sort_no">
          <t-input-number v-model="committeeForm.sort_no" theme="normal" :min="0" :max="999" :step="1" />
        </t-form-item>
      </t-form>
      <template #footer>
        <t-button @click="committeeDialog = false">取消</t-button>
        <t-button theme="primary" :loading="saving" @click="submitCommittee">添加</t-button>
      </template>
    </t-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue';
import { message, confirm, alert } from '../utils/ui';
import { useUserStore } from '../store/user';
import http from '../api/http';

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

const COMMITTEE_CATEGORIES = [
  '主任', '副主任', '委员', '仲裁委员会', '裁判委员会',
  '竞赛组', '场地器材组', '安全保障组', '媒体宣传组'
];

const ROLE_LIST = [
  { value: 1, label: '教育局' },
  { value: 2, label: '学校' },
  { value: 3, label: '裁判' }
];

const activeTab = ref('schools');

const schools = ref([]);
const users = ref([]);
const committee = ref([]);
const loadingSchools = ref(false);
const loadingUsers = ref(false);
const loadingCommittee = ref(false);
const saving = ref(false);

const schoolDialog = ref(false);
const accountDialog = ref(false);
const userEditDialog = ref(false);
const committeeDialog = ref(false);

const schoolColumns = [
  { colKey: 'name', title: '学校名称', minWidth: 170, ellipsis: true },
  { colKey: 'stage', title: '学段', width: 90, align: 'center' },
  { colKey: 'short_name', title: '简称', width: 100 },
  { colKey: 'principal', title: '负责人', width: 100 },
  { colKey: 'phone', title: '联系电话', width: 130 },
  { colKey: 'account_count', title: '账号数', width: 90, align: 'center' },
  { colKey: 'ops', title: '操作', width: 200, align: 'center', fixed: 'right' }
];

const userColumns = [
  { colKey: 'username', title: '账号', minWidth: 130 },
  { colKey: 'real_name', title: '姓名', minWidth: 110 },
  { colKey: 'role', title: '角色', width: 90, align: 'center' },
  { colKey: 'school_name', title: '所属学校', minWidth: 150 },
  { colKey: 'is_active', title: '状态', width: 90, align: 'center' },
  { colKey: 'last_login_at', title: '最后登录', minWidth: 150 },
  { colKey: 'ops', title: '操作', width: 260, align: 'center', fixed: 'right' }
];

const schoolForm = reactive({
  id: null,
  name: '',
  stage: 1,
  short_name: '',
  principal: '',
  phone: '',
  createAccount: true
});

const accountForm = reactive({
  school_id: null,
  school_name: '',
  real_name: '',
  username: '',
  phone: ''
});

const userEditForm = reactive({
  id: null,
  username: '',
  real_name: '',
  role: 2,
  school_id: null,
  phone: '',
  is_active: 1,
  last_login_at: null
});

const committeeForm = reactive({
  category: '主任',
  name: '',
  position: '',
  sort_no: 0
});

const committeeGroups = computed(() => {
  const map = new Map();
  committee.value.forEach((c) => {
    const key = c.category || '其他';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(c);
  });
  return [...map.entries()].map(([category, members]) => ({ category, members }));
});

function stageLabel(v) {
  return STAGE_LIST.find((s) => s.value === v)?.label || '未知';
}

function stageType(v) {
  return { 1: 'success', 2: 'primary', 3: 'warning' }[v] || 'default';
}

function roleLabel(v) {
  return { 1: '教育局', 2: '学校', 3: '裁判' }[v] || '未知';
}

function roleType(v) {
  return { 1: 'danger', 2: 'primary', 3: 'warning' }[v] || 'default';
}

function formatTime(v) {
  if (!v) return '';
  return String(v).replace('T', ' ').slice(0, 19);
}

async function loadSchools() {
  loadingSchools.value = true;
  try {
    schools.value = await http.get('/school/list');
  } catch (e) {
    message.error(e.message);
  } finally {
    loadingSchools.value = false;
  }
}

async function loadUsers() {
  loadingUsers.value = true;
  try {
    users.value = await http.get('/school/users');
  } catch (e) {
    message.error(e.message);
  } finally {
    loadingUsers.value = false;
  }
}

async function loadCommittee() {
  if (!store.competitionId) return;
  loadingCommittee.value = true;
  try {
    committee.value = await http.get('/referee/committee', {
      params: { competition_id: store.competitionId }
    });
  } catch (e) {
    message.error(e.message);
  } finally {
    loadingCommittee.value = false;
  }
}

function openSchoolCreate() {
  schoolForm.id = null;
  schoolForm.name = '';
  schoolForm.stage = 1;
  schoolForm.short_name = '';
  schoolForm.principal = '';
  schoolForm.phone = '';
  schoolForm.createAccount = true;
  schoolDialog.value = true;
}

function openSchoolEdit(row) {
  schoolForm.id = row.id;
  schoolForm.name = row.name;
  schoolForm.stage = row.stage ?? 1;
  schoolForm.short_name = row.short_name || '';
  schoolForm.principal = row.principal || '';
  schoolForm.phone = row.phone || '';
  schoolForm.createAccount = false;
  schoolDialog.value = true;
}

async function submitSchool() {
  if (!schoolForm.name || !schoolForm.name.trim()) {
    message.warning('请填写学校名称');
    return;
  }
  saving.value = true;
  try {
    if (schoolForm.id) {
      await http.put(`/school/${schoolForm.id}`, {
        name: schoolForm.name.trim(),
        stage: schoolForm.stage,
        short_name: schoolForm.short_name || null,
        principal: schoolForm.principal || null,
        phone: schoolForm.phone || null
      });
      message.success('已保存');
      schoolDialog.value = false;
    } else {
      const r = await http.post('/school', {
        name: schoolForm.name.trim(),
        stage: schoolForm.stage,
        short_name: schoolForm.short_name || null,
        principal: schoolForm.principal || null,
        phone: schoolForm.phone || null,
        createAccount: schoolForm.createAccount
      });
      message.success('学校已创建');
      schoolDialog.value = false;
      if (r?.account?.username) {
        await alert(
          `账号：${r.account.username}\n初始密码：${r.account.password}\n请及时转交学校并提醒修改密码。`,
          '账号创建成功',
          { confirmBtn: '我已记录', theme: 'success' }
        );
      }
    }
    loadSchools();
    loadUsers();
  } catch (e) {
    message.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function removeSchool(row) {
  const ok = await confirm(
    `确定删除学校「${row.name}」？该学校的账号会一并删除。`,
    '删除确认',
    { confirmBtn: '确定删除', cancelBtn: '取消' }
  )
    .then(() => true)
    .catch(() => false);
  if (!ok) return;
  try {
    await http.delete(`/school/${row.id}`);
    message.success('已删除');
    loadSchools();
    loadUsers();
  } catch (e) {
    message.error(e.message);
  }
}

function openAccountCreate(row) {
  accountForm.school_id = row.id;
  accountForm.school_name = row.name;
  accountForm.real_name = '';
  accountForm.username = '';
  accountForm.phone = '';
  accountDialog.value = true;
}

async function submitAccount() {
  if (!accountForm.real_name.trim()) {
    message.warning('请填写联系人');
    return;
  }
  saving.value = true;
  try {
    const r = await http.post('/school/account', {
      school_id: accountForm.school_id,
      real_name: accountForm.real_name.trim(),
      username: accountForm.username.trim() || undefined,
      phone: accountForm.phone || null
    });
    message.success('账号已创建');
    accountDialog.value = false;
    await alert(
      `账号：${r.username}\n初始密码：${r.password}\n请及时转交学校并提醒修改密码。`,
      '账号创建成功',
      { confirmBtn: '我已记录', theme: 'success' }
    );
    loadUsers();
    loadSchools();
  } catch (e) {
    message.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function resetPassword(row) {
  const ok = await confirm(
    `确定重置账号「${row.username}」的密码？原密码将立即失效。`,
    '重置密码',
    { confirmBtn: '确定重置', cancelBtn: '取消' }
  )
    .then(() => true)
    .catch(() => false);
  if (!ok) return;
  try {
    const r = await http.post('/school/reset-password', { user_id: row.id });
    await alert(
      `账号：${row.username}\n新密码：${r.password}\n请及时转交本人并提醒修改密码。`,
      '密码已重置',
      { confirmBtn: '我已记录', theme: 'success' }
    );
  } catch (e) {
    message.error(e.message);
  }
}

async function toggleStatus(row) {
  const next = row.is_active ? 0 : 1;
  try {
    await http.put('/school/user-status', { user_id: row.id, is_active: next });
    row.is_active = next;
    message.success(next ? '已启用' : '已停用');
  } catch (e) {
    message.error(e.message);
  }
}

/**
 * 打开修改账号对话框
 */
async function openUserEdit(row) {
  if (!schools.value.length) await loadSchools();
  Object.assign(userEditForm, {
    id: row.id,
    username: row.username || '',
    real_name: row.real_name || '',
    role: row.role ?? 2,
    school_id: row.school_id || null,
    phone: row.phone || '',
    is_active: row.is_active,
    last_login_at: row.last_login_at || null
  });
  userEditDialog.value = true;
}

/**
 * 角色切到非学校时清掉所属学校（后端也只给学校账号挂学校）
 */
function onUserRoleChange(v) {
  if (v !== 2) userEditForm.school_id = null;
}

async function submitUserEdit() {
  if (!userEditForm.username.trim()) {
    message.warning('请填写登录账号');
    return;
  }
  if (userEditForm.role === 2 && !userEditForm.school_id) {
    message.warning('学校账号请选择所属学校');
    return;
  }
  saving.value = true;
  try {
    await http.put(`/school/user/${userEditForm.id}`, {
      username: userEditForm.username.trim(),
      real_name: userEditForm.real_name.trim() || null,
      role: userEditForm.role,
      school_id: userEditForm.role === 2 ? userEditForm.school_id : null,
      phone: userEditForm.phone ? userEditForm.phone.trim() : null
    });
    message.success('已保存');
    userEditDialog.value = false;
    loadUsers();
  } catch (e) {
    message.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function removeUser(row) {
  const ok = await confirm(
    `确定删除账号「${row.username}」？删除后该账号无法登录。`,
    '删除账号',
    { confirmBtn: '确定删除', cancelBtn: '取消' }
  )
    .then(() => true)
    .catch(() => false);
  if (!ok) return;
  try {
    await http.delete(`/school/user/${row.id}`);
    message.success('已删除');
    loadUsers();
    loadSchools();
  } catch (e) {
    message.error(e.message);
  }
}

function openCommitteeCreate() {
  committeeForm.category = '主任';
  committeeForm.name = '';
  committeeForm.position = '';
  committeeForm.sort_no = committee.value.length + 1;
  committeeDialog.value = true;
}

async function submitCommittee() {
  if (!committeeForm.name.trim()) {
    message.warning('请填写姓名');
    return;
  }
  saving.value = true;
  try {
    await http.post('/referee/committee', {
      competition_id: store.competitionId,
      category: committeeForm.category,
      name: committeeForm.name.trim(),
      position: committeeForm.position || null,
      sort_no: committeeForm.sort_no
    });
    message.success('已添加');
    committeeDialog.value = false;
    loadCommittee();
  } catch (e) {
    message.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function removeCommittee(row) {
  const ok = await confirm(`确定删除「${row.name}」？`, '删除确认', {
    confirmBtn: '确定删除',
    cancelBtn: '取消'
  })
    .then(() => true)
    .catch(() => false);
  if (!ok) return;
  try {
    await http.delete(`/referee/committee/${row.id}`);
    message.success('已删除');
    loadCommittee();
  } catch (e) {
    message.error(e.message);
  }
}

onMounted(() => {
  loadSchools();
  loadUsers();
  loadCommittee();
});
watch(() => store.competitionId, loadCommittee);
</script>

<style scoped>
.school-tabs :deep(.t-tabs__header) {
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

.dim {
  font-size: 13px;
  color: var(--app-text-2);
}

.table-scroll {
  overflow-x: auto;
}

.empty {
  text-align: center;
  padding: 40px 0;
  color: var(--app-text-3);
  font-size: 13px;
}

.cm-group {
  margin-bottom: 14px;
}

.cm-title {
  margin: 0 0 8px;
  padding-left: 9px;
  border-left: 3px solid var(--td-brand-color);
  font-size: 14px;
  font-weight: 500;
  color: var(--app-text-1);
}

.cm-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.cm-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--app-border);
  border-radius: 8px;
  background: var(--app-bg-2);
  font-size: 13px;
}

.cm-name {
  color: var(--app-text-1);
}

.cm-pos {
  font-size: 11px;
  color: var(--app-text-3);
  background: var(--app-bg);
  padding: 1px 6px;
  border-radius: 3px;
}

@media (max-width: 768px) {
  .tb-hint {
    display: none;
  }
  .school-tabs :deep(.t-tabs__nav-item) {
    font-size: 13px;
    padding: 0 10px;
  }
}
</style>
