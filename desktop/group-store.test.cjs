const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createGroupStore } = require('./group-store.cjs')

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'duozhi-store-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return { directory, file: path.join(directory, 'conversations.json') }
}

function conversation(id = 'group-test', overrides = {}) {
  return {
    id,
    title: '测试群',
    members: ['web:chatgpt'],
    roles: { 'web:chatgpt': '出方案' },
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  }
}

function message(id, overrides = {}) {
  return {
    id: `message-${id}`,
    conversationId: 'group-test',
    speakerId: 'web:chatgpt',
    speakerName: 'ChatGPT',
    content: '完整结果',
    status: 'done',
    createdAt: 1500,
    ...overrides,
  }
}

function validState() {
  return {
    version: 1,
    conversations: [conversation()],
    messages: {
      'group-test': [
        message('user', { speakerId: 'user', speakerName: '我', content: '请给出方案', runId: 'run-first' }),
        message('reply', { runId: 'run-first', sourceUrl: 'https://chatgpt.com/c/test' }),
      ],
    },
    sources: { 'group-test': { 'web:chatgpt': 'https://chatgpt.com/c/test' } },
  }
}

test('完整 metadata、归档、已移除成员历史和 system 错误可以正常恢复', (t) => {
  const { directory, file } = fixture(t)
  const original = validState()
  original.conversations[0] = conversation('group-test', {
    members: ['web:chatgpt', 'cli:codex'],
    roles: { 'web:chatgpt': '出方案', 'cli:codex': '处理文件' },
    workspace: path.join(directory, 'already-moved-project'),
  })
  original.conversations.push(conversation('group-archived', { archived: true }))
  original.messages['group-archived'] = []
  original.messages['group-test'].push(
    message('old-member', {
      speakerId: 'web:gemini',
      speakerName: 'Gemini',
      sourceUrl: 'https://gemini.google.com/app/old',
      content: '已移出成员的旧回答',
    }),
    message('cli', {
      speakerId: 'cli:codex',
      speakerName: 'Codex',
      content: '已经修改文件',
      runId: 'run-first',
      step: '完成用户指定的项目任务',
    }),
    message('system', { speakerId: 'system', speakerName: '工作台', content: '说明信息', runId: 'run-first' }),
    message('storage-error', { speakerId: 'system', speakerName: '工作台', content: '记录保存失败', status: 'error' }),
  )
  original.sources['group-test']['web:gemini'] = 'https://gemini.google.com/app/old'
  fs.writeFileSync(file, JSON.stringify(original))
  const restored = createGroupStore(file)
  assert.deepEqual(restored.state, original)
  restored.persist()
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), original)
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
})

test('重启只把中断状态改为未确认，保留内容和终态且不自动写盘或重发', (t) => {
  const { file } = fixture(t)
  const original = validState()
  for (const status of ['queued', 'sending', 'streaming', 'error', 'cancelled', 'unconfirmed'])
    original.messages['group-test'].push(
      message(status, { status, content: status === 'queued' ? '' : '部分结果', detail: '原提示' }),
    )
  const source = JSON.stringify(original)
  fs.writeFileSync(file, source)
  const restored = createGroupStore(file)
  const list = restored.state.messages['group-test']
  for (const status of ['queued', 'sending', 'streaming']) {
    const item = list.find((entry) => entry.id === `message-${status}`)
    assert.equal(item.status, 'unconfirmed')
    assert.match(item.detail, /不会自动重发/)
    assert.equal(item.content, status === 'queued' ? '' : '部分结果')
  }
  for (const status of ['done', 'error', 'cancelled', 'unconfirmed'])
    assert.ok(list.some((entry) => entry.status === status))
  assert.equal(fs.readFileSync(file, 'utf8'), source)
  restored.persist()
  assert.deepEqual(createGroupStore(file).state, restored.state)
})

function rejectMutations(file, mutations) {
  for (let index = 0; index < mutations.length; index++) {
    const value = validState()
    mutations[index](value)
    const source = JSON.stringify(value)
    fs.writeFileSync(file, source)
    assert.throws(() => createGroupStore(file), /原文件已保留/, `mutation ${index}`)
    assert.equal(fs.readFileSync(file, 'utf8'), source)
  }
}

