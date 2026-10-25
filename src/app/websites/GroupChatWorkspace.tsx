import { Dialog } from '@headlessui/react'
import {
  ArchiveBoxIcon,
  ArrowDownIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpIcon,
  ChatBubbleLeftRightIcon,
  ClipboardDocumentIcon,
  FolderOpenIcon,
  PaperAirplaneIcon,
  PencilSquareIcon,
  PlusIcon,
  StopIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import clsx, { type ClassValue } from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { twMerge } from 'tailwind-merge'
import type { GroupConversation, GroupMember, GroupMessage, GroupRunMode, GroupSnapshot } from './group-types'
import type { WebsiteDesktopBridge } from './types'
import AiLogo from './AiLogo'
import './group-chat.scss'

const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
const DRAFT_KEY = 'website-workbench:group-drafts:v1'
const SELECTED_KEY = 'website-workbench:selected-group:v1'
const MAX_LENGTH = 30000
const STATUS_LABELS: Record<GroupMessage['status'], string> = {
  queued: '等待中',
  sending: '正在发送',
  streaming: '正在回复',
  done: '已完成',
  error: '未完成',
  cancelled: '已停止调度',
  unconfirmed: '需要确认',
}

type Options = { targets: string[]; mode: GroupRunMode }
type EditDraft = { id?: string; title: string; members: string[]; roles: Record<string, string>; workspace: string }
type Props = { bridge: WebsiteDesktopBridge; siteOrder: string[]; onBusyChange: (busy: boolean) => void }

function readDrafts(): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        )
      : {}
  } catch {
    return {}
  }
}

