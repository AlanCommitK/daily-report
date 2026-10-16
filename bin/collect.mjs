// 素材汇聚：把某天四路素材（工作流水 / git / 文件变更 / 手记）确定性地拼成一个
// 结构化素材包，供 generate.mjs 与 CLI 共同消费。任何一路为空则无该节；模块永不抛异常。

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readLines } from './lib/jsonl.mjs'
import { sectionText } from './lib/notes.mjs'
import { listRepos, dayCommits, dirtyStatus } from './lib/git.mjs'
import { scanDayChanges } from './lib/files.mjs'
import { loadConfig } from './lib/config.mjs'
import { redact } from './lib/redact.mjs'
import { today } from './lib/date.mjs'

// ---------- A. 工作流水 ----------
// 按 turn 分组（无 turn 退回 session），保持 jsonl 追加序；每组列出 prompt/file/reply。
function renderWorklog(rows) {
  const order = []
  const groups = new Map()
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    // kind='note'（add.mjs 手动补录）已在 D 段呈现，不进流水
    if (r.kind !== 'prompt' && r.kind !== 'file' && r.kind !== 'reply') continue
    // 文本可能含换行，压成一行避免破坏 markdown 结构
    const txt = String(r.text || '').replace(/\s*\n+\s*/g, ' ').trim()
    if (!txt) continue
    const k = String(r.turn || r.session || '_')
    if (!groups.has(k)) { groups.set(k, []); order.push(k) }
    groups.get(k).push({ ...r, text: txt })
  }
  const out = []
  for (const k of order) {
    const g = groups.get(k)
    const t0 = String(g[0].ts || '').slice(11, 16)
    const t1 = String(g[g.length - 1].ts || '').slice(11, 16)
    const cwd = String(g[0].cwd || '')
    const name = path.basename(cwd) || cwd || '?'
    const head = ['###', t0 && t1 && t0 !== t1 ? t0 + '–' + t1 : t0, '`' + name + '`']
      .filter(Boolean).join(' ')
    out.push(head)
    for (const r of g) {
      if (r.kind === 'prompt') out.push('- **我要做的**：' + r.text)
      else if (r.kind === 'file') out.push('  - 改动文件（' + String(r.tool || '?') + '）：`' + r.text + '`')
      else if (r.kind === 'reply') out.push('- **结果**：' + r.text)
    }
    out.push('')
  }
  return out.join('\n').trim()
}

// ---------- B. git ----------
// dayCommits 输出 = %h %an %s 提交行 + --name-status 文件行；无提交且无未提交改动返回 ''。
function renderGit(repo, day, now) {
  const log = dayCommits(repo, day, now)
  const dirty = dirtyStatus(repo)
  if (!log && !dirty) return ''
  const out = ['#### `' + repo + '`', '']
  out.push('**当天提交**', '')
  if (log) {
    for (const line of log.split('\n')) {
      const m = line.match(/^([0-9a-f]{7,40})\s+(.+)$/)
      if (m) out.push('- `' + m[1] + '` ' + m[2])
      else if (line.trim()) out.push('  - ' + line.replace(/\t+/g, ' '))
    }
  } else {
    out.push('_无。_')
  }
  out.push('')
  if (dirty) {
    out.push('**未提交的改动**', '')
    out.push('```', dirty, '```')
  }
  return out.join('\n').trim()
}

// ---------- C. 文件变更 ----------
// scanDayChanges 输出 { 绝对路径: [相对文件...] }，截断说明已由扫描模块作为末元素并入。
function renderFiles(groups) {
  const out = []
  for (const [key, rels] of Object.entries(groups || {})) {
    if (!Array.isArray(rels) || rels.length === 0) continue
    out.push('#### `' + key + '`')
    for (const rel of rels) out.push('- ' + rel)
    out.push('')
  }
  return out.join('\n').trim()
}

