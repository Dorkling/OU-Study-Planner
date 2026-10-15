import { test } from 'node:test'
import assert from 'node:assert/strict'
import { partEstimates, assessmentHours, getNeeds, planBlocks, getModuleNeeds, planWeek, defaultHours, checkRisks, findClashes, planWeeks, weeksToEnd, capacityCheck, bookableHours, catchUpHours, replanAuto, assignDays, queuedWork, studyFirst, joinTouching, joinDropped, packDays, weekdayOwners } from '../js/planner.js'

import { zonedTime } from '../js/time.js'
import { dayPlan } from '../js/freetime.js'

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

// the week from james's screenshot: shifts tue, fri and sun, dnd friday night, study from 12:00
const shiftWeek = {
  ...emptyWeek,
  pattern: [2, 5, 0].map(weekday => ({ weekday, start: '11:00', end: '20:00' })),
  blocked: [{ weekday: 5, start: '20:00', end: '00:00', label: 'DnD' }]
}
const noonStart = { ...planSettings, studyWindow: { start: '12:00', end: '21:00' } }
const block = (id, day, from, to, extra = {}) => ({ id, module_id: 'm1', state: 'accepted', start: at(day, ...from).toISOString(), end: at(day, ...to).toISOString(), ...extra })

test('the planner keeps to study hours and off work days', () => {
  const { blocks } = planWeek(shiftWeek, noonStart, at(12, 20, 50), at(12, 20, 50))
  for (const b of blocks) {
    const start = new Date(b.start)
    assert.ok(![13, 16, 18].includes(Number(new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'Europe/London' }).format(start))), 'not on a work day')
    assert.ok(Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/London' }).format(start)) >= 12, 'not before 12:00')
  }
})

test('old blocks under a shift or outside study hours are found', () => {
  const data = {
    ...shiftWeek,
    blocks: [
      block('during-work', 18, [12, 45], [13, 30]),
      block('morning', 14, [9, 0], [12, 0]),
      block('fine', 15, [17, 0], [18, 0]),
      block('dnd', 16, [21, 0], [22, 0], { byUser: true }),
      block('placed-early', 15, [9, 0], [10, 0], { byUser: true }),
      block('past', 11, [9, 0], [10, 0])
    ]
  }
  const clashes = findClashes(data, noonStart, at(12, 20, 50))
  assert.deepEqual(clashes.map(c => [c.block.id, c.reason]), [['during-work', 'busy'], ['morning', 'hours'], ['dnd', 'busy']])
})

test('travel time either side of a shift counts as a clash', () => {
  const data = { ...shiftWeek, blocks: [block('just-before', 16, [10, 0], [10, 45], { byUser: true })] }
  assert.equal(findClashes(data, noonStart, at(12, 20, 50)).length, 1)
})

const weekOfDate = b => new Date(b.start) >= at(19, 0) ? 'next' : 'this'

test('planning next week only books next week and leaves this week alone', () => {
  const thisWeek = planWeek(emptyWeek, planSettings, at(12, 8), at(12, 8)).blocks.map((b, i) => ({ ...b, id: `t${i}` }))
  const next = planWeek({ ...emptyWeek, blocks: thisWeek }, planSettings, at(12, 8), at(20, 8))

  assert.ok(next.blocks.length > 0)
  assert.ok(next.blocks.every(b => weekOfDate(b) === 'next'))
  assert.equal(next.remove.length, 0)
})

test('replanning this week keeps the auto blocks already in next week', () => {
  const data = { ...emptyWeek, modules: [{ ...module, mode_override: 'auto' }] }
  const nextWeek = planWeek(data, planSettings, at(12, 8), at(20, 8)).blocks.map((b, i) => ({ ...b, id: `n${i}` }))
  const thisWeek = planWeek({ ...data, blocks: nextWeek }, planSettings, at(12, 8), at(12, 8), ['auto'])
  assert.ok(nextWeek.every(b => !thisWeek.remove.includes(b.id)))
})