function readSelected(): string {
  try {
    return localStorage.getItem(SELECTED_KEY) || ''
  } catch {
    return ''
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请稍后再试。'
}

function canSend(member: GroupMember): boolean {
  return member.supported
}

// 点名只认群内完整名称或标识，避免把 ChatGPT 与相似名称混为同一位成员。
function mentionedTargets(content: string, members: GroupMember[]): { targets: string[] | null; error?: string } {
  if (/(?:^|[\s，。！？、,:;；：()\[\]{}])@(所有人|all|everyone)(?=$|[\s，。！？、,:;；：()\[\]{}])/i.test(content))
    return { targets: members.map((member) => member.id) }
  const targets: string[] = []
  const names = members
    .flatMap((member) => [
      { text: member.name, id: member.id },
      { text: member.id, id: member.id },
    ])
    .sort((a, b) => b.text.length - a.text.length)
  const boundary = /[\s，。！？、,:;；：()\[\]{}]/u
  let mentioned = false
  for (let index = 0; index < content.length; index++) {
    if (content[index] !== '@' || (index > 0 && !boundary.test(content[index - 1]))) continue
    const rest = content.slice(index + 1)
    const match = names.find(
      ({ text }) =>
        rest.slice(0, text.length).toLocaleLowerCase() === text.toLocaleLowerCase() &&
        (!rest[text.length] || boundary.test(rest[text.length])),
    )
    if (!match)
      return {
        targets: null,
        error: `没有找到点名的群成员：${rest.split(/[\s，。！？、,:;；：]/u)[0]}。请使用下方的点名按钮。`,
      }
    mentioned = true
    if (!targets.includes(match.id)) targets.push(match.id)
    index += match.text.length
  }
  return { targets: mentioned ? targets : null }
}

function Avatar({ member, name }: { member?: GroupMember; name?: string }) {
  if (member?.kind === 'website' || member?.kind === 'cli') return <AiLogo id={member.id} className="group-avatar" />
  return (
    <span className="group-avatar group-avatar-placeholder" aria-hidden="true">
      {name?.slice(0, 1) || '你'}
    </span>
  )
}

function MessageContent({ content, openLink }: { content: string; openLink: (url: string) => void }) {
  return (
    <ReactMarkdown
      className="group-markdown"
      remarkPlugins={[remarkGfm, remarkBreaks]}
      skipHtml
      components={{
        a: ({ href, children }) => {
          let safe = ''
          try {
            const url = new URL(href || '')
            if (url.protocol === 'https:' || url.protocol === 'http:') safe = url.href
          } catch {
            /* 没有合法地址的链接按文字显示。 */
          }
          return safe ? (
            <a
              href={safe}
              onClick={(event) => {
                event.preventDefault()
                openLink(safe)
              }}
            >
              {children}
            </a>
          ) : (
            <span>{children}</span>
          )
        },
        img: ({ alt }) => <span className="group-image-note">[图片{alt ? `：${alt}` : ''}]</span>,
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

export default function GroupChatWorkspace({ bridge, siteOrder, onBusyChange }: Props) {
  const [snapshot, setSnapshot] = useState<GroupSnapshot | null>(null)
  const [selectedId, setSelectedId] = useState(readSelected)
  const [drafts, setDrafts] = useState(readDrafts)
  const [options, setOptions] = useState<Record<string, Options>>({})
  const [loadError, setLoadError] = useState('')
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})
  const [actionNotices, setActionNotices] = useState<Record<string, string>>({})
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [editError, setEditError] = useState('')
  const [archiveTarget, setArchiveTarget] = useState<GroupConversation | null>(null)
  const [archiveError, setArchiveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [openingMember, setOpeningMember] = useState('')
  const [choosingWorkspace, setChoosingWorkspace] = useState(false)
  const [loadVersion, setLoadVersion] = useState(0)
  const sendingRef = useRef(false)
  const savingRef = useRef(false)
  const composingRef = useRef(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messageListRef = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const lastConversation = useRef('')
  const activeRun = snapshot?.activeRun || null
  const busy = sending || !!activeRun
  const conversations = (snapshot?.conversations || []).filter((conversation) => !conversation.archived)
  const conversation = conversations.find((item) => item.id === selectedId) || conversations[0]
  const actionError = conversation ? actionErrors[conversation.id] || '' : ''
  const actionNotice = conversation ? actionNotices[conversation.id] || '' : ''
  const memberById = useMemo(
    () => new Map((snapshot?.members || []).map((member) => [member.id, member])),
    [snapshot?.members],
  )
  const members = (conversation?.members || []).flatMap((id) => (memberById.has(id) ? [memberById.get(id)!] : []))
  const currentOptions = conversation
    ? options[conversation.id] || {
        targets: members.filter(canSend).map((member) => member.id),
        mode: 'parallel' as const,
      }
    : { targets: [], mode: 'parallel' as const }
  const content = conversation ? drafts[conversation.id] || '' : ''
  const messages = conversation ? snapshot?.messages[conversation.id] || [] : []
  const mentions = mentionedTargets(content, members)
  const effectiveTargets = mentions.targets || currentOptions.targets.filter((id) => conversation?.members.includes(id))
  const orderedMembers = useMemo(
    () =>
      (snapshot?.members || []).slice().sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'website' ? -1 : 1
        const first = siteOrder.indexOf(a.id.replace(/^web:/, ''))
        const second = siteOrder.indexOf(b.id.replace(/^web:/, ''))
        return (first < 0 ? siteOrder.length : first) - (second < 0 ? siteOrder.length : second)
      }),
    [snapshot?.members, siteOrder],
  )

  useEffect(() => {
    let alive = true
    let receivedChange = false
    const dispose = bridge.groupChat.onChange((next) => {
      if (!alive) return
      receivedChange = true
      setSnapshot(next)
      setLoadError('')
    })
    bridge.groupChat
      .list()
      .then((next) => {
        if (alive && !receivedChange) {
          setSnapshot(next)
          setLoadError('')
        }
      })
      .catch((error) => {
        if (alive && !receivedChange) setLoadError(errorText(error))
      })
    return () => {
      alive = false
      dispose()
    }
  }, [bridge, loadVersion])

  useEffect(() => {
    onBusyChange(busy)
  }, [busy, onBusyChange])
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts))
    } catch {
      /* 存储不可用时继续保留当前草稿。 */
    }
  }, [drafts])
  useEffect(() => {
    if (!conversation) return
    try {
      localStorage.setItem(SELECTED_KEY, conversation.id)
    } catch {
      /* 不影响当前会话。 */
    }
  }, [conversation?.id])
  useEffect(() => {
    const element = messageListRef.current
    if (!element) return
    if (lastConversation.current !== conversation?.id || nearBottom.current) element.scrollTop = element.scrollHeight
    lastConversation.current = conversation?.id || ''
  }, [conversation?.id, messages])

  function selectConversation(id: string) {
    setSelectedId(id)
    nearBottom.current = true
  }

  // 异步操作捕获发起时的群 ID，切换群聊后不会把旧群的结果提示写到新群。
  function setActionError(value: string, id = conversation?.id) {
    if (id) setActionErrors((current) => ({ ...current, [id]: value }))
  }

  function setActionNotice(value: string, id = conversation?.id) {
    if (id) setActionNotices((current) => ({ ...current, [id]: value }))
  }

  function setContent(value: string) {
    if (!conversation) return
    setDrafts((current) => ({ ...current, [conversation.id]: value }))
    setActionError('')
    setActionNotice('')
  }

  function updateOptions(next: Partial<Options>) {
    if (!conversation) return
    setOptions((current) => ({ ...current, [conversation.id]: { ...currentOptions, ...next } }))
    setActionError('')
  }

  function toggleTarget(id: string) {
    updateOptions({
      targets: currentOptions.targets.includes(id)
        ? currentOptions.targets.filter((target) => target !== id)
        : [...currentOptions.targets, id],
    })
  }

  function moveTarget(index: number, direction: -1 | 1) {
    const targets = currentOptions.targets.slice()
    const destination = index + direction
    if (destination < 0 || destination >= targets.length) return
    ;[targets[index], targets[destination]] = [targets[destination], targets[index]]
    updateOptions({ targets })
  }

  function appendMention(name: string) {
    const input = inputRef.current
    const start = input?.selectionStart ?? content.length
    const end = input?.selectionEnd ?? content.length
    const prefix = content.slice(0, start)
    const addition = `${prefix && !/\s$/.test(prefix) ? ' ' : ''}@${name} `
    const next = `${prefix}${addition}${content.slice(end)}`
    if (next.length > MAX_LENGTH) {
      setActionError('消息最多可输入 30000 个字符。')
      return
    }
    setContent(next)
    requestAnimationFrame(() => {
      input?.focus()
      input?.setSelectionRange(start + addition.length, start + addition.length)
    })
  }

  function newConversation() {
    setEditError('')
    const defaults = ['web:chatgpt', 'web:gemini'].filter((id) => memberById.get(id)?.supported)
    setEditDraft({
      title: '',
      members: defaults.length
        ? defaults
        : orderedMembers
            .filter((member) => member.kind === 'website' && member.supported)
            .slice(0, 2)
            .map((member) => member.id),
      roles: {},
      workspace: '',
    })
  }

  function editConversation() {
    if (!conversation) return
    setEditError('')
    setEditDraft({
      id: conversation.id,
      title: conversation.title,
      members: [...conversation.members],
      roles: { ...conversation.roles },
      workspace: conversation.workspace || '',
    })
  }

  function toggleEditMember(member: GroupMember) {
    if (!editDraft) return
    if (editDraft.members.includes(member.id)) {
      setEditDraft({ ...editDraft, members: editDraft.members.filter((id) => id !== member.id) })
      setEditError('')
      return
    }
    const websiteCount = editDraft.members.filter((id) => memberById.get(id)?.kind === 'website').length
    if (editDraft.members.length >= 8 || (member.kind === 'website' && websiteCount >= 6)) {
      setEditError('每个群最多 6 位官网成员和 2 位执行助手。')
      return
    }
    setEditDraft({ ...editDraft, members: [...editDraft.members, member.id] })
    setEditError('')
  }

  async function saveConversation() {
    if (!editDraft || savingRef.current || busy) return
    const websiteCount = editDraft.members.filter((id) => memberById.get(id)?.kind === 'website').length
    if (!editDraft.title.trim()) {
      setEditError('请填写群聊名称。')
      return
    }
    if (!editDraft.members.length || websiteCount > 6 || editDraft.members.length > 8) {
      setEditError('请至少选择一位成员，最多 6 位官网成员和 2 位执行助手。')
      return
    }
    if (editDraft.members.some((id) => memberById.get(id)?.kind === 'cli') && !editDraft.workspace) {
      setEditError('使用执行助手前，请选择它可以操作的工作文件夹。')
      return
    }
    savingRef.current = true
    setSaving(true)
    setEditError('')
    try {
      const saved = await bridge.groupChat.save({
        ...editDraft,
        title: editDraft.title.trim(),
        workspace: editDraft.workspace || undefined,
      })
      // save 返回值可立即选择；完整消息与成员状态仍以后台快照为准。
      setSnapshot((current) =>
        current
          ? { ...current, conversations: [...current.conversations.filter((item) => item.id !== saved.id), saved] }
          : current,
      )
      selectConversation(saved.id)
      setOptions((current) => ({
        ...current,
        [saved.id]: {
          targets: saved.members.filter((id) => {
            const member = memberById.get(id)
            return member ? canSend(member) : false
          }),
          mode: 'parallel',
        },
      }))
      setEditDraft(null)
    } catch (error) {
      setEditError(errorText(error))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  async function chooseWorkspace() {
    if (choosingWorkspace || !editDraft) return
    setChoosingWorkspace(true)
    setEditError('')
    try {
      const workspace = await bridge.groupChat.chooseWorkspace()
      if (workspace) setEditDraft((current) => (current ? { ...current, workspace } : current))
    } catch (error) {
      setEditError(errorText(error))
    } finally {
      setChoosingWorkspace(false)
    }
  }

  async function archiveConversation() {
    if (!archiveTarget || savingRef.current || busy) return
    savingRef.current = true
    setSaving(true)
    setArchiveError('')
    try {
      await bridge.groupChat.archive(archiveTarget.id)
      setSnapshot((current) =>
        current
          ? { ...current, conversations: current.conversations.filter((item) => item.id !== archiveTarget.id) }
          : current,
      )
      setArchiveTarget(null)
      setSelectedId('')
    } catch (error) {
      setArchiveError(errorText(error))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  async function send() {
    if (!conversation || sendingRef.current || busy || !content.trim()) return
    if (mentions.error) {
      setActionError(mentions.error)
      return
    }
    if (content.length > MAX_LENGTH) {
      setActionError('消息最多可输入 30000 个字符。')
      return
    }
    if (!effectiveTargets.length) {
      setActionError('请勾选至少一位接收成员，或使用 @ 点名。')
      return
    }
    const unsupported = effectiveTargets.map((id) => memberById.get(id)).find((member) => member && !member.supported)
    if (effectiveTargets.some((id) => !memberById.has(id)) || unsupported) {
      setActionError(`${unsupported?.name || '所选成员'}暂不支持群聊：${unsupported?.detail || '请检查成员设置。'}`)
      return
    }
    if (currentOptions.mode === 'relay' && effectiveTargets.length < 2) {
      setActionError('依次接力需要至少选择两位成员。')
      return
    }
    sendingRef.current = true
    setSending(true)
    setActionError('')
    setActionNotice('')
    nearBottom.current = true
    const sentContent = content
    const id = conversation.id
    try {
      await bridge.groupChat.send({
        conversationId: id,
        content: sentContent,
        targets: effectiveTargets,
        mode: currentOptions.mode,
      })
      setDrafts((current) => (current[id] === sentContent ? { ...current, [id]: '' } : current))
    } catch (error) {
      setActionError(errorText(error))
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  async function stop() {
    if (!activeRun || stopping) return
    setStopping(true)
    setActionError('')
    try {
      await bridge.groupChat.stop(activeRun.id)
    } catch (error) {
      setActionError(errorText(error))
    } finally {
      setStopping(false)
    }
  }

  async function openMember(member: GroupMember) {
    if (!conversation || busy || openingMember) return
    setOpeningMember(member.id)
    setActionError('')
    try {
      await bridge.groupChat.openMember(conversation.id, member.id)
    } catch (error) {
      setActionError(errorText(error))
    } finally {
      setOpeningMember('')
    }
  }

  function openLink(rawUrl: string) {
    try {
      const url = new URL(rawUrl)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('这个链接不是网页地址。')
      bridge.openExternal(url.href).catch((error) => setActionError(errorText(error)))
    } catch (error) {
      setActionError(errorText(error))
    }
  }

  async function copyMessage(message: GroupMessage) {
    try {
      await navigator.clipboard.writeText(message.content)
      setActionNotice(`已复制 ${message.speakerName} 的消息。`)
      setActionError('')
    } catch {
      setActionError('复制失败，请手动选择消息文字后复制。')
    }
  }

  return (
    <section className="group-workspace" aria-label="AI 群聊">
      <aside className="group-conversations">
        <div className="group-list-heading">
          <h1>AI 群聊</h1>
          {conversations.length > 0 && (
            <button
              type="button"
              className="group-icon-button"
              aria-label="新建群聊"
              title="新建群聊"
              disabled={busy}
              onClick={newConversation}
            >
              <PlusIcon aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="group-list-description">点名讨论，分工协作</p>
        {loadError ? (
          <div className="group-load-error">
            <p role="alert">{loadError}</p>
            <button
              type="button"
              className="group-button"
              onClick={() => {
                setLoadError('')
                setLoadVersion((value) => value + 1)
              }}
            >
              重新加载
            </button>
          </div>
        ) : !snapshot ? (
          <div className="group-loading" role="status">
            正在加载群聊…
          </div>
        ) : (
          <nav aria-label="群聊列表" className="group-list">
            {conversations.map((item) => {
              const last = snapshot.messages[item.id]?.at(-1)
              return (
                <button
                  type="button"
                  key={item.id}
                  className={cn('group-list-item', item.id === conversation?.id && 'selected')}
                  aria-current={item.id === conversation?.id ? 'true' : undefined}
                  onClick={() => selectConversation(item.id)}
                >
                  <span className="group-list-avatar" aria-hidden="true">
                    <ChatBubbleLeftRightIcon />
                  </span>
                  <span className="group-list-copy">
                    <strong>{item.title}</strong>
                    <span>
                      {snapshot.activeRun?.conversationId === item.id
                        ? '成员正在工作…'
                        : last?.content || last?.detail || `${item.members.length} 位成员 · 尚未开始讨论`}
                    </span>
                  </span>
                </button>
              )
            })}
          </nav>
        )}
      </aside>
      <div className="group-chat-main">
        {!conversation ? (
          <div className="group-empty">
            <ChatBubbleLeftRightIcon aria-hidden="true" />
            <h2>把多个 AI 放进一个群聊</h2>
            <p>选择成员后，可以点名回答，也可以让它们依次评审和汇总。</p>
            <button
              type="button"
              className="group-button group-button-primary"
              disabled={!snapshot || busy || !!loadError}
              onClick={newConversation}
            >
              <PlusIcon aria-hidden="true" />
              新建群聊
            </button>
          </div>
        ) : (
          <>
            <header className="group-chat-header">
              <div className="group-chat-heading">
                <h2>
                  {conversation.title}
                  <span>（{conversation.members.length}）</span>
                </h2>
                <p role="status">
                  {activeRun?.conversationId === conversation.id
                    ? `${activeRun.mode === 'relay' ? '依次接力' : '一起回答'} · 成员正在工作`
                    : activeRun
                      ? '另一群聊正在运行，完成或停止后可发送'
                      : '回复集中在这里，官网账号继续使用各自的登录状态'}
                </p>
              </div>
              <button
                type="button"
                className="group-icon-button"
                aria-label="编辑群聊"
                title="编辑群聊"
                disabled={busy}
                onClick={editConversation}
              >
                <PencilSquareIcon aria-hidden="true" />
              </button>
              <button
                type="button"
                className="group-icon-button"
                aria-label="归档群聊"
                title="归档群聊"
                disabled={busy}
                onClick={() => {
                  setArchiveError('')
                  setArchiveTarget(conversation)
                }}
              >
                <ArchiveBoxIcon aria-hidden="true" />
              </button>
            </header>
            <div className="group-member-bar" aria-label="群聊成员">
              {members.map((member) => (
                <div key={member.id} className="group-member-item">
                  <Avatar member={member} />
                  <span className="group-member-name" title={member.detail}>
                    <strong>{member.name}</strong>
                    <small>
                      {member.kind === 'cli'
                        ? member.available
                          ? '执行助手'
                          : member.detail || '执行助手未就绪'
                        : member.supported
                          ? '打开官网检查登录'
                          : member.detail || '暂不支持群聊'}
                    </small>
                  </span>
                  {member.kind === 'website' && (
                    <button
                      type="button"
                      className="group-icon-button"
                      aria-label={`打开 ${member.name} 官网或登录`}
                      title={`打开 ${member.name} 官网或登录`}
                      disabled={busy || !!openingMember}
                      onClick={() => void openMember(member)}
                    >
                      <ArrowTopRightOnSquareIcon aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div
              className="group-messages"
              ref={messageListRef}
              onScroll={() => {
                const element = messageListRef.current
                if (element) nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100
              }}
            >
              {messages.length === 0 ? (
                <div className="group-chat-start">
                  <p>群聊已准备好</p>
                  <span>在下方写下任务，勾选成员或使用 @ 点名后发送。</span>
                </div>
              ) : (
                messages.map((message) => {
                  const user = message.speakerId === 'user'
                  const member = memberById.get(message.speakerId)
                  return (
                    <article
                      key={message.id}
                      className={cn('group-message', user && 'group-message-user')}
                      aria-label={`${message.speakerName}：${STATUS_LABELS[message.status]}`}
                    >
                      <Avatar member={user ? undefined : member} name={message.speakerName} />
                      <div className="group-message-body">
                        <div className="group-message-meta">
                          <strong>{message.speakerName}</strong>
                          <time dateTime={new Date(message.createdAt).toISOString()}>
                            {new Date(message.createdAt).toLocaleTimeString('zh-CN', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </time>
                          {message.step && <span>{message.step}</span>}
                        </div>
                        <div className="group-message-bubble">
                          {message.content ? (
                            <MessageContent content={message.content} openLink={openLink} />
                          ) : (
                            <span className="group-message-placeholder">{STATUS_LABELS[message.status]}</span>
                          )}
                        </div>
                        <div className="group-message-footer">
                          <span className={cn('group-message-status', `status-${message.status}`)}>
                            {STATUS_LABELS[message.status]}
                          </span>
                          {message.content && (
                            <button
                              type="button"
                              className="group-icon-button"
                              aria-label={`复制 ${message.speakerName} 的消息`}
                              title="复制消息"
                              onClick={() => void copyMessage(message)}
                            >
                              <ClipboardDocumentIcon aria-hidden="true" />
                            </button>
                          )}
                          {message.sourceUrl && (
                            <button
                              type="button"
                              className="group-text-button"
                              onClick={() => openLink(message.sourceUrl!)}
                            >
                              查看官网原文
                            </button>
                          )}
                        </div>
                        {message.detail && (
                          <p
                            className={cn(
                              'group-message-detail',
                              ['error', 'unconfirmed'].includes(message.status) && 'has-error',
                            )}
                          >
                            {message.detail}
                          </p>
                        )}
                        {message.status === 'cancelled' && member?.kind === 'website' && (
                          <p className="group-message-detail">已停止后续调度；官网可能继续回复，请打开原网页检查。</p>
                        )}
                      </div>
                    </article>
                  )
                })
              )}
            </div>
            <div className="group-composer">
              <div className="group-composer-settings">
                <div className="group-mode-label" role="group" aria-label="讨论方式">
                  <span aria-hidden="true">讨论方式</span>
                  <button
                    type="button"
                    aria-pressed={currentOptions.mode === 'parallel'}
                    disabled={busy}
                    onClick={() => updateOptions({ mode: 'parallel' })}
                  >
                    一起回答
                  </button>
                  <button
                    type="button"
                    aria-pressed={currentOptions.mode === 'relay'}
                    disabled={busy}
                    onClick={() => updateOptions({ mode: 'relay' })}
                  >
                    依次接力
                  </button>
                </div>
                {currentOptions.mode === 'parallel' && (
                  <span className="group-mode-note">官网成员一起回答，执行助手按队列运行。</span>
                )}
                <div className="group-targets" role="group" aria-label="接收成员">
                  {members.map((member) => (
                    <label
                      key={member.id}
                      className={cn(
                        'group-target',
                        effectiveTargets.includes(member.id) && 'selected',
                        !canSend(member) && 'unavailable',
                      )}
                      title={member.detail}
                    >
                      <input
                        type="checkbox"
                        checked={effectiveTargets.includes(member.id)}
                        disabled={busy || !!mentions.targets || !canSend(member)}
                        onChange={() => toggleTarget(member.id)}
                      />
                      {member.name}
                    </label>
                  ))}
                </div>
              </div>
              {currentOptions.mode === 'relay' && (
                <div className="group-relay">
                  <p>按下方顺序接力：第一位出方案，中间成员评审，最后一位汇总。遇到未完成的回复会停止接力。</p>
                  <ol aria-label="接力顺序">
                    {effectiveTargets.map((id, index) => (
                      <li key={id}>
                        <span>
                          {index + 1}. {memberById.get(id)?.name || id}
                        </span>
                        {!mentions.targets && (
                          <>
                            <button
                              type="button"
                              className="group-icon-button"
                              aria-label={`将 ${memberById.get(id)?.name || id} 提前`}
                              disabled={busy || index === 0}
                              onClick={() => moveTarget(index, -1)}
                            >
                              <ArrowUpIcon aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="group-icon-button"
                              aria-label={`将 ${memberById.get(id)?.name || id} 延后`}
                              disabled={busy || index === effectiveTargets.length - 1}
                              onClick={() => moveTarget(index, 1)}
                            >
                              <ArrowDownIcon aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <div className="group-mention-bar">
                <span>点名</span>
                <button
                  type="button"
                  className="group-text-button"
                  disabled={busy}
                  onClick={() => appendMention('所有人')}
                >
                  @所有人
                </button>
                {members.filter(canSend).map((member) => (
                  <button
                    type="button"
                    className="group-text-button"
                    key={member.id}
                    disabled={busy}
                    onClick={() => appendMention(member.name)}
                  >
                    @{member.name}
                  </button>
                ))}
              </div>
              <textarea
                ref={inputRef}
                aria-label="群聊消息"
                placeholder="写下任务；@某个成员可单独点名，@所有人可发给全群"
                value={content}
                maxLength={MAX_LENGTH}
                disabled={busy}
                rows={3}
                onChange={(event) => setContent(event.target.value)}
                onCompositionStart={() => {
                  composingRef.current = true
                }}
                onCompositionEnd={() => {
                  composingRef.current = false
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    event.nativeEvent.keyCode !== 229 &&
                    !composingRef.current
                  ) {
                    event.preventDefault()
                    void send()
                  }
                }}
              />
              {actionError && (
                <p className="group-action-error" role="alert">
                  {actionError}
                </p>
              )}
              {actionNotice && (
                <p className="group-action-notice" role="status">
                  {actionNotice}
                </p>
              )}
              <div className="group-composer-footer">
                <span>
                  {mentions.targets ? '已按文字中的 @ 点名选择接收成员' : '发送给勾选的成员'} · Enter 发送，Shift +
                  Enter 换行
                </span>
                {activeRun ? (
                  <button type="button" className="group-button" disabled={stopping} onClick={() => void stop()}>
                    <StopIcon aria-hidden="true" />
                    {stopping ? '正在停止…' : '停止调度'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="group-button group-button-primary"
                    disabled={busy || !content.trim() || !effectiveTargets.length || !!openingMember}
                    onClick={() => void send()}
                  >
                    <PaperAirplaneIcon aria-hidden="true" />
                    {sending ? '正在发送…' : '发送'}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      <Dialog
        open={!!editDraft}
        onClose={() => {
          if (!saving && !choosingWorkspace) setEditDraft(null)
        }}
        className="group-dialog-root"
      >
        <div className="group-dialog-backdrop" aria-hidden="true" />
        <div className="group-dialog-container">
          <Dialog.Panel className="group-dialog-panel">
            <div className="group-dialog-heading">
              <Dialog.Title>{editDraft?.id ? '编辑群聊' : '新建群聊'}</Dialog.Title>
              <button
                type="button"
                className="group-icon-button"
                aria-label="关闭群聊设置"
                disabled={saving || choosingWorkspace}
                onClick={() => setEditDraft(null)}
              >
                <XMarkIcon aria-hidden="true" />
              </button>
            </div>
            <Dialog.Description>
              选择至少一位成员，最多 6 位官网成员和 2 位执行助手。官网成员沿用桌面版登录，尚未登录时请打开官网。
            </Dialog.Description>
            {editDraft && (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void saveConversation()
                }}
              >
                <label className="group-field">
                  群聊名称
                  <input
                    autoFocus
                    value={editDraft.title}
                    maxLength={60}
                    placeholder="例如：产品策划小组"
                    disabled={saving}
                    onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })}
                  />
                </label>
                <fieldset className="group-member-selection" disabled={saving}>
                  <legend>选择成员（已选 {editDraft.members.length} 位）</legend>
                  {orderedMembers.map((member) => (
                    <label
                      key={member.id}
                      title={member.detail}
                      className={cn('group-select-member', editDraft.members.includes(member.id) && 'selected')}
                    >
                      <input
                        type="checkbox"
                        checked={editDraft.members.includes(member.id)}
                        disabled={!member.supported && !editDraft.members.includes(member.id)}
                        onChange={() => toggleEditMember(member)}
                      />
                      <Avatar member={member} />
                      <span>
                        <strong>{member.name}</strong>
                        <small>
                          {member.kind === 'cli'
                            ? member.available
                              ? '本地执行助手'
                              : member.detail || '执行助手未就绪'
                            : member.supported
                              ? '沿用桌面版登录'
                              : member.detail || '暂不支持群聊'}
                        </small>
                      </span>
                    </label>
                  ))}
                </fieldset>
                {editDraft.members.some((id) => memberById.get(id)?.kind === 'cli') && (
                  <div className="group-workspace-picker">
                    <strong>执行助手的工作文件夹</strong>
                    <p>执行助手可以在这里读取、创建和修改文件。请选择本次任务使用的项目文件夹。</p>
                    <div>
                      <button
                        type="button"
                        className="group-button"
                        disabled={saving || choosingWorkspace}
                        onClick={() => void chooseWorkspace()}
                      >
                        <FolderOpenIcon aria-hidden="true" />
                        {choosingWorkspace ? '正在选择…' : '选择文件夹'}
                      </button>
                      <span title={editDraft.workspace}>{editDraft.workspace || '尚未选择'}</span>
                    </div>
                  </div>
                )}
                <fieldset className="group-role-fields" disabled={saving}>
                  <legend>分工说明（选填）</legend>
                  {editDraft.members.map((id) => (
                    <label key={id} className="group-field">
                      {memberById.get(id)?.name || id}
                      <input
                        maxLength={500}
                        value={editDraft.roles[id] || ''}
                        placeholder="例如：负责检查方案中的问题"
                        onChange={(event) =>
                          setEditDraft({ ...editDraft, roles: { ...editDraft.roles, [id]: event.target.value } })
                        }
                      />
                    </label>
                  ))}
                </fieldset>
                {editError && (
                  <p className="group-action-error" role="alert">
                    {editError}
                  </p>
                )}
                <div className="group-dialog-actions">
                  <button
                    type="button"
                    className="group-button"
                    disabled={saving || choosingWorkspace}
                    onClick={() => setEditDraft(null)}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="group-button group-button-primary"
                    disabled={saving || choosingWorkspace || busy}
                  >
                    {saving ? '正在保存…' : '保存群聊'}
                  </button>
                </div>
              </form>
            )}
          </Dialog.Panel>
        </div>
      </Dialog>
      <Dialog
        open={!!archiveTarget}
        onClose={() => {
          if (!saving) setArchiveTarget(null)
        }}
        className="group-dialog-root"
      >
        <div className="group-dialog-backdrop" aria-hidden="true" />
        <div className="group-dialog-container">
          <Dialog.Panel className="group-dialog-panel group-archive-dialog" role="alertdialog">
            <Dialog.Title>归档“{archiveTarget?.title}”？</Dialog.Title>
            <Dialog.Description>归档后，这个群聊会从列表中隐藏。已有聊天记录会保留。</Dialog.Description>
            {archiveError && (
              <p className="group-action-error" role="alert">
                {archiveError}
              </p>
            )}
            <div className="group-dialog-actions">
              <button type="button" className="group-button" disabled={saving} onClick={() => setArchiveTarget(null)}>
                取消
              </button>
              <button
                type="button"
                className="group-button group-button-primary"
                disabled={saving || busy}
                onClick={() => void archiveConversation()}
              >
                {saving ? '正在归档…' : '确认归档'}
              </button>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </section>
  )
}
