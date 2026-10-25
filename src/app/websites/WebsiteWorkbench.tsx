import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  ArrowTopRightOnSquareIcon,
  Bars3Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChatBubbleLeftRightIcon,
  InformationCircleIcon,
  PaperAirplaneIcon,
  Squares2X2Icon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import sites from '../../../desktop/sites.json'
import icon from '~/assets/icon.svg'
import type { WebsiteBroadcastResult, WebsiteBroadcastStatus, WebsitePanelBounds, WebsitePanelState } from './types'
import './website-workbench.scss'
import AiLogo from './AiLogo'
import GroupChatWorkspace from './GroupChatWorkspace'

type Panel = { id: string; siteId: string; url: string }
type Count = 1 | 2 | 3 | 4 | 6
type DropTarget = { id: string; position: 'before' | 'after' }
type BroadcastTarget = { id: string; siteId: string; name: string; number: number }
type BroadcastReport = { message: string; targets: BroadcastTarget[]; results: WebsiteBroadcastResult[] }
const COUNTS: Count[] = [1, 2, 3, 4, 6]
const STORAGE_KEY = 'website-workbench:v1'
const ORDER_STORAGE_KEY = 'website-workbench:sidebar-order:v1'
const COLLAPSED_STORAGE_KEY = 'website-workbench:sidebar-collapsed:v1'
const MAX_MESSAGE_LENGTH = 60000
const BROADCAST_LABELS: Record<WebsiteBroadcastStatus, string> = {
  sent: '已发送',
  blocked: '未发送',
  busy: '正在回复',
  'draft-conflict': '已有草稿',
  unsupported: '暂不支持',
  error: '发送失败',
  unconfirmed: '需要确认',
}

function initialSiteOrder(): string[] {
  const ids = sites.map((site) => site.id)
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_STORAGE_KEY) || 'null')
    if (!Array.isArray(saved)) return ids
    return [...new Set([...saved.filter((id) => ids.includes(id)), ...ids])] as string[]
  } catch {
    return ids
  }
}

