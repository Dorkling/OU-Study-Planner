import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCalendar, calendarEvents } from '../js/ics.js'
import { zonedTime } from '../js/time.js'

const uk = (day, time) => zonedTime(`2026-10-${day}`, time, 'Europe/London')
const stamp = new Date('2026-10-12T08:00:00Z')

test('timed events are in utc with a fixed id and a reminder', () => {
  const ics = buildCalendar([{ uid: 'b1', title: 'SM380 TMA 01', start: uk(14, '19:00'), end: uk(14, '20:00'), alarm: 10 }], stamp)
  assert.match(ics, /UID:b1@ou-study-planner\r\n/)
  assert.match(ics, /DTSTART:20261014T180000Z\r\n/)
  assert.match(ics, /DTEND:20261014T190000Z\r\n/)
  assert.match(ics, /TRIGGER:-PT10M\r\n/)
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'))
})

test('deadlines are all day and text is escaped', () => {
  const ics = buildCalendar([{ uid: 'a1-due', title: 'TMA 01, part 2; final', day: '2026-11-12' }], stamp)
  assert.match(ics, /DTSTART;VALUE=DATE:20261112\r\nDTEND;VALUE=DATE:20261113/)
  assert.match(ics, /SUMMARY:TMA 01\\, part 2\\; final/)
})

test('long lines are folded under 75 bytes', () => {
  const ics = buildCalendar([{ uid: 'x', title: 'A very long title '.repeat(10), day: '2026-11-12' }], stamp)
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75)
  assert.match(ics, /\r\n \S/)
})

test('only accepted blocks in range go out, deadlines land on the uk day', () => {
  const data = {
    blocks: [
      { id: 'in', state: 'accepted', start: uk(14, '19:00'), end: uk(14, '20:00') },
      { id: 'maybe', state: 'suggested', start: uk(14, '09:00'), end: uk(14, '10:00') },
      { id: 'late', state: 'accepted', start: uk(30, '09:00'), end: uk(30, '10:00') }
    ],
    tutorials: [{ id: 't', start: uk(15, '19:00'), end: uk(15, '20:30'), tutors: ['Jane Smith'] }],
    assessments: [{ id: 'a', due: zonedTime('2026-10-16', '00:30', 'Europe/London').toISOString() }]
  }
  const labels = { block: b => b.id, tutorial: t => 'Tutorial', due: a => 'Due' }
  const events = calendarEvents(data, { timeZone: 'Europe/London', notifyBefore: 10 }, uk(12, '00:00'), uk(26, '00:00'), labels)
  assert.deepEqual(events.map(e => e.uid), ['in', 't', 'a-due'])
  assert.equal(events[2].day, '2026-10-16')
})
