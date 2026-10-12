import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planWeek } from '../js/planner.js'
import { mergeData } from '../js/merge.js'
import { zonedTime } from '../js/time.js'

const at = (day, h, m = 0) => zonedTime(`2026-10-${String(day).padStart(2, '0')}`, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, 'Europe/London')

const settings = {
  timeZone: 'Europe/London', plannerMode: 'auto', planStyle: 'spread', trackOptional: true, revisionMode: 'planned',
  studyWindow: { start: '09:00', end: '21:00' }, workDayWindow: { start: '18:00', end: '21:00' }, studyOnWorkDays: false,
  daysOff: [], minBlock: 30, maxBlock: 60, breakMins: 15, maxHoursPerDay: 2, workDayMaxHours: 1, travelBuffer: 30,
  tmaBuffer: 3, hoursPerCredit: 10, hoursPerTma: 6, hoursPerExam: 30, revisionHours: 5
}

const shared = {
  pattern: [{ weekday: 2, start: '09:00', end: '17:00' }], exceptions: [], blocked: [], tutorials: [], tasks: [], blocks: [],
  modules: [{ id: 'm1', code: 'SM380', credits: 30, start: '2026-10-05', end: '2027-05-03', mode_override: '' }],
  assessments: [{ id: 't1', module_id: 'm1', type: 'tma', title: 'TMA 01', due: at(29, 12).toISOString() }]
}

// what a device would save, stamped the way db.save does
const saved = (blocks, stamp) => blocks.map(b => ({ ...b, updated: stamp, deleted: false }))
const live = blocks => blocks.filter(b => !b.deleted)

test('phone and pc planning the same week end up with one set of blocks', () => {
  const phone = saved(planWeek(shared, settings, at(12, 8), at(12, 8)).blocks, 1)
  const pc = saved(planWeek(shared, settings, at(12, 8, 1), at(12, 8, 1)).blocks, 2)

  const { merged } = mergeData({ blocks: pc }, { blocks: phone })
  assert.equal(live(merged.blocks).length, pc.length, 'no duplicates after sync')

  // and planning again on the merged copy changes nothing, so the devices settle
  const again = planWeek({ ...shared, blocks: live(merged.blocks) }, settings, at(12, 8, 2), at(12, 8, 2), ['auto'])
  assert.equal(again.unchanged, true)
})

test('a block planned again in the same place is not deleted and re-added', () => {
  const first = saved(planWeek(shared, settings, at(12, 8), at(12, 8)).blocks, 1)
  const withShift = { ...shared, blocks: first, exceptions: [{ date: '2026-10-17', type: 'shift', start: '09:00', end: '17:00' }] }
  const result = planWeek(withShift, settings, at(12, 8), at(12, 8), ['auto'])
  const kept = result.blocks.filter(b => first.some(f => f.id === b.id))
  assert.ok(kept.length > 0, 'some blocks stay where they were')
  assert.ok(kept.every(b => !result.remove.includes(b.id)))
})
