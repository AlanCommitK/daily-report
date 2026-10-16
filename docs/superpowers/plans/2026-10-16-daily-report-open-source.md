# daily-report 开源化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把本机散装的日报系统（`~/.claude/skills/daily-report/`）重写为通用、零 npm 依赖的 Node 脚本软件（采集适配器/生成器/投递渠道三层扩展点），并带 Claude Code 插件薄壳，可开源分发。

**Architecture:** Node 18+ ESM 单仓库。bin/lib 提供数据与工具模块；bin/capture 采集适配器（内置 claude-code）；bin/collect 汇聚素材；bin/generate 经 llm 客户端（OpenAI/Anthropic 兼容双协议）或 claude CLI 生成日报；bin/deliver 经 channels 四渠道投递；bin/run-daily 定时入口；bin/setup 交互安装；skills/+hooks/+.claude-plugin 为 Claude Code 接入层。

**Tech Stack:** Node.js ≥18（无 npm 依赖；内置 fetch / node:test / node:readline / child_process；SMTP 走系统 curl；Windows 计划任务走 schtasks，macOS/Linux 走 crontab）。

**Spec:** `docs/superpowers/specs/2026-10-16-daily-report-open-source-design.md`（v2，已含 §3.2/§3.3 的"生成器同等可选、适配器指南首发交付"修订）

## Global Constraints

- Node ≥ 18；**零 npm 依赖**（禁止 `npm install`，测试只用 `node:test`）
- 所有 Node 文件为 ESM（`"type":"module"`），Windows 路径统一 `path` 模块处理
- 数据目录默认 `~/.worklog/`（`WORKLOG_DIR` 环境变量可覆盖）；所有日期函数必须支持注入 `now`（`YYYY-MM-DD` 或 Date）或 `--date` 参数，测试固定日期、不依赖真实时钟
- worklog 数据格式与现版本兼容：jsonl 行 `{"ts","kind","cwd","session","turn","text","tool"?}`；notes.md 节 `## YYYY-MM-DD`；报告 `reports/YYYY-MM-DD.md`；run.log 行 `[YYYY-MM-DD HH:MM:SS] 消息`
- 采集 hook 三约束：绝对静默（stdout 无输出）、绝不失败（任何异常吞掉、exit 0）、UTF-8 无 BOM
- 密钥只从环境变量读（`api_key_env`/`password_env`），config 无明文密钥
- 提交信息用中文（与仓库内其他项目一致），每个任务末 commit；**不 push**（用户要求时再 push）
- 本计划在 `C:\Users\Yml888\WorkD\daily-report\`（即仓库根）下执行；参考实现源码在 `C:\Users\Yml888\.claude\skills\daily-report\`（capture.ps1 / run-daily.py / collect.py / deliver.py），行为以 spec 为准、细节对齐参考实现

---

### Task 1: 仓库骨架

**Files:**
- Create: `package.json`、`.gitignore`、`LICENSE`、`config.example.json`、`test/fixtures/.gitkeep`

**Interfaces:**
- Produces: 仓库根可 `git init`；`node --test` 可运行（此时无测试，应报"no tests"而非报错）

- [ ] **Step 1: 初始化仓库**

```bash
cd /c/Users/Yml888/WorkD/daily-report
git init -b main
```

- [ ] **Step 2: 写 package.json**

```json
{
  "name": "daily-report",
  "version": "0.1.0",
  "private": false,
  "type": "module",
  "engines": { "node": ">=18" },
  "scripts": { "test": "node --test test/" },
  "license": "MIT"
}
```

- [ ] **Step 3: 写 .gitignore**

```
node_modules/
*.log
.bak-*
config.json
.worklog/
.DS_Store
```

- [ ] **Step 4: 写 LICENSE（MIT）**

MIT License，版权行 `Copyright (c) 2026 daily-report contributors`（保留一整年数字，模板其余部分为 MIT 标准全文）。

- [ ] **Step 5: 写 config.example.json（占位示例，无真实密钥/路径）**

```json
{
  "_说明": "复制本文件为 config.json 放入数据目录（默认 ~/.worklog/）。所有密钥通过环境变量提供。",
  "watch_dirs": ["C:/Users/yourname/work"],
  "ignore": [".git", "node_modules", "__pycache__", ".venv", "dist", "build"],
  "max_files_per_dir": 40,
  "generator": {
    "type": "api",
    "protocol": "openai",
    "base_url": "https://api.deepseek.com/v1",
    "api_key_env": "DAILY_REPORT_API_KEY",
    "model": "deepseek-chat"
  },
  "claude_args": [],
  "deliver": [
    { "type": "copy", "to": "D:/日报存档" }
  ]
}
```

- [ ] **Step 6: 验证 + commit**

```bash
node --test test/   # 期望：输出 "no tests found" 类提示，退出码 0
git add -A && git commit -m "chore: 仓库骨架（package.json/.gitignore/LICENSE/config 示例）"
```

---

### Task 2: lib 基础模块（date / jsonl / notes / text）

**Files:**
- Create: `bin/lib/date.mjs`、`bin/lib/jsonl.mjs`、`bin/lib/notes.mjs`、`bin/lib/text.mjs`
- Test: `test/date.test.mjs`、`test/jsonl.test.mjs`、`test/notes.test.mjs`、`test/text.test.mjs`

**Interfaces:**
- Produces:
  - `date.mjs`: `export function today(now)` → `'YYYY-MM-DD'` 本地时区；`export function nowIso(now)` → `'YYYY-MM-DDTHH:mm:ss+08:00'`（带时区偏移）；`export function dayList(now, days)` → 近 days 天的 `'YYYY-MM-DD'` 数组（含今天，从近到远）；`export function mtimeDay(mtimeMs)` → mtime 对应的本地日期字符串
  - `jsonl.mjs`: `export function appendLine(dir, day, obj)` → 向 `dir/day.jsonl` 追加一行 JSON（UTF-8 无 BOM，自动建目录，异常吞掉返回 false）；`export function readLines(dir, day)` → 行对象数组（不存在/解析失败返回 []）
  - `notes.mjs`: `export function ensureSection(dir, day, now)` → notes.md 无 `## day` 节则追加（幂等）；`export function appendNote(dir, text, now)` → 当天节下追加 `- text` 行；`export function sectionText(dir, day)` → 该节正文（无则 ''）
  - `text.mjs`: `export function limit(t, n)` → 超长截断加 `…[截断]`；`export function splitByBlankLines(t, maxBytes)` → 按空行边界切分，每段 UTF-8 字节数 ≤ maxBytes，段落大于 maxBytes 时不切碎整段保留

- [ ] **Step 1: 写失败测试（四个文件）**

`test/date.test.mjs`：

```js
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
```

`test/text.test.mjs`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { limit, splitByBlankLines } from '../bin/lib/text.mjs'

test('limit 截断加标记', () => {
  assert.equal(limit('abcdef', 3), 'abc…[截断]')
  assert.equal(limit('abc', 3), 'abc')
  assert.equal(limit('', 3), '')
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
```

`test/jsonl.test.mjs`（用 `fs.mkdtempSync(os.tmpdir())` 临时目录，测试后 `fs.rmSync` 清理）：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendLine, readLines } from '../bin/lib/jsonl.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('appendLine 写 UTF-8 无 BOM 且可读回', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  appendLine(dir, '2026-10-16', { ts: '2026-10-16T09:00:00+08:00', kind: 'prompt', text: '你好' })
  const raw = fs.readFileSync(path.join(dir, '2026-10-16.jsonl'))
  assert.ok(!raw.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), '无 BOM')
  const lines = readLines(dir, '2026-10-16')
  assert.equal(lines.length, 1)
  assert.equal(lines[0].text, '你好')
  fs.rmSync(dir, { recursive: true, force: true })
})
test('readLines 文件不存在返回空数组', () => {
  assert.deepEqual(readLines(os.tmpdir(), '1999-01-01'), [])
})
```

`test/notes.test.mjs`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ensureSection, appendNote, sectionText } from '../bin/lib/notes.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('ensureSection 幂等追加节标题', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  ensureSection(dir, '2026-10-16')
  ensureSection(dir, '2026-10-16')
  const raw = fs.readFileSync(path.join(dir, 'notes.md'), 'utf8')
  assert.equal(raw.split('## 2026-10-16').length - 1, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})
