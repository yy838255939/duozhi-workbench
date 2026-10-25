import { fileOpen, fileSave } from 'browser-fs-access'
import Browser from 'webextension-polyfill'
import { trackEvent } from '~app/plausible'

export async function exportData() {
  const [syncData, localData] = await Promise.all([Browser.storage.sync.get(null), Browser.storage.local.get(null)])
  const data = {
    sync: syncData,
    local: localData,
    localStorage: { ...localStorage },
  }
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
  await fileSave(blob, { fileName: '多智工作台-数据备份.json' })
  trackEvent('export_data')
}

export async function importData() {
  const blob = await fileOpen({ extensions: ['.json'] })
  const json = JSON.parse(await blob.text())
  if (!json.sync || !json.local) {
    throw new Error('备份文件格式不正确')
  }
  if (!window.confirm('导入会覆盖当前设置、聊天记录和提示词，是否继续？')) {
    return
  }
  await Browser.storage.local.clear()
  await Browser.storage.local.set(json.local)
  await Browser.storage.sync.clear()
  await Browser.storage.sync.set(json.sync)

  if (json.localStorage) {
    for (const [k, v] of Object.entries(json.localStorage as Record<string, string>)) {
      localStorage.setItem(k, v)
    }
  }

  alert('数据导入成功')
  trackEvent('import_data')
  location.reload()
}
