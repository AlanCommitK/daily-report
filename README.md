# daily-report

An automated Chinese work-daily-report generator: collect material from multiple sources, summarize it with an LLM, and deliver the report to local files, email, WeCom or Feishu — on a schedule or on demand.

The core pipeline (collect → generate → deliver → schedule) does not depend on any specific agent. Claude Code is the built-in capture adapter (richest material: prompts, edited files, replies), and capture adapters for other agents are an extension point.

## Features

- **Four material sources**: agent worklog stream, git commits + uncommitted changes, file changes in watched directories, and manual notes
- **Three extension points, one file each**: capture adapters (`bin/capture/`), generators, deliver channels (`channels/`)
- **Two built-in generators**: direct LLM API call (OpenAI-compatible and Anthropic-compatible protocols; provider presets for DeepSeek / OpenAI / Anthropic / Qwen / GLM, plus custom `base_url`) or the Claude CLI (reuses your existing Claude Code login)
- **Four deliver channels**: local copy, SMTP email (via system `curl`), WeCom group bot webhook, Feishu group bot webhook; long reports chunked at 4096 bytes on blank-line boundaries
- **Scheduled task** created by setup (Windows `schtasks` / macOS & Linux `crontab`, weekdays 18:00 by default)
- **Redaction on write** (API keys, tokens, passwords, JWTs); secrets are only ever read from environment variables
- **Zero npm dependencies**, Node.js ≥ 18, MIT license

## Install — pick your path

| User | Capture | Generation | Install |
|---|---|---|---|
| Claude Code user (richest material) | Claude Code hooks | your own LLM API (or Claude CLI) | `/plugin marketplace add AlanCommitK/daily-report` → `/plugin install daily-report@daily-report-marketplace` → `node bin/setup.mjs` |
| No Claude Code | git / file changes / manual notes | your own LLM API | `git clone` + `node bin/setup.mjs` |
| Other-agent user | future capture adapter | your own LLM API | `git clone` + setup |
| Existing Claude CLI user | Claude Code hooks | Claude CLI | same as first row |

### Plugin path (Claude Code users)

1. In Claude Code, add the marketplace and install the plugin (replace `AlanCommitK` with the GitHub owner of this repository):

   ```
   /plugin marketplace add AlanCommitK/daily-report
   /plugin install daily-report@daily-report-marketplace
   ```

2. Run the setup wizard once, from a local copy of the repository:

   ```
   git clone https://github.com/AlanCommitK/daily-report && cd daily-report
   node bin/setup.mjs
   ```

   Setup detects the enabled plugin and skips hook registration (hooks come from the plugin, not `settings.json`), configuring only the generator, deliver channels and the scheduled task.

### Clone path (no plugin)

```
git clone https://github.com/AlanCommitK/daily-report && cd daily-report
node bin/setup.mjs
```

Setup asks whether to register the capture hooks into `~/.claude/settings.json` (the file is backed up first; registration is idempotent). Without Claude Code, answer no — material then comes from git, file changes and manual notes. Setup ends by writing `config.json` into the data directory and creating the scheduled task.

## Configuration

`config.json` lives in the data directory (`~/.worklog/` by default), not in the repository. See [config.example.json](config.example.json). All keys:

| Key | Default | Meaning |
|---|---|---|
| `watch_dirs` | `[]` | root directories scanned for file changes |
| `ignore` | `.git, node_modules, …` | ignore patterns for the scan |
| `max_files_per_dir` | `40` | max files listed per directory in the material |
| `generator` | required (setup writes it) | `{type:"api", protocol:"openai"\|"anthropic", base_url, api_key_env, model}` or `{type:"claude-cli", model?}` |
| `claude_args` | `[]` | extra args passed through to the Claude CLI generator |
| `deliver` | `[]` | array of deliver channels; empty = local archive only |

Environment variables: `WORKLOG_DIR` (data dir, default `~/.worklog`), `WORKLOG_SKIP` (`1` skips capture — the claude-cli generator sets it while running), `WORKLOG_REDACT` (`0` disables redaction), `WORKLOG_MAX_PROMPT=1200`, `WORKLOG_MAX_REPLY=2000`, `WORKLOG_SMTP_PASS` (SMTP password), plus the variable named by `generator.api_key_env` for the API key.

