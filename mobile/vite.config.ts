import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // 相对路径：既能挂在后端 /m 下，也能被 Capacitor 直接从本地加载
  base: './',
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5273 }
})
