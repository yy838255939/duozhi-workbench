import { packager } from '@electron/packager'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = path.resolve(import.meta.dirname, '..')
const stage = path.join(root, 'desktop-build', 'stage')
await fs.mkdir(stage, { recursive: true })
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
await fs.writeFile(
  path.join(stage, 'package.json'),
  JSON.stringify({ name: pkg.name, version: pkg.version, main: 'desktop/main.cjs', license: pkg.license }),
)
await fs.cp(path.join(root, 'dist-desktop'), path.join(stage, 'dist-desktop'), { recursive: true })
await fs.mkdir(path.join(stage, 'desktop'), { recursive: true })
for (const file of [
  'main.cjs',
  'preload.cjs',
  'sites.json',
  'validation.cjs',
  'broadcast.cjs',
  'composer.cjs',
  'response.cjs',
  'ready.cjs',
  'group-store.cjs',
  'group-manager.cjs',
  'cli.cjs',
])
  await fs.copyFile(path.join(root, 'desktop', file), path.join(stage, 'desktop', file))
for (const file of ['LICENSE', 'README_UPSTREAM.md']) await fs.copyFile(path.join(root, file), path.join(stage, file))
await fs.copyFile(path.join(root, 'src/assets/official-ai/README.md'), path.join(stage, 'AI_LOGO_SOURCES.md'))
await fs.copyFile(path.join(root, 'src/assets/official-ai/sources.json'), path.join(stage, 'AI_LOGO_SOURCES.json'))

const iconset = path.join(root, 'desktop-build', 'icon.iconset')
await fs.mkdir(iconset, { recursive: true })
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    execFileSync(
      'sips',
      [
        '-z',
        String(size * scale),
        String(size * scale),
        path.join(root, 'src/assets/icon.png'),
        '--out',
        path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`),
      ],
      { stdio: 'ignore' },
    )
  }
}
const icon = path.join(root, 'desktop-build', 'icon.icns')
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icon])
const electronVersion = pkg.devDependencies.electron.replace(/^[~^]/, '')
const runtimeDirectory = path.join(root, 'desktop-build', 'runtime')
const archiveName = `electron-v${electronVersion}-darwin-${process.arch}.zip`
const archive = path.join(runtimeDirectory, archiveName)
let electronZipDir
try {
  const bytes = await fs.readFile(archive)
  const checksums = JSON.parse(await fs.readFile(path.join(root, 'node_modules/electron/checksums.json'), 'utf8'))
  if (createHash('sha256').update(bytes).digest('hex') !== checksums[archiveName])
    throw new Error('Electron 运行时校验失败')
  electronZipDir = runtimeDirectory
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const bundles = await packager({
  dir: stage,
  out: path.join(root, 'release'),
  name: '多智工作台',
  appBundleId: 'local.duozhi.workbench',
  appVersion: pkg.version,
  electronVersion,
  electronZipDir,
  platform: 'darwin',
  arch: process.arch,
  overwrite: true,
  asar: true,
  icon,
  appCopyright: 'ChatHub contributors and 多智工作台 contributors. GPL-3.0.',
})
for (const bundle of bundles) {
  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--identifier', 'local.duozhi.workbench', path.join(bundle, '多智工作台.app')],
    { stdio: 'ignore' },
  )
}
console.log(`桌面版已生成：${path.join(bundles[0], '多智工作台.app')}`)
