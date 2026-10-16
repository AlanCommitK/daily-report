# 采集适配器开发指南

本文档定义采集适配器的统一接口，并以内置的 Claude Code 适配器为参考实现，说明如何给其他 agent（Codex / Cursor / Trae 等）接上事件源。

## 1. 适配器是干什么的

daily-report 的素材有四路：A 工作流水、B git、C 文件变更、D 手记。采集适配器只负责 A 路：把某个 agent 的"用户提问 / 改动文件 / 助手回复"事件转成**流水行**，追加到数据目录的当日 jsonl。之后 collect / generate / run-daily 都不关心流水来自哪个 agent——接口对齐即可接入。

## 2. 统一接口

### 2.1 流水行对象

一行一个 JSON 对象（JSONL），写入 `<WORKLOG_DIR>/<day>.jsonl`（`WORKLOG_DIR` 默认 `~/.worklog/`，`day` 形如 `2026-10-16`）：

```json
{"ts":"2026-10-16T09:30:00+08:00","kind":"prompt","cwd":"C:\\Users\\me\\proj","session":"a1b2c3d4","turn":"e5f6a7b8","text":"重构配置加载模块"}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `ts` | string | 是 | 本地时间 ISO 8601（含时区偏移），如 `2026-10-16T09:30:00+08:00`。文件归属日期与 ts 同源，由适配器自身时钟决定 |
| `kind` | string | 是 | 行类型：`prompt`（用户提问）/ `file`（改动文件）/ `reply`（助手回复）/ `note`（手动补录，`bin/add.mjs` 用） |
| `cwd` | string | 是 | 事件发生的工作目录（可为空串） |
| `session` | string | 是 | 会话标识（可为空串） |
| `turn` | string | 是 | 轮次标识（可为空串）；同轮多行归为一组，空时退回 session 分组 |
| `text` | string | 是 | 内容：prompt 的提问文本 / file 的文件路径 / reply 的回复文本 / note 的手记文本 |
| `tool` | string | 否 | `kind=file` 时的工具名（如 Write / Edit） |

### 2.2 写入方式与三条铁律

- **复用现成工具**：`bin/lib/jsonl.mjs` 的 `appendLine(dir, day, obj)`——UTF-8 无 BOM、每行一个 JSON 对象、`\n` 结尾、永不抛异常（失败返回 false）。日期用 `bin/lib/date.mjs` 的 `nowIso(now)`（ts）与 `today(now)`（day）。
- **三条铁律**（hook 型适配器必须遵守，与内置适配器一致）：
  1. **绝对静默**：不向 stdout 写任何东西（如 UserPromptSubmit 等事件里 stdout 会被注入模型上下文）。
  2. **绝不失败**：任何异常吞掉、退出码 0——采集失败不应影响 agent 正常工作。
  3. **落盘 UTF-8 无 BOM**（`appendLine` 已保证）。
- **脱敏与截断**：写入前过 `bin/lib/redact.mjs` 的 `redact()`（API key / GitHub token / 密码 / JWT 等 8 类正则替换），并限制长度（prompt 默认 1200 字符、reply 2000、file 路径 400）。
- **环境变量**：`WORKLOG_SKIP=1` 整条跳过（生成器运行时自己设它，避免把"生成日报"采进流水）；`WORKLOG_REDACT=0` 关闭脱敏；`WORKLOG_MAX_PROMPT` / `WORKLOG_MAX_REPLY` 覆盖截断阈值。

### 2.3 输入是什么

不规定输入形态：hook 载荷（如 Claude Code 经 stdin 传入的 JSON）、agent 的事件总线 / 日志文件 / IDE 扩展 API 均可。适配器只做两件事：把事件映射成 §2.1 的行，然后追加到 jsonl。

## 3. 参考实现：bin/capture/claude-code.mjs

内置适配器，读取 Claude Code hook 经 stdin 传入的 JSON 载荷（`hook_event_name` 区分事件），处理链：**事件分发 → 跳过轮次判定 → 脱敏 → 截断 → 追加**。

要点：

- **事件分发**（`handlePayload`）：

  | `hook_event_name` | kind | text 来源 | 截断（字符） |
  |---|---|---|---|
  | `UserPromptSubmit` | `prompt` | `d.prompt`（缺省 `d.user_input`） | `WORKLOG_MAX_PROMPT`，默认 1200 |
  | `Stop` | `reply` | `d.last_assistant_message` | `WORKLOG_MAX_REPLY`，默认 2000 |
  | `PostToolUse` | `file` | `d.tool_input.file_path`，且 `tool_name` ∈ {Write, Edit, NotebookEdit, MultiEdit} | 400 |

- **排除日报自身**：prompt 以 `/daily-report` 或 `/日报` 开头时，把该轮 `turn` 记入 `<day>.skipturns`，本轮及同轮的 file / reply 全部跳过——生成日报不算工作。
- **排除数据目录自身**：file 路径落在 `<WORKLOG_DIR>` 内时跳过（写日报文件不算工作成果）。
- **顺手开记事本**：每天第一条 prompt 时用 `ensureSection` 在 notes.md 建当天节（幂等）。
- **字段截取**：`session_id`、`prompt_id` 各截前 8 位作为 `session` / `turn`。
- **main() 三段式**：读 stdin 全部 → 空输入直接 exit 0 → JSON.parse 后交 `handlePayload`；整体 try/catch，任何异常 exit 0。
- 导出 `handlePayload(d, {worklogDir, env, now})` 供测试注入；main() 只做 stdin 接线。

## 4. 分步示例：给另一个 agent 接事件源

以"Codex CLI 的 hook"为例（多数 CLI agent 都有 hook / 事件机制；IDE 形态的 agent 用其扩展 API 同理，载荷字段以目标 agent 的实际文档为准）：

1. **找到事件源**：确认目标 agent 在什么时机、以什么格式吐出事件（CLI hook 的 stdin JSON、日志文件追加、IDE 扩展 API 回调均可）。
2. **建适配器文件**：在 `bin/capture/` 下新建一个 .mjs（或在独立仓库里写，复用 `bin/lib/*`）。
3. **映射事件**：按 §2.1 字段定义翻译事件。骨架：

```js
// bin/capture/codex.mjs（骨架；载荷字段以 Codex 实际 hook 文档为准）
import path from 'node:path'
import { appendLine } from '../lib/jsonl.mjs'
import { nowIso, today } from '../lib/date.mjs'
import { redact } from '../lib/redact.mjs'

async function handle(d, env) {
  try {
    if (env.WORKLOG_SKIP === '1') return
    const now = new Date()
    const dir = env.WORKLOG_DIR || path.join(env.USERPROFILE || env.HOME || '', '.worklog')
    const rec = {
      ts: nowIso(now),
      kind: 'prompt', // prompt | file | reply，按事件映射
      cwd: d.cwd ?? '',
      session: String(d.session_id ?? '').slice(0, 8),
      turn: String(d.turn_id ?? '').slice(0, 8),
      text: redact(String(d.text ?? '')).slice(0, 1200),
    }
    appendLine(dir, today(now), rec)
  } catch { /* 绝不失败：吞异常、退出码 0，不影响宿主 agent */ }
}
```

4. **注册 hook**：把适配器挂到目标 agent 的 hook 配置，命令形如 `node /path/to/codex.mjs`；确保 stdout 完全静默、异常退出码 0。
5. **验证**：发一条测试消息、改一个文件，检查 `~/.worklog/2026-10-16.jsonl` 出现对应行；`node bin/collect.mjs` 的"工作流水"节能看到它。
6. **收尾**：适配器就绪后无需改其他代码——`run-daily` 的"有活干"判定自动生效（当天 jsonl 存在即有素材）。

补充说明：

- **kind=note** 由 `bin/add.mjs` 写入（同时写 notes.md 当天节），适配器一般不需要产出。
- 同轮多行（prompt → file → reply）用同一个 `turn`；素材拼装时按 turn 归组（无 turn 退回 session）、保持 jsonl 追加顺序，一组即日报里的一个工作项。
- 适配器不负责 git / 文件变更 / 手记三路素材——那是 collect 的事；适配器只产出流水行。

## 5. 检查清单

- [ ] stdout 零输出；异常全吞、退出码 0
- [ ] UTF-8 无 BOM、一行一 JSON、`\n` 结尾
- [ ] 写入前过 `redact()`；text 有限长
- [ ] 尊重 `WORKLOG_SKIP=1`
- [ ] 生成日报自身的事件不产生流水行
- [ ] 实测：发消息 / 改文件后当日 jsonl 有行，`node bin/collect.mjs` 能看到
