// git 数据源：仓库发现、当日提交、未提交改动。
// 所有 git 调用失败一律吞掉返回空串/空数组——素材缺一块不该让日报挂掉。

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { today } from './date.mjs'

function git(repo, ...args) {
  try {
    // stderr 丢弃：非仓库目录等常见情况 git 会向 stderr 打 fatal，不该污染日报输出
    // timeout 兜底：Windows 上凭据助手等 GUI 可能挂起 git，定时任务不能无限等（参考实现 20s）
    return String(execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 })).trim()
  } catch {
    return ''
  }
}

// day 的下一天（锚定中午再 +24h，DST 偏移不会跨天）
function nextDay(day) {
  return today(new Date(new Date(day + 'T12:00:00').getTime() + 86400000))
}

// 在 watchDirs 下（深度 ≤3）找所有含 .git 的目录；跳到工具目录与已找到的仓库
// 内部（避免把 node_modules 里的依赖仓库误当项目），失败静默返回 []
export function listRepos(watchDirs) {
  const out = []
  const seen = new Set()
  const walk = (dir, depth) => {
    if (depth > 3) return
    let st
    try { st = fs.statSync(dir) } catch { return }
    if (!st.isDirectory()) return
    if (fs.existsSync(path.join(dir, '.git'))) {
      const abs = path.resolve(dir)
      if (!seen.has(abs)) { seen.add(abs); out.push(abs) }
      return
    }
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      walk(path.join(dir, e.name), depth + 1)
    }
  }
  for (const wd of Array.isArray(watchDirs) ? watchDirs : []) {
    if (typeof wd === 'string' && wd) walk(wd, 0)
  }
  return out
}

// 该仓库当天（本地时间）作者提交：--since/--until 用无时区的本地时间字符串。
// now 参数仅为与可注入时钟的接口约定一致而接受（until 固定为次日零点，与参考实现一致）
export function dayCommits(repo, day, now = new Date()) {
  const me = git(repo, 'config', 'user.email')
  const args = ['log', '--no-merges',
    '--since=' + day + ' 00:00:00', '--until=' + nextDay(day) + ' 00:00:00',
    '--pretty=format:%h %an %s', '--name-status']
  if (me) args.splice(2, 0, '--author=' + me)
  return git(repo, ...args)
}

// 未提交改动：porcelain 状态 + 未暂存 diff 统计；干净仓库返回空串
export function dirtyStatus(repo) {
  const status = git(repo, 'status', '--porcelain')
  const stat = git(repo, 'diff', '--stat')
  return [status, stat].filter((s) => s !== '').join('\n\n')
}
