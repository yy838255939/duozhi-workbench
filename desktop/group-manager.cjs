const { randomUUID } = require('node:crypto')
const { isAbsolute } = require('node:path')
const { statSync } = require('node:fs')
const sites = require('./sites.json')
const { createGroupStore } = require('./group-store.cjs')
const { createBroadcaster, websiteMatches, scriptCall, HOSTS } = require('./broadcast.cjs')
const { createResponseMonitor, stopWebsiteResponse } = require('./response.cjs')
const { discoverCliMembers, runCli } = require('./cli.cjs')
const { waitForWebsiteReady } = require('./ready.cjs')

const SUPPORTED_WEBSITES = new Set([
  'chatgpt',
  'claude',
  'gemini',
  'deepseek',
  'doubao',
  'grok',
  'kimi',
  'qwen',
  'perplexity',
])
const DONE_STATUSES = new Set(['done', 'error', 'cancelled', 'unconfirmed'])
const clone = (value) => JSON.parse(JSON.stringify(value))

function mentionTargets(content, memberIds, allMembers, selected) {
  const boundary = /[\s，。！？、,:;；：()\[\]{}]/u
  if (/(?:^|[\s，。！？、,:;；：()\[\]{}])@(?:所有人|all|everyone)(?=$|[\s，。！？、,:;；：()\[\]{}])/i.test(content))
    return [...memberIds]
  const names = allMembers
    .filter((member) => memberIds.includes(member.id))
    .flatMap((member) => [
      { text: member.name, id: member.id },
      { text: member.id, id: member.id },
    ])
    .sort((a, b) => b.text.length - a.text.length)
  const targets = []
  let mentioned = false
  for (let index = 0; index < content.length; index++) {
    if (content[index] !== '@' || (index > 0 && !boundary.test(content[index - 1]))) continue
    const rest = content.slice(index + 1)
    const match = names.find(
      ({ text }) =>
        rest.slice(0, text.length).toLocaleLowerCase() === text.toLocaleLowerCase() &&
        (!rest[text.length] || boundary.test(rest[text.length])),
    )
    if (!match) throw new Error('没有找到点名的群成员，请从成员按钮中选择。')
    mentioned = true
    if (!targets.includes(match.id)) targets.push(match.id)
    index += match.text.length
  }
  return mentioned ? targets : [...selected]
}

