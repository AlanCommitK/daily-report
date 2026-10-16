// Claude Code hook 采集适配器：读 hook payload（stdin JSON），写 worklog jsonl。
// 三定律与 capture.ps1 一致：
//   1. 绝对静默：不向 stdout 写任何东西（UserPromptSubmit 的 stdout 会被注入模型上下文）。
//   2. 绝不失败：任何异常吞掉，退出码 0。
//   3. 落盘 UTF-8 无 BOM（由 lib/jsonl.mjs 保证）。
// 行为逐条对齐参考实现 hooks/capture.ps1。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nowIso } from '../lib/date.mjs'
import { appendLine } from '../lib/jsonl.mjs'
import { ensureSection } from '../lib/notes.mjs'
import { limit } from '../lib/text.mjs'
import { redact } from '../lib/redact.mjs'

const FILE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit', 'MultiEdit'])

export async function handlePayload(d, opts = {}) {
  try {
    const env = opts.env || {}
    if (env.WORKLOG_SKIP === '1') return
    const doRedact = env.WORKLOG_REDACT !== '0'
    const dir = opts.worklogDir
    const now = opts.now
    const event = d && d.hook_event_name ? String(d.hook_event_name) : ''
    if (!event) return
    const today = nowIso(now).slice(0, 10)
    let turn = ''
    if (d.prompt_id) { turn = String(d.prompt_id); if (turn.length > 8) turn = turn.slice(0, 8) }
    const skipFile = path.join(dir, today + '.skipturns')

    let kind = '', text = '', limitN = 0, tool = null
    if (event === 'UserPromptSubmit') {
      kind = 'prompt'
      limitN = env.WORKLOG_MAX_PROMPT ? Number(env.WORKLOG_MAX_PROMPT) : 1200
      text = String(d.prompt ?? '')
      if (!text) text = String(d.user_input ?? '')
      const trimmed = text.trimStart()
      if (trimmed.startsWith('/daily-report') || trimmed.startsWith('/日报')) {
        // 生成日报本身不是工作。连带这一轮的 file / reply 一起排除。
        if (turn) {
          fs.mkdirSync(dir, { recursive: true })
          fs.appendFileSync(skipFile, turn + '\n', 'utf8')
        }
        return
      }
      // 记事本"今天的页"顺手开好（幂等，只追加一次节标题）。
      ensureSection(dir, today, now)
    } else if (event === 'Stop') {
      kind = 'reply'
      limitN = env.WORKLOG_MAX_REPLY ? Number(env.WORKLOG_MAX_REPLY) : 2000
      text = String(d.last_assistant_message ?? '')
    } else if (event === 'PostToolUse') {
      const tn = String(d.tool_name ?? '')
      if (!FILE_TOOLS.has(tn)) return
      text = String(d.tool_input?.file_path ?? '')
      if (!text) return
      // 写日报/补录文件本身不是工作成果。排除 worklog 目录（大小写不敏感，要求路径分隔符边界）。
      try {
        const full = path.resolve(text)
        const wlFull = path.resolve(dir)
        if (full.toLowerCase().startsWith(wlFull.toLowerCase() + path.sep)) return
      } catch { /* ignore */ }
      kind = 'file'
      limitN = 400
      tool = tn
    } else return

    // 这一轮已被标记为跳过
    if (turn) {
      try {
        const skips = fs.readFileSync(skipFile, 'utf8')
        if (skips.split(/\s+/).includes(turn)) return
      } catch { /* ignore */ }
    }
    text = limit(doRedact ? redact(text) : text, limitN).trim()
    if (!text) return
    let sess = ''
    if (d.session_id) { sess = String(d.session_id); if (sess.length > 8) sess = sess.slice(0, 8) }
    const rec = { ts: nowIso(now), kind, cwd: String(d.cwd ?? ''), session: sess, turn, text }
    if (tool) rec.tool = tool
    appendLine(dir, today, rec)
  } catch { /* 绝不失败 */ }
}

export async function main() {
  try {
    const chunks = []
    for await (const c of process.stdin) chunks.push(c)
    const raw = Buffer.concat(chunks.map((c) => Buffer.isBuffer(c) ? c : Buffer.from(c))).toString('utf8')
    if (!raw.trim()) process.exit(0)
    const d = JSON.parse(raw)
    const dir = process.env.WORKLOG_DIR || path.join(process.env.USERPROFILE || process.env.HOME, '.worklog')
    await handlePayload(d, { worklogDir: dir, env: process.env, now: new Date() })
  } catch { /* ignore */ }
  process.exit(0)
}

// 作为 hook 脚本直接执行时进入 CLI 入口；被 import（测试/后续任务）时不触发。
// Windows 下路径比较不区分大小写（用户手打的路径大小写可能与实际不符）。
{
  const argv1 = process.argv[1]
  if (argv1) {
    let a = path.resolve(argv1)
    let b = fileURLToPath(import.meta.url)
    if (process.platform === 'win32') { a = a.toLowerCase(); b = b.toLowerCase() }
    if (a === b) main()
  }
}
