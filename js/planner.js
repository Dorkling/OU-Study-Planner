import { dateKey, shiftDays, hoursBetween, weekBounds } from './time.js'
import { cutSlots, getFreeTime } from './freetime.js'
import { weeklyHours } from './estimates.js'

// round up to the next quarter hour
const quarters = hours => Math.ceil(hours * 4 - 1e-9) / 4

// logged time if there is one, otherwise block length
const blockHours = b => b.done_hours ?? hoursBetween(new Date(b.start), new Date(b.end))

const isRevision = a => a.type === 'exam' || a.type === 'ema'

// blank parts share what's left of the default
export function partEstimates(tasks, defaultHours) {
  const set = tasks.filter(t => t.est_hours > 0)
  const blank = tasks.length - set.length
  const setTotal = set.reduce((sum, t) => sum + t.est_hours, 0)
  const share = blank ? Math.max(0, defaultHours - setTotal) / blank : 0
  return new Map(tasks.map(t => [t.id, t.est_hours > 0 ? t.est_hours : share]))
}

// default hours if there are no parts
export function assessmentHours(tasks, defaultHours) {
  if (!tasks.length) return defaultHours
  return [...partEstimates(tasks, defaultHours).values()].reduce((sum, h) => sum + h, 0)
}

// tmas and exams have separate defaults
export function defaultHours(assessment, settings) {
  return assessment.type === 'tma' ? settings.hoursPerTma : settings.hoursPerExam
}

// hours left per unfinished part
function partsLeft(tasks, defaultHours) {
  const estimates = partEstimates(tasks, defaultHours)
  return [...tasks]
    .sort((a, b) => (a.created || 0) - (b.created || 0))
    .filter(t => t.status !== 'done')
    .map(t => ({ id: t.id, left: Math.max(0, estimates.get(t.id) - (t.done_hours || 0)) }))
}

// hours left and target date for each assessment
export function getNeeds(data, settings, now) {
  return data.assessments
    .filter(a => new Date(a.due) > now)
    .map(a => {
      const tasks = data.tasks.filter(t => t.assessment_id === a.id)
      const total = assessmentHours(tasks, defaultHours(a, settings))
      const parts = partsLeft(tasks, defaultHours(a, settings))

      // done blocks with no part come off the total
      const partIds = new Set(tasks.map(t => t.id))
      const doneLoose = data.blocks
        .filter(b => b.assessment_id === a.id && b.state === 'done' && !partIds.has(b.task_id))
        .reduce((sum, b) => sum + blockHours(b), 0)
      const done = tasks.reduce((sum, t) => sum + (t.done_hours || 0), 0) + doneLoose
      const left = (tasks.length ? parts.reduce((sum, p) => sum + p.left, 0) : total) - doneLoose

      // take off accepted blocks still to come
      const planned = data.blocks
        .filter(b => b.assessment_id === a.id && b.state === 'accepted' && new Date(b.end) > now)
        .reduce((sum, b) => sum + hoursBetween(new Date(b.start), new Date(b.end)), 0)

      // finish early unless that date has passed
      const due = new Date(a.due)
      const buffered = shiftDays(due, -settings.tmaBuffer, settings.timeZone)
      const target = buffered > now ? buffered : due

      return { assessment: a, module_id: a.module_id, parts, total, done, planned, remaining: quarters(Math.max(0, left - planned)), target }
    })
}

// weekly hours from credits minus booked blocks and tutorials
export function getModuleNeeds(data, settings, week, booked) {
  const zone = settings.timeZone
  const firstKey = dateKey(week.start, zone)
  const lastKey = dateKey(new Date(week.end - 1), zone)

  const inWeek = item => new Date(item.start) >= week.start && new Date(item.start) < week.end
  const hoursOf = items => items.reduce((sum, i) => sum + hoursBetween(new Date(i.start), new Date(i.end)), 0)

  return data.modules
    .filter(m => m.start <= lastKey && m.end >= firstKey)
    .map(m => {
      const weekly = weeklyHours(m, settings.hoursPerCredit)
      const blocks = booked.filter(b => b.module_id === m.id && b.state !== 'suggested' && b.state !== 'missed' && inWeek(b))
      const tutorials = data.tutorials.filter(t => t.module_id === m.id && t.attended !== false && inWeek(t))
      const covered = hoursOf(blocks) + hoursOf(tutorials)
      const remaining = Math.round(Math.max(0, weekly - covered) * 4) / 4

      // module to-dos like recordings go first
      const parts = data.tasks
        .filter(t => t.module_id === m.id && !t.assessment_id && t.status !== 'done')
        .sort((a, b) => (a.created || 0) - (b.created || 0))
        .map(t => ({ id: t.id, left: Math.max(0, (t.est_hours || 0) - (t.done_hours || 0)) }))

      return { assessment: null, module_id: m.id, parts, weekly, covered, remaining, target: week.end }
    })
}

