const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function loadTypeScript(relativePath, dependencies, globals = {}) {
  const filename = path.join(__dirname, '..', relativePath)
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(
    code,
    {
      module,
      exports: module.exports,
      require: (name) => {
        assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
        return dependencies[name]
      },
      ...globals,
    },
    { filename },
  )
  return module.exports
}

test('legacy Grok fails with a migration message before reading credentials or contacting Twitter', async () => {
  const calls = []
  const errors = loadTypeScript('src/utils/errors.ts', {})
  const { GrokWebBot } = loadTypeScript(
    'src/app/bots/grok/index.ts',
    {
      '~utils/errors': errors,
      '../abstract-bot': { AbstractBot: class {} },
      ofetch: { ofetch: async () => calls.push('ofetch'), FetchError: class extends Error {} },
      'webextension-polyfill': { runtime: { sendMessage: async () => calls.push('credential') } },
      '~app/utils/permissions': { requestHostPermission: async () => calls.push('permission') },
      '~utils/stream-async-iterable': { streamAsyncIterable: async function* () {} },
    },
    { fetch: async () => calls.push('fetch') },
  )
  await assert.rejects(
    new GrokWebBot().doSendMessage({ prompt: 'test prompt', onEvent: () => calls.push('event') }),
    (error) => error.code === errors.ErrorCode.GROK_UNAVAILABLE && /桌面版/.test(error.message),
  )
  assert.deepEqual(calls, [])
})
