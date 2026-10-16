# daily-report

一个通用的中文工作日报生成器：从多个来源采集素材 → 汇总 → 交给 LLM 生成日报 → 投递到本地 / 邮件 / 企业微信 / 飞书，支持定时与手动两种触发。

核心链路（素材汇总、生成、投递、定时）不依赖任何特定 agent；Claude Code 是内置的采集适配器（素材最全：提问、改动文件、回复），其他 agent 的采集适配器是预留扩展点。

## 特性

- **四路素材**：agent 工作流水、git 提交与未提交改动、监听目录的文件变更、手动补录
- **三层扩展点，各加一个文件**：采集适配器（`bin/capture/`）/ 生成器 / 投递渠道（`channels/`）
- **两种内置生成器**：直调 LLM API（OpenAI 兼容与 Anthropic 兼容双协议；内置 DeepSeek / OpenAI / Anthropic / 通义千问 / 智谱 GLM 预设，支持自定义 `base_url`）或 claude CLI（复用现有 Claude Code 登录态）
- **四种投递渠道**：本地归档、SMTP 邮件（系统 `curl` 发送）、企业微信群机器人、飞书群机器人；超长按空行边界 4096 字节分片
- **计划任务**由 setup 创建（Windows `schtasks` / macOS 与 Linux `crontab`，默认工作日 18:00）
- **写入即脱敏**（API key / token / 密码 / JWT）；所有密钥只从环境变量读取
- **零 npm 依赖**，Node.js ≥ 18，MIT 许可

## 安装：四种用户各取所需

| 用户类型 | 采集 | 生成 | 安装 |
|---|---|---|---|
| Claude Code 用户（信息最全） | Claude Code 流水 hook | 自填 LLM API（或 claude CLI） | `/plugin marketplace add AlanCommitK/daily-report` → `/plugin install daily-report@daily-report-marketplace` → `node bin/setup.mjs` |
| 无 Claude Code 的普通用户 | git / 文件变更 / 手记 | 自填 LLM API | `git clone` + `node bin/setup.mjs` |
| 其他 agent 用户 | 未来写适配器接入 | 自填 LLM API | `git clone` + setup |
| 已有 claude CLI 的老用户 | Claude Code 流水 hook | claude CLI（保留兼容） | 同第一行 |

### 插件路径（Claude Code 用户）

1. 在 Claude Code 里加市场并装插件（`AlanCommitK` 换成本仓库的 GitHub owner）：

   ```
   /plugin marketplace add AlanCommitK/daily-report
   /plugin install daily-report@daily-report-marketplace
   ```

2. 从仓库的本地副本跑一次安装向导：

   ```
   git clone https://github.com/AlanCommitK/daily-report && cd daily-report
   node bin/setup.mjs
   ```

   setup 检测到插件已启用，自动跳过 hooks 注册（hooks 由插件提供，不写 `settings.json`），只配置生成器、投递渠道与计划任务。

### 克隆路径（不装插件）

```
git clone https://github.com/AlanCommitK/daily-report && cd daily-report
node bin/setup.mjs
```

setup 会询问是否把采集 hooks 写入 `~/.claude/settings.json`（写入前自动备份、幂等）。没有 Claude Code 就选否——素材来自 git、文件变更与手记三路。最后把 `config.json` 写进数据目录并创建计划任务。

## 配置

`config.json` 在数据目录（默认 `~/.worklog/`），不在仓库里。模板见 [config.example.json](config.example.json)。全键：

| 键 | 默认 | 说明 |
|---|---|---|
| `watch_dirs` | `[]` | 文件变更扫描根目录（素材 C） |
| `ignore` | `.git, node_modules, …` | 扫描忽略 |
| `max_files_per_dir` | `40` | 素材里每目录最多列文件数 |
| `generator` | 必填（setup 引导配置） | `{type:"api", protocol:"openai"\|"anthropic", base_url, api_key_env, model}` 或 `{type:"claude-cli", model?}` |
| `claude_args` | `[]` | claude-cli 生成器透传参数 |
| `deliver` | `[]` | 投递渠道数组；不配 = 仅本地留档 |

环境变量：`WORKLOG_DIR`（数据目录，默认 `~/.worklog`）、`WORKLOG_SKIP`（`1` 跳过采集——claude-cli 生成器运行时会设）、`WORKLOG_REDACT`（`0` 关闭脱敏）、`WORKLOG_MAX_PROMPT=1200`、`WORKLOG_MAX_REPLY=2000`、`WORKLOG_SMTP_PASS`（SMTP 密码），以及 `generator.api_key_env` 指定的 API key 变量。

## 生成器

两种内置，setup 按环境推荐（检测到 claude CLI 则推荐 claude-cli）：

