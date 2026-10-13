import { dateKey, shiftDays, hoursBetween, weekBounds, weekdayOf, addDaysToKey, startOfDay } from './time.js'
import { cutSlots, getFreeTime, getBusy, dayPlan } from './freetime.js'
import { weeklyHours } from './estimates.js'

// same block, same id on every device, so two devices planning the same week don't double up
export function blockId(block) {
  const text = [block.module_id, block.assessment_id, block.task_id, block.start, block.end].join('|')
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0
    b = Math.imul(b ^ text.charCodeAt(i), 0x5bd1e995) >>> 0
  }
  return `plan-${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`
}

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
    // submitted work needs no more time
    .filter(a => !a.submitted && new Date(a.due) > now)
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

// extra hours a week while a module is catching up, from when it was asked for until the end date
export function catchUpHours(module, week) {
  const c = module.catch_up
  if (!c?.hours || new Date(c.until) <= week.start || new Date(c.from) >= week.end) return 0
  return c.hours
}

// weekly hours from credits plus any catch up, minus booked blocks and tutorials
export function getModuleNeeds(data, settings, week, booked) {
  const zone = settings.timeZone
  const firstKey = dateKey(week.start, zone)
  const lastKey = dateKey(new Date(week.end - 1), zone)

  const inWeek = item => new Date(item.start) >= week.start && new Date(item.start) < week.end
  const hoursOf = items => items.reduce((sum, i) => sum + hoursBetween(new Date(i.start), new Date(i.end)), 0)

  return data.modules
    .filter(m => m.start <= lastKey && m.end >= firstKey)
    .map(m => {
      const catchUp = catchUpHours(m, week)
      const weekly = weeklyHours(m, settings.hoursPerCredit) + catchUp
      const blocks = booked.filter(b => b.module_id === m.id && b.state !== 'suggested' && b.state !== 'missed' && inWeek(b))
      const tutorials = data.tutorials.filter(t => t.module_id === m.id && t.attended !== false && inWeek(t))
      const covered = hoursOf(blocks) + hoursOf(tutorials)
      const remaining = Math.round(Math.max(0, weekly - covered) * 4) / 4

      // module to-dos like recordings go first
      const parts = data.tasks
        .filter(t => t.module_id === m.id && !t.assessment_id && t.status !== 'done')
        .sort((a, b) => (a.created || 0) - (b.created || 0))
        .map(t => ({ id: t.id, left: Math.max(0, (t.est_hours || 0) - (t.done_hours || 0)) }))

      return { assessment: null, module_id: m.id, parts, weekly, catchUp, covered, remaining, target: week.end }
    })
}

