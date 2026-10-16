// 计划任务构造（只构造不执行）：Windows schtasks 参数与 mac/Linux crontab 行。
// weekdays 为 1-7（1=周一 … 7=周日），与 schtasks 的 MON..SUN 一一对应；
// crontab 星期为 0-6（0=周日），故 7 映射为 0。

const WEEKDAY_SCH = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

function normalizeWeekdays(weekdays) {
  if (!Array.isArray(weekdays)) return []
  return [...new Set(weekdays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b)
}

// schtasks：返回 { args, command }；command 为 /tr 的完整命令行（node 带引号脚本路径）。
export function buildSchTasks(name, scriptPath, time, weekdays, now = new Date()) {
  const days = normalizeWeekdays(weekdays)
  const command = 'node "' + scriptPath + '"'
  const args = ['/create', '/tn', name, '/sc', 'weekly']
  if (days.length) args.push('/d', days.map((d) => WEEKDAY_SCH[d - 1]).join(','))
  args.push('/st', time, '/tr', command)
  return { args, command }
}

// crontab：连续星期压成区间（[1,2,3,4,5] → '1-5'）；周日 7 → 0。空数组 → 每天（*）。
// scriptPath 加引号（与 schtasks 的 command 一致）：路径含空格时 cron 行不静默失效。
export function buildCronLine(scriptPath, time, weekdays) {
  const days = normalizeWeekdays(weekdays).map((d) => (d === 7 ? 0 : d))
  const dow = compressRanges(days) || '*'
  const [h, m] = String(time).split(':')
  return Number(m) + ' ' + Number(h) + ' * * ' + dow + ' node "' + scriptPath + '"'
}

function compressRanges(sortedNums) {
  if (!sortedNums.length) return ''
  const parts = []
  let start = sortedNums[0]
  let prev = sortedNums[0]
  for (let i = 1; i <= sortedNums.length; i++) {
    const cur = sortedNums[i]
    if (cur === prev + 1) { prev = cur; continue }
    parts.push(start === prev ? String(start) : start + '-' + prev)
    start = prev = cur
  }
  return parts.join(',')
}
