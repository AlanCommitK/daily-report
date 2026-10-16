// claude CLI 封装。Windows 下经 shell 解析 claude.cmd（参考实现 run-daily.py
// 直接调 claude 在无 .exe 时失败）。shell 模式下 Node 对参数只拼接不转义，含空格
// 的参数会被 cmd 拆分（本机实测），因此手工对含 cmd 元字符的参数加双引号、对无法
// 可靠转义的参数（含 " 或 %）直接抛错，并以完整命令行字符串形式交给 shell（不带
// args 数组，同时避免 DEP0190 弃用告警）。

import { spawnSync } from 'node:child_process'

function quoteWinArg(a) {
  const s = String(a)
  // 含引号的参数 cmd 无法可靠转义（引号会被静默剥除拼接）；%VAR% 即使加引号也会被
  // cmd 先展开。两者都会造成静默篡改且退出码 0，直接拒绝并说明原因。
  if (s.includes('"') || s.includes('%')) {
    throw new Error('claude 参数含不支持的特殊字符（" 或 %）：' + s)
  }
  return /[ \t&|<>^()]/.test(s) ? '"' + s + '"' : s
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
