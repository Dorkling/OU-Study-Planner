import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ukTime, zonedTime, clockRange, dateKey, clockTime, shiftDays, toWall, fromWall } from '../js/time.js'
import { getShifts } from '../js/freetime.js'

const london = 'Europe/London'

test('uk times turn into the right moment either side of bst', () => {
  assert.equal(ukTime('2026-10-12', '19:00').toISOString(), '2026-10-12T18:00:00.000Z')
  assert.equal(ukTime('2026-11-02', '19:00').toISOString(), '2026-11-02T19:00:00.000Z')
})

test('other zones work whatever the device is set to', () => {
  const madrid = zonedTime('2026-10-12', '09:00', 'Europe/Madrid')
  assert.equal(madrid.toISOString(), '2026-10-12T07:00:00.000Z')
  assert.equal(dateKey(madrid, 'America/New_York'), '2026-10-12')
  assert.equal(clockTime(madrid, 'America/New_York'), '03:00')
})

test('an end before the start runs past midnight', () => {
  const { start, end } = clockRange('2026-10-16', '22:00', '06:00', london)
  assert.equal(end - start, 8 * 3600000)
})

test('moving by days keeps the clock time across a clock change', () => {
  const due = ukTime('2026-10-27', '12:00')
  assert.equal(clockTime(shiftDays(due, -3, london), london), '12:00')
})

test('weekly shifts keep their clock time when the clocks change', () => {
  const pattern = [{ weekday: 1, start: '09:00', end: '17:00' }]
  const shifts = getShifts(ukTime('2026-10-19', '00:00'), ukTime('2026-10-27', '00:00'), pattern, [], london)
  assert.deepEqual(shifts.map(s => clockTime(s.start, london)), ['09:00', '09:00'])
})

test('calendar dates go out and back unchanged', () => {
  const moment = zonedTime('2026-10-14', '19:30', 'Asia/Kolkata')
  assert.equal(+fromWall(toWall(moment, 'Asia/Kolkata'), 'Asia/Kolkata'), +moment)
})
