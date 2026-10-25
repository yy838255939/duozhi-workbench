const fs = require('node:fs')
const path = require('node:path')
const { websiteMatches } = require('./broadcast.cjs')

const ACTIVE_STATUSES = new Set(['queued', 'sending', 'streaming'])
const STATUSES = new Set([...ACTIVE_STATUSES, 'done', 'error', 'cancelled', 'unconfirmed'])
const WEBSITE_IDS = new Set(['chatgpt', 'claude', 'gemini', 'deepseek', 'doubao', 'grok', 'kimi', 'qwen', 'perplexity'])
const MEMBER_IDS = new Set([...WEBSITE_IDS].map((id) => `web:${id}`).concat(['cli:codex', 'cli:claude']))
const CONVERSATION_FIELDS = new Set([
  'id',
  'title',
  'members',
  'roles',
  'workspace',
  'createdAt',
  'updatedAt',
  'archived',
])
const MESSAGE_FIELDS = new Set([
  'id',
  'conversationId',
  'runId',
  'speakerId',
  'speakerName',
  'content',
  'status',
  'detail',
  'createdAt',
  'step',
  'sourceUrl',
])

const record = (value) =>
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
const validText = (value, max, nonempty = false) =>
  typeof value === 'string' && value.length <= max && (!nonempty || Boolean(value.trim()))
const timestamp = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000
const identifier = (value, prefix) =>
  typeof value === 'string' && value.length <= 120 && new RegExp(`^${prefix}-[a-zA-Z0-9_-]+$`).test(value)
const optional = (value, validate) => value === undefined || validate(value)
const fields = (value, allowed) => Object.keys(value).every((key) => allowed.has(key))
const requireValid = (condition) => {
  if (!condition) throw new Error('invalid group record')
}

function officialSource(memberId, value) {
  if (
    typeof memberId !== 'string' ||
    !memberId.startsWith('web:') ||
    !WEBSITE_IDS.has(memberId.slice(4)) ||
    !validText(value, 8192, true) ||
    /[\u0000-\u0020\u007f]/.test(value) ||
    !websiteMatches(memberId.slice(4), value)
  )
    return false
  // A different port is a different website origin, even with the same hostname.
  const url = new URL(value)
  return !url.port || url.port === '443'
}