function sidebarDropTarget(event: React.PointerEvent<HTMLButtonElement>): DropTarget | null {
  const nav = event.currentTarget.parentElement
  if (!nav) return null
  const navRect = nav.getBoundingClientRect()
  if (event.clientX < navRect.left || event.clientX > navRect.right) return null
  if (event.clientY < navRect.top + 24) nav.scrollTop -= 12
  else if (event.clientY > navRect.bottom - 24) nav.scrollTop += 12
  for (const button of nav.querySelectorAll<HTMLButtonElement>('[data-site-id]')) {
    const rect = button.getBoundingClientRect()
    if (event.clientY >= rect.top - 2 && event.clientY <= rect.bottom + 2)
      return { id: button.dataset.siteId!, position: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' }
  }
  return null
}

function initialSettings(): { count: Count; panels: Panel[] } {
  const defaults = {
    count: 2 as Count,
    panels: sites.slice(0, 6).map((site, index) => ({ id: `panel-${index}`, siteId: site.id, url: site.url })),
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (!saved || !COUNTS.includes(saved.count) || !Array.isArray(saved.panels)) return defaults
    return {
      count: saved.count,
      panels: defaults.panels.map((panel, index) => {
        const value = saved.panels[index]
        if (!value || !sites.some((site) => site.id === value.siteId)) return panel
        const url = new URL(value.url)
        return url.protocol === 'https:' && !url.username && !url.password
          ? { ...panel, siteId: value.siteId, url: url.href }
          : panel
      }),
    }
  } catch {
    return defaults
  }
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      className="website-icon-button"
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export default function WebsiteWorkbench() {
  const [viewMode, setViewMode] = useState<'websites' | 'group-chat'>(() => {
    try {
      return localStorage.getItem('website-workbench:view:v1') === 'group-chat' ? 'group-chat' : 'websites'
    } catch {
      return 'websites'
    }
  })
  const [groupBusy, setGroupBusy] = useState(false)
  const [settings, setSettings] = useState(initialSettings)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [states, setStates] = useState<Record<string, WebsitePanelState>>({})
  const [addresses, setAddresses] = useState<Record<string, string>>({})
  const [modal, setModal] = useState(false)
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [sending, setSending] = useState(false)
  const [report, setReport] = useState<BroadcastReport | null>(null)
  const [siteOrder, setSiteOrder] = useState(initialSiteOrder)
  const [draggingSite, setDraggingSite] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const sidebarDrag = useRef<{ id: string; x: number; y: number; active: boolean } | null>(null)
  const ignoreSortClick = useRef(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const panelElements = useRef(new Map<string, HTMLDivElement>())
  const editingAddress = useRef<string | null>(null)
  const sendingRef = useRef(false)
  const composingRef = useRef(false)
  const bridge = window.websiteDesktop
  const visiblePanels = useMemo(() => settings.panels.slice(0, settings.count), [settings])
  const orderedSites = useMemo(() => siteOrder.map((id) => sites.find((site) => site.id === id)!), [siteOrder])
  const continuingReport =
    report?.message === message && report.results.some((result) => result.status !== 'sent') ? report : null
  const sendTargets = visiblePanels.filter((panel) => {
    const previous = continuingReport?.results.find(
      (result) => result.id === panel.id && result.siteId === panel.siteId,
    )
    return previous?.status !== 'sent' && previous?.status !== 'unconfirmed'
  })
  const hasPreviousSent = continuingReport?.results.some((result) => result.status === 'sent') ?? false
  const hasUnconfirmed = continuingReport?.results.some((result) => result.status === 'unconfirmed') ?? false
  const retrying = !!continuingReport

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings])
  useEffect(() => {
    localStorage.setItem('website-workbench:view:v1', viewMode)
  }, [viewMode])
  useEffect(() => {
    localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(siteOrder))
  }, [siteOrder])
  useEffect(() => {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, String(sidebarCollapsed))
  }, [sidebarCollapsed])
  useEffect(
    () =>
      bridge?.onPanelState((state) => {
        setStates((current) => ({ ...current, [state.id]: state }))
        if (editingAddress.current !== state.id && state.url.startsWith('https://'))
          setAddresses((current) => ({ ...current, [state.id]: state.url }))
      }),
    [bridge],
  )

  useEffect(() => {
    if (!bridge) return
    let frame = 0
    const synchronize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const positions: WebsitePanelBounds[] =
          modal || viewMode !== 'websites'
            ? []
            : visiblePanels.flatMap((panel) => {
                const rect = panelElements.current.get(panel.id)?.getBoundingClientRect()
                return rect && rect.width > 0 && rect.height > 0
                  ? [{ ...panel, bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }]
                  : []
              })
        bridge.syncPanels(positions).catch(() => setNotice('网站窗口初始化失败，请重新打开工作台。'))
      })
    }
    const observer = new ResizeObserver(synchronize)
    if (gridRef.current) observer.observe(gridRef.current)
    for (const element of panelElements.current.values()) observer.observe(element)
    window.addEventListener('resize', synchronize)
    synchronize()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', synchronize)
    }
  }, [bridge, modal, visiblePanels, viewMode])
  useEffect(
    () => () => {
      bridge?.syncPanels([]).catch(() => {})
    },
    [bridge],
  )

  const switchSite = useCallback((panelId: string, siteId: string) => {
    if (sendingRef.current) return
    const site = sites.find((item) => item.id === siteId)
    if (!site) return
    setSettings((current) => ({
      ...current,
      panels: current.panels.map((panel) => (panel.id === panelId ? { ...panel, siteId, url: site.url } : panel)),
    }))
    setAddresses((current) => ({ ...current, [panelId]: site.url }))
    setStates((current) => {
      const copy = { ...current }
      delete copy[panelId]
      return copy
    })
  }, [])

  const navigate = (panel: Panel) => {
    if (sendingRef.current) return
    try {
      const input = (addresses[panel.id] || states[panel.id]?.url || panel.url).trim()
      const url = new URL(input.includes('://') ? input : `https://${input}`)
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error()
      // Internal website navigation must not turn a repeated address submission into a no-op.
      if (bridge && url.href === panel.url)
        bridge.navigate(panel.id, url.href).catch(() => setNotice('无法前往该网址，请刷新后重试。'))
      setSettings((current) => ({
        ...current,
        panels: current.panels.map((item) => (item.id === panel.id ? { ...item, url: url.href } : item)),
      }))
      setAddresses((current) => ({ ...current, [panel.id]: url.href }))
      setNotice('')
    } catch {
      setNotice('请输入有效的 HTTPS 网站地址。')
    }
  }

  const openExternal = (url: string) => {
    if (bridge) bridge.openExternal(url).catch(() => setNotice('无法打开浏览器，请复制网址后打开。'))
    else window.open(url, '_blank', 'noopener,noreferrer')
  }
  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(message)
      setNotice('已复制，可以粘贴到任意 AI 官网的输入框。')
    } catch {
      setNotice('复制失败，请选中文本后使用复制快捷键。')
    }
  }
  const sendMessage = async () => {
    if (!bridge || !message.trim() || sendingRef.current || sendTargets.length === 0) return
    if (message.length > MAX_MESSAGE_LENGTH) {
      setNotice('消息最多支持 60000 字，请精简后再发送。')
      return
    }
    const submittedMessage = message
    const targets: BroadcastTarget[] = sendTargets.map((panel) => ({
      id: panel.id,
      siteId: panel.siteId,
      name: sites.find((site) => site.id === panel.siteId)!.name,
      number: settings.panels.findIndex((item) => item.id === panel.id) + 1,
    }))
    sendingRef.current = true
    setSending(true)
    setNotice('')
    let results: WebsiteBroadcastResult[]
    try {
      const returned = await bridge.broadcast({
        panelIds: targets.map((target) => target.id),
        siteIds: Object.fromEntries(targets.map((target) => [target.id, target.siteId])),
        message: submittedMessage,
      })
      results = targets.map((target) => {
        const result = returned.find((item) => item.id === target.id && item.siteId === target.siteId)
        return result && BROADCAST_LABELS[result.status]
          ? result
          : {
              id: target.id,
              siteId: target.siteId,
              status: 'unconfirmed',
              detail: '未收到明确结果，请查看官网是否已收到这段话。',
            }
      })
    } catch {
      results = targets.map((target) => ({
        id: target.id,
        siteId: target.siteId,
        status: 'unconfirmed',
        detail: '发送过程被中断，请先查看官网是否已收到，避免重复发送。',
      }))
    }
    const previous = continuingReport
    const unchanged = (target: { id: string; siteId: string }) =>
      !targets.some((item) => item.id === target.id && item.siteId === target.siteId)
    const nextReport: BroadcastReport = {
      message: submittedMessage,
      targets: [...(previous?.targets.filter(unchanged) ?? []), ...targets].sort((a, b) => a.number - b.number),
      results: [...(previous?.results.filter(unchanged) ?? []), ...results],
    }
    setReport(nextReport)
    if (nextReport.results.every((result) => result.status === 'sent')) {
      setMessage('')
      setNotice('')
    } else if (nextReport.results.some((result) => result.status === 'unconfirmed')) {
      setNotice('有窗口的发送结果需要确认，请先查看对应官网，避免重复发送。')
    } else {
      setNotice(
        nextReport.results.some((result) => result.status === 'sent')
          ? '部分窗口未发送。处理对应窗口的提示后，可以只重试未发送的窗口。'
          : '这次未能发送。处理对应窗口的提示后，可以重试未发送的窗口。',
      )
    }
    sendingRef.current = false
    setSending(false)
  }

  return (
    <main className={`website-workbench ${sidebarCollapsed ? 'website-sidebar-collapsed' : ''}`}>
      <aside className="website-sidebar">
        <div className="website-sidebar-header">
          <div className="website-brand" title="多智工作台">
            <img src={icon} alt="" />
            <div className="website-brand-copy">
              <strong>多智工作台</strong>
              <span>AI 官网，放在一个窗口</span>
            </div>
          </div>
          <button
            className="website-sidebar-toggle"
            type="button"
            title={sidebarCollapsed ? '展开菜单' : '收起菜单'}
            aria-label={sidebarCollapsed ? '展开菜单' : '收起菜单'}
            aria-expanded={!sidebarCollapsed}
            aria-controls="website-sidebar-nav"
            disabled={sending}
            onClick={() => setSidebarCollapsed((current) => !current)}
          >
            {sidebarCollapsed ? <ChevronRightIcon aria-hidden="true" /> : <ChevronLeftIcon aria-hidden="true" />}
          </button>
        </div>
        <button
          type="button"
          className={`website-nav ${viewMode === 'websites' && settings.count > 1 ? 'active' : ''}`}
          aria-label="官网同屏"
          title="官网同屏"
          disabled={sending || groupBusy}
          onClick={() => {
            setViewMode('websites')
            setSettings((current) => ({ ...current, count: 2 }))
          }}
        >
          <Squares2X2Icon />
          <span className="website-nav-text">官网同屏</span>
        </button>
        {bridge?.groupChat && (
          <button
            type="button"
            className={`website-nav ${viewMode === 'group-chat' ? 'active' : ''}`}
            aria-label="AI 群聊"
            title="AI 群聊"
            disabled={sending || groupBusy}
            onClick={() => setViewMode('group-chat')}
          >
            <ChatBubbleLeftRightIcon aria-hidden="true" />
            <span className="website-nav-text">AI 群聊</span>
          </button>
        )}
        <p className="website-nav-label" id="website-sort-hint">
          打开单个官网 · 拖动排序
        </p>
        <nav id="website-sidebar-nav" aria-label="AI 官网">
          {orderedSites.map((site) => (
            <button
              key={site.id}
              type="button"
              disabled={sending || groupBusy}
              data-site-id={site.id}
              aria-label={site.name}
              aria-describedby="website-sort-hint"
              title={`${site.name} · 拖动排序，或按住 Alt 键配合上下方向键`}
              className={`website-nav website-sortable ${
                viewMode === 'websites' && settings.count === 1 && settings.panels[0].siteId === site.id ? 'active' : ''
              } ${draggingSite === site.id ? 'dragging' : ''} ${
                dropTarget?.id === site.id ? `drop-${dropTarget.position}` : ''
              }`}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                ignoreSortClick.current = false
                sidebarDrag.current = { id: site.id, x: event.clientX, y: event.clientY, active: false }
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onPointerMove={(event) => {
                const drag = sidebarDrag.current
                if (!drag) return
                if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return
                drag.active = true
                setDraggingSite(drag.id)
                const target = sidebarDropTarget(event)
                setDropTarget(target?.id === drag.id ? null : target)
              }}
              onPointerUp={(event) => {
                const drag = sidebarDrag.current
                const target = drag?.active ? sidebarDropTarget(event) : null
                if (drag?.active) ignoreSortClick.current = true
                if (drag && target && drag.id !== target.id) {
                  setSiteOrder((current) => {
                    const next = current.filter((id) => id !== drag.id)
                    next.splice(next.indexOf(target.id) + Number(target.position === 'after'), 0, drag.id)
                    return next
                  })
                }
                sidebarDrag.current = null
                setDraggingSite(null)
                setDropTarget(null)
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId)
              }}
              onLostPointerCapture={() => {
                sidebarDrag.current = null
                setDraggingSite(null)
                setDropTarget(null)
              }}
              onKeyDown={(event) => {
                if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
                event.preventDefault()
                setSiteOrder((current) => {
                  const from = current.indexOf(site.id)
                  const to = from + (event.key === 'ArrowUp' ? -1 : 1)
                  if (to < 0 || to >= current.length) return current
                  const next = [...current]
                  ;[next[from], next[to]] = [next[to], next[from]]
                  return next
                })
              }}
              onClick={() => {
                if (ignoreSortClick.current) {
                  ignoreSortClick.current = false
                  return
                }
                switchSite('panel-0', site.id)
                setViewMode('websites')
                setSettings((current) => ({ ...current, count: 1 }))
              }}
            >
              <AiLogo id={site.id} className="website-mark" />
              <span className="website-nav-text">{site.name}</span>
              <Bars3Icon className="website-drag-handle" aria-hidden="true" />
            </button>
          ))}
        </nav>
        <div className="website-sidebar-bottom">
          <button
            aria-label="使用说明与项目来源"
            title="使用说明与项目来源"
            disabled={sending}
            onClick={() => setModal(true)}
          >
            <InformationCircleIcon className="website-help-icon" aria-hidden="true" />
            <span className="website-nav-text">使用说明与项目来源</span>
          </button>
          <span>{bridge ? '桌面版 · 官网浏览' : '浏览器版 · 链接预览'}</span>
        </div>
      </aside>
      {viewMode === 'group-chat' && bridge?.groupChat ? (
        <GroupChatWorkspace bridge={bridge} siteOrder={siteOrder} onBusyChange={setGroupBusy} />
      ) : (
        <section className="website-workspace">
          <header className="website-workspace-header">
            <div>
              <h1>
                {settings.count === 1 ? sites.find((site) => site.id === settings.panels[0].siteId)?.name : '官网同屏'}
              </h1>
              <p>在每个官网里独立登录、聊天和查看历史记录</p>
            </div>
            <div className="website-header-feedback">
              {notice && (
                <div className="website-notice" role="status">
                  <span title={notice}>{notice}</span>
                  <button aria-label="关闭提示" onClick={() => setNotice('')}>
                    <XMarkIcon />
                  </button>
                </div>
              )}
            </div>
            <div className="website-layouts" role="group" aria-label="窗口布局">
              {COUNTS.map((count) => (
                <button
                  key={count}
                  disabled={sending}
                  aria-pressed={settings.count === count}
                  onClick={() => setSettings((current) => ({ ...current, count }))}
                >
                  {count} 窗口
                </button>
              ))}
            </div>
          </header>
          <div className={`website-grid website-grid-${settings.count}`} ref={gridRef}>
            {visiblePanels.map((panel) => {
              const site = sites.find((item) => item.id === panel.siteId)!
              const state = states[panel.id]
              const broadcastResult = report?.results.find(
                (result) => result.id === panel.id && result.siteId === panel.siteId,
              )
              const sendingToPanel =
                sending && sendTargets.some((target) => target.id === panel.id && target.siteId === panel.siteId)
              const sendStatus = sendingToPanel ? 'sending' : broadcastResult?.status
              const sendLabel = sendingToPanel
                ? '发送中…'
                : broadcastResult
                  ? BROADCAST_LABELS[broadcastResult.status]
                  : ''
              const sendDetail = sendingToPanel
                ? `正在向 ${site.name} 发送统一输入内容。`
                : broadcastResult
                  ? `上次发送：${sendLabel}。${broadcastResult.detail}`
                  : undefined
              return (
                <article key={panel.id} className="website-panel" aria-label={`${site.name} 官网窗口`}>
                  <div className="website-panel-toolbar">
                    <AiLogo id={site.id} className="website-mark" />
                    <select
                      aria-label={`选择${panel.id}的 AI 官网`}
                      value={panel.siteId}
                      disabled={sending}
                      onChange={(event) => switchSite(panel.id, event.target.value)}
                    >
                      {orderedSites.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                    <span
                      className={`website-panel-status ${
                        sendStatus ? `website-panel-send-status status-${sendStatus}` : ''
                      }`}
                      role="status"
                      title={sendDetail}
                      aria-label={sendDetail}
                    >
                      {sendLabel}
                    </span>
                    <IconButton
                      label={`在浏览器打开 ${site.name}`}
                      onClick={() => openExternal(state?.url || panel.url)}
                    >
                      <ArrowTopRightOnSquareIcon />
                    </IconButton>
                  </div>
                  <form
                    className="website-address-bar"
                    onSubmit={(event) => {
                      event.preventDefault()
                      navigate(panel)
                    }}
                  >
                    <IconButton
                      label={`${site.name} 返回`}
                      disabled={sending || !state?.canGoBack}
                      onClick={() => bridge?.command(panel.id, 'back')}
                    >
                      <ArrowLeftIcon />
                    </IconButton>
                    <IconButton
                      label={`${site.name} 前进`}
                      disabled={sending || !state?.canGoForward}
                      onClick={() => bridge?.command(panel.id, 'forward')}
                    >
                      <ArrowRightIcon />
                    </IconButton>
                    <IconButton
                      label={`刷新 ${site.name}`}
                      disabled={sending}
                      onClick={() => (bridge ? bridge.command(panel.id, 'reload') : navigate(panel))}
                    >
                      <ArrowPathIcon />
                    </IconButton>
                    <input
                      aria-label={`${site.name} 网址`}
                      disabled={sending}
                      value={addresses[panel.id] ?? state?.url ?? panel.url}
                      onChange={(event) => setAddresses((current) => ({ ...current, [panel.id]: event.target.value }))}
                      onFocus={() => {
                        editingAddress.current = panel.id
                      }}
                      onBlur={() => {
                        editingAddress.current = null
                      }}
                      spellCheck={false}
                    />
                    <button className="website-go" type="submit" disabled={sending}>
                      前往
                    </button>
                  </form>
                  {state?.error && (
                    <p className="website-error" role="status">
                      {state.error}
                    </p>
                  )}
                  <div
                    className="website-browser-content"
                    ref={(element) => {
                      if (element) panelElements.current.set(panel.id, element)
                      else panelElements.current.delete(panel.id)
                    }}
                  >
                    {bridge ? (
                      <div className="website-loading">
                        <AiLogo id={site.id} className="website-mark" />
                        <p>正在打开 {site.name} 官网</p>
                      </div>
                    ) : (
                      <div className="website-fallback">
                        <AiLogo id={site.id} className="website-mark" />
                        <h2>{site.name}</h2>
                        <p>{panel.url}</p>
                        <button onClick={() => openExternal(panel.url)}>打开官网</button>
                        <small>官网同窗显示请使用桌面版。</small>
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
          <footer className="website-shared-text">
            <div className="website-shared-heading">
              <label htmlFor="website-shared-prompt">统一输入</label>
              <span>当前打开 {visiblePanels.length} 个窗口</span>
            </div>
            <div className="website-shared-editor">
              <textarea
                id="website-shared-prompt"
                placeholder="写一段话，同时发给当前打开的 AI"
                rows={2}
                maxLength={MAX_MESSAGE_LENGTH}
                aria-describedby="website-shared-hint"
                value={message}
                disabled={sending}
                onChange={(event) => setMessage(event.target.value)}
                onCompositionStart={() => {
                  composingRef.current = true
                }}
                onCompositionEnd={() => {
                  composingRef.current = false
                }}
                onKeyDown={(event) => {
                  if (
                    event.key !== 'Enter' ||
                    event.shiftKey ||
                    composingRef.current ||
                    event.nativeEvent.isComposing ||
                    event.keyCode === 229
                  )
                    return
                  event.preventDefault()
                  void sendMessage()
                }}
              />
              <p className="website-shared-hint" id="website-shared-hint">
                {!bridge
                  ? '群发请使用桌面版；此处可以复制文本。'
                  : sending
                    ? `正在发送到 ${sendTargets.length} 个窗口，请稍候…`
                    : hasUnconfirmed
                      ? '需要确认的窗口请先查看官网；重试只包含明确未发送的窗口。'
                      : hasPreviousSent
                        ? '重试只发送到未成功的窗口，已发送的窗口不会重复接收。'
                        : 'Enter 发送 · Shift + Enter 换行 · 先在各个官网登录'}
              </p>
            </div>
            <div className="website-shared-actions">
              <button
                className="website-send"
                type="button"
                disabled={!bridge || !message.trim() || sending || sendTargets.length === 0}
                onClick={() => {
                  void sendMessage()
                }}
              >
                <PaperAirplaneIcon aria-hidden="true" />
                {sending
                  ? '正在发送…'
                  : retrying
                    ? sendTargets.length > 0
                      ? `重试 ${sendTargets.length} 个窗口`
                      : hasUnconfirmed
                        ? '请先确认官网结果'
                        : '当前窗口已发送'
                    : '发送到所有窗口'}
              </button>
              <button className="website-copy" type="button" disabled={!message.trim() || sending} onClick={copyText}>
                复制文本
              </button>
            </div>
          </footer>
        </section>
      )}
      {modal && (
        <div className="website-modal-backdrop">
          <section role="dialog" aria-modal="true" aria-labelledby="website-help-title" className="website-modal">
            <button className="website-modal-close" aria-label="关闭使用说明" onClick={() => setModal(false)}>
              <XMarkIcon />
            </button>
            <h2 id="website-help-title">AI 官网工作台</h2>
            <p>每个面板都直接加载对应 AI 的官方网站。选择顶部的窗口数量，再在每个窗口左上角选择 AI。</p>
            <p>首次使用需要在各个官网中登录。桌面版会保存登录状态，Chrome 中的账号不会自动导入。</p>
            <p>
              聊天、文件上传、模型选择和历史记录由官网提供，网页内容与语言遵循各平台的设置。下方的统一输入会把同一段话发送到当前打开的窗口；隐藏窗口不会收到。
            </p>
            <p>
              Enter 发送，Shift + Enter
              换行。发送后可在每个窗口右上角查看结果；部分成功时，重试只发送到未成功的窗口。需要确认的结果请先查看对应官网。
            </p>
            <p>
              官网未登录、正在回复、已有草稿或暂不支持时会提示原因，请先处理再重试。官网更新可能影响群发，可以使用“复制文本”手动粘贴。
            </p>
            <p>如官网要求安全验证，或限制桌面浏览器登录，可以使用面板右上角的“在浏览器打开”按钮。</p>
            <p className="website-source">
              本项目基于 ChatHub 的 GPL-3.0 公开源码，保留来源与原作者版权。
              <button onClick={() => openExternal('https://github.com/chathub-dev/chathub')}>查看开源来源</button>
            </p>
            <button className="website-primary" onClick={() => setModal(false)}>
              开始使用
            </button>
          </section>
        </div>
      )}
    </main>
  )
}
