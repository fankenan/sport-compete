<template>
  <div class="login-page">
    <div class="login-shell">
      <!-- 左侧品牌区（宽屏显示） -->
      <aside class="brand-panel">
        <div class="brand-top">
          <div class="brand-logo">竞</div>
          <div class="brand-name">
            <p class="bn-title">体育竞赛管理系统</p>
            <p class="bn-sub">Sports Competition Platform</p>
          </div>
        </div>

        <div class="brand-body">
          <h1 class="brand-headline">让每一场校运会<br />都排得清清楚楚</h1>
          <p class="brand-desc">
            报名、分组、编排、检录、成绩、名次，一条链跑到底。<br />
            数据留在局内网，手机现场也能录。
          </p>

          <ul class="brand-points">
            <li>
              <span class="pt-num">01</span>
              <span class="pt-text">自动分组与赛程编排</span>
            </li>
            <li>
              <span class="pt-num">02</span>
              <span class="pt-text">小组赛打完自动生成淘汰赛</span>
            </li>
            <li>
              <span class="pt-num">03</span>
              <span class="pt-text">手机端现场录分，随时可查</span>
            </li>
          </ul>
        </div>

        <div class="brand-foot">
          <span>登封市教育局 · 体卫艺科</span>
        </div>
      </aside>

      <!-- 右侧表单 -->
      <main class="form-panel">
        <div class="form-inner">
          <div class="form-head">
            <h2>登录</h2>
            <p>请使用教育局下发的账号登录</p>
          </div>

          <t-form
            ref="formRef"
            :data="form"
            :rules="rules"
            label-width="0"
            :show-error-message="false"
            @submit="onSubmit"
          >
            <t-form-item name="username">
              <t-input
                v-model="form.username"
                placeholder="请输入账号"
                size="large"
                clearable
                :maxlength="32"
              >
                <template #prefix-icon>
                  <t-icon name="user" />
                </template>
              </t-input>
            </t-form-item>

            <t-form-item name="password">
              <t-input
                v-model="form.password"
                type="password"
                placeholder="请输入密码"
                size="large"
                clearable
                :maxlength="32"
              >
                <template #prefix-icon>
                  <t-icon name="lock-on" />
                </template>
              </t-input>
            </t-form-item>

            <t-button
              theme="primary"
              size="large"
              type="submit"
              block
              :loading="loading"
              class="submit-btn"
            >
              登 录
            </t-button>
          </t-form>

          <div v-if="showDemo" class="demo-block">
            <div class="demo-head">
              <span class="demo-title">测试账号（点击填入）</span>
            </div>
            <div class="demo-grid">
              <div class="demo-item" @click="fillDemo('admin')">
                <span class="di-role">教育局</span>
                <span class="di-acc">admin / admin123</span>
              </div>
              <div class="demo-item" @click="fillDemo('school')">
                <span class="di-role">学校端</span>
                <span class="di-acc">school1 / school123</span>
              </div>
              <div class="demo-item" @click="fillDemo('referee')">
                <span class="di-role">裁判端</span>
                <span class="di-acc">ref001 / ref123</span>
              </div>
            </div>
          </div>

          <div v-if="isHttps" class="access-tip">
            <span class="at-icon">!</span>
            <span>
              当前用 HTTPS 访问。单位内网对 443 有拦截，如遇“无法连接服务器”，
              请改用 <b>http://150.158.39.237:8083</b>
            </span>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '../store/user';
import { message } from '../utils/ui';

const router = useRouter();
const store = useUserStore();

const formRef = ref(null);
const form = ref({ username: '', password: '' });
const loading = ref(false);
const isHttps = ref(window.location.protocol === 'https:');

// 测试账号仅 ?demo=1 时显示，正式访问不暴露
const showDemo = ref(
  /[?&]demo=1/.test(window.location.search) ||
  /[?&]demo=1/.test(window.location.hash)
);

const rules = {
  username: [{ required: true, message: '请输入账号', type: 'error' }],
  password: [{ required: true, message: '请输入密码', type: 'error' }]
};

const DEMO = {
  admin: { username: 'admin', password: 'admin123' },
  school: { username: 'school1', password: 'school123' },
  referee: { username: 'ref001', password: 'ref123' }
};

function fillDemo(key) {
  const d = DEMO[key];
  if (!d) return;
  form.value.username = d.username;
  form.value.password = d.password;
}

