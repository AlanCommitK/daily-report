// 日期工具：全部函数接受可注入的 now，测试用固定日期，不依赖真实时钟。

export function today(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now + 'T12:00:00')
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

export function nowIso(now = new Date()) {
  const d = now instanceof Date ? now : new Date()
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  const tz = sign + String(Math.floor(abs / 60)).padStart(2, '0') + ':' + String(abs % 60).padStart(2, '0')
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${tz}`
}

export function dayList(now = new Date(), days) {
  const out = []
  for (let i = 0; i < days; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    out.push(today(d))
  }
  return out
}

export function mtimeDay(ms) { return today(new Date(ms)) }
