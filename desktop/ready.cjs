// Serialized into an official website. This function only observes composer
// metadata and draft presence: it never focuses, types, clicks or reads chats.
async function readWebsiteReadiness(config) {
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
  const result = (ready, generating = false, hasDraft = false, detail) => ({
    supported: Boolean(hosts[config.siteId]),
    ready,
    generating,
    hasDraft,
    ...(detail ? { detail } : {}),
  })
  const scoped = () => {
    try {
      const url = new URL(location.href)
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.port ||
        !hosts[config.siteId]?.includes(url.hostname) ||
        !Array.isArray(config.allowedHosts) ||
        !config.allowedHosts.includes(url.hostname)
      )
        return false
      return !config.expectedUrl || url.href === new URL(config.expectedUrl).href
    } catch {
      return false
    }
  }
  if (!hosts[config.siteId]) return result(false, false, false, '这个官网暂未接入输入框检测。')
  if (!scoped()) return result(false, false, false, '窗口已离开对应 AI 官网，已停止等待输入框。')
  const visible = (element) => {
    if (!element?.isConnected || element.closest('[hidden],[inert],[aria-hidden="true"]')) return false
    for (let parent = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent)
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
  const selectors = {
    chatgpt: ['#prompt-textarea', '[contenteditable="true"][aria-label*="ChatGPT"]'],
    claude: [
      '[contenteditable="true"][data-placeholder*="Reply"]',
      '[contenteditable="true"][data-placeholder*="回复"]',
      'div.ProseMirror[contenteditable="true"]',
    ],
    gemini: [
      'rich-textarea [contenteditable="true"]',
      '.ql-editor[contenteditable="true"]',
      '[contenteditable="true"][aria-label*="Gemini"]',
    ],
    deepseek: ['textarea#chat-input', 'textarea[placeholder*="DeepSeek"]'],
    doubao: [
      'textarea[placeholder*="发消息"]',
      'textarea[placeholder*="发送消息"]',
      '[contenteditable="true"][data-placeholder*="发消息"]',
      'div.tiptap.ProseMirror[contenteditable="true"]',
    ],
    qwen: [
      '#chat-input',
      '.tiptap[contenteditable="true"]',
      'textarea[placeholder*="Qwen"]',
      'textarea[placeholder*="千问"]',
      'textarea[placeholder*="问一个问题"]',
    ],
    kimi: [
      '.chat-input-editor[contenteditable="true"]',
      '.chat-input-editor[contenteditable="plaintext-only"]',
      '.chat-input [contenteditable="true"]',
      '[contenteditable="true"][data-placeholder*="尽管问"]',
      'textarea[placeholder*="尽管问"]',
      '[contenteditable="true"][data-placeholder*="Ask anything"]',
    ],
    perplexity: [
      'textarea[placeholder*="Ask anything"]',
      'textarea[placeholder*="Ask a follow-up"]',
      'textarea[placeholder*="追问"]',
      'textarea[placeholder*="任何问题"]',
      '[contenteditable="true"][data-placeholder*="Ask anything"]',
      '[contenteditable="true"][data-placeholder*="Ask a follow-up"]',
    ],
    grok: [
      'textarea[aria-label="Ask Grok anything"]',
      '[contenteditable="true"][aria-label="Ask Grok anything"]',
      'textarea[placeholder*="Ask anything"]',
      'textarea[placeholder*="Ask Grok"]',
    ],
  }
  const usable = (element) => {
    if (
      !visible(element) ||
      element.disabled ||
      element.readOnly ||
      element.getAttribute('aria-disabled') === 'true' ||
      element.getAttribute('aria-readonly') === 'true'
    )
      return false
    if (element.tagName !== 'TEXTAREA' && !['true', 'plaintext-only'].includes(element.getAttribute('contenteditable')))
      return false
    const excluded = /(?:password|email|phone|verification|sign.?in|log.?in|search|搜索|邮箱|密码|手机号|验证码)/i
    const metadata = ['aria-label', 'placeholder', 'data-placeholder', 'id']
      .map((key) => element.getAttribute(key) || '')
      .join(' ')
    if (excluded.test(metadata)) return false
    const name = element.getAttribute('name') || ''
    const deepseekName =
      config.siteId === 'deepseek' &&
      element.tagName === 'TEXTAREA' &&
      name.toLowerCase() === 'search' &&
      /^(?:给\s*DeepSeek\s*发送消息|Message\s*DeepSeek)$/i.test((element.getAttribute('placeholder') || '').trim())
    if (excluded.test(name) && !deepseekName) return false
    const form = element.closest('form')
    if (form && Array.from(form.querySelectorAll('input[type="password"],input[type="email"]')).some(visible))
      return false
    if (
      Array.from(document.querySelectorAll('[aria-modal="true"]')).some(
        (modal) => visible(modal) && !modal.contains(element),
      )
    )
      return false
    return true
  }
  const sendControl = (editor) => {
    const known = (button, root) => {
      if (
        !visible(button) ||
        button.closest(
          '[data-message-author-role],[data-role="user"],[data-role="assistant"],user-query,model-response,.markdown,.ds-markdown,.font-claude-response,.segment-content-box,.response-message-content,.response-content-markdown,.prose',
        )
      )
        return false
      const labels = [
        ...['aria-label', 'title', 'data-tooltip-content'].map((key) => button.getAttribute(key) || ''),
        (button.textContent || '').slice(0, 80),
      ].filter(Boolean)
      if (
        labels.some((label) =>
          /(?:stop|停止|voice|语音|microphone|麦克风|login|登录|search|搜索|upload|上传|cancel|取消)/i.test(label),
        )
      )
        return false
      const label = labels.some((value) =>
        /^(?:Send(?: message| prompt| to .+)?|Submit(?: message| prompt)?|发送(?:消息)?|提交(?:消息)?|发送给\s*.+)$/i.test(
          value.trim(),
        ),
      )
      const testId = button.getAttribute('data-testid') || button.getAttribute('data-test-id') || ''
      const test =
        /^(?:send-button|send-message-button|send-prompt-button|chat-input-send-button|chat-send-button|send-message|composer-send-button)$/.test(
          testId,
        )
      const classes = Array.from(button.classList).some((value) =>
        /^(?:send-button|send-btn|chat-send-button|chat-input-send|chat-input-send-button|send-button-container)$/.test(
          value,
        ),
      )
      const icon = button.querySelector(
        'svg.lucide-arrow-up,svg.lucide-send,[data-icon="send"],[data-icon="arrow-up"],use[href*="send"],use[xlink\\:href*="send"]',
      )
      return label || test || classes || Boolean(icon)
    }
    for (
      let root = editor.parentElement, depth = 0;
      root && depth < 7 && !['BODY', 'HTML', 'MAIN'].includes(root.tagName);
      root = root.parentElement, depth++
    ) {
      const matches = Array.from(root.querySelectorAll('button,[role="button"]')).filter((button) =>
        known(button, root),
      )
      if (matches.length === 1) return matches[0]
      if (matches.length > 1) return null
    }
    return null
  }
  const locate = () => {
    for (const selector of selectors[config.siteId]) {
      const matches = Array.from(document.querySelectorAll(selector)).filter(usable)
      if (matches.length === 1) return { element: matches[0], specific: true }
    }
    const semantic = {
      chatgpt: /(?:询问\s*ChatGPT|Ask\s*ChatGPT|Message\s*ChatGPT)/i,
      claude: /(?:Reply to Claude|Message Claude|回复\s*Claude)/i,
      gemini: /(?:为\s*Gemini\s*输入|问问\s*Gemini|Enter a prompt for Gemini)/i,
      deepseek: /(?:给\s*DeepSeek\s*发送|Message\s*DeepSeek)/i,
      doubao: /(?:发消息|发送消息|Message\s*Doubao)/i,
      qwen: /(?:问问千问|Message\s*Qwen)/i,
      kimi: /(?:尽管问|Message\s*Kimi|Ask anything, or task an agent)/i,
      perplexity: /(?:Ask a follow.?up|Ask anything|追问)/i,
      grok: /(?:Ask Grok anything|询问\s*Grok)/i,
    }[config.siteId]
    const matches = Array.from(
      document.querySelectorAll('textarea,[contenteditable="true"],[contenteditable="plaintext-only"]'),
    ).filter(
      (element) =>
        usable(element) &&
        semantic.test(
          ['aria-label', 'placeholder', 'data-placeholder'].map((key) => element.getAttribute(key) || '').join(' '),
        ),
    )
    return matches.length === 1 && sendControl(matches[0]) ? { element: matches[0], specific: false } : null
  }
  const stopSelectors =
    '[data-testid="stop-button"],[data-testid="stop-generation-button"],[data-testid="chat-input-stop-button"],button[aria-label="Stop"],button[aria-label="Stop generating"],button[aria-label="Stop response"],button[aria-label="Stop Response"],button[aria-label="停止"],button[aria-label="停止生成"],button[aria-label="停止回答"],button[title="停止生成"],button[title="Stop generating"]'
  const specificStops = {
    gemini: 'button.stop-button,button[data-test-id="stop-button"]',
    doubao: '#flow-end-msg-stop,[data-testid="chat_input_stop_button"]',
    qwen: 'button.stop-button',
    kimi: '.chat-box .send-button-container.stop,.chat-input .send-button-container.stop',
    grok: 'button[data-testid="chat-stop"]',
  }
  const generating = () =>
    Array.from(
      document.querySelectorAll(
        stopSelectors + (specificStops[config.siteId] ? ',' + specificStops[config.siteId] : ''),
      ),
    ).some(
      (element) =>
        visible(element) &&
        !element.closest(
          '[data-message-author-role], [data-role="user"], [data-role="assistant"], .markdown, .ds-markdown, .font-claude-response, .segment-content-box, .response-content-markdown, .prose',
        ),
    )
  const hasDraft = (element) => {
    if (element.tagName === 'TEXTAREA') return /\S/.test(element.value)
    const walker = document.createTreeWalker(element, 4)
    let node
    let visited = 0
    while ((node = walker.nextNode())) {
      if (++visited > 3000) return true
      const parent = node.parentElement
      if (
        parent?.closest(
          'script,style,button,svg,[hidden],[inert],[aria-hidden="true"],[contenteditable="false"][data-placeholder]',
        ) ||
        !visible(parent)
      )
        continue
      if (/\S/.test((node.nodeValue || '').slice(0, 60000))) return true
    }
    return false
  }
  const metadata = (located) =>
    JSON.stringify([
      located.specific,
      located.element.tagName,
      ...[
        'id',
        'class',
        'name',
        'role',
        'aria-label',
        'placeholder',
        'data-placeholder',
        'contenteditable',
        'aria-disabled',
        'aria-readonly',
      ].map((key) => (located.element.getAttribute(key) || '').slice(0, 500)),
    ])
  if (generating()) return result(true, true)
  const initial = locate()
  if (!initial) return result(false)
  if (hasDraft(initial.element)) return result(true, false, true)
  const initialMetadata = metadata(initial)
  const started = Date.now()
  do {
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (!scoped()) return result(false, false, false, '等待期间官网网址已变化，已停止等待输入框。')
    if (generating()) return result(true, true)
    const current = locate()
    if (!current || current.element !== initial.element || metadata(current) !== initialMetadata) return result(false)
    if (hasDraft(current.element)) return result(true, false, true)
  } while (Date.now() - started < 800)
  return result(true)
}

