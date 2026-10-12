import { db } from './db.js'
import { defaultZone } from './time.js'

const { reactive } = Vue

// defaults for first run
export const defaults = {
  setupDone: false,
  plannerMode: 'suggest',
  planStyle: 'spread',
  planAhead: 'week',
  groupByDay: true,
  days: null,
  minBlock: 30,
  maxBlock: 60,
  breakMins: 15,
  studyWindow: { start: '09:00', end: '21:00' },
  maxHoursPerDay: 4,
  studyOnWorkDays: false,
  workDayWindow: { start: '18:00', end: '21:00' },
  workDayMaxHours: 1,
  daysOff: [],
  tmaBuffer: 3,
  hoursPerCredit: 10,
  hoursPerTma: 15,
  hoursPerExam: 30,
  travelBuffer: 30,
  timeZone: defaultZone,
  theme: 'system',
  notifications: false,
  notifyBefore: 10,
  exportWeeks: 2,
  driveSync: false,
  revisionMode: 'planned',
  revisionHours: 5,
  trackOptional: true
}

// shared settings for the whole app
export const settings = reactive(structuredClone(defaults))

// load saved values over the defaults
export async function loadSettings() {
  const rows = await db.settings.toArray()
  for (const row of rows) {
    if (row.key in defaults) settings[row.key] = row.value
  }
  applyTheme(settings.theme)
}

export async function saveSetting(key, value) {
  settings[key] = value
  await db.settings.put({ key, value: JSON.parse(JSON.stringify(value)), updated: Date.now() })
  if (key === 'theme') applyTheme(value)
}

// system uses the css media query
export function applyTheme(theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme

  // also kept in localStorage for index.html
  try { localStorage.setItem('theme', theme) } catch {}
}