## Generators

Two built-in generators; setup picks a default based on your environment (recommends `claude-cli` when the Claude CLI is installed):

- **`api`** — direct HTTP call to an LLM API. Two protocols:
  - `openai` — OpenAI-compatible (`/chat/completions`)
  - `anthropic` — Anthropic-compatible (`/v1/messages`)

  Provider presets:

  | Preset | Protocols | base_url |
  |---|---|---|
  | `deepseek` | openai / anthropic | `https://api.deepseek.com/v1` / `https://api.deepseek.com/anthropic` |
  | `openai` | openai | `https://api.openai.com/v1` |
  | `anthropic` | anthropic | `https://api.anthropic.com` |
  | `qwen` | openai | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
  | `glm` | openai | `https://open.bigmodel.cn/api/paas/v4` |

  Or choose "custom" in setup and enter any `base_url` + protocol. The API key is read only from the environment variable named by `api_key_env` — never stored in `config.json`. Failed requests retry twice.

- **`claude-cli`** — invokes the Claude CLI (`claude -p "/daily-report <day>" --permission-mode acceptEdits`), reusing your existing Claude Code login. Optional `model` in the generator config; `claude_args` is passed through. On Windows the spawn handles `claude.cmd`.

## Deliver channels

`deliver` is an array; configure any number of channels. See [docs/deliver-channels.zh.md](docs/deliver-channels.zh.md) (in Chinese) for the per-channel fields, WeCom/Feishu bot setup steps and chunking behavior. Summary:

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

Long reports are chunked at 4096 bytes on blank-line boundaries, so every message ends on a complete paragraph/list/code block. (4096 is the WeCom markdown message limit; Feishu's official webhook limit is higher, and this tool conservatively chunks there too.) A failing channel never blocks the others, and the report is always saved locally under `reports/`.

## CLI

| Command | Purpose |
|---|---|
| `node bin/setup.mjs` | interactive installer (config + hooks + scheduled task) |
| `node bin/collect.mjs [YYYY-MM-DD] [--json]` | gather the day's material |
| `node bin/generate.mjs [YYYY-MM-DD]` | generate the report to stdout |
| `node bin/run-daily.mjs [--date YYYY-MM-DD] [--dry-run]` | scheduled entry: generate missing days, write `reports/`, deliver, log |
| `node bin/add.mjs "文本"` | append a manual note to today's material |
| `node bin/deliver.mjs <报告路径>` | deliver an existing report via configured channels |

Inside Claude Code you can also say "写日报" or run `/daily-report [日期]` (skill).

## Docs

- [docs/setup-guide.zh.md](docs/setup-guide.zh.md) — setup wizard walkthrough (in Chinese)
- [docs/deliver-channels.zh.md](docs/deliver-channels.zh.md) — channel configuration (in Chinese)
- [docs/adapter-guide.md](docs/adapter-guide.md) — capture adapter interface for developers (in Chinese)

## FAQ

**Where is my data stored?** In `~/.worklog/` (override with `WORKLOG_DIR`): `<day>.jsonl` worklog streams, `notes.md` manual notes, `reports/<day>.md` generated reports, `run.log` run log, and `config.json`. The directory is outside the repository, and the repo's `.gitignore` guards against accidental commits.

**How do I switch AI providers?** Edit `generator` in `~/.worklog/config.json` (preset or custom `base_url`, `protocol`, `model`, `api_key_env`), or re-run `node bin/setup.mjs`. Put the key in the environment variable named by `api_key_env`.

**I use CC Switch to manage Claude Code providers. Anything to watch out for?** CC Switch rewrites `~/.claude/settings.json` when you switch providers, which can wipe hooks registered there by the clone path. The plugin path is unaffected — its hooks live in the plugin, not in `settings.json`. If you are on the clone path and the hooks disappear, re-run `node bin/setup.mjs` to re-register them, or switch to the plugin path.

**Windows users** need Node.js ≥ 18; spawning the Claude CLI handles `claude.cmd` automatically.

## Development

Zero npm dependencies. Tests use `node:test`:

```
node --test
```

CI runs the suite on ubuntu / macos / windows × Node 18 / 20 / 22 (`.github/workflows/test.yml`).

## License

[MIT](LICENSE)