test('suggestions in another week count as planned', () => {
  const data = { ...emptyWeek, assessments: [{ ...tma('t1', 30), type: 'tma' }] }
  const settingsNoStudy = { ...planSettings, trackOptional: false, hoursPerTma: 4 }
  const nextWeek = planWeek(data, settingsNoStudy, at(12, 8), at(20, 8)).blocks.map((b, i) => ({ ...b, id: `n${i}` }))
  const booked = nextWeek.reduce((sum, b) => sum + hours(b), 0)
  const thisWeek = planWeek({ ...data, blocks: nextWeek }, settingsNoStudy, at(12, 8), at(12, 8))
  assert.equal(booked + thisWeek.blocks.reduce((sum, b) => sum + hours(b), 0), 4)
})

test('the planner books the weekly hours the user chose', () => {
  const data = { ...emptyWeek, modules: [{ ...module, weekly_hours: 6 }] }
  const { blocks } = planWeek(data, planSettings, at(12, 8), at(12, 8))
  assert.equal(blocks.reduce((sum, b) => sum + hours(b), 0), 6)
})

// evenings on weekdays, a long preferred saturday, sunday off
const weekdayEvening = { study: true, start: '18:00', end: '21:00', maxHours: 1, preferred: false }
const days = {
  1: weekdayEvening, 2: weekdayEvening, 3: weekdayEvening, 4: weekdayEvening, 5: weekdayEvening,
  6: { study: true, start: '10:00', end: '16:00', maxHours: 5, preferred: true },
  0: { study: false, start: '10:00', end: '16:00', maxHours: 0, preferred: false }
}
const dayLabel = b => new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'Europe/London' }).format(new Date(b.start))
const hoursOn = (blocks, day) => blocks.filter(b => dayLabel(b) === day).reduce((sum, b) => sum + hours(b), 0)

test('each day keeps to its own times and limit, and a day off gets nothing', () => {
  const { blocks } = planWeek(emptyWeek, { ...planSettings, days }, at(12, 8), at(12, 8))
  assert.equal(hoursOn(blocks, 'Sun'), 0)
  assert.ok(hoursOn(blocks, 'Mon') <= 1)
  assert.ok(hoursOn(blocks, 'Sat') <= 5)
  for (const b of blocks.filter(b => dayLabel(b) !== 'Sat')) {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/London' }).format(new Date(b.start)))
    assert.ok(hour >= 18, 'weekday blocks are in the evening')
  }
})

test('preferred days are filled before other days', () => {
  const data = { ...emptyWeek, assessments: [{ ...tma('t1', 30), type: 'tma' }] }
  const { blocks } = planWeek(data, { ...planSettings, days, hoursPerTma: 5, trackOptional: false }, at(12, 8), at(12, 8))
  assert.equal(hoursOn(blocks, 'Sat'), 5)
  assert.equal(blocks.reduce((sum, b) => sum + hours(b), 0), 5)
})

test('planning to the end spreads the work over the weeks without booking it twice', () => {
  const data = { ...emptyWeek, modules: [module], assessments: [{ id: 'big', module_id: 'm1', type: 'tma', title: 'TMA', due: at(31, 12).toISOString() }] }
  const settingsTma = { ...planSettings, planStyle: 'spread', trackOptional: false, hoursPerTma: 12, tmaBuffer: 0 }
  const weeks = weeksToEnd({ ...data, modules: [{ ...module, end: '2026-10-31' }] }, settingsTma, at(12, 8))
  assert.equal(weeks, 3)

  const { blocks } = planWeeks(data, settingsTma, at(12, 8), at(12, 8), weeks)
  const weekIndex = b => Math.floor((new Date(b.start) - at(12, 0)) / (7 * 86400000))
  const byWeek = [0, 1, 2].map(i => blocks.filter(b => weekIndex(b) === i).reduce((sum, b) => sum + hours(b), 0))
  assert.equal(byWeek.reduce((a, b) => a + b, 0), 12)
  assert.ok(byWeek.every(h => h > 0), 'every week gets some: ' + byWeek.join())
})

test('planning ahead in suggest mode replaces old suggestions in those weeks only', () => {
  const old = planWeek(emptyWeek, planSettings, at(12, 8), at(12, 8)).blocks.map((b, i) => ({ ...b, id: `o${i}` }))
  const later = { id: 'keep', module_id: 'm1', state: 'suggested', start: at(30, 9).toISOString(), end: at(30, 10).toISOString() }
  const result = planWeeks({ ...emptyWeek, blocks: [...old, later] }, planSettings, at(12, 8), at(12, 8), 2)
  assert.equal(result.remove.length, old.length)
  assert.ok(!result.remove.includes('keep'))
})