test('appendNote 加一行手记', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  appendNote(dir, '上午开会', new Date(2026, 9, 16, 10, 0))
  assert.equal(sectionText(dir, '2026-10-16').trim(), '- 上午开会')
  fs.rmSync(dir, { recursive: true, force: true })
})
```

- [ ] **Step 2: 跑测试确认失败**（`node --test test/`，应报"找不到模块"）
- [ ] **Step 3: 实现四个模块**

`bin/lib/date.mjs` 关键实现：

```js
export function today(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now + 'T12:00:00')
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
export function nowIso(now = new Date()) {
  const d = now instanceof Date ? now : new Date()
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  const tz = sign + String(Math.floor(abs / 60)).padStart(2, '0') + ':' + String(abs % 60).padStart(2, '0')
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${tz}`
}
export function dayList(now = new Date(), days) {
  const out = []
  for (let i = 0; i < days; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    out.push(today(d))
  }
  return out
}
export function mtimeDay(ms) { return today(new Date(ms)) }
```

`bin/lib/jsonl.mjs` 关键实现（UTF-8 无 BOM 用 `new TextEncoder().encode` 经 `fs.appendFileSync` 写入 Buffer；全部 try/catch 吞异常）：

```js
import fs from 'node:fs'
import path from 'node:path'
export function appendLine(dir, day, obj) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const line = JSON.stringify(obj) + '\n'
    fs.appendFileSync(path.join(dir, day + '.jsonl'), new TextEncoder().encode(line))
    return true
  } catch { return false }
}
export function readLines(dir, day) {
  try {
    const raw = fs.readFileSync(path.join(dir, day + '.jsonl'), 'utf8')
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l))
  } catch { return [] }
}
```

`bin/lib/notes.mjs` 关键实现：`ensureSection` 读 notes.md（不存在为空串），`(?m)^##\s*day\s*$` 正则不匹配则末尾补换行后追加 `## day\n`；`appendNote` 先 ensureSection 再在文件尾追加 `- text\n`（当日节永远是最后一节时成立；若节后已有其他内容，改为定位到节末尾插入——实现时按"定位插入"写，测试用例再补一条：先写两天手记再补第一天，验证插入位置正确）；`sectionText` 用正则截取节到下一节之间。

`bin/lib/text.mjs` 关键实现：

```js
export function limit(t, n) {
  if (t == null) return ''
  if (t.length <= n) return t
  return t.slice(0, n) + '\u2026[截断]'
}
export function splitByBlankLines(t, maxBytes) {
  const paras = t.split(/\n{2,}/)
  const parts = []
  let cur = ''
  for (const p of paras) {
    const cand = cur ? cur + '\n\n' + p : p
    if (Buffer.byteLength(cand, 'utf8') <= maxBytes || !cur) { cur = cand; continue }
    parts.push(cur); cur = p
  }
  if (cur) parts.push(cur)
  return parts
}
```

- [ ] **Step 4: 跑测试确认通过**（`node --test test/`，全绿；若 notes 插入位置测试新增，一并通过）
- [ ] **Step 5: commit** `git add -A && git commit -m "feat: lib 基础模块（日期/流水行/手记/文本工具）"`

---

### Task 3: lib/redact 脱敏模块

**Files:**
- Create: `bin/lib/redact.mjs`
- Test: `test/redact.test.mjs`

**Interfaces:**
- Produces: `export function redact(t)` → 脱敏后字符串（null/空 原样返回）

- [ ] **Step 1: 写失败测试（脱敏规则逐条，规则与参考实现 capture.ps1 一致）**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redact } from '../bin/lib/redact.mjs'

