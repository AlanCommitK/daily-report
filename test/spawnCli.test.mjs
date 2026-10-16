import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runClaude } from '../bin/lib/spawnCli.mjs'

const isWin = process.platform === 'win32'

// 临时目录放 claude.cmd shim（模拟 npm 生成的真实 shim：node 执行 dump.js、%* 透传），
// PATH 前置注入后调 runClaude，钉住 Windows shell 行为。
function shimDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-shim-'))
  fs.writeFileSync(path.join(dir, 'dump.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)))')
  fs.writeFileSync(path.join(dir, 'claude.cmd'), '@echo off\r\n"' + process.execPath + '" "' + path.join(dir, 'dump.js') + '" %*\r\n')
  return dir
}

test('Windows shell：参数分组正确、含空格不拆分、含 " 或 % 抛错', { skip: !isWin }, () => {
  const dir = shimDir()
  const opts = { env: { PATH: dir + ';' + process.env.PATH } }
  const out = runClaude(['-p', '/daily-report 2026-10-16', '--permission-mode', 'acceptEdits'], opts)
  assert.deepEqual(JSON.parse(out), ['-p', '/daily-report 2026-10-16', '--permission-mode', 'acceptEdits'])
  assert.throws(() => runClaude(['-p', 'say "hi"'], opts), /不支持的特殊字符/)
  assert.throws(() => runClaude(['-p', 'x%USERPROFILE%y'], opts), /不支持的特殊字符/)
})
