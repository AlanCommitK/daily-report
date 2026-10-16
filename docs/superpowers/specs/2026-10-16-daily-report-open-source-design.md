# 日报项目开源化设计（daily-report）v2

日期：2026-10-16
状态：待用户审阅（v2：按用户反馈改为通用定位，不绑定 Claude Code）

## 1. 产品定位

**一个通用的工作日报生成器**：从多个采集源拿素材 → 汇总 → 交给 LLM 生成中文日报 → 投递（本地/邮件/企业微信/飞书）。

- 核心链路（素材汇总、生成、投递、定时）**不依赖任何特定 agent**：没装 Claude Code 也能用（素材来自 git 提交、文件变更、手记；生成靠用户自填的 LLM API）。
- Claude Code 是**首选采集适配器**（提供"你问了什么/改了哪些文件"的对话级流水，信息最全），通过插件安装，是众多接入方式中的一种。
- 其他 agent（Codex/Cursor/Trae 等）：采集适配器做成扩展点，留接口文档，按需接入。
- 自由度三层扩展点：**采集适配器 / 生成器 / 投递渠道**，各自有统一接口，加新成员只需加一个文件。

## 2. 架构（三层扩展点）

```
daily-report/
├── bin/                          # 核心脚本（Node 18+，零 npm 依赖）
│   ├── capture/                  # ① 采集适配器层（统一接口：产出流水行）
│   │   └── claude-code.mjs       #    Claude Code hook 适配（内置）
│   ├── collect.mjs               # 素材汇聚：流水 + git + 文件变更 + 手记 → 素材包
│   ├── generate.mjs              # ② 生成器（见 §4，LLM API 直调为主）
│   ├── run-daily.mjs             # 定时入口：判定哪些日期要生成 → 逐日生成
│   ├── deliver.mjs               # ③ 投递（channels/ 下四渠道）
│   └── setup.mjs                 # 交互式安装器（采集方式/生成器/渠道/计划任务）
├── channels/                     # 投递渠道：copy / smtp / wecom / feishu
├── providers/                    # LLM 预设（base_url 模板）：deepseek / openai 兼容 / anthropic 兼容 / 自定义
├── prompts/report.md             # 日报写作规则（单一来源，skill 与 generate.mjs 共用）
├── skills/daily-report/SKILL.md  # Claude Code skill（“写日报”触发；规则引用 prompts/report.md）
├── hooks/hooks.json              # Claude Code 采集 hook 声明
├── .claude-plugin/               # 插件薄壳（Claude Code 用户两条命令装完，可选）
│   ├── plugin.json
│   └── marketplace.json
├── config.example.json
├── test/                         # node:test
├── docs/                         # 中英双语文档
├── README.md / README.zh.md
├── LICENSE                       # MIT
└── .github/workflows/test.yml    # 三平台 CI
```

四种典型用法（同一份代码）：

| 用户类型 | 采集 | 生成 | 安装 |
|---|---|---|---|
| Claude Code 用户（信息最全） | Claude Code 流水 hook | 自填 LLM API（或 claude CLI） | `/plugin marketplace add <owner>/daily-report` + `/plugin install daily-report@daily-report-marketplace` + setup |
| 无 Claude Code 的普通用户 | git / 文件变更 / 手记 | 自填 LLM API | `git clone` + `node bin/setup.mjs` |
| 其他 agent 用户 | 未来写适配器接入 | 自填 LLM API | `git clone` + setup |
| 已有 claude CLI 的老用户 | Claude Code 流水 hook | claude CLI（保留兼容） | 同第一行 |

（注：`@` 后缀为 marketplace.json 的 name 字段，非 GitHub 仓库路径。）

## 3. 关键设计决策

1. **统一 Node 重写，零 npm 依赖**（Node 18+ 内置 fetch 直调 LLM API；SMTP 用系统 curl；测试用 node:test）。
2. **生成器可插拔**，两种内置、同等可选，setup 按环境推荐默认值（检测到 claude CLI 则推荐 claude-cli，否则推荐 api）：
   - `claude-cli`：调用 claude CLI 生成（现有行为；装 Claude Code 的用户零配置直接用现有登录态）。
   - `api`：直调 LLM API。支持 **OpenAI 兼容**与 **Anthropic 兼容**两种协议（DeepSeek、Qwen、GLM、OpenAI、Claude 系列全覆盖）。配置项：base_url、api_key_env（密钥只从环境变量读）、model、协议。内置常用 provider 预设（setup 时下拉选择，也可自定义 base_url）。
   - 重试与超时内置（失败自动重试 2 次）。
3. **采集适配器接口**：统一产出流水行（ts/kind/cwd/session/turn/text）。内置 claude-code 适配器（hook 三事件）。**适配器接口规范文档随首发交付**（agent 接入是产品核心考量，docs/ 下单列《采集适配器开发指南》）；Codex/Cursor/Trae 等具体实现按需后补。
4. **手动补录**：`node bin/add.mjs "上午开会写周报"` 随时补记一条手记进当日素材（无 agent 场景下手动补录是重要自由度）。
5. **hooks 双路径**：插件用户由插件自动注册（hooks 不写 settings.json，根治 CC Switch 抹 hooks 问题）；克隆用户由 setup.mjs 写入（先备份、幂等）。
6. **计划任务**由 setup.mjs 交互创建（Windows schtasks / macOS crontab / Linux crontab，默认工作日 18:00，可选时间）。插件机制无安装时代码通道（已查证），此步无法省略。
7. **写作规则单一来源**：prompts/report.md 一份文件，skill 与 api 生成器都读它，改一处两边生效。
8. **发版**：递增 plugin.json 的 version（插件机制靠版本号刷新缓存）+ git tag；clone 用户 git pull。
9. **数据兼容**：worklog 数据格式与现版本一致，老用户数据无损。
10. **Windows 细节**：spawn claude CLI 时处理 `claude.cmd`（现有 py 版缺陷），统一封装 spawnCli。

