import { test } from 'node:test'
import assert from 'node:assert/strict'
import { partEstimates, assessmentHours, getNeeds, planBlocks, getModuleNeeds, planWeek, defaultHours, checkRisks } from '../js/planner.js'

import { zonedTime } from '../js/time.js'

// october 2026 in uk time, the clocks go back on the 25th
const at = (day, h, m = 0) => zonedTime(`2026-10-${String(day).padStart(2, '0')}`, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, 'Europe/London')
const hours = b => (new Date(b.end) - new Date(b.start)) / 3600000

const settings = {
  timeZone: 'Europe/London',
  planStyle: 'early',
  hoursPerTma: 15,
  hoursPerExam: 30,
  hoursPerCredit: 10,
  tmaBuffer: 3,
  maxHoursPerDay: 2,
  workDayMaxHours: 1,
  breakMins: 15,
  minBlock: 30,
  maxBlock: 60
}

const tma = (id, day) => ({ id, module_id: 'm1', title: id, due: at(day, 12).toISOString() })

test('blank parts share what is left of the default', () => {
  const tasks = [{ id: 'a', est_hours: 5 }, { id: 'b' }, { id: 'c', est_hours: 0 }]
  const estimates = partEstimates(tasks, 15)
  assert.equal(estimates.get('a'), 5)
  assert.equal(estimates.get('b'), 5)
  assert.equal(estimates.get('c'), 5)
  assert.equal(assessmentHours([], 15), 15)
})

test('needs take off logged hours, finished parts and accepted blocks', () => {
  const data = {
    assessments: [tma('t1', 30)],
    tasks: [
      { id: 'a', assessment_id: 't1', est_hours: 6, done_hours: 2 },
      { id: 'b', assessment_id: 't1', est_hours: 4, status: 'done' }
    ],
    blocks: [{ assessment_id: 't1', state: 'accepted', start: at(20, 9).toISOString(), end: at(20, 10).toISOString() }]
  }
  const [need] = getNeeds(data, settings, at(12, 9))
  assert.equal(need.remaining, 3)
  assert.deepEqual(need.target, at(27, 12))
})

test('past due assessments are left out', () => {
  const needs = getNeeds({ assessments: [tma('t1', 10)], tasks: [], blocks: [] }, settings, at(12, 9))
  assert.equal(needs.length, 0)
})

test('earliest target is planned first and the daily limit holds', () => {
  const needs = [
    { assessment: tma('late', 30), parts: [], remaining: 2, target: at(27, 12) },
    { assessment: tma('soon', 16), parts: [], remaining: 2, target: at(13, 21) }
  ]
  const free = [
    { start: at(12, 9), end: at(12, 17) },
    { start: at(13, 9), end: at(13, 17) }
  ]
  const { blocks, atRisk } = planBlocks(free, needs, [], settings)

  assert.deepEqual(blocks.map(b => b.assessment_id), ['soon', 'soon', 'late', 'late'])
  assert.equal(atRisk.length, 0)

  // no more than two hours on either day
  for (const day of [12, 13]) {
    const total = blocks.filter(b => new Date(b.start).getDate() === day).reduce((sum, b) => sum + hours(b), 0)
    assert.equal(total, 2)
  }
})

test('work that cannot fit before the target is flagged at risk', () => {
  const needs = [{ assessment: tma('t1', 14), parts: [], remaining: 5, target: at(13, 21) }]
  const free = [{ start: at(12, 9), end: at(12, 17) }, { start: at(13, 9), end: at(13, 17) }]
  const { blocks, atRisk } = planBlocks(free, needs, [], settings)
  assert.equal(blocks.reduce((sum, b) => sum + hours(b), 0), 4)
  assert.deepEqual(atRisk.map(r => [r.assessment.id, r.hours]), [['t1', 1]])
})

test('work days use their own limit', () => {
  const needs = [{ assessment: tma('t1', 30), parts: [], remaining: 3, target: at(27, 12) }]
  const free = [{ start: at(12, 18), end: at(12, 21), workDay: true }]
  const { blocks } = planBlocks(free, needs, [], settings)
  assert.equal(blocks.reduce((sum, b) => sum + hours(b), 0), 1)
})

test('accepted blocks count toward the daily limit', () => {
  const needs = [{ assessment: tma('t1', 30), parts: [], remaining: 3, target: at(27, 12) }]
  const free = [{ start: at(12, 13), end: at(12, 17) }]
  const existing = [{ state: 'accepted', start: at(12, 9).toISOString(), end: at(12, 10, 30).toISOString() }]
  const { blocks } = planBlocks(free, needs, existing, settings)
  assert.equal(blocks.reduce((sum, b) => sum + hours(b), 0), 0.5)
})

