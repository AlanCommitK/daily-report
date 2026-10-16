import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig, DEFAULT_IGNORE } from '../bin/lib/config.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('缺文件返回默认配置', () => {
  const cfg = loadConfig(fs.mkdtempSync(path.join(os.tmpdir(), 'dr-')))
  assert.deepEqual(cfg.watch_dirs, [])
  assert.ok(cfg.ignore.length > 0)
  assert.equal(cfg.max_files_per_dir, 40)
  assert.equal(cfg.generator, null)
})
test('坏 JSON 返回默认', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  fs.writeFileSync(path.join(d, 'config.json'), '{ bad')
  assert.equal(loadConfig(d).generator, null)
})
test('正常配置合并默认值', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'))
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ watch_dirs: ['C:/w'], generator: { type: 'api', protocol: 'openai', base_url: 'http://x', api_key_env: 'K', model: 'm' } }))
  const cfg = loadConfig(d)
  assert.equal(cfg.watch_dirs[0], 'C:/w')
  assert.equal(cfg.generator.model, 'm')
  assert.equal(cfg.max_files_per_dir, 40)
})
