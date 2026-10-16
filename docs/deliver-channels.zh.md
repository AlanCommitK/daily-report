# 投递渠道配置

`config.json` 的 `deliver` 是数组，每条一个渠道，可配任意多个。单渠道失败不阻塞其余（记入 `run.log`），日报永远先落本地 `reports/`。webhook url 含密钥，`config.json` 不进 git（仓库 `.gitignore` 已排除）。

## 字段速查

### copy — 本地归档

| 字段 | 必填 | 说明 |
|---|---|---|
| `type` | 是 | `"copy"` |
| `to` | 是 | 归档目录（不存在自动创建），报告按原文件名复制过去 |

```json
{ "type": "copy", "to": "D:/日报存档" }
```

### smtp — 邮件（系统 curl 发送，零依赖）

| 字段 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `type` | 是 | | `"smtp"` |
| `host` | 是 | | SMTP 服务器地址 |
| `port` | 否 | `465`（starttls 时 `587`） | 端口 |
| `user` | 是 | | 登录用户名（邮箱） |
| `password_env` | 是 | | 密码所在的环境变量名（如 `WORKLOG_SMTP_PASS`），密码不落盘 |
| `to` | 是 | | 收件人数组 |
| `from` | 否 | 同 `user` | 发件人 |
| `starttls` | 否 | `false` | `true` 走 `smtp://` + STARTTLS（默认端口 587）；`false` 走 `smtps://` 直连（默认端口 465） |

```json
{ "type": "smtp", "host": "smtp.example.com", "port": 465,
  "user": "me@example.com", "password_env": "WORKLOG_SMTP_PASS",
  "to": ["boss@example.com"], "from": "me@example.com" }
```

注意：`starttls` 需手动编辑 config.json 配置（setup 向导未询问）。

### wecom — 企业微信群机器人

| 字段 | 必填 | 说明 |
|---|---|---|
| `type` | 是 | `"wecom"` |
| `url` | 是 | 群机器人 webhook 地址 |

```json
{ "type": "wecom", "url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." }
```

### feishu — 飞书群机器人

| 字段 | 必填 | 说明 |
|---|---|---|
| `type` | 是 | `"feishu"` |
| `url` | 是 | 群机器人 webhook 地址 |

```json
{ "type": "feishu", "url": "https://open.feishu.cn/open-apis/bot/v2/hook/..." }
```

## 机器人创建步骤

### 企业微信（wecom）

1. 打开目标群聊 → 右上角 `···` → 群机器人。
2. 添加机器人（若列表无入口，需联系群主 / 管理员开通）。
3. 创建后复制 Webhook 地址（形如 `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...`），填入 `url`。
4. 安全设置：本渠道未实现签名校验，不要开启"签名校验"；关键词 / IP 白名单可按需配置。

### 飞书（feishu）

1. 打开目标群 → 设置 → 群机器人 → 添加机器人 → 自定义机器人。
2. 创建后复制 Webhook 地址（形如 `https://open.feishu.cn/open-apis/bot/v2/hook/...`），填入 `url`。
3. 安全设置：本渠道未实现签名，不要勾选"签名校验"（勾选后消息会被拒）；可按需配置关键词或 IP 白名单。

## 长文分片行为

企业微信与飞书的单条消息上限为 4096 字节（UTF-8）。超长日报会自动分片，规则：

- **按空行边界切分**：以段落 / 列表 / 代码块为单位，不从句子中间切断；分片前先把 `\r\n` 归一化为 `\n`（Windows 编辑的日报不会因换行符导致整段不切）。
- **wecom**：按原文 4096 字节切分，每片发一条 markdown 消息。
- **feishu**：同样按段落贪心打包，但按**最终消息体字节数**（含标题与 post 富文本包裹）计量，保证每个 POST 的 content JSON ≤ 4096 字节；每片发一条 post 富文本消息，标题一致。
- 单个超长段落（无空行可切）会整段保留，可能略超上限。
- 结果：群内按序收到多条消息，每条都是完整段落 / 列表 / 代码块。

## 行为约定

- 投递顺序 = `deliver` 数组顺序；某渠道失败记录到 `run.log`，其余渠道继续。
- 不配 `deliver`（空数组）= 仅本地留档 `reports/`。
- 所有密钥只从环境变量读（smtp 的 `password_env`），config.json 无明文密钥。
