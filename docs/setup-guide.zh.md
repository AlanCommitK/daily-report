# 安装向导（setup）图文说明

`node bin/setup.mjs` 是唯一的安装入口：检测环境 → 采集方式 → 生成器 → 监听目录 → 投递渠道 → 计划任务 → 把 `config.json` 写入数据目录。全程交互问答，括号里是默认值，直接回车即采用。

## 前置条件

- Node.js ≥ 18（版本不够会提示并退出）
- 可选：已安装并登录 Claude Code（装插件或注册 hooks 用）

## 启动

```
git clone https://github.com/<owner>/daily-report && cd daily-report
node bin/setup.mjs
```

## 逐步走一遍（按出现顺序）

1. **数据目录**：打印数据目录（默认 `~/.worklog/`，可用环境变量 `WORKLOG_DIR` 覆盖）并自动创建。之后所有素材、报告、配置都在这里。
2. **采集方式**：
   - 检测到 daily-report 插件已启用 → 自动跳过（hooks 由插件提供，无需注册），只提示一句。
   - 否则询问"是否把采集 hooks 写入 `~/.claude/settings.json`"：克隆安装选是（写入前自动备份 `settings.json.bak-<时间戳>`，幂等可重跑）；没有 Claude Code 或不想动 settings.json 选否（素材只剩 git / 文件变更 / 手记三路）。
3. **生成器**：
   - 检测到 claude CLI → 询问是否用它生成（零配置用现有登录态；可再填模型名，回车留空）。
   - 否则走 LLM API：选 provider 预设（deepseek / openai / anthropic / qwen / glm / 自定义）→ 预设双协议时选协议（openai / anthropic）→ 自定义则填 base_url + 协议 → 填模型名 → 填 API key 环境变量名（默认 `DAILY_REPORT_API_KEY`，密钥只从环境变量读，不落盘）。各预设默认模型：

     | 预设 | 默认模型 |
     |---|---|
     | deepseek | `deepseek-chat` |
     | openai | `gpt-4o-mini` |
     | anthropic | `claude-sonnet-4-5` |
     | qwen | `qwen-plus` |
     | glm | `glm-4-flash` |

4. **监听目录 watch_dirs**：逐项输入要扫描文件变更的工作目录，回车结束（可留空）。
5. **投递渠道**（逐项询问，回车跳过）：
   - copy：日报存档目录
   - smtp：服务器地址 → 端口（默认 465）→ 用户名 → 密码环境变量名（默认 `WORKLOG_SMTP_PASS`）→ 收件人（逗号分隔）→ 发件人（回车同用户名）
   - wecom：企业微信群机器人 webhook url
   - feishu：飞书群机器人 webhook url
   - 一个都不配 = 仅本地留档 `reports/`。
6. **计划任务**：运行时间（默认 18:00）→ 星期 1-7（默认 1,2,3,4,5；1=周一）：
   - Windows：`schtasks` 创建每周任务 `ClaudeDailyReport`；已存在则询问覆盖（加 `/f`）。
   - macOS / Linux：`crontab` 追加 `node <仓库路径>/bin/run-daily.mjs` 行；已有相同行则跳过，已有旧行询问覆盖。
   - 其他平台：提示自行定时运行。
7. **写配置**：把 `{watch_dirs, generator, claude_args, deliver}` 写入 `<数据目录>/config.json`，并提示"立即生成一次"。

## 示例会话

有 Claude Code、选 claude-cli 生成器、copy + wecom 两渠道、Windows 环境：

```
$ node bin/setup.mjs
数据目录: C:\Users\me\.worklog
是否把采集 hooks 写入 C:\Users\me\.claude\settings.json？（克隆安装选是，插件安装选否） [y] y
已注册采集 hooks（UserPromptSubmit/Stop/PostToolUse），原文件已备份为 settings.json.bak-<时间戳>。
检测到 claude CLI，使用它生成日报？ [y] y
生成器: claude-cli
要监听的工作目录（逐项输入，回车结束） C:\Users\me\WorkD
要监听的工作目录（逐项输入，回车结束）
watch_dirs: C:\Users\me\WorkD
copy 渠道：日报存档目录（回车跳过） D:\日报存档
渠道 copy -> D:\日报存档
smtp 渠道：邮件服务器地址（回车跳过）
wecom 渠道：群机器人 webhook url（回车跳过） https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...
渠道 wecom
feishu 渠道：群机器人 webhook url（回车跳过）
投递渠道共 2 个（不配则仅本地留档 reports/）
定时任务运行时间 [18:00]
运行星期 1-7（1=周一，7=周日，逗号分隔） [1,2,3,4,5]
计划任务已创建: schtasks /create /tn ClaudeDailyReport /sc weekly /d MON,TUE,WED,THU,FRI /st 18:00 /tr node "C:\Users\me\daily-report\bin\run-daily.mjs"
配置已写入: C:\Users\me\.worklog\config.json
安装完成。立即生成一次: node C:\Users\me\daily-report\bin\run-daily.mjs
```

没有 claude CLI 时，生成器一步换成预设菜单：

```
1) deepseek  2) openai  3) anthropic  4) qwen  5) glm  6) 自定义
选择 [1-6] 1
模型名 [deepseek-chat]
API key 环境变量名（密钥只从环境变量读取） [DAILY_REPORT_API_KEY]
生成器: api（deepseek / openai / deepseek-chat）
```

## 装完之后

- 立即生成一次：`node bin/run-daily.mjs`（会自动补齐最近几天缺失的日报，最多 3 天）
- 只列待办不动手：`node bin/run-daily.mjs --dry-run`
- 手动补记：`node bin/add.mjs "上午开会写周报"`
- 改配置：直接改 `<数据目录>/config.json`，或重跑 `node bin/setup.mjs` 覆盖

## 常见问题

- **schtasks 创建失败**：向导会打印完整命令，复制到手動执行，或到管理员终端执行。
- **crontab 写入失败**：同样会打印 crontab 行，用 `crontab -e` 手动追加。
- **改主意想换生成器 / 渠道**：重跑 `node bin/setup.mjs` 覆盖 config.json 即可（hooks 注册是幂等的，不会重复）。
- **CC Switch 用户**：克隆路径注册的 hooks 写在 `~/.claude/settings.json`，CC Switch 切换供应商重写该文件可能抹掉 hooks；插件路径无此问题（见 README 常见问题）。
