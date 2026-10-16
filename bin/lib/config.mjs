// 配置加载：读 dir/config.json，缺失或损坏时退回默认值，永不抛异常。
// 坏 JSON / 无效 generator 各打一行 stderr 提示，其余情况保持安静。

import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_IGNORE = ['.git', 'node_modules', '__pycache__', '.venv', 'dist', 'build',
  '.next', '.cache', '~$', '.DS_Store', '.obsidian']

const DEFAULTS = {
  watch_dirs: [],
  ignore: DEFAULT_IGNORE,
  max_files_per_dir: 40,
  generator: null,
  claude_args: [],
  deliver: []
}

const GENERATOR_TYPES = ['api', 'claude-cli']

// 每次返回全新对象（ignore 数组也复制），调用方改动不会污染默认值
function defaults() { return { ...DEFAULTS, ignore: [...DEFAULT_IGNORE] } }

export function loadConfig(dir) {
  let text
  try {
    text = fs.readFileSync(path.join(dir, 'config.json'), 'utf8')
  } catch {
    return defaults() // 缺文件（或不可读）：静默用默认
  }
  let raw
  try {
    raw = JSON.parse(text)
  } catch (e) {
    console.error('config.json 解析失败，使用默认配置：' + e.message)
    return defaults()
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    console.error('config.json 格式无效（应为 JSON 对象），使用默认配置')
    return defaults()
  }
  const cfg = { ...defaults(), ...raw }
  const g = cfg.generator
  if (!g || typeof g !== 'object' || !GENERATOR_TYPES.includes(g.type)) {
    console.error('config.json 未配置可用的 generator（type 应为 api 或 claude-cli），请运行 node bin/setup.mjs 完成配置')
    cfg.generator = null
  }
  return cfg
}
