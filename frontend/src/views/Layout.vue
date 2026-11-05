<template>
  <div class="app-shell">
    <!-- PC 侧边栏 -->
    <aside class="sidebar" v-if="!isMobile">
      <div class="brand">
        <img class="brand-mark" src="/logo-a-trophy.svg" alt="体育竞赛管理" />
        <div class="brand-text">
          <p class="brand-title">体育竞赛管理</p>
          <p class="brand-sub">{{ store.roleName }}端</p>
        </div>
      </div>

      <nav class="nav">
        <template v-for="sec in menuSections" :key="sec.name">
          <p v-if="showGroupTitles" class="nav-group">{{ sec.name }}</p>
          <router-link
            v-for="item in sec.items"
            :key="item.path"
            :to="item.path"
            class="nav-item"
            :class="{ active: route.path === item.path }"
          >
            <t-icon :name="item.icon || 'app'" size="17px" class="nav-ic" />
            <span>{{ item.label }}</span>
          </router-link>
        </template>
      </nav>

      <div class="sidebar-footer">
        <p class="comp-label">当前赛事</p>
        <p class="comp-name">{{ competitionName || '未选择' }}</p>
      </div>
    </aside>

    <!-- 主内容区 -->
    <div class="main-wrap">
      <header class="topbar" v-if="!isMobile">
        <div class="crumb">
          <span class="crumb-sec">{{ currentSection }}</span>
          <t-icon name="chevron-right" size="12px" class="crumb-sep" />
          <h1 class="page-title">{{ route.meta.title || '' }}</h1>
        </div>

        <div class="topbar-right">
          <button
            type="button"
            class="theme-btn"
            :title="isDark ? '切换到亮色' : '切换到暗色'"
            @click="toggleTheme"
          >
            <t-icon :name="isDark ? 'sunny' : 'moon'" size="18px" />
          </button>
          <t-select
            v-if="store.isAdmin && competitions.length"
            v-model="compId"
            placeholder="选择赛事"
            size="small"
            style="width: 280px"
            :options="compOptions"
            @change="onCompChange"
          />
          <t-dropdown :options="userMenu" trigger="click" @click="onCommand">
            <div class="user-chip">
              <t-avatar size="28px" :style="{ background: 'var(--td-brand-color)' }">
                {{ (store.user?.real_name || '?').slice(0, 1) }}
              </t-avatar>
              <span class="user-name">{{ store.user?.real_name }}</span>
              <t-icon name="chevron-down" size="14px" style="color: var(--app-text-3)" />
            </div>
          </t-dropdown>
        </div>
      </header>

      <!-- 手机顶栏 -->
      <header class="mobile-header" v-else>
        <div class="mh-left">
          <span class="mh-title">{{ route.meta.title || '体育竞赛' }}</span>
          <button
            v-if="store.isAdmin && competitions.length"
            type="button"
            class="mh-comp"
            :class="{ 'is-static': competitions.length <= 1 }"
            :disabled="competitions.length <= 1"
            @click="compPickerVisible = true"
          >
            <span class="mh-comp-name">{{ competitionName || '未选择赛事' }}</span>
            <t-icon v-if="competitions.length > 1" name="chevron-down" size="12px" />
          </button>
        </div>
        <t-dropdown :options="userMenu" trigger="click" @click="onCommand">
          <t-avatar size="26px" :style="{ background: 'var(--td-brand-color)' }">
            {{ (store.user?.real_name || '?').slice(0, 1) }}
          </t-avatar>
        </t-dropdown>
      </header>

      <!-- 赛事选择弹层（仅手机端，底部抽屉） -->
      <t-drawer
        v-if="isMobile"
        v-model:visible="compPickerVisible"
        placement="bottom"
        :size="pickerHeight"
        :header="false"
        :footer="false"
        :close-btn="false"
        class="comp-drawer" attach="body">
        <div class="comp-picker">
          <div class="cp-head">
            <span>选择赛事</span>
            <t-button variant="text" size="small" @click="compPickerVisible = false">关闭</t-button>
          </div>
          <div class="cp-list">
            <div
              v-for="c in competitions"
              :key="c.id"
              class="cp-item"
              :class="{ active: c.id === compId }"
              @click="pickComp(c)"
            >
              <div class="cp-main">
                <p class="cp-name">{{ c.name }}</p>
                <p class="cp-meta">{{ c.year }} 年</p>
              </div>
              <t-icon v-if="c.id === compId" name="check" size="16px" />
            </div>
          </div>
        </div>
      </t-drawer>

      <main class="content">
        <div class="content-inner">
          <!--
            【重要修复 · 二次】原来这里是：
              <transition name="fade-slide" mode="out-in">
                <keep-alive><component :is="Component" /></keep-alive>
              </transition>
            keep-alive + mode="out-in" 组合会死锁：组件被缓存后 leave 钩子
            无法正常结束，transition 永远卡在 leave 状态 ——
            结果是**后台切菜单时页面内容不跟着变**（只有顶栏标题变）。

            去掉 keep-alive 后又出现第二个问题：transition 默认是 in-out 模式，
            旧组件的 leave 与新组件的 enter 同时进行，两者会在页面上**重叠共存**；
            加上全局 `.content > * { animation: rise-in }` 又给包裹层叠了一层动画，
            结果 leave 迟迟不结束，两个页面叠在一起。

            现在不再用 transition，改由 styles.css 的 `.content-inner > *`
            提供入场动画（rise-in）。单一动画来源，没有重叠，也没有死锁。
          -->
          <router-view v-slot="{ Component }">
            <component :is="Component" :key="route.fullPath" />
          </router-view>
        </div>
      </main>

      <!-- 修改密码 -->
      <t-dialog
        v-model:visible="pwdVisible"
        header="修改密码"
        :width="isMobile ? '92%' : '420px'"
        attach="body"
        :confirm-btn="{ content: '确认修改', loading: pwdSaving }"
        @confirm="doChangePassword">
        <t-form :data="pwdForm" layout="vertical">
          <t-form-item label="原密码" required-mark>
            <t-input v-model="pwdForm.oldPassword" type="password" placeholder="请输入原密码" />
          </t-form-item>
          <t-form-item label="新密码" required-mark>
            <t-input v-model="pwdForm.newPassword" type="password" placeholder="至少 6 位" />
          </t-form-item>
          <t-form-item label="确认新密码" required-mark>
            <t-input v-model="pwdForm.confirm" type="password" placeholder="再次输入新密码" />
          </t-form-item>
        </t-form>
      </t-dialog>

      <!-- 手机底部导航 -->
      <nav class="tabbar" v-if="isMobile">
        <template v-for="item in mobileMenu" :key="item.path">
          <button
            v-if="item.path === '__more__'"
            type="button"
            class="tab-item"
            :class="{ active: moreVisible }"
            @click="openMore"
          >
            <t-icon :name="item.icon || 'app'" size="20px" class="tab-ic" />
            <span class="tab-label">{{ item.label }}</span>
          </button>
          <router-link
            v-else
            :to="item.path"
            class="tab-item"
            :class="{ active: route.path === item.path }"
          >
            <t-icon :name="item.icon || 'app'" size="20px" class="tab-ic" />
            <span class="tab-label">{{ item.label }}</span>
          </router-link>
        </template>
      </nav>

      <!-- 手机「更多」菜单：全量分组入口 -->
      <t-drawer
        v-model:visible="moreVisible"
        placement="bottom"
        :size="'72vh'"
        :header="false"
        :footer="false"
        :close-btn="false"
        class="more-drawer"
        attach="body">
        <div class="more-sheet">
          <div class="ms-head">
            <span class="ms-title">全部功能</span>
            <t-button variant="text" size="small" @click="moreVisible = false">关闭</t-button>
          </div>
          <div class="ms-tabs">
            <button
              v-for="s in moreSections"
              :key="s.name"
              type="button"
              class="ms-tab"
              :class="{ on: moreCurrentSection === s.name }"
              @click="moreCurrentSection = s.name"
            >{{ s.name }}</button>
          </div>
          <div class="ms-list">
            <button
              v-for="it in (moreSections.find(s => s.name === moreCurrentSection)?.items || [])"
              :key="it.path"
              type="button"
              class="ms-item"
              :class="{ on: route.path === it.path }"
              @click="onMorePick(it.path)"
            >
              <t-icon :name="it.icon || 'app'" size="18px" />
              <span>{{ it.label }}</span>
              <t-icon name="chevron-right" size="16px" class="ms-arrow" />
            </button>
          </div>
        </div>
      </t-drawer>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { MessagePlugin } from 'tdesign-vue-next';