// fill slots earliest target first, keeping to the daily limit
export function planBlocks(free, needs, existing, settings, days = { owners: {}, shares: {} }) {
  const zone = settings.timeZone
  const slots = cutSlots(free, settings).sort((a, b) => a.start - b.start)
  const dayOf = slot => slot.key || dateKey(slot.start, zone)

  // 0 for the module's own day while it's under its fair share, 1 for a day nobody has, 2 for another module's day
  const moduleOf = need => need.module_id ?? need.assessment.module_id
  const booked = {}
  const tierOf = (slot, need) => {
    const owner = days.owners[dayOf(slot)]
    const module = moduleOf(need)
    if (!owner) return 1
    if (owner !== module) return 2
    return (booked[module] || 0) < (days.shares[module] ?? Infinity) ? 0 : 1
  }

  // hours already booked each day
  const used = {}
  for (const b of existing.filter(b => b.state === 'accepted' || b.state === 'done')) {
    const key = dateKey(new Date(b.start), zone)
    used[key] = (used[key] || 0) + hoursBetween(new Date(b.start), new Date(b.end))
  }

  // hours this slot can take, 0 if none
  function hoursIn(slot, need, left) {
    if (slot.taken || slot.end > need.target || (need.notBefore && slot.start < need.notBefore)) return 0
    const limit = slot.workDay ? settings.workDayMaxHours : dayPlan(settings, weekdayOf(dayOf(slot))).maxHours
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
    const block = {
      assessment_id: need.assessment?.id || null,
      module_id: need.module_id ?? need.assessment.module_id,
      task_id: part?.id || null,
      start: slot.start.toISOString(),
      end: end.toISOString()
    }
    blocks.push({ ...block, id: blockId(block) })

    used[dayOf(slot)] = (used[dayOf(slot)] || 0) + hours
    booked[moduleOf(need)] = (booked[moduleOf(need)] || 0) + hours

    // keep the rest of the slot after a break
    slot.start = new Date(+end + settings.breakMins * 60000)
    slot.taken = hoursBetween(slot.start, slot.end) * 60 < settings.minBlock
    return hours
  }

  // work due on the same day takes turns, so no one thing hogs the time when it's short
  const order = [...needs]
    .filter(n => n.remaining > 0)
    .sort((a, b) => a.target - b.target || b.remaining - a.remaining)
  const groups = []
  for (const need of order) {
    const last = groups.at(-1)
    if (last && dateKey(last[0].target, zone) === dateKey(need.target, zone)) last.push(need)
    else groups.push([need])
  }

  for (const group of groups) {
    const states = group.map(need => ({
      need,
      left: need.remaining,
      parts: need.parts.map(p => ({ ...p })),
      count: Math.ceil(need.remaining / (settings.maxBlock / 60)),
      turn: 0,
      stuck: false
    }))

    // the next turn goes to whichever has the most of its share still to book
    const next = fits => states
      .filter(st => !st.stuck && st.left > 0 && (!fits || fits(st)))
      .sort((a, b) => b.left / b.need.remaining - a.left / a.need.remaining)[0]

    // spread: aim blocks at even points up to the target
    if (settings.planStyle === 'spread' && slots.length) {
      const from = +slots[0].start
      let st
      while ((st = next())) {
        if (st.turn >= st.count) {
          st.stuck = true
          continue
        }
        const start = Math.max(from, +(st.need.notBefore || 0))
        const aim = start + (st.need.target - start) / st.count * (st.turn + 0.5)
        st.turn++
        const byDistance = (a, b) => Math.abs(a.start - aim) - Math.abs(b.start - aim)

        // within the same week: the module's own day first, then a slot that takes a full block, then a preferred day, then the nearest
        const full = Math.min(st.left, settings.maxBlock / 60)
        const usable = slots.filter(slot => hoursIn(slot, st.need, st.left))
        const isFull = slot => hoursIn(slot, st.need, st.left) >= full ? 1 : 0
        const sameWeek = usable.filter(slot => Math.abs(slot.start - aim) <= 3.5 * 86400000)
        const ranked = sameWeek.sort((a, b) => tierOf(a, st.need) - tierOf(b, st.need) || isFull(b) - isFull(a) || b.preferred - a.preferred || byDistance(a, b))
        const nearest = ranked[0] || usable.filter(isFull).sort(byDistance)[0] || usable.sort(byDistance)[0]
        if (!nearest) {
          st.stuck = true
          continue
        }
        st.left -= place(nearest, st.need, hoursIn(nearest, st.need, st.left), st.parts)
      }
      states.forEach(st => { st.stuck = false })
    }

    // put anything left in the earliest slots, own days first, then preferred days, still taking turns
    for (const tier of [0, 1, 2]) {
      for (const preferredOnly of [true, false]) {
        for (const slot of slots) {
          if (preferredOnly && !slot.preferred) continue
          let st
          while (!slot.taken && (st = next(st => tierOf(slot, st.need) <= tier && hoursIn(slot, st.need, st.left) > 0))) {
            st.left -= place(slot, st.need, hoursIn(slot, st.need, st.left), st.parts)
          }
        }
      }
    }

    // only assessments can be at risk
    for (const st of states) {
      if (st.left > 0 && st.need.assessment) atRisk.push({ assessment: st.need.assessment, hours: quarters(st.left), target: st.need.target })
    }
  }

  return { blocks, atRisk }
}

