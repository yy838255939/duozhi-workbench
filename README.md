# Duozhi Workbench（多智工作台）

**English** | [简体中文](README_ZH-CN.md)

Duozhi Workbench is a local multi-AI workspace being developed for users worldwide. Open official AI websites side by side, send a shared prompt, and collect selected AIs' replies in one group conversation.

Current version: **0.1.0**, the first public source release. Workbench additions include the Electron desktop app, prompt delivery to visible website panels, group reply collection, and a sequential relay that visits each selected AI once. The retained browser extension provides a prompt library, local history, and data backup features.

The application interface currently uses Simplified Chinese. English is the default language of this repository's README; use the link above to switch to the Chinese documentation.

Repository: [yy838255939/duozhi-workbench](https://github.com/yy838255939/duozhi-workbench). [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Attribution](NOTICE.md).

The desktop app can currently be run and packaged from source on macOS and has been checked on an Apple Silicon Mac. Desktop installation on Windows and Linux, and packaging on Intel Macs, have not been tested. The extension's legacy model integrations have not been fully verified either. Each AI continues to use its own website account, subscription, and usage limits.

## Official website desktop app

Each panel loads a real AI website, where you can sign in, chat, upload files, and view that platform's conversation history. Choose 1, 2, 3, 4, or 6 panels. Each panel provides an address bar, back, forward, reload, AI selection, and an option to open its page in a browser.

Drag AI entries up or down in the sidebar to reorder them; the order is saved locally. For keyboard reordering, focus an AI button and press Alt + Up or Alt + Down.

Use the arrow at the top of the sidebar to collapse or expand it. The collapsed sidebar keeps the AI icons, with names available on hover. Its collapsed state is saved locally.

The sidebar, website panels, group members, and reply avatars use locally bundled official logos with their original colors and proportions. See the [asset sources and notices](src/assets/official-ai/README.md).

The desktop app uses Electron's `WebContentsView`. Websites run as separate browser pages with their security policies preserved; the app does not remove anti-embedding response headers. Accounts and website conversations remain managed by each platform. Desktop sign-in sessions are stored separately and are not imported automatically from Chrome.

Use Node.js **24.15.0** (see `.nvmrc`) and Corepack. `package.json` pins Yarn to **4.0.1**. To package the app from the project directory on macOS:

```sh
corepack yarn install --immutable
corepack yarn package:desktop
```

**Success check:** `release/多智工作台-darwin-arm64/多智工作台.app` is created and opens the website panels. The output directory on an Intel Mac is named `多智工作台-darwin-x64`; that architecture has not been tested.

The shared input at the bottom of the desktop app sends the same text to the currently visible AI panels. Hidden panels do not receive it. The original Chrome extension's API-based broadcast feature is also retained.

To send a shared prompt:

1. Choose the panel count and each panel's AI, then sign in to the websites you want to use.
2. Enter a prompt in **统一输入** (shared input). Press Shift + Enter for a new line.
3. Click **发送到所有窗口** (send to all panels), or press Enter. Check the status at the top right of each AI panel, to the left of the **在浏览器打开** (open in browser) icon. Hover over a status for details.

**Success check:** the prompt appears in the corresponding website conversation and the panel shows **已发送** (sent). The shared input clears only when all targets are confirmed sent. After a partial success, the input is retained. **重试** (retry) targets only panels confirmed not to have sent the prompt. Unconfirmed results are not retried automatically; check the website first to avoid duplicate submissions.

A panel will not submit automatically if it is signed out, still generating a reply, contains an existing draft, or is unsupported. The app displays the reason. You can also use **复制文本** (copy text) and paste manually. Automatic sending depends on each website's composer, so website changes can affect compatibility. Platform verification and account limits still apply. A successful build, installation, or simulated-page check does not establish that every real account and platform works.

**Live website check on 2026-10-13:** in the installed desktop app, ChatGPT, Gemini, DeepSeek, Doubao (豆包), and Grok received the same broadcast prompt and replied. Kimi rejected that submission because of service queuing, and the app correctly showed **未发送** (not sent). Composer adapters exist for Claude, Qwen (千问), and Perplexity, but were not checked with real accounts. Copilot and Mistral currently require sending directly on their websites.

Website addresses are configured in `desktop/sites.json`. The desktop UI is in `src/app/websites`, and native window code is in `desktop/main.cjs`. Run `corepack yarn test:desktop` to check navigation validation, panel bounds, and website composer logic.

## AI group chats and collaboration

The desktop group-chat view collects multiple AI replies on one page. It supports mentions and bounded sequential collaboration. Each group saves its own website conversations, while groups using the same platform share its desktop sign-in session. Creating a new group does not require another sign-in when that session is still valid. Members receive the current request and recent group history.

To use a group chat:

1. Click **AI 群聊** (AI group chat), then **新建群聊** (new group chat). Enter a name and select members. A group requires at least one member and supports up to 6 website members and 2 local execution assistants. Groups containing only local assistants are also supported.
2. Use the open icon beside a website member to inspect its conversation. Sign in only if the platform is signed out or its session has expired. When adding Codex or Claude Code, click **选择文件夹** (choose folder) to select the working directory. The app uses the locally installed tool and its own sign-in state, and reports failures if the tool or login is unavailable.
3. Enter a task and select its recipients, or mention members by their full names, such as `@ChatGPT` or `@Claude Code`. `@所有人`, `@all`, and `@everyone` address the whole group. Enter sends; Shift + Enter adds a new line. Messages and replies are recorded under each member's name in the current group.
4. **一起回答** (answer together) runs website members concurrently and local execution assistants in a queue to avoid simultaneous writes to the working directory. **依次接力** (sequential relay) requires at least two members and lets you adjust their order: the first proposes a plan, intermediate members review it, and the last summarizes. Each round traverses the selected list once. If a member does not complete its step, the remaining relay pauses.

**Success check:** the current group shows your request, followed by each member's actual response or failure reason. For execution tasks, also inspect the output in the selected folder. Interface status and a successful installation do not replace checking the task's results.

Click **停止调度** (stop scheduling) during a run to stop further work. Requests are not resent automatically after stopping. A website may continue generating; open the original page to check. Failures, queued requests, and unconfirmed results are not treated as success or retried automatically. Each group keeps its own draft. Archiving hides a group while retaining its history.

Website group chats depend on platform composers and response elements. Website changes, sign-in verification, quotas, and queuing may affect compatibility. Copilot and Mistral do not yet support group response collection; they remain available for manual use in the website-panel view. The desktop group-chat feature does not currently provide an API integration or API-key configuration. Website broadcasts, group response collection, and local execution tools have separate verification results; one does not establish that all platforms work reliably.

**Live group-chat check on 2026-10-13:** replies from ChatGPT, Gemini, DeepSeek, Doubao, Grok, and Kimi were collected in the unified conversation, and a DeepSeek → Doubao relay completed. ChatGPT was rechecked for a new group's first submission, continued conversation in an existing group, and reply collection. The first Gemini attempt was stopped while waiting; a later attempt returned a website response saying the request was beyond its intended use. The content of a model's answer still requires review. Codex **0.135.0** and Claude Code **2.1.143** were detected locally. The Codex task in an isolated directory was stopped after 90 seconds without completing, and Claude Code authentication failed. Successful task outputs from those two local tools have not been verified.

## Local development

Use Node.js **24.15.0** and Corepack. To obtain the source and build the browser extension:

```sh
git clone https://github.com/yy838255939/duozhi-workbench.git
cd duozhi-workbench
corepack yarn install --immutable
corepack yarn build
```

**Success check:** the command exits with code 0 and creates `dist/manifest.json`.

To build and open the desktop interface:

```sh
corepack yarn build:desktop
corepack yarn start:desktop
```

**Success check:** the native **多智工作台** window opens, and you can switch between group chat and the website-panel view. Run `corepack yarn test:desktop` for automated checks. These tests use simulated pages and local stand-ins and do not require AI account sign-ins.

GitHub CI runs the tests and builds both the extension and desktop frontend. Packaging the macOS application still requires running `corepack yarn package:desktop` on a Mac.

## Install the Chrome extension

1. Open `chrome://extensions/`.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select this project's `dist` folder.
4. Click the extension icon to open **多智工作台**.

**Success check:** the extension list shows **多智工作台 0.1.0**, and the extension opens the Chinese **多模型同屏** (multiple models in one view) page.

## Update after changes

Run `corepack yarn build` again, reload the extension on Chrome's extensions page, and refresh the workbench tab.

**Success check:** the workbench shows your changes. Keep `dist`, because the installed unpacked extension loads from that directory.

## Current scope

This version retains the original project's technology stack. Its Chinese UI, layout, and local data features are available. The extension's model adapters come from older public source code, and some platforms have changed their domains, APIs, or sign-in flows. Real account conversations have not been checked for every adapter. Opening the app successfully does not establish that all legacy model integrations work.

The local interface does not require the original project's purchase authorization and does not send its installation-source or page-usage analytics. Model accounts, subscriptions, API charges, and usage limits remain controlled by each platform. Some legacy adapters still depend on the original project's services and need further updates for the platforms in use. The extension's old Grok / Twitter integration, which depended on a fixed authentication string, has been disabled and displays a message directing users to the desktop website version.