import { useUserStore } from '../store/user';
import http from '../api/http';

const route = useRoute();
const router = useRouter();
const store = useUserStore();

const isMobile = ref(window.innerWidth <= 768);
const competitions = ref([]);
const compId = ref(store.competitionId);
const competitionName = ref('');
const compPickerVisible = ref(false);

/**
 * 左侧导航菜单
 *
 * 分组顺序按「赛事全流程」排：
 *   总览 → 赛事组织（赛前准备）→ 球类项目 → 田径项目 → 赛事发布 → 个人
 *
 * 组内顺序也按实际操作先后：
 *   赛事组织：建赛事 → 定项目场地 → 发账号 → 报名 → 排裁判
 *   球类项目：分组 → 赛程 → 赛中看积分榜 → 出最终名次
 *   田径项目：配置(田径中心) → 排期(日程与秩序册) → 现场(赛中控台) → 录分 → 统计
 *
 * mobile: true 的项会进入手机底部导航，取前 4 个。
 */
const ALL_MENU = [
  // —— 总览 ——
  { path: '/dashboard', label: '赛事总览', icon: 'dashboard', roles: null, mobile: true, section: '总览' },
  { path: '/arrange-center', label: '编排中心', icon: 'route', roles: [1], mobile: true, section: '总览' },

  // —— 赛事组织（赛前准备，球类与田径共用）——
  { path: '/competition', label: '赛事管理', icon: 'flag', roles: [1], section: '赛事组织' },
  { path: '/event-setup', label: '项目与场地', icon: 'app', roles: [1], section: '赛事组织' },
  { path: '/schools', label: '学校与账号', icon: 'usergroup', roles: [1], section: '赛事组织' },
  { path: '/entry', label: '报名管理', icon: 'edit', roles: [1, 2], mobile: true, section: '赛事组织' },
  { path: '/referee', label: '裁判管理', icon: 'user-circle', roles: [1], section: '赛事组织' },

  // —— 体育活动（常态化工作，与具体赛事无关）——
  { path: '/sport-activity', label: '学校体育活动', icon: 'heart', roles: [1, 2], mobile: true, section: '体育活动' },

  // —— 球类项目（循环赛 / 淘汰赛）——
  { path: '/grouping', label: '分组编排', icon: 'view-list', roles: [1], section: '球类项目' },
  { path: '/lineup', label: '对阵表', icon: 'bullet-point', roles: [1], mobile: true, section: '球类项目' },
  { path: '/schedule', label: '赛程编排', icon: 'time', roles: [1], mobile: true, section: '球类项目' },
  { path: '/bracket-play', label: '对阵树', icon: 'chart-bubble', roles: [1, 3], section: '球类项目' },
  { path: '/score-entry', label: '成绩录入', icon: 'edit-1', roles: [1], mobile: true, section: '球类项目' },
  // 积分榜 / 名次表 对裁判(3)与学校(2)同样开放：现场查分、赛后核对都需要，
  // 且移动端底部导航早就给了裁判这两个入口，桌面端原先缺，属权限标注遗漏。
  { path: '/standing', label: '积分榜', icon: 'chart-line', roles: [1, 2, 3], mobile: true, section: '球类项目' },
  { path: '/rank', label: '名次表', icon: 'data', roles: [1, 2, 3], section: '球类项目' },

  // —— 田径项目（径赛 / 田赛 / 全能）——
  { path: '/track', label: '田径中心', icon: 'rocket', roles: [1], section: '田径项目' },
  { path: '/track-arrange', label: '分组编排', icon: 'view-list', roles: [1], mobile: true, section: '田径项目' },
  { path: '/track-plan', label: '日程与秩序册', icon: 'calendar', roles: [1], section: '田径项目' },
  { path: '/track-race', label: '赛中控台', icon: 'control-platform', roles: [1], mobile: true, section: '田径项目' },
  { path: '/track-result', label: '成绩录入', icon: 'check-circle', roles: [1], mobile: true, section: '田径项目' },
  { path: '/track-stats', label: '赛后统计', icon: 'chart-bar', roles: [1], mobile: true, section: '田径项目' },

  // —— 武术项目（评分制 / 名次制） ——
  { path: '/martial', label: '武术编排与评分', icon: 'star', roles: [1], mobile: true, section: '武术项目' },

  // —— 赛事发布 ——
  { path: '/screen-control', label: '大屏控制端', icon: 'precise-monitor', roles: [1], section: '赛事发布' },

  // —— 个人 ——
  { path: '/my-schedule', label: '我的赛程', icon: 'star', roles: [3], mobile: true, section: '个人' }
];