// full time work and 120 credits: 60, 30 and 30, with weekends free for up to 4 hours a day
const fullTime = {
  ...emptyWeek,
  pattern: [1, 2, 3, 4, 5].map(weekday => ({ weekday, start: '09:00', end: '17:00' })),
  modules: [
    { ...module, id: 'A', credits: 60 },
    { ...module, id: 'B', credits: 30 },
    { ...module, id: 'C', credits: 30 }
  ]
}
const fullTimeSettings = { ...planSettings, planStyle: 'spread', maxHoursPerDay: 4, studyWindow: { start: '09:00', end: '21:00' } }

test('not enough time is spotted, with the hours needed and free', () => {
  const check = capacityCheck(fullTime, fullTimeSettings, at(12, 8))
  assert.equal(check.short, true)
  assert.equal(Math.round(check.need), 40)
  assert.equal(check.free, 8)

  const light = capacityCheck({ ...fullTime, modules: [module] }, { ...fullTimeSettings, studyOnWorkDays: true, workDayMaxHours: 1 }, at(12, 8))
  assert.equal(light.short, false)
})

test('when time is short every module gets some each week, in proportion to its credits', () => {
  const { blocks } = planWeek(fullTime, fullTimeSettings, at(12, 8), at(12, 8))
  const per = id => blocks.filter(b => b.module_id === id).reduce((sum, b) => sum + hours(b), 0)
  assert.equal(per('A') + per('B') + per('C'), 8)
  assert.equal(per('A'), 4)
  assert.equal(per('B'), 2)
  assert.equal(per('C'), 2)
})

test('bookable hours drop to nothing once the week is planned', () => {
  const week = { start: at(12, 0), end: at(19, 0) }
  assert.equal(bookableHours(fullTime, fullTimeSettings, week, at(12, 8)), 8)
  const { blocks } = planWeek(fullTime, fullTimeSettings, at(12, 8), at(12, 8))
  assert.equal(bookableHours({ ...fullTime, blocks }, fullTimeSettings, week, at(12, 8)), 0)
})

test('submitted assessments get no more time', () => {
  const data = { ...emptyWeek, assessments: [{ ...tma('t1', 30), type: 'tma', submitted: true }, { id: 'ex', module_id: 'm1', type: 'exam', title: 'Exam', due: at(30, 10).toISOString(), submitted: true }] }
  assert.equal(getNeeds(data, planSettings, at(12, 8)).length, 0)
  const { blocks } = planWeek(data, { ...planSettings, revisionMode: 'weekly', revisionHours: 3 }, at(12, 8), at(12, 8))
  assert.ok(blocks.every(b => !b.assessment_id))
})

test('catching up adds the extra hours each week until the end date, then stops', () => {
  const behind = { ...module, catch_up: { hours: 2, from: at(12, 8).toISOString(), until: at(29, 12).toISOString(), label: 'TMA 01' } }
  assert.equal(catchUpHours(behind, { start: at(12, 0), end: at(19, 0) }), 2)
  assert.equal(catchUpHours(behind, { start: at(26, 0), end: at(31, 0) }), 2)
  assert.equal(catchUpHours(behind, { start: zonedTime('2026-11-02', '00:00', 'Europe/London'), end: zonedTime('2026-11-09', '00:00', 'Europe/London') }), 0)

  const { blocks } = planWeek({ ...emptyWeek, modules: [behind] }, planSettings, at(12, 8), at(12, 8))
  assert.equal(blocks.reduce((sum, b) => sum + hours(b), 0), 12)
})

test('a plan made to the end in auto mode stays put when nothing changes', () => {
  const data = {
    ...emptyWeek,
    modules: [{ ...module, mode_override: 'auto' }],
    assessments: [
      { id: 'a1', module_id: 'm1', type: 'tma', title: 'TMA 01', due: at(29, 12).toISOString() },
      { id: 'a2', module_id: 'm1', type: 'tma', title: 'TMA 02', due: zonedTime('2026-12-10', '12:00', 'Europe/London').toISOString() }
    ]
  }
  const settingsSpread = { ...planSettings, planStyle: 'spread' }
  const planned = planWeeks(data, settingsSpread, at(12, 8), at(12, 8), 10).blocks
  const again = replanAuto({ ...data, blocks: planned }, settingsSpread, at(12, 8))
  assert.equal(again.unchanged, true)
  assert.equal(again.remove.length, 0)
})

