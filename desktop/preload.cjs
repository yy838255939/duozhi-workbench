const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('websiteDesktop', {
  groupChat: {
    list: () => ipcRenderer.invoke('group:list'),
    save: (conversation) => ipcRenderer.invoke('group:save', conversation),
    archive: (id) => ipcRenderer.invoke('group:archive', id),
    send: (request) => ipcRenderer.invoke('group:send', request),
    stop: (runId) => ipcRenderer.invoke('group:stop', runId),
    openMember: (conversationId, memberId) => ipcRenderer.invoke('group:openMember', conversationId, memberId),
    chooseWorkspace: () => ipcRenderer.invoke('group:chooseWorkspace'),
    onChange: (listener) => {
      const handler = (_event, snapshot) => listener(snapshot)
      ipcRenderer.on('group:change', handler)
      return () => ipcRenderer.removeListener('group:change', handler)
    },
  },
  syncPanels: (panels) => ipcRenderer.invoke('website:sync', panels),
  navigate: (id, url) => ipcRenderer.invoke('website:navigate', id, url),
  command: (id, command) => ipcRenderer.invoke('website:command', id, command),
  openExternal: (url) => ipcRenderer.invoke('website:external', url),
  broadcast: (request) => ipcRenderer.invoke('website:broadcast', request),
  onPanelState: (listener) => {
    const handler = (_event, state) => listener(state)
    ipcRenderer.on('website:state', handler)
    return () => ipcRenderer.removeListener('website:state', handler)
  },
})