- **`api`** — 直调 LLM API，双协议：
  - `openai` — OpenAI 兼容（`/chat/completions`）
  - `anthropic` — Anthropic 兼容（`/v1/messages`）

  provider 预设：

  | 预设 | 协议 | base_url |
  |---|---|---|
  | `deepseek` | openai / anthropic | `https://api.deepseek.com/v1` / `https://api.deepseek.com/anthropic` |
  | `openai` | openai | `https://api.openai.com/v1` |
  | `anthropic` | anthropic | `https://api.anthropic.com` |
  | `qwen` | openai | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
  | `glm` | openai | `https://open.bigmodel.cn/api/paas/v4` |

  setup 里也可选"自定义"填任意 base_url + 协议。API key 只从 `api_key_env` 指定的环境变量读取，不落盘；请求失败自动重试 2 次。

- **`claude-cli`** — 调 `claude -p "/daily-report <日期>" --permission-mode acceptEdits`，复用现有 Claude Code 登录态；generator 里可配可选 `model`，`claude_args` 原样透传；Windows 下已处理 `claude.cmd`。

## 投递渠道

`deliver` 是数组，可配任意多个。各渠道字段、企业微信/飞书机器人创建步骤、长文分片行为见 [docs/deliver-channels.zh.md](docs/deliver-channels.zh.md)。速览：

```jsonc
"deliver": [
  { "type": "copy", "to": "D:/日报存档" },
  { "type": "smtp", "host": "smtp.example.com", "port": 465,
    "user": "me@example.com", "password_env": "WORKLOG_SMTP_PASS",
    "to": ["boss@example.com"], "from": "me@example.com" },
  { "type": "wecom", "url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." },
  { "type": "feishu", "url": "https://open.feishu.cn/open-apis/bot/v2/hook/..." }
]
```

超长日报统一按 4096 字节在空行边界切分，每条消息都是完整段落/列表/代码块（4096 是企业微信 markdown 消息上限；飞书官方 webhook 上限更高，本工具同样按 4096 保守分片）。某渠道失败不影响其余，日报永远先落本地 `reports/`。

## 命令行

| 命令 | 用途 |
|---|---|
| `node bin/setup.mjs` | 交互安装器（配置 + hooks + 计划任务） |
| `node bin/collect.mjs [YYYY-MM-DD] [--json]` | 汇总当天素材 |
| `node bin/generate.mjs [YYYY-MM-DD]` | 生成日报输出到 stdout |
| `node bin/run-daily.mjs [--date YYYY-MM-DD] [--dry-run]` | 定时入口：补生成缺失日期 → 写 `reports/` → 投递 → 记日志 |
| `node bin/add.mjs "文本"` | 手动补录一条手记 |
| `node bin/deliver.mjs <报告路径>` | 把已有报告按配置投递 |

在 Claude Code 里也可以直接说"写日报"或运行 `/daily-report [日期]`（skill）。

## 文档

- [docs/setup-guide.zh.md](docs/setup-guide.zh.md) — 安装向导图文说明
- [docs/deliver-channels.zh.md](docs/deliver-channels.zh.md) — 渠道配置
- [docs/adapter-guide.md](docs/adapter-guide.md) — 采集适配器开发指南（面向开发者）

## 常见问题

**数据存在哪？** `~/.worklog/`（可用 `WORKLOG_DIR` 覆盖）：`<日期>.jsonl` 工作流水、`notes.md` 手记、`reports/<日期>.md` 日报、`run.log` 运行日志、`config.json` 配置。目录与仓库分离，仓库 `.gitignore` 防误提交。

**哪些素材会脱敏？** 仅工作流水与手记两段（写入即脱敏）；git 提交与文件变更素材段不做脱敏，与参考实现一致。

**如何换 AI？** 改 `~/.worklog/config.json` 的 `generator`（预设或自定义 base_url、protocol、model、api_key_env），或重跑 `node bin/setup.mjs`。密钥放到 `api_key_env` 指定的环境变量里即可。

**用 CC Switch 管理 Claude Code 供应商的用户要注意什么？** CC Switch 切换供应商会整体重写 `~/.claude/settings.json`，克隆路径注册在那里的 hooks 可能被抹掉。插件路径不受影响——hooks 在插件里，不在 settings.json。克隆路径的 hooks 若消失，重跑 `node bin/setup.mjs` 重新注册，或改走插件路径。

**Windows 注意**：Node ≥ 18；调 claude CLI 时已自动处理 `claude.cmd`。

## 开发

零 npm 依赖，测试用 `node:test`：

```
node --test
```

CI 在 ubuntu / macos / windows × Node 18 / 20 / 22 全矩阵跑测试（`.github/workflows/test.yml`）。

## 许可

[MIT](LICENSE)
