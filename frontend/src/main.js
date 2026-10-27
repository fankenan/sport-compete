import { createApp } from 'vue';
import { createPinia } from 'pinia';
import TDesign from 'tdesign-vue-next';
import 'tdesign-vue-next/es/style/index.css';
import App from './App.vue';
import router from './router';
import LunarDatePicker from './components/LunarDatePicker.vue';
import './styles.css';

// 主题初始化（挂载前执行，避免闪烁）
try {
  if (localStorage.getItem('app-theme') === 'dark') {
    document.documentElement.setAttribute('theme-mode', 'dark');
  }
} catch (e) { /* 隐私模式忽略 */ }

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(TDesign);

// 全局注册带农历的日期选择器
app.component('LunarDatePicker', LunarDatePicker);

app.mount('#app');