const SECTION_ORDER = ['总览', '赛事组织', '体育活动', '球类项目', '田径项目', '武术项目', '赛事发布', '个人'];

const visibleMenu = computed(() =>
  ALL_MENU.filter((i) => !i.roles || i.roles.includes(store.role))
);

/** 当前页所在菜单分组（顶栏面包屑用） */
const currentSection = computed(() => {
  const item = ALL_MENU.find((i) => i.path === route.path);
  return item?.section || '';
});

// 按 SECTION_ORDER 分组；某角色看不到任何项的分组整组不显示
const menuSections = computed(() =>
  SECTION_ORDER
    .map((name) => ({ name, items: visibleMenu.value.filter((i) => i.section === name) }))
    .filter((s) => s.items.length > 0)
);

// 学校 / 裁判端只有三五项，再套分组标题反而啰嗦，直接平铺
const showGroupTitles = computed(() => visibleMenu.value.length >= 6);

/**
 * 手机端底部导航
 *
 * 原来只取前 4 个 mobile 项，导致管理员在手机上：
 *   进不去田径全流程（田径中心/日程与秩序册/赛中控台/成绩录入/赛后统计）、
 *   分组编排、学校与账号、裁判管理、大屏控制端、名次表……
 * 而登录页偏偏写着「手机现场也能录」。
 * 现在固定 4 个主项 + 1 个「更多」，「更多」里是全量分组菜单。
 */
