const { test } = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')
const { readWebsiteReadiness, waitForWebsiteReady, READY_HOSTS } = require('./ready.cjs')

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}
function clock(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
}
async function advance(t, milliseconds, step = 100) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += step) {
    t.mock.timers.tick(Math.min(step, milliseconds - elapsed))
    await flush()
  }
}
function fixture(html, siteId = 'chatgpt', url = 'https://chatgpt.com/') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true })
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
    width: 400,
    height: 40,
    top: 0,
    left: 0,
    right: 400,
    bottom: 40,
  })
  dom.window.setTimeout = (...args) => setTimeout(...args)
  dom.window.Date = Date
  dom.window.HTMLElement.prototype.focus = () => {
    throw new Error('readiness must not focus')
  }
  dom.window.HTMLElement.prototype.click = () => {
    throw new Error('readiness must not click')
  }
  const run = (extra = {}) =>
    dom.window.eval(
      `(${readWebsiteReadiness.toString()})(${JSON.stringify({
        siteId,
        allowedHosts: READY_HOSTS[siteId],
        ...extra,
      })})`,
    )
  const contents = {
    getURL: () => dom.window.location.href,
    isDestroyed: () => false,
    isLoadingMainFrame: () => false,
    executeJavaScript: (script, gesture) => {
      assert.equal(gesture, false)
      return dom.window.eval(script)
    },
  }
  return { dom, document: dom.window.document, contents, run, close: () => dom.window.close() }
}
const snapshot = (ready = false, extra = {}) => ({
  supported: true,
  ready,
  generating: false,
  hasDraft: false,
  ...extra,
})
function fakeContents(value = snapshot()) {
  const state = { value, reads: 0, url: 'https://chatgpt.com/', destroyed: false, loading: false }
  const contents = {
    getURL: () => state.url,
    isDestroyed: () => state.destroyed,
    isLoadingMainFrame: () => state.loading,
    executeJavaScript: async (script, gesture) => {
      assert.match(script, /readWebsiteReadiness/)
      assert.equal(gesture, false)
      state.reads++
      return typeof state.value === 'function' ? state.value() : state.value
    },
  }
  return { contents, state }
}

test('nine official provider composers become ready after 800ms without focus, clicks or conversation reads', async (t) => {
  clock(t)
  const cases = [
    ['chatgpt', 'https://chatgpt.com/', '<div id="prompt-textarea" contenteditable="true"><p><br></p></div>'],
    ['claude', 'https://claude.ai/new', '<div class="ProseMirror" contenteditable="true"></div>'],
    ['gemini', 'https://gemini.google.com/app', '<rich-textarea><div contenteditable="true"></div></rich-textarea>'],
    [
      'deepseek',
      'https://chat.deepseek.com/',
      '<textarea name="search" placeholder="给 DeepSeek 发送消息"></textarea>',
    ],
    ['doubao', 'https://www.doubao.com/chat/', '<div class="tiptap ProseMirror" contenteditable="true"></div>'],
    ['qwen', 'https://chat.qwen.ai/', '<textarea id="chat-input"></textarea>'],
    ['kimi', 'https://www.kimi.com/', '<div class="chat-input-editor" contenteditable="plaintext-only"></div>'],
    ['perplexity', 'https://www.perplexity.ai/', '<textarea placeholder="Ask anything"></textarea>'],
    ['grok', 'https://grok.com/', '<textarea aria-label="Ask Grok anything"></textarea>'],
  ]
  const pages = cases.map(([provider, url, html]) =>
    fixture('<nav>私人账号</nav><article class="markdown">历史聊天</article>' + html, provider, url),
  )
  try {
    for (const page of pages) {
      Object.defineProperty(page.document.querySelector('article'), 'textContent', {
        get() {
          throw new Error('must not read conversation')
        },
      })
      Object.defineProperty(page.document.body, 'textContent', {
        get() {
          throw new Error('must not read body')
        },
      })
    }
    const promises = pages.map((page) => page.run())
    let settled = false
    promises[0].then(() => {
      settled = true
    })
    await advance(t, 700)
    assert.equal(settled, false)
    await advance(t, 100)
    const results = await Promise.all(promises)
    for (const [index, result] of results.entries()) {
      assert.equal(result.ready, true, cases[index][0])
      assert.equal(result.hasDraft, false)
      assert.equal(result.generating, false)
      assert.doesNotMatch(JSON.stringify(result), /历史聊天|私人账号/)
    }
  } finally {
    pages.forEach((page) => page.close())
  }
})

test('semantic transition textarea needs a nearby known send control, disabled send is valid', async (t) => {
  clock(t)
  const page = fixture('<section><textarea placeholder="Message ChatGPT"></textarea></section>')
  try {
    assert.equal((await page.run()).ready, false)
    const send = page.document.createElement('button')
    send.setAttribute('data-testid', 'send-button')
    send.disabled = true
    page.document.querySelector('section').append(send)
    const promise = page.run()
    await advance(t, 800)
    assert.equal((await promise).ready, true)
    send.remove()
    page.document.body.insertAdjacentHTML('beforeend', '<div><button aria-label="Send"></button></div>')
    assert.equal((await page.run()).ready, false, 'unrelated send toolbar is not composer hydration')
  } finally {
    page.close()
  }
})

