const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createGroupManager, mentionTargets } = require('./group-manager.cjs')

function manager(overrides = {}) {
  const store = { state: { conversations: [], messages: {}, sources: {} }, persist() {}, setSource() {} }
  return createGroupManager({
    store,
    discoverCli: async () => [
      { id: 'cli:codex', name: 'Codex', available: true },
      { id: 'cli:claude', name: 'Claude Code', available: true },
    ],
    waitReady: async () => ({ ready: true }),
    chooseWorkspace: async () => process.cwd(),
    getWebsiteConnection: () => {
      throw new Error('不应该打开官网')
    },
    runCli: async ({ kind }) => ({ text: `${kind} 的答案` }),
    ...overrides,
  })
}

async function group(manager, members = ['cli:codex', 'cli:claude']) {
  const workspace = await manager.chooseWorkspace()
  return manager.save({ title: '协作验证', members, roles: {}, workspace })
}

async function completed(manager) {
  for (let index = 0; index < 100; index++) {
    const snapshot = await manager.list()
    if (!snapshot.activeRun) return snapshot
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('test run did not finish')
}

test('点名路由严格限定群成员，全员包含群内全部成员，邮箱不会触发点名', () => {
  const members = [
    { id: 'web:chatgpt', name: 'ChatGPT' },
    { id: 'cli:claude', name: 'Claude Code' },
  ]
  const ids = members.map((m) => m.id)
  assert.deepEqual(mentionTargets('@ChatGPT 请回答', ids, members, ids), ['web:chatgpt'])
  assert.deepEqual(mentionTargets('@Claude Code 请评审', ids, members, ids), ['cli:claude'])
  assert.deepEqual(mentionTargets('@所有人 收到请回复', ids, members, ['web:chatgpt']), ids)
  assert.deepEqual(mentionTargets('邮件 test@ChatGPT.com', ids, members, ['web:chatgpt']), ['web:chatgpt'])
  assert.throws(() => mentionTargets('@不存在 请回答', ids, members, ids), /没有找到/)
})

test('并行成员拿到相同初始上下文，不会把半成品混给另一位', async () => {
  const prompts = []
  const instance = manager({
    runCli: async ({ kind, prompt, onUpdate }) => {
      prompts.push({ kind, prompt })
      onUpdate({ text: `${kind} 部分答案` })
      await new Promise((resolve) => setTimeout(resolve, 10))
      return { text: `${kind} 完整答案` }
    },
  })
  const conversation = await group(instance)
  await instance.send({
    conversationId: conversation.id,
    content: '比较两种方案',
    targets: conversation.members,
    mode: 'parallel',
  })
  const snapshot = await completed(instance)
  assert.equal(prompts.length, 2)
  assert.ok(prompts.every((p) => !p.prompt.includes('部分答案') && !p.prompt.includes('完整答案')))
  assert.deepEqual(
    snapshot.messages[conversation.id].filter((m) => m.speakerId !== 'user').map((m) => m.status),
    ['done', 'done'],
  )
  await instance.close()
})

test('接力把前一位真实结果交给后一位，失败时后续不会收到任务', async () => {
  const prompts = []
  const instance = manager({
    runCli: async ({ kind, prompt }) => {
      prompts.push({ kind, prompt })
      return { text: kind === 'codex' ? '初稿：方案 A' : '汇总：修订方案 A' }
    },
  })
  const conversation = await group(instance)
  await instance.send({
    conversationId: conversation.id,
    content: '出方案并评审',
    targets: conversation.members,
    mode: 'relay',
  })
  const snapshot = await completed(instance)
  assert.match(prompts[1].prompt, /初稿：方案 A/)
  assert.match(prompts[1].prompt, /汇总最终答案/)
  assert.equal(snapshot.messages[conversation.id].at(-1).content, '汇总：修订方案 A')
  await instance.close()

  let called = 0
  const failed = manager({
    runCli: async () => {
      called++
      throw new Error('账号未登录')
    },
  })
  const failedConversation = await group(failed)
  await failed.send({
    conversationId: failedConversation.id,
    content: '测试失败',
    targets: failedConversation.members,
    mode: 'relay',
  })
  const failedSnapshot = await completed(failed)
  assert.equal(called, 1)
  assert.equal(failedSnapshot.messages[failedConversation.id].find((m) => m.speakerId === 'cli:codex').status, 'error')
  assert.match(failedSnapshot.messages[failedConversation.id].at(-1).content, /后续成员没有收到/)
  await failed.close()
})

test('运行期间拒绝重复发送，停止后记录取消而不自动重发', async () => {
  let called = 0
  const instance = manager({
    runCli: ({ signal }) =>
      new Promise((_, reject) => {
        called++
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
      }),
  })
  const conversation = await group(instance, ['cli:codex'])
  const request = { conversationId: conversation.id, content: '执行', targets: conversation.members, mode: 'parallel' }
  const { runId } = await instance.send(request)
  await assert.rejects(instance.send(request), /当前有一轮/)
  await instance.stop(runId)
  const snapshot = await instance.list()
  assert.equal(snapshot.activeRun, null)
  assert.equal(snapshot.messages[conversation.id].at(-1).status, 'cancelled')
  assert.equal(called, 1)
  await instance.close()
})

test('拒绝群外成员和任意工作目录，归档保留消息', async () => {
  const instance = manager()
  const conversation = await group(instance, ['cli:codex'])
  await assert.rejects(
    instance.send({ conversationId: conversation.id, content: '发给群外', targets: ['cli:claude'], mode: 'parallel' }),
    /当前群/,
  )
  await assert.rejects(
    instance.save({ title: '任意目录', members: ['cli:codex'], roles: {}, workspace: '/tmp' }),
    /选择按钮/,
  )
  await instance.send({
    conversationId: conversation.id,
    content: '记录保存',
    targets: conversation.members,
    mode: 'parallel',
  })
  await completed(instance)
  await instance.archive(conversation.id)
  const snapshot = await instance.list()
  assert.equal(snapshot.conversations[0].archived, true)
  assert.equal(snapshot.messages[conversation.id].length, 2)
  await instance.close()
})

const { JSDOM } = require('jsdom')

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
async function microUntil(predicate) {
  for (let index = 0; index < 400; index++) {
    if (await predicate()) return
    await Promise.resolve()
  }
  throw new Error('fixture condition not reached')
}
function webHarness({
  oldMessages = [],
  captureGate,
  queueStop = false,
  submitResult = { status: 'sent' },
  submitGate,
} = {}) {
  const dom = new JSDOM('<textarea id="prompt-textarea"></textarea><button data-testid="stop-button">停止</button>', {
    url: 'https://chatgpt.com/c/group',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 300, height: 50 })
  const state = {
    prepares: 0,
    submissions: 0,
    keyboardEvents: [],
    inserts: 0,
    captures: 0,
    waits: 0,
    stopClicks: 0,
    stopScripts: [],
    waitingStop: undefined,
  }
  dom.window.document.querySelector('button').onclick = () => state.stopClicks++
  const stopGate = deferred()
  const contents = {
    isDestroyed: () => false,
    isLoadingMainFrame: () => false,
    getURL: () => dom.window.location.href,
    focus() {},
    sendInputEvent(event) {
      state.keyboardEvents.push(event)
    },
    insertText: async (text) => {
      state.inserts++
      dom.window.document.querySelector('textarea').value = text
    },
    executeJavaScript: async (script) => {
      if (script.includes('function prepareComposer(')) {
        state.prepares++
        return { status: 'ready' }
      }
      if (script.includes('function submitComposer(')) {
        state.submissions++
        if (submitGate) await submitGate.promise
        if (submitResult.status === 'sent') dom.window.__duozhiGroupRunV1.submitted = true
        return submitResult
      }
      if (script.includes('function confirmSubmission(')) return { status: 'sent' }
      if (script.includes('stopWebsiteResponse')) {
        state.stopScripts.push(script)
        if (queueStop) {
          state.waitingStop = script
          return stopGate.promise
        }
      }
      return dom.window.eval(script)
    },
  }
  const record = { siteId: 'chatgpt', fresh: true, attached: false, view: { webContents: contents } }
  const createMonitor = (_contents, _siteId, { signal }) => ({
    async capture() {
      state.captures++
      if (captureGate) await captureGate.promise
      return { supported: true, messages: oldMessages, generating: false, blocked: false, sourceUrl: contents.getURL() }
    },
    wait() {
      state.waits++
      return new Promise((_, reject) => {
        if (signal.aborted) {
          reject(new Error('cancelled'))
          return
        }
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
      })
    },
  })
  return { record, state, dom, createMonitor, stopGate, close: () => dom.window.close() }
}
async function websiteGroup(instance) {
  return instance.save({ title: '官网群验证', members: ['web:chatgpt'], roles: {} })
}
const webRequest = (conversation) => ({
  conversationId: conversation.id,
  content: '请回答这轮',
  targets: ['web:chatgpt'],
  mode: 'parallel',
})

test('新群发现官网旧回答时拒绝提交，不会把旧文本保存进群记录', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const web = webHarness({ oldMessages: [{ key: 'id:old', text: '别的会话私密旧回答' }] })
  const instance = manager({ getWebsiteConnection: async () => web.record, createMonitor: web.createMonitor })
  try {
    const conversation = await websiteGroup(instance)
    await instance.send(webRequest(conversation))
    await microUntil(async () => !(await instance.list()).activeRun)
    const snapshot = await instance.list()
    assert.equal(snapshot.messages[conversation.id].at(-1).status, 'error')
    assert.match(snapshot.messages[conversation.id].at(-1).detail, /新群不能沿用官网的旧聊天/)
    assert.doesNotMatch(JSON.stringify(snapshot), /别的会话私密旧回答/)
    assert.equal(web.state.submissions, 0)
    assert.equal(web.state.prepares, 0)
    assert.equal(web.state.stopClicks, 0)
    assert.equal(web.record.fresh, true)
  } finally {
    await instance.close()
    web.close()
  }
})

