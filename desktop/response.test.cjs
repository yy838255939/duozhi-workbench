const { test } = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')
const { readWebsiteResponse, stopWebsiteResponse, createResponseMonitor, RESPONSE_HOSTS } = require('./response.cjs')

function fixture(html, siteId = 'chatgpt', url = 'https://chatgpt.com/c/test') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true })
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
    width: 400,
    height: 40,
    top: 0,
    left: 0,
    right: 400,
    bottom: 40,
  })
  const run = (fn = readWebsiteResponse, extra = {}) =>
    dom.window.eval(`(${fn.toString()})(${JSON.stringify({ siteId, allowedHosts: RESPONSE_HOSTS[siteId], ...extra })})`)
  return { dom, document: dom.window.document, window: dom.window, run, close: () => dom.window.close() }
}
const snap = (messages = [], generating = false) => ({ supported: true, messages, generating, blocked: false })
function fakeContents(initial) {
  const state = { value: initial, url: 'https://chatgpt.com/c/test', destroyed: false, reads: 0 }
  const contents = {
    getURL: () => state.url,
    isDestroyed: () => state.destroyed,
    executeJavaScript: async (script, gesture) => {
      assert.equal(gesture, false)
      assert.match(script, /readWebsiteResponse/)
      state.reads++
      return typeof state.value === 'function' ? state.value() : state.value
    },
  }
  return { contents, state }
}
const flush = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve()
}
async function advance(t, milliseconds) {
  t.mock.timers.tick(milliseconds)
  await flush()
}
function clock(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
}

test('serialized browser reader returns only last two assistant bodies and stable message IDs', () => {
  const page = fixture(
    '<nav>私人账号</nav><div data-message-author-role="user">用户私密文本</div>' +
      [1, 2, 3]
        .map(
          (i) =>
            `<article data-message-author-role="assistant" data-message-id="answer-${i}"><div class="markdown"><p>答案 ${i}</p><button>复制</button></div></article>`,
        )
        .join(''),
  )
  try {
    const result = page.run()
    assert.equal(result.messages.length, 2)
    assert.deepEqual(
      Array.from(result.messages, (message) => message.key),
      ['id:answer-2', 'id:answer-3'],
    )
    assert.equal(result.messages[1].text, '答案 3')
    assert.doesNotMatch(JSON.stringify(result), /私密|私人|复制|答案 1/)
  } finally {
    page.close()
  }
})