// fixed weekly revision hours for exams and emas
function revisionNeeds(data, settings, week, booked, now) {
  const inWeek = b => new Date(b.start) >= week.start && new Date(b.start) < week.end
  return data.assessments
    .filter(a => isRevision(a) && !a.submitted && new Date(a.due) > now)
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

// one module per day where possible: each module gets a day first, the neediest the biggest,
// then any spare days go to whichever still needs the most time
// when time is short each module's claim on its own days stops at its fair share of the week
export function assignDays(free, moduleNeeds, settings) {
  const zone = settings.timeZone
  const modules = moduleNeeds.filter(m => m.weekly > 0)
  if (modules.length < 2) return { owners: {}, shares: {} }

  // hours each day could take, keeping to its limit
  const days = {}
  for (const f of free) {
    const key = f.key || dateKey(f.start, zone)
    const limit = f.workDay ? settings.workDayMaxHours : dayPlan(settings, weekdayOf(key)).maxHours
    days[key] ??= { key, hours: 0, limit }
    days[key].hours += hoursBetween(f.start, f.end)
  }
  const biggest = Object.values(days)
    .map(d => ({ key: d.key, hours: Math.min(d.hours, d.limit) }))
    .filter(d => d.hours * 60 >= settings.minBlock)
    .sort((a, b) => b.hours - a.hours || a.key.localeCompare(b.key))

  const owners = {}
  const left = modules.map(m => ({ id: m.module_id, hours: m.weekly })).sort((a, b) => b.hours - a.hours)
  biggest.forEach((day, i) => {
    const module = i < left.length ? left[i] : [...left].sort((a, b) => b.hours - a.hours)[0]
    owners[day.key] = module.id
    module.hours -= day.hours
  })

  const capacity = biggest.reduce((sum, d) => sum + d.hours, 0)
  const need = modules.reduce((sum, m) => sum + m.weekly, 0)
  const shares = Object.fromEntries(modules.map(m => [m.module_id, need > capacity ? capacity * m.weekly / need : m.weekly]))
  return { owners, shares }
}

// each module's next assessment still to do, as of a date, so later ones wait their turn
// each assessment can start once the one before it in the module should have been finished,
// so only work whose turn comes before the end of the week is returned, with the date it can start
export function queuedWork(assessments, settings, from, until) {
  const upcoming = assessments
    .filter(a => !a.submitted && new Date(a.due) > from)
    .sort((a, b) => a.due.localeCompare(b.due))

  const ready = []
  const finished = {}
  for (const a of upcoming) {
    const notBefore = finished[a.module_id]
    if (!notBefore || notBefore < until) ready.push({ assessment: a, notBefore })
    finished[a.module_id] = shiftDays(new Date(a.due), -settings.tmaBuffer, settings.timeZone)
  }
  return ready
}

// plan a week: assessments, then revision, then module study
// modes is which planner modes to include
export function planWeek(data, settings, now, weekOf, modes = ['auto', 'suggest']) {
  const week = weekBounds(weekOf, settings.timeZone)
  const modeOf = id => data.modules.find(m => m.id === id)?.mode_override || settings.plannerMode
  const planning = data.modules.filter(m => modes.includes(modeOf(m.id))).map(m => m.id)

  // only touch this week, from now if it's the current one
  const from = new Date(Math.max(now, week.start))
  const inWeek = b => new Date(b.start) >= week.start && new Date(b.start) < week.end

  // redo this week's suggestions and future auto blocks, keep the rest
  const redo = b => planning.includes(b.module_id) && inWeek(b) && (
    b.state === 'suggested' ||
    (b.state === 'accepted' && b.auto && new Date(b.start) > now)
  )
  const replaced = data.blocks.filter(redo)
  const kept = data.blocks.filter(b => !redo(b) && b.state !== 'suggested')

  // suggestions in other weeks count as planned so hours aren't booked twice
  const elsewhere = data.blocks.filter(b => b.state === 'suggested' && !redo(b)).map(b => ({ ...b, state: 'accepted' }))

  // plan up to the last target so the week gets its share
  const weekly = settings.revisionMode === 'weekly'
  // by default only each module's next assessment gets time, the rest wait until it's submitted or due
  const queue = settings.oneAtATime === false ? data.assessments.map(assessment => ({ assessment })) : queuedWork(data.assessments, settings, from, week.end)
  const startsFrom = Object.fromEntries(queue.map(q => [q.assessment.id, q.notBefore]))
  const current = queue.map(q => q.assessment)
  const assessments = current.filter(a => planning.includes(a.module_id) && !(weekly && isRevision(a)))
  const needs = getNeeds({ ...data, assessments, blocks: [...kept, ...elsewhere] }, settings, now)
    .map(n => ({ ...n, notBefore: startsFrom[n.assessment.id] }))
  const until = new Date(Math.max(week.end, ...needs.map(n => +n.target)))
  const free = getFreeTime(from, until, { ...data, blocks: kept, now }, settings)
  const owners = settings.groupByDay === false ? undefined : assignDays(getFreeTime(from, week.end, { ...data, blocks: kept, now }, settings), getModuleNeeds(data, settings, week, kept), settings)
  const first = planBlocks(free, needs, kept, settings, owners)
  let placed = first.blocks.filter(b => new Date(b.start) < week.end)

  // fill the rest of the week
  const after = (needsFor) => {
    const booked = [...kept, ...placed.map(b => ({ ...b, state: 'accepted' }))]
    const freeLeft = getFreeTime(from, week.end, { ...data, blocks: booked, now }, settings)
    placed = [...placed, ...planBlocks(freeLeft, needsFor(booked), booked, settings, owners).blocks]
  }
  if (weekly) after(booked => revisionNeeds({ ...data, assessments: current.filter(a => planning.includes(a.module_id)) }, settings, week, booked, now)
    .map(n => ({ ...n, notBefore: startsFrom[n.assessment.id] })))
  if (settings.trackOptional) after(booked => getModuleNeeds(data, settings, week, booked).filter(n => planning.includes(n.module_id)))

  const blocks = placed.map(b => {
    const auto = modeOf(b.module_id) === 'auto'
    return { ...b, state: auto ? 'accepted' : 'suggested', auto }
  })

  return {
    blocks,
    // a block planned again in the same place keeps its id, so it isn't deleted and re-added
    remove: replaced.map(b => b.id).filter(id => !blocks.some(b => b.id === id)),
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

// future blocks that overlap work, blocked time or tutorials, or sit outside study hours
// blocks the user placed themselves are only checked against the first three
export function findClashes(data, settings, now) {
  const upcoming = data.blocks.filter(b => (b.state === 'accepted' || b.state === 'suggested') && new Date(b.start) > now)
  if (!upcoming.length) return []

  // a day past the last block so a shift's travel time just after it still counts
  const until = new Date(Math.max(...upcoming.map(b => +new Date(b.end))) + 86400000)
  const fixed = { ...data, blocks: [], now }
  const busy = getBusy(now, until, fixed, settings)
  const allowed = getFreeTime(now, until, fixed, settings)

  return upcoming.flatMap(b => {
    const start = new Date(b.start)
    const end = new Date(b.end)
    if (busy.some(x => x.start < end && x.end > start)) return [{ block: b, reason: 'busy' }]
    if (!b.byUser && !allowed.some(f => f.start <= start && f.end >= end)) return [{ block: b, reason: 'hours' }]
    return []
  })
}

// weeks from the week of a date to the last module end or deadline, at least 1
export function weeksToEnd(data, settings, fromDate) {
  const zone = settings.timeZone
  const ends = [
    ...data.modules.map(m => +startOfDay(m.end, zone)),
    ...data.assessments.map(a => +new Date(a.due))
  ]
  if (!ends.length) return 1
  const first = weekBounds(fromDate, zone).start
  const last = weekBounds(new Date(Math.max(...ends)), zone).start
  return Math.max(1, Math.round((last - first) / (7 * 86400000)) + 1)
}

// plan several weeks in a row, each one counting what the weeks before it booked
// the whole range is cleared first, so plan and the background replan always agree
export function planWeeks(data, settings, now, fromDate, weeks, modes = ['auto', 'suggest']) {
  const zone = settings.timeZone
  const monday = dateKey(weekBounds(fromDate, zone).start, zone)
  const rangeStart = startOfDay(monday, zone)
  const rangeEnd = startOfDay(addDaysToKey(monday, weeks * 7), zone)
  const modeOf = id => data.modules.find(m => m.id === id)?.mode_override || settings.plannerMode
  const planning = data.modules.filter(m => modes.includes(modeOf(m.id))).map(m => m.id)

  // this range's suggestions and future auto blocks get planned again from scratch
  const inRange = b => new Date(b.start) >= rangeStart && new Date(b.start) < rangeEnd
  const cleared = data.blocks.filter(b => planning.includes(b.module_id) && inRange(b) && (
    b.state === 'suggested' || (b.state === 'accepted' && b.auto && new Date(b.start) > now)
  ))
  let blocks = data.blocks.filter(b => !cleared.includes(b))
  const added = []
  let atRisk = []
  let hadWork = false

  for (let i = 0; i < weeks; i++) {
    const weekOf = startOfDay(addDaysToKey(monday, i * 7), zone)
    const result = planWeek({ ...data, blocks }, settings, now, weekOf, modes)
    if (i === 0) atRisk = result.atRisk
    hadWork ||= result.hadWork

    // carry this week's plan into the next one
    blocks = [...blocks.filter(b => !result.remove.includes(b.id)), ...result.blocks]
    added.push(...result.blocks)
  }

  // a block planned again in the same place keeps its id
  const keep = new Set(added.map(b => b.id))
  return {
    blocks: added,
    remove: cleared.map(b => b.id).filter(id => !keep.has(id)),
    atRisk,
    hadWork,
    unchanged: signature(added) === signature(cleared)
  }
}

// hours that could still be booked in a week, keeping to each day's limit
// suggestions count as taken, so this is what's left after the plan on screen
export function bookableHours(data, settings, week, now) {
  const zone = settings.timeZone
  const from = new Date(Math.max(now, week.start))
  const taken = data.blocks
    .filter(b => b.state !== 'missed')
    .map(b => b.state === 'suggested' ? { ...b, state: 'accepted' } : b)
  const slots = cutSlots(getFreeTime(from, week.end, { ...data, blocks: taken, now: from }, settings), settings)

  const used = {}
  for (const b of taken) {
    const key = dateKey(new Date(b.start), zone)
    used[key] = (used[key] || 0) + hoursBetween(new Date(b.start), new Date(b.end))
  }

  const perDay = {}
  for (const slot of slots) {
    perDay[slot.key] ??= { hours: 0, limit: slot.workDay ? settings.workDayMaxHours : dayPlan(settings, weekdayOf(slot.key)).maxHours }
    perDay[slot.key].hours += hoursBetween(slot.start, slot.end)
  }
  return Object.entries(perDay).reduce((sum, [key, day]) => sum + Math.max(0, Math.min(day.hours, day.limit - (used[key] || 0))), 0)
}

// study the modules need each week against the time there is, averaged over the next 4 weeks
export function capacityCheck(data, settings, now) {
  let need = 0
  let free = 0
  for (let i = 0; i < 4; i++) {
    const week = weekBounds(new Date(+now + i * 7 * 86400000), settings.timeZone)
    need += getModuleNeeds(data, settings, week, []).reduce((sum, m) => sum + m.weekly, 0)
    free += bookableHours({ ...data, blocks: [] }, settings, week, week.start)
  }
  need /= 4
  free /= 4
  return { need, free, short: need - free > 0.5 }
}

// each module's week, suggestions included, marked short only once the week has no room left
export function moduleWeekSummary(data, settings, week, now) {
  const counted = data.blocks.map(b => b.state === 'suggested' ? { ...b, state: 'accepted' } : b)
  const full = bookableHours(data, settings, week, now) * 60 < settings.minBlock
  return getModuleNeeds(data, settings, week, counted).map(m => {
    const gap = m.weekly - m.covered
    return { ...m, short: full && gap > 0.5 ? quarters(gap) : 0 }
  })
}

// redo every future auto block in one run, the same way plan does, so an unchanged plan comes out identical
export function replanAuto(data, settings, now) {
  const zone = settings.timeZone
  const isAuto = id => (data.modules.find(m => m.id === id)?.mode_override || settings.plannerMode) === 'auto'
  const future = data.blocks.filter(b => b.auto && b.state === 'accepted' && new Date(b.start) > now && isAuto(b.module_id))

  // from this week to the last week that has auto blocks
  const first = weekBounds(now, zone).start
  const last = Math.max(+first, ...future.map(b => +weekBounds(new Date(b.start), zone).start))
  const weeks = Math.round((last - first) / (7 * 86400000)) + 1
  return planWeeks(data, settings, now, now, weeks, ['auto'])
}
