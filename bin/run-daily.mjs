// 定时入口：判定最近几天哪些日期要生成日报，逐日生成 → 写 reports/day.md → 投递，
// 每步记一行运行日志。不是只跑"今天"，而是补齐最近几天缺失的日报（参考实现
// run-daily.py：定时任务常错过触发点，第二天跑时昨天日报不能永远缺）。
//
// 判定规则（对齐参考实现 run-daily.py 164-198 行）：
//   - 当天恒生成（下班后又干活，日报要跟上）
//   - 历史日期：素材三无（无流水 / 手记 / 文件变更）→ 跳过；缺报告 → 补生成；
//     素材最新 mtime 比报告新 → 重新生成（手工改过的日报 mtime 更新，不会被覆盖）
//   - 一次最多补 maxCatchup 天（默认 3），从今天往前截取

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { today, dayList, mtimeDay } from './lib/date.mjs'
import { logRun } from './lib/log.mjs'
import { loadConfig } from './lib/config.mjs'
import { generateReport } from './generate.mjs'
import { deliver } from './deliver.mjs'

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

// 与 files.mjs 同语义的轻量扫描：只取 "日期 -> 当天文件变更的最大 mtime"（兜底素材），
// 一次走完 watch_dirs（参考实现的 file_day），供 decideTodo 判定有无工作/素材新旧。
function scanFileDayMtimes(watchDirs, ignore, now, days) {
  const byDay = new Map()
  const patterns = ignore.filter((p) => typeof p === 'string' && p !== '')
    .map((p) => new RegExp(p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')))
  const cutoff = now.getTime()
  const windowStart = new Date(now)
  windowStart.setDate(windowStart.getDate() - (days - 1))
  windowStart.setHours(0, 0, 0, 0)
  const min = windowStart.getTime()
  const walk = (dir) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.') || patterns.some((re) => re.test(e.name))) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) { walk(full); continue }
      let m
      try { m = fs.statSync(full).mtimeMs } catch { continue }
      if (m > cutoff || m < min) continue
      const d = mtimeDay(m)
      if (!byDay.has(d) || byDay.get(d) < m) byDay.set(d, m)
    }
  }
  for (const w of watchDirs) { if (typeof w === 'string' && w) walk(w) }
  return byDay
}

// 纯函数：回看 opts.days（默认 7）天，判定哪些日期要生成。
// 返回 { todo: [新在前，截断至 maxCatchup], skipped: { day: reason } }。
export function decideTodo(opts = {}) {
  const dir = opts.worklogDir || ''
  // now 只接受 Date；字符串日期按本地正午规范化（与 today() 的字符串处理一致）
  const now = opts.now instanceof Date ? opts.now
    : typeof opts.now === 'string' && opts.now ? new Date(opts.now + 'T12:00:00') : new Date()
  const days = typeof opts.days === 'number' && opts.days > 0 ? opts.days : 7
  const maxCatchup = typeof opts.maxCatchup === 'number' && opts.maxCatchup > 0 ? opts.maxCatchup : 3
  const watchDirs = Array.isArray(opts.watchDirs) ? opts.watchDirs : []
  const ignore = Array.isArray(opts.ignore) ? opts.ignore : []
  const anchor = today(now)

  // notes.md 一次读入：某天有 "## YYYY-MM-DD" 节 = 有手记（只开会/只写手记也算有活干）
  let notesText = ''
  let notesMtime = 0
  try {
    const p = path.join(dir, 'notes.md')
    notesText = fs.readFileSync(p, 'utf8')
    notesMtime = fs.statSync(p).mtimeMs
  } catch {}

  const fileDay = scanFileDayMtimes(watchDirs, ignore, now, days)
  const mtime = (f) => { try { return fs.statSync(f).mtimeMs } catch { return 0 } }
  const hasSection = (d) => new RegExp('^##\\s*' + escapeRe(d) + '\\s*$', 'm').test(notesText)

  const todo = []
  const skipped = {}
  for (const d of dayList(now, days)) {
    if (d === anchor) { todo.push(d); continue } // 当天恒生成（即使已有报告）
    const hasLog = fs.existsSync(path.join(dir, d + '.jsonl'))
    const hasNoteFile = fs.existsSync(path.join(dir, d + '.note.md'))
    const hasSec = hasSection(d)
    const hasFiles = fileDay.has(d)
    if (!hasLog && !hasNoteFile && !hasSec && !hasFiles) { skipped[d] = '无素材'; continue }
    const reportPath = path.join(dir, 'reports', d + '.md')
    if (!fs.existsSync(reportPath)) { todo.push(d); continue } // 历史缺报告则补
    // 触发点之后又干了活：素材比日报新 → 重新生成；手工改过的日报 mtime 更新，不会被覆盖
    const newest = Math.max(
      mtime(path.join(dir, d + '.jsonl')),
      mtime(path.join(dir, d + '.note.md')),
      hasSec ? notesMtime : 0,
      fileDay.get(d) || 0)
    if (newest > mtime(reportPath)) todo.push(d)
  }
  todo.sort().reverse() // 新在前（今天第一）
  return { todo: todo.slice(0, maxCatchup), skipped }
}

