const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { createCliRuntime } = require('./cli.cjs')

// These are executable stand-ins, not mocked spawn callbacks: tests exercise
// stdin/argv boundaries, JSON streams, exit codes and POSIX process groups.
const fixtureSource = String.raw`
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const kind = path.basename(process.argv[1]).startsWith('codex') ? 'codex' : 'claude'
if (process.argv.includes('--version')) {
  console.log(kind === 'codex' ? 'codex-cli 0.135.0' : '2.1.143 (Claude Code)')
} else {
  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => input += chunk)
  process.stdin.on('end', () => {
    fs.writeFileSync('capture.json', JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), prompt: input }))
    const request = JSON.parse(input)
    const emit = value => process.stdout.write(JSON.stringify(value) + '\n')
    if (request.scenario === 'cancel') {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => require("node:fs").appendFileSync("heartbeat", "."), 30)'], { stdio: 'ignore' })
      fs.writeFileSync('pids.json', JSON.stringify([process.pid, child.pid]))
      setInterval(() => {}, 1000)
    } else if (request.scenario === 'stall') {
      setInterval(() => {}, 1000)
    } else if (request.scenario === 'large') {
      process.stdout.write('x'.repeat(3 * 1024 * 1024))
    } else if (request.scenario === 'auth') {
      process.stderr.write('401 Unauthorized API_KEY=sk-proj-THIS_IS_A_SECRET_CREDENTIAL_123456789')
      process.exitCode = 1
    } else if (request.scenario === 'invalid') {
      process.stdout.write('a non-JSON notice and sk-proj-THIS_IS_A_SECRET_CREDENTIAL_123456789\n')
    } else if (request.scenario === 'control') {
      emit({ type: 'control_request', request: { subtype: 'can_use_tool', input: { secret: 'not displayed' } } })
      setInterval(() => {}, 1000)
    } else if (request.scenario === 'permission') {
      emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'I wanted to edit a file.' }] } })
      emit({ type: 'result', subtype: 'success', result: 'Could not edit.', permission_denials: [{ tool_name: 'Edit', tool_input: { api_key: 'SECRET' } }] })
    } else if (kind === 'codex') {
      process.stdout.write('startup notice, not assistant output\n')
      emit({ type: 'item.completed', item: { type: 'command_execution', aggregated_output: 'sk-proj-THIS_IS_A_SECRET_CREDENTIAL_123456789' } })
      emit({ type: 'item.completed', item: { type: 'agent_message', phase: 'commentary', text: '中间步骤' } })
      setTimeout(() => {
        emit({ type: 'item.completed', item: { type: 'agent_message', phase: 'final_answer', text: '最终回复：已完成。' } })
        emit({ type: 'item.completed', item: { type: 'agent_message', phase: 'commentary', text: '尾部说明' } })
        emit({ type: 'turn.completed', usage: { input_tokens: 10 } })
      }, 120)
    } else {
      emit({ type: 'system', subtype: 'init', apiKeySource: 'not displayed' })
      emit({ type: 'stream_event', event: { type: 'message_start' } })
      emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '你' } } })
      setTimeout(() => {
        const event = Buffer.from(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '好，世界' } } }) + '\n')
        const chinese = event.indexOf(Buffer.from('好'))
        process.stdout.write(event.subarray(0, chinese + 1))
        setTimeout(() => {
          process.stdout.write(event.subarray(chinese + 1))
          emit({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'echo SECRET' } }, { type: 'text', text: '你好，世界' }] } })
          emit({ type: 'result', subtype: 'success', is_error: false, result: request.scenario === 'secret' ? '密钥 sk-proj-THIS_IS_A_SECRET_CREDENTIAL_123456789' : '最终汇总：已完成。', permission_denials: [] })
        }, 40)
      }, 120)
    }
  })
}
`

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-cli-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const workspace = path.join(root, '中文项目 $() ; &')
  await fs.mkdir(workspace)
  const candidatePaths = {}
  for (const kind of ['codex', 'claude']) {
    const binary = path.join(root, `${kind}-fixture`)
    await fs.writeFile(binary, `#!${process.execPath}\n${fixtureSource}`, { mode: 0o700 })
    candidatePaths[kind] = [binary]
  }
  return { root, workspace, candidatePaths, ...createCliRuntime({ candidatePaths, killGraceMs: 100, ...options }) }
}

