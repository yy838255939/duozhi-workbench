const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  protocol,
  net,
  session,
  shell,
  Menu,
  dialog,
} = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const sites = require('./sites.json')
const { safeWebsiteUrl, clampBounds } = require('./validation.cjs')
const { createBroadcaster } = require('./broadcast.cjs')
const { websiteMatches } = require('./broadcast.cjs')
const { createGroupManager } = require('./group-manager.cjs')

app.setName('多智工作台')
app.setPath('userData', path.join(app.getPath('appData'), 'DuozhiWorkbench'))
protocol.registerSchemesAsPrivileged([
  { scheme: 'duozhi', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

let mainWindow
let groupManager
let groupError
let quitting = false
let activeGroupId
let closingGroups
const groupConnections = new Map()
const panels = new Map()
const broadcast = createBroadcaster((id) => panels.get(id))
const siteIds = new Set(sites.map((site) => site.id))
const securePreferences = { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }

function authorize(event) {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame?.url !== 'duozhi://app/desktop.html'
  ) {
    throw new Error('无效的窗口请求')
  }
}

function attachNavigationProtection(contents) {
  contents.on('will-navigate', (event, url) => {
    if (!safeWebsiteUrl(url)) event.preventDefault()
  })
  contents.on('will-redirect', (event, url) => {
    if (!safeWebsiteUrl(url)) event.preventDefault()
  })
}

function sendState(id, record, error) {
  if (!mainWindow || mainWindow.isDestroyed() || record.view.webContents.isDestroyed()) return
  const contents = record.view.webContents
  if (error !== undefined) record.error = error
  mainWindow.webContents.send('website:state', {
    id,
    url: contents.getURL() || record.url,
    title: contents.getTitle(),
    loading: contents.isLoading(),
    error: record.error,
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
  })
}

function providerSession(siteId) {
  const websiteSession = session.fromPartition(`persist:website-${siteId}`)
  // Use the runtime's Chromium browser identifier for website compatibility.
  websiteSession.setUserAgent(
    websiteSession
      .getUserAgent()
      .replace(/\sElectron\/[\d.]+/g, '')
      .replace(/\sduozhi-workbench\/[\d.]+/g, ''),
  )
  websiteSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'fullscreen' || permission === 'clipboard-sanitized-write')
  })
  websiteSession.setPermissionCheckHandler(
    (_contents, permission) => permission === 'fullscreen' || permission === 'clipboard-sanitized-write',
  )
  return websiteSession
}

function protectProvider(contents, websiteSession) {
  attachNavigationProtection(contents)
  contents.setWindowOpenHandler(({ url }) => ({
    action: safeWebsiteUrl(url) ? 'allow' : 'deny',
    overrideBrowserWindowOptions: {
      width: 1000,
      height: 780,
      autoHideMenuBar: true,
      webPreferences: { ...securePreferences, session: websiteSession },
    },
  }))
  contents.on('did-create-window', (popup) => attachNavigationProtection(popup.webContents))
}

function createPanel(panel) {
  const websiteSession = providerSession(panel.siteId)
  const view = new WebContentsView({ webPreferences: { ...securePreferences, session: websiteSession } })
  view.setBackgroundColor('#ffffff')
  const record = { view, siteId: panel.siteId, url: panel.url, attached: false, error: undefined }
  const contents = view.webContents
  // Websites get browser capabilities only; the shell preload is never attached to them.
  protectProvider(contents, websiteSession)
  contents.on('did-start-loading', () => sendState(panel.id, record, ''))
  contents.on('did-stop-loading', () => sendState(panel.id, record))
  contents.on('did-navigate', () => sendState(panel.id, record))
  contents.on('did-navigate-in-page', () => sendState(panel.id, record))
  contents.on('page-title-updated', () => sendState(panel.id, record))
  contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3)
      sendState(panel.id, record, '官网暂时无法加载，请检查网络后刷新，或在浏览器中打开。')
  })
  contents.loadURL(panel.url).catch(() => {})
  panels.set(panel.id, record)
  return record
}

