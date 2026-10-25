import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import simplifiedChinese from './locales/simplified-chinese.json'

export const languageCodes = ['zh-CN']
i18n.use(initReactI18next).init({
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  supportedLngs: languageCodes,
  resources: { 'zh-CN': { translation: simplifiedChinese } },
  interpolation: { escapeValue: false },
})
export default i18n
