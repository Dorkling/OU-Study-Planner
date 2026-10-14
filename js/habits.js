import { settings, saveSetting, setDay } from './settings.js'
import { dayPlan } from './freetime.js'
import { dateKey, weekdayOf } from './time.js'

// moving study the same way this many times is enough to ask about it
const enough = 3

const current = () => JSON.parse(JSON.stringify(settings.habits || { off: {}, onto: {}, dismissed: [] }))

// count a block dragged from one weekday to another
export function recordMove(from, to) {
  const zone = settings.timeZone
  const a = weekdayOf(dateKey(from, zone))
  const b = weekdayOf(dateKey(to, zone))
  if (a === b) return
  const habits = current()
  habits.off[a] = (habits.off[a] || 0) + 1
  habits.onto[b] = (habits.onto[b] || 0) + 1
  return saveSetting('habits', habits)
}

// a day study keeps getting moved off becomes only if needed, a day it keeps going to becomes preferred
export function habitSuggestion() {
  const habits = current()
  const asked = id => habits.dismissed.includes(id)
  for (const [weekday, count] of Object.entries(habits.off)) {
    const day = dayPlan(settings, Number(weekday))
    if (count >= enough && day.study && day.use !== 'backup' && !asked(`backup-${weekday}`)) return { weekday: Number(weekday), use: 'backup' }
  }
  for (const [weekday, count] of Object.entries(habits.onto)) {
    const day = dayPlan(settings, Number(weekday))
    if (count >= enough && day.study && day.use !== 'preferred' && !asked(`preferred-${weekday}`)) return { weekday: Number(weekday), use: 'preferred' }
  }
  return null
}

// start counting from scratch so the same drags don't ask twice, and don't ask again after a no
function settle(suggestion, dismissed) {
  const habits = current()
  habits.off = {}
  habits.onto = {}
  if (dismissed) habits.dismissed.push(`${suggestion.use}-${suggestion.weekday}`)
  return saveSetting('habits', habits)
}

export async function acceptHabit(suggestion) {
  await setDay(suggestion.weekday, 'use', suggestion.use)
  await settle(suggestion, false)
}

export const dismissHabit = suggestion => settle(suggestion, true)