const mobileMenu = computed(() => {
  if (store.role === 3) {
    return [
      { path: '/my-schedule', label: '赛程', icon: 'star' },
      { path: '/standing', label: '积分', icon: 'chart-line' },
      { path: '/rank', label: '名次', icon: 'data' },
      { path: '__more__', label: '更多', icon: 'more' }
    ];
  }
  const main = visibleMenu.value.filter((i) => i.mobile).slice(0, 4);
  return [...main, { path: '__more__', label: '更多', icon: 'more' }];
});

/** 「更多」抽屉 */
const moreVisible = ref(false);

function openMore() {
  moreVisible.value = true;
}

function onMorePick(path) {
  moreVisible.value = false;
  if (path && path !== '__more__') router.push(path);
}

/** 当前在「更多」里选中的分组 */
const moreTab = ref('总览');
const moreSections = computed(() => menuSections.value);
const moreCurrentSection = ref('总览');

/* ---------- 主题切换 ---------- */
const isDark = ref(document.documentElement.getAttribute('theme-mode') === 'dark');

function toggleTheme() {
  isDark.value = !isDark.value;
  if (isDark.value) {
    document.documentElement.setAttribute('theme-mode', 'dark');
  } else {
    document.documentElement.removeAttribute('theme-mode');
  }
  try {
    localStorage.setItem('app-theme', isDark.value ? 'dark' : 'light');
  } catch (e) { /* 忽略隐私模式 */ }
}