test('auto replanning reacts to a change and then settles', () => {
  const data = { ...emptyWeek, modules: [{ ...module, mode_override: 'auto' }] }
  const planned = planWeeks(data, planSettings, at(12, 8), at(12, 8), 4).blocks
  const changed = { ...data, blocks: planned, exceptions: [{ date: '2026-10-13', type: 'shift', start: '09:00', end: '21:00' }] }
  const first = replanAuto(changed, planSettings, at(12, 8))
  assert.equal(first.unchanged, false)

  const after = [...planned.filter(b => !first.remove.includes(b.id)), ...first.blocks.filter(b => !planned.some(p => p.id === b.id))]
  assert.equal(replanAuto({ ...changed, blocks: after }, planSettings, at(12, 8)).unchanged, true)
})

// study on monday, wednesday, friday and maybe saturday, 4 hours each, no work
const studyDay = { study: true, start: '09:00', end: '21:00', maxHours: 4, preferred: false }
const noStudy = { study: false, start: '09:00', end: '21:00', maxHours: 4, preferred: false }
const threeDays = { 0: noStudy, 1: studyDay, 2: noStudy, 3: studyDay, 4: noStudy, 5: studyDay, 6: noStudy }
const fourDays = { ...threeDays, 6: studyDay }
const modulesOn = (...credits) => credits.map((c, i) => ({ ...module, id: `M${i}`, credits: c }))
const byDay = blocks => {
  const days = {}
  for (const b of blocks) (days[dayLabel(b)] ??= new Set()).add(b.module_id)
  return Object.fromEntries(Object.entries(days).map(([d, s]) => [d, [...s].sort()]))
}

test('three modules and three days get a day each', () => {
  const data = { ...emptyWeek, modules: modulesOn(30, 30, 30) }
  const { blocks } = planWeek(data, { ...planSettings, days: threeDays }, at(12, 8), at(12, 8))
  const days = byDay(blocks)
  assert.deepEqual(Object.values(days).map(m => m.length), [1, 1, 1], 'one module per day')
  assert.equal(new Set(Object.values(days).flat()).size, 3, 'every module gets a day')
})

test('a spare day goes to the module that needs the most time', () => {
  const data = { ...emptyWeek, modules: modulesOn(60, 30, 30) }
  const owners = assignDays(
    [1, 3, 5, 6].map(d => ({ start: at(11 + d, 9), end: at(11 + d, 21) })),
    data.modules.map(m => ({ module_id: m.id, weekly: m.credits / 3 })),
    { ...planSettings, days: fourDays }
  )
  const count = id => Object.values(owners.owners).filter(o => o === id).length
  assert.deepEqual([count('M0'), count('M1'), count('M2')], [2, 1, 1])
})

test('a day keeps the module of blocks you put there yourself', () => {
  const data = { ...emptyWeek, modules: modulesOn(60, 30, 30) }
  const mine = [{ module_id: 'M2', state: 'accepted', byUser: true, start: at(12, 9).toISOString(), end: at(12, 12).toISOString() }]
  const owners = assignDays(
    [1, 3, 5, 6].map(d => ({ start: at(11 + d, 9), end: at(11 + d, 21) })),
    data.modules.map(m => ({ module_id: m.id, weekly: m.credits / 3 })),
    { ...planSettings, days: fourDays },
    mine
  )
  assert.equal(owners.owners['2026-10-12'], 'M2')
  assert.equal(Object.values(owners.owners).filter(o => o === 'M2').length, 1)
})

test('tma work goes on its own module days too', () => {
  const data = { ...emptyWeek, modules: modulesOn(30, 30, 30), assessments: [{ id: 't', module_id: 'M1', type: 'tma', title: 'TMA', due: at(30, 12).toISOString() }] }
  const { blocks } = planWeek(data, { ...planSettings, days: threeDays, hoursPerTma: 4 }, at(12, 8), at(12, 8))
  const days = byDay(blocks)
  const tmaDays = new Set(blocks.filter(b => b.assessment_id === 't').map(dayLabel))
  assert.ok(tmaDays.size > 0)
  for (const d of tmaDays) assert.deepEqual(days[d], ['M1'])
})

