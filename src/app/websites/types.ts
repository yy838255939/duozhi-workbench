import type { GroupChatBridge } from './group-types'

export interface WebsitePanelState {
  id: string
  url: string
  title: string
  loading: boolean
  error?: string
  canGoBack: boolean
  canGoForward: boolean
}

export interface WebsitePanelBounds {
  id: string
  siteId: string
  url: string
  bounds: { x: number; y: number; width: number; height: number }
}

export type WebsiteBroadcastStatus =
  | 'sent'
  | 'blocked'
  | 'busy'
  | 'draft-conflict'
  | 'unsupported'
  | 'error'
  | 'unconfirmed'

export interface WebsiteBroadcastResult {
  id: string
  siteId: string
  status: WebsiteBroadcastStatus
  detail: string
}

export interface WebsiteDesktopBridge {
  groupChat: GroupChatBridge
  syncPanels: (panels: WebsitePanelBounds[]) => Promise<void>
  navigate: (id: string, url: string) => Promise<void>
  command: (id: string, command: 'back' | 'forward' | 'reload') => Promise<void>
  openExternal: (url: string) => Promise<void>
  broadcast: (request: {
    panelIds: string[]
    siteIds: Record<string, string>
    message: string
  }) => Promise<WebsiteBroadcastResult[]>
  onPanelState: (listener: (state: WebsitePanelState) => void) => () => void
}

declare global {
  interface Window {
    websiteDesktop?: WebsiteDesktopBridge
  }
}
