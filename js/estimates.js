import { weeksBetween } from './time.js'

// 30 credits at 10 hours a credit is 300 hours
export function moduleHours(module, hoursPerCredit) {
  return module.credits * hoursPerCredit
}

// spread evenly from start to end
export function suggestedWeekly(module, hoursPerCredit) {
  return moduleHours(module, hoursPerCredit) / weeksBetween(module.start, module.end)
}

// the user's own weekly hours if set, otherwise the suggestion
export function weeklyHours(module, hoursPerCredit) {
  return module.weekly_hours > 0 ? module.weekly_hours : suggestedWeekly(module, hoursPerCredit)
}

export function oneDecimal(n) {
  return Math.round(n * 10) / 10
}