async function onSubmit({ validateResult }) {
  if (validateResult && validateResult !== true) return;

  if (!form.value.username || !form.value.password) {
    message.warning('请输入账号和密码');
    return;
  }

  loading.value = true;
  try {
    const user = await store.login(form.value.username, form.value.password);
    message.success(`欢迎，${user.real_name}`);
    router.push('/dashboard');
  } catch (e) {
    message.error(e.message);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  background:
    radial-gradient(ellipse 900px 500px at 15% -10%, rgba(0, 82, 217, 0.06), transparent 60%),
    radial-gradient(ellipse 700px 400px at 100% 110%, rgba(54, 110, 244, 0.05), transparent 60%),
    var(--app-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.login-shell {
  width: 100%;
  max-width: 940px;
  min-height: 560px;
  background: var(--app-surface);
  border-radius: 16px;
  box-shadow: var(--shadow-2), 0 1px 2px rgba(16, 24, 40, 0.04);
  display: flex;
  overflow: hidden;
  animation: rise-in 0.5s var(--ease-out) both;
}

/* ---------- 左侧品牌 ---------- */
.brand-panel {
  width: 44%;
  background: linear-gradient(150deg, #0b3ba5 0%, var(--td-brand-color) 55%, #2669e8 100%);
  color: #fff;
  padding: 38px 36px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  position: relative;
  overflow: hidden;
}

.brand-panel::after {
  content: '';
  position: absolute;
  width: 340px;
  height: 340px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.05);
  right: -130px;
  bottom: -130px;
}

.brand-panel::before {
  content: '';
  position: absolute;
  width: 200px;
  height: 200px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.04);
  right: 40px;
  top: -90px;
}

.brand-top {
  display: flex;
  align-items: center;
  gap: 11px;
  position: relative;
  z-index: 1;
}

.brand-logo {
  width: 38px;
  height: 38px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.16);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 500;
  flex-shrink: 0;
}

.bn-title {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;
}

.bn-sub {
  margin: 1px 0 0;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.55);
  letter-spacing: 0.3px;
}

.brand-body {
  position: relative;
  z-index: 1;
  padding: 20px 0;
}

.brand-headline {
  margin: 0 0 14px;
  font-size: 25px;
  font-weight: 600;
  line-height: 1.5;
  letter-spacing: 0.3px;
}

.brand-desc {
  margin: 0 0 26px;
  font-size: 13px;
  line-height: 1.9;
  color: rgba(255, 255, 255, 0.72);
}

.brand-points {
  list-style: none;
  margin: 0;
  padding: 0;
}

.brand-points li {
  display: flex;
  align-items: center;
  gap: 11px;
  margin-bottom: 13px;
}

.pt-num {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.pt-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.88);
}

.brand-foot {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  position: relative;
  z-index: 1;
}

/* ---------- 右侧表单 ---------- */
.form-panel {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 44px;
  min-width: 0;
}

.form-inner {
  width: 100%;
  max-width: 320px;
}

.form-head {
  margin-bottom: 26px;
}

.form-head h2 {
  margin: 0 0 6px;
  font-size: 24px;
  font-weight: 600;
  color: var(--app-text-1);
  letter-spacing: 0.5px;
}

.form-head p {
  margin: 0;
  font-size: 13px;
  color: var(--app-text-3);
}

.submit-btn {
  margin-top: 6px;
  letter-spacing: 4px;
  transition: transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-mid) var(--ease-out);
}

.submit-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 82, 217, 0.35);
}

/* ---------- 测试账号 ---------- */
.demo-block {
  margin-top: 26px;
  padding-top: 18px;
  border-top: 1px solid var(--app-border);
}

.demo-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.demo-title {
  font-size: 12px;
  color: var(--app-text-3);
}

.demo-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.demo-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: var(--radius-m);
  background: var(--app-bg-2);
  cursor: pointer;
  transition: background var(--dur-fast) ease;
}

.demo-item:hover {
  background: var(--td-brand-color-light);
}

.di-role {
  font-size: 12px;
  color: var(--app-text-2);
}

.di-acc {
  font-size: 12px;
  color: var(--app-text-3);
  font-variant-numeric: tabular-nums;
}

/* ---------- 访问方式提醒 ---------- */
.access-tip {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin-top: 16px;
  padding: 9px 11px;
  background: rgba(237, 123, 47, 0.08);
  border: 1px solid rgba(237, 123, 47, 0.35);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.65;
  color: var(--app-warning);
}

.at-icon {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--app-warning);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
}

.access-tip b {
  font-weight: 500;
  color: var(--app-warning);
  word-break: break-all;
}

/* ---------- 响应式 ---------- */
@media (max-width: 860px) {
  .brand-panel {
    display: none;
  }

  .login-shell {
    max-width: 400px;
    min-height: auto;
  }

  .form-panel {
    padding: 36px 28px;
  }

  .form-inner {
    max-width: none;
  }
}

@media (max-width: 480px) {
  .login-page {
    padding: 0;
    background: var(--app-surface);
  }

  .login-shell {
    box-shadow: none;
    border-radius: 0;
    min-height: 100vh;
    max-width: none;
  }

  .form-panel {
    padding: 56px 24px;
  }
}
</style>