test('serialization preserves code indentation, lists, heading, quote, links and excludes hidden/thinking/UI text', () => {
  const page = fixture(
    '<div data-message-author-role="assistant"><div class="markdown"><h2>结果</h2><p><strong>重点</strong>与<a href="https://example.org/ref">来源</a></p><ul><li>甲</li><li>乙</li></ul><blockquote><p>引用</p></blockquote><pre><button>复制代码</button><code class="language-js">function f() {\n  return 1;\n}\n\n\n// end</code></pre><div class="thinking-container">秘密思考</div><div style="display:none">隐藏</div><span aria-hidden="true">装饰</span><span class="sr-only">朗读提示</span><p>末尾</p></div></div>',
  )
  try {
    const text = page.run().messages[0].text
    assert.match(text, /## 结果/)
    assert.match(text, /\*\*重点\*\*/)
    assert.match(text, /\[来源\]\(https:\/\/example.org\/ref\)/)
    assert.match(text, /- 甲/)
    assert.match(text, /> 引用/)
    assert.match(text, /```js\nfunction f\(\) {\n  return 1;\n}\n\n\n\/\/ end\n```/)
    assert.doesNotMatch(text, /秘密|隐藏|装饰|复制代码|朗读提示/)
  } finally {
    page.close()
  }
})

test('table serialization does not read hidden cells or controls and code fences withstand literal backticks', () => {
  const page = fixture(
    '<div data-message-author-role="assistant"><div class="markdown"><table><tr><td>公开<button>按钮</button></td><td hidden>秘密</td></tr></table><pre><code>```quoted```\n  ok</code></pre></div></div>',
  )
  try {
    const text = page.run().messages[0].text
    assert.match(text, /\| 公开 \|  \|/)
    assert.match(text, /````\n```quoted```\n  ok\n````/)
    assert.doesNotMatch(text, /秘密|按钮/)
  } finally {
    page.close()
  }
})

test('strict official HTTPS scope rejects credentials, lookalike hosts and caller-supplied foreign host', () => {
  for (const url of [
    'http://chatgpt.com/c/a',
    'https://name:password@chatgpt.com/c/a',
    'https://chatgpt.com.evil.example/c/a',
    'https://evil.example/',
  ]) {
    const page = fixture('<div data-message-author-role="assistant">秘密答案</div>', 'chatgpt', url)
    try {
      const result = page.run(readWebsiteResponse, { allowedHosts: [new URL(url).hostname] })
      assert.equal(result.blocked, true)
      assert.equal(result.messages.length, 0)
      assert.equal(page.run(stopWebsiteResponse), false)
    } finally {
      page.close()
    }
  }
})

test('unknown providers never use generic markdown, arbitrary page text or body as fallback', () => {
  const page = fixture(
    '<div class="markdown">假答案</div><main>其他页面</main>',
    'copilot',
    'https://copilot.microsoft.com/',
  )
  try {
    assert.equal(page.run().supported, false)
    assert.equal(page.run().messages.length, 0)
  } finally {
    page.close()
  }
  const chat = fixture('<div class="markdown">任意markdown</div><div data-message-author-role="user">用户消息</div>')
  try {
    assert.equal(chat.run().messages.length, 0)
  } finally {
    chat.close()
  }
})

test('provider-specific answer fixtures exclude user bubbles and thinking', () => {
  const cases = [
    ['claude', 'https://claude.ai/chat/a', '<div class="font-claude-response"><p>回答</p></div>'],
    [
      'gemini',
      'https://gemini.google.com/app/a',
      '<user-query>用户</user-query><model-response><div class="model-response-text"><p>回答</p></div></model-response>',
    ],
    [
      'deepseek',
      'https://chat.deepseek.com/a/chat/s/a',
      '<div class="ds-message"><div class="ds-markdown ds-markdown--think">秘密思考</div><div class="ds-think-content"><div class="ds-markdown">另一段秘密</div></div><div class="ds-markdown"><p>回答</p></div></div>',
    ],
    [
      'doubao',
      'https://www.doubao.com/chat/a',
      '<div class="message-list-example"><div class="bg-g-send-msg-bubble"><div class="flow-markdown-body">用户</div></div><div class="flow-markdown-body"><p>回答</p></div></div>',
    ],
    [
      'qwen',
      'https://chat.qwen.ai/c/a',
      '<div class="qwen-chat-message-assistant"><div id="chat-response-message-abc" class="response-message-content phase-answer">回答</div></div>',
    ],
    [
      'kimi',
      'https://www.kimi.com/chat/a',
      '<div class="segment-user">用户</div><div class="segment-assistant"><div class="segment-content-box"><div class="thinking-container">秘密思考</div><div class="markdown-container">回答</div></div></div>',
    ],
    [
      'perplexity',
      'https://www.perplexity.ai/search/a',
      '<div data-testid="assistant-message"><div class="prose">回答</div></div>',
    ],
    [
      'grok',
      'https://grok.com/c/a',
      '<div class="message-bubble user">用户</div><div class="response-content-markdown">回答</div>',
    ],
  ]
  for (const [provider, url, html] of cases) {
    const page = fixture(html, provider, url)
    try {
      const result = page.run()
      assert.equal(result.supported, true, provider)
      assert.equal(result.messages.length, 1, provider)
      assert.equal(result.messages[0].text, '回答', provider)
    } finally {
      page.close()
    }
  }
})

test('repeated Doubao testid does not collapse independent answers into the same identity', () => {
  const page = fixture(
    '<div data-testid="receive_message">第一条</div><div data-testid="receive_message">第二条</div>',
    'doubao',
    'https://www.doubao.com/chat/a',
  )
  try {
    const messages = page.run().messages
    assert.notEqual(messages[0].key, messages[1].key)
  } finally {
    page.close()
  }
})

test('visible quota modal blocks reading, but quoted quota words inside an answer do not', () => {
  const page = fixture(
    '<div data-message-author-role="assistant"><div class="markdown"><div role="alert">rate limit 是错误名</div></div></div>',
  )
  try {
    assert.equal(page.run().blocked, false)
    const modal = page.document.createElement('div')
    modal.setAttribute('role', 'dialog')
    modal.textContent = 'too many requests'
    page.document.body.append(modal)
    assert.equal(page.run().blocked, true)
    assert.equal(page.run().messages.length, 0)
    modal.hidden = true
    assert.equal(page.run().blocked, false)
  } finally {
    page.close()
  }
})

test('stop only clicks one visible explicitly identified generation control', () => {
  const page = fixture(
    '<button aria-label="Stop generating"></button><button aria-label="Stop recording"></button><button aria-label="Search"></button>',
  )
  try {
    let stopClicks = 0
    let otherClicks = 0
    page.document.querySelector('[aria-label="Stop generating"]').onclick = () => stopClicks++
    page.document.querySelector('[aria-label="Stop recording"]').onclick = () => otherClicks++
    assert.equal(page.run().generating, true)
    assert.equal(page.run(stopWebsiteResponse), true)
    assert.equal(stopClicks, 1)
    assert.equal(otherClicks, 0)
    page.document.querySelector('[aria-label="Stop generating"]').hidden = true
    assert.equal(page.run(stopWebsiteResponse), false)
    assert.equal(page.run().generating, false)
  } finally {
    page.close()
  }
})

test('a stop-labelled button inside quoted assistant content cannot stop the website', () => {
  const page = fixture(
    '<div data-message-author-role="assistant"><div class="markdown"><button aria-label="Stop">模型中的按钮</button><p>答案</p></div></div>',
  )
  try {
    assert.equal(page.run(stopWebsiteResponse), false)
    assert.equal(page.run().generating, false)
  } finally {
    page.close()
  }
})

test('ambiguous stop controls are not clicked; Kimi native stop-class control is supported', () => {
  const page = fixture('<button aria-label="Stop"></button><button data-testid="stop-button"></button>')
  try {
    assert.equal(page.run(stopWebsiteResponse), false)
  } finally {
    page.close()
  }
  const kimi = fixture(
    '<div class="chat-box"><div class="send-button-container stop"></div></div>',
    'kimi',
    'https://www.kimi.com/chat/a',
  )
  try {
    let clicks = 0
    kimi.document.querySelector('.stop').onclick = () => clicks++
    assert.equal(kimi.run().generating, true)
    assert.equal(kimi.run(stopWebsiteResponse), true)
    assert.equal(clicks, 1)
  } finally {
    kimi.close()
  }
})

test('answer text is capped at 60000 characters without reading the surrounding page', () => {
  const page = fixture(
    '<div data-message-author-role="assistant"><div class="markdown">' +
      '答'.repeat(90000) +
      '</div></div><nav>私人账号</nav>',
  )
  try {
    const text = page.run().messages[0].text
    assert.equal(text.length, 60000)
    assert.doesNotMatch(text, /私人/)
  } finally {
    page.close()
  }
})

test('monitor never emits or completes with unchanged baseline answers', async (t) => {
  clock(t)
  const fake = fakeContents(snap([{ key: 'id:old', text: '旧私密答案' }]))
  const updates = []
  const monitor = createResponseMonitor(fake.contents, 'chatgpt', {
    timeoutMs: 2000,
    onUpdate: (text) => updates.push(text),
  })
  await monitor.capture()
  const waiting = monitor.wait()
  const rejected = assert.rejects(waiting, /未读取到本轮回复/)
  await flush()
  for (let i = 0; i < 3; i++) await advance(t, 800)
  await rejected
  assert.equal(updates.length, 0)
})

test('monitor streams a new answer, waits for stop signal to disappear and then for stability', async (t) => {
  clock(t)
  const fake = fakeContents(snap([{ key: 'id:old', text: '旧答案' }]))
  const updates = []
  const monitor = createResponseMonitor(fake.contents, 'chatgpt', { onUpdate: (text) => updates.push(text) })
  await monitor.capture()
  fake.state.value = snap([{ key: 'id:new', text: '开头' }], true)
  let complete = false
  const waiting = monitor.wait().then((result) => {
    complete = true
    return result
  })
  await flush()
  await advance(t, 4000)
  assert.equal(complete, false)
  fake.state.value = snap([{ key: 'id:new', text: '开头和完整结尾' }], false)
  await advance(t, 800)
  assert.equal(complete, false)
  for (let i = 0; i < 3; i++) await advance(t, 800)
  const result = await waiting
  assert.equal(result.text, '开头和完整结尾')
  assert.equal(result.sourceUrl, fake.state.url)
  assert.deepEqual(updates, ['开头', '开头和完整结尾'])
})

test('same-key regeneration change is current, and explicit new identity may repeat identical text', async (t) => {
  clock(t)
  for (const next of [
    { key: 'id:old', text: '新答案' },
    { key: 'id:new', text: '旧答案' },
  ]) {
    const fake = fakeContents(snap([{ key: 'id:old', text: '旧答案' }]))
    const monitor = createResponseMonitor(fake.contents, 'chatgpt')
    await monitor.capture()
    fake.state.value = snap([next])
    const waiting = monitor.wait()
    await flush()
    for (let i = 0; i < 3; i++) await advance(t, 800)
    assert.equal((await waiting).text, next.text)
  }
})

test('a new positional answer may repeat the previous round verbatim', async (t) => {
  clock(t)
  const fake = fakeContents(
    snap([
      { key: 'position:0', text: '收到' },
      { key: 'position:1', text: '收到' },
    ]),
  )
  const updates = []
  const monitor = createResponseMonitor(fake.contents, 'chatgpt', { onUpdate: (text) => updates.push(text) })
  await monitor.capture()
  fake.state.value = snap([
    { key: 'position:1', text: '收到' },
    { key: 'position:2', text: '收到' },
  ])
  const waiting = monitor.wait()
  await flush()
  for (let i = 0; i < 3; i++) await advance(t, 800)
  assert.equal((await waiting).text, '收到')
  assert.deepEqual(updates, ['收到'])
})

test('positional virtualizer shift cannot import an unchanged old answer', async (t) => {
  clock(t)
  const fake = fakeContents(snap([{ key: 'position:8', text: '旧答案' }]))
  const updates = []
  const monitor = createResponseMonitor(fake.contents, 'chatgpt', {
    timeoutMs: 1000,
    onUpdate: (text) => updates.push(text),
  })
  await monitor.capture()
  fake.state.value = snap([{ key: 'position:1', text: '旧答案' }])
  const rejected = assert.rejects(monitor.wait(), /未读取到本轮回复/)
  await flush()
  await advance(t, 800)
  await advance(t, 200)
  await rejected
  assert.deepEqual(updates, [])
})

test('monitor permits home to first official conversation but rejects switching existing conversation', async (t) => {
  clock(t)
  const fake = fakeContents(snap())
  fake.state.url = 'https://chatgpt.com/'
  const monitor = createResponseMonitor(fake.contents, 'chatgpt')
  await monitor.capture()
  fake.state.url = 'https://chatgpt.com/c/new'
  fake.state.value = snap([{ key: 'id:new', text: '本轮答案' }])
  const waiting = monitor.wait()
  await flush()
  for (let i = 0; i < 3; i++) await advance(t, 800)
  assert.equal((await waiting).sourceUrl, 'https://chatgpt.com/c/new')
  const second = createResponseMonitor(fake.contents, 'chatgpt')
  await second.capture()
  fake.state.url = 'https://chatgpt.com/c/another'
  await assert.rejects(second.wait(), /切换会话/)
  const empty = fakeContents(snap())
  const third = createResponseMonitor(empty.contents, 'chatgpt')
  await third.capture()
  empty.state.url = 'https://chatgpt.com/c/old'
  await assert.rejects(third.wait(), /切换会话/)
})

test('ChatGPT home display query and hash changes do not consume first conversation acquisition', async (t) => {
  clock(t)
  const fake = fakeContents(snap())
  fake.state.url = 'https://chatgpt.com/'
  const monitor = createResponseMonitor(fake.contents, 'chatgpt')
  await monitor.capture()
  fake.state.url = 'https://chatgpt.com/?model=gpt-display&temporary-chat=false#composer'
  const waiting = monitor.wait()
  await flush()
  await advance(t, 800)
  fake.state.url = 'https://chatgpt.com/?temporary-chat=true&model=other#bottom'
  await advance(t, 800)
  fake.state.url = 'https://chatgpt.com/c/new-reply?model=other'
  fake.state.value = snap([{ key: 'id:new-reply', text: '本轮的新回答' }])
  await advance(t, 800)
  for (let i = 0; i < 3; i++) await advance(t, 800)
  const result = await waiting
  assert.equal(result.text, '本轮的新回答')
  assert.equal(result.sourceUrl, fake.state.url)
})

test('ChatGPT existing conversation display options may change without treating it as another transcript', async (t) => {
  clock(t)
  const fake = fakeContents(snap([{ key: 'id:old', text: '旧回答' }]))
  fake.state.url = 'https://chatgpt.com/c/existing?model=before#top'
  const monitor = createResponseMonitor(fake.contents, 'chatgpt')
  await monitor.capture()
  fake.state.url = 'https://chatgpt.com/c/existing?temporary-chat=false&model=after#bottom'
  fake.state.value = snap([
    { key: 'id:old', text: '旧回答' },
    { key: 'id:new', text: '本轮回答' },
  ])
  const waiting = monitor.wait()
  await flush()
  for (let i = 0; i < 3; i++) await advance(t, 800)
  assert.equal((await waiting).text, '本轮回答')
})

test('cosmetic home URL changes cannot allow acquisition when the baseline already contains an old answer', async (t) => {
  clock(t)
  const fake = fakeContents(snap([{ key: 'id:old', text: '旧私密答案' }]))
  fake.state.url = 'https://chatgpt.com/?model=before'
  const updates = []
  const monitor = createResponseMonitor(fake.contents, 'chatgpt', { onUpdate: (text) => updates.push(text) })
  await monitor.capture()
  fake.state.url = 'https://chatgpt.com/?model=after#bottom'
  const waiting = monitor.wait()
  const rejected = assert.rejects(waiting, /切换会话/)
  await flush()
  fake.state.url = 'https://chatgpt.com/c/other'
  fake.state.value = snap([{ key: 'id:other', text: '另一会话答案' }])
  await advance(t, 800)
  await rejected
  assert.deepEqual(updates, [])
})

test('ChatGPT unknown query identities remain exact on both homepage and existing conversation', async () => {
  for (const path of ['/', '/c/existing'])
    for (const parameter of ['q', 'id', 'chatId', 'conversationId', 'thread', 'unknown']) {
      const fake = fakeContents(snap())
      fake.state.url = 'https://chatgpt.com' + path
      const monitor = createResponseMonitor(fake.contents, 'chatgpt')
      await monitor.capture()
      fake.state.url += '?' + parameter + '=another'
      fake.state.value = snap([{ key: 'id:other', text: '其他会话答案' }])
      await assert.rejects(monitor.wait(), /切换会话/)
    }
})

test('unknown query changes cannot accompany first acquired path and other provider URLs stay exact', async () => {
  const fake = fakeContents(snap())
  fake.state.url = 'https://chatgpt.com/'
  const monitor = createResponseMonitor(fake.contents, 'chatgpt')
  await monitor.capture()
  fake.state.url = 'https://chatgpt.com/c/new?conversationId=old'
  await assert.rejects(monitor.wait(), /切换会话/)
  for (const suffix of ['?model=other', '#another']) {
    const grok = fakeContents(snap())
    grok.state.url = 'https://grok.com/c/existing'
    const other = createResponseMonitor(grok.contents, 'grok')
    await other.capture()
    grok.state.url += suffix
    await assert.rejects(other.wait(), /切换会话/)
  }
  const first = fakeContents(snap())
  first.state.url = 'https://grok.com/#initial'
  const firstMonitor = createResponseMonitor(first.contents, 'grok')
  await firstMonitor.capture()
  first.state.url = 'https://grok.com/c/new#another'
  await assert.rejects(firstMonitor.wait(), /切换会话/)
})

test('ChatGPT cosmetic changes after first acquisition do not unlock a second conversation path', async (t) => {
  clock(t)
  const fake = fakeContents(snap())
  fake.state.url = 'https://chatgpt.com/'
  const monitor = createResponseMonitor(fake.contents, 'chatgpt')
  await monitor.capture()
  fake.state.url = 'https://chatgpt.com/c/new?model=one'
  const waiting = monitor.wait()
  const rejected = assert.rejects(waiting, /切换会话/)
  await flush()
  fake.state.url = 'https://chatgpt.com/c/new?model=two#bottom'
  await advance(t, 800)
  fake.state.url = 'https://chatgpt.com/c/another?model=two'
  await advance(t, 800)
  await rejected
})

test('off-domain navigation, quota rejection and destroyed view abort reading immediately', async () => {
  for (const change of ['url', 'quota', 'destroyed']) {
    const fake = fakeContents(snap())
    const monitor = createResponseMonitor(fake.contents, 'chatgpt')
    await monitor.capture()
    if (change === 'url') fake.state.url = 'https://accounts.google.com/'
    if (change === 'quota') fake.state.value = { ...snap(), blocked: true, detail: '官网提示登录或额度限制' }
    if (change === 'destroyed') fake.state.destroyed = true
    await assert.rejects(monitor.wait(), /离开|官网提示|窗口已关闭/)
  }
})

test('cancellation interrupts a pending DOM read without waiting for its timeout', async () => {
  const fake = fakeContents(snap())
  const controller = new AbortController()
  const monitor = createResponseMonitor(fake.contents, 'chatgpt', { signal: controller.signal })
  await monitor.capture()
  fake.state.value = () => new Promise(() => {})
  const waiting = monitor.wait()
  const rejected = assert.rejects(waiting, (error) => error.name === 'AbortError')
  controller.abort()
  await rejected
})

test('bounded DOM execution and continuous read failures fail instead of hanging', async (t) => {
  clock(t)
  const fake = fakeContents(snap())
  const monitor = createResponseMonitor(fake.contents, 'chatgpt', { timeoutMs: 20000 })
  await monitor.capture()
  fake.state.value = () => new Promise(() => {})
  const rejected = assert.rejects(monitor.wait(), /连续读取官网回复失败/)
  await flush()
  await advance(t, 5000)
  await advance(t, 800)
  await advance(t, 5000)
  await advance(t, 800)
  await advance(t, 5000)
  await rejected
})

test('monitor refuses missing baseline and an already-generating baseline', async () => {
  const fake = fakeContents(snap([], true))
  const monitor = createResponseMonitor(fake.contents, 'chatgpt')
  await assert.rejects(monitor.wait(), /发送之前/)
  const second = createResponseMonitor(fake.contents, 'chatgpt')
  await assert.rejects(second.capture(), /上一轮/)
})
