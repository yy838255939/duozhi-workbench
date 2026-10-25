const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const { constants } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const MAX_PROMPT = 60000
const MAX_LINE_BYTES = 2 * 1024 * 1024
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024
const MAX_TEXT_BYTES = 512 * 1024
const MAX_TIMEOUT = 10 * 60 * 1000
const MEMBERS = { codex: 'Codex', claude: 'Claude Code' }

class CliError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CliError'
    this.code = code
  }
}

function trustedCandidates(kind) {
  return [
    path.join(os.homedir(), '.local', 'bin', kind),
    path.join(os.homedir(), '.npm-global', 'bin', kind),
    path.join('/opt/homebrew/bin', kind),
    path.join('/usr/local/bin', kind),
    path.join('/usr/bin', kind),
  ]
}

async function findExecutable(paths) {
  for (const candidate of paths) {
    if (!path.isAbsolute(candidate)) continue
    try {
      const resolved = await fs.realpath(candidate)
      if (!(await fs.stat(resolved)).isFile()) continue
      await fs.access(resolved, constants.X_OK)
      return resolved
    } catch {}
  }
  return null
}

function childEnvironment(binary) {
  // Finder launches do not inherit a terminal's PATH. Do not load shell profiles
  // or search the workspace for a replacement executable.
  const env = { ...process.env }
  env.PATH = [
    ...new Set([
      path.dirname(binary),
      path.join(os.homedir(), '.local', 'bin'),
      path.join(os.homedir(), '.npm-global', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ]),
  ].join(path.delimiter)
  env.NO_COLOR = '1'
  env.TERM = 'dumb'
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

function safeText(value) {
  return value
    .replace(/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}\b/g, '[敏感信息已隐藏]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~-]{20,}/gi, '$1[敏感信息已隐藏]')
    .replace(
      /((?:api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[=:]\s*["']?)[A-Za-z0-9._~-]{16,}/gi,
      '$1[敏感信息已隐藏]',
    )
}

function failureKind(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || '')
  if (/permission|approval|not allowed|not permitted|denied|sandbox|权限|授权/i.test(text)) return 'permission'
  if (/unauthori[sz]ed|not logged|log(?:in| in)|auth|api.?key|401|登录/i.test(text)) return 'auth'
  if (/quota|rate.?limit|credit|billing|usage.?limit|429|余额|额度/i.test(text)) return 'quota'
  return 'execution'
}

function errorFor(code, name) {
  const messages = {
    cancelled: '本次本地任务已停止。已完成的文件改动会保留，请检查项目目录。',
    timeout: '本地任务超过 10 分钟，已停止。请拆分任务后重试。',
    permission: `${name} 需要额外权限，本次任务已停止。请在该工具的终端里确认权限后再执行；工作台不会绕过权限。`,
    auth: `${name} 未能通过登录验证。请先在该工具的终端里完成登录，再回到工作台重试。`,
    quota: `${name} 提示额度或调用频率限制，请处理后再执行。`,
    output: `${name} 输出过大，已停止本次任务。请缩小任务范围。`,
    protocol: `${name} 没有返回可确认的最终回复，请检查工具版本后重试。`,
    execution: `${name} 本次执行失败，请在该工具的终端里检查登录、网络和项目权限。`,
  }
  return new CliError(code, messages[code] || messages.execution)
}

function textBlocks(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

function createParser(kind, update, stop) {
  let latest = ''
  let final = ''
  let streaming = ''
  let completed = false
  let failure = null
  function answer(text, isFinal = false) {
    if (typeof text !== 'string' || !text.trim()) return
    if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) return stop('output')
    latest = safeText(text)
    if (isFinal) final = latest
    update({ text: latest, detail: isFinal ? '已收到最终回复。' : '正在回复…' })
  }
  function event(value) {
    if (!value || typeof value !== 'object') return
    if (kind === 'codex') {
      if (value.type === 'turn.completed') completed = true
      if (value.type === 'turn.failed') failure = failureKind(value.error)
      if (value.type === 'error') failure = failureKind(value.message)
      if (value.type === 'item.started' || value.type === 'item.updated' || value.type === 'item.completed') {
        const item = value.item || {}
        if (item.type === 'agent_message') answer(item.text, item.phase === 'final_answer' || item.phase === 'final')
        else if (item.type === 'command_execution')
          update({
            text: final || latest,
            detail: value.type === 'item.completed' ? '正在整理执行结果…' : '正在项目目录执行命令…',
          })
        else if (item.type === 'file_change') update({ text: final || latest, detail: '正在处理项目文件…' })
        else if (item.type === 'mcp_tool_call' || item.type === 'web_search')
          update({ text: final || latest, detail: '正在调用工具…' })
      }
      // A successful completed turn supersedes reconnect/error notifications.
      if (value.type === 'turn.completed') failure = null
      return
    }
    if (value.type === 'control_request' && value.request?.subtype === 'can_use_tool') return stop('permission')
    if (value.type === 'stream_event') {
      const part = value.event || {}
      if (part.type === 'message_start') streaming = ''
      if (part.type === 'content_block_start' && part.content_block?.type === 'text')
        streaming += part.content_block.text || ''
      if (part.type === 'content_block_delta' && part.delta?.type === 'text_delta') streaming += part.delta.text || ''
      if (streaming) answer(streaming)
    }
    if (value.type === 'assistant') {
      answer(textBlocks(value.message?.content))
      if (value.message?.content?.some((block) => block?.type === 'tool_use'))
        update({ text: final || latest, detail: '正在调用项目工具…' })
    }
    if (value.type === 'result') {
      completed = true
      if (Array.isArray(value.permission_denials) && value.permission_denials.length) failure = 'permission'
      else if (value.is_error || (value.subtype && value.subtype !== 'success'))
        failure = failureKind(value.errors || value.result || value.subtype)
      else answer(value.result, true)
    }
  }
  return { event, result: () => ({ text: final || latest, completed, failure }) }
}

function killProcessGroup(child, signal) {
  if (!child.pid) return
  try {
    if (process.platform === 'win32') child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') {
      try {
        child.kill(signal)
      } catch {}
    }
  }
}

async function versionOf(binary, kind) {
  return new Promise((resolve) => {
    let data = ''
    let settled = false
    const child = spawn(binary, ['--version'], {
      env: childEnvironment(binary),
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    })
    const timer = setTimeout(() => {
      killProcessGroup(child, 'SIGKILL')
      finish(null)
    }, 10000)
    function finish(version) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(version)
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      data += chunk
      if (data.length > 16384) {
        killProcessGroup(child, 'SIGKILL')
        finish(null)
      }
    })
    child.on('error', () => finish(null))
    child.on('close', (code) => {
      const expression = kind === 'codex' ? /codex-cli\s+(\d+\.\d+\.\d+)/ : /(\d+\.\d+\.\d+)\s+\(Claude Code\)/
      finish(code === 0 ? data.match(expression)?.[1] || null : null)
    })
  })
}

// Dependency options are exclusively for main-process tests. The renderer only
// receives discoverCliMembers / runCli; it cannot provide a binary or argv.
function createCliRuntime({ candidatePaths, timeoutMs = MAX_TIMEOUT, killGraceMs = 750 } = {}) {
  const deadlineMs = Math.max(1, Math.min(MAX_TIMEOUT, timeoutMs))
  const graceMs = Math.max(1, Math.min(2000, killGraceMs))
  const candidates = (kind) => candidatePaths?.[kind] || trustedCandidates(kind)

  async function discoverCliMembers() {
    return Promise.all(
      Object.entries(MEMBERS).map(async ([kind, name]) => {
        const binary = await findExecutable(candidates(kind))
        const version = binary ? await versionOf(binary, kind) : null
        return {
          id: `cli:${kind}`,
          name,
          available: Boolean(binary && version),
          detail: version
            ? `已安装 ${name} ${version}；执行时使用本机工具的登录状态。`
            : binary
              ? '工具版本未能确认，请在终端检查安装。'
              : `尚未发现 ${name}，请先自行安装并登录。`,
        }
      }),
    )
  }

  async function runCli({ kind, workspace, prompt, signal, onUpdate } = {}) {
    if (!Object.hasOwn(MEMBERS, kind)) throw new CliError('invalid', '只支持 Codex 和 Claude Code 本地成员。')
    if (
      signal &&
      (typeof signal.aborted !== 'boolean' ||
        typeof signal.addEventListener !== 'function' ||
        typeof signal.removeEventListener !== 'function')
    )
      throw new CliError('invalid', '任务取消状态无效，请重试。')
    if (typeof workspace !== 'string' || !path.isAbsolute(workspace) || workspace.includes('\0'))
      throw new CliError('workspace', '请先选择一个存在的项目目录。')
    let cwd
    try {
      cwd = await fs.realpath(workspace)
      if (!(await fs.stat(cwd)).isDirectory()) throw new Error('directory required')
    } catch {
      throw new CliError('workspace', '选择的项目目录不存在或无法访问，请重新选择。')
    }
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT || prompt.includes('\0'))
      throw new CliError('invalid', '任务内容不能为空，且不能超过 60000 字。')
    const name = MEMBERS[kind]
    if (signal?.aborted) throw errorFor('cancelled', name)
    const binary = await findExecutable(candidates(kind))
    if (!binary) throw new CliError('unavailable', `尚未发现 ${name}，请先在终端安装并登录。`)
    if (signal?.aborted) throw errorFor('cancelled', name)
    const args =
      kind === 'codex'
        ? [
            'exec',
            '--json',
            '--color',
            'never',
            '--sandbox',
            'workspace-write',
            '--ignore-user-config',
            '-c',
            'approval_policy="never"',
            '--ephemeral',
            '--skip-git-repo-check',
            '--cd',
            cwd,
            '-',
          ]
        : [
            '--print',
            '--output-format',
            'stream-json',
            '--input-format',
            'text',
            '--verbose',
            '--include-partial-messages',
            '--permission-mode',
            'default',
            '--no-session-persistence',
            '--no-chrome',
          ]

    return new Promise((resolve, reject) => {
      let pendingLine = ''
      let outputBytes = 0
      let diagnostic = ''
      let stopped = null
      let settled = false
      let closeResult = null
      let terminationTimer = null
      let updateTimer = null
      let pendingUpdate = null
      let lastUpdate = null
      function emit(update) {
        if (settled || stopped) return
        pendingUpdate = update
        if (!updateTimer) updateTimer = setTimeout(flushUpdate, 80)
      }
      function flushUpdate() {
        clearTimeout(updateTimer)
        updateTimer = null
        if (!pendingUpdate || settled || stopped) return
        const update = pendingUpdate
        pendingUpdate = null
        if (lastUpdate?.text === update.text && lastUpdate?.detail === update.detail) return
        lastUpdate = update
        try {
          onUpdate?.(update)
        } catch {}
      }
      const child = spawn(binary, args, {
        cwd,
        env: childEnvironment(binary),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      })
      const parser = createParser(kind, emit, stop)
      function stop(reason) {
        if (stopped || settled) return
        stopped = reason
        killProcessGroup(child, 'SIGTERM')
        terminationTimer = setTimeout(() => {
          killProcessGroup(child, 'SIGKILL')
          terminationTimer = null
          // Descendants that inherited stdout may delay close. Return after
          // escalation, without waiting indefinitely for a broken pipe owner.
          finish()
        }, graceMs)
      }
      const onAbort = () => stop('cancelled')
      const timeout = setTimeout(() => stop('timeout'), deadlineMs)
      function finish(spawnError) {
        if (settled || (stopped && terminationTimer)) return
        flushUpdate()
        settled = true
        clearTimeout(timeout)
        clearTimeout(terminationTimer)
        clearTimeout(updateTimer)
        signal?.removeEventListener('abort', onAbort)
        child.stdin.destroy()
        child.stdout.destroy()
        child.stderr.destroy()
        pendingLine = ''
        const result = parser.result()
        if (stopped) return reject(errorFor(stopped, name))
        if (spawnError) return reject(errorFor('execution', name))
        if (result.failure) return reject(errorFor(result.failure, name))
        if (!closeResult || closeResult.code !== 0) return reject(errorFor(failureKind(diagnostic), name))
        if (!result.completed || !result.text) return reject(errorFor('protocol', name))
        resolve({ text: result.text })
      }
      function consumeLine(line) {
        if (!line.trim() || stopped || settled) return
        try {
          parser.event(JSON.parse(line))
        } catch {
          // Never echo arbitrary CLI stdout. Some versions print startup notices
          // among JSON events; only recognized assistant events are displayed.
        }
      }
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        if (settled || stopped) return
        outputBytes += Buffer.byteLength(chunk, 'utf8')
        if (outputBytes > MAX_OUTPUT_BYTES) return stop('output')
        pendingLine += chunk
        let newline
        while ((newline = pendingLine.indexOf('\n')) !== -1) {
          const line = pendingLine.slice(0, newline)
          pendingLine = pendingLine.slice(newline + 1)
          if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) return stop('output')
          consumeLine(line)
        }
        if (Buffer.byteLength(pendingLine, 'utf8') > MAX_LINE_BYTES) stop('output')
      })
      child.stderr.on('data', (chunk) => {
        if (settled || stopped) return
        outputBytes += Buffer.byteLength(chunk, 'utf8')
        diagnostic = (diagnostic + chunk).slice(-8192)
        if (outputBytes > MAX_OUTPUT_BYTES) stop('output')
      })
      child.stdin.on('error', () => {})
      child.stdout.on('error', () => stop('execution'))
      child.stderr.on('error', () => stop('execution'))
      child.on('error', (error) => finish(error))
      child.on('close', (code) => {
        if (settled) return
        consumeLine(pendingLine)
        closeResult = { code }
        finish()
      })
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) stop('cancelled')
      else {
        emit({ text: '', detail: `正在启动 ${name}…` })
        // Prompt is only stdin data. It never becomes argv or shell code.
        child.stdin.end(prompt)
      }
    })
  }
  return { discoverCliMembers, runCli }
}

const runtime = createCliRuntime()
module.exports = { ...runtime, createCliRuntime }