test('基线捕获期间停止不会误停官网上一轮生成，也不会继续准备输入框', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const captureGate = deferred()
  const web = webHarness({ captureGate })
  const instance = manager({ getWebsiteConnection: async () => web.record, createMonitor: web.createMonitor })
  try {
    const conversation = await websiteGroup(instance)
    const { runId } = await instance.send(webRequest(conversation))
    await microUntil(() => web.state.captures === 1)
    const stopping = instance.stop(runId)
    captureGate.resolve()
    await stopping
    assert.equal(web.state.stopScripts.length, 0)
    assert.equal(web.state.stopClicks, 0)
    assert.equal(web.state.prepares, 0)
    const snapshot = await instance.list()
    assert.equal(snapshot.messages[conversation.id].at(-1).status, 'cancelled')
    assert.equal(snapshot.activeRun, null)
  } finally {
    captureGate.resolve()
    await instance.close()
    web.close()
  }
})

test('发送之前官网已加载到旧生成时基线失败，停止不会登记它为本轮目标', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const web = webHarness()
  const instance = manager({
    getWebsiteConnection: async () => web.record,
    createMonitor: () => ({
      capture: async () => {
        throw new Error('成员官网还在生成上一轮回复')
      },
      wait: () => {
        throw new Error('unexpected wait')
      },
    }),
  })
  try {
    const conversation = await websiteGroup(instance)
    const { runId } = await instance.send(webRequest(conversation))
    await microUntil(async () => !(await instance.list()).activeRun)
    const snapshot = await instance.list()
    await instance.stop(runId)
    assert.equal(snapshot.messages[conversation.id].at(-1).status, 'error')
    assert.match(snapshot.messages[conversation.id].at(-1).detail, /上一轮/)
    assert.equal(web.state.stopScripts.length, 0)
    assert.equal(web.state.stopClicks, 0)
    assert.equal(web.state.submissions, 0)
  } finally {
    await instance.close()
    web.close()
  }
})