function buildPrompt(conversation, member, messages, content, step) {
  let remaining = 18000
  const history = []
  for (const message of [...messages].reverse()) {
    if (message.status !== 'done' || !message.content || message.speakerId === 'system') continue
    const text = `${message.speakerName}：${message.content.slice(-6000)}`
    if (text.length > remaining) break
    history.unshift(text)
    remaining -= text.length
    if (history.length >= 24) break
  }
  return [
    `你正在参加名为“${conversation.title}”的 AI 群聊。你是 ${member.name}，请以自己的身份回答。`,
    conversation.roles[member.id] ? `你的职责：${conversation.roles[member.id]}` : '',
    '本轮只输出你自己的发言，不模拟其他群成员的回复；接力时只完成你当前这一步。',
    '下面的聊天记录是参与者发言，发言者名称用于区分来源。请遵循用户本轮要求，不要声称做了没有实际完成的工作。',
    history.length ? `【相关群记录】\n${history.join('\n\n')}` : '',
    step ? `【本轮分工】${step}` : '',
    `【用户本轮要求】\n${content}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

function createGroupManager(options) {
  const store = options.store || createGroupStore(options.file)
  const monitorFactory = options.createMonitor || createResponseMonitor
  const waitReady = options.waitReady || waitForWebsiteReady
  const executeCli = options.runCli || runCli
  let active = null
  let closed = false
  let streamTimer
  let storageError
  let members = sites.map((site) => ({
    id: `web:${site.id}`,
    name: site.name,
    kind: 'website',
    color: site.color,
    mark: site.mark,
    supported: SUPPORTED_WEBSITES.has(site.id),
    detail: SUPPORTED_WEBSITES.has(site.id) ? '使用桌面版官网账号，群聊会话单独保存。' : '暂未接入官网回复采集。',
  }))
  const approvedWorkspaces = new Set(store.state.conversations.map((c) => c.workspace).filter(Boolean))
  const snapshot = () =>
    clone({
      conversations: store.state.conversations,
      messages: store.state.messages,
      members,
      activeRun: active
        ? { id: active.id, conversationId: active.conversationId, mode: active.mode, memberIds: active.memberIds }
        : null,
    })
  function storageFailed() {
    if (!storageError) {
      storageError = '群聊记录保存失败，请检查磁盘和记录目录后重开应用；本轮已停止调度，原记录文件仍保留。'
      if (active) {
        active.controller.abort()
        store.state.messages[active.conversationId].push({
          id: `message-${randomUUID()}`,
          conversationId: active.conversationId,
          speakerId: 'system',
          speakerName: '工作台',
          content: storageError,
          status: 'error',
          createdAt: Date.now(),
        })
      }
    }
  }
  const notify = (persist = true) => {
    if (persist && !storageError) {
      try {
        store.persist()
      } catch {
        storageFailed()
      }
    }
    if (!closed) options.onChange?.(snapshot())
  }
  const assertStorage = () => {
    if (storageError) throw new Error(storageError)
  }
  const saveSource = (conversationId, memberId, url) => {
    if (storageError) return
    try {
      store.setSource(conversationId, memberId, url)
    } catch {
      storageFailed()
      notify(false)
    }
  }
  const streamChanged = () => {
    if (streamTimer) return
    streamTimer = setTimeout(() => {
      streamTimer = undefined
      notify()
    }, 250)
  }
  const ready = (options.discoverCli || discoverCliMembers)()
    .then((cliMembers) => {
      members.push(
        ...cliMembers.map((member) => ({
          ...member,
          kind: 'cli',
          color: '#39465b',
          mark: member.id === 'cli:codex' ? 'C' : 'A',
          supported: true,
        })),
      )
      notify(false)
    })
    .catch(() => {
      members.push(
        ...['codex', 'claude'].map((kind) => ({
          id: `cli:${kind}`,
          name: kind === 'codex' ? 'Codex' : 'Claude Code',
          kind: 'cli',
          supported: true,
          available: false,
          color: '#39465b',
          mark: kind === 'codex' ? 'C' : 'A',
          detail: '本地工具检查失败。',
        })),
      )
    })

  function conversationFor(id) {
    const conversation = store.state.conversations.find((item) => item.id === id && !item.archived)
    if (!conversation) throw new Error('群聊不存在或已归档。')
    return conversation
  }

  async function runMember(run, conversation, memberId, content, history, step) {
    const member = members.find((item) => item.id === memberId)
    const message = {
      id: `message-${randomUUID()}`,
      conversationId: conversation.id,
      runId: run.id,
      speakerId: memberId,
      speakerName: member.name,
      content: '',
      status: 'queued',
      createdAt: Date.now(),
      step,
    }
    store.state.messages[conversation.id].push(message)
    notify()
    const check = () => {
      if (run.controller.signal.aborted) throw new Error('cancelled')
    }
    const update = (text) => {
      if (run.controller.signal.aborted || DONE_STATUSES.has(message.status)) return
      message.content = String(text || '').slice(0, 60000)
      message.status = 'streaming'
      streamChanged()
    }
    try {
      check()
      const prompt = buildPrompt(conversation, member, history, content, step)
      message.status = 'sending'
      notify()
      if (member.kind === 'cli') {
        if (!member.available) throw new Error(member.detail || '本地执行工具不可用。')
        if (!conversation.workspace) throw new Error('请先为这个群选择工作文件夹。')
        const result = await executeCli({
          kind: member.id.slice(4),
          workspace: conversation.workspace,
          prompt,
          signal: run.controller.signal,
          onUpdate: (value) => {
            if (typeof value === 'string') update(value)
            else {
              update(value.text)
              if (value.detail) message.detail = value.detail
            }
          },
        })
        check()
        if (!result.text?.trim()) throw new Error('执行工具没有返回可显示的结果。')
        message.content = result.text.slice(0, 60000)
      } else {
        const siteId = memberId.slice(4)
        const record = await options.getWebsiteConnection(
          conversation,
          siteId,
          store.state.sources[conversation.id]?.[memberId],
        )
        check()
        const contents = record.view.webContents
        const deadline = Date.now() + 30000
        while (contents.isLoadingMainFrame() && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 250))
          check()
        }
        if (!websiteMatches(siteId, contents.getURL())) throw new Error('请打开本成员的官网完成登录，再回到群聊发送。')
        await waitReady(contents, siteId, { signal: run.controller.signal })
        check()
        const monitor = monitorFactory(contents, siteId, { signal: run.controller.signal, onUpdate: update })
        const baseline = await monitor.capture()
        if (record.fresh && baseline.messages.length)
          throw new Error('新群不能沿用官网的旧聊天，请打开本成员官网，新建会话后再发送。')
        check()
        // A delayed stop from a previous run cannot operate on a newer run.
        record.keyboardRunId = undefined
        const tokenScript = `(() => { const token = ${JSON.stringify({
          id: run.id,
          startedAt: run.startedAt,
        })}; if (!window.__duozhiGroupRunV1 || window.__duozhiGroupRunV1.startedAt <= token.startedAt) window.__duozhiGroupRunV1 = token; })()`
        let tokenTimer
        try {
          await Promise.race([
            contents.executeJavaScript(tokenScript, false),
            new Promise((_, reject) => {
              tokenTimer = setTimeout(() => reject(new Error('官网准备超时，请打开成员官网检查。')), 5000)
            }),
          ])
        } finally {
          clearTimeout(tokenTimer)
        }
        check()
        const sender = createBroadcaster((id) => (id === 'panel-0' ? record : undefined), undefined, {
          signal: run.controller.signal,
          runToken: run.id,
          onKeyboardSubmitted: () => {
            record.keyboardRunId = run.id
          },
          onSubmissionStart: () => run.webRecords.set(record, contents.getURL()),
          // Only an explicitly selected participant in this active group run is authorized.
          // The existing website broadcast keeps its separate visible-panel requirement.
          isAvailable: (current) =>
            current === record && active === run && run.memberIds.includes(memberId) && !run.controller.signal.aborted,
        })
        const [result] = await sender({ message: prompt, panelIds: ['panel-0'], siteIds: { 'panel-0': siteId } })
        if (
          run.webRecords.has(record) &&
          !run.controller.signal.aborted &&
          ['sent', 'unconfirmed'].includes(result.status)
        ) {
          run.webRecords.set(record, contents.getURL())
          record.fresh = false
          if (websiteMatches(siteId, contents.getURL())) saveSource(conversation.id, memberId, contents.getURL())
        }
        if (!['sent', 'unconfirmed'].includes(result.status)) run.webRecords.delete(record)
        if (result.status !== 'sent') {
          message.status = result.status === 'unconfirmed' ? 'unconfirmed' : 'error'
          throw new Error(result.detail)
        }
        check()
        message.status = 'streaming'
        message.detail = '官网正在回复…'
        notify()
        const resultText = await monitor.wait()
        check()
        message.content = resultText.text.slice(0, 60000)
        if (websiteMatches(siteId, resultText.sourceUrl)) {
          message.sourceUrl = resultText.sourceUrl
          saveSource(conversation.id, memberId, resultText.sourceUrl)
        }
        if (!message.content.trim()) throw new Error('官网没有返回可识别的回答，请打开官网检查。')
      }
      message.status = 'done'
      message.detail = undefined
      notify()
      return message
    } catch (error) {
      if (run.controller.signal.aborted) {
        message.status = 'cancelled'
        message.detail = '已停止本轮处理；官网已收到的消息不会自动重发。'
      } else {
        if (message.status !== 'unconfirmed') message.status = 'error'
        message.detail =
          error.message === 'cancelled' ? '本轮已停止。' : error.message || '处理失败，请打开对应成员检查。'
      }
      notify()
      return message
    }
  }

  async function execute(run, conversation, content, initialHistory) {
    try {
      if (run.mode === 'parallel') {
        const websites = run.memberIds.filter((id) => id.startsWith('web:'))
        const cli = run.memberIds.filter((id) => id.startsWith('cli:'))
        // Local tools share one workspace: keep their file writes in a queue.
        await Promise.all([
          ...websites.map((id) => runMember(run, conversation, id, content, initialHistory)),
          (async () => {
            for (const id of cli) {
              if (run.controller.signal.aborted) break
              await runMember(run, conversation, id, content, initialHistory)
            }
          })(),
        ])
      } else {
        const history = [...initialHistory]
        for (let index = 0; index < run.memberIds.length; index++) {
          if (run.controller.signal.aborted) break
          const step =
            index === 0
              ? '先给出方案或初稿。'
              : index === run.memberIds.length - 1
                ? '阅读前面成员的结果，检查问题并汇总最终答案。'
                : '阅读前面成员的结果，评审问题并提出可执行的修正。'
          const position = `你现在是第 ${index + 1} 位，共 ${run.memberIds.length} 位。${
            index
              ? `前一位是 ${members.find((m) => m.id === run.memberIds[index - 1]).name}，其真实结果已在相关群记录中。`
              : ''
          }${step}`
          const result = await runMember(run, conversation, run.memberIds[index], content, history, position)
          if (result.status !== 'done') {
            if (!run.controller.signal.aborted) {
              store.state.messages[conversation.id].push({
                id: `message-${randomUUID()}`,
                conversationId: conversation.id,
                runId: run.id,
                speakerId: 'system',
                speakerName: '工作台',
                content: '接力已暂停，前一位未完成，后续成员没有收到本轮任务。',
                status: 'done',
                createdAt: Date.now(),
              })
            }
            break
          }
          history.push(result)
        }
      }
    } catch (error) {
      store.state.messages[conversation.id].push({
        id: `message-${randomUUID()}`,
        conversationId: conversation.id,
        runId: run.id,
        speakerId: 'system',
        speakerName: '工作台',
        content: '本轮调度中断，请检查各成员状态；没有自动重发。',
        status: 'error',
        createdAt: Date.now(),
      })
    } finally {
      clearTimeout(streamTimer)
      streamTimer = undefined
      if (active === run && !run.stopping) active = null
      conversation.updatedAt = Date.now()
      notify()
    }
  }

  return {
    async list() {
      await ready
      return snapshot()
    },
    async save(raw) {
      await ready
      if (closed) throw new Error('工作台正在关闭。')
      assertStorage()
      if (active) throw new Error('请先停止当前轮，再调整群成员。')
      if (
        !raw ||
        typeof raw.title !== 'string' ||
        !raw.title.trim() ||
        raw.title.length > 60 ||
        !Array.isArray(raw.members) ||
        !raw.members.length ||
        raw.members.length > 8 ||
        new Set(raw.members).size !== raw.members.length ||
        raw.members.some((id) => !members.some((m) => m.id === id && m.supported)) ||
        raw.members.filter((id) => id.startsWith('web:')).length > 6 ||
        !raw.roles ||
        typeof raw.roles !== 'object'
      )
        throw new Error('请输入群名，并选择最多 6 个官网成员和 2 个执行工具。')
      const roles = {}
      for (const id of raw.members) {
        if (raw.roles[id] !== undefined && (typeof raw.roles[id] !== 'string' || raw.roles[id].length > 500))
          throw new Error('成员职责最多 500 字。')
        roles[id] = raw.roles[id] || ''
      }
      if (
        raw.workspace &&
        (!isAbsolute(raw.workspace) || !approvedWorkspaces.has(raw.workspace) || !statSync(raw.workspace).isDirectory())
      )
        throw new Error('请使用选择按钮设置工作文件夹。')
      if (raw.members.some((id) => id.startsWith('cli:')) && !raw.workspace)
        throw new Error('执行工具成员需要一个工作文件夹。')
      const previous = raw.id ? conversationFor(raw.id) : undefined
      if (!previous && store.state.conversations.length >= 200)
        throw new Error('群数量已达 200 个，请整理记录后再添加。')
      const conversation = {
        id: previous?.id || `group-${randomUUID()}`,
        title: raw.title.trim(),
        members: [...raw.members],
        roles,
        workspace: raw.workspace || undefined,
        createdAt: previous?.createdAt || Date.now(),
        updatedAt: Date.now(),
      }
      if (previous) Object.assign(previous, conversation)
      else {
        store.state.conversations.push(conversation)
        store.state.messages[conversation.id] = []
      }
      notify()
      assertStorage()
      return clone(conversation)
    },
    async archive(id) {
      await ready
      if (active?.conversationId === id) throw new Error('请先停止这个群的当前轮。')
      assertStorage()
      conversationFor(id).archived = true
      options.closeConversation?.(id)
      notify()
      assertStorage()
    },
    async chooseWorkspace() {
      const directory = await options.chooseWorkspace()
      if (directory) approvedWorkspaces.add(directory)
      return directory
    },
    async openMember(conversationId, memberId) {
      await ready
      const conversation = conversationFor(conversationId)
      if (!conversation.members.includes(memberId) || !memberId.startsWith('web:'))
        throw new Error('该成员没有可打开的官网会话。')
      await options.openWebsite(conversation, memberId.slice(4), store.state.sources[conversationId]?.[memberId])
    },
    async send(request) {
      await ready
      assertStorage()
      if (closed || active) throw new Error('当前有一轮正在处理，请等待完成或点击停止。')
      if (
        !request ||
        typeof request.content !== 'string' ||
        !request.content.trim() ||
        request.content.length > 30000 ||
        !['parallel', 'relay'].includes(request.mode) ||
        !Array.isArray(request.targets)
      )
        throw new Error('请输入消息（最多 30000 字）。')
      const conversation = conversationFor(request.conversationId)
      if (
        request.targets.some((id) => !conversation.members.includes(id)) ||
        new Set(request.targets).size !== request.targets.length
      )
        throw new Error('发送目标必须是当前群里的成员。')
      const targets = mentionTargets(request.content, conversation.members, members, request.targets)
      if (!targets.length) throw new Error('请至少选择一位回答成员。')
      if (request.mode === 'relay' && targets.length < 2) throw new Error('接力模式需要至少两位成员。')
      if (store.state.messages[conversation.id].length >= 5000)
        throw new Error('这个群已有 5000 条消息，请新建群聊继续。')
      const content = request.content.trim()
      const history = clone(store.state.messages[conversation.id])
      const run = {
        id: `run-${randomUUID()}`,
        conversationId: conversation.id,
        mode: request.mode,
        memberIds: targets,
        controller: new AbortController(),
        webRecords: new Map(),
        startedAt: Date.now(),
      }
      active = run
      store.state.messages[conversation.id].push({
        id: `message-${randomUUID()}`,
        conversationId: conversation.id,
        runId: run.id,
        speakerId: 'user',
        speakerName: '我',
        content,
        status: 'done',
        createdAt: Date.now(),
      })
      conversation.updatedAt = Date.now()
      notify()
      if (storageError) {
        active = null
        notify(false)
        assertStorage()
      }
      run.promise = execute(run, conversation, content, history)
      return { runId: run.id }
    },
    async stop(runId) {
      if (!active || active.id !== runId) return
      const run = active
      if (run.stopPromise) return run.stopPromise
      run.stopping = true
      run.controller.abort()
      run.stopPromise = (async () => {
        await Promise.allSettled(
          [...run.webRecords].map(async ([record, expectedUrl]) => {
            const contents = record.view.webContents
            if (contents.isDestroyed()) return
            const action = scriptCall(stopWebsiteResponse, {
              siteId: record.siteId,
              allowedHosts: HOSTS[record.siteId],
            })
            const script = `(() => { const token = window.__duozhiGroupRunV1; if (token?.id !== ${JSON.stringify(
              run.id,
            )}) return false; token.cancelled = true; if (location.href !== ${JSON.stringify(
              expectedUrl,
            )} || (!token.submitted && !${record.keyboardRunId === run.id})) return false; return ${action}; })()`
            await Promise.race([
              contents.executeJavaScript(script, true),
              new Promise((resolve) => setTimeout(resolve, 2000)),
            ])
          }),
        )
        await run.promise
        if (active === run) active = null
        notify()
      })()
      return run.stopPromise
    },
    setSource(conversationId, siteId, url) {
      if (
        websiteMatches(siteId, url) &&
        store.state.conversations.some((c) => c.id === conversationId && c.members.includes(`web:${siteId}`))
      )
        saveSource(conversationId, `web:${siteId}`, url)
    },
    async close() {
      closed = true
      if (active) await this.stop(active.id)
      clearTimeout(streamTimer)
      streamTimer = undefined
      notify()
    },
  }
}

module.exports = { createGroupManager, mentionTargets, buildPrompt }
