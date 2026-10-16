// copy 渠道：把报告文件复制到归档目录（目录自动创建，目标名取源文件 basename）。
// 无 reportPath（报告仅以文本传入）时，把文本落盘为 日报.txt。

import fs from 'node:fs'
import path from 'node:path'

export async function send(cfg, reportText, opts = {}) {
  fs.mkdirSync(cfg.to, { recursive: true })
  if (opts.reportPath) {
    fs.copyFileSync(opts.reportPath, path.join(cfg.to, path.basename(opts.reportPath)))
  } else {
    fs.writeFileSync(path.join(cfg.to, '日报.txt'), reportText, 'utf8')
  }
}