async function waitForFile(file) {
  for (let index = 0; index < 100; index++) {
    try {
      return await fs.readFile(file, 'utf8')
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('fixture did not start')
}

test('discovery checks fixed executable candidates and versions without running a task', async (t) => {
  const runtime = await fixture(t)
  const members = await runtime.discoverCliMembers()
  assert.deepEqual(
    members.map(({ id, available }) => ({ id, available })),
    [
      { id: 'cli:codex', available: true },
      { id: 'cli:claude', available: true },
    ],
  )
  assert.match(members[0].detail, /0\.135\.0/)
  assert.match(members[1].detail, /2\.1\.143/)
  await assert.rejects(fs.stat(path.join(runtime.workspace, 'capture.json')), { code: 'ENOENT' })
  const absent = createCliRuntime({
    candidatePaths: { codex: [path.join(runtime.root, 'missing')], claude: [runtime.workspace] },
  })
  assert.deepEqual(
    (await absent.discoverCliMembers()).map((member) => member.available),
    [false, false],
  )
})

test('Codex prompt stays stdin data and the selected directory is one argv value', async (t) => {
  const runtime = await fixture(t)
  const marker = path.join(runtime.root, 'should-not-exist')
  const prompt = JSON.stringify({
    scenario: 'normal',
    malicious: `"; touch '${marker}'; $(touch '${marker}') --dangerously-bypass-approvals-and-sandbox`,
  })
  const updates = []
  const result = await runtime.runCli({
    kind: 'codex',
    workspace: runtime.workspace,
    prompt,
    onUpdate: (value) => updates.push(value),
  })
  assert.equal(result.text, '最终回复：已完成。')
  const captured = JSON.parse(await fs.readFile(path.join(runtime.workspace, 'capture.json'), 'utf8'))
  assert.equal(captured.prompt, prompt)
  assert.equal(captured.cwd, await fs.realpath(runtime.workspace))
  assert.equal(captured.args[captured.args.indexOf('--cd') + 1], captured.cwd)
  assert.equal(captured.args[captured.args.indexOf('--sandbox') + 1], 'workspace-write')
  assert.ok(captured.args.includes('--ignore-user-config'))
  assert.ok(captured.args.includes('approval_policy="never"'))
  assert.ok(captured.args.includes('--ephemeral'))
  assert.equal(captured.args.at(-1), '-')
  assert.equal(
    captured.args.some((arg) => arg.includes('dangerously')),
    false,
  )
  assert.equal(captured.args.includes(prompt), false)
  await assert.rejects(fs.stat(marker), { code: 'ENOENT' })
  assert.ok(updates.some((value) => value.text === '中间步骤'))
  assert.equal(JSON.stringify(updates).includes('SECRET_CREDENTIAL'), false)
})

test('Claude reads split UTF-8 JSON streams, displays text only and prefers the final result', async (t) => {
  const runtime = await fixture(t)
  const updates = []
  const result = await runtime.runCli({
    kind: 'claude',
    workspace: runtime.workspace,
    prompt: JSON.stringify({ scenario: 'normal' }),
    onUpdate: (value) => updates.push(value),
  })
  assert.equal(result.text, '最终汇总：已完成。')
  assert.ok(updates.some((update) => update.text === '你'))
  assert.ok(updates.every((update) => !update.text.includes('�')))
  assert.equal(JSON.stringify(updates).includes('echo SECRET'), false)
  const { args } = JSON.parse(await fs.readFile(path.join(runtime.workspace, 'capture.json'), 'utf8'))
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'default')
  assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json')
  assert.ok(args.includes('--print'))
  assert.equal(
    args.some((arg) => /skip-permissions|allowedTools|acceptEdits/.test(arg)),
    false,
  )
})

test('invalid workspace and prompts fail before spawning a tool', async (t) => {
  const runtime = await fixture(t)
  const file = path.join(runtime.root, 'file')
  await fs.writeFile(file, 'not a directory')
  for (const workspace of ['', '.', file, path.join(runtime.root, 'absent')]) {
    await assert.rejects(runtime.runCli({ kind: 'codex', workspace, prompt: 'task' }), { code: 'workspace' })
  }
  for (const prompt of ['', ' ', 'x'.repeat(60001), 'hello\0world']) {
    await assert.rejects(runtime.runCli({ kind: 'codex', workspace: runtime.workspace, prompt }), { code: 'invalid' })
  }
  await assert.rejects(runtime.runCli({ kind: 'arbitrary', workspace: runtime.workspace, prompt: 'task' }), {
    code: 'invalid',
  })
  await assert.rejects(fs.stat(path.join(runtime.workspace, 'capture.json')), { code: 'ENOENT' })
})

test('permissions are reported instead of bypassed, including a pending control request', async (t) => {
  const runtime = await fixture(t)
  for (const scenario of ['permission', 'control']) {
    await assert.rejects(
      runtime.runCli({ kind: 'claude', workspace: runtime.workspace, prompt: JSON.stringify({ scenario }) }),
      (error) => {
        assert.equal(error.code, 'permission')
        assert.match(error.message, /不会绕过权限/)
        assert.equal(error.message.includes('SECRET'), false)
        return true
      },
    )
  }
})

test('errors and oversized output stay bounded and never expose diagnostic credentials', async (t) => {
  const runtime = await fixture(t)
  for (const [scenario, code] of [
    ['auth', 'auth'],
    ['invalid', 'protocol'],
    ['large', 'output'],
  ]) {
    await assert.rejects(
      runtime.runCli({ kind: 'codex', workspace: runtime.workspace, prompt: JSON.stringify({ scenario }) }),
      (error) => {
        assert.equal(error.code, code)
        assert.equal(error.message.includes('SECRET_CREDENTIAL'), false)
        return true
      },
    )
  }
  const result = await runtime.runCli({
    kind: 'claude',
    workspace: runtime.workspace,
    prompt: JSON.stringify({ scenario: 'secret' }),
  })
  assert.equal(result.text, '密钥 [敏感信息已隐藏]')
})

test('aborted requests do not spawn and timeouts terminate a stalled invocation', async (t) => {
  const runtime = await fixture(t, { timeoutMs: 150 })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    runtime.runCli({ kind: 'codex', workspace: runtime.workspace, prompt: '{}', signal: controller.signal }),
    { code: 'cancelled' },
  )
  await assert.rejects(fs.stat(path.join(runtime.workspace, 'capture.json')), { code: 'ENOENT' })
  await assert.rejects(
    runtime.runCli({ kind: 'codex', workspace: runtime.workspace, prompt: JSON.stringify({ scenario: 'stall' }) }),
    { code: 'timeout' },
  )
})

test(
  'cancelling one task terminates its descendants and leaves unrelated processes alive',
  { skip: process.platform === 'win32' },
  async (t) => {
    const runtime = await fixture(t)
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    t.after(() => unrelated.kill('SIGKILL'))
    const controller = new AbortController()
    const task = runtime.runCli({
      kind: 'codex',
      workspace: runtime.workspace,
      prompt: JSON.stringify({ scenario: 'cancel' }),
      signal: controller.signal,
    })
    const rejection = assert.rejects(task, { code: 'cancelled' })
    const pids = JSON.parse(await waitForFile(path.join(runtime.workspace, 'pids.json')))
    await waitForFile(path.join(runtime.workspace, 'heartbeat'))
    controller.abort()
    await rejection
    const heartbeat = await fs.readFile(path.join(runtime.workspace, 'heartbeat'), 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 160))
    assert.equal(await fs.readFile(path.join(runtime.workspace, 'heartbeat'), 'utf8'), heartbeat)
    assert.throws(() => process.kill(pids[0], 0), { code: 'ESRCH' })
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0))
  },
)
