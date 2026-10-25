# 参与贡献

多智工作台基于 ChatHub，优先沿用现有 React、TypeScript、Vite、Electron 和 Yarn 工具链。提交前请阅读 [README](README.md) 与 [AGENTS.md](AGENTS.md)，保留上游来源和版权说明。

## 本地准备与验证

使用 Node.js 24（开发环境为 24.15.0）及 `package.json` 指定的 Yarn 4.0.1。在仓库目录执行：

```sh
corepack yarn install --immutable
corepack yarn build
corepack yarn build:desktop
corepack yarn test:desktop
```

成功标志：安装不改写锁文件，三个检查命令均以退出码 0 完成；扩展和桌面界面分别生成到 `dist/`、`dist-desktop/`。界面修改还需实际打开检查；运行桌面界面可在构建后执行 `corepack yarn start:desktop`。

`corepack yarn package:desktop` 当前仅支持 macOS，依赖系统的 `sips`、`iconutil` 和 `codesign`，按运行机器的 CPU 架构生成 arm64 或 x64 目录。构建脚本包含这些路径，不代表两个架构或其他操作系统均已实测。

## 修改范围与测试边界

- 官网配置在 `desktop/sites.json`，桌面窗口、发送及群聊调度在 `desktop/`，桌面界面在 `src/app/websites/`；原浏览器扩展在 `src/app/` 的其他模块中。
- 优先提交范围明确的修复，避免无关重构、依赖升级或锁文件改写。修复缺陷时，尽量提供可复现用例和相应回归测试。
- 官网发送和回复采集依赖各平台 DOM。模拟页面通过不等于真实账号可用；请分别记录模拟测试、实际官网、CLI 执行结果，以及未验证的平台。不得把排队、未确认或失败当作成功，也不要自动重发无法确认的请求。
- 保留官网安全策略，远程网页不得启用 Node、应用 preload 或关闭 `webSecurity`。界面改动保留既有布局和交互，并检查加载、错误反馈、键盘操作及窗口缩放。

## 提交 Issue 与 PR

说明触发条件、预期与实际结果；PR 补充改动原因、运行过的检查及结果、尚未验证的范围。截图或录屏只使用可公开的演示内容，隐去账号信息、真实聊天、会话地址及个人路径。

不要提交密码、API Key、Token、Cookie、浏览器配置、聊天记录、日志、构建缓存或打包产物。复现材料优先使用脱敏的最小样例；安全问题按 [SECURITY.md](SECURITY.md) 私下报告，不在公开 Issue 中披露利用细节。

代码沿用 [GPL-3.0](LICENSE)，上游说明见 [README_UPSTREAM.md](README_UPSTREAM.md)。品牌 Logo 的来源及第三方权利见 [素材说明](src/assets/official-ai/README.md)；它们不因代码采用 GPL 而改变权利归属。