test('turning it off lets modules share days', () => {
  const data = { ...emptyWeek, modules: modulesOn(30, 30, 30) }
  const { blocks } = planWeek(data, { ...planSettings, days: threeDays, groupByDay: false }, at(12, 8), at(12, 8))
  assert.equal(blocks.reduce((sum, b) => sum + hours(b), 0), 12)
})

// one module with two tmas and an ema at the end of the year
const uk = (key, time) => zonedTime(key, time, 'Europe/London')
const yearOfWork = [
  { id: 'tma1', module_id: 'm1', type: 'tma', title: 'TMA 01', due: uk('2026-10-29', '12:00').toISOString() },
  { id: 'tma2', module_id: 'm1', type: 'tma', title: 'TMA 02', due: uk('2026-12-10', '12:00').toISOString() },
  { id: 'ema', module_id: 'm1', type: 'ema', title: 'EMA', due: uk('2027-05-20', '12:00').toISOString() }
]
const assessed = blocks => [...new Set(blocks.filter(b => b.assessment_id).map(b => b.assessment_id))].sort()

test('only the next assessment is planned for', () => {
  const { blocks } = planWeek({ ...emptyWeek, assessments: yearOfWork }, { ...planSettings, planStyle: 'spread' }, at(12, 8), at(12, 8))
  assert.deepEqual(assessed(blocks), ['tma1'])
})

test('once the first is submitted the next one gets the time', () => {
  const submitted = yearOfWork.map(a => a.id === 'tma1' ? { ...a, submitted: true } : a)
  const { blocks } = planWeek({ ...emptyWeek, assessments: submitted }, { ...planSettings, planStyle: 'spread' }, at(12, 8), at(12, 8))
  assert.deepEqual(assessed(blocks), ['tma2'])
})

test('planning ahead starts each assessment once the one before should have been finished', () => {
  const { blocks } = planWeeks({ ...emptyWeek, assessments: yearOfWork }, { ...planSettings, planStyle: 'spread' }, at(12, 8), at(12, 8), 12)
  const firstFor = id => blocks.filter(b => b.assessment_id === id).map(b => new Date(b.start)).sort((a, b) => a - b)[0]

  // finish early is 3 days, so tma 01 should be done by 26 oct at noon and tma 02 by 7 dec
  assert.ok(firstFor('tma2') >= uk('2026-10-26', '12:00'), 'tma 02 waits for tma 01 to be finished')
  assert.ok(firstFor('tma2') < uk('2026-11-02', '00:00'), 'and starts the same week, not the week after')
  assert.ok(firstFor('ema') >= uk('2026-12-07', '12:00'), 'the ema waits for tma 02 to be finished')
})

test('turning it off plans for everything at once', () => {
  const { blocks } = planWeek({ ...emptyWeek, assessments: yearOfWork }, { ...planSettings, planStyle: 'spread', oneAtATime: false }, at(12, 8), at(12, 8))
  assert.ok(assessed(blocks).length > 1)
})

test('the queue is per module and skips submitted and past work', () => {
  const other = { id: 'other', module_id: 'm2', type: 'tma', title: 'TMA 01', due: uk('2026-11-20', '12:00').toISOString() }
  const queue = queuedWork([...yearOfWork, other], planSettings, uk('2026-11-02', '00:00'), uk('2026-11-09', '00:00'))
  assert.deepEqual(queue.map(q => q.assessment.id).sort(), ['other', 'tma2'])

  // in the week tma 01 is due, tma 02 joins from tma 01's finish by date
  const dueWeek = queuedWork(yearOfWork, planSettings, uk('2026-10-26', '00:00'), uk('2026-11-02', '00:00'))
  assert.deepEqual(dueWeek.map(q => q.assessment.id), ['tma1', 'tma2'])
  assert.equal(+dueWeek[1].notBefore, +uk('2026-10-26', '12:00'))
})