const compOptions = computed(() =>
  competitions.value.map((c) => ({ label: `${c.name}（${c.year}）`, value: c.id }))
);

// 抽屉高度 = 头部 + 每个赛事一行 + 底部留白，最多占屏幕 62%
const pickerHeight = computed(() => {
  const rows = Math.max(competitions.value.length, 1);
  const h = 48 + rows * 62 + 24;
  const max = Math.round((window.innerHeight || 640) * 0.62);
  return `${Math.min(h, max)}px`;
});

const userMenu = [
  { content: '修改密码', value: 'password' },
  { content: '退出登录', value: 'logout', divider: true }
];

async function loadCompetitions() {
  if (!store.isAdmin) return;
  try {
    const list = await http.get('/competition/list');
    competitions.value = (list || []).map((c) => ({ ...c, id: Number(c.id) }));

    if (competitions.value.length === 0) {
      compId.value = null;
      store.setCompetition(null);
      competitionName.value = '';
      return;
    }

    const exists = competitions.value.some((c) => c.id === Number(compId.value));
    if (!exists) {
      const first = competitions.value[0];
      compId.value = first.id;
      store.setCompetition(first.id);
      competitionName.value = first.name;
      return;
    }

    compId.value = Number(compId.value);
    const cur = competitions.value.find((c) => c.id === compId.value);
    competitionName.value = cur?.name || '';
  } catch (e) {
    console.error('[加载赛事列表失败]', e);
  }
}

function onCompChange(id) {
  const numId = Number(id);
  store.setCompetition(numId);
  compId.value = numId;
  const cur = competitions.value.find((c) => c.id === numId);
  competitionName.value = cur?.name || '';
}

/** 手机端选中赛事 */
function pickComp(c) {
  onCompChange(c.id);
  compPickerVisible.value = false;
}

function onCommand(item) {
  if (item?.value === 'logout') {
    store.logout();
    router.push('/login');
  } else if (item?.value === 'password') {
    // 原来这里 router.push('/password')，但路由表里没有这条路由，
    // 会被 catch-all 吞掉重定向回 /dashboard —— 表现为「点了没反应」。
    pwdForm.value.oldPassword = '';
    pwdForm.value.newPassword = '';
    pwdForm.value.confirm = '';
    pwdVisible.value = true;
  }
}

/* ---------- 修改密码 ---------- */
const pwdVisible = ref(false);
const pwdSaving = ref(false);
const pwdForm = ref({ oldPassword: '', newPassword: '', confirm: '' });

async function doChangePassword() {
  const { oldPassword, newPassword, confirm } = pwdForm.value;
  if (!oldPassword || !newPassword) {
    MessagePlugin.warning('请填写完整');
    return;
  }
  if (newPassword.length < 6) {
    MessagePlugin.warning('新密码至少 6 位');
    return;
  }
  if (newPassword !== confirm) {
    MessagePlugin.warning('两次输入的新密码不一致');
    return;
  }
  pwdSaving.value = true;
  try {
    await http.post('/auth/change-password', { oldPassword, newPassword });
    MessagePlugin.success('密码已修改');
    pwdVisible.value = false;
  } catch (e) {
    MessagePlugin.error(e.message || '修改失败');
  } finally {
    pwdSaving.value = false;
  }
}