test('blocks go against the first part with time left', () => {
  const needs = [{ assessment: tma('t1', 30), parts: [{ id: 'a', left: 1 }, { id: 'b', left: 2 }], remaining: 2, target: at(27, 12) }]
  const free = [{ start: at(12, 9), end: at(12, 17) }]
  const { blocks } = planBlocks(free, needs, [], settings)
  assert.deepEqual(blocks.map(b => b.task_id), ['a', 'b'])
})

test('spread puts blocks on separate days up to the target', () => {
  const needs = [{ assessment: tma('t1', 30), parts: [], remaining: 4, target: at(16, 21) }]
  const free = [12, 13, 14, 15, 16].map(day => ({ start: at(day, 9), end: at(day, 17) }))
  const { blocks } = planBlocks(free, needs, [], { ...settings, planStyle: 'spread' })
  const days = blocks.map(b => new Date(b.start).getUTCDate())
  assert.equal(blocks.length, 4)
  assert.equal(new Set(days).size, 4)
  assert.ok(days.includes(16), 'reaches the last day before the target')
})

test('spread still fits everything when time is tight', () => {
  const needs = [{ assessment: tma('t1', 30), parts: [], remaining: 4, target: at(13, 21) }]
  const free = [12, 13].map(day => ({ start: at(day, 9), end: at(day, 17) }))
  const { blocks, atRisk } = planBlocks(free, needs, [], { ...settings, planStyle: 'spread' })
  assert.equal(blocks.reduce((sum, b) => sum + hours(b), 0), 4)
  assert.equal(atRisk.length, 0)
})

test('exams and emas get the bigger default', () => {
  assert.equal(defaultHours({ type: 'tma' }, settings), 15)
  assert.equal(defaultHours({ type: 'exam' }, settings), 30)
})

// 30 credits over 30 weeks is 10 hours a week
const module = { id: 'm1', code: 'SM380', credits: 30, start: '2026-10-05', end: '2027-05-03' }
const week = { start: at(12, 0), end: at(19, 0) }

test('weekly module study counts tma work and tutorials already booked', () => {
  const data = { modules: [module], tasks: [], tutorials: [{ module_id: 'm1', start: at(14, 19), end: at(14, 20, 30) }] }
  const booked = [{ module_id: 'm1', state: 'accepted', start: at(13, 9).toISOString(), end: at(13, 12).toISOString() }]
  const [need] = getModuleNeeds(data, settings, week, booked)
  assert.equal(need.weekly, 10)
  assert.equal(need.remaining, 5.5)
})

test('modules outside their dates need nothing', () => {
  const later = { ...module, start: '2027-02-01', end: '2027-09-01' }
  assert.equal(getModuleNeeds({ modules: [later], tasks: [], tutorials: [] }, settings, week, []).length, 0)
})

const emptyWeek = {
  pattern: [], exceptions: [], blocked: [], tutorials: [], tasks: [], blocks: [],
  modules: [module], assessments: []
}

const planSettings = {
  ...settings,
  plannerMode: 'suggest',
  trackOptional: true,
  studyWindow: { start: '09:00', end: '21:00' },
  workDayWindow: { start: '18:00', end: '21:00' },
  studyOnWorkDays: false,
  daysOff: [],
  travelBuffer: 30
}

test('with no assessments the week still gets its module study', () => {
  const { blocks } = planWeek(emptyWeek, planSettings, at(12, 8), at(12, 8))
  assert.equal(blocks.reduce((sum, b) => sum + hours(b), 0), 10)
  assert.ok(blocks.every(b => b.assessment_id === null && b.module_id === 'm1' && b.state === 'suggested'))
})

test('tma work comes first and counts toward the weekly hours', () => {
  const data = { ...emptyWeek, assessments: [{ ...tma('t1', 16), type: 'tma' }] }
  const { blocks } = planWeek(data, { ...planSettings, hoursPerTma: 4 }, at(12, 8), at(12, 8))
  const tmaHours = blocks.filter(b => b.assessment_id === 't1').reduce((sum, b) => sum + hours(b), 0)
  const studyHours = blocks.filter(b => !b.assessment_id).reduce((sum, b) => sum + hours(b), 0)
  assert.equal(tmaHours, 4)
  assert.equal(studyHours, 6)
})