// fill slots earliest target first, keeping to the daily limit
export function planBlocks(free, needs, existing, settings) {
  const zone = settings.timeZone
  const slots = cutSlots(free, settings).sort((a, b) => a.start - b.start)
  const dayOf = slot => slot.key || dateKey(slot.start, zone)

  // hours already booked each day
  const used = {}
  for (const b of existing.filter(b => b.state === 'accepted' || b.state === 'done')) {
    const key = dateKey(new Date(b.start), zone)
    used[key] = (used[key] || 0) + hoursBetween(new Date(b.start), new Date(b.end))
  }

  // hours this slot can take, 0 if none
  function hoursIn(slot, need, left) {
    if (slot.taken || slot.end > need.target) return 0
    const limit = slot.workDay ? settings.workDayMaxHours : settings.maxHoursPerDay
    const room = Math.floor((limit - (used[dayOf(slot)] || 0)) * 4) / 4

    // never book less than the shortest block
    const wanted = Math.max(left, settings.minBlock / 60)
    const hours = Math.min(hoursBetween(slot.start, slot.end), wanted, room)
    return hours * 60 < settings.minBlock ? 0 : hours
  }

  const blocks = []
  const atRisk = []

  // book a block against the first part with time left
  function place(slot, need, hours, parts) {
    const part = parts.find(p => p.left > 0)
    if (part) part.left -= hours

    const end = new Date(+slot.start + hours * 3600000)
    blocks.push({
      assessment_id: need.assessment?.id || null,
      module_id: need.module_id ?? need.assessment.module_id,
      task_id: part?.id || null,
      start: slot.start.toISOString(),
      end: end.toISOString()
    })

    used[dayOf(slot)] = (used[dayOf(slot)] || 0) + hours

    // keep the rest of the slot after a break
    slot.start = new Date(+end + settings.breakMins * 60000)
    slot.taken = hoursBetween(slot.start, slot.end) * 60 < settings.minBlock
    return hours
  }

  const order = [...needs]
    .filter(n => n.remaining > 0)
    .sort((a, b) => a.target - b.target || b.remaining - a.remaining)

  for (const need of order) {
    let left = need.remaining
    const parts = need.parts.map(p => ({ ...p }))

    // spread: aim blocks at even points up to the target
    if (settings.planStyle === 'spread' && slots.length) {
      const from = +slots[0].start
      const count = Math.ceil(left / (settings.maxBlock / 60))
      const step = (need.target - from) / count

      for (let i = 0; i < count && left > 0; i++) {
        const aim = from + step * (i + 0.5)
        const byDistance = (a, b) => Math.abs(a.start - aim) - Math.abs(b.start - aim)

        // prefer slots that fit a full block
        const full = Math.min(left, settings.maxBlock / 60)
        const usable = slots.filter(slot => hoursIn(slot, need, left))
        const nearest = usable.filter(slot => hoursIn(slot, need, left) >= full).sort(byDistance)[0] || usable.sort(byDistance)[0]
        if (!nearest) break
        left -= place(nearest, need, hoursIn(nearest, need, left), parts)
      }
    }

    // put anything left in the earliest slots
    for (const slot of slots) {
      if (left <= 0) break
      const hours = hoursIn(slot, need, left)
      if (hours) left -= place(slot, need, hours, parts)
    }

    // only assessments can be at risk
    if (left > 0 && need.assessment) atRisk.push({ assessment: need.assessment, hours: quarters(left), target: need.target })
  }

  return { blocks, atRisk }
}

