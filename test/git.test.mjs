import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listRepos, dayCommits, dirtyStatus } from '../bin/lib/git.mjs'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function initRepo(dir, name) {
  const repo = path.join(dir, name)
  fs.mkdirSync(repo, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: repo })
  execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 'tester'], { cwd: repo })
  return repo
}
const envD = (day) => ({ ...process.env, GIT_AUTHOR_DATE: day + 'T10:00:00', GIT_COMMITTER_DATE: day + 'T10:00:00' })

test('listRepos 找到子目录仓库', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  initRepo(d, 'proj')
  assert.ok(listRepos([d]).some((r) => r.endsWith('proj')))
})
test('dayCommits 只取指定日提交', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const repo = initRepo(d, 'proj')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'v1')
  execFileSync('git', ['add', '-A'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'day one'], { cwd: repo, env: envD('2026-10-14') })
  fs.writeFileSync(path.join(repo, 'a.txt'), 'v2')
  execFileSync('git', ['add', '-A'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'day two'], { cwd: repo, env: envD('2026-10-15') })
  const c14 = dayCommits(repo, '2026-10-14')
  const c15 = dayCommits(repo, '2026-10-15')
  assert.ok(c14.includes('day one'))
  assert.ok(!c14.includes('day two'))
  assert.ok(c15.includes('day two'))
})
test('dayCommits 只取仓库 user.email 作者的提交', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const repo = initRepo(d, 'proj')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'v1')
  execFileSync('git', ['add', '-A'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'my commit'], { cwd: repo, env: envD('2026-10-14') })
  execFileSync('git', ['config', 'user.email', 'other@t.com'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 'other'], { cwd: repo })
  fs.writeFileSync(path.join(repo, 'a.txt'), 'v2')
  execFileSync('git', ['add', '-A'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'other commit'], { cwd: repo, env: envD('2026-10-14') })
  execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 'tester'], { cwd: repo })
  const c = dayCommits(repo, '2026-10-14')
  assert.ok(c.includes('my commit'))
  assert.ok(!c.includes('other commit'))
})
test('dayCommits 不含 merge 提交', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const repo = initRepo(d, 'proj')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'base')
  execFileSync('git', ['add', '-A'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo, env: envD('2026-10-14') })
  execFileSync('git', ['checkout', '-qb', 'feature'], { cwd: repo })
  fs.writeFileSync(path.join(repo, 'b.txt'), 'x')
  execFileSync('git', ['add', '-A'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'feature work'], { cwd: repo, env: envD('2026-10-14') })
  execFileSync('git', ['checkout', '-q', '-'], { cwd: repo })
  fs.writeFileSync(path.join(repo, 'c.txt'), 'x')
  execFileSync('git', ['add', '-A'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'main work'], { cwd: repo, env: envD('2026-10-14') })
  execFileSync('git', ['merge', '--no-ff', '-qm', 'merge feature', 'feature'], { cwd: repo, env: envD('2026-10-14') })
  const c = dayCommits(repo, '2026-10-14')
  assert.ok(c.includes('main work'))
  assert.ok(!c.includes('merge feature'))
})
test('dirtyStatus 检出未提交改动，干净时为空串', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  const repo = initRepo(d, 'proj')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'v1')
  execFileSync('git', ['add', '-A'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo, env: envD('2026-10-01') })
  fs.writeFileSync(path.join(repo, 'a.txt'), 'dirty')
  assert.ok(dirtyStatus(repo).length > 0)
  execFileSync('git', ['checkout', '--', '.'], { cwd: repo })
  assert.equal(dirtyStatus(repo), '')
})
