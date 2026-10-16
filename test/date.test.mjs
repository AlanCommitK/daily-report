import { test } from 'node:test'
import assert from 'node:assert/strict'
import { today, nowIso, dayList, mtimeDay } from '../bin/lib/date.mjs'

test('today 返回本地日期', () => {
  assert.equal(today(new Date(2026, 9, 16, 23, 30)), '2026-10-16')
})
test('nowIso 带时区偏移', () => {
  const s = nowIso(new Date(2026, 9, 16, 9, 5))
  assert.match(s, /^2026-10-16T09:05:00/)
  assert.match(s, /\+08:00|Z/)
})
test('dayList 含今天且从近到远', () => {
  assert.deepEqual(dayList(new Date(2026, 9, 16), 3), ['2026-10-16', '2026-10-15', '2026-10-14'])
})
test('mtimeDay 按本地时区归日', () => {
  const ms = new Date(2026, 9, 16, 0, 30).getTime()
  assert.equal(mtimeDay(ms), '2026-10-16')
})
