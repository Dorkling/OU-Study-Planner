// all clock times use the chosen time zone, not the device's

export const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// monday first
export const weekOrder = [1, 2, 3, 4, 5, 6, 0]

export const defaultZone = 'Europe/London'

// cache one formatter per zone
const formatters = {}

// date parts in a zone
function partsIn(date, zone) {
  formatters[zone] ||= new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'
  })
  const parts = {}
  for (const p of formatters[zone].formatToParts(date)) parts[p.type] = Number(p.value)
  return parts
}

const pad = n => String(n).padStart(2, '0')

// 'YYYY-MM-DD' in a zone
export function dateKey(date, zone) {
  const p = partsIn(date, zone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

// 'HH:MM' in a zone
export function clockTime(date, zone) {
  const p = partsIn(date, zone)
  return `${pad(p.hour)}:${pad(p.minute)}`
}

// utc midnight, only for counting days
function keyToUtc(key) {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function addDaysToKey(key, days) {
  const date = new Date(keyToUtc(key) + days * 86400000)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

// 0 is sunday
export function weekdayOf(key) {
  return new Date(keyToUtc(key)).getUTCDay()
}

// date and time in a zone to a Date
export function zonedTime(key, time, zone) {
  const [h, m] = time.split(':').map(Number)
  const wanted = keyToUtc(key) + (h * 60 + m) * 60000

  // guess then correct by the offset, twice for clock changes
  let guess = wanted
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(guess), zone)
    guess += wanted - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
  }
  return new Date(guess)
}

// booking page times are uk time
export function ukTime(key, time) {
  return zonedTime(key, time, defaultZone)
}

export function startOfDay(key, zone) {
  return zonedTime(key, '00:00', zone)
}

// end before start runs past midnight
export function clockRange(key, start, end, zone) {
  const from = zonedTime(key, start, zone)
  let to = zonedTime(key, end, zone)
  if (to <= from) to = zonedTime(addDaysToKey(key, 1), end, zone)
  return { start: from, end: to }
}

// move by days keeping the clock time
export function shiftDays(date, days, zone) {
  return zonedTime(addDaysToKey(dateKey(date, zone), days), clockTime(date, zone), zone)
}

export function hoursBetween(start, end) {
  return (end - start) / 3600000
}

// whole weeks between two dates, at least 1
export function weeksBetween(startKey, endKey) {
  const days = (keyToUtc(endKey) - keyToUtc(startKey)) / 86400000
  return Math.max(1, Math.round(days / 7))
}

// '2 Nov 2026'
export function shortDate(value, zone) {
  if (!value) return ''
  const isKey = typeof value === 'string' && value.length === 10
  const date = isKey ? new Date(keyToUtc(value)) : new Date(value)
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: isKey ? 'UTC' : zone })
}

// '15 Oct 2026 at 12:00'
export function dateAndTime(value, zone) {
  return `${shortDate(value, zone)} at ${clockTime(new Date(value), zone)}`
}

export function deviceZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

// fullcalendar uses device time, so shift dates to match the zone's clock
export function toWall(date, zone) {
  const p = partsIn(new Date(date), zone)
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute)
}

// and back again
export function fromWall(date, zone) {
  const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return zonedTime(key, `${pad(date.getHours())}:${pad(date.getMinutes())}`, zone)
}

// monday to monday for the week of a date
export function weekBounds(date, zone) {
  const key = dateKey(date, zone)
  const monday = addDaysToKey(key, -((weekdayOf(key) + 6) % 7))
  return { start: startOfDay(monday, zone), end: startOfDay(addDaysToKey(monday, 7), zone) }
}
