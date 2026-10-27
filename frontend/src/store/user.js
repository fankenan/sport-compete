import { defineStore } from 'pinia';
import http from '../api/http';

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem('compete_token') || '',
    user: JSON.parse(localStorage.getItem('compete_user') || 'null'),
    // 注意：localStorage 只能存字符串，读出后必须转成数字，
    // 否则 el-select 的 v-model（字符串）与 option 的 value（数字）类型不匹配，
    // 匹配不到选项就只能显示原始 id 值（如 "2"）
    competitionId: (() => {
      const v = localStorage.getItem('compete_competition');
      if (!v) return null;
      const n = Number(v);
      return Number.isNaN(n) ? null : n;
    })()
  }),

  getters: {
    isLogin: (s) => !!s.token,
    role: (s) => s.user?.role || 0,
    isAdmin: (s) => s.user?.role === 1,
    isSchool: (s) => s.user?.role === 2,
    isReferee: (s) => s.user?.role === 3,
    roleName: (s) => ({ 1: '教育局', 2: '学校', 3: '裁判' }[s.user?.role] || '未登录')
  },

  actions: {
    async login(username, password) {
      const data = await http.post('/auth/login', { username, password });
      this.token = data.token;
      this.user = data.user;
      localStorage.setItem('compete_token', data.token);
      localStorage.setItem('compete_user', JSON.stringify(data.user));
      return data.user;
    },

    logout() {
      this.token = '';
      this.user = null;
      localStorage.removeItem('compete_token');
      localStorage.removeItem('compete_user');
    },

    setCompetition(id) {
      // 统一转成数字存储，保证与 el-option 的 value 类型一致
      const numId = (id === null || id === undefined || id === '') ? null : Number(id);
      this.competitionId = Number.isNaN(numId) ? null : numId;
      if (this.competitionId === null) {
        localStorage.removeItem('compete_competition');
      } else {
        localStorage.setItem('compete_competition', String(this.competitionId));
      }
    }
  }
});