test('sk- API key', () => {
  assert.equal(redact('key=sk-abcdefghijklmnopqrstuvwxyz123456'), 'key=<REDACTED:api-key>')
})
test('github token 三种前缀', () => {
  assert.equal(redact('ghp_abcdefghijklmnopqrstuvwxyz123456'), '<REDACTED:gh-token>')
  assert.equal(redact('github_pat_abcdefghijklmnopqrstuvwxyz123456'), '<REDACTED:gh-token>')
})
test('slack token', () => {
  assert.equal(redact('xoxb-1234567890-abcdefghij'), '<REDACTED:slack-token>')
})
test('aws key', () => {
  assert.equal(redact('AKIAIOSFODNN7EXAMPLE'), '<REDACTED:aws-key>')
})
test('jwt', () => {
  assert.equal(redact('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'), '<REDACTED:jwt>')
})
test('private key 块', () => {
  assert.equal(redact('-----BEGIN RSA PRIVATE KEY-----'), '<REDACTED:private-key>')
})
test('键值对通用规则', () => {
  assert.equal(redact('password: hunter2secret'), 'password=<REDACTED>')
  assert.equal(redact('API_KEY="abcdefg"'), 'API_KEY=<REDACTED>')
})
test('普通文本不误伤', () => {
  const t = '今天写了登录模块，修了 bug，提交了 3 次'
  assert.equal(redact(t), t)
})
```

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**（正则与 capture.ps1 第 50-59 行一致，顺序一致；键值对规则注意 `password: hunter2secret` 只把值替换掉、键保留 + `=<REDACTED>`）

```js
const RULES = [
  [/sk-[A-Za-z0-9_\-]{20,}/g, '<REDACTED:api-key>'],
  [/\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}/g, '<REDACTED:gh-token>'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '<REDACTED:gh-token>'],
  [/\bxox[baprs]-[A-Za-z0-9\-]{10,}/g, '<REDACTED:slack-token>'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '<REDACTED:aws-key>'],
  [/\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g, '<REDACTED:jwt>'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, '<REDACTED:private-key>'],
  [/(?i)\b(pass(?:word|wd)?|pwd|secret|token|api[_\-]?key|access[_\-]?key)\s*[:=]\s*["']?([^\s"',;]{6,})/g, '$1=<REDACTED>'],
]
export function redact(t) {
  if (t == null) return t
  let out = t
  for (const [re, rep] of RULES) out = out.replace(re, rep)
  return out
}
```

- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: commit** `git add -A && git commit -m "feat: 脱敏模块（8 条规则与参考实现一致）"`

---

### Task 4: 采集适配器 claude-code.mjs

**Files:**
- Create: `bin/capture/claude-code.mjs`
- Test: `test/capture.test.mjs`

**Interfaces:**
- Consumes: `bin/lib/date.mjs`（nowIso）、`bin/lib/jsonl.mjs`（appendLine/readLines）、`bin/lib/notes.mjs`（ensureSection）、`bin/lib/text.mjs`（limit）、`bin/lib/redact.mjs`（redact）
- Produces: `export async function handlePayload(payload, opts)` → opts 含 `{ worklogDir, env: {WORKLOG_SKIP, WORKLOG_REDACT, WORKLOG_MAX_PROMPT, WORKLOG_MAX_REPLY}, now }`，无返回值（副作用写 jsonl/notes/skipturns）；`export async function main()` → 读 stdin 解析 JSON 后调 handlePayload，任何异常 exit 0（CLI 入口）

- [ ] **Step 1: 写失败测试**（构造 hook payload，不依赖真实 stdin；临时目录做 worklogDir；事件行为对齐 capture.ps1）

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handlePayload } from '../bin/capture/claude-code.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const NOW = new Date(2026, 9, 16, 9, 0)
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  return { dir, opts: { worklogDir: dir, env: {}, now: NOW } }
}
function lines(dir) {
  try { return fs.readFileSync(path.join(dir, '2026-10-16.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse) } catch { return [] }
}

test('UserPromptSubmit 记 prompt 并开 notes 节', () => {
  const { dir, opts } = setup()
  handlePayload({ hook_event_name: 'UserPromptSubmit', prompt: '写一个登录模块', prompt_id: 'abcdefgh1234', session_id: 'sess12345678', cwd: 'C:/work' }, opts)
  const ls = lines(dir)
  assert.equal(ls.length, 1)
  assert.equal(ls[0].kind, 'prompt')
  assert.equal(ls[0].turn, 'abcdefgh')
  assert.equal(ls[0].session, 'sess1234')
  assert.ok(fs.readFileSync(path.join(dir, 'notes.md'), 'utf8').includes('## 2026-10-16'))
})

test('/daily-report 轮次进 skipturns，后续 file 被跳过', () => {
  const { dir, opts } = setup()
  handlePayload({ hook_event_name: 'UserPromptSubmit', prompt: '/daily-report', prompt_id: 'skipme1234', session_id: 's1', cwd: 'C:/work' }, opts)
  handlePayload({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: 'C:/work/a.md' }, prompt_id: 'skipme1234', session_id: 's1', cwd: 'C:/work' }, opts)
  const skips = fs.readFileSync(path.join(dir, '2026-10-16.skipturns'), 'utf8')
  assert.ok(skips.includes('skipme1'))
  assert.equal(lines(dir).length, 0)
})

test('PostToolUse 仅四类写工具且排除 worklog 目录', () => {
  const { dir, opts } = setup()
  handlePayload({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: 'C:/work/b.md' }, prompt_id: 'p1', session_id: 's1', cwd: 'C:/work' }, opts)
  handlePayload({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, prompt_id: 'p1', session_id: 's1', cwd: 'C:/work' }, opts)
  handlePayload({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(opts.worklogDir, 'x.md') }, prompt_id: 'p1', session_id: 's1', cwd: 'C:/work' }, opts)
  const ls = lines(dir)
  assert.equal(ls.length, 1)
  assert.equal(ls[0].kind, 'file')
  assert.equal(ls[0].tool, 'Write')
})

test('Stop 记 reply 且截断', () => {
  const { dir, opts } = setup()
  const long = 'x'.repeat(3000)
  handlePayload({ hook_event_name: 'Stop', last_assistant_message: long, prompt_id: 'p2', session_id: 's1', cwd: 'C:/work' }, opts)
  const ls = lines(dir)
  assert.equal(ls[0].kind, 'reply')
  assert.ok(ls[0].text.length <= 2000 + 10)
})

test('WORKLOG_SKIP=1 时静默跳过', () => {
  const { dir, opts } = setup()
  opts.env.WORKLOG_SKIP = '1'
  handlePayload({ hook_event_name: 'UserPromptSubmit', prompt: 'hi', prompt_id: 'p3', session_id: 's1', cwd: 'C:/work' }, opts)
  assert.equal(lines(dir).length, 0)
})

test('异常载荷不抛出（绝不失败）', () => {
  const { dir, opts } = setup()
  handlePayload({ hook_event_name: 'UnknownEvent' }, opts)
  handlePayload(null, opts)
  assert.equal(lines(dir).length, 0)
})
```

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**（行为逐条对齐 capture.ps1：事件分发、prompt 取 `d.prompt || d.user_input`、`/daily-report` 与 `/日报` 开头进 skipturns、notes 节顺手开、PostToolUse 四类工具 + worklog 目录排除、脱敏、截断、env 阈值，全链路 try/catch）

`bin/capture/claude-code.mjs` 骨架：

```js
import fs from 'node:fs'
import path from 'node:path'
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
        if (turn) {
          fs.mkdirSync(dir, { recursive: true })
          fs.appendFileSync(skipFile, turn + '\n', 'utf8')
        }
        return
      }
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
      try {
        const full = path.resolve(text)
        const wlFull = path.resolve(dir)
        if (full.toLowerCase().startsWith(wlFull.toLowerCase() + path.sep)) return
      } catch { /* ignore */ }
      kind = 'file'
      limitN = 400
      tool = tn
    } else return

    if (turn) {
      try {
        const skips = fs.readFileSync(skipFile, 'utf8')
        if (skips.split(/\s+/).includes(turn)) return
      } catch { /* ignore */ }
    }
    text = limit(redact(text), limitN).trim()
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
```

- [ ] **Step 4: 跑测试确认通过**（若 skipturns 前缀断言与实现截断长度不一致，以测试为准调整断言语）
- [ ] **Step 5: commit** `git add -A && git commit -m "feat: Claude Code 采集适配器（三事件 + 脱敏 + 跳过轮次）"`

---

### Task 5: lib 数据源（config / git / files）

**Files:**
- Create: `bin/lib/config.mjs`、`bin/lib/git.mjs`、`bin/lib/files.mjs`
- Test: `test/config.test.mjs`、`test/git.test.mjs`、`test/files.test.mjs`

**Interfaces:**
- Produces:
  - `config.mjs`: `export function loadConfig(dir)` → 读 `dir/config.json`，缺文件返回 `{watch_dirs:[], ignore:[...默认], max_files_per_dir:40, generator:null, claude_args:[], deliver:[]}`；坏 JSON 返回同默认并 console.error 一行；`export const DEFAULT_IGNORE`
  - `git.mjs`: `export function listRepos(watchDirs)` → 在 watchDirs 下（depth≤3）找到所有含 `.git` 的目录；`export function dayCommits(repo, day, now = new Date())` → 该仓库当天作者提交（`git log --since=<day> 00:00 --until=<day+1> 00:00 --pretty=format:%h %s --name-status`）；`export function dirtyStatus(repo)` → `git status --porcelain` + `git diff --stat`（未提交改动），异常返回空
  - `files.mjs`: `export function scanDayChanges(watchDirs, day, maxPerDir, ignore, now)` → `{ [repoOrDir]: [文件路径...] }` 按目录聚合当天 mtime 的文件（排除 ignore 模式与 .git 目录）
- Consumes: `bin/lib/date.mjs`（today/mtimeDay）

- [ ] **Step 1: 写失败测试**

`test/config.test.mjs`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig, DEFAULT_IGNORE } from '../bin/lib/config.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('缺文件返回默认配置', () => {
  const cfg = loadConfig(fs.mkdtempSync(path.join(os.tmpdir(), 'dr-')))
  assert.deepEqual(cfg.watch_dirs, [])
  assert.ok(cfg.ignore.length > 0)
  assert.equal(cfg.max_files_per_dir, 40)
  assert.equal(cfg.generator, null)
})
test('坏 JSON 返回默认', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  fs.writeFileSync(path.join(d, 'config.json'), '{ bad')
  assert.equal(loadConfig(d).generator, null)
})
test('正常配置合并默认值', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ watch_dirs: ['C:/w'], generator: { type: 'api', protocol: 'openai', base_url: 'http://x', api_key_env: 'K', model: 'm' } }))
  const cfg = loadConfig(d)
  assert.equal(cfg.watch_dirs[0], 'C:/w')
  assert.equal(cfg.generator.model, 'm')
  assert.equal(cfg.max_files_per_dir, 40)
})
```

`test/git.test.mjs`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listRepos, dayCommits, dirtyStatus } from '../bin/lib/git.mjs'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function initRepo(dir, name) {
  const repo = path.join(dir, name)
  fs.mkdirSync(repo, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: repo })
  execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 'tester'], { cwd: repo })
  return repo
}
const envD = (day) => ({ ...process.env, GIT_AUTHOR_DATE: day + 'T10:00:00', GIT_COMMITTER_DATE: day + 'T10:00:00' })

test('listRepos 找到子目录仓库', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  initRepo(d, 'proj')
  assert.ok(listRepos([d]).some((r) => r.endsWith('proj')))
})
test('dayCommits 只取指定日提交', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const repo = initRepo(d, 'proj')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'v1')
  execFileSync('git', ['add', '-A'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'day one'], { cwd: repo, env: envD('2026-10-14') })
  fs.writeFileSync(path.join(repo, 'a.txt'), 'v2')
  execFileSync('git', ['add', '-A'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'day two'], { cwd: repo, env: envD('2026-10-15') })
  const c14 = dayCommits(repo, '2026-10-14')
  const c15 = dayCommits(repo, '2026-10-15')
  assert.ok(c14.includes('day one'))
  assert.ok(!c14.includes('day two'))
  assert.ok(c15.includes('day two'))
})
test('dirtyStatus 检出未提交改动，干净时为空串', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const repo = initRepo(d, 'proj')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'v1')
  execFileSync('git', ['add', '-A'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo, env: envD('2026-10-01') })
  fs.writeFileSync(path.join(repo, 'a.txt'), 'dirty')
  assert.ok(dirtyStatus(repo).length > 0)
  execFileSync('git', ['checkout', '--', '.'], { cwd: repo })
  assert.equal(dirtyStatus(repo), '')
})
```