const READY_HOSTS = {
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
function official(siteId, value) {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      Boolean(READY_HOSTS[siteId]?.includes(url.hostname))
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
function bounded(operation, signal, milliseconds) {
  if (signal?.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    let timer
    let settled = false
    const finish = (handler, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancelled)
      handler(value)
    }
    const cancelled = () => finish(reject, abortError())
    signal?.addEventListener('abort', cancelled, { once: true })
    timer = setTimeout(() => finish(reject, new Error('官网输入框检测超时，请打开成员官网检查。')), milliseconds)
    Promise.resolve(operation).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    )
  })
}
function delay(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const cancelled = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancelled)
      reject(abortError())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancelled)
      resolve()
    }, milliseconds)
    signal?.addEventListener('abort', cancelled, { once: true })
  })
}

async function waitForWebsiteReady(contents, siteId, options = {}) {
  if (!READY_HOSTS[siteId]) throw new Error('这个官网暂未接入输入框检测。')
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, Math.min(options.timeoutMs, 15000)) : 15000
  const deadline = Date.now() + timeoutMs
  const signal = options.signal
  const check = () => {
    if (signal?.aborted) throw abortError()
    if (contents.isDestroyed()) throw new Error('成员官网窗口已关闭，已停止等待输入框。')
    if (!official(siteId, contents.getURL())) throw new Error('窗口已离开对应 AI 官网，已停止等待输入框。')
  }
  check()
  const sourceUrl = contents.getURL()
  const checkSource = () => {
    check()
    if (contents.getURL() !== sourceUrl) throw new Error('等待期间官网网址已变化，请重新发送。')
  }
  while (Date.now() < deadline) {
    checkSource()
    if (!contents.isLoadingMainFrame()) {
      const config = { siteId, allowedHosts: READY_HOSTS[siteId], expectedUrl: sourceUrl }
      const snapshot = await bounded(
        contents.executeJavaScript(`(${readWebsiteReadiness.toString()})(${JSON.stringify(config)})`, false),
        signal,
        Math.min(2200, Math.max(1, deadline - Date.now())),
      )
      checkSource()
      if (
        !snapshot ||
        typeof snapshot.ready !== 'boolean' ||
        typeof snapshot.generating !== 'boolean' ||
        typeof snapshot.hasDraft !== 'boolean'
      )
        throw new Error('官网输入框检测结果异常，请打开成员官网检查。')
      if (snapshot.detail) throw new Error(snapshot.detail)
      if (snapshot.ready)
        return { ready: true, siteId, sourceUrl, generating: snapshot.generating, hasDraft: snapshot.hasDraft }
    }
    const remaining = deadline - Date.now()
    if (remaining > 0) await delay(Math.min(200, remaining), signal)
  }
  throw new Error('官网输入框尚未准备好，请打开成员官网完成登录或验证，再重试。')
}

module.exports = { readWebsiteReadiness, waitForWebsiteReady, READY_HOSTS }
