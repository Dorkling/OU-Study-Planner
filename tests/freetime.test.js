import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getShifts, subtractTimes, getFreeTime, cutSlots } from '../js/freetime.js'

import { zonedTime } from '../js/time.js'

// october 2026 in uk time, the clocks go back on the 25th
const at = (day, h, m = 0) => zonedTime(`2026-10-${String(day).padStart(2, '0')}`, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, 'Europe/London')
const monday = at(12, 0)

const settings = {
  timeZone: 'Europe/London',
  studyWindow: { start: '09:00', end: '21:00' },
  workDayWindow: { start: '18:00', end: '21:00' },
  studyOnWorkDays: false,
  daysOff: [],
  travelBuffer: 30,
  breakMins: 15,
  minBlock: 30,
  maxBlock: 60
}

const empty = { pattern: [], exceptions: [], blocked: [], tutorials: [], blocks: [], now: monday }

test('night shift carries over into the next day', () => {
  const shifts = getShifts(at(16, 0), at(18, 0), [{ weekday: 5, start: '22:00', end: '06:00' }], [], 'Europe/London')
  assert.deepEqual(shifts, [{ start: at(16, 22), end: at(17, 6) }])
})

test('a day off replaces the normal shift', () => {
  const pattern = [{ weekday: 2, start: '09:00', end: '17:00' }]
  const shifts = getShifts(at(13, 0), at(14, 0), pattern, [{ date: '2026-10-13', type: 'off' }], 'Europe/London')
  assert.equal(shifts.length, 0)
})

test('subtracting splits a range around busy time', () => {
  const free = subtractTimes([{ start: at(12, 9), end: at(12, 17) }], [{ start: at(12, 12), end: at(12, 13) }])
  assert.deepEqual(free, [{ start: at(12, 9), end: at(12, 12) }, { start: at(12, 13), end: at(12, 17) }])
})

test('work days are skipped unless study on work days is on', () => {
  const data = { ...empty, pattern: [{ weekday: 1, start: '09:00', end: '17:00' }] }
  assert.equal(getFreeTime(at(12, 0), at(13, 0), data, settings).length, 0)

  const free = getFreeTime(at(12, 0), at(13, 0), data, { ...settings, studyOnWorkDays: true })
  assert.deepEqual(free.map(f => [f.start, f.end]), [[at(12, 18), at(12, 21)]])
})

test('travel buffer, blocked time and tutorials come out of the day', () => {
  const data = {
    ...empty,
    exceptions: [{ date: '2026-10-14', type: 'shift', start: '06:00', end: '10:00' }],
    blocked: [{ weekday: 3, start: '17:00', end: '18:00', label: 'Gym' }],
    tutorials: [{ start: at(14, 19).toISOString(), end: at(14, 20).toISOString() }]
  }

  // shift makes it a work day
  const free = getFreeTime(at(14, 0), at(15, 0), data, { ...settings, studyOnWorkDays: true, workDayWindow: { start: '09:00', end: '21:00' } })
  assert.deepEqual(free.map(f => [f.start, f.end]), [
    [at(14, 10, 30), at(14, 17)],
    [at(14, 18), at(14, 19)],
    [at(14, 20), at(14, 21)]
  ])
})

test('nothing before now counts as free, rounded to the next quarter hour', () => {
  const free = getFreeTime(at(12, 0), at(13, 0), { ...empty, now: at(12, 15, 20) }, settings)
  assert.deepEqual(free.map(f => [f.start, f.end]), [[at(12, 15, 30), at(12, 21)]])
})

test('a shift that has already finished today still makes it a work day', () => {
  const data = { ...empty, pattern: [{ weekday: 1, start: '09:00', end: '17:00' }], now: at(12, 18, 26) }
  assert.equal(getFreeTime(at(12, 18, 26), at(13, 0), data, settings).length, 0)
})

test('days off from study are skipped', () => {
  const free = getFreeTime(at(12, 0), at(19, 0), empty, { ...settings, daysOff: [0, 6] })
  assert.equal(free.length, 5)
})

test('free time is cut into blocks with breaks between', () => {
  const slots = cutSlots([{ start: at(12, 9), end: at(12, 11, 30) }], settings)
  assert.deepEqual(slots.map(s => [s.start, s.end]), [
    [at(12, 9), at(12, 10)],
    [at(12, 10, 15), at(12, 11, 15)]
  ])
})
