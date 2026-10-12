import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moduleHours, suggestedWeekly, weeklyHours } from '../js/estimates.js'

// 30 credits over 30 weeks
const module = { credits: 30, start: '2026-10-05', end: '2027-05-03' }

test('weekly hours come from credits and dates', () => {
  assert.equal(moduleHours(module, 10), 300)
  assert.equal(suggestedWeekly(module, 10), 10)
  assert.equal(weeklyHours(module, 10), 10)
})

test('hours the user sets win over the suggestion', () => {
  assert.equal(weeklyHours({ ...module, weekly_hours: 6 }, 10), 6)
  assert.equal(weeklyHours({ ...module, weekly_hours: null }, 10), 10)
  assert.equal(weeklyHours({ ...module, weekly_hours: 0 }, 10), 10)
})