function validateState(state) {
  requireValid(
    record(state) &&
      fields(state, new Set(['version', 'conversations', 'messages', 'sources'])) &&
      state.version === 1 &&
      Array.isArray(state.conversations) &&
      record(state.messages) &&
      record(state.sources),
  )
  const groups = new Map()
  for (const conversation of state.conversations) {
    requireValid(
      record(conversation) &&
        fields(conversation, CONVERSATION_FIELDS) &&
        identifier(conversation.id, 'group') &&
        !groups.has(conversation.id) &&
        validText(conversation.title, 60, true) &&
        Array.isArray(conversation.members) &&
        conversation.members.length >= 1 &&
        conversation.members.length <= 8 &&
        new Set(conversation.members).size === conversation.members.length &&
        conversation.members.every((id) => MEMBER_IDS.has(id)) &&
        conversation.members.filter((id) => id.startsWith('web:')).length <= 6 &&
        record(conversation.roles) &&
        Object.keys(conversation.roles).length === conversation.members.length &&
        Object.keys(conversation.roles).every((id) => conversation.members.includes(id)) &&
        conversation.members.every(
          (id) => Object.hasOwn(conversation.roles, id) && validText(conversation.roles[id], 500),
        ) &&
        timestamp(conversation.createdAt) &&
        timestamp(conversation.updatedAt) &&
        conversation.updatedAt >= conversation.createdAt &&
        optional(conversation.archived, (value) => typeof value === 'boolean') &&
        optional(
          conversation.workspace,
          (value) => validText(value, 4096, true) && path.isAbsolute(value) && !value.includes('\0'),
        ) &&
        (!conversation.members.some((id) => id.startsWith('cli:')) || Boolean(conversation.workspace)),
    )
    groups.set(conversation.id, conversation)
  }
  requireValid(
    Object.keys(state.messages).length === groups.size && Object.keys(state.messages).every((id) => groups.has(id)),
  )
  const messageIds = new Set()
  const runs = new Map()
  for (const conversation of groups.values()) {
    const list = state.messages[conversation.id]
    requireValid(Array.isArray(list))
    for (const message of list) {
      requireValid(
        record(message) &&
          fields(message, MESSAGE_FIELDS) &&
          identifier(message.id, 'message') &&
          !messageIds.has(message.id) &&
          message.conversationId === conversation.id &&
          (MEMBER_IDS.has(message.speakerId) || ['user', 'system'].includes(message.speakerId)) &&
          validText(message.speakerName, 100, true) &&
          STATUSES.has(message.status) &&
          validText(message.content, message.speakerId === 'user' ? 30000 : 60000, message.status === 'done') &&
          timestamp(message.createdAt) &&
          optional(message.runId, (value) => identifier(value, 'run')) &&
          optional(message.detail, (value) => validText(value, 4096)) &&
          optional(message.step, (value) => validText(value, 500)) &&
          optional(message.sourceUrl, (value) => officialSource(message.speakerId, value)),
      )
      if (message.speakerId === 'user')
        requireValid(message.status === 'done' && message.step === undefined && message.sourceUrl === undefined)
      if (message.speakerId === 'system')
        requireValid(
          ['done', 'error'].includes(message.status) && message.step === undefined && message.sourceUrl === undefined,
        )
      messageIds.add(message.id)
      if (message.runId !== undefined) {
        const run = runs.get(message.runId) || { conversationId: conversation.id, users: 0 }
        requireValid(run.conversationId === conversation.id)
        if (message.speakerId === 'user') run.users++
        runs.set(message.runId, run)
      }
    }
  }
  // Interrupted runs may have only their user message persisted. They still
  // cannot be associated with a different group or a different user request.
  for (const run of runs.values()) requireValid(run.users === 1)
  for (const [conversationId, sources] of Object.entries(state.sources)) {
    requireValid(groups.has(conversationId) && record(sources))
    for (const [memberId, url] of Object.entries(sources)) requireValid(officialSource(memberId, url))
    // A removed member's source remains valid: re-adding that member can reopen
    // its existing group conversation, while old messages retain their author.
  }
}

function createGroupStore(file) {
  let state = { version: 1, conversations: [], messages: {}, sources: {} }
  if (fs.existsSync(file)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(file, 'utf8'))
      validateState(loaded)
      state = loaded
      for (const list of Object.values(state.messages)) {
        if (!Array.isArray(list)) throw new Error('invalid messages')
        for (const message of list) {
          if (ACTIVE_STATUSES.has(message.status)) {
            message.status = 'unconfirmed'
            message.detail = '上次运行被中断，请检查官网或工作文件夹；不会自动重发。'
          }
        }
      }
    } catch {
      throw new Error('群聊记录读取失败，原文件已保留，请检查本地记录文件。')
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const persist = () => {
    try {
      validateState(state)
    } catch {
      throw new Error('群聊记录格式异常，未覆盖原文件。')
    }
    const temporary = `${file}.tmp`
    try {
      fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 })
      fs.chmodSync(temporary, 0o600)
      fs.renameSync(temporary, file)
    } catch (error) {
      try {
        fs.unlinkSync(temporary)
      } catch {}
      throw error
    }
  }
  return {
    get state() {
      return state
    },
    persist,
    setSource(conversationId, memberId, url) {
      if (
        !state.conversations.some((conversation) => conversation.id === conversationId) ||
        !officialSource(memberId, url)
      )
        throw new Error('群聊官网来源无效，未覆盖原记录。')
      state.sources[conversationId] ||= {}
      state.sources[conversationId][memberId] = url
      persist()
    },
  }
}

module.exports = { createGroupStore }
