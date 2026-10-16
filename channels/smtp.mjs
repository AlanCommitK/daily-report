// smtp 渠道：用系统 curl 发邮件（零依赖）。报告先写临时文件再 --upload-file，发完清理。
// 明文直连走 smtps://（默认端口 465）；cfg.starttls 时走 smtp://（默认 587，curl 自动 STARTTLS）。
// 密码只从环境变量读（cfg.password_env 指定变量名）；退出码非 0 抛 stderr。

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TIMEOUT_MS = 30000

export async function send(cfg, reportText, opts = {}) {
  const scheme = cfg.starttls ? 'smtp' : 'smtps'
  const port = cfg.port || (cfg.starttls ? 587 : 465)
  const pass = process.env[cfg.password_env] || ''
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-smtp-'))
  const tmpFile = path.join(dir, 'report.txt')
  try {
    fs.writeFileSync(tmpFile, reportText, 'utf8')
    const args = [
      '--silent', '--show-error',
      '--url', `${scheme}://${cfg.host}:${port}`,
      '--ssl-reqd',
      '--user', `${cfg.user}:${pass}`,
      '--mail-from', cfg.from,
      ...(cfg.to || []).flatMap((t) => ['--mail-rcpt', t]),
      '--upload-file', tmpFile,
    ]
    const spawnImpl = opts.spawn || ((cmd, a) => spawnSync(cmd, a, { encoding: 'utf8', timeout: TIMEOUT_MS }))
    const r = spawnImpl('curl', args)
    if (!r || r.status !== 0) {
      const detail = r && (r.error ? r.error.message : String(r.stderr || '').trim())
      throw new Error('curl 投递失败' + (detail ? '：' + detail : ''))
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