// ---------- 组装 ----------
export function buildMaterial(day, opts = {}) {
  const dir = opts.worklogDir || ''
  const watchDirs = Array.isArray(opts.watchDirs) ? opts.watchDirs : []
  const maxPerDir = typeof opts.maxFilesPerDir === 'number' ? opts.maxFilesPerDir : 40
  const ignore = Array.isArray(opts.ignore) ? opts.ignore : []
  const now = opts.now instanceof Date ? opts.now : new Date()
  const sections = []
  const meta = { day, cwds: [], hasLog: false, hasNote: false, hasFiles: false }

  // A 流水
  const rows = readLines(dir, day)
  const logBody = renderWorklog(rows)
  if (logBody) sections.push({ title: 'A. Claude Code 工作流水', body: logBody })
  meta.hasLog = !!logBody

  // 今天在哪些目录工作过：从流水里推断，无需用户配置
  const cwds = []
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    const c = typeof r.cwd === 'string' ? r.cwd : ''
    if (c && !cwds.includes(c)) cwds.push(c)
  }
  meta.cwds = cwds

  // B git：watchDirs ∪ 流水 cwd 去重（listRepos 内部去重且吞异常）
  const parts = []
  for (const repo of listRepos([...watchDirs, ...cwds])) {
    const p = renderGit(repo, day, now)
    if (p) parts.push(p)
  }
  if (parts.length) sections.push({ title: 'B. 代码变更（git）', body: parts.join('\n\n') })

  // C 文件变更
  const filesBody = renderFiles(scanDayChanges(watchDirs, day, maxPerDir, ignore, now))
  if (filesBody) sections.push({ title: 'C. 其他文件变更', body: filesBody })
  meta.hasFiles = !!filesBody

  // D 手记（用户手动写入，落盘前再过一遍脱敏）
  const note = sectionText(dir, day)
  if (note) sections.push({ title: 'D. 手动补录（手记）', body: redact(note) })
  meta.hasNote = !!note

  return { sections, meta }
}

// 素材包 → markdown（generate.mjs 与 CLI 共用）：每节 `## 标题\n\n正文`。
export function renderMaterial(m) {
  return (m && m.sections ? m.sections : [])
    .map((s) => '## ' + s.title + '\n\n' + s.body)
    .join('\n\n')
}

// CLI：node bin/collect.mjs [YYYY-MM-DD] [--json]；默认日期为今天，默认输出 markdown。
export async function main() {
  const args = process.argv.slice(2)
  const asJson = args.includes('--json')
  const dayArg = args.find((a) => a !== '--json')
  if (dayArg && !/^\d{4}-\d{2}-\d{2}$/.test(dayArg)) {
    console.error('日期格式应为 YYYY-MM-DD')
    process.exit(2)
  }
  // round-trip 校验（与 run-daily 一致）：日历上不存在的日期（2026-02-30 被 V8 静默
  // 滚动、2026-99-99 为 Invalid Date）一律 exit 2，杜绝 NaN 日期流入
  if (dayArg) {
    const d = new Date(dayArg + 'T12:00:00')
    if (isNaN(d.getTime()) || today(d) !== dayArg) {
      console.error('日期格式应为 YYYY-MM-DD')
      process.exit(2)
    }
  }
  const dir = process.env.WORKLOG_DIR || path.join(process.env.USERPROFILE || process.env.HOME || '', '.worklog')
  const cfg = loadConfig(dir)
  const m = buildMaterial(dayArg || today(new Date()), {
    worklogDir: dir,
    watchDirs: cfg.watch_dirs,
    maxFilesPerDir: cfg.max_files_per_dir,
    ignore: cfg.ignore,
    now: new Date(),
  })
  process.stdout.write((asJson ? JSON.stringify(m, null, 2) : renderMaterial(m)) + '\n')
}

// 直接执行时进 CLI 入口；被 import（测试 / generate.mjs）时不触发。
{
  const argv1 = process.argv[1]
  if (argv1) {
    let a = path.resolve(argv1)
    let b = fileURLToPath(import.meta.url)
    if (process.platform === 'win32') { a = a.toLowerCase(); b = b.toLowerCase() }
    if (a === b) main().catch((e) => { console.error(e.message || e); process.exit(1) })
  }
}
