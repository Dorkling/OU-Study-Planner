import { test } from 'node:test'
import assert from 'node:assert/strict'
import { packModule, unpackModule, mergeModule } from '../js/share.js'

const module = { id: 'm1', code: 'SM380', title: 'Our dynamic Sun', credits: 30, start: '2026-10-03', end: '2027-06-10', updated: 5 }
const tma = (title, due, extra = {}) => ({ id: title, module_id: 'm1', type: 'tma', title, due, weight: 25, provisional: false, ...extra })

test('a shared file has the dates and nothing personal', () => {
  const file = JSON.parse(packModule(module, [tma('TMA 01', '2026-11-12T12:00:00.000Z', { done_hours: 3 })]))
  assert.deepEqual(Object.keys(file.module).sort(), ['code', 'credits', 'end', 'start', 'title'])
  assert.deepEqual(Object.keys(file.assessments[0]).sort(), ['due', 'provisional', 'title', 'type', 'weight'])
  assert.throws(() => unpackModule('{"app":"ou-study-planner","data":{}}'), /isn't a shared module/)
})

test('a new module comes in with all its assessments', () => {
  const shared = unpackModule(packModule(module, [tma('TMA 01', 'a'), tma('TMA 02', 'b')]))
  const result = mergeModule(shared, [], [])
  assert.equal(result.isNew, true)
  assert.equal(result.module.code, 'SM380')
  assert.equal(result.added, 2)
})

test('an existing module only gets new or changed dates', () => {
  const mine = [tma('TMA 01', 'a'), tma('Exam', 'rough', { type: 'exam', provisional: true })]
  const theirs = [tma('tma 01', 'a'), tma('TMA 02', 'b'), tma('Exam', 'confirmed', { type: 'exam' })]
  const result = mergeModule(unpackModule(packModule(module, theirs)), [module], mine)

  assert.equal(result.isNew, false)
  assert.equal(result.module.id, 'm1')
  assert.equal(result.added, 1)
  assert.equal(result.updated, 1)
  assert.deepEqual(result.assessments.map(a => [a.title, a.due]), [['TMA 02', 'b'], ['Exam', 'confirmed']])
})

test('a confirmed date is never replaced by a rough one', () => {
  const mine = [tma('Exam', 'confirmed', { type: 'exam' })]
  const theirs = [tma('Exam', 'rough', { type: 'exam', provisional: true })]
  const result = mergeModule(unpackModule(packModule(module, theirs)), [module], mine)
  assert.equal(result.assessments.length, 0)
})
