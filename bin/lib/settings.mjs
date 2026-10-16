// settings.json 读写（克隆安装路径的 hooks 注册与本机迁移清理）。
// 只增改 hooks 键，其余键原样保留；任何变更前先备份 p 为 p.bak-<时间戳>。
// 幂等：同事件同命令已存在则跳过。写回 JSON 2 空格缩进。

import fs from 'node:fs'
import path from 'node:path'

const EVENT_KEYS = ['UserPromptSubmit', 'Stop', 'PostToolUse']

export function loadSettings(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return {}
  }
}

function backup(p, now) {
  const ts = now instanceof Date ? now.getTime() : Date.now()
  const bak = p + '.bak-' + ts
  try { fs.copyFileSync(p, bak) } catch { /* 原文件不存在则无备份 */ }
  return bak
}

function write(p, settings) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(settings, null, 2) + '\n', 'utf8')
}

function commandOf(entry) {
  return (entry && Array.isArray(entry.hooks) ? entry.hooks : [])
    .filter((h) => h && h.type === 'command')
    .map((h) => h.command)
}

// 事件数组中是否已有同命令条目（幂等判定）
function hasCommand(list, cmd) {
  return (list || []).some((e) => commandOf(e).includes(cmd))
}

// 注册采集 hooks：hookCmds = { UserPromptSubmit: cmd, Stop: cmd, PostToolUse: cmd }。
// 返回 { settings, changed }：changed=false 表示同命令已存在（无备份、未写盘），
// 供调用方（setup）按实际是否写盘决定文案，不再无凭声称"已备份"。
export function registerHooks(p, hookCmds, now) {
  const settings = loadSettings(p)
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {}
  let changed = false
  for (const evt of EVENT_KEYS) {
    const cmd = hookCmds && hookCmds[evt]
    if (!cmd) continue
    const list = Array.isArray(hooks[evt]) ? hooks[evt] : []
    if (!hasCommand(list, cmd)) {
      list.push({ hooks: [{ type: 'command', command: cmd, timeout: 10 }] })
      changed = true
    }
    hooks[evt] = list
  }
  if (changed) {
    backup(p, now)
    settings.hooks = hooks
    write(p, settings)
  }
  return { settings, changed }
}

// 移除三事件中含 daily-report 路径的条目（本机迁移：改由插件提供后清理手工 hook）。
// 清空的事件键一并删除；其他事件与无关键不动。返回写回后的 settings 对象。
export function removeReportHooks(p, now) {
  const settings = loadSettings(p)
  const hooks = settings.hooks
  if (!hooks || typeof hooks !== 'object') return settings
  let changed = false
  for (const evt of EVENT_KEYS) {
    const list = hooks[evt]
    if (!Array.isArray(list)) continue
    const kept = list.filter((e) => !commandOf(e).some((c) => String(c).includes('daily-report')))
    if (kept.length !== list.length) changed = true
    if (kept.length) hooks[evt] = kept
    else delete hooks[evt]
  }
  if (changed) {
    backup(p, now)
    write(p, settings)
  }
  return settings
}
