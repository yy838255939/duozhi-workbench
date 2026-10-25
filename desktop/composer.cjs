// Functions are embedded as source in an isolated, Node-free official website.
// Keep every browser dependency inside composerAction; never capture Node values.
async function composerAction(config) {
  const stateKey = '__duozhiWebsiteComposerV1'
  const normalize = (text) =>
    String(text ?? '')
      .replace(/\r\n?/g, '\n')
      .trim()
  const result = (status, detail) => ({ status, detail })
  const runValid = () =>
    !config.runToken || (window.__duozhiGroupRunV1?.id === config.runToken && !window.__duozhiGroupRunV1.cancelled)
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
  const knownStop =
    '[data-testid="stop-button"], [data-testid="stop-generation-button"], [data-testid="chat-input-stop-button"], button[aria-label="Stop"], button[aria-label="停止"], button[aria-label*="Stop generating"], button[aria-label*="Stop response"], button[aria-label*="停止生成"], button[aria-label*="停止回答"], button[title*="停止生成"], button[title*="Stop generating"]'
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  const scopeIsValid = (exactUrl) => {
    try {
      const current = new URL(location.href)
      const expected = new URL(config.expectedUrl)
      return (
        current.protocol === 'https:' &&
        expected.protocol === 'https:' &&
        current.origin === expected.origin &&
        Array.isArray(config.allowedHosts) &&
        config.allowedHosts.includes(current.hostname) &&
        (!exactUrl || current.href === expected.href)
      )
    } catch {
      return false
    }
  }
  const visible = (element) => {
    if (!element?.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false
    for (let parent = element; parent && parent !== document.documentElement; parent = parent.parentElement) {
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
  const usable = (element) => {
    if (
      !visible(element) ||
      element.disabled ||
      element.readOnly ||
      element.getAttribute('aria-disabled') === 'true' ||
      element.getAttribute('aria-readonly') === 'true'
    )
      return false
    const editable =
      element.tagName === 'TEXTAREA' || ['true', 'plaintext-only'].includes(element.getAttribute('contenteditable'))
    if (!editable) return false
    const excludedMetadata =
      /(?:password|email|phone|verification|sign.?in|log.?in|search|搜索|邮箱|密码|手机号|验证码)/i
    const metadata = ['aria-label', 'placeholder', 'data-placeholder', 'id']
      .map((key) => element.getAttribute(key) || '')
      .join(' ')
    if (excludedMetadata.test(metadata)) return false
    // DeepSeek's real chat textarea is named "search". Only its dedicated
    // provider prompt placeholder qualifies for this narrowly scoped exception.
    const name = element.getAttribute('name') || ''
    const deepseekChatName =
      config.siteId === 'deepseek' &&
      element.tagName === 'TEXTAREA' &&
      name.toLowerCase() === 'search' &&
      /^(?:给\s*DeepSeek\s*发送消息|Message\s*DeepSeek)$/i.test((element.getAttribute('placeholder') || '').trim())
    if (excludedMetadata.test(name) && !deepseekChatName) return false
    const form = element.closest('form')
    if (form && Array.from(form.querySelectorAll('input[type="password"], input[type="email"]')).some(visible))
      return false
    if (
      Array.from(document.querySelectorAll('[aria-modal="true"]')).some(
        (modal) => visible(modal) && !modal.contains(element),
      )
    )
      return false
    return true
  }
  const editorText = (element) => {
    if (element.tagName === 'TEXTAREA') return element.value
    // Paragraphs are one line separator. innerText adds two between paragraphs
    // in some rich-text editors, so derive the plain message from DOM structure.
    const read = (node) => {
      if (node.nodeType === 3) return node.nodeValue || ''
      if (
        node.nodeType !== 1 ||
        (node.hasAttribute('data-placeholder') && node.getAttribute('contenteditable') === 'false')
      )
        return ''
      if (node.tagName === 'BR') return '\n'
      let text = ''
      for (const child of node.childNodes) {
        const block = child.nodeType === 1 && /^(P|DIV|LI)$/.test(child.tagName)
        if (block && text && !text.endsWith('\n')) text += '\n'
        text += read(child)
        if (block && !text.endsWith('\n')) text += '\n'
      }
      return text
    }
    return read(element)
  }
  const isFocused = (element) => document.activeElement === element || element.contains(document.activeElement)
  const allButtons = (root) => Array.from(root.querySelectorAll('button, [role="button"]'))
  const generating = () => {
    if (Array.from(document.querySelectorAll(knownStop)).some(visible)) return true
    return allButtons(document).some(
      (button) =>
        visible(button) &&
        [button.getAttribute('aria-label'), button.getAttribute('title'), button.textContent]
          .filter(Boolean)
          .some((label) =>
            /^(?:Stop(?: generating| response| model response)?|停止(?:生成|回答|输出|响应|回复)?)$/i.test(
              label.trim(),
            ),
          ),
    )
  }
  const locate = () => {
    for (const selector of selectors[config.siteId] || []) {
      const elements = Array.from(document.querySelectorAll(selector)).filter(usable)
      if (elements.length === 1) return { element: elements[0], specific: true }
    }
    // This semantic fallback can fill a draft, but never uses Enter without a
    // dedicated provider selector. The send button must be explicitly identified.
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
    const matches = []
    for (const element of document.querySelectorAll(
      'textarea, [contenteditable="true"], [contenteditable="plaintext-only"]',
    )) {
      const label = ['aria-label', 'placeholder', 'data-placeholder']
        .map((key) => element.getAttribute(key) || '')
        .join(' ')
      if (semantic.test(label) && usable(element)) matches.push(element)
    }
    return matches.length === 1 ? { element: matches[0], specific: false } : null
  }
  const userMessageCount = () =>
    document.querySelectorAll(
      '[data-message-author-role="user"], [data-role="user"], [data-testid="user-message"], user-query, .user-query',
    ).length
  const submissionFailure = () => {
    const notices = document.querySelectorAll(
      '[role="alert"], [role="dialog"], [aria-modal="true"], [data-sonner-toast], [class*="toast"], [class*="Toast"], [class*="notification"], [class*="Notification"], [class*="error-message"], [class*="errorMessage"], [class*="chat-error"], [class*="chatError"], [class*="modal"], [class*="Modal"], [class*="popup"], [class*="Popup"], .ant-message-notice, .el-message, .queue-notice, .queue-tip',
    )
    for (const notice of notices) {
      if (!visible(notice)) continue
      if (
        notice.closest(
          '[data-message-author-role], [data-role="user"], [data-role="assistant"], user-query, .user-query, model-response, .model-response',
        )
      )
        continue
      // Inspect only bounded UI notices, not conversation text or the page body.
      const text = (notice.textContent || '').slice(0, 1200)
      if (
        /(?:和Kimi聊天的人太多|订阅会员可进入优先队列|请求过于频繁|服务器繁忙|系统繁忙|发送失败|消息发送失败|额度已用完|已达到.{0,12}(?:上限|限制)|超出.{0,12}(?:额度|限制)|出了点问题|Something went wrong|message failed|failed to send|rate limit|too many requests|usage limit|capacity|try again later)/i.test(
          text,
        )
      )
        return true
    }
    return false
  }
  const safeSendButton = (composer) => {
    const identified = (button, root) => {
      if (!visible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') return false
      const labels = ['aria-label', 'title', 'data-tooltip-content']
        .map((key) => button.getAttribute(key) || '')
        .filter(Boolean)
      if (
        labels.some((label) =>
          /(?:stop|停止|voice|语音|microphone|麦克风|login|登录|search|搜索|upload|上传|cancel|取消)/i.test(label),
        )
      )
        return false
      const explicitLabel = labels.some((label) =>
        /^(?:Send(?: message| prompt| to .+)?|Submit(?: message| prompt)?|发送(?:消息)?|提交(?:消息)?|发送给\s*.+)$/i.test(
          label.trim(),
        ),
      )
      const testId = button.getAttribute('data-testid') || button.getAttribute('data-test-id') || ''
      const explicitTest =
        /^(?:send-button|send-message-button|send-prompt-button|chat-input-send-button|chat-send-button|send-message|composer-send-button)$/.test(
          testId,
        )
      const explicitClass = Array.from(button.classList).some((name) =>
        /^(?:send-button|send-btn|chat-send-button|chat-input-send|chat-input-send-button|send-button-container)$/.test(
          name,
        ),
      )
      const icon = button.querySelector(
        'svg.lucide-arrow-up, svg.lucide-send, [data-icon="send"], [data-icon="arrow-up"], use[href*="send"], use[xlink\\:href*="send"]',
      )
      const submit =
        button.tagName === 'BUTTON' &&
        button.getAttribute('type') === 'submit' &&
        root.tagName === 'FORM' &&
        root.contains(composer)
      const explicitText = /^(?:Send|Send message|Submit|发送|发送消息|提交)$/i.test((button.textContent || '').trim())
      return explicitLabel || explicitTest || explicitClass || !!icon || submit || explicitText
    }
    // Only the composer's own ancestors are searched, never unrelated toolbars.
    for (
      let root = composer.parentElement, depth = 0;
      root && depth < 7 && !['BODY', 'HTML', 'MAIN'].includes(root.tagName);
      root = root.parentElement, depth++
    ) {
      const candidates = allButtons(root).filter((button) => identified(button, root))
      if (candidates.length === 1) return candidates[0]
      if (candidates.length > 1) return null
    }
    return null
  }
  const confirmation = async (transaction) => {
    if (!transaction.submission) return result('blocked', '本窗口尚未执行提交，未确认发送。')
    const started = Date.now()
    const deadline = started + 4400
    let emptySince = 0
    do {
      if (!scopeIsValid(false)) return result('blocked', '官网已跳转到其他来源，未确认发送。')
      if (submissionFailure()) {
        delete window[stateKey]
        return result('blocked', '官网提示排队、额度限制或发送失败，请在本窗口处理后再发。')
      }
      // A composer may clear optimistically before the server rejects a message.
      // Allow toast/dialog errors to render before accepting clear/new-message UI.
      const settled = Date.now() - started >= 2200
      if (settled && generating()) {
        delete window[stateKey]
        return result('sent', '官网已开始生成回复。')
      }
      if (settled && userMessageCount() > transaction.submission.userMessages) {
        delete window[stateKey]
        return result('sent', '官网已新增用户消息。')
      }
      const current = transaction.element.isConnected ? transaction.element : locate()?.element
      const empty = current && visible(current) && normalize(editorText(current)) === ''
      if (empty && !emptySince) emptySince = Date.now()
      if (!empty) emptySince = 0
      if (settled && emptySince && Date.now() - emptySince >= 600) {
        delete window[stateKey]
        return result('sent', '官网已提交并清空输入框。')
      }
      await wait(160)
    } while (Date.now() < deadline)
    delete window[stateKey]
    return result('unconfirmed', '已触发提交，但未检测到输入清空或回复开始；请查看本窗口，避免重复发送。')
  }

  if (!runValid()) return result('blocked', '本轮任务已停止或被替换，未继续提交。')
  if (!selectors[config.siteId]) return result('unsupported', '该官网暂未接入自动发送，请在本窗口单独发送。')
  if (!scopeIsValid(config.action !== 'confirm'))
    return result('blocked', '窗口网址已变化或不属于当前 AI 官网，请重试。')
  if (config.action === 'prepare') {
    delete window[stateKey]
    if (submissionFailure()) return result('blocked', '官网提示排队、额度限制或发送失败，请先在本窗口处理。')
    if (generating()) return result('busy', '本窗口正在生成回复，请稍后再发。')
    const composer = locate()
    if (!composer) return result('blocked', '未找到可用的聊天输入框，请先完成登录或官网验证。')
    if (normalize(editorText(composer.element)))
      return result('draft-conflict', '本窗口已有未发送的草稿，已保留，请先处理草稿。')
    composer.element.focus({ preventScroll: true })
    if (!isFocused(composer.element)) return result('blocked', '聊天输入框无法获得焦点，请先关闭官网弹窗。')
    window[stateKey] = {
      element: composer.element,
      siteId: config.siteId,
      url: location.href,
      preparedAt: Date.now(),
      specific: composer.specific,
    }
    return result('ready', '聊天输入框已准备好。')
  }
  const transaction = window[stateKey]
  if (!transaction || transaction.siteId !== config.siteId || Date.now() - transaction.preparedAt > 30000)
    return result('blocked', '输入框准备状态已失效，请重新发送。')
  if (config.action === 'confirm') return confirmation(transaction)
  if (
    !transaction.element.isConnected ||
    !usable(transaction.element) ||
    !isFocused(transaction.element) ||
    transaction.url !== location.href
  )
    return result('blocked', '输入框或焦点已变化，已停止提交。')
  if (generating()) return result('busy', '本窗口正在生成回复，文本已保留为草稿。')
  if (!normalize(config.message) || normalize(editorText(transaction.element)) !== normalize(config.message))
    return result('draft-conflict', '官网输入内容与群发文本不一致，已停止提交并保留草稿。')

  let button = null
  const buttonDeadline = Date.now() + 1200
  do {
    button = safeSendButton(transaction.element)
    if (button) break
    await wait(120)
  } while (Date.now() < buttonDeadline)
  // React may replace the editor or the user may type while the button renders.
  if (!runValid() || !scopeIsValid(true) || !transaction.element.isConnected || !isFocused(transaction.element))
    return result('blocked', '等待期间页面或输入框焦点已变化，已停止提交。')
  if (generating()) return result('busy', '官网已开始生成其他回复，已停止提交。')
  if (normalize(editorText(transaction.element)) !== normalize(config.message))
    return result('draft-conflict', '等待期间输入内容已变化，已保留草稿。')
  transaction.submission = { userMessages: userMessageCount() }
  if (!button) {
    if (transaction.specific) return result('keyboard-ready', '已确认官网聊天输入框，等待 Enter 提交。')
    delete transaction.submission
    return result('unsupported', '未识别到可靠的发送按钮，文本已保留，请在官网手动发送。')
  }
  if (config.runToken) window.__duozhiGroupRunV1.submitted = true
  button.click()
  return confirmation(transaction)
}

// Produce standalone function bodies. Serializing an export embeds the complete
// browser implementation instead of referring to a Node/module closure.
function standalone(name, action) {
  return new Function(
    `return async function ${name}(config) { return (${composerAction.toString()})({ ...config, action: ${JSON.stringify(
      action,
    )} }); };`,
  )()
}

module.exports = {
  prepareComposer: standalone('prepareComposer', 'prepare'),
  submitComposer: standalone('submitComposer', 'submit'),
  confirmSubmission: standalone('confirmSubmission', 'confirm'),
}