// fixed weekly revision hours for exams and emas
function revisionNeeds(data, settings, week, booked, now) {
  const inWeek = b => new Date(b.start) >= week.start && new Date(b.start) < week.end
  return data.assessments
    .filter(a => isRevision(a) && new Date(a.due) > now)
    .map(a => {
      const tasks = data.tasks.filter(t => t.assessment_id === a.id)
      const thisWeek = booked
        .filter(b => b.assessment_id === a.id && b.state !== 'suggested' && b.state !== 'missed' && inWeek(b))
        .reduce((sum, b) => sum + blockHours(b), 0)
      const target = new Date(Math.min(week.end, new Date(a.due)))
      return { assessment: a, module_id: a.module_id, parts: partsLeft(tasks, defaultHours(a, settings)), remaining: quarters(Math.max(0, settings.revisionHours - thisWeek)), target }
    })
}

// used to check if a plan has changed
const signature = blocks => blocks
  .map(b => [b.module_id, b.assessment_id, b.task_id, b.state, Boolean(b.auto), new Date(b.start).getTime(), new Date(b.end).getTime()].join())
  .sort()
  .join('|')

// plan a week: assessments, then revision, then module study
// modes is which planner modes to include
export function planWeek(data, settings, now, weekOf, modes = ['auto', 'suggest']) {
  const week = weekBounds(weekOf, settings.timeZone)
  const modeOf = id => data.modules.find(m => m.id === id)?.mode_override || settings.plannerMode
  const planning = data.modules.filter(m => modes.includes(modeOf(m.id))).map(m => m.id)

  // redo suggestions and future auto blocks, keep the rest
  const redo = b => planning.includes(b.module_id) && (
    b.state === 'suggested' ||
    (b.state === 'accepted' && b.auto && new Date(b.start) > now)
  )
  const replaced = data.blocks.filter(redo)
  const kept = data.blocks.filter(b => !redo(b) && b.state !== 'suggested')

  // plan up to the last target so risks show now
  const weekly = settings.revisionMode === 'weekly'
  const assessments = data.assessments.filter(a => planning.includes(a.module_id) && !(weekly && isRevision(a)))
  const needs = getNeeds({ ...data, assessments, blocks: kept }, settings, now)
  const until = new Date(Math.max(week.end, ...needs.map(n => +n.target)))
  const free = getFreeTime(now, until, { ...data, blocks: kept, now }, settings)
  const first = planBlocks(free, needs, kept, settings)
  let placed = first.blocks.filter(b => new Date(b.start) < week.end)

  // fill the rest of the week
  const after = (needsFor) => {
    const booked = [...kept, ...placed.map(b => ({ ...b, state: 'accepted' }))]
    const freeLeft = getFreeTime(now, week.end, { ...data, blocks: booked, now }, settings)
    placed = [...placed, ...planBlocks(freeLeft, needsFor(booked), booked, settings).blocks]
  }
  if (weekly) after(booked => revisionNeeds({ ...data, assessments: data.assessments.filter(a => planning.includes(a.module_id)) }, settings, week, booked, now))
  if (settings.trackOptional) after(booked => getModuleNeeds(data, settings, week, booked).filter(n => planning.includes(n.module_id)))

  const blocks = placed.map(b => {
    const auto = modeOf(b.module_id) === 'auto'
    return { ...b, state: auto ? 'accepted' : 'suggested', auto }
  })

  return {
    blocks,
    remove: replaced.map(b => b.id),
    unchanged: signature(blocks) === signature(replaced),
    atRisk: first.atRisk,
    hadWork: blocks.length > 0 || needs.some(n => n.remaining > 0)
  }
}

// find what won't fit without saving anything
export function checkRisks(data, settings, now) {
  const kept = data.blocks.filter(b => b.state !== 'suggested')
  const weekly = settings.revisionMode === 'weekly'
  const needs = getNeeds({ ...data, assessments: data.assessments.filter(a => !(weekly && isRevision(a))), blocks: kept }, settings, now)
  if (!needs.some(n => n.remaining > 0)) return []

  const until = new Date(Math.max(...needs.map(n => +n.target)))
  const free = getFreeTime(now, until, { ...data, blocks: kept, now }, settings)
  return planBlocks(free, needs, kept, { ...settings, planStyle: 'early' }).atRisk
}