// 主流程：decideTodo → 逐日 generateReport → 写 reports/day.md → deliver → 每步一行日志。
// opts: { worklogDir, date, dryRun, now, days, maxCatchup, deps:{generateReport, deliver, logRun, loadConfig} }
export async function runDailyMain(opts = {}) {
  const dir = opts.worklogDir || path.join(process.env.USERPROFILE || process.env.HOME || '', '.worklog')
  // now 由 --date（已规范化为 Date）或注入决定；裸字符串一律先转本地正午 Date
  const now = opts.now instanceof Date ? opts.now
    : typeof opts.date === 'string' && opts.date ? new Date(opts.date + 'T12:00:00') : new Date()
  const d = opts.deps || {}
  const deps = {
    generateReport: d.generateReport || generateReport,
    deliver: d.deliver || deliver,
    logRun: d.logRun || logRun,
    loadConfig: d.loadConfig || loadConfig,
  }
  const cfg = deps.loadConfig(dir)
  const { todo } = decideTodo({
    worklogDir: dir, watchDirs: cfg.watch_dirs, ignore: cfg.ignore,
    days: opts.days, maxCatchup: opts.maxCatchup, now,
  })

  if (opts.dryRun) { // 只打印待办：不生成、不写报告、不投递、不记日志
    console.log(todo.length ? '待生成: ' + todo.join(', ') : '没有需要生成的日报')
    return
  }
  if (!todo.length) {
    console.log(deps.logRun(dir, '没有需要生成的日报（最近几天没有工作记录）。', now))
    return
  }

  const say = (msg) => console.log(deps.logRun(dir, msg, now))
  let ok = 0
  for (const day of todo) {
    say('生成 ' + day + ' 的日报…')
    try {
      const { report } = await deps.generateReport(day, { config: cfg, worklogDir: dir, now })
      const reportPath = path.join(dir, 'reports', day + '.md')
      fs.mkdirSync(path.dirname(reportPath), { recursive: true })
      fs.writeFileSync(reportPath, report, 'utf8')
      say('  完成 -> ' + reportPath)
      const r = await deps.deliver(report, reportPath, cfg.deliver, {})
      for (const name of r.ok) say('  投递成功: ' + name)
      for (const f of r.failed) say('  投递失败: ' + f.name + ' — ' + (f.error && f.error.message))
      ok += 1
    } catch (e) {
      say('  失败: ' + ((e && e.message) || e))
    }
  }
  say('本次结束：成功 ' + ok + '/' + todo.length)
}

// CLI：node bin/run-daily.mjs [--date YYYY-MM-DD] [--dry-run]
export async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  let date
  const di = args.indexOf('--date')
  if (di !== -1) date = args[di + 1]
  if (di !== -1 && (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    console.error('日期格式应为 YYYY-MM-DD')
    process.exit(2)
  }
  // --date 字符串必须先规范化为 Date（本地正午）再流入日期函数；裸 'YYYY-MM-DD'
  // 字符串传给 nowIso 会被静默忽略并返回真实时钟
  const now = date ? new Date(date + 'T12:00:00') : new Date()
  // 日历上不存在的日期：V8 对 2026-13-01 返回 Invalid Date，对 2026-02-30 静默滚动为
  // 2026-03-02 —— round-trip 校验两种都拦（判定锚点必须与所给日期一致），杜绝 NaN 日期流入
  if (date && (isNaN(now.getTime()) || today(now) !== date)) {
    console.error('日期格式应为 YYYY-MM-DD')
    process.exit(2)
  }
  const dir = process.env.WORKLOG_DIR || path.join(process.env.USERPROFILE || process.env.HOME || '', '.worklog')
  await runDailyMain({ worklogDir: dir, date, dryRun, now })
}

// 直接执行时进 CLI 入口；被 import（测试 / 其他模块）时不触发。
{
  const argv1 = process.argv[1]
  if (argv1) {
    let a = path.resolve(argv1)
    let b = fileURLToPath(import.meta.url)
    if (process.platform === 'win32') { a = a.toLowerCase(); b = b.toLowerCase() }
    if (a === b) main().catch((e) => { console.error(e.message || e); process.exit(1) })
  }
}
