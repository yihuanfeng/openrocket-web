import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'
import './style.css'
import App from './App.vue'
import { zhCN } from './locales/zh-CN'
import { enUS } from './locales/en-US'

// 语言偏好持久化；默认跟随系统语言（中文系统→中文，否则英文）
const saved = localStorage.getItem('ork:lang')
const sysLang = navigator.language?.toLowerCase() ?? ''
const locale = saved ?? (sysLang.startsWith('zh') ? 'zh' : 'en')

const i18n = createI18n({
  legacy: false,
  locale,
  fallbackLocale: 'en',
  messages: { zh: zhCN, en: enUS },
})

createApp(App).use(i18n).mount('#app')
