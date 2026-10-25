const { prepareComposer, submitComposer, confirmSubmission } = require('./composer.cjs')

const STATUSES = new Set(['sent', 'blocked', 'busy', 'draft-conflict', 'unsupported', 'error', 'unconfirmed'])
const HOSTS = {
  chatgpt: ['chatgpt.com', 'chat.openai.com'],
  claude: ['claude.ai'],
  gemini: ['gemini.google.com'],
  deepseek: ['chat.deepseek.com'],
  doubao: ['www.doubao.com', 'doubao.com'],
  qwen: ['qwen.ai', 'chat.qwen.ai'],
  kimi: ['www.kimi.com', 'kimi.com'],
  perplexity: ['www.perplexity.ai', 'perplexity.ai'],
  grok: ['grok.com'],
  copilot: ['copilot.microsoft.com'],
  mistral: ['chat.mistral.ai'],
}

function validateBroadcastRequest(request) {
  if (
    !request ||
    typeof request.message !== 'string' ||
    !request.message.trim() ||
    request.message.length > 60000 ||
    !Array.isArray(request.panelIds) ||
    !request.panelIds.length ||
    request.panelIds.length > 6 ||
    request.panelIds.some((id) => typeof id !== 'string' || !/^panel-[0-5]$/.test(id)) ||
    new Set(request.panelIds).size !== request.panelIds.length ||
    !request.siteIds ||
    typeof request.siteIds !== 'object' ||
    Array.isArray(request.siteIds) ||
    Object.keys(request.siteIds).length !== request.panelIds.length ||
    request.panelIds.some((id) => !Object.hasOwn(request.siteIds, id) || !Object.hasOwn(HOSTS, request.siteIds[id]))
  )
    throw new Error('请输入消息，并选择 1 至 6 个正在显示的窗口（消息最多 60000 字）。')
  return { message: request.message, panelIds: [...request.panelIds], siteIds: { ...request.siteIds } }
}

function websiteMatches(siteId, value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && Boolean(HOSTS[siteId]?.includes(url.hostname))
  } catch {
    return false
  }
}

function scriptCall(fn, config) {
  return `(${fn.toString()})(${JSON.stringify(config)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')})`
}

async function bounded(operation, milliseconds, signal) {
  let timer
  let onAbort
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), milliseconds)
      }),
      ...(signal
        ? [
            new Promise((_, reject) => {
              onAbort = () => reject(new Error('cancelled'))
              if (signal.aborted) onAbort()
              else signal.addEventListener('abort', onAbort, { once: true })
            }),
          ]
        : []),
    ])
  } finally {
    clearTimeout(timer)
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

function createBroadcaster(getPanel, adapters = { prepareComposer, submitComposer, confirmSubmission }, policy = {}) {
  let running = false
  return async (rawRequest) => {
    const { message, panelIds, siteIds } = validateBroadcastRequest(rawRequest)
    if (running) throw new Error('正在发送，请等本次发送完成。')
    running = true
    try {
      return await Promise.all(
        panelIds.map(async (id) => {
          const record = getPanel(id)
          const siteId = siteIds[id]
          const result = (status, detail) => ({ id, siteId, status, detail })
          const available = () =>
            record &&
            record === getPanel(id) &&
            record.siteId === siteId &&
            !policy.signal?.aborted &&
            (policy.isAvailable ? policy.isAvailable(record, id) : record.attached) &&
            !record.view.webContents.isDestroyed()
          if (!available()) return result('blocked', '该窗口已关闭或未显示，本次没有发送。')
          const contents = record.view.webContents
          if (!websiteMatches(siteId, contents.getURL()))
            return result('unsupported', '该窗口当前不在对应 AI 官网，本次没有发送。')
          if (contents.isLoadingMainFrame()) return result('busy', '官网正在加载，请稍后重试。')
          let submissionStarted = false
          try {
            const url = contents.getURL()
            const config = {
              siteId,
              allowedHosts: HOSTS[siteId],
              expectedUrl: url,
              ...(policy.runToken ? { runToken: policy.runToken } : {}),
            }
            const prepared = await bounded(
              contents.executeJavaScript(scriptCall(adapters.prepareComposer, config), true),
              8000,
              policy.signal,
            )
            if (prepared?.status !== 'ready') {
              const status = STATUSES.has(prepared?.status) ? prepared.status : 'error'
              return result(
                status,
                typeof prepared?.detail === 'string' ? prepared.detail : '无法找到可用的聊天输入框。',
              )
            }
            if (!available() || contents.getURL() !== url || contents.isLoadingMainFrame())
              return result('blocked', '网页已切换，本次没有发送，请在新页面重试。')
            await bounded(contents.insertText(message), 5000, policy.signal)
            if (!available() || contents.getURL() !== url || contents.isLoadingMainFrame())
              return result('unconfirmed', '网页已切换，请查看官网；本次未继续点击发送。')
            policy.onSubmissionStart?.(record)
            submissionStarted = true
            let submitted = await bounded(
              contents.executeJavaScript(scriptCall(adapters.submitComposer, { ...config, message }), true),
              12000,
              policy.signal,
            )
            if (submitted?.status === 'keyboard-ready') {
              if (!available() || contents.getURL() !== url || contents.isLoadingMainFrame())
                return result('unconfirmed', '网页已切换，请查看官网；本次未继续提交。')
              contents.focus()
              contents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
              contents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
              policy.onKeyboardSubmitted?.(record)
              submitted = await bounded(
                contents.executeJavaScript(scriptCall(adapters.confirmSubmission, { ...config, message }), true),
                10000,
                policy.signal,
              )
            }
            const status = STATUSES.has(submitted?.status) ? submitted.status : 'unconfirmed'
            return result(
              status,
              typeof submitted?.detail === 'string' ? submitted.detail : '无法确认发送结果，请查看官网。',
            )
          } catch {
            return submissionStarted
              ? result('unconfirmed', '发送结果未确认，请先查看官网，避免重复提交。')
              : result('error', '无法填入消息，请查看官网输入框后重试。')
          }
        }),
      )
    } finally {
      running = false
    }
  }
}

module.exports = { createBroadcaster, validateBroadcastRequest, websiteMatches, scriptCall, HOSTS }
