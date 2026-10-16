// 生成器：把当日素材交给 LLM 产出日报 markdown。
// api 直调（prompts/report.md 作 system、素材包作 user）；claude-cli 交给
// /daily-report skill（落盘 reports/<day>.md，读回为准、stdout 兜底）。
// 写作规则单一来源：prompts/report.md。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMaterial, renderMaterial } from './collect.mjs'
import { loadConfig } from './lib/config.mjs'
import { today } from './lib/date.mjs'
import { chat } from './lib/llm.mjs'
import { runClaude } from './lib/spawnCli.mjs'

const PROMPT_PATH = fileURLToPath(new URL('../prompts/report.md', import.meta.url))

export async function generateReport(day, opts = {}) {
  const cfg = opts.config
  const gen = cfg && cfg.generator
  if (!gen || (gen.type !== 'api' && gen.type !== 'claude-cli')) {
    throw new Error('config.json 未配置可用的 generator（type 应为 api 或 claude-cli），请运行 node bin/setup.mjs 完成配置')
  }
  if (gen.type === 'api') {
    const system = fs.readFileSync(PROMPT_PATH, 'utf8')
    const user = renderMaterial(buildMaterial(day, {
      worklogDir: opts.worklogDir,
      watchDirs: cfg.watch_dirs,
      maxFilesPerDir: cfg.max_files_per_dir,
      ignore: cfg.ignore,
      now: opts.now,
    }))
    const report = await chat(gen, system, user, { fetchImpl: opts.fetchImpl, retryDelays: opts.retryDelays })
    return { report, generatorType: 'api' }
  }
  // claude-cli：claude_args 透传 + 权限模式 + 可选 --model；cwd 设为 worklogDir 供
  // skill 就近写 reports/。WORKLOG_SKIP=1 避免生成过程本身被采集进流水。
  const args = ['-p', '/daily-report ' + day, '--permission-mode', 'acceptEdits']
  if (gen.model) args.push('--model', gen.model)
  if (Array.isArray(cfg.claude_args)) args.push(...cfg.claude_args)
  const stdout = (opts.spawnImpl || runClaude)(args, { cwd: opts.worklogDir, env: { WORKLOG_SKIP: '1' } })
  // 落盘由 skill 负责（reports/<day>.md），stdout 只是回报语：优先读回落盘内容，
  // 与 run-daily 再写一遍保持幂等；文件不存在或读失败才退回 stdout。
  try {
    const report = fs.readFileSync(path.join(opts.worklogDir, 'reports', day + '.md'), 'utf8')
    return { report, generatorType: 'claude-cli' }
  } catch {
    return { report: stdout, generatorType: 'claude-cli' }
  }
}

// CLI：node bin/generate.mjs <day>（--date 与位置参数同义），报告输出到 stdout。
export async function main() {
  const args = process.argv.slice(2)
  let dayArg
  const di = args.indexOf('--date')
  if (di !== -1) dayArg = args[di + 1]
  else dayArg = args.find((a) => !a.startsWith('-'))
  const day = dayArg || today(new Date())
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    console.error('日期格式应为 YYYY-MM-DD')
    process.exit(2)
  }
  const dir = process.env.WORKLOG_DIR || path.join(process.env.USERPROFILE || process.env.HOME || '', '.worklog')
  const cfg = loadConfig(dir)
  const r = await generateReport(day, { config: cfg, worklogDir: dir, now: new Date() })
  process.stdout.write(r.report + '\n')
}

// 直接执行时进 CLI 入口；被 import（测试 / run-daily）时不触发。
{
  const argv1 = process.argv[1]
  if (argv1) {
    let a = path.resolve(argv1)
    let b = fileURLToPath(import.meta.url)
    if (process.platform === 'win32') { a = a.toLowerCase(); b = b.toLowerCase() }
    if (a === b) main().catch((e) => { console.error(e.message || e); process.exit(1) })
  }
}
