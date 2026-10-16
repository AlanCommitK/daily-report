import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redact } from '../bin/lib/redact.mjs'

test('sk- API key', () => {
  assert.equal(redact('key=sk-abcdefghijklmnopqrstuvwxyz123456'), 'key=<REDACTED:api-key>')
})
test('github token 三种前缀', () => {
  assert.equal(redact('ghp_abcdefghijklmnopqrstuvwxyz123456'), '<REDACTED:gh-token>')
  assert.equal(redact('github_pat_abcdefghijklmnopqrstuvwxyz123456'), '<REDACTED:gh-token>')
})
test('slack token', () => {
  assert.equal(redact('xoxb-1234567890-abcdefghij'), '<REDACTED:slack-token>')
})
test('aws key', () => {
  assert.equal(redact('AKIAIOSFODNN7EXAMPLE'), '<REDACTED:aws-key>')
})
test('jwt', () => {
  assert.equal(redact('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'), '<REDACTED:jwt>')
})
test('private key 块', () => {
  assert.equal(redact('-----BEGIN RSA PRIVATE KEY-----'), '<REDACTED:private-key>')
})
test('键值对通用规则', () => {
  assert.equal(redact('password: hunter2secret'), 'password=<REDACTED>')
  assert.equal(redact('API_KEY="abcdefg"'), 'API_KEY=<REDACTED>')
})
test('普通文本不误伤', () => {
  const t = '今天写了登录模块，修了 bug，提交了 3 次'
  assert.equal(redact(t), t)
})