`test/files.test.mjs`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanDayChanges } from '../bin/lib/files.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('只聚合当天 mtime 的文件并排除 ignore 目录', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const proj = path.join(d, 'proj')
  fs.mkdirSync(path.join(proj, 'node_modules'), { recursive: true })
  fs.writeFileSync(path.join(proj, 'today.txt'), 'x')
  fs.writeFileSync(path.join(proj, 'old.txt'), 'x')
  fs.writeFileSync(path.join(proj, 'node_modules', 'pkg.js'), 'x')
  const nowSec = new Date(2026, 9, 16, 12, 0).getTime() / 1000
  fs.utimesSync(path.join(proj, 'today.txt'), nowSec, nowSec)
  fs.utimesSync(path.join(proj, 'node_modules', 'pkg.js'), nowSec, nowSec)
  const oldSec = new Date(2026, 8, 1).getTime() / 1000
  fs.utimesSync(path.join(proj, 'old.txt'), oldSec, oldSec)
  const out = scanDayChanges([d], '2026-10-16', 40, ['node_modules'], new Date(2026, 9, 16, 18, 0))
  const files = Object.values(out).flat()
  assert.ok(files.some((f) => f.endsWith('today.txt')))
  assert.ok(!files.some((f) => f.endsWith('old.txt')))
  assert.ok(!files.some((f) => f.endsWith('pkg.js')))
})
```

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**

`git.mjs` 用 `child_process.execFileSync('git', [...], {cwd: repo, encoding:'utf8'})` 全 try/catch 吞异常；`dayCommits` 的 since/until 用 `day 00:00:00` 本地时间字符串，`--format` 输出行含 `%h %an %s`；`files.mjs` 用 `fs.readdirSync(dir, {withFileTypes:true})` 递归，匹配 ignore 用简单通配（`*` 展开正则）；`config.mjs` 对 `generator` 做类型校验（缺失时报错提示跑 setup）。

- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: commit** `git add -A && git commit -m "feat: 数据源模块（配置/git/文件扫描）"`

---

### Task 6: collect.mjs 素材汇聚

**Files:**
- Create: `bin/collect.mjs`
- Test: `test/collect.test.mjs`

**Interfaces:**
- Consumes: Task 2（jsonl/notes/date）、Task 5（config/git/files）
- Produces: `export function buildMaterial(day, opts)` → `{ sections: [{title, body}], meta: {day, cwds, hasLog, hasNote, hasFiles} }`，opts 含 `{worklogDir, watchDirs, maxFilesPerDir, ignore, now}`；`export function renderMaterial(m)` → markdown 字符串（每节 `## 标题\n\n正文`，供 generate.mjs 与 CLI 共用）；`export async function main()` → CLI：`node bin/collect.mjs <day>` 输出 `renderMaterial(buildMaterial(...))` 到 stdout（`--json` 时输出 buildMaterial 结果的 JSON）

- [ ] **Step 1: 写失败测试**（临时目录构造：worklog jsonl 两行、notes 节、watchDirs 下临时 git 仓库含指定日提交 + 未提交改动 + 当天 mtime 文件；断言四节齐全、git 节含提交 hash、文件节聚合目录、`meta.hasLog` 等正确；再测空素材日）

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMaterial, renderMaterial } from '../bin/collect.mjs'
import { appendLine } from '../bin/lib/jsonl.mjs'
import { appendNote } from '../bin/lib/notes.mjs'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function fixtureWithAllSources() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const work = path.join(dir, 'work')
  fs.mkdirSync(path.join(work, 'proj'), { recursive: true })
  const repo = path.join(work, 'proj')
  execFileSync('git', ['init', '-q'], { cwd: repo })
  execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 'tester'], { cwd: repo })
  fs.writeFileSync(path.join(repo, 'a.txt'), 'v1')
  const env = { ...process.env, GIT_AUTHOR_DATE: '2026-10-15T10:00:00', GIT_COMMITTER_DATE: '2026-10-15T10:00:00' }
  execFileSync('git', ['add', '-A'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'fix: login'], { cwd: repo, env })
  appendLine(dir, '2026-10-15', { ts: '2026-10-15T09:00:00+08:00', kind: 'prompt', cwd: repo, session: 's1', turn: 't1', text: '写登录模块' })
  appendNote(dir, '上午开会', new Date(2026, 9, 15, 10, 0))
  fs.writeFileSync(path.join(repo, 'b.txt'), 'x')
  const nowSec = new Date(2026, 9, 15, 14, 0).getTime() / 1000
  fs.utimesSync(path.join(repo, 'b.txt'), nowSec, nowSec)
  return { dir, work }
}

