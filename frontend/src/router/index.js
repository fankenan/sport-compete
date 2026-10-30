import { createRouter, createWebHashHistory } from 'vue-router';
import { useUserStore } from '../store/user';

const routes = [
  { path: '/login', name: 'login', component: () => import('../views/Login.vue'), meta: { public: true } },
  {
    path: '/screen',
    name: 'screen',
    component: () => import('../views/Screen.vue'),
    meta: { public: true, title: '赛事得分大屏' }
  },
  {
    path: '/screen/:uuid',
    name: 'screen-uuid',
    component: () => import('../views/Screen.vue'),
    meta: { public: true, title: '赛事大屏' }
  },
  {
    path: '/public/:uuid',
    name: 'public-meet',
    component: () => import('../views/PublicMeet.vue'),
    meta: { public: true, title: '公开成绩查询' }
  },
  {
    path: '/',
    component: () => import('../views/Layout.vue'),
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', name: 'dashboard', component: () => import('../views/Dashboard.vue'), meta: { title: '赛事总览' } },
      { path: 'competition', name: 'competition', component: () => import('../views/Competition.vue'), meta: { title: '赛事管理' } },
      { path: 'event-setup', name: 'event-setup', component: () => import('../views/EventSetup.vue'), meta: { title: '项目与场地' } },
      { path: 'track', name: 'track', component: () => import('../views/TrackCenter.vue'), meta: { title: '田径中心' } },
      { path: 'track-result', name: 'track-result', component: () => import('../views/TrackResult.vue'), meta: { title: '成绩录入' } },
      { path: 'track-race', name: 'track-race', component: () => import('../views/TrackRace.vue'), meta: { title: '赛中控台' } },
      { path: 'track-stats', name: 'track-stats', component: () => import('../views/TrackStats.vue'), meta: { title: '赛后统计' } },
      { path: 'track-plan', name: 'track-plan', component: () => import('../views/TrackPlan.vue'), meta: { title: '日程与秩序册' } },
      { path: 'screen-control', name: 'screen-control', component: () => import('../views/ScreenControl.vue'), meta: { title: '大屏控制端' } },
      { path: 'schools', name: 'schools', component: () => import('../views/Schools.vue'), meta: { title: '学校与账号' } },
      { path: 'entry', name: 'entry', component: () => import('../views/Entry.vue'), meta: { title: '报名管理' } },
      { path: 'grouping', name: 'grouping', component: () => import('../views/Grouping.vue'), meta: { title: '分组编排' } },
      { path: 'schedule', name: 'schedule', component: () => import('../views/Schedule.vue'), meta: { title: '赛程编排' } },
      { path: 'referee', name: 'referee', component: () => import('../views/Referee.vue'), meta: { title: '裁判管理' } },
      { path: 'sport-activity', name: 'sport-activity', component: () => import('../views/SportActivityIndex.vue'), meta: { title: '学校体育活动' } },
      { path: 'standing', name: 'standing', component: () => import('../views/Standing.vue'), meta: { title: '积分榜' } },
      { path: 'rank', name: 'rank', component: () => import('../views/Rank.vue'), meta: { title: '名次表' } },
      { path: 'my-schedule', name: 'my-schedule', component: () => import('../views/MySchedule.vue'), meta: { title: '我的赛程' } }
    ]
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' }
];

const router = createRouter({
  history: createWebHashHistory(),
  routes
});

router.beforeEach((to, from, next) => {
  const store = useUserStore();
  if (to.meta.public) {
    next();
    return;
  }
  if (!store.isLogin) {
    next('/login');
    return;
  }
  next();
});

// 部署新版本后，旧页面会话按旧文件名加载 chunk 会 404。
// 捕获这类失败并整页刷新一次，即可拿到新版本（防死循环：只自动刷一次）。
router.onError((error, to) => {
  const msg = String(error?.message || error);
  if (/Failed to fetch dynamically imported module|Loading( CSS)? chunk .* failed|Importing a module script failed/i.test(msg)) {
    const key = 'app_chunk_reload';
    const target = to?.fullPath || '/';
    if (sessionStorage.getItem(key) !== target) {
      sessionStorage.setItem(key, target);
      window.location.replace(window.location.origin + window.location.pathname + '#' + target);
      window.location.reload();
    }
  }
});

export default router;
