const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { prepareComposer, submitComposer, confirmSubmission } = require('./composer.cjs');

// Execute precisely the serialized browser source. No module globals or Node
// APIs are available inside the DOM fixture; only the exported source is copied.
function fixture(html, siteId = 'chatgpt', host = 'chatgpt.com') {
  const dom = new JSDOM(html, { url: `https://${host}/`, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, width: 320, height: 40, top: 0, left: 0, right: 320, bottom: 40 };
  };
  const config = { siteId, allowedHosts: [host], expectedUrl: dom.window.location.href };
  const run = (fn, extra = {}) => dom.window.eval(`(${fn.toString()})(${JSON.stringify({ ...config, ...extra })})`);
  return { window: dom.window, document: dom.window.document, run, config, close: () => dom.window.close() };
}

test('serialized textarea adapter focuses only the official ChatGPT composer', async () => {
  const page = fixture('<input placeholder="Search"><input type="password"><textarea id="prompt-textarea"></textarea>');
  try {
    assert.equal((await page.run(prepareComposer)).status, 'ready');
    assert.equal(page.document.activeElement.id, 'prompt-textarea');
  } finally { page.close(); }
});

test('empty rich-text placeholder is not treated as an unsent draft', async () => {
  const page = fixture('<div class="ProseMirror" contenteditable="true" data-placeholder="Reply to Claude"><p><br></p></div>', 'claude', 'claude.ai');
  try {
    assert.equal((await page.run(prepareComposer)).status, 'ready');
    assert.equal(page.document.activeElement.className, 'ProseMirror');
  } finally { page.close(); }
});

test('existing textarea and rich-text drafts remain untouched', async () => {
  for (const html of ['<textarea id="prompt-textarea">不要覆盖我的草稿</textarea>', '<div id="prompt-textarea" contenteditable="true"><p>不要覆盖</p><p>第二行</p></div>']) {
    const page = fixture(html);
    try {
      assert.equal((await page.run(prepareComposer)).status, 'draft-conflict');
      assert.match(page.document.getElementById('prompt-textarea').textContent, /不要覆盖/);
    } finally { page.close(); }
  }
});

test('login/search pages and hidden or disabled composers cannot receive text', async () => {
  for (const html of [
    '<form><input type="email"><input type="password"><button type="submit">登录</button></form><textarea placeholder="搜索"></textarea>',
    '<textarea id="prompt-textarea" disabled></textarea>',
    '<textarea id="prompt-textarea" readonly></textarea>',
    '<div hidden><textarea id="prompt-textarea"></textarea></div>',
    '<div style="display:none"><textarea id="prompt-textarea"></textarea></div>',
    '<textarea id="prompt-textarea"></textarea><div role="dialog" aria-modal="true">请登录</div>',
  ]) {
    const page = fixture(html);
    try { assert.equal((await page.run(prepareComposer)).status, 'blocked'); }
    finally { page.close(); }
  }
});

test('in-progress generation returns busy and preserves the current composer', async () => {
  const page = fixture('<textarea id="prompt-textarea"></textarea><button data-testid="stop-button">停止生成</button>');
  try { assert.equal((await page.run(prepareComposer)).status, 'busy'); }
  finally { page.close(); }
});

test('host, scheme and exact preparation route must match', async () => {
  const page = fixture('<textarea id="prompt-textarea"></textarea>');
  try {
    assert.equal((await page.run(prepareComposer, { allowedHosts: ['claude.ai'] })).status, 'blocked');
    assert.equal((await page.run(prepareComposer, { expectedUrl: 'https://chatgpt.com/c/other' })).status, 'blocked');
    assert.equal((await page.run(prepareComposer, { expectedUrl: 'http://chatgpt.com/' })).status, 'blocked');
  } finally { page.close(); }
});

test('unsupported Copilot and Mistral pages never fall back to random textareas', async () => {
  for (const [siteId, host] of [['copilot', 'copilot.microsoft.com'], ['mistral', 'chat.mistral.ai']]) {
    const page = fixture('<textarea placeholder="发送消息"></textarea><button>发送</button>', siteId, host);
    try { assert.equal((await page.run(prepareComposer)).status, 'unsupported'); }
    finally { page.close(); }
  }
});

test('specific composer fixtures cover currently adapted official providers', async () => {
  const providers = [
    ['gemini', 'gemini.google.com', '<rich-textarea><div class="ql-editor" contenteditable="true" aria-label="为 Gemini 输入提示"></div></rich-textarea>'],
    ['deepseek', 'chat.deepseek.com', '<textarea placeholder="给 DeepSeek 发送消息"></textarea>'],
    ['doubao', 'www.doubao.com', '<textarea placeholder="发消息或按住空格说话..."></textarea>'],
    ['qwen', 'qwen.ai', '<div class="tiptap" contenteditable="true"><p><br></p></div>'],
    ['kimi', 'www.kimi.com', '<div class="chat-input-editor" contenteditable="true" data-placeholder="尽管问，或做个 Agent 任务..."></div>'],
    ['perplexity', 'www.perplexity.ai', '<textarea placeholder="Ask a follow-up"></textarea>'],
    ['grok', 'grok.com', '<textarea aria-label="Ask Grok anything"></textarea>'],
  ];
  for (const [siteId, host, html] of providers) {
    const page = fixture(html, siteId, host);
    try { assert.equal((await page.run(prepareComposer)).status, 'ready', siteId); }
    finally { page.close(); }
  }
});

