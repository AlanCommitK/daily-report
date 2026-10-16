---
name: daily-report
description: 生成当天的工作日报。从 Claude Code 工作流水、git 提交与未提交改动、文件系统变更、手动补录四路素材汇总成一份中文日报，写入 reports 目录。用户说"写日报""生成今天的日报""总结一下今天做了什么"时使用。也可补生成指定日期的日报。
---

# 工作日报生成

把当天（或指定日期）的工作素材汇总成一份中文日报，写入数据目录 `reports/YYYY-MM-DD.md`。

## 触发方式

- 用户说："写日报""生成今天的日报""总结一下今天做了什么"。
- 斜杠命令：`/daily-report [日期]`、`/日报`。日期格式 `YYYY-MM-DD`，缺省为今天；补生成指定日期同样适用。
- 每日定时任务（run-daily）走自身流程，不经过本 skill。

## 流程

1. **取素材**：运行 `node "${CLAUDE_PLUGIN_ROOT}/bin/collect.mjs" <日期>`（未装插件、在仓库目录直接使用时为 `node bin/collect.mjs <日期>`）。日期缺省为今天，输出 markdown 素材包，含四路素材：Claude Code 工作流水、git 提交与未提交改动、文件系统变更、手记（notes.md 当天节 + add.mjs 补录）。
2. **判定**：素材为空时，直接告诉用户"今天没有记录到的工作"，不编造、不生成报告。
3. **写报告**：按 `${CLAUDE_PLUGIN_ROOT}/prompts/report.md`（仓库内为 `prompts/report.md`；写作规则的唯一来源，勿自行另立规则）的要求撰写中文日报，写入数据目录 `reports/YYYY-MM-DD.md`。
4. **回报**：告诉用户报告已生成，给出完整文件路径。

## 数据目录

默认 `~/.worklog/`（流水、手记、config.json 与 `reports/` 都在其下）；可用环境变量 `WORKLOG_DIR` 覆盖。
