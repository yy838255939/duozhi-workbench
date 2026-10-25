const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { createBroadcaster, validateBroadcastRequest, websiteMatches, scriptCall } = require('./broadcast.cjs')

function fixture(siteId, url, attached = true) {
  const calls = []
  const contents = {
    isDestroyed: () => false,
    getURL: () => url,
    isLoadingMainFrame: () => false,
    executeJavaScript: async (script) => {
      calls.push('inspect')
      return script.includes('prepareFixture') ? { status: 'ready' } : { status: 'sent', detail: '官网已接收提交。' }
    },
    insertText: async (message) => calls.push(message),
  }
  return { siteId, attached, view: { webContents: contents }, calls }
}
const adapters = {
  prepareComposer: function prepareFixture() {},
  submitComposer: function submitFixture() {},
}

test('broadcast rejects duplicate targets and invalid or empty messages before touching websites', () => {
  for (const request of [
    { panelIds: ['panel-0', 'panel-0'], message: 'hello' },
    { panelIds: ['panel-6'], message: 'hello' },
    { panelIds: [], message: 'hello' },
    { panelIds: ['panel-0'], message: '  ' },
    { panelIds: ['panel-0'], message: 'x'.repeat(60001) },
    { panelIds: ['panel-0'], siteIds: null, message: 'hello' },
    { panelIds: ['panel-0'], siteIds: { 'panel-0': 'unknown' }, message: 'hello' },
    { panelIds: ['panel-0'], siteIds: { 'panel-1': 'chatgpt' }, message: 'hello' },
    { panelIds: ['panel-0'], siteIds: { 'panel-0': 'chatgpt', 'panel-1': 'gemini' }, message: 'hello' },
  ])
    assert.throws(() => validateBroadcastRequest({ siteIds: { 'panel-0': 'chatgpt' }, ...request }))
})

test('broadcast fills only visible requested official websites and reports the other targets', async () => {
  const records = new Map([
    ['panel-0', fixture('chatgpt', 'https://chatgpt.com/')],
    ['panel-1', fixture('gemini', 'https://gemini.google.com/app', false)],
    ['panel-2', fixture('doubao', 'https://example.com/chat/')],
    ['panel-3', fixture('grok', 'https://grok.com/')],
  ])
  const broadcast = createBroadcaster((id) => records.get(id), adapters)
  const results = await broadcast({ panelIds: ['panel-0', 'panel-1', 'panel-2'], siteIds: { 'panel-0': 'chatgpt', 'panel-1': 'gemini', 'panel-2': 'doubao' }, message: '同步测试\n第二行' })
  assert.deepEqual(
    results.map((result) => result.status),
    ['sent', 'blocked', 'unsupported'],
  )
  assert.deepEqual(records.get('panel-0').calls, ['inspect', '同步测试\n第二行', 'inspect'])
  for (const id of ['panel-1', 'panel-2', 'panel-3']) assert.deepEqual(records.get(id).calls, [])
})

test('broadcast does not overwrite an existing draft or fill a page that changed during preparation', async () => {
  const draft = fixture('chatgpt', 'https://chatgpt.com/')
  draft.view.webContents.executeJavaScript = async () => ({ status: 'draft-conflict', detail: '已有草稿。' })
  const changed = fixture('gemini', 'https://gemini.google.com/app')
  changed.view.webContents.executeJavaScript = async () => {
    changed.view.webContents.getURL = () => 'https://example.com/'
    return { status: 'ready' }
  }
  const records = new Map([
    ['panel-0', draft],
    ['panel-1', changed],
  ])
  const results = await createBroadcaster(
    (id) => records.get(id),
    adapters,
  )({ panelIds: ['panel-0', 'panel-1'], siteIds: { 'panel-0': 'chatgpt', 'panel-1': 'gemini' }, message: 'hello' })
  assert.deepEqual(
    results.map((result) => result.status),
    ['draft-conflict', 'blocked'],
  )
  assert.deepEqual(draft.calls, [])
  assert.deepEqual(changed.calls, [])
})

test('parallel clicks cannot submit a second broadcast while the first is in progress', async () => {
  const record = fixture('chatgpt', 'https://chatgpt.com/')
  let release
  record.view.webContents.insertText = () =>
    new Promise((resolve) => {
      release = resolve
    })
  const broadcast = createBroadcaster(() => record, adapters)
  const first = broadcast({ panelIds: ['panel-0'], siteIds: { 'panel-0': 'chatgpt' }, message: 'one' })
  await new Promise((resolve) => setImmediate(resolve))
  await assert.rejects(broadcast({ panelIds: ['panel-0'], siteIds: { 'panel-0': 'chatgpt' }, message: 'two' }), /正在发送/)
  release()
  assert.equal((await first)[0].status, 'sent')
})

test('a verified composer can use native Enter and still requires a separate submission confirmation', async () => {
  const record = fixture('deepseek', 'https://chat.deepseek.com/')
  record.view.webContents.executeJavaScript = async (script) =>
    script.includes('prepareFixture')
      ? { status: 'ready' }
      : script.includes('submitFixture')
        ? { status: 'keyboard-ready' }
        : { status: 'unconfirmed', detail: '未确认。' }
  record.view.webContents.focus = () => record.calls.push('focus')
  record.view.webContents.sendInputEvent = (event) => record.calls.push(event.type)
  const results = await createBroadcaster(() => record, {
    ...adapters,
    confirmSubmission: function confirmFixture() {},
  })({ panelIds: ['panel-0'], siteIds: { 'panel-0': 'deepseek' }, message: 'hello' })
  assert.equal(results[0].status, 'unconfirmed')
  assert.deepEqual(record.calls, ['hello', 'focus', 'keyDown', 'keyUp'])
})

test('message strings are serialized as data rather than executable code', () => {
  const message = '`); globalThis.compromised = true; //\n"\\\u2028\u2029'
  const context = {}
  const result = vm.runInNewContext(
    scriptCall(
      function echo(config) {
        return config.message
      },
      { message },
    ),
    context,
  )
  assert.equal(result, message)
  assert.equal(context.compromised, undefined)
})

test('provider matching rejects lookalike hosts, credentials and non-HTTPS URLs', () => {
  assert.equal(websiteMatches('doubao', 'https://doubao.com/chat/'), true)
  for (const url of [
    'https://chatgpt.com.evil.example/',
    'https://user:pass@chatgpt.com/',
    'http://chatgpt.com/',
    'https://accounts.google.com/',
  ])
    assert.equal(websiteMatches('chatgpt', url), false)
})


test('provider switches cannot deliver a broadcast into the previous provider or a changed record', async () => {
  const oldProvider = fixture('chatgpt', 'https://chatgpt.com/')
  const changedProvider = fixture('gemini', 'https://gemini.google.com/app')
  changedProvider.view.webContents.executeJavaScript = async () => {
    changedProvider.siteId = 'chatgpt'
    return { status: 'ready' }
  }
  const records = new Map([['panel-0', oldProvider], ['panel-1', changedProvider]])
  const results = await createBroadcaster((id) => records.get(id), adapters)({
    panelIds: ['panel-0', 'panel-1'],
    siteIds: { 'panel-0': 'deepseek', 'panel-1': 'gemini' },
    message: 'hello',
  })
  assert.deepEqual(results.map(({siteId, status}) => ({siteId, status})), [
    { siteId: 'deepseek', status: 'blocked' }, { siteId: 'gemini', status: 'blocked' },
  ])
  assert.deepEqual(oldProvider.calls, [])
  assert.deepEqual(changedProvider.calls, [])
})
