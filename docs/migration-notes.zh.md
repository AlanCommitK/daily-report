# 作者本机迁移实录（2026-10-16）

本文件记录作者（本仓库 owner）把本机日报系统从"手工安装 skill + 手工 hooks"迁移到"自装插件"的过程与结果。普通用户无需迁移，参考 README 安装即可。

## 迁移前状态

- 采集 hook：3 条手工注册于 `~/.claude/settings.json`（powershell 调 capture.ps1，受 CC Switch 整体重写威胁）
- 计划任务：ClaudeDailyReport（周一至五 18:00，执行 `~/.claude/skills/daily-report/scripts/run-daily.ps1`）+ ClaudeHooksGuard（每日 09:05 自愈 hooks）
- 数据：`~/.worklog/`（18 份流水、18 份报告、notes.md、config.json）

## 迁移步骤与结果

1. **插件安装**：`claude plugin marketplace add <仓库本地路径>` + `claude plugin install daily-report@daily-report-marketplace`（user 作用域）。settings.json 写入 `enabledPlugins` 与 `extraKnownMarketplaces`。
2. **旧 hooks 移除**：用本仓库 `bin/lib/settings.mjs` 的 `removeReportHooks` 移除 3 条日报 hook（自动备份），superpowers/UA hooks 保留。**CC Switch 抹 hooks 问题就此根治**——日报采集不再依赖 settings.json 的 hooks 键。
3. **hooks-guard 更新**：模板移除日报三条；guard 扩展"插件键防护"（enabledPlugins / extraKnownMarketplaces 丢失时按模板补回），防止 CC Switch 重写后插件静默失效。
4. **计划任务重建**：删除旧 ClaudeDailyReport，按 `bin/lib/scheduler.mjs` 重建（`node <仓库>/bin/run-daily.mjs`，周一至五 18:00）。ClaudeHooksGuard 保留。
5. **配置**：`~/.worklog/config.json` 增加 `generator: {type:"claude-cli", model:"sonnet"}`（保持原行为）。api 直调 DeepSeek 留待后续实测切换。
6. **链路实测**：手动运行 `node bin/run-daily.mjs --date 2026-10-16` 端到端成功。实测中发现并修复一处集成缺陷（claude-cli 生成器"stdout 即报告"与 skill 实际行为冲突——skill 落盘报告、stdout 为回报语；修复为优先读回 skill 落盘文件，commit 216583b）。

## 遗留事项

- api 生成器直调（DeepSeek OpenAI 兼容端点）本机实测——需配置 `DAILY_REPORT_API_KEY` 环境变量
- CC Switch 下次切换供应商后观察：enabledPlugins/extraKnownMarketplaces 是否被保留（guard 已加防护，实际行为待验证）