test('四路素材齐全', () => {
  const { dir, work } = fixtureWithAllSources()
  const m = buildMaterial('2026-10-15', { worklogDir: dir, watchDirs: [work], maxFilesPerDir: 40, ignore: [], now: new Date(2026, 9, 16, 18, 0) })
  const titles = m.sections.map((s) => s.title).join(' ')
  assert.ok(titles.includes('流水'))
  assert.ok(titles.includes('git'))
  assert.ok(titles.includes('文件'))
  assert.ok(titles.includes('手记'))
  assert.ok(m.meta.hasLog && m.meta.hasNote && m.meta.hasFiles)
  const markdown = renderMaterial(m)
  assert.ok(markdown.includes('fix: login'))
  assert.ok(markdown.includes('写登录模块'))
})
test('空素材日各标记为 false', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const m = buildMaterial('2026-10-01', { worklogDir: dir, watchDirs: [], maxFilesPerDir: 40, ignore: [], now: new Date(2026, 9, 16, 18, 0) })
  assert.ok(!m.meta.hasLog && !m.meta.hasNote && !m.meta.hasFiles)
  assert.equal(m.sections.length, 0)
})
```

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**（四路：A 流水读 jsonl 按 turn 分组列出 prompt/file/reply；B git 遍历 `listRepos(watchDirs ∪ 流水 cwd 去重)` 的 dayCommits+dirtyStatus；C `scanDayChanges`；D `sectionText` 手记；任何一路为空则无该节；`meta.cwds` 收集 jsonl 的 cwd 去重；文件节按目录聚合、每目录 ≤max_files_per_dir 条并注明截断）
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: commit** `git add -A && git commit -m "feat: 素材汇聚 collect（四路素材 + 元信息）"`

---

### Task 7: lib/llm + generate.mjs 生成器

**Files:**
- Create: `bin/lib/llm.mjs`、`bin/generate.mjs`
- Test: `test/generate.test.mjs`

**Interfaces:**
- Consumes: `bin/lib/config.mjs`、Task 6 `buildMaterial`、`prompts/report.md`（本任务先建该文件，Task 13 只做引用）
- Produces:
  - `llm.mjs`: `export const PROVIDERS`（预设表：`{deepseek: {openai: 'https://api.deepseek.com/v1', anthropic: 'https://api.deepseek.com/anthropic'}, openai: {openai: 'https://api.openai.com/v1'}, anthropic: {anthropic: 'https://api.anthropic.com'}, qwen: {openai: 'https://dashscope.aliyuncs.com/compatible-mode/v1'}, glm: {openai: 'https://open.bigmodel.cn/api/paas/v4'}}`）；`export async function chat(cfg, system, user, opts = {})` → 按 `cfg.protocol` 发请求返回文本；失败重试 2 次（间隔默认 2s/4s，`opts.retryDelays` 可注入），全败抛错；`opts.fetchImpl` 默认 `globalThis.fetch`（测试注入 mock）
  - `generate.mjs`: `export async function generateReport(day, opts)` → `{report, generatorType}`，opts 含 `{config, worklogDir, now, fetchImpl, retryDelays}`：generator.type='api' 时读 `prompts/report.md` 作 system、`renderMaterial(buildMaterial(...))` 作 user，调 `chat`；type='claude-cli' 时 spawn `claude -p "/daily-report <day>"`（配置 `claude_args` 透传 + `--permission-mode acceptEdits` + `--model`），stdout 即报告；`export async function main()` → CLI `node bin/generate.mjs <day>`（`--date` 与位置参数同义）

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chat, PROVIDERS } from '../bin/lib/llm.mjs'
import { generateReport } from '../bin/generate.mjs'

async function mockServer(handler) {
  const seen = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', async () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null
      seen.push({ url: req.url, headers: req.headers, body })
      const r = await handler(req, body)
      if (r.status) { res.statusCode = r.status; res.end(r.body || 'err'); return }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(r))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { server, base: 'http://127.0.0.1:' + server.address().port, seen }
}

test('openai 协议请求体与响应', async () => {
  process.env.K = 'sekret'
  const { server, base, seen } = await mockServer(() => ({ choices: [{ message: { content: 'OK' } }] }))
  const out = await chat({ protocol: 'openai', base_url: base, api_key_env: 'K', model: 'm' }, 'sys', 'user')
  assert.equal(out, 'OK')
  assert.equal(seen[0].body.model, 'm')
  assert.equal(seen[0].body.messages[0].role, 'system')
  assert.match(seen[0].url, /\/chat\/completions$/)
  server.close()
})
test('anthropic 协议 x-api-key 头与响应拼接', async () => {
  process.env.K = 'sekret'
  const { server, base, seen } = await mockServer(() => ({ content: [{ type: 'text', text: 'OK2' }] }))
  const out = await chat({ protocol: 'anthropic', base_url: base, api_key_env: 'K', model: 'm' }, 'sys', 'user')
  assert.equal(out, 'OK2')
  assert.equal(seen[0].headers['x-api-key'], 'sekret')
  assert.match(seen[0].url, /\/v1\/messages$/)
  server.close()
})
test('失败重试后成功', async () => {
  process.env.K = 'k'
  let n = 0
  const { server, base, seen } = await mockServer(() => { n++; return n < 3 ? { status: 500, body: 'x' } : { choices: [{ message: { content: 'ok' } }] } })
  const out = await chat({ protocol: 'openai', base_url: base, api_key_env: 'K', model: 'm' }, 's', 'u', { retryDelays: [0, 0] })
  assert.equal(out, 'ok')
  assert.equal(seen.length, 3)
  server.close()
})
test('api 生成器组装 system+user', async () => {
  process.env.K = 'sekret'
  const { server, base, seen } = await mockServer(() => ({ choices: [{ message: { content: '# 日报' } }] }))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const cfg = { watch_dirs: [], ignore: [], max_files_per_dir: 40, generator: { type: 'api', protocol: 'openai', base_url: base, api_key_env: 'K', model: 'm' }, claude_args: [], deliver: [] }
  const r = await generateReport('2026-10-16', { config: cfg, worklogDir: dir, now: new Date(2026, 9, 16, 18, 0) })
  assert.equal(r.generatorType, 'api')
  assert.ok(seen[0].body.messages[0].content.includes('工作日报写作规则'))
  server.close()
})
test('PROVIDERS 预设含 deepseek 双协议', () => {
  assert.equal(PROVIDERS.deepseek.openai, 'https://api.deepseek.com/v1')
  assert.equal(PROVIDERS.deepseek.anthropic, 'https://api.deepseek.com/anthropic')
})
```

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**

`llm.mjs` 关键实现：

```js
export async function chat(cfg, system, user, opts = {}) {
  const key = process.env[cfg.api_key_env] || ''
  if (!key) throw new Error(`环境变量 ${cfg.api_key_env} 未设置`)
  const fetchImpl = opts.fetchImpl || globalThis.fetch
  const base = String(cfg.base_url).replace(/\/+$/, '')
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (cfg.protocol === 'anthropic') {        const res = await fetchImpl(base + '/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: cfg.model, max_tokens: 4096, system, messages: [{ role: 'user', content: user }] }),
        })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const j = await res.json()
        return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('')
      }
      const res = await fetchImpl(base + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: cfg.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const j = await res.json()
      return j.choices?.[0]?.message?.content || ''
    } catch (e) {
      lastErr = e
      if (attempt < 2) await new Promise((r) => setTimeout(r, (opts.retryDelays || [2000, 4000])[attempt]))
    }
  }
  throw lastErr
}
```

`generate.mjs`：claude-cli 分支封装 `bin/lib/spawnCli.mjs`（本任务一并创建）：

```js
import { spawnSync } from 'node:child_process'
export function runClaude(args, opts = {}) {
  const isWin = process.platform === 'win32'
  const r = spawnSync('claude', args, { encoding: 'utf8', shell: isWin, cwd: opts.cwd, env: { ...process.env, ...opts.env }, timeout: opts.timeout || 600000 })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error('claude 退出码 ' + r.status + '\n' + (r.stderr || ''))
  return r.stdout
}
```

（Windows 下 `shell:true` 使 `claude` 经 cmd 解析 `claude.cmd`，修复参考实现 run-daily.py 无 .exe 兜底的缺陷。）api 分支读取 `prompts/report.md`：