function onResize() {
  isMobile.value = window.innerWidth <= 768;
}

onMounted(() => {
  window.addEventListener('resize', onResize);
  loadCompetitions();
});

watch(() => store.competitionId, (v) => { compId.value = v; });
</script>

<style scoped>
.app-shell {
  display: flex;
  min-height: 100vh;
  background: var(--app-bg);
}

/* ---------- 侧边栏 ---------- */
.sidebar {
  width: 216px;
  flex-shrink: 0;
  background: var(--app-sidebar-bg);
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 16px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.brand-mark {
  width: 34px;
  height: 34px;
  display: block;
  flex-shrink: 0;
  border-radius: var(--radius-m);
  box-shadow: 0 2px 8px rgba(0, 82, 217, 0.4);
}

.brand-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  line-height: 1.3;
  letter-spacing: 0.5px;
}

.brand-sub {
  margin: 2px 0 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.42);
}

.nav {
  flex: 1;
  padding: 14px 10px;
  overflow-y: auto;
}

.nav-group {
  margin: 12px 0 4px;
  padding: 11px 0 0 11px;
  font-size: 10.5px;
  color: rgba(255, 255, 255, 0.3);
  letter-spacing: 1.2px;
  font-weight: 500;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}

.nav-group:first-child {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius-m);
  color: rgba(255, 255, 255, 0.68);
  text-decoration: none;
  font-size: 14px;
  margin-bottom: 1px;
  transition: background var(--dur-fast) ease, color var(--dur-fast) ease;
}

.nav-ic {
  opacity: 0.75;
  flex-shrink: 0;
  transition: opacity var(--dur-fast) ease;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.07);
  color: #fff;
}

.nav-item:hover .nav-ic {
  opacity: 1;
}

.nav-item.active {
  background: rgba(59, 130, 246, 0.16);
  box-shadow: inset 0 0 0 1px rgba(96, 165, 250, 0.22);
  color: #fff;
  font-weight: 600;
}

.nav-item.active::before {
  content: "";
  position: absolute;
  left: -10px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 18px;
  border-radius: 2px;
  background: #60a5fa;
}

.nav-item.active .nav-ic {
  opacity: 1;
  color: #93b4fb;
}

.sidebar-footer {
  padding: 12px 16px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}

.comp-label {
  margin: 0 0 3px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.32);
}

.comp-name {
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.72);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---------- 主区 ---------- */
.main-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.topbar {
  height: 56px;
  background: var(--app-surface);
  border-bottom: 1px solid var(--app-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  position: sticky;
  top: 0;
  z-index: 100;
}

.page-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--app-text-1);
  letter-spacing: 0.2px;
}

/* 顶栏面包屑：任何时候都知道自己在哪 */
.crumb {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.crumb-sec {
  font-size: 12.5px;
  color: var(--app-text-3);
  white-space: nowrap;
}

.crumb-sep {
  color: var(--app-text-3);
  opacity: 0.6;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.theme-btn {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-m);
  border: none;
  background: transparent;
  color: var(--app-text-2);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--dur-fast) ease, color var(--dur-fast) ease;
}

.theme-btn:hover {
  background: var(--app-bg-2);
  color: var(--td-brand-color);
}

.user-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  outline: none;
  padding: 3px 6px;
  border-radius: var(--radius-m);
  transition: background var(--dur-fast) ease;
}

.user-chip:hover {
  background: var(--app-bg-2);
}

.user-name {
  font-size: 13px;
  color: var(--app-text-1);
}

.content {
  flex: 1;
  padding: 20px 24px 28px;
  min-width: 0;
}

/* 内容区最大宽度：1920 宽屏上不让表格无限拉伸，显松散 */
.content-inner {
  max-width: 1440px;
  margin: 0 auto;
}

/* ---------- 手机 ---------- */
.mobile-header {
  min-height: 52px;
  background: var(--app-sidebar-bg);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 14px;
  position: sticky;
  top: 0;
  z-index: 100;
}

