import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTutorial, parseDate, parseTime, isDuplicate } from '../js/tutorials.js'

// copied from the desktop confirmation page
const desktop = `Home > Tutorials for SM380 > Booking confirmation
Tutorial date	2 November 2026 (Mon)
Tutorial type	Online
Start time	19:00
End time	20:30
Tutorial title	Problem solving tutorial unit 1-3 [Not Recorded - Live Event]
Tutorial contact	Jane Smith, Raj Patel
Back to tutorials`

// mobile view and ocr put each value on its own line
const mobile = `Tutorials for SM380
Tutorial date
2 November 2026 (Mon)
Tutorial type
Online
Start time
19.00
End time
20.30
Tutorial title
Revision for TMA 02
[Recorded - Live Event]
Tutorial contact
Jane Smith`

test('reads every field from the desktop page', () => {
  assert.deepEqual(parseTutorial(desktop), {
    module: 'SM380',
    date: '2026-11-02',
    type: 'online',
    start: '19:00',
    end: '20:30',
    title: 'Problem solving tutorial unit 1-3',
    recorded: false,
    tutors: ['Jane Smith', 'Raj Patel']
  })
})

test('reads values on the next line and dots in times', () => {
  const t = parseTutorial(mobile)
  assert.equal(t.date, '2026-11-02')
  assert.equal(t.start, '19:00')
  assert.equal(t.end, '20:30')
  assert.equal(t.title, 'Revision for TMA 02')
  assert.equal(t.recorded, true)
  assert.deepEqual(t.tutors, ['Jane Smith'])
})

test('labels in a different order still work', () => {
  const t = parseTutorial('Start time 10:00\nTutorial date 5 Dec 2026\nEnd time 11:00\nTutorial title Day school')
  assert.equal(t.date, '2026-12-05')
  assert.equal(t.start, '10:00')
  assert.equal(t.title, 'Day school')
  assert.equal(t.recorded, null)
})

test('module code comes from the url when there is no breadcrumb', () => {
  const t = parseTutorial('https://example.open.ac.uk/tutorials/TM112/2026J\nTutorial date 1 March 2027')
  assert.equal(t.module, 'TM112')
})

test('date and time helpers handle odd input', () => {
  assert.equal(parseDate('3rd Feb 2027'), '2027-02-03')
  assert.equal(parseDate('nonsense'), '')
  assert.equal(parseTime('9:05'), '09:05')
  assert.equal(parseTime(''), '')
})

test('a repeat booking counts as a duplicate', () => {
  const saved = [{ module_id: 'm1', start: '2026-11-02T19:00:00.000Z', title: 'Problem solving' }]
  assert.equal(isDuplicate({ module_id: 'm1', start: '2026-11-02T19:00:00.000Z', title: 'problem solving' }, saved), true)
  assert.equal(isDuplicate({ module_id: 'm1', start: '2026-11-09T19:00:00.000Z', title: 'Problem solving' }, saved), false)
})