test('a semantic editor with a generic submit button cannot mistake login or search for send', async (t) => {
  clock(t)
  for (const label of ['搜索', '登录', '创建', '取消']) {
    const page = fixture(
      `<form><div contenteditable="true" aria-label="Message DeepSeek"></div><button type="submit">${label}</button></form>`,
      'deepseek',
      'https://chat.deepseek.com/',
    )
    try {
      assert.equal((await page.run()).ready, false)
    } finally {
      page.close()
    }
  }
  const page = fixture(
    '<form><div contenteditable="true" aria-label="Message DeepSeek"></div><button>发送</button></form>',
    'deepseek',
    'https://chat.deepseek.com/',
  )
  try {
    const promise = page.run()
    await advance(t, 800)
    assert.equal((await promise).ready, true)
  } finally {
    page.close()
  }
})

test('replacing a composer with an identical DOM node resets hydration observation', async (t) => {
  clock(t)
  const page = fixture('<textarea id="prompt-textarea"></textarea>')
  try {
    const first = page.run()
    await advance(t, 400)
    const old = page.document.querySelector('textarea')
    old.replaceWith(old.cloneNode(true))
    await advance(t, 100)
    assert.equal((await first).ready, false)
    const second = page.run()
    await advance(t, 800)
    assert.equal((await second).ready, true)
  } finally {
    page.close()
  }
})

test('composer metadata change, disabled or detached editor prevents ready', async (t) => {
  clock(t)
  for (const change of [
    (element) => element.setAttribute('placeholder', 'New metadata'),
    (element) => {
      element.disabled = true
    },
    (element) => element.remove(),
  ]) {
    const page = fixture('<textarea id="prompt-textarea"></textarea>')
    try {
      const promise = page.run()
      await advance(t, 300)
      change(page.document.querySelector('textarea'))
      await advance(t, 100)
      assert.equal((await promise).ready, false)
    } finally {
      page.close()
    }
  }
})

test('known generation and existing draft return immediately as flags without exposing draft text', async () => {
  const page = fixture('<textarea id="prompt-textarea">未发送的私人草稿</textarea>')
  const generating = fixture('<button data-testid="stop-button"></button>')
  try {
    const draft = await page.run()
    assert.equal(draft.ready, true)
    assert.equal(draft.hasDraft, true)
    assert.doesNotMatch(JSON.stringify(draft), /私人草稿/)
    const busy = await generating.run()
    assert.equal(busy.ready, true)
    assert.equal(busy.generating, true)
  } finally {
    page.close()
    generating.close()
  }
})

test('rich editor placeholder decorations are not drafts and quoted answer buttons are never read', async (t) => {
  clock(t)
  const page = fixture(
    '<div id="prompt-textarea" contenteditable="true"><span contenteditable="false" data-placeholder="Ask">Ask ChatGPT</span><span hidden>hidden draft</span><p><br></p></div>',
  )
  try {
    const promise = page.run()
    await advance(t, 800)
    const result = await promise
    assert.equal(result.ready, true)
    assert.equal(result.hasDraft, false)
  } finally {
    page.close()
  }
  const semantic = fixture(
    '<section><div data-message-author-role="assistant"><button data-testid="send-button">private quote</button></div><textarea placeholder="Message ChatGPT"></textarea></section>',
  )
  try {
    Object.defineProperty(semantic.document.querySelector('button'), 'textContent', {
      get() {
        throw new Error('must not read conversation button')
      },
    })
    assert.equal((await semantic.run()).ready, false)
  } finally {
    semantic.close()
  }
})

test('search, login, hidden, duplicate and modal-covered inputs are never selected', async () => {
  const cases = [
    '<textarea id="prompt-textarea" aria-label="Search"></textarea>',
    '<textarea id="prompt-textarea" name="email"></textarea>',
    '<form><input type="password"><textarea id="prompt-textarea"></textarea></form>',
    '<div hidden><textarea id="prompt-textarea"></textarea></div>',
    '<textarea id="prompt-textarea"></textarea><textarea id="prompt-textarea"></textarea>',
    '<textarea id="prompt-textarea"></textarea><div aria-modal="true"></div>',
    '<textarea placeholder="Ask ChatGPT"></textarea><section><button aria-label="Voice"></button></section>',
  ]
  for (const html of cases) {
    const page = fixture(html)
    try {
      assert.equal((await page.run()).ready, false)
    } finally {
      page.close()
    }
  }
  const deepseek = fixture(
    '<textarea name="search" placeholder="Search DeepSeek"></textarea>',
    'deepseek',
    'https://chat.deepseek.com/',
  )
  try {
    assert.equal((await deepseek.run()).ready, false)
  } finally {
    deepseek.close()
  }
})