function groupConnection(conversation, siteId, savedUrl) {
  if (!siteIds.has(siteId)) throw new Error('无效的 AI 官网成员。')
  const key = `${conversation.id}:${siteId}`
  let record = groupConnections.get(key)
  if (record && !record.view.webContents.isDestroyed()) {
    record.lastUsed = Date.now()
    return record
  }
  if (groupConnections.size >= 12) {
    const idle = [...groupConnections.entries()]
      .filter(
        ([, item]) =>
          item.conversationId !== activeGroupId && item.conversationId !== conversation.id && !item.window.isVisible(),
      )
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0]
    if (!idle) throw new Error('成员官网窗口已达缓存上限，请关闭不再使用的成员窗口或归档旧群。')
    groupConnections.delete(idle[0])
    idle[1].window.destroy()
  }
  const site = sites.find((item) => item.id === siteId)
  const url = websiteMatches(siteId, savedUrl) ? savedUrl : site.url
  const websiteSession = providerSession(siteId)
  const window = new BrowserWindow({
    title: `${conversation.title} · ${site.name}`,
    width: 1080,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: { ...securePreferences, session: websiteSession, backgroundThrottling: false },
  })
  record = {
    view: { webContents: window.webContents },
    window,
    siteId,
    url,
    attached: false,
    conversationId: conversation.id,
    lastUsed: Date.now(),
    fresh: !websiteMatches(siteId, savedUrl),
  }
  groupConnections.set(key, record)
  protectProvider(window.webContents, websiteSession)
  const saveSource = (_event, navigatedUrl) => {
    if (websiteMatches(siteId, navigatedUrl)) {
      record.url = navigatedUrl
      if (!record.fresh) groupManager?.setSource(conversation.id, siteId, navigatedUrl)
    }
  }
  window.webContents.on('did-navigate', saveSource)
  window.webContents.on('did-navigate-in-page', saveSource)
  window.on('closed', () => {
    if (groupConnections.get(key) === record) groupConnections.delete(key)
  })
  window.loadURL(url).catch(() => {})
  return record
}

function closeGroupConnections(conversationId) {
  for (const [key, record] of groupConnections) {
    if (!conversationId || key.startsWith(`${conversationId}:`)) {
      groupConnections.delete(key)
      if (!record.window.isDestroyed()) record.window.destroy()
    }
  }
}

function getGroupManager() {
  if (!groupManager) throw new Error(groupError || '群聊正在初始化，请稍候。')
  return groupManager
}

ipcMain.handle('website:sync', (event, requested) => {
  authorize(event)
  if (!Array.isArray(requested) || requested.length > 6) throw new Error('窗口数量无效')
  const visible = new Set()
  const size = { width: mainWindow.getContentSize()[0], height: mainWindow.getContentSize()[1] }
  for (const panel of requested) {
    if (!/^panel-[0-5]$/.test(panel.id) || !siteIds.has(panel.siteId)) throw new Error('网站窗口无效')
    const url = safeWebsiteUrl(panel.url)
    const bounds = clampBounds(panel.bounds, size)
    if (!url || !bounds) throw new Error('网址或窗口位置无效')
    let record = panels.get(panel.id)
    if (record && record.siteId !== panel.siteId) {
      if (record.attached) mainWindow.contentView.removeChildView(record.view)
      record.view.webContents.close()
      panels.delete(panel.id)
      record = undefined
    }
    if (!record) record = createPanel({ ...panel, url })
    else if (record.url !== url) {
      record.url = url
      record.view.webContents.loadURL(url).catch(() => {})
    }
    if (!record.attached) {
      mainWindow.contentView.addChildView(record.view)
      record.attached = true
    }
    record.view.setBounds(bounds)
    visible.add(panel.id)
    sendState(panel.id, record)
  }
  for (const [id, record] of panels) {
    if (!visible.has(id) && record.attached) {
      mainWindow.contentView.removeChildView(record.view)
      record.attached = false
    }
  }
})

