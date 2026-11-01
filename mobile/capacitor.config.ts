import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.campusassistant.mobile',
  appName: 'ToDoList',
  webDir: 'dist',
  // 后端是 http（局域网/隧道），WebView 用 http 方案可以避免混合内容拦截
  server: {
    androidScheme: 'http',
    cleartext: true
  },
  android: {
    allowMixedContent: true
  }
}

export default config