test('each module works on its own next assessment, so two modules get two tmas at once', () => {
  const twoModules = [{ ...module, id: 'A' }, { ...module, id: 'B' }]
  const work = [
    { id: 'a1', module_id: 'A', type: 'tma', title: 'TMA 01', due: uk('2026-10-29', '12:00').toISOString() },
    { id: 'a2', module_id: 'A', type: 'tma', title: 'TMA 02', due: uk('2026-12-10', '12:00').toISOString() },
    { id: 'b1', module_id: 'B', type: 'tma', title: 'TMA 01', due: uk('2026-10-29', '12:00').toISOString() },
    { id: 'b2', module_id: 'B', type: 'tma', title: 'TMA 02', due: uk('2026-12-10', '12:00').toISOString() }
  ]
  const { blocks } = planWeek({ ...emptyWeek, modules: twoModules, assessments: work }, { ...planSettings, planStyle: 'spread' }, at(12, 8), at(12, 8))
  assert.deepEqual(assessed(blocks), ['a1', 'b1'])
})

// weekday evenings normally, the weekend only if needed
const evening = { study: true, start: '18:00', end: '21:00', maxHours: 3, use: 'normal' }
const weekendIfNeeded = { study: true, start: '09:00', end: '21:00', maxHours: 4, use: 'backup' }
const backupWeek = { 1: evening, 2: evening, 3: evening, 4: evening, 5: evening, 6: weekendIfNeeded, 0: weekendIfNeeded }
const onWeekend = blocks => blocks.filter(b => ['Sat', 'Sun'].includes(dayLabel(b)))

test('only if needed days stay empty while the other days have room', () => {
  const data = { ...emptyWeek, assessments: [{ ...tma('t1', 30), type: 'tma' }] }
  const { blocks } = planWeek(data, { ...planSettings, days: backupWeek, hoursPerTma: 4, planStyle: 'spread' }, at(12, 8), at(12, 8))
  assert.ok(blocks.length > 0)
  assert.equal(onWeekend(blocks).length, 0)
})

test('only if needed days are used when a tma would not fit otherwise', () => {
  // due this saturday with no finish early, 15 weekday hours free but 20 needed
  const data = { ...emptyWeek, assessments: [{ id: 'soon', module_id: 'm1', type: 'tma', title: 'TMA', due: at(18, 20).toISOString() }] }
  const { blocks } = planWeek(data, { ...planSettings, days: backupWeek, hoursPerTma: 20, tmaBuffer: 0, trackOptional: false }, at(12, 8), at(12, 8))
  assert.ok(onWeekend(blocks).length > 0)
  assert.equal(blocks.reduce((sum, b) => sum + hours(b), 0), 20)
})

test('weekly study from credits never goes on only if needed days', () => {
  const { blocks } = planWeek(emptyWeek, { ...planSettings, days: backupWeek }, at(12, 8), at(12, 8))
  assert.equal(onWeekend(blocks).length, 0)
})

test('an older save with a preferred tick still counts as preferred', () => {
  const old = { 1: { study: true, start: '09:00', end: '21:00', maxHours: 4, preferred: true } }
  assert.equal(dayPlanFor(old, 1).use, 'preferred')
  assert.equal(dayPlanFor(old, 2).use, 'normal')
})

function dayPlanFor(days, weekday) {
  return dayPlan({ ...planSettings, days }, weekday)
}

// study only on mondays and wednesdays, 9 to 9, up to 4 hours
const twoLongDays = { ...threeDays, 1: studyDay, 3: studyDay, 5: noStudy }
const gapsOn = (blocks, day) => {
  const list = blocks.filter(b => dayLabel(b) === day).sort((a, b) => a.start.localeCompare(b.start))
  return list.slice(1).map((b, i) => (new Date(b.start) - new Date(list[i].end)) / 60000)
}

test('a day of study is kept together in one session', () => {
  const { blocks } = planWeek(emptyWeek, { ...planSettings, days: twoLongDays, planStyle: 'spread' }, at(12, 8), at(12, 8))
  for (const day of ['Mon', 'Wed']) {
    assert.ok(gapsOn(blocks, day).length > 0, `${day} has more than one block`)
    assert.ok(gapsOn(blocks, day).every(g => g === 15), `${day} blocks are back to back with a break`)
  }
})