test('manual modules are left alone and auto ones are accepted straight away', () => {
  const manual = planWeek({ ...emptyWeek, modules: [{ ...module, mode_override: 'manual' }] }, planSettings, at(12, 8), at(12, 8))
  assert.equal(manual.blocks.length, 0)
  const auto = planWeek({ ...emptyWeek, modules: [{ ...module, mode_override: 'auto' }] }, planSettings, at(12, 8), at(12, 8))
  assert.ok(auto.blocks.length && auto.blocks.every(b => b.state === 'accepted'))
})

test('a last scrap of work still gets the shortest block, never less', () => {
  const needs = [{ assessment: tma('t1', 30), parts: [], remaining: 0.25, target: at(27, 12) }]
  const { blocks } = planBlocks([{ start: at(12, 9), end: at(12, 17) }], needs, [], settings)
  assert.deepEqual(blocks.map(hours), [0.5])
})

test('blocks ticked off with no part count as work done', () => {
  const data = {
    assessments: [{ ...tma('t1', 30), type: 'tma' }],
    tasks: [],
    blocks: [{ assessment_id: 't1', state: 'done', done_hours: 2.5, start: at(10, 9).toISOString(), end: at(10, 10).toISOString() }]
  }
  const [need] = getNeeds(data, settings, at(12, 9))
  assert.equal(need.done, 2.5)
  assert.equal(need.remaining, 12.5)
})

test('missed tutorials do not count toward the week and recordings get studied first', () => {
  const data = {
    modules: [module],
    tasks: [{ id: 'rec', module_id: 'm1', assessment_id: null, title: 'Watch recording', est_hours: 1.5, done_hours: 0, status: 'todo' }],
    tutorials: [{ module_id: 'm1', attended: false, start: at(14, 19), end: at(14, 20, 30) }]
  }
  const [need] = getModuleNeeds(data, settings, week, [])
  assert.equal(need.covered, 0)
  assert.deepEqual(need.parts, [{ id: 'rec', left: 1.5 }])
})

test('auto blocks in the future are redone, and an identical plan changes nothing', () => {
  const data = { ...emptyWeek, modules: [{ ...module, mode_override: 'auto' }] }
  const first = planWeek(data, planSettings, at(12, 8), at(12, 8))
  const saved = first.blocks.map((b, i) => ({ ...b, id: `b${i}` }))

  const again = planWeek({ ...data, blocks: saved }, planSettings, at(12, 8), at(12, 8), ['auto'])
  assert.equal(again.remove.length, saved.length)
  assert.equal(again.unchanged, true)

  // a moved block isn't auto so it stays
  const moved = saved.map((b, i) => i === 0 ? { ...b, auto: false } : b)
  const third = planWeek({ ...data, blocks: moved }, planSettings, at(12, 8), at(12, 8), ['auto'])
  assert.ok(!third.remove.includes('b0'))
})

test('fixed weekly revision books the set hours for an exam this week', () => {
  const exam = { id: 'ex', module_id: 'm1', type: 'exam', title: 'Exam', due: at(30, 10).toISOString() }
  const data = { ...emptyWeek, assessments: [exam] }
  const { blocks } = planWeek(data, { ...planSettings, revisionMode: 'weekly', revisionHours: 3, trackOptional: false }, at(12, 8), at(12, 8))
  assert.equal(blocks.filter(b => b.assessment_id === 'ex').reduce((sum, b) => sum + hours(b), 0), 3)
})

test('risks are found without planning anything', () => {
  const data = { ...emptyWeek, assessments: [{ ...tma('t1', 13), type: 'tma' }] }
  const risks = checkRisks(data, { ...planSettings, hoursPerTma: 40, tmaBuffer: 0 }, at(12, 8))
  assert.equal(risks.length, 1)
  assert.equal(risks[0].assessment.id, 't1')
})

test('switching to auto turns old suggestions into planned blocks even in the same slots', () => {
  const suggestions = planWeek(emptyWeek, planSettings, at(12, 8), at(12, 8)).blocks.map((b, i) => ({ ...b, id: `s${i}` }))
  const auto = planWeek({ ...emptyWeek, modules: [{ ...module, mode_override: 'auto' }], blocks: suggestions }, planSettings, at(12, 8), at(12, 8), ['auto'])
  assert.equal(auto.unchanged, false)
  assert.equal(auto.remove.length, suggestions.length)
})