test('reader requires exact official HTTPS host, default port and expected URL', async () => {
  for (const url of [
    'http://chatgpt.com/',
    'https://account:password@chatgpt.com/',
    'https://chatgpt.com.evil.example/',
    'https://chatgpt.com:8443/',
    'https://example.org/',
  ]) {
    const page = fixture('<textarea id="prompt-textarea"></textarea>', 'chatgpt', url)
    try {
      const result = await page.run({ allowedHosts: [new URL(url).hostname] })
      assert.equal(result.ready, false)
      assert.match(result.detail, /离开/)
    } finally {
      page.close()
    }
  }
  const page = fixture('<textarea id="prompt-textarea"></textarea>')
  try {
    assert.equal((await page.run({ expectedUrl: 'https://chatgpt.com/c/other' })).ready, false)
  } finally {
    page.close()
  }
})

test('hydration observer refuses navigation during its stable interval', async (t) => {
  clock(t)
  const page = fixture('<textarea id="prompt-textarea"></textarea>')
  try {
    const promise = page.run({ expectedUrl: 'https://chatgpt.com/' })
    await advance(t, 300)
    page.dom.reconfigure({ url: 'https://chatgpt.com/c/other' })
    await advance(t, 100)
    const result = await promise
    assert.equal(result.ready, false)
    assert.match(result.detail, /网址已变化/)
  } finally {
    page.close()
  }
})

test('wrapper waits through absent SPA editor and detects the eventual hydrated composer', async (t) => {
  clock(t)
  const page = fixture('<main>Loading</main>')
  try {
    const promise = waitForWebsiteReady(page.contents, 'chatgpt')
    await flush()
    await advance(t, 400)
    page.document.body.insertAdjacentHTML('beforeend', '<section><textarea id="prompt-textarea"></textarea></section>')
    await advance(t, 1200)
    const result = await promise
    assert.equal(result.ready, true)
    assert.equal(result.sourceUrl, 'https://chatgpt.com/')
    assert.equal(result.siteId, 'chatgpt')
  } finally {
    page.close()
  }
})

test('wrapper returns generation and draft flags without performing another composer action', async () => {
  const fake = fakeContents(snapshot(true, { generating: true, hasDraft: true }))
  const result = await waitForWebsiteReady(fake.contents, 'chatgpt')
  assert.equal(result.generating, true)
  assert.equal(result.hasDraft, true)
  assert.equal(fake.state.reads, 1)
})

test('abort interrupts a hanging DOM observation immediately and pre-abort starts no read', async (t) => {
  clock(t)
  const controller = new AbortController()
  const fake = fakeContents(() => new Promise(() => {}))
  const promise = waitForWebsiteReady(fake.contents, 'chatgpt', { signal: controller.signal })
  const rejection = assert.rejects(promise, { name: 'AbortError' })
  await flush()
  controller.abort()
  await rejection
  assert.equal(fake.state.reads, 1)
  await assert.rejects(waitForWebsiteReady(fake.contents, 'chatgpt', { signal: controller.signal }), {
    name: 'AbortError',
  })
  assert.equal(fake.state.reads, 1)
})

test('DOM observation is bounded and an empty/loading SPA waits at most 15 seconds', async (t) => {
  clock(t)
  const frozen = fakeContents(() => new Promise(() => {}))
  const read = waitForWebsiteReady(frozen.contents, 'chatgpt')
  const rejected = assert.rejects(read, /检测超时/)
  await flush()
  await advance(t, 2200)
  await rejected
  const empty = fakeContents()
  empty.state.loading = true
  const timeout = waitForWebsiteReady(empty.contents, 'chatgpt', { timeoutMs: 999999 })
  const timedOut = assert.rejects(timeout, /尚未准备好/)
  await flush()
  await advance(t, 15000)
  await timedOut
  assert.equal(empty.state.reads, 0)
})

test('wrapper refuses closed, foreign, changed or malformed DOM contexts', async (t) => {
  clock(t)
  for (const update of [
    (state) => {
      state.destroyed = true
    },
    (state) => {
      state.url = 'https://example.org/'
    },
    (state) => {
      state.url = 'https://chatgpt.com/c/new'
    },
  ]) {
    const fake = fakeContents()
    const promise = waitForWebsiteReady(fake.contents, 'chatgpt')
    const rejected = assert.rejects(promise, /窗口已关闭|离开|网址已变化/)
    await flush()
    update(fake.state)
    await advance(t, 200)
    await rejected
    assert.equal(fake.state.reads, 1)
  }
  await assert.rejects(waitForWebsiteReady(fakeContents(null).contents, 'chatgpt'), /结果异常/)
  await assert.rejects(waitForWebsiteReady(fakeContents().contents, 'unknown'), /暂未接入/)
})