test('损坏 JSON 和合法 JSON 中损坏的群结构均保留原文件', (t) => {
  const { file } = fixture(t)
  fs.writeFileSync(file, '{bad data')
  assert.throws(() => createGroupStore(file), /原文件已保留/)
  assert.equal(fs.readFileSync(file, 'utf8'), '{bad data')
  rejectMutations(file, [
    (value) => {
      value.version = 2
    },
    (value) => {
      value.sources = []
    },
    (value) => {
      delete value.sources
    },
    (value) => {
      value.messages = []
    },
    (value) => {
      value.extra = 'unsupported metadata'
    },
    (value) => {
      value.conversations[0] = null
    },
    (value) => {
      delete value.conversations[0].roles
    },
    (value) => {
      value.conversations[0].title = ''
    },
    (value) => {
      value.conversations[0].title = 'x'.repeat(61)
    },
    (value) => {
      value.conversations[0].id = '__proto__'
    },
    (value) => {
      value.conversations.push({ ...value.conversations[0] })
    },
    (value) => {
      value.conversations[0].members = []
    },
    (value) => {
      value.conversations[0].members = ['web:copilot']
    },
    (value) => {
      value.conversations[0].members = ['web:chatgpt', 'web:chatgpt']
    },
    (value) => {
      value.conversations[0].members = [
        'web:chatgpt',
        'web:claude',
        'web:gemini',
        'web:deepseek',
        'web:doubao',
        'web:kimi',
        'web:grok',
      ]
    },
    (value) => {
      value.conversations[0].roles = []
    },
    (value) => {
      value.conversations[0].roles = {}
    },
    (value) => {
      value.conversations[0].roles['web:chatgpt'] = 'x'.repeat(501)
    },
    (value) => {
      value.conversations[0].roles['web:gemini'] = 'not a group member'
    },
    (value) => {
      value.conversations[0].createdAt = '1000'
    },
    (value) => {
      value.conversations[0].createdAt = -1
    },
    (value) => {
      value.conversations[0].updatedAt = 500
    },
    (value) => {
      value.conversations[0].updatedAt = Infinity
    },
    (value) => {
      value.conversations[0].archived = 'true'
    },
    (value) => {
      value.conversations[0].workspace = '../somewhere'
    },
    (value) => {
      value.conversations[0].workspace = '/tmp/invalid\0folder'
    },
    (value) => {
      value.conversations[0].members = ['cli:claude']
      value.conversations[0].roles = { 'cli:claude': '' }
    },
    (value) => {
      value.conversations[0].unknown = true
    },
  ])
})

test('消息必须有完整类型和长度，属于存在的群及同群用户轮次', (t) => {
  const { file } = fixture(t)
  rejectMutations(file, [
    (value) => {
      delete value.messages['group-test']
    },
    (value) => {
      value.messages['group-missing'] = []
    },
    (value) => {
      value.messages['group-test'] = {}
    },
    (value) => {
      value.messages['group-test'].push(null)
    },
    (value) => {
      value.messages['group-test'][1].id = 'plain-id'
    },
    (value) => {
      value.messages['group-test'][1].id = value.messages['group-test'][0].id
    },
    (value) => {
      value.messages['group-test'][1].conversationId = 'group-missing'
    },
    (value) => {
      delete value.messages['group-test'][1].conversationId
    },
    (value) => {
      value.messages['group-test'][1].speakerId = 'web:unknown'
    },
    (value) => {
      value.messages['group-test'][1].speakerName = ''
    },
    (value) => {
      value.messages['group-test'][1].speakerName = 'x'.repeat(101)
    },
    (value) => {
      value.messages['group-test'][1].content = 42
    },
    (value) => {
      value.messages['group-test'][1].content = ''
    },
    (value) => {
      value.messages['group-test'][1].content = 'x'.repeat(60001)
    },
    (value) => {
      value.messages['group-test'][0].content = 'x'.repeat(30001)
    },
    (value) => {
      value.messages['group-test'][1].status = 'success'
    },
    (value) => {
      value.messages['group-test'][0].status = 'streaming'
    },
    (value) => {
      value.messages['group-test'][1].createdAt = 1.5
    },
    (value) => {
      value.messages['group-test'][1].createdAt = null
    },
    (value) => {
      value.messages['group-test'][1].runId = 'not-a-run'
    },
    (value) => {
      value.messages['group-test'][1].runId = 'run-missing-user'
    },
    (value) => {
      value.messages['group-test'].push({ ...value.messages['group-test'][0], id: 'message-duplicate-user' })
    },
    (value) => {
      value.messages['group-test'][1].step = 'x'.repeat(501)
    },
    (value) => {
      value.messages['group-test'][1].detail = 'x'.repeat(4097)
    },
    (value) => {
      value.messages['group-test'][1].detail = {}
    },
    (value) => {
      value.messages['group-test'][1].unknown = true
    },
    (value) => {
      value.messages['group-test'][1].sourceUrl = 'https://gemini.google.com/app/other'
    },
    (value) => {
      value.messages['group-test'][0].sourceUrl = 'https://chatgpt.com/c/test'
    },
    (value) => {
      value.messages['group-test'].push(
        message('system-stream', { speakerId: 'system', speakerName: '工作台', status: 'streaming' }),
      )
    },
    (value) => {
      value.conversations.push(conversation('group-other'))
      value.messages['group-other'] = [message('cross-run', { conversationId: 'group-other', runId: 'run-first' })]
    },
  ])
})

