import axios from 'axios';

const http = axios.create({
  baseURL: '/api',
  timeout: 30000
});

// 请求拦截：带 token
http.interceptors.request.use((config) => {
  const token = localStorage.getItem('compete_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截：统一错误处理
http.interceptors.response.use(
  (res) => {
    const body = res.data;
    if (body && typeof body.code === 'number') {
      if (body.code === 0) return body.data;
      // 业务错误
      if (body.code === 401) {
        localStorage.removeItem('compete_token');
        localStorage.removeItem('compete_user');
        if (location.hash !== '#/login') {
          location.hash = '#/login';
        }
      }
      return Promise.reject(new Error(body.message || '操作失败'));
    }
    return body;
  },
  (err) => {
    // 401 处理
    if (err.response?.status === 401) {
      localStorage.removeItem('compete_token');
      localStorage.removeItem('compete_user');
      if (location.hash !== '#/login') location.hash = '#/login';
    }

    // 组织更可读的错误信息
    let msg = '网络错误';
    if (err.response) {
      // 服务器有响应但状态码异常
      const st = err.response.status;
      const data = err.response.data;
      if (data?.message) {
        msg = data.message;
      } else if (st === 404) {
        msg = '接口不存在（404）';
      } else if (st === 403) {
        msg = '没有权限（403）';
      } else if (st === 500) {
        msg = '服务器内部错误（500）';
      } else {
        msg = `请求失败（${st}）`;
      }
    } else if (err.code === 'ECONNABORTED') {
      msg = '请求超时，请检查网络';
    } else if (err.request) {
      // 请求发出但没有响应：网络断开、跨域被拦、服务器不可达
      if (location.protocol === 'https:') {
        // 单位内网对 conandata.xyz 的 443 有 SNI 阻断，https 会间歇失败
        msg = '连接失败。正在使用 HTTPS 访问，单位内网对 443 端口有拦截，请改用 http://150.158.39.237:8083';
      } else {
        msg = '无法连接服务器，请检查网络或稍后重试';
      }
    } else {
      msg = err.message || '请求失败';
    }

    const error = new Error(msg);
    error.original = err;
    return Promise.reject(error);
  }
);

export default http;
