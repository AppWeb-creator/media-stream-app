import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          hlsjs: ['hls.js'],
          mpegts: ['mpegts.js'],
        },
      },
    },
  },
  server: {
    proxy: {
      // التطوير: نوجّه /iptv-stream إلى سيرفر Node المحلي (server/index.js)
      // الذي يعيد التوجيه إلى ugeen.live:8080 من عنوان IP عادي غير محظور،
      // متخفياً كـ Player بنفس ترويسات الإنتاج.
      '/iptv-stream': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
});