```markdown
# 工作日报写作规则

你是日报撰写助手。根据提供的当日工作素材，生成一份中文工作日报，Markdown 格式。
要求：
1. 标题为 `# 工作日报 YYYY-MM-DD`。
2. 按工作主题分节（如功能开发/问题修复/会议沟通），每节 2-5 条要点，每条一句话，写清做了什么、结果如何。
3. 素材中缺失的信息不臆造；素材为空时写"今日无记录的工作"。
4. 涉及代码的条目给出文件名或模块名；涉及结论的条目写清结论。
5. 语言中性客观，不使用感叹句与情绪化表述。
6. 末尾附"素材来源：流水 N 条 / git M 提交 / 文件变更 K 处 / 手记"统计行。
```

- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: commit** `git add -A && git commit -m "feat: LLM 客户端（双协议+重试）与生成器（api/claude-cli）"`

---

### Task 8: channels 四渠道 + deliver.mjs

**Files:**
- Create: `channels/copy.mjs`、`channels/smtp.mjs`、`channels/wecom.mjs`、`channels/feishu.mjs`、`bin/deliver.mjs`
- Test: `test/deliver.test.mjs`

**Interfaces:**
- Consumes: `bin/lib/text.mjs`（splitByBlankLines）、`bin/lib/config.mjs`
- Produces: 每渠道 `export async function send(cfg, reportText, opts)`（opts 注入 fetchImpl/spawn 便于测试；成功 resolve、失败 throw）；`deliver.mjs`: `export async function deliver(report, reportPath, channelsCfg, opts)` → 逐渠道 try/catch，失败收集进返回 `{ok:[name], failed:[{name, error}]}`，永远不抛；`export async function main()` → CLI `node bin/deliver.mjs <报告路径>`（读 config 投递）

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { send as copySend } from '../channels/copy.mjs'
import { send as wecomSend } from '../channels/wecom.mjs'
import { send as feishuSend } from '../channels/feishu.mjs'
import { send as smtpSend } from '../channels/smtp.mjs'
import { deliver } from '../bin/deliver.mjs'
import http from 'node:http'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

async function hookServer(onBody) {
  const seen = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      seen.push(body)
      onBody(body)
      res.end('{"errcode":0}')
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { server, url: 'http://127.0.0.1:' + server.address().port + '/hook', seen }
}

test('copy 复制文件', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const src = path.join(d, '2026-10-16.md')
  fs.writeFileSync(src, '# 日报')
  await copySend({ type: 'copy', to: path.join(d, 'out') }, '# 日报', { reportPath: src })
  assert.equal(fs.readFileSync(path.join(d, 'out', '2026-10-16.md'), 'utf8'), '# 日报')
})
test('wecom markdown 请求体与 4096 分片', async () => {
  const { server, url, seen } = await hookServer(() => {})
  const long = Array.from({ length: 30 }, (_, i) => '段落' + i + ' ' + 'x'.repeat(200)).join('\n\n')
  await wecomSend({ type: 'wecom', url }, long, {})
  assert.ok(seen.length > 1)
  assert.equal(seen[0].msgtype, 'markdown')
  for (const s of seen) assert.ok(Buffer.byteLength(JSON.stringify(s.markdown.content), 'utf8') <= 4096)
  server.close()
})
test('feishu post 富文本分片', async () => {
  const { server, url, seen } = await hookServer(() => {})
  const long = '# 工作日报 2026-10-16\n\n' + Array.from({ length: 30 }, (_, i) => '段落' + i + ' ' + 'x'.repeat(200)).join('\n\n')
  await feishuSend({ type: 'feishu', url }, long, {})
  assert.ok(seen.length > 1)
  assert.equal(seen[0].msg_type, 'post')
  assert.ok(JSON.stringify(seen[0].content.post.zh_cn.title).includes('工作日报'))
  for (const s of seen) assert.ok(Buffer.byteLength(JSON.stringify(s.content), 'utf8') <= 4096)
  server.close()
})
test('smtp 用 curl 传参（不真发）', async () => {
  process.env.P = 'pw'
  let argv
  await smtpSend({ type: 'smtp', host: 'smtp.example.com', port: 465, user: 'me@example.com', password_env: 'P', to: ['a@b.c'], from: 'me@example.com' }, '日报内容', { spawn: (cmd, args) => { argv = args; return { status: 0 } } })
  assert.ok(argv.includes('smtps://smtp.example.com:465'))
  assert.ok(argv.includes('me@example.com:pw'))
  assert.ok(argv.includes('--mail-rcpt'))
  assert.ok(argv.includes('a@b.c'))
  assert.ok(argv.includes('--upload-file'))
})
test('deliver 失败不阻塞', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const r = await deliver('# x', null, [
    { type: 'copy', to: d },
    { type: 'wecom', url: 'http://127.0.0.1:1/h' },
    { type: 'smtp', host: 'h', user: 'u', to: ['a@b'], from: 'f' },
  ], { spawn: () => { throw new Error('nope') } })
  assert.equal(r.ok.length, 1)
  assert.equal(r.failed.length, 2)
  assert.ok(fs.existsSync(d))
})
```

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**

- `copy.mjs`：`fs.copyFileSync` 到 `path.join(cfg.to, basename)`，目录自动建。
- `wecom.mjs`：每段 `fetch(cfg.url, {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({msgtype:'markdown', markdown:{content: seg}})})`；响应 `errcode!==0` 抛错；分片阈值 4096 字节（`splitByBlankLines`）。
- `feishu.mjs`：每段 `{msg_type:'post', content:{post:{zh_cn:{title: 报告首行或 '工作日报', content: seg.split(/\n{2,}/).map(p => [{tag:'text', text:p}])}}}}`（feishu post 的 content 是段落数组，每段一个 text 元素）；分片同 4096。
- `smtp.mjs`：`spawnSync('curl', ['--silent','--show-error','--url', 'smtps://' + host + ':' + (port||465), '--ssl-reqd', '--user', user + ':' + pass, '--mail-from', from, '--mail-rcpt', ...to, '--upload-file', tmpFile], {timeout})`——先把 reportText 写临时文件；`--fail` 时 stderr 抛错。port 587 + starttls 时改 `smtp://` + `--ssl-reqd` 保留（curl 自动 STARTTLS）。spawn 注入点 `opts.spawn`。
- `deliver.mjs`：按 `channelsCfg` 数组逐条 dispatch（`{copy, smtp, wecom, feishu}` 映射），try/catch 汇总。

- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: commit** `git add -A && git commit -m "feat: 投递渠道（copy/smtp/wecom/feishu）+ 编排"`

---

### Task 9: run-daily.mjs 定时入口

**Files:**
- Create: `bin/run-daily.mjs`
- Test: `test/run-daily.test.mjs`

**Interfaces:**
- Consumes: Task 6 `buildMaterial`、Task 7 `generateReport`、Task 8 `deliver`、`bin/lib/config.mjs`、`bin/lib/log.mjs`（本任务创建：`export function logRun(dir, msg, now)` 追加 `[ts] msg` 到 run.log）
- Produces: `export function decideTodo(opts)` → `{todo:[day], skipped:{day: reason}}`（纯函数，可单测）：回看 `opts.days`(默认 7) 天，每 day 判定：素材三无（无 jsonl/手记/文件变更）→ skip；today → todo；无报告 → todo；素材最新 mtime > 报告 mtime → todo；todo 按日期排序后截断为 `opts.maxCatchup`(默认 3) 个（今天在前）；`export async function runDailyMain(opts)` → 可注入版主流程（opts 含 `{worklogDir, date, dryRun, now, deps:{generateReport, deliver, logRun, loadConfig}}`）：decideTodo → 逐日 generateReport → 写 `reports/day.md` → deliver → logRun 每步一行；`export async function main()` → CLI 包装：解析 `--date YYYY-MM-DD` / `--dry-run` 后调 runDailyMain

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideTodo, runDailyMain } from '../bin/run-daily.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const NOW = new Date(2026, 9, 16, 18, 0)
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  return { dir, opts: { worklogDir: dir, watchDirs: [], days: 7, maxCatchup: 3, now: NOW } }
}
function touch(f, ms) {
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, 'x')
  fs.utimesSync(f, ms / 1000, ms / 1000)
}