test('后台官网参与者实际提交后绑定来源，只能停止当前群的同轮同网址生成', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const web = webHarness()
  const sources = []
  const store = {
    state: { conversations: [], messages: {}, sources: {} },
    persist() {},
    setSource: (...args) => sources.push(args),
  }
  const instance = manager({ store, getWebsiteConnection: async () => web.record, createMonitor: web.createMonitor })
  try {
    const conversation = await websiteGroup(instance)
    const { runId } = await instance.send(webRequest(conversation))
    await microUntil(() => web.state.waits === 1)
    assert.equal(web.record.attached, false)
    assert.equal(web.state.submissions, 1)
    assert.equal(web.record.fresh, false)
    assert.equal(web.dom.window.__duozhiGroupRunV1.id, runId)
    assert.deepEqual(sources[0], [conversation.id, 'web:chatgpt', 'https://chatgpt.com/c/group'])
    await instance.stop(runId)
    assert.equal(web.state.stopClicks, 1)
    assert.equal((await instance.list()).activeRun, null)
  } finally {
    await instance.close()
    web.close()
  }
})

test('停止脚本执行前已切换官网会话，不点击新会话的停止按钮', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const web = webHarness()
  const instance = manager({ getWebsiteConnection: async () => web.record, createMonitor: web.createMonitor })
  try {
    const conversation = await websiteGroup(instance)
    const { runId } = await instance.send(webRequest(conversation))
    await microUntil(() => web.state.waits === 1)
    web.dom.window.history.pushState({}, '', '/c/another-conversation')
    await instance.stop(runId)
    assert.equal(web.state.stopScripts.length, 1)
    assert.equal(web.state.stopClicks, 0)
  } finally {
    await instance.close()
    web.close()
  }
})

