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
        <p class="nav-group">赛事管理</p>
        <router-link
          v-for="item in menuMain"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ active: route.path === item.path }"
        >
          <t-icon :name="item.icon || 'app'" size="17px" class="nav-ic" />
          <span>{{ item.label }}</span>
        </router-link>

        <template v-if="menuSub.length">
          <p class="nav-group">比赛执行</p>
          <router-link
            v-for="item in menuSub"
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
        <h1 class="page-title">{{ route.meta.title || '' }}</h1>

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
              <t-icon name="chevron-down" size="14px" style="color: rgba(0,0,0,.4)" />
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
        <router-view v-slot="{ Component }">
          <transition name="fade-slide" mode="out-in">
            <keep-alive>
              <component :is="Component" />
            </keep-alive>
          </transition>
        </router-view>
      </main>

      <!-- 手机底部导航 -->
      <nav class="tabbar" v-if="isMobile">
        <router-link
          v-for="item in mobileMenu"
          :key="item.path"
          :to="item.path"
          class="tab-item"
          :class="{ active: route.path === item.path }"
        >
          <t-icon :name="item.icon || 'app'" size="20px" class="tab-ic" />
          <span class="tab-label">{{ item.label }}</span>
        </router-link>
      </nav>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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

const ALL_MENU = [
  { path: '/dashboard', label: '赛事总览', icon: 'dashboard', mobile: true, mobileIcon: 'dashboard', group: 'main' },
  { path: '/competition', label: '赛事管理', icon: 'flag', roles: [1], group: 'main' },
  { path: '/event-setup', label: '项目与场地', icon: 'app', roles: [1], group: 'main' },
  { path: '/track', label: '田径中心', icon: 'rocket', roles: [1], group: 'main' },
  { path: '/schools', label: '学校与账号', icon: 'usergroup', roles: [1], group: 'main' },
  { path: '/entry', label: '报名管理', icon: 'edit', roles: [1, 2], mobile: true, mobileIcon: 'edit', group: 'main' },
  { path: '/track-result', label: '成绩录入', icon: 'check-circle', roles: [1, 3], mobile: true, mobileIcon: 'check-circle', group: 'sub' },
  { path: '/track-race', label: '赛中控台', icon: 'control-platform', roles: [1], mobile: true, mobileIcon: 'control-platform', group: 'sub' },
  { path: '/track-stats', label: '赛后统计', icon: 'chart-bar', roles: [1], mobile: true, mobileIcon: 'chart-bar', group: 'sub' },
  { path: '/track-plan', label: '日程与秩序册', icon: 'calendar', roles: [1], group: 'sub' },
  { path: '/screen-control', label: '大屏控制端', icon: 'precise-monitor', roles: [1], group: 'sub' },
  { path: '/grouping', label: '分组编排', icon: 'view-list', roles: [1], group: 'sub' },
  { path: '/schedule', label: '赛程编排', icon: 'time', roles: [1], mobile: true, mobileIcon: 'time', group: 'sub' },
  { path: '/referee', label: '裁判管理', icon: 'user-circle', roles: [1], group: 'sub' },
  { path: '/standing', label: '积分榜', icon: 'chart-line', roles: [1, 2], mobile: true, mobileIcon: 'chart-line', group: 'sub' },
  { path: '/rank', label: '名次表', icon: 'data', roles: [1], group: 'sub' },
  { path: '/my-schedule', label: '我的赛程', icon: 'star', roles: [3], mobile: true, mobileIcon: 'star', group: 'sub' }
];

const visibleMenu = computed(() =>
  ALL_MENU.filter((i) => !i.roles || i.roles.includes(store.role))
);

const menuMain = computed(() => visibleMenu.value.filter((i) => i.group === 'main'));
const menuSub = computed(() => visibleMenu.value.filter((i) => i.group === 'sub'));

const mobileMenu = computed(() => {
  if (store.role === 3) {
    return [
      { path: '/my-schedule', label: '赛程', icon: 'star' },
      { path: '/standing', label: '积分', icon: 'chart-line' },
      { path: '/rank', label: '名次', icon: 'data' }
    ];
  }
  return visibleMenu.value.filter((i) => i.mobile).slice(0, 4);
});

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
    router.push('/password');
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
  margin: 12px 0 6px;
  padding-left: 11px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.32);
  letter-spacing: 0.5px;
  font-weight: 500;
}

.nav-group:first-child {
  margin-top: 0;
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--radius-m);
  color: rgba(255, 255, 255, 0.68);
  text-decoration: none;
  font-size: 14px;
  margin-bottom: 2px;
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
  background: rgba(0, 82, 217, 0.28);
  color: #fff;
  font-weight: 500;
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
  background: #366ef4;
}

.nav-item.active .nav-ic {
  opacity: 1;
  color: #7ba4f8;
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

@media (max-width: 768px) {
  .content {
    padding: 12px;
    padding-bottom: 68px;
  }
}
</style>
