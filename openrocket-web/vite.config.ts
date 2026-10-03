import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  // 相对路径 base：兼容 GitHub Pages 子路径部署（https://<user>.github.io/<repo>/）
  base: './',
})
