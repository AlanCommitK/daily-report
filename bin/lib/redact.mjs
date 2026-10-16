// 脱敏：8 条正则规则，与 hooks/capture.ps1 Protect-Text（第 50-59 行）一致，顺序一致。
// 与 PowerShell 参考实现的两处必要差异：
// 1. 第 8 条 PS 用 .NET 内联选项 (?i)；JS 不支持独立 (?i)（(?i:…) 修饰符形式需 Node ≥22，
//    本项目 engines 为 >=18），等价改用 i 标志。
// 2. 第 8 条末尾追加可选引号 ["']?：PS 版只吞掉值前的开引号，替换后残留尾引号
//    （API_KEY="abcdefg" → API_KEY=<REDACTED>"）；按任务测试期望，值的整个引号字面量都应替换
//    （→ API_KEY=<REDACTED>）。实测已确认 PS 行为确为残留尾引号。

const RULES = [
  [/sk-[A-Za-z0-9_\-]{20,}/g, '<REDACTED:api-key>'],
  [/\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}/g, '<REDACTED:gh-token>'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '<REDACTED:gh-token>'],
  [/\bxox[baprs]-[A-Za-z0-9\-]{10,}/g, '<REDACTED:slack-token>'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '<REDACTED:aws-key>'],
  [/\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g, '<REDACTED:jwt>'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, '<REDACTED:private-key>'],
  [/\b(pass(?:word|wd)?|pwd|secret|token|api[_\-]?key|access[_\-]?key)\s*[:=]\s*["']?([^\s"',;]{6,})["']?/gi, '$1=<REDACTED>'],
]

export function redact(t) {
  if (t == null) return t
  let out = t
  for (const [re, rep] of RULES) out = out.replace(re, rep)
  return out
}