test('tma work comes after study on the same day', () => {
  const data = { ...emptyWeek, assessments: [{ ...tma('t1', 30), type: 'tma' }] }
  const { blocks } = planWeek(data, { ...planSettings, days: twoLongDays, planStyle: 'spread', hoursPerTma: 4 }, at(12, 8), at(12, 8))
  for (const day of ['Mon', 'Wed']) {
    const dayBlocks = blocks.filter(b => dayLabel(b) === day).sort((a, b) => a.start.localeCompare(b.start))
    const firstTma = dayBlocks.findIndex(b => b.assessment_id)
    if (firstTma < 0) continue
    assert.ok(dayBlocks.slice(firstTma).every(b => b.assessment_id), `${day}: nothing but tma work after the first tma block`)
  }
  assert.ok(blocks.some(b => b.assessment_id))
})

test('study first never makes a run longer or changes block lengths', () => {
  const block = (start, end, assessment) => ({ module_id: 'm1', assessment_id: assessment, task_id: null, start: at(12, ...start).toISOString(), end: at(12, ...end).toISOString() })
  const run = [block([9, 0], [11, 0], 't1'), block([11, 15], [12, 15], null), block([12, 30], [13, 0], null)]
  const out = studyFirst(run, planSettings)
  assert.deepEqual(out.map(b => b.assessment_id), [null, null, 't1'])
  assert.deepEqual(out.map(b => (new Date(b.end) - new Date(b.start)) / 60000), [60, 30, 120])
  assert.equal(out[0].start, run[0].start)
  assert.equal(out.at(-1).end, run.at(-1).end)
})

test('time already studied is not booked again just because it has passed', () => {
  const data = { ...emptyWeek, assessments: [{ ...tma('t1', 30), type: 'tma' }] }
  const past = { id: 'p', module_id: 'm1', assessment_id: 't1', state: 'accepted', start: at(12, 9).toISOString(), end: at(12, 11).toISOString() }
  const before = getNeeds({ ...data, blocks: [past] }, planSettings, at(12, 8))[0].remaining
  const after = getNeeds({ ...data, blocks: [past] }, planSettings, at(12, 12))[0].remaining
  assert.equal(after, before, 'the remaining hours stay the same once the block is in the past')

  // marking it missed puts the hours back
  const missed = getNeeds({ ...data, blocks: [{ ...past, state: 'missed' }] }, planSettings, at(12, 12))[0].remaining
  assert.equal(missed, before + 2)
})

test('blocks of the same work with no gap become one, up to the longest block', () => {
  const block = (from, to, extra = {}) => ({ module_id: 'm1', assessment_id: null, task_id: null, start: at(12, ...from).toISOString(), end: at(12, ...to).toISOString(), ...extra })
  const joined = joinTouching([block([14, 0], [15, 0]), block([15, 0], [17, 0]), block([17, 0], [19, 0], { assessment_id: 't1' })], { ...planSettings, maxBlock: 240 })
  assert.deepEqual(joined.map(b => [b.start, b.end, b.assessment_id]), [[at(12, 14).toISOString(), at(12, 17).toISOString(), null], [at(12, 17).toISOString(), at(12, 19).toISOString(), 't1']])

  // never longer than the longest block
  const capped = joinTouching([block([14, 0], [16, 0]), block([16, 0], [18, 0])], { ...planSettings, maxBlock: 180 })
  assert.equal(capped.length, 2)
})

test('an auto plan stays put as the hours go by during the day', () => {
  const data = { ...emptyWeek, modules: [{ ...module, mode_override: 'auto' }], assessments: [{ ...tma('t1', 30), type: 'tma' }] }
  const settingsSpread = { ...planSettings, planStyle: 'spread' }
  const morning = planWeeks(data, settingsSpread, at(12, 8), at(12, 8), 1).blocks
  for (const hour of [10, 13, 16]) {
    assert.equal(replanAuto({ ...data, blocks: morning }, settingsSpread, at(12, hour)).unchanged, true, `still the same at ${hour}:00`)
  }
})

test('each module keeps the same weekday every week', () => {
  const data = { ...emptyWeek, modules: modulesOn(30, 30, 30) }
  const settingsSpread = { ...planSettings, planStyle: 'spread', days: fourDays }
  const weekdaysOf = blocks => {
    const days = {}
    for (const b of blocks) (days[new Date(b.start).getUTCDay()] ??= new Set()).add(b.module_id)
    return Object.fromEntries(Object.entries(days).map(([d, s]) => [d, [...s].sort().join()]))
  }
  const blocks = planWeeks(data, settingsSpread, at(12, 8), at(12, 8), 3).blocks
  const weeks = [12, 19, 26].map(d => weekdaysOf(blocks.filter(b => new Date(b.start) >= at(d, 0) && new Date(b.start) < at(d + 7, 0))))
  assert.deepEqual(weeks[1], weeks[0])
  assert.deepEqual(weeks[2], weeks[0])
})