.mh-left {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}

.mh-title {
  font-size: 15px;
  font-weight: 500;
  line-height: 1.3;
}

.mh-comp {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
  color: rgba(255, 255, 255, 0.62);
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  max-width: 100%;
  font-family: inherit;
  text-align: left;
}

.mh-comp:active {
  opacity: 0.7;
}

.mh-comp.is-static {
  cursor: default;
}

.mh-comp.is-static:active {
  opacity: 1;
}

.mh-comp-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 手机端赛事选择抽屉 */
.comp-picker {
  background: var(--app-surface);
  border-radius: 12px 12px 0 0;
  padding: 4px 0 calc(8px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  height: 100%;
  box-sizing: border-box;
}

.cp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 10px;
  font-size: 15px;
  font-weight: 500;
  color: var(--app-text-1);
  border-bottom: 1px solid var(--app-border-2);
  flex-shrink: 0;
}

.cp-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 8px;
  -webkit-overflow-scrolling: touch;
}

.cp-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.cp-item:active {
  background: var(--app-bg-2);
}

.cp-item.active {
  background: var(--td-brand-color-light);
  color: var(--td-brand-color);
}

.cp-main {
  flex: 1;
  min-width: 0;
}

.cp-name {
  margin: 0;
  font-size: 14px;
  line-height: 1.45;
  color: var(--app-text-1);
  word-break: break-all;
}

.cp-item.active .cp-name {
  color: var(--td-brand-color);
  font-weight: 500;
}

.cp-meta {
  margin: 3px 0 0;
  font-size: 11px;
  color: var(--app-text-3);
}

.tabbar {
  display: flex;
  background: var(--app-surface);
  border-top: 1px solid var(--app-border);
  padding-bottom: env(safe-area-inset-bottom);
  position: sticky;
  bottom: 0;
  z-index: 100;
}

.tab-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 8px 0 7px;
  text-decoration: none;
  color: var(--app-text-3);
  font-size: 11px;
  transition: color var(--dur-fast) ease;
  background: none;
  border: none;
  font-family: inherit;
  cursor: pointer;
}

.tab-item.active {
  color: var(--td-brand-color);
  font-weight: 500;
}

.tab-ic {
  opacity: 0.75;
  transition: opacity var(--dur-fast) ease, transform var(--dur-fast) var(--ease-out);
}

.tab-item.active .tab-ic {
  opacity: 1;
  transform: translateY(-1px);
}

/* ---------- 手机「更多」菜单 ---------- */
.more-sheet {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.ms-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--app-border);
}
.ms-title { font-size: 15px; font-weight: 600; color: var(--app-text-1); }

.ms-tabs {
  display: flex;
  gap: 6px;
  padding: 10px 16px;
  overflow-x: auto;
  scrollbar-width: none;
  flex-shrink: 0;
}
.ms-tabs::-webkit-scrollbar { display: none; }

.ms-tab {
  flex-shrink: 0;
  font: inherit;
  font-size: 12.5px;
  padding: 5px 12px;
  border-radius: var(--radius-full);
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  color: var(--app-text-2);
  cursor: pointer;
  transition: all var(--dur-fast) ease;
}
.ms-tab.on {
  background: var(--td-brand-color);
  border-color: var(--td-brand-color);
  color: #fff;
}

.ms-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px 20px;
  -webkit-overflow-scrolling: touch;
}

.ms-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 13px 14px;
  border-radius: var(--radius-m);
  border: none;
  background: none;
  color: var(--app-text-1);
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}
.ms-item:active { background: var(--app-bg-2); }
.ms-item.on { color: var(--td-brand-color); font-weight: 600; }
.ms-arrow { margin-left: auto; color: var(--app-text-3); }

@media (max-width: 768px) {
  .content {
    padding: 12px;
    padding-bottom: 68px;
  }
}
</style>