test('actual DeepSeek chat textarea named search is allowed only by its dedicated provider prompt', async () => {
  const page = fixture('<textarea name="search" placeholder="给 DeepSeek 发送消息 " class="_27c9245 ds-scroll-area ds-scroll-area--enabled d96f2d2a"></textarea>', 'deepseek', 'chat.deepseek.com');
  try {
    assert.equal((await page.run(prepareComposer)).status, 'ready');
    assert.equal(page.document.activeElement.name, 'search');
  } finally { page.close(); }
  for (const [placeholder, siteId, host] of [['搜索聊天记录', 'deepseek', 'chat.deepseek.com'], ['给 DeepSeek 发送消息 ', 'doubao', 'www.doubao.com']]) {
    const search = fixture(`<textarea name="search" placeholder="${placeholder}"></textarea>`, siteId, host);
    try { assert.equal((await search.run(prepareComposer)).status, 'blocked'); }
    finally { search.close(); }
  }
  const password = fixture('<textarea name="password" placeholder="给 DeepSeek 发送消息 "></textarea>', 'deepseek', 'chat.deepseek.com');
  try { assert.equal((await password.run(prepareComposer)).status, 'blocked'); }
  finally { password.close(); }
});

test('actual unlabeled Doubao tiptap/ProseMirror composer is selected only when unique', async () => {
  const page = fixture('<div class="tiptap ProseMirror" contenteditable="true"></div>', 'doubao', 'www.doubao.com');
  try {
    assert.equal((await page.run(prepareComposer)).status, 'ready');
    assert.equal(page.document.activeElement.className, 'tiptap ProseMirror');
  } finally { page.close(); }
  const ambiguous = fixture('<div class="tiptap ProseMirror" contenteditable="true"></div><div class="tiptap ProseMirror" contenteditable="true"></div>', 'doubao', 'www.doubao.com');
  try { assert.equal((await ambiguous.run(prepareComposer)).status, 'blocked'); }
  finally { ambiguous.close(); }
});

test('clicks an explicit nearby send button then confirms input clearing', async () => {
  const page = fixture('<form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">发送</button><button type="button" aria-label="Search">搜索</button></form><button aria-label="Send">其他工具栏</button>');
  try {
    const composer = page.document.getElementById('prompt-textarea');
    let searchClicks = 0;
    page.document.querySelector('[aria-label="Search"]').addEventListener('click', () => searchClicks++);
    page.document.querySelector('[data-testid="send-button"]').addEventListener('click', () => { composer.value = ''; });
    assert.equal((await page.run(prepareComposer)).status, 'ready');
    composer.value = '第一行\n第二行';
    assert.equal((await page.run(submitComposer, { message: '第一行\n第二行' })).status, 'sent');
    assert.equal(searchClicks, 0);
  } finally { page.close(); }
});

test('rich-text paragraph serialization preserves actual multi-line text', async () => {
  const page = fixture('<section><div id="prompt-textarea" contenteditable="true"><p><br></p></div><button aria-label="Send message"></button></section>');
  try {
    const composer = page.document.getElementById('prompt-textarea');
    assert.equal((await page.run(prepareComposer)).status, 'ready');
    composer.innerHTML = '<p>第一行  两个空格</p><p>第二行</p>';
    page.document.querySelector('button').addEventListener('click', () => { composer.innerHTML = '<p><br></p>'; });
    assert.equal((await page.run(submitComposer, { message: '第一行  两个空格\n第二行' })).status, 'sent');
  } finally { page.close(); }
});

test('never submits when focus, original composer or draft text has changed', async () => {
  for (const change of ['focus', 'replace', 'message']) {
    const page = fixture('<section><textarea id="prompt-textarea"></textarea><button aria-label="Send"></button></section><input id="elsewhere">');
    try {
      let clicks = 0;
      page.document.querySelector('button').addEventListener('click', () => clicks++);
      assert.equal((await page.run(prepareComposer)).status, 'ready');
      const composer = page.document.getElementById('prompt-textarea');
      composer.value = '要发送的消息';
      if (change === 'focus') page.document.getElementById('elsewhere').focus();
      if (change === 'replace') composer.replaceWith(composer.cloneNode());
      if (change === 'message') composer.value = '用户改过的消息';
      assert.equal((await page.run(submitComposer, { message: '要发送的消息' })).status, change === 'message' ? 'draft-conflict' : 'blocked');
      assert.equal(clicks, 0);
    } finally { page.close(); }
  }
});

