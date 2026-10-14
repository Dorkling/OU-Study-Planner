import { dateKey, addDaysToKey, weekdayOf, startOfDay, clockRange } from './time.js'

const minute = 60000

// days in the range, plus the day before for night shifts
function daysIn(from, to, zone) {
  const keys = []
  for (let key = addDaysToKey(dateKey(from, zone), -1); startOfDay(key, zone) < to; key = addDaysToKey(key, 1)) {
    keys.push(key)
  }
  return keys
}

// shifts in a range with changes applied
export function getShifts(from, to, pattern, exceptions, zone) {
  const shifts = []

  for (const key of daysIn(from, to, zone)) {
    const changes = exceptions.filter(e => e.date === key)

    // a change replaces the pattern for that day
    if (changes.length) {
      for (const c of changes) {
        if (c.type === 'shift') shifts.push(clockRange(key, c.start, c.end, zone))
      }
      continue
    }

    for (const p of pattern) {
      if (p.weekday === weekdayOf(key)) shifts.push(clockRange(key, p.start, p.end, zone))
    }
  }

  return shifts.filter(s => s.end > from && s.start < to)
}

// blocked time, weekly or one-off
export function getBlocked(from, to, blocked, zone) {
  const result = []

  for (const key of daysIn(from, to, zone)) {
    for (const b of blocked) {
      const matches = b.date ? b.date === key : b.weekday === weekdayOf(key)
      if (matches) result.push({ ...clockRange(key, b.start, b.end, zone), label: b.label })
    }
  }

  return result.filter(r => r.end > from && r.start < to)
}

// take busy times out of free ranges
export function subtractTimes(free, busy) {
  let result = free
  for (const b of busy) {
    result = result.flatMap(f => {
      if (b.end <= f.start || b.start >= f.end) return [f]
      const parts = []
      if (b.start > f.start) parts.push({ ...f, end: b.start })
      if (b.end < f.end) parts.push({ ...f, start: b.end })
      return parts
    })
  }
  return result
}

// study settings for a weekday, falling back to the older single window and days off
// use is preferred, normal or backup (only if needed), older saves only had a preferred tick
export function dayPlan(settings, weekday) {
  const day = settings.days?.[weekday] || {
    study: !(settings.daysOff || []).includes(weekday),
    start: settings.studyWindow?.start,
    end: settings.studyWindow?.end,
    maxHours: settings.maxHoursPerDay
  }
  return { ...day, use: day.use || (day.preferred ? 'preferred' : 'normal') }
}

// study window for each day
export function buildStudyGrid(from, to, shifts, settings) {
  const zone = settings.timeZone
  const grid = []

  for (let key = dateKey(from, zone); startOfDay(key, zone) < to; key = addDaysToKey(key, 1)) {
    const plan = dayPlan(settings, weekdayOf(key))
    if (!plan.study) continue

    // a work day is any day a shift starts on
    const workDay = shifts.some(s => dateKey(s.start, zone) === key)
    if (workDay && !settings.studyOnWorkDays) continue

    const window = workDay ? settings.workDayWindow : plan
    grid.push({ ...clockRange(key, window.start, window.end, zone), key, workDay, preferred: !workDay && plan.use === 'preferred', backup: !workDay && plan.use === 'backup' })
  }

  return grid
}

// everything study can't overlap
export function getBusy(from, to, data, settings) {
  const zone = settings.timeZone
  const travel = settings.travelBuffer * minute
  const gap = settings.breakMins * minute

  // add travel time either side of shifts
  const shifts = getShifts(from, to, data.pattern, data.exceptions, zone)
    .map(s => ({ start: new Date(s.start - travel), end: new Date(+s.end + travel) }))

  // leave a break around planned blocks
  const blocks = data.blocks
    .filter(b => b.state !== 'suggested' && b.state !== 'missed')
    .map(b => ({ start: new Date(new Date(b.start) - gap), end: new Date(+new Date(b.end) + gap) }))

  const tutorials = data.tutorials.map(t => ({ start: new Date(t.start), end: new Date(t.end) }))

  return [...shifts, ...getBlocked(from, to, data.blocked, zone), ...tutorials, ...blocks]
}

// round up to the next 15 minutes
function nextQuarter(date) {
  const quarter = 15 * minute
  return new Date(Math.ceil(date / quarter) * quarter)
}

// free time in the study window
export function getFreeTime(from, to, data, settings) {
  // start from midnight so earlier shifts still count
  const dayStart = startOfDay(dateKey(from, settings.timeZone), settings.timeZone)

  const shifts = getShifts(dayStart, to, data.pattern, data.exceptions, settings.timeZone)
  const grid = buildStudyGrid(dayStart, to, shifts, settings)
  const busy = getBusy(dayStart, to, data, settings)

  // remove anything before now
  const now = nextQuarter(data.now || new Date())
  const cutoff = new Date(Math.max(now, from))
  return subtractTimes(grid, [...busy, { start: new Date(0), end: cutoff }])
    .filter(f => f.end > f.start)
}

// cut free time into blocks
export function cutSlots(free, settings) {
  const min = settings.minBlock * minute
  const max = settings.maxBlock * minute
  const gap = settings.breakMins * minute
  const slots = []

  for (const f of free) {
    let start = +f.start
    while (f.end - start >= min) {
      const length = Math.min(max, f.end - start)
      slots.push({ ...f, start: new Date(start), end: new Date(start + length) })
      start += length + gap
    }
  }

  return slots
}