test('a weekday you keep putting a module on becomes its usual day', () => {
  const mine = [{ module_id: 'B', state: 'accepted', start: at(12, 9).toISOString(), end: at(12, 12).toISOString() }]
  const owners = weekdayOwners(['A', 'B'], { ...planSettings, days: fourDays }, mine)
  assert.equal(owners[1], 'B')
  assert.ok(Object.values(owners).includes('A'))
})

test('a day is packed into one run from its first free time, study before tma work', () => {
  const free = [{ start: at(13, 9), end: at(13, 12) }, { start: at(13, 13), end: at(13, 18) }]
  const blocks = [
    { module_id: 'm1', assessment_id: 't', task_id: null, start: at(13, 15).toISOString(), end: at(13, 17).toISOString() },
    { module_id: 'm1', assessment_id: null, task_id: null, start: at(13, 10).toISOString(), end: at(13, 11).toISOString() }
  ]
  const packed = packDays(blocks, free, { ...planSettings, maxBlock: 240, minBlock: 60, breakMins: 0 })
  assert.deepEqual(packed.map(b => [new Date(b.start).getUTCHours(), hours(b), b.assessment_id]), [[8, 1, null], [9, 2, 't']])
})

test('a day is left alone if packing would push tma work past its finish by date', () => {
  const free = [{ start: at(13, 9), end: at(13, 18) }]
  const blocks = [
    { module_id: 'm1', assessment_id: 't', task_id: null, start: at(13, 9).toISOString(), end: at(13, 11).toISOString() },
    { module_id: 'm1', assessment_id: null, task_id: null, start: at(13, 11).toISOString(), end: at(13, 13).toISOString() }
  ]
  const packed = packDays(blocks, free, { ...planSettings, maxBlock: 240, minBlock: 60, breakMins: 0 }, { t: { target: at(13, 11) } })
  assert.deepEqual(packed, blocks)
})

test('dragging a block against the same work joins them past the longest block', () => {
  const block = (id, from, to, extra = {}) => ({ id, module_id: 'm1', assessment_id: 't', state: 'accepted', start: at(13, from).toISOString(), end: at(13, to).toISOString(), ...extra })
  const others = [block('a', 9, 13), block('b', 13, 17), block('c', 17, 18, { assessment_id: null }), block('d', 18, 19, { state: 'done' })]
  const { block: joined, remove } = joinDropped(block('x', 13, 17), others.filter(b => b.id !== 'b'))
  assert.equal(joined.id, 'x')
  assert.equal(hours(joined), 8)
  assert.deepEqual(remove, ['a'])
  assert.deepEqual(joinDropped(block('x', 20, 21), others).remove, [])
})

test('saved usual days win over one-off drags', () => {
  const mine = [{ module_id: 'B', state: 'accepted', start: at(12, 9).toISOString(), end: at(12, 17).toISOString() }]
  const owners = weekdayOwners(['A', 'B'], { ...planSettings, days: fourDays, moduleDays: { 1: 'A', 3: 'B' } }, mine)
  assert.equal(owners[1], 'A')
  assert.equal(owners[3], 'B')
})

test('a one-off drag to another day leaves the following weeks as they were', () => {
  const data = { ...emptyWeek, modules: modulesOn(30, 30) }
  const daySettings = { ...planSettings, planStyle: 'spread', days: fourDays, moduleDays: { 1: 'M0', 3: 'M1' } }
  const usual = planWeeks(data, daySettings, at(12, 8), at(12, 8), 2).blocks
  const moved = { module_id: 'M0', assessment_id: null, task_id: null, state: 'accepted', byUser: true, start: at(14, 9).toISOString(), end: at(14, 11).toISOString() }
  const after = planWeeks({ ...data, blocks: [moved] }, daySettings, at(12, 8), at(12, 8), 2).blocks
  const nextWeek = blocks => blocks.filter(b => new Date(b.start) >= at(19, 0)).map(b => b.id).sort()
  assert.deepEqual(nextWeek(after), nextWeek(usual))
})
