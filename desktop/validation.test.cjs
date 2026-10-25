const { test } = require('node:test')
const assert = require('node:assert/strict')
const { safeWebsiteUrl, clampBounds } = require('./validation.cjs')

test('website navigation accepts HTTPS and rejects privileged protocols and embedded credentials', () => {
  assert.equal(safeWebsiteUrl('https://claude.ai/'), 'https://claude.ai/')
  for (const url of [
    'javascript:alert(1)',
    'file:///etc/passwd',
    'http://example.com',
    'https://name:secret@example.com',
    'not a url',
  ])
    assert.equal(safeWebsiteUrl(url), null)
})
test('native website bounds stay inside the window after resize', () => {
  assert.deepEqual(clampBounds({ x: -10, y: 20, width: 1400, height: 2000 }, { width: 900, height: 650 }), {
    x: 0,
    y: 20,
    width: 900,
    height: 630,
  })
  assert.deepEqual(clampBounds({ x: 1400, y: 900, width: 300, height: 400 }, { width: 900, height: 650 }), {
    x: 900,
    y: 650,
    width: 0,
    height: 0,
  })
  assert.equal(clampBounds({ x: NaN, y: 0, width: 10, height: 10 }, { width: 900, height: 650 }), null)
})
