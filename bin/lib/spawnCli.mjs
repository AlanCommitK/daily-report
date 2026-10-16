// claude CLI 封装。Windows 下经 shell 解析 claude.cmd（参考实现 run-daily.py
// 直接调 claude 在无 .exe 时失败）。shell 模式下 Node 对参数只拼接不转义，含空格
// 的参数会被 cmd 拆分（本机实测），因此手工对含 cmd 元字符的参数加双引号，并以
// 完整命令行字符串形式交给 shell（不带 args 数组，同时避免 DEP0190 弃用告警）。

import { spawnSync } from 'node:child_process'

function quoteWinArg(a) {
  const s = String(a)
  return /[ \t"&|<>^()]/.test(s) ? '"' + s + '"' : s
}

export function runClaude(args, opts = {}) {
  const isWin = process.platform === 'win32'
  const command = isWin ? 'claude ' + args.map(quoteWinArg).join(' ') : 'claude'
  const spawnArgs = isWin ? [] : args
  const r = spawnSync(command, spawnArgs, {
    encoding: 'utf8',
    shell: isWin,
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    timeout: opts.timeout || 600000,
  })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error('claude 退出码 ' + r.status + '\n' + (r.stderr || ''))
  return r.stdout
}