ipcMain.handle('website:navigate', (event, id, rawUrl) => {
  authorize(event)
  const record = panels.get(id)
  const url = safeWebsiteUrl(rawUrl)
  if (!record || !url) throw new Error('请输入有效的 HTTPS 网址')
  record.url = url
  return record.view.webContents.loadURL(url).catch(() => {})
})
ipcMain.handle('website:command', (event, id, command) => {
  authorize(event)
  const contents = panels.get(id)?.view.webContents
  if (!contents) return
  if (command === 'reload') contents.reload()
  else if (command === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
  else if (command === 'forward' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
})
ipcMain.handle('website:external', (event, value) => {
  authorize(event)
  const url = safeWebsiteUrl(value)
  if (!url) throw new Error('无效的网址')
  return shell.openExternal(url)
})
ipcMain.handle('website:broadcast', (event, request) => {
  authorize(event)
  return broadcast(request)
})

for (const command of ['list', 'save', 'archive', 'send', 'stop', 'openMember', 'chooseWorkspace']) {
  ipcMain.handle(`group:${command}`, (event, ...args) => {
    authorize(event)
    return getGroupManager()[command](...args)
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: '多智工作台',
    width: 1560,
    height: 1000,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#edf2f8',
    autoHideMenuBar: true,
    webPreferences: { ...securePreferences, preload: path.join(__dirname, 'preload.cjs') },
  })
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.on('closed', () => {
    for (const record of panels.values()) {
      if (!record.view.webContents.isDestroyed()) record.view.webContents.close()
    }
    panels.clear()
    mainWindow = undefined
    closingGroups = Promise.resolve(groupManager?.list())
      .then((snapshot) => {
        if (snapshot?.activeRun) return groupManager.stop(snapshot.activeRun.id)
      })
      .finally(() => closeGroupConnections())
      .catch(() => {})
  })
  mainWindow.loadURL('duozhi://app/desktop.html')
}

app.whenReady().then(() => {
  try {
    groupManager = createGroupManager({
      file: path.join(app.getPath('userData'), 'group-chat', 'conversations.json'),
      getWebsiteConnection: groupConnection,
      openWebsite: (conversation, siteId, url) => {
        const record = groupConnection(conversation, siteId, url)
        record.window.show()
        record.window.focus()
      },
      closeConversation: closeGroupConnections,
      chooseWorkspace: async () => {
        const selection = await dialog.showOpenDialog(mainWindow, {
          title: '选择智能体的工作文件夹',
          buttonLabel: '使用这个文件夹',
          properties: ['openDirectory'],
        })
        return selection.canceled ? null : selection.filePaths[0]
      },
      onChange: (snapshot) => {
        activeGroupId = snapshot.activeRun?.conversationId
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('group:change', snapshot)
      },
    })
  } catch (error) {
    groupError = error.message
  }
  const assetRoot = path.join(__dirname, '../dist-desktop')
  protocol.handle('duozhi', (request) => {
    const url = new URL(request.url)
    const file = path.resolve(assetRoot, `.${decodeURIComponent(url.pathname)}`)
    if (url.host !== 'app' || !file.startsWith(`${assetRoot}${path.sep}`))
      return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).href)
  })
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: '多智工作台',
        submenu: [{ role: 'about', label: '关于多智工作台' }, { type: 'separator' }, { role: 'quit', label: '退出' }],
      },
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' },
          { role: 'redo', label: '重做' },
          { type: 'separator' },
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '复制' },
          { role: 'paste', label: '粘贴' },
          { role: 'selectAll', label: '全选' },
        ],
      },
      {
        label: '窗口',
        submenu: [
          { role: 'minimize', label: '最小化' },
          { role: 'zoom', label: '缩放' },
          { role: 'front', label: '置于前面' },
        ],
      },
    ]),
  )
  createWindow()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (!mainWindow)
    Promise.resolve(closingGroups).then(() => {
      if (!mainWindow && !quitting) createWindow()
    })
})
app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  Promise.resolve(groupManager?.close())
    .catch(() => {})
    .finally(() => {
      try {
        closeGroupConnections()
      } finally {
        // Group cancellation and persistence finish before a user-requested exit.
        // Avoid re-entering app.quit from its before-quit microtask.
        app.exit(0)
      }
    })
})