test('迟到的旧停止脚本不能停止下一轮，停止清理期间发送锁不会提前释放', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const web = webHarness({ queueStop: true })
  const instance = manager({ getWebsiteConnection: async () => web.record, createMonitor: web.createMonitor })
  try {
    const conversation = await websiteGroup(instance)
    const request = webRequest(conversation)
    const first = await instance.send(request)
    await microUntil(() => web.state.waits === 1)
    const stopping = instance.stop(first.runId)
    await microUntil(() => Boolean(web.state.waitingStop))
    const oldScript = web.state.waitingStop
    await assert.rejects(instance.send(request), /当前有一轮/)
    assert.equal((await instance.list()).activeRun.id, first.runId)
    t.mock.timers.tick(2000)
    await stopping
    assert.equal((await instance.list()).activeRun, null)
    const second = await instance.send(request)
    await microUntil(() => web.state.waits === 2)
    assert.notEqual(first.runId, second.runId)
    assert.equal(web.dom.window.__duozhiGroupRunV1.id, second.runId)
    // The old IPC script arrives after the timeout and after the next token bind.
    assert.equal(web.dom.window.eval(oldScript), false)
    assert.equal(web.state.stopClicks, 0)
    web.stopGate.resolve(false)
    await instance.stop(second.runId)
    assert.equal((await instance.list()).activeRun, null)
  } finally {
    web.stopGate.resolve(false)
    await instance.close()
    web.close()
  }
})

test('同一工作目录的两个本地执行成员依次运行，保持相同初始上下文', async () => {
  let running = 0,
    maximum = 0
  const order = []
  const prompts = []
  const instance = manager({
    runCli: async ({ kind, prompt }) => {
      running++
      maximum = Math.max(maximum, running)
      order.push(`开始 ${kind}`)
      prompts.push(prompt)
      await new Promise((resolve) => setTimeout(resolve, 10))
      order.push(`结束 ${kind}`)
      running--
      return { text: `${kind} 完成结果` }
    },
  })
  try {
    const conversation = await group(instance)
    await instance.send({
      conversationId: conversation.id,
      content: '请各自评审',
      targets: conversation.members,
      mode: 'parallel',
    })
    await completed(instance)
    assert.equal(maximum, 1)
    assert.deepEqual(order, ['开始 codex', '结束 codex', '开始 claude', '结束 claude'])
    assert.ok(prompts.every((prompt) => !prompt.includes('完成结果')))
  } finally {
    await instance.close()
  }
})

test('提交脚本因上一轮生成拒绝时，不绑定旧会话也不清除新群检查', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const web = webHarness({ submitResult: { status: 'busy', detail: '官网正在生成其他回复，本次未提交' } })
  const sources = []
  const store = {
    state: { conversations: [], messages: {}, sources: {} },
    persist() {},
    setSource: (...args) => sources.push(args),
  }
  const instance = manager({ store, getWebsiteConnection: async () => web.record, createMonitor: web.createMonitor })
  try {
    const conversation = await websiteGroup(instance)
    await instance.send(webRequest(conversation))
    await microUntil(async () => !(await instance.list()).activeRun)
    const snapshot = await instance.list()
    assert.equal(snapshot.messages[conversation.id].at(-1).status, 'error')
    assert.equal(web.record.fresh, true)
    assert.equal(sources.length, 0)
  } finally {
    await instance.close()
    web.close()
  }
})