test('trusted Enter fallback is allowed only for specific provider composers', async () => {
  const page = fixture('<textarea id="prompt-textarea"></textarea><button aria-label="Voice">语音</button>');
  try {
    assert.equal((await page.run(prepareComposer)).status, 'ready');
    page.document.getElementById('prompt-textarea').value = '测试发送';
    assert.equal((await page.run(submitComposer, { message: '测试发送' })).status, 'keyboard-ready');
    page.document.getElementById('prompt-textarea').value = '';
    assert.equal((await page.run(confirmSubmission, { message: '测试发送' })).status, 'sent');
  } finally { page.close(); }

  const fallback = fixture('<div contenteditable="true" aria-label="给 DeepSeek 发送消息"></div><button aria-label="Voice">语音</button>', 'deepseek', 'chat.deepseek.com');
  try {
    assert.equal((await fallback.run(prepareComposer)).status, 'ready');
    fallback.document.querySelector('div').textContent = '测试发送';
    assert.equal((await fallback.run(submitComposer, { message: '测试发送' })).status, 'unsupported');
  } finally { fallback.close(); }
});

test('ambiguous editors and another provider label cannot be selected', async () => {
  for (const [html, siteId, host] of [
    ['<div class="ProseMirror" contenteditable="true"></div><div class="ProseMirror" contenteditable="true"></div>', 'claude', 'claude.ai'],
    ['<textarea aria-label="询问 ChatGPT"></textarea>', 'deepseek', 'chat.deepseek.com'],
  ]) {
    const page = fixture(html, siteId, host);
    try { assert.equal((await page.run(prepareComposer)).status, 'blocked'); }
    finally { page.close(); }
  }
});

test('submission can change same-origin conversation route and is confirmed by a new user message', async () => {
  const page = fixture('<section><textarea id="prompt-textarea"></textarea><button aria-label="Send"></button></section>');
  try {
    assert.equal((await page.run(prepareComposer)).status, 'ready');
    page.document.getElementById('prompt-textarea').value = '你好';
    page.document.querySelector('button').addEventListener('click', () => {
      page.window.history.pushState({}, '', '/c/new-conversation');
      const userMessage = page.document.createElement('div');
      userMessage.dataset.messageAuthorRole = 'user';
      page.document.body.append(userMessage);
    });
    assert.equal((await page.run(submitComposer, { message: '你好' })).status, 'sent');
  } finally { page.close(); }
});

test('click without evidence remains unconfirmed instead of reporting sent', async () => {
  const page = fixture('<section><textarea id="prompt-textarea"></textarea><button aria-label="Send"></button></section>');
  try {
    assert.equal((await page.run(prepareComposer)).status, 'ready');
    page.document.getElementById('prompt-textarea').value = '不会清空';
    assert.equal((await page.run(submitComposer, { message: '不会清空' })).status, 'unconfirmed');
    assert.equal(page.document.getElementById('prompt-textarea').value, '不会清空');
  } finally { page.close(); }
});

test('optimistic input clearing followed by Kimi capacity rejection is not reported sent', async () => {
  const page = fixture('<section><div class="chat-input-editor" contenteditable="true"></div><button aria-label="发送"></button></section>', 'kimi', 'www.kimi.com');
  try {
    const composer = page.document.querySelector('[contenteditable]');
    assert.equal((await page.run(prepareComposer)).status, 'ready');
    composer.textContent = '测试容量限制';
    page.document.querySelector('button').addEventListener('click', () => {
      composer.textContent = '';
      page.window.setTimeout(() => {
        const error = page.document.createElement('div');
        error.className = 'modal-content';
        error.textContent = '和Kimi聊天的人太多了，订阅会员可进入优先队列';
        page.document.body.append(error);
      }, 600);
    });
    assert.equal((await page.run(submitComposer, { message: '测试容量限制' })).status, 'blocked');
    const next = await page.run(prepareComposer);
    assert.equal(next.status, 'blocked');
    assert.match(next.detail, /排队/);
  } finally { page.close(); }
});

test('quota failure alert has priority over an optimistic user-message bubble', async () => {
  const page = fixture('<section><textarea id="prompt-textarea"></textarea><button aria-label="Send"></button></section>');
  try {
    assert.equal((await page.run(prepareComposer)).status, 'ready');
    page.document.getElementById('prompt-textarea').value = '测试配额';
    page.document.querySelector('button').addEventListener('click', () => {
      page.document.body.insertAdjacentHTML('beforeend', '<div data-message-author-role="user"></div><div role="alert">Usage limit reached. Try again later.</div>');
    });
    assert.equal((await page.run(submitComposer, { message: '测试配额' })).status, 'blocked');
  } finally { page.close(); }
});

test('failure checking does not read known conversation message contents', async () => {
  const page = fixture('<textarea id="prompt-textarea"></textarea><div data-message-author-role="assistant"><div role="alert">private response</div></div>');
  try {
    const privateContent = page.document.querySelector('[role="alert"]');
    Object.defineProperty(privateContent, 'textContent', { get() { throw new Error('Conversation text must not be read'); } });
    assert.equal((await page.run(prepareComposer)).status, 'ready');
  } finally { page.close(); }
});