test('当天恒生成（即使已有报告）', () => {
  const { dir, opts } = fixture()
  touch(path.join(dir, 'reports', '2026-10-16.md'), NOW.getTime())
  const { todo } = decideTodo(opts)
  assert.ok(todo.includes('2026-10-16'))
})
test('素材三无跳过', () => {
  const { opts } = fixture()
  const { todo, skipped } = decideTodo(opts)
  assert.ok(!todo.includes('2026-10-13'))
  assert.ok(Object.keys(skipped).includes('2026-10-13'))
})
test('历史缺报告补生成', () => {
  const { dir, opts } = fixture()
  touch(path.join(dir, '2026-10-13.jsonl'), new Date(2026, 9, 13, 12, 0).getTime())
  const { todo } = decideTodo(opts)
  assert.ok(todo.includes('2026-10-13'))
})
test('素材新于报告才重生成（手改保护）', () => {
  const { dir, opts } = fixture()
  touch(path.join(dir, '2026-10-14.jsonl'), new Date(2026, 9, 14, 10, 0).getTime())
  touch(path.join(dir, 'reports', '2026-10-14.md'), new Date(2026, 9, 14, 18, 0).getTime())
  const { todo } = decideTodo(opts)
  assert.ok(!todo.includes('2026-10-14'))
})
test('maxCatchup 截断（今天 + 最近 2 个补生成）', () => {
  const { dir, opts } = fixture()
  for (const d of ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']) touch(path.join(dir, d + '.jsonl'), new Date(2026, 9, 10, 12, 0).getTime())
  const { todo } = decideTodo(opts)
  assert.equal(todo.length, 3)
  assert.ok(todo.includes('2026-10-16'))
  assert.ok(todo.includes('2026-10-13'))
  assert.ok(!todo.includes('2026-10-10'))
})
test('dry-run 不写报告', async () => {
  const { dir } = fixture()
  await runDailyMain({ worklogDir: dir, date: '2026-10-16', dryRun: true, now: NOW, deps: { generateReport: async () => ({ report: '# x', generatorType: 'api' }) } })
  assert.ok(!fs.existsSync(path.join(dir, 'reports', '2026-10-16.md')))
})
```

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**（判定逻辑对齐参考实现 run-daily.py 164-198 行；`now` 由 `--date` 或注入决定，报告 mtime 用 `fs.statSync`；生成环境变量 `WORKLOG_SKIP=1` 传入 generate 的 spawn 环境）
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: commit** `git add -A && git commit -m "feat: 定时入口 run-daily（日期判定+逐日生成+日志）"`

---

### Task 10: add.mjs 手动补录

**Files:**
- Create: `bin/add.mjs`
- Test: `test/add.test.mjs`

**Interfaces:**
- Consumes: `bin/lib/notes.mjs`（appendNote）、`bin/lib/jsonl.mjs`（appendLine）
- Produces: `export function addEntry(dir, text, now)` → notes.md 追加手记 + jsonl 追加一条 `{ts, kind:'note', cwd:'', session:'', turn:'', text}`（让 run-daily 的"有活干"判定能看到这天）；`main()` → CLI `node bin/add.mjs "文本"`（无参数打印用法退 1）

- [ ] **Step 1: 写失败测试**（临时目录：addEntry 后 notes 节有 `- 文本`、jsonl 有 kind='note' 行；空文本抛错或返回 false）
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**（约 30 行）
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: commit** `git add -A && git commit -m "feat: 手动补录 add 命令"`

---

### Task 11: setup.mjs 交互安装器

**Files:**
- Create: `bin/setup.mjs`、`bin/lib/settings.mjs`（settings.json 读写）、`bin/lib/scheduler.mjs`（计划任务构造）
- Test: `test/setup.test.mjs`

**Interfaces:**
- Consumes: 全部 lib 模块
- Produces:
  - `settings.mjs`: `export function loadSettings(p)` → 对象（缺文件返回 {}）；`export function registerHooks(p, hookCmds, now)` → 备份 `p` 为 `p.bak-<时间戳>`，只增改 hooks 键（`UserPromptSubmit`/`Stop`/`PostToolUse` 各插入 capture 命令，已存在同命令则跳过），写回 JSON 2 空格缩进；`export function removeReportHooks(p, now)` → 移除含 `daily-report` 路径的三事件条目（本机迁移用）
  - `scheduler.mjs`: `export function buildSchTasks(name, scriptPath, time, weekdays, now)` → schtasks 参数数组与命令行字符串；`export function buildCronLine(scriptPath, time, weekdays)` → crontab 行（`min hour * * 0-6`，weekdays 数组转 cron 星期）
  - `setup.mjs`: `export async function runSetup({io, now, env, platform})` → 纯逻辑 + 注入 io（`ask(question, {default})`、`pick(options)`、`say`），返回写入动作列表（供测试断言）；`main()` → 真实 stdin/stdout 交互执行

- [ ] **Step 1: 写失败测试**

```js
test('registerHooks 幂等且备份', () => {
  // 临时 settings.json 含无关键 → registerHooks 两次 → hooks 只有一份 capture、目录有 .bak- 文件
})
test('removeReportHooks 只删日报条目', () => {
  // settings 含日报三条 + 其他 hook → 移除后其他 hook 保留
})
test('buildSchTasks 参数正确', () => {
  // buildSchTasks('ClaudeDailyReport', 'C:\\repo\\bin\\run-daily.mjs', '18:00', [1,2,3,4,5])
  // → 含 /sc weekly /d MON,TUE,WED,THU,FRI /st 18:00，命令行为 node "C:\repo\bin\run-daily.mjs"
})
test('buildCronLine 星期映射', () => {
  // [1,2,3,4,5] 18:00 → "0 18 * * 1-5 node /repo/bin/run-daily.mjs"
})
test('runSetup 流程：检测 claude 存在 → 推荐 claude-cli', () => {
  // 注入 io 回放 + 模拟 which('claude') 命中 → 断言 config 写出的 generator.type === 'claude-cli'
})
test('runSetup 流程：无 claude → 走 api 选 provider', () => {
  // which 未命中 → 断言 generator.type === 'api' 且 base_url 来自 PROVIDERS 预设
})
```

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**（setup 流程：1 检测 node 版本/数据目录；2 采集方式：检测 plugin 已装（settings.json `enabledPlugins` 含 daily-report）→ 提示无需注册，否则询问是否把 hooks 写入 settings.json（克隆用户）或跳过采集；3 生成器：`which claude`（`spawnSync('where',['claude'])` Windows / `which` 其他）命中则推荐 claude-cli，否则 api（pick provider 预设→protocol→model→api_key_env 名称）；4 watch_dirs 逐项询问（回车结束）；5 渠道逐项询问（copy 目标目录/smtp 参数/wecom url/feishu url，回车跳过）；6 计划任务：平台分支（Windows schtasks / mac·Linux crontab，询问时间默认 18:00 与工作日默认周一至五，已存在询问覆盖）；7 写 config.json 到 WORKLOG_DIR、执行注册与计划任务；每步 say 输出结果）
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: commit** `git add -A && git commit -m "feat: 交互安装器 setup（配置/hooks/计划任务）"`

---

### Task 12: Claude Code 接入层（skill + hooks + plugin 薄壳）

**Files:**
- Create: `skills/daily-report/SKILL.md`、`hooks/hooks.json`、`.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json`
- Modify: 无（prompts/report.md 已在 Task 7 创建）

**Interfaces:**
- Produces: `claude plugin validate --strict .` 通过

- [ ] **Step 1: 写 SKILL.md**（frontmatter：`name: daily-report`、`description: 生成当天的工作日报。从 Claude Code 工作流水、git 提交与未提交改动、文件系统变更、手动补录四路素材汇总成一份中文日报，写入 reports 目录。用户说"写日报""生成今天的日报""总结一下今天做了什么"时使用。也可补生成指定日期的日报。`；正文：四步流程 = 取素材（调 `node bin/collect.mjs <date>`）→ 判定（无素材则直说无工作）→ 写报告（遵循 `prompts/report.md` 规则，写入数据目录 reports/YYYY-MM-DD.md）→ 回报路径；注明支持 `/daily-report [日期]` 与 `/日报`）
- [ ] **Step 2: 写 hooks/hooks.json**

```json
{
  "UserPromptSubmit": [
    { "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/capture/claude-code.mjs\"", "timeout": 10 } ] }
  ],
  "Stop": [
    { "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/capture/claude-code.mjs\"", "timeout": 10 } ] }
  ],
  "PostToolUse": [
    { "hooks": [ { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/capture/claude-code.mjs\"", "timeout": 10 } ] }
  ]
}
```

- [ ] **Step 3: 写 .claude-plugin/plugin.json**

```json
{
  "name": "daily-report",
  "version": "0.1.0",
  "description": "自动采集 Claude Code 工作流水，每天生成中文工作日报并投递到本地、邮件、企业微信或飞书。",
  "author": { "name": "daily-report contributors" },
  "license": "MIT",
  "homepage": "https://github.com/<owner>/daily-report",
  "repository": "https://github.com/<owner>/daily-report",
  "keywords": ["daily-report", "worklog", "日报"]
}
```

- [ ] **Step 4: 写 .claude-plugin/marketplace.json**

```json
{
  "name": "daily-report-marketplace",
  "owner": { "name": "<owner>" },
  "plugins": [ { "name": "daily-report", "source": "./" } ]
}
```

- [ ] **Step 5: 验证**

```bash
claude plugin validate --strict .   # 期望：通过（无 error；如有警告逐条处理）
```

- [ ] **Step 6: commit** `git add -A && git commit -m "feat: Claude Code 接入层（skill/hooks/插件薄壳）"`

---

### Task 13: CI 与文档

**Files:**
- Create: `.github/workflows/test.yml`、`README.md`、`README.zh.md`、`docs/adapter-guide.md`（采集适配器开发指南）、`docs/setup-guide.zh.md`（setup 向导图文）、`docs/deliver-channels.zh.md`（渠道配置）

**Interfaces:**
- Produces: GitHub Actions 三平台测试矩阵；README ≥40 词（英文）且与中文版内容对应

- [ ] **Step 1: 写 .github/workflows/test.yml**

```yaml
name: test
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: [18, 20, 22]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '${{ matrix.node }}' }
      - run: node --test test/
