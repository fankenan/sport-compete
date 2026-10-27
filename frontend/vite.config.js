import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 3100,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4100',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // 拆包：组件库和基础框架单独成块，业务代码更新时这两块不用重新下载
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('tdesign')) return 'vendor-tdesign';
          if (id.includes('lunar-javascript')) return 'vendor-lunar';
          if (id.includes('vue') || id.includes('pinia') || id.includes('axios')) {
            return 'vendor-core';
          }
          return 'vendor';
        }
      }
    }
  }
});
