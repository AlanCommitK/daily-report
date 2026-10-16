// 手记 notes.md：按 `## YYYY-MM-DD` 分节，节内每行 `- 内容`。
// 写入定位到目标节末尾插入（而非文件末尾），补写旧日期不会串到别的节。
// 与 jsonl 一致：永不抛异常，失败返回 false/''。

import fs from 'node:fs'
import path from 'node:path'
import { today } from './date.mjs'

const ANY_HEAD = /^##\s/

function notesFile(dir) { return path.join(dir, 'notes.md') }

function readNotes(dir) {
  try { return fs.readFileSync(notesFile(dir), 'utf8') } catch { return '' }
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

// 返回 { start, end }：节标题行下标与下一节标题行下标（无下一节则行数）
function findSection(lines, day) {
  const head = new RegExp('^##\\s*' + escapeRe(day) + '\\s*$')
  let start = -1
  let end = lines.length
  for (let i = 0; i < lines.length; i++) {
    if (start < 0) {
      if (head.test(lines[i])) start = i
    } else if (ANY_HEAD.test(lines[i])) { end = i; break }
  }
  return start < 0 ? null : { start, end }
}

// now 仅为与调用方（capture）接口一致而接受；节的选择由 day 决定
export function ensureSection(dir, day, now) {
  try {
    const raw = readNotes(dir)
    if (findSection(raw.split('\n'), day)) return true
    const base = raw.replace(/\s+$/, '')
    const head = '## ' + day + '\n'
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(notesFile(dir), base ? base + '\n\n' + head : head, 'utf8')
    return true
  } catch { return false }
}

export function appendNote(dir, text, now = new Date()) {
  try {
    const day = today(now)
    ensureSection(dir, day, now)
    const lines = readNotes(dir).split('\n')
    const sec = findSection(lines, day)
    if (!sec) return false
    const body = lines.slice(sec.start + 1, sec.end)
    while (body.length && body[body.length - 1].trim() === '') body.pop()
    body.push('- ' + text)
    const out = lines.slice(0, sec.start + 1).concat(body).concat('').concat(lines.slice(sec.end)).join('\n')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(notesFile(dir), out, 'utf8')
    return true
  } catch { return false }
}

export function sectionText(dir, day) {
  try {
    const lines = readNotes(dir).split('\n')
    const sec = findSection(lines, day)
    if (!sec) return ''
    return lines.slice(sec.start + 1, sec.end).join('\n').trim()
  } catch { return '' }
}
