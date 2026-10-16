import { test } from 'node:test'
import assert from 'node:assert/strict'
import { limit, splitByBlankLines } from '../bin/lib/text.mjs'

test('limit 截断加标记', () => {
  assert.equal(limit('abcdef', 3), 'abc…[截断]')
  assert.equal(limit('abc', 3), 'abc')
  assert.equal(limit('', 3), '')
})
test('limit(null) 返回空串', () => {
  assert.equal(limit(null, 100), '')
})
test('splitByBlankLines 按空行切且不超字节上限', () => {
  const t = ['段落一', '', '段落二', '', '段落三'].join('\n')
  const parts = splitByBlankLines(t, 15)
  assert.ok(parts.length >= 2)
  for (const p of parts) assert.ok(Buffer.byteLength(p, 'utf8') <= 15 || p.indexOf('\n\n') === -1)
  assert.equal(parts.join('\n\n'), t)
})
test('单段超限不切碎', () => {
  const parts = splitByBlankLines('x'.repeat(100), 10)
  assert.equal(parts.length, 1)
  assert.equal(parts[0].length, 100)
})