test('官网来源拒绝群外键、错误平台、HTTP、credentials 和非默认端口', (t) => {
  const { file } = fixture(t)
  rejectMutations(file, [
    (value) => {
      value.sources['group-missing'] = {}
    },
    (value) => {
      value.sources['group-test'] = []
    },
    (value) => {
      value.sources['group-test']['cli:codex'] = 'https://chatgpt.com/c/test'
    },
    (value) => {
      value.sources['group-test']['web:copilot'] = 'https://copilot.microsoft.com/'
    },
    (value) => {
      value.sources['group-test']['web:chatgpt'] = 'https://gemini.google.com/app/test'
    },
    (value) => {
      value.sources['group-test']['web:chatgpt'] = 'http://chatgpt.com/c/test'
    },
    (value) => {
      value.sources['group-test']['web:chatgpt'] = 'https://user:secret@chatgpt.com/c/test'
    },
    (value) => {
      value.sources['group-test']['web:chatgpt'] = 'https://chatgpt.com:8443/c/test'
    },
    (value) => {
      value.sources['group-test']['web:chatgpt'] = 'https://chatgpt.com.evil.test/c/test'
    },
    (value) => {
      value.sources['group-test']['web:chatgpt'] = ' https://chatgpt.com/c/test'
    },
    (value) => {
      value.sources['group-test']['web:chatgpt'] = 'https://chatgpt.com/\nc/test'
    },
    (value) => {
      value.sources['group-test']['web:chatgpt'] = null
    },
  ])
})

test('persist 和 setSource 同样拒绝损坏内存记录，已有文件不会被覆盖', (t) => {
  const { file } = fixture(t)
  const source = JSON.stringify(validState())
  fs.writeFileSync(file, source)
  const store = createGroupStore(file)
  const sourcesBefore = JSON.stringify(store.state.sources)
  for (const [groupId, memberId, url] of [
    ['group-missing', 'web:chatgpt', 'https://chatgpt.com/c/test'],
    ['group-test', 'web:chatgpt', 'https://user:password@chatgpt.com/c/test'],
    ['group-test', 'cli:claude', 'https://claude.ai/chat/test'],
  ])
    assert.throws(() => store.setSource(groupId, memberId, url), /来源无效/)
  assert.equal(JSON.stringify(store.state.sources), sourcesBefore)
  assert.equal(fs.readFileSync(file, 'utf8'), source)
  store.state.messages['group-test'][1].content = null
  assert.throws(() => store.persist(), /未覆盖原文件/)
  assert.equal(fs.readFileSync(file, 'utf8'), source)
  assert.equal(fs.existsSync(`${file}.tmp`), false)
})

test('新空存储可以保存，合法 setSource 原子写入并保持私人文件权限', (t) => {
  const { file } = fixture(t)
  const store = createGroupStore(file)
  store.persist()
  assert.deepEqual(createGroupStore(file).state, { version: 1, conversations: [], messages: {}, sources: {} })
  store.state.conversations.push(conversation())
  store.state.messages['group-test'] = []
  store.setSource('group-test', 'web:chatgpt', 'https://chatgpt.com:443/c/test')
  assert.equal(createGroupStore(file).state.sources['group-test']['web:chatgpt'], 'https://chatgpt.com:443/c/test')
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  assert.equal(fs.existsSync(`${file}.tmp`), false)
})
