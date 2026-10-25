// The exported page functions are serialized into official website DOMs. They
// capture no Node bindings, read no storage/network, and never return HTML.
function websiteResponseAction(config) {
  const hosts = {
    chatgpt: ['chatgpt.com', 'chat.openai.com'],
    claude: ['claude.ai'],
    gemini: ['gemini.google.com'],
    deepseek: ['chat.deepseek.com'],
    doubao: ['www.doubao.com', 'doubao.com'],
    qwen: ['qwen.ai', 'chat.qwen.ai'],
    kimi: ['www.kimi.com', 'kimi.com'],
    perplexity: ['www.perplexity.ai', 'perplexity.ai'],
    grok: ['grok.com'],
  }
  const empty = (supported, blocked, detail) => ({
    supported,
    messages: [],
    generating: false,
    blocked,
    ...(detail ? { detail } : {}),
  })
  const valid = (() => {
    try {
      const url = new URL(location.href)
      return (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        hosts[config.siteId]?.includes(url.hostname) &&
        Array.isArray(config.allowedHosts) &&
        config.allowedHosts.includes(url.hostname)
      )
    } catch {
      return false
    }
  })()
  if (!valid) return config.action === 'stop' ? false : empty(false, true, '窗口已离开对应 AI 官网，已停止读取回复。')
  const ignored =
    'script,style,noscript,svg,button,input,textarea,select,[role="button"],[contenteditable="true"],[contenteditable="plaintext-only"],[hidden],[inert],[aria-hidden="true"],.sr-only,.screen-reader-only,.thinking-container,.thinking-content,.reasoning-content,.ds-markdown--think,.ds-think-content,[data-testid="thinking-content"],[data-testid="reasoning-content"],[data-markdown-text-tone="tertiary"],.segment-assistant-actions,.message-actions,.response-actions'
  const user =
    '[data-message-author-role="user"],[data-role="user"],[data-testid="user-message"],user-query,.user-query,.segment-user,.qwen-chat-message-user,[data-testid="send_message"],[class*="bg-g-send-msg-bubble"],.message-bubble.user'
  const visible = (element) => {
    if (!element?.isConnected || element.closest('[hidden],[inert],[aria-hidden="true"]')) return false
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        style.opacity === '0'
      )
        return false
    }
    const bounds = element.getBoundingClientRect()
    return bounds.width > 0 && bounds.height > 0
  }
  const commonStops = [
    '[data-testid="stop-button"]',
    '[data-testid="stop-generation-button"]',
    '[data-testid="chat-input-stop-button"]',
    'button[aria-label="Stop"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label="Stop response"]',
    'button[aria-label="Stop Response"]',
    'button[aria-label="停止"]',
    'button[aria-label="停止生成"]',
    'button[aria-label="停止回答"]',
    'button[aria-label="停止回應"]',
  ]
  const stops = {
    chatgpt: commonStops,
    claude: commonStops,
    gemini: [...commonStops, 'button.stop-button', 'button[data-test-id="stop-button"]'],
    deepseek: commonStops,
    doubao: [...commonStops, '#flow-end-msg-stop', '[data-testid="chat_input_stop_button"]'],
    qwen: [...commonStops, 'button.stop-button'],
    kimi: [...commonStops, '.chat-box .send-button-container.stop', '.chat-input .send-button-container.stop'],
    perplexity: commonStops,
    grok: [...commonStops, 'button[data-testid="chat-stop"]'],
  }
  const stopControls = (stops[config.siteId] || [])
    .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
    .filter(
      (element) =>
        visible(element) &&
        !element.closest(user) &&
        !element.closest(
          '.markdown,.ds-markdown,.font-claude-response,.segment-content-box,.response-message-content,.response-content-markdown,.prose',
        ) &&
        !element.disabled &&
        element.getAttribute('aria-disabled') !== 'true',
    )
  if (config.action === 'stop') {
    // A known control must be unique. Never click an unknown button or press Esc.
    const candidates = [...new Set(stopControls)]
    if (candidates.length !== 1) return false
    candidates[0].click()
    return true
  }
  const selectors = {
    chatgpt: [
      '[data-message-author-role="assistant"] .markdown',
      '[data-message-author-role="assistant"]',
      '[data-markdown-text-style="assistant-message"]:not([data-markdown-text-tone="tertiary"])',
    ],
    claude: [
      '.font-claude-response',
      '[data-testid="assistant-message"] .standard-markdown',
      '[data-testid="ai-message"]',
    ],
    gemini: [
      'model-response .model-response-text',
      'model-response message-content',
      '.model-response-text',
      'model-response .markdown',
    ],
    deepseek: [
      '.ds-message .ds-markdown:not(.ds-markdown--think)',
      '[data-role="assistant"] .ds-markdown',
      '[data-message-author-role="assistant"] .ds-markdown',
    ],
    doubao: [
      '[data-testid="receive_message"] [data-testid="message_text_content"]',
      '[data-testid="receive_message"] .flow-markdown-body',
      '[class*="bg-g-receive-msg-bubble"] .flow-markdown-body',
      '[data-testid="receive_message"]',
      '[class*="bg-g-receive-msg-bubble"]',
      '[class*="message-list-"] .flow-markdown-body',
      '[data-testid="message-list"] .flow-markdown-body',
    ],
    qwen: [
      '.qwen-chat-message-assistant .response-message-content.phase-answer',
      '.qwen-chat-message-assistant .response-message-content',
      '[data-role="assistant"] .qwen-markdown',
    ],
    kimi: [
      '.segment-assistant .segment-content-box',
      '.segment-assistant .markdown-container',
      '[data-role="assistant"] .markdown',
    ],
    perplexity: [
      '[data-testid="assistant-message"] .prose',
      '[data-testid="assistant-message"]',
      '[data-message-author-role="assistant"]',
      '[data-role="assistant"] .prose',
    ],
    grok: [
      '[data-testid="assistant-message"] .response-content-markdown',
      '[data-testid="assistant-message"]',
      '.message-bubble.assistant .response-content-markdown',
      '.response-content-markdown',
    ],
  }
  if (!selectors[config.siteId]) return empty(false, false, '这个官网暂未接入可靠的回复读取，请在官网查看答案。')
  const conversation = [
    ...selectors[config.siteId],
    user,
    '.ds-message',
    '.segment',
    '.qwen-chat-message',
    'model-response',
  ].join(',')
  const noticeSelectors =
    '[role="alert"],[role="dialog"],[aria-modal="true"],[data-sonner-toast],[class*="toast"],[class*="Toast"],[class*="notification"],[class*="Notification"],[class*="error-message"],[class*="errorMessage"],[class*="chat-error"],[class*="chatError"],[class*="modal"],[class*="Modal"],.queue-notice,.queue-tip,.ant-message-notice'
  for (const notice of document.querySelectorAll(noticeSelectors)) {
    if (!visible(notice) || notice.closest(conversation)) continue
    const text = (notice.textContent || '').slice(0, 1200)
    if (
      /(?:和Kimi聊天的人太多|订阅会员可进入优先队列|请求过于频繁|服务器繁忙|系统繁忙|发送失败|消息发送失败|额度已用完|已达到.{0,12}(?:上限|限制)|超出.{0,12}(?:额度|限制)|出了点问题|Something went wrong|message failed|failed to send|rate limit|too many requests|usage limit|capacity|try again later|请.{0,8}(?:登录|验证)|验证.{0,8}(?:人类|身份)|verify you are human)/i.test(
        text,
      )
    )
      return empty(true, true, '官网提示登录、验证、排队或额度限制，请打开成员官网处理。')
  }
  if (
    Array.from(document.querySelectorAll('input[type="password"],input[type="email"][autocomplete="email"]')).some(
      visible,
    )
  )
    return empty(true, true, '官网需要登录，请打开成员官网完成登录。')
  const streaming = {
    chatgpt: '[data-is-streaming="true"],[data-streaming="true"]',
    claude: '[data-is-streaming="true"]',
    gemini:
      'model-response .loading-indicator,model-response .thinking-indicator,model-response .response-streaming,[data-test-id="response-loading"]',
    deepseek: '.ds-loading,[data-is-streaming="true"],[data-streaming="true"]',
    doubao: '[data-is-streaming="true"],[data-streaming="true"]',
    qwen: '.qwen-chat-message-assistant[data-is-streaming="true"]',
    kimi: '.segment-assistant[data-is-streaming="true"]',
    perplexity: '[data-is-streaming="true"]',
    grok: '[data-streaming="true"]',
  }
  const generating =
    stopControls.length > 0 ||
    Array.from(document.querySelectorAll(streaming[config.siteId] || '[data-is-streaming="true"]')).some(visible)
  let nodes = []
  for (const selector of selectors[config.siteId]) {
    nodes = Array.from(document.querySelectorAll(selector)).filter(
      (node) =>
        visible(node) &&
        !node.closest(user) &&
        !node.closest(
          '.thinking-container,.thinking-content,.reasoning-content,.ds-markdown--think,.ds-think-content,[data-markdown-text-tone="tertiary"]',
        ),
    )
    if (nodes.length) break
  }
  // Some selectors match both a wrapper and its nested content. Read once.
  nodes = nodes.filter((node) => !nodes.some((other) => other !== node && node.contains(other)))
  const normalize = (text) =>
    text
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .trim()
  const serialize = (root) => {
    let visited = 0
    let consumed = 0
    const plain = (node, inCode = false) => {
      if (++visited > 18000 || consumed >= 60000) return ''
      if (node.nodeType === 3) {
        const value = (node.nodeValue || '').slice(0, 60000 - consumed)
        consumed += value.length
        return inCode ? value : value.replace(/[ \t\r\n]+/g, ' ')
      }
      if (node.nodeType !== 1 || node.matches(ignored)) return ''
      const style = getComputedStyle(node)
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        style.opacity === '0'
      )
        return ''
      const tag = node.tagName
      if (tag === 'BR') return '\n'
      if (tag === 'PRE' || node.matches('.segment-code')) {
        const code = node.querySelector('code') || node
        const monacoLines = code.querySelectorAll('.view-lines .view-line')
        let value = monacoLines.length
          ? Array.from(monacoLines, (line) => plain(line, true)).join('\n')
          : Array.from(code.childNodes, (child) => plain(child, true)).join('')
        const language =
          Array.from(code.classList)
            .find((name) => /^language-[a-z0-9_+-]+$/i.test(name))
            ?.slice(9) || ''
        // Choose a fence longer than any code run so content cannot break out.
        const longest = Math.max(2, ...(value.match(/`+/g) || []).map((run) => run.length))
        const fence = '`'.repeat(Math.min(longest + 1, 100))
        return `\n\n${fence}${language}\n${value.replace(/\n$/, '')}\n${fence}\n\n`
      }
      if (tag === 'TR')
        return (
          '\n| ' +
          Array.from(node.children)
            .filter((cell) => /^(TH|TD)$/.test(cell.tagName))
            .map((cell) => normalize(plain(cell)).replace(/\|/g, '\\|'))
            .join(' | ') +
          ' |\n'
        )
      const value = Array.from(node.childNodes, (child) => plain(child, inCode)).join('')
      if (inCode) return value
      if (tag === 'CODE') return '`' + value.replace(/`/g, '\\`') + '`'
      if (tag === 'A' && value.trim()) {
        try {
          const link = new URL(node.getAttribute('href') || '', location.href)
          if (/^https?:$/.test(link.protocol) && !link.username && !link.password)
            return '[' + value.replace(/\]/g, '\\]') + '](' + link.href.replace(/\)/g, '%29') + ')'
        } catch {}
      }
      if (tag === 'STRONG' || tag === 'B') return '**' + value + '**'
      if (tag === 'EM' || tag === 'I') return '*' + value + '*'
      if (/^H[1-6]$/.test(tag)) return '\n\n' + '#'.repeat(Number(tag[1])) + ' ' + value.trim() + '\n\n'
      if (tag === 'LI')
        return (
          '\n' +
          (node.parentElement?.tagName === 'OL'
            ? `${Array.from(node.parentElement.children).indexOf(node) + 1}. `
            : '- ') +
          value.trim() +
          '\n'
        )
      if (tag === 'BLOCKQUOTE')
        return (
          '\n\n' +
          value
            .trim()
            .split('\n')
            .map((line) => '> ' + line)
            .join('\n') +
          '\n\n'
        )
      if (tag === 'HR') return '\n\n---\n\n'
      if (tag === 'P') return '\n\n' + value.trim() + '\n\n'
      if (/^(DIV|SECTION|ARTICLE|UL|OL|TABLE)$/.test(tag)) return '\n' + value + '\n'
      return value
    }
    return normalize(plain(root)).slice(0, 60000)
  }
  const messages = nodes.slice(-2).map((node, localIndex) => {
    const container =
      node.closest(
        '[data-message-id],[data-response-id],[data-testid^="conversation-turn"],.segment-assistant,.qwen-chat-message-assistant,.ds-message,[data-testid="assistant-message"],[data-message-author-role="assistant"]',
      ) || node
    const identityNode = container.matches('[data-message-id],[data-response-id],[id]')
      ? container
      : container.querySelector('[data-message-id],[data-response-id],[id^="chat-response-message-"]')
    const explicit =
      identityNode?.getAttribute('data-message-id') ||
      identityNode?.getAttribute('data-response-id') ||
      identityNode?.id ||
      (/^conversation-turn-/.test(container.getAttribute('data-testid') || '')
        ? container.getAttribute('data-testid')
        : '')
    const key =
      explicit && explicit !== 'assistant-message'
        ? 'id:' + explicit.slice(0, 250)
        : 'position:' + (nodes.length - Math.min(nodes.length, 2) + localIndex)
    return { key, text: serialize(node) }
  })
  return { supported: true, messages, generating, blocked: false }
}

function standalone(name, action) {
  return new Function(
    `return function ${name}(config) { return (${websiteResponseAction.toString()})({ ...config, action: ${JSON.stringify(
      action,
    )} }); };`,
  )()
}
const readWebsiteResponse = standalone('readWebsiteResponse', 'read')
const stopWebsiteResponse = standalone('stopWebsiteResponse', 'stop')
const RESPONSE_HOSTS = {
  chatgpt: ['chatgpt.com', 'chat.openai.com'],
  claude: ['claude.ai'],
  gemini: ['gemini.google.com'],
  deepseek: ['chat.deepseek.com'],
  doubao: ['www.doubao.com', 'doubao.com'],
  qwen: ['qwen.ai', 'chat.qwen.ai'],
  kimi: ['www.kimi.com', 'kimi.com'],
  perplexity: ['www.perplexity.ai', 'perplexity.ai'],
  grok: ['grok.com'],
}
function officialUrl(siteId, value) {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      Boolean(RESPONSE_HOSTS[siteId]?.includes(url.hostname))
    )
  } catch {
    return false
  }
}
function abortError() {
  const error = new Error('本轮已停止。')
  error.name = 'AbortError'
  return error
}
function cancellable(operation, signal, milliseconds, timeoutMessage) {
  if (signal?.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    let timer
    let settled = false
    const aborted = () => finish(reject, abortError())
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', aborted)
      fn(value)
    }
    signal?.addEventListener('abort', aborted, { once: true })
    timer = setTimeout(() => finish(reject, new Error(timeoutMessage)), milliseconds)
    Promise.resolve(operation).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    )
  })
}

function delay(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', aborted)
      reject(abortError())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', aborted)
      resolve()
    }, milliseconds)
    signal?.addEventListener('abort', aborted, { once: true })
  })
}

// Baseline answers stay inside this monitor. Only a current-turn answer reaches
// onUpdate or wait's result, never old transcript contents or page chrome.
function createResponseMonitor(contents, siteId, options = {}) {
  const signal = options.signal
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, Math.min(options.timeoutMs, 600000)) : 180000
  let baseline = options.baseline || null
  let baselineUrl = ''
  let waitPromise
  const assertAvailable = () => {
    if (signal?.aborted) throw abortError()
    if (!contents || contents.isDestroyed()) throw new Error('成员官网窗口已关闭，无法继续读取回复。')
    const url = contents.getURL()
    if (!officialUrl(siteId, url)) throw new Error('成员窗口已离开对应 AI 官网，已停止读取回复。')
    return url
  }
  const snapshot = async (remaining = 5000) => {
    const url = assertAvailable()
    const config = { siteId, allowedHosts: RESPONSE_HOSTS[siteId] }
    const script = `(${readWebsiteResponse.toString()})(${JSON.stringify(config)
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029')})`
    const value = await cancellable(
      contents.executeJavaScript(script, false),
      signal,
      Math.min(5000, remaining),
      '读取官网回复超时，请打开成员官网查看。',
    )
    assertAvailable()
    if (
      !value ||
      typeof value.supported !== 'boolean' ||
      !Array.isArray(value.messages) ||
      value.messages.length > 2 ||
      value.messages.some(
        (message) =>
          !message ||
          typeof message.key !== 'string' ||
          message.key.length > 260 ||
          typeof message.text !== 'string' ||
          message.text.length > 60000,
      )
    )
      throw new Error('官网回复格式发生变化，请打开成员官网查看。')
    if (!value.supported || value.blocked) throw new Error(value.detail || '官网暂时无法读取回复，请打开成员官网查看。')
    return { ...value, sourceUrl: contents.getURL() || url }
  }
  const capture = async () => {
    const value = await snapshot()
    if (value.generating) throw new Error('成员官网还在生成上一轮回复，请等完成后重试。')
    baseline = value
    baselineUrl = value.sourceUrl
    return value
  }
  const waitForCurrent = async () => {
    if (!baseline) throw new Error('请在发送之前记录回复基线，已停止读取以免混入旧回答。')
    baselineUrl ||= baseline.sourceUrl || assertAvailable()
    const old = new Map(baseline.messages.map((message) => [message.key, message.text]))
    const oldTexts = new Set(baseline.messages.map((message) => message.text))
    const maximumOldPosition = Math.max(
      -1,
      ...baseline.messages.map((message) => (/^position:(\d+)$/.test(message.key) ? Number(message.key.slice(9)) : -1)),
    )
    const started = Date.now()
    let changedAt = 0
    let currentText = ''
    let candidateKey = ''
    let failures = 0
    let lockedUrl = baselineUrl
    // Only verified ChatGPT display options may change without changing the
    // conversation. Unknown query parameters and other providers remain exact.
    const conversationIdentity = (value) => {
      const url = new URL(value)
      if (siteId === 'chatgpt') {
        url.hash = ''
        const query = url.search
          .slice(1)
          .split('&')
          .filter((part) => !/^(?:model|temporary-chat)(?:=|$)/.test(part))
        url.search = query.join('&')
      }
      return url.href
    }
    // A homepage may receive its first conversation URL after sending. An
    // existing conversation must not silently switch to another old transcript.
    const homePaths = {
      chatgpt: [''],
      claude: ['', '/new'],
      gemini: ['/app'],
      deepseek: [''],
      doubao: ['', '/chat'],
      qwen: [''],
      kimi: [''],
      perplexity: [''],
      grok: [''],
    }
    let mayAcquireConversation =
      baseline.messages.length === 0 &&
      (homePaths[siteId] || []).includes(new URL(baselineUrl).pathname.replace(/\/+$/, ''))
    while (Date.now() - started < timeoutMs) {
      let value
      try {
        value = await snapshot(Math.max(1, timeoutMs - (Date.now() - started)))
        failures = 0
      } catch (error) {
        if (
          error.name === 'AbortError' ||
          !officialUrl(siteId, contents.getURL()) ||
          /窗口已关闭|暂时无法|官网提示|官网需要|格式发生变化|暂未接入/.test(error.message)
        )
          throw error
        if (++failures >= 3) throw new Error('连续读取官网回复失败，请打开成员官网查看。')
        await delay(Math.min(800, Math.max(1, timeoutMs - (Date.now() - started))), signal)
        continue
      }
      if (conversationIdentity(value.sourceUrl) !== conversationIdentity(lockedUrl)) {
        const previous = new URL(conversationIdentity(lockedUrl))
        const current = new URL(conversationIdentity(value.sourceUrl))
        const newConversationPath =
          current.origin === previous.origin &&
          current.pathname !== previous.pathname &&
          current.search === previous.search &&
          current.hash === previous.hash
        if (!mayAcquireConversation || !newConversationPath)
          throw new Error('成员官网已切换会话，已停止读取以免混入其他回答。')
        mayAcquireConversation = false
      }
      lockedUrl = value.sourceUrl
      const candidates = value.messages.filter((message) => {
        if (!message.text.trim()) return false
        if (old.has(message.key)) return old.get(message.key) !== message.text
        // DOM virtualizers can recycle positional keys. A shifted old answer
        // with an unchanged body must not be imported as this round's reply.
        const position = /^position:(\d+)$/.test(message.key) ? Number(message.key.slice(9)) : -1
        return !message.key.startsWith('position:') || position > maximumOldPosition || !oldTexts.has(message.text)
      })
      const candidate = candidates.at(-1)
      if (candidate) {
        if (candidate.key !== candidateKey || candidate.text !== currentText) {
          candidateKey = candidate.key
          currentText = candidate.text
          changedAt = Date.now()
          if (typeof options.onUpdate === 'function') options.onUpdate(currentText)
        }
        if (value.generating) changedAt = Date.now()
        if (!value.generating && Date.now() - changedAt >= 2400)
          return { text: currentText, sourceUrl: value.sourceUrl }
      } else if (currentText) {
        // A transient rerender or vanished candidate cannot complete the turn.
        changedAt = Date.now()
      }
      const remaining = timeoutMs - (Date.now() - started)
      if (remaining <= 0) break
      await delay(Math.min(800, remaining), signal)
    }
    throw new Error(
      currentText
        ? '等待回复完成超时，已保留收到的内容，请在官网核对。'
        : '未读取到本轮回复，请打开成员官网检查登录、生成状态或网页变化。',
    )
  }
  return { capture, wait: () => (waitPromise ||= waitForCurrent()) }
}
module.exports = { readWebsiteResponse, stopWebsiteResponse, createResponseMonitor, RESPONSE_HOSTS }