```

- [ ] **Step 2: 写 README.md（英文，≥40 词）与 README.zh.md（中文）**：项目简介（通用日报生成器，三层扩展点）、四种用户类型安装表（spec §2 表格）、双路径安装步骤（plugin 两条命令 / clone+setup）、生成器双协议说明与 provider 预设表、配置全键表（spec §6）、渠道配置（指向 docs/）、FAQ（含"数据存哪""如何换 AI""CC Switch 用户注意事项"）
- [ ] **Step 3: 写 docs/adapter-guide.md**（中文，面向开发者）：采集适配器统一接口定义——输入 hook 载荷或 agent 自有事件，产出流水行对象 `{ts, kind: prompt|file|reply|note, cwd, session, turn, text, tool?}` 写入 `<WORKLOG_DIR>/<day>.jsonl`；附 claude-code.mjs 作为参考实现要点与"如何给其他 agent 接事件源"的分步示例
- [ ] **Step 4: 写 docs/setup-guide.zh.md 与 docs/deliver-channels.zh.md**（各渠道字段表 + 企业微信/飞书机器人创建步骤 + 分片行为说明）
- [ ] **Step 5: 本地跑 `node --test test/` 全绿 + commit** `git add -A && git commit -m "docs: README 双语/适配器指南/setup 与渠道文档 + CI"`

---

### Task 14: 本机迁移（dogfooding，非 TDD）

**Files:**
- 本任务不改仓库代码；操作对象为本机 `~/.claude/settings.json`、Windows 计划任务、`~/.worklog/`

**Interfaces:**
- Consumes: 仓库全部产物；`bin/lib/settings.mjs` 的 removeReportHooks

- [ ] **Step 1: 核对迁移前状态**：记录当前 settings.json 三条日报 hook 命令原文、计划任务 ClaudeDailyReport 与 ClaudeHooksGuard 定义（`schtasks /query /fo LIST /v /tn <名>`）、`~/.worklog/` 文件清单
- [ ] **Step 2: 本机安装仓库（插件路径）**：`claude plugin marketplace add <本地路径>` → `claude plugin install daily-report@<marketplace名>` → 重启会话验证 skill 与 hooks 生效（发一条测试消息，确认 `~/.worklog/2026-10-16.jsonl` 有 plugin 来源的新行）
- [ ] **Step 3: 清理旧手工 hooks**：用 `removeReportHooks` 移除 settings.json 中三条日报 hook（先自动备份）；更新 `~/.claude/plugin-src/hooks-template.json`（日报三条移除，superpowers/UA 保留）；同步更新 hooks-guard.mjs 的模板对照（guard 只管剩余条目）
- [ ] **Step 4: 重建计划任务**：`schtasks /delete /tn ClaudeDailyReport /f` → 运行 `node bin/setup.mjs`（本机选：生成器先选 claude-cli 保持行为一致，后续再实测 api 直调 DeepSeek 对比）→ 确认新任务指向仓库 `bin/run-daily.mjs`
- [ ] **Step 5: 验证 hooks-guard 兼容**：跑 `bash ~/.claude/plugin-src/plugins-manage.sh repair-hooks`，确认不再把日报 hooks 写回 settings.json
- [ ] **Step 6: 实测完整链路一天**：确认当天流水采集（jsonl 有内容）→ 手动 `node bin/run-daily.mjs --date 今天` 生成报告 → 检查报告质量与投递（copy 到临时目录）→ 次日确认计划任务自动跑
- [ ] **Step 7: 迁移完成记录**：在仓库 CHANGELOG（或 docs/）追加一段"作者本机迁移实录"（做了什么、结果、遗留事项）

---

### Task 15: 发布准备

**Files:**
- Modify: 文档与 plugin.json 中的 `<owner>` 占位、version 定版

**Interfaces:**
- Produces: 可 push 的公开仓库

- [ ] **Step 1: 按发布清单逐项核对**（spec §11 全表：owner 占位替换、示例去机器化、LICENSE、README≥40 词、`claude plugin validate --strict` 通过、CI 绿（push 后）、config.example 无真实值、version 0.1.0）
- [ ] **Step 2: 首次 push**：由用户确认后执行（`git remote add origin <url>` + `git push -u origin main`）；push 后检查 Actions 三平台矩阵全绿
- [ ] **Step 3: 冒烟安装测试**：另建一个临时用户目录模拟全新用户走一遍 README 双路径安装（clone 路径），确认文档与实际行为一致
- [ ] **Step 4: 收尾**：更新记忆与 CLAUDE.md 相关说明（日报系统已开源化、本机安装形态变化）；向用户汇报发布结果

---

## 附：任务依赖图

```
T1 骨架 → T2 lib基础 → T3 redact ──→ T4 capture
                 └→ T5 数据源 ──→ T6 collect ──→ T7 llm+generate ──→ T9 run-daily
                                      T7 同时产出 prompts/report.md 与 spawnCli
T2/T5 ─→ T8 channels+deliver ─→ T9
T2 ─→ T10 add
T2/T5/T7/T8 ─→ T11 setup（含 settings/scheduler 模块）
T7(完成后) ─→ T12 接入层
全部完成后 ─→ T13 文档/CI ─→ T14 本机迁移 ─→ T15 发布
```

关键串行链：T1→T2→T3→T4、T1→T2→T5→T6→T7→T9、T2→T8→T9；T4 与 T5 可并行；T10/T11/T12 在依赖就绪后可并行。