test('尚未实际提交时取消，不误停在准备期间启动的其他官网生成', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const submitGate = deferred()
  const web = webHarness({ submitGate, submitResult: { status: 'busy', detail: '其他回复已开始，本次未提交' } })
  const instance = manager({ getWebsiteConnection: async () => web.record, createMonitor: web.createMonitor })
  try {
    const conversation = await websiteGroup(instance)
    const { runId } = await instance.send(webRequest(conversation))
    await microUntil(() => web.state.submissions === 1)
    const stopping = instance.stop(runId)
    submitGate.resolve()
    await stopping
    assert.equal(web.state.stopClicks, 0)
  } finally {
    submitGate.resolve()
    await instance.close()
    web.close()
  }
})

const { prepareComposer, submitComposer } = require('./composer.cjs')

function realComposerFixture() {
  const dom = new JSDOM('<section><textarea id="prompt-textarea"></textarea></section>', {
    url: 'https://chatgpt.com/c/group',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 300, height: 50 })
  dom.window.Date.now = () => Date.now()
  dom.window.__duozhiGroupRunV1 = { id: 'run-first', startedAt: Date.now() }
  const config = {
    siteId: 'chatgpt',
    allowedHosts: ['chatgpt.com'],
    expectedUrl: dom.window.location.href,
    runToken: 'run-first',
  }
  const run = (fn, extra = {}) => dom.window.eval(`(${fn.toString()})(${JSON.stringify({ ...config, ...extra })})`)
  return { dom, run, textarea: dom.window.document.querySelector('textarea'), close: () => dom.window.close() }
}

test('真实官网提交适配器在等待按钮期间取消或被新轮替换，都不会点击发送', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  for (const change of ['cancel', 'replace']) {
    const page = realComposerFixture()
    try {
      assert.equal((await page.run(prepareComposer)).status, 'ready')
      page.textarea.value = '不要发送的旧轮草稿'
      const pending = page.run(submitComposer, { message: page.textarea.value })
      if (change === 'cancel') page.dom.window.__duozhiGroupRunV1.cancelled = true
      else page.dom.window.__duozhiGroupRunV1 = { id: 'run-newer', startedAt: Date.now() + 1 }
      let clicks = 0
      const button = page.dom.window.document.createElement('button')
      button.setAttribute('aria-label', 'Send message')
      button.onclick = () => clicks++
      page.textarea.parentElement.append(button)
      t.mock.timers.tick(120)
      assert.equal((await pending).status, 'blocked')
      assert.equal(clicks, 0)
      assert.equal(Boolean(page.dom.window.__duozhiGroupRunV1.submitted), false)
      assert.equal(page.textarea.value, '不要发送的旧轮草稿')
    } finally {
      page.close()
    }
  }
})

test('真实适配器仅在实际点击发送时标记本轮submitted', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const page = realComposerFixture()
  try {
    let clicks = 0
    const button = page.dom.window.document.createElement('button')
    button.setAttribute('aria-label', 'Send message')
    button.onclick = () => {
      clicks++
      page.textarea.value = ''
    }
    page.textarea.parentElement.append(button)
    assert.equal((await page.run(prepareComposer)).status, 'ready')
    assert.equal(Boolean(page.dom.window.__duozhiGroupRunV1.submitted), false)
    page.textarea.value = '本轮真实点击验证'
    const pending = page.run(submitComposer, { message: page.textarea.value })
    assert.equal(clicks, 1)
    assert.equal(page.dom.window.__duozhiGroupRunV1.submitted, true)
    t.mock.timers.tick(2400)
    assert.equal((await pending).status, 'sent')
  } finally {
    page.close()
  }
})

test('原生Enter真正提交后的回调绑定keyboardRunId，停止按钮才被允许点击', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const web = webHarness({ submitResult: { status: 'keyboard-ready' } })
  const instance = manager({ getWebsiteConnection: async () => web.record, createMonitor: web.createMonitor })
  try {
    const conversation = await websiteGroup(instance)
    const { runId } = await instance.send(webRequest(conversation))
    await microUntil(() => web.state.waits === 1)
    assert.deepEqual(
      web.state.keyboardEvents.map((event) => event.type),
      ['keyDown', 'keyUp'],
    )
    assert.equal(web.record.keyboardRunId, runId)
    assert.equal(Boolean(web.dom.window.__duozhiGroupRunV1.submitted), false)
    await instance.stop(runId)
    assert.equal(web.state.stopClicks, 1)
  } finally {
    await instance.close()
    web.close()
  }
})
