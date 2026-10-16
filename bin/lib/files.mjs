// 文件变更扫描：watchDirs 下当天 mtime 的文件，按一级子目录聚合。
// 读取失败一律跳过（权限、目录消失等），扫描永不抛异常。

import fs from 'node:fs'
import path from 'node:path'
import { mtimeDay } from './date.mjs'

// ignore 模式 → 正则：* 展开为 .*，其余字符按字面匹配（子串语义，与参考实现一致）
function patternRe(p) {
  return new RegExp(p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'))
}

export function scanDayChanges(watchDirs, day, maxPerDir, ignore, now) {
  const byGroup = new Map()
  const patterns = (Array.isArray(ignore) ? ignore : [])
    .filter((p) => typeof p === 'string' && p !== '')
    .map(patternRe)
  // 上限取 now：mtime 在"未来"（时钟偏移产生的脏数据）不算当天成果
  const cutoff = now instanceof Date ? now.getTime() : Infinity
  const matches = (name) => patterns.some((re) => re.test(name))

  const walk = (dir, group, isRoot) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === '.git' || matches(e.name)) continue
        // 一级子目录成为新的聚合键；更深层文件仍归该目录
        walk(full, isRoot ? full : group, false)
      } else {
        if (matches(e.name)) continue
        let m
        try { m = fs.statSync(full).mtimeMs } catch { continue }
        if (mtimeDay(m) !== day || m > cutoff) continue
        if (!byGroup.has(group)) byGroup.set(group, [])
        byGroup.get(group).push({ m, rel: path.relative(group, full) })
      }
    }
  }

  for (const root of Array.isArray(watchDirs) ? watchDirs : []) {
    if (typeof root === 'string' && root) walk(root, root, true)
  }

  const out = {}
  for (const [group, hits] of byGroup) {
    hits.sort((a, b) => b.m - a.m)
    if (hits.length > maxPerDir) {
      const cut = hits.splice(maxPerDir)
      hits.push(`…（其余 ${cut.length} 个文件略）`)
    }
    out[group] = hits.map((h) => typeof h === 'string' ? h : h.rel)
  }
  return out
}