## 4. 素材四路（无 agent 场景的三路）

| 素材 | 来源 | 无 Claude Code 时 |
|---|---|---|
| A 工作流水 | Claude Code hook 采集（prompt/改文件/回复） | 无（或由未来其他 agent 适配器提供） |
| B git 提交与未提交改动 | 各仓库 git 日志（按作者过滤） | ✓ 有 |
| C 文件变更 | watch_dirs 的 mtime 扫描（"今天干没干活"兜底） | ✓ 有 |
| D 手记 | notes.md 当天节 + `add.mjs` 补录 | ✓ 有 |

## 5. 投递渠道（copy / smtp / wecom / feishu）

config.json 的 `deliver` 为数组，每条一个渠道，可多配：

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

- 每渠道一个模块文件（统一接口 `send(cfg, reportText)`），加渠道=加文件。
- **长文分片**：本工具对 webhook 渠道统一按 4096 字节保守分片——企业微信 markdown 官方上限即为 4096 字节；飞书官方上限更高（约 20KB），本工具同样按 4096 分片。超长按空行边界切段逐条发送（每段是完整段落/列表/代码块）。分片逻辑在公共模块，两渠道共用。
- 失败不阻塞：某渠道失败记日志、其余继续；日报永远落本地 reports/。
- webhook URL 含密钥：文档明确提示 config.json 不进 git。

## 6. 配置设计（config.json 全键）

| 键 | 默认 | 说明 |
|---|---|---|
| `watch_dirs` | `[]` | 文件变更扫描根目录（素材 C） |
| `ignore` | `.git, node_modules, …` | 扫描忽略 |
| `max_files_per_dir` | 40 | 素材里每目录最多列文件数 |
| `generator` | 必填（setup 引导配置） | `{type:"api", protocol:"openai"|"anthropic", base_url, api_key_env, model}` 或 `{type:"claude-cli", model}` |
| `claude_args` | `[]` | claude-cli 生成器透传参数 |
| `deliver` | `[]` | 投递渠道数组；不配=仅本地留档 |

环境变量：`WORKLOG_DIR`（默认 `~/.worklog`）、`WORKLOG_SKIP`、`WORKLOG_REDACT`、`WORKLOG_MAX_PROMPT=1200`、`WORKLOG_MAX_REPLY=2000`、`WORKLOG_SMTP_PASS`、以及生成器的 `api_key_env` 指定的密钥变量。

## 7. 安全与隐私

- 采集 hook 保留现有脱敏（API key/GitHub token/密码/JWT 正则替换），**写入即脱敏**；生成与投递链路同样过脱敏。
- 所有密钥只从环境变量读（api_key_env / password_env），config.json 无明文密钥。
- hook 设计约束沿用：绝对静默、绝不失败（异常吞掉退 0）、UTF-8 无 BOM。
- 数据目录 `~/.worklog/` 与仓库分离，.gitignore 防误提交。

## 8. 测试与 CI

node:test 覆盖：
- capture：脱敏、截断、/daily-report 轮次跳过、notes.md 标题追加、适配器接口
- collect：四路素材判定与拼装
- generate：两种协议请求构造（起本地临时 HTTP server 做 mock）、重试、超时、prompt 模板渲染
- deliver：渠道渲染、4096 分片、webhook 请求 mock、SMTP 参数校验
- run-daily：日期判定（当天恒生成、历史补生成、素材新于日报才重生成、手改保护）
- add：补录写入格式

CI（GitHub Actions）：ubuntu / macos / windows 三平台跑 `node --test`，时区敏感断言固定时区。

## 9. 文档

- README.md（英文为主，≥40 词）+ README.zh.md（中文）：四种用户类型的安装路径、setup 向导、配置表、渠道配法、**"给其他 agent 写采集适配器"接口文档入口**、常见问题。
- docs/：渠道配置图文、适配器接口规范、升级指引。

## 10. 作者本机迁移（实施最后一步）

1. 本机以插件路径安装自己的仓库（dogfooding）。
2. settings.json 三条手工日报 hook 移除（改由插件提供）→ CC Switch 抹 hooks 根治；hooks-guard 模板同步更新。
3. 计划任务 ClaudeDailyReport 用新 setup.mjs 重建；ClaudeHooksGuard 保留（继续守护 superpowers/UA）。
4. `~/.worklog/` 数据不动，历史无损。
5. 生成器迁移时二选一实测：DeepSeek API 直调（更快更省，推荐）或保留 claude-cli。
6. 迁移后实测完整链路一天（采集→定时生成→投递）再收尾。

## 11. 发布清单（首次 push 前逐项打勾）

- [ ] README / marketplace / 文档中的 `<owner>` 占位替换为实际 GitHub 用户名
- [ ] 3 处示例硬编码改为通用占位（D:/OneDrive 路径、QQ 邮箱示例）
- [ ] LICENSE（MIT）就位
- [ ] README.md ≥40 词；中文版同步
- [ ] `claude plugin validate --strict` 通过
- [ ] 三平台 CI 绿
- [ ] config.example.json 无真实密钥/路径
- [ ] plugin.json 初始 version 0.1.0

## 12. 明确不做（YAGNI）

- Codex/Cursor/Trae 适配器的实际实现——接口规范文档首发交付，具体实现等真实需求
- npm 发布、上架 Anthropic 官方目录——后续可选
- 日报内容上云/多机同步——数据本机是隐私卖点
- Web 界面/看板——本地 markdown + 投递已覆盖
