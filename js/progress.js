import { db, save, saveMany, loadAll, remove, removeModule } from './db.js'
import { settings } from './settings.js'
import { planWeek } from './planner.js'
import { hoursBetween, weekBounds } from './time.js'

// mark done and log the time against its part
export async function markDone(block, hours) {
  await save('blocks', { ...block, state: 'done', done_hours: hours })
  if (!block.task_id) return

  const task = await db.tasks.get(block.task_id)
  if (task && !task.deleted) await save('tasks', { ...task, done_hours: (task.done_hours || 0) + hours })
}

// mark missed and replan the week
export async function markMissed(block) {
  await save('blocks', { ...block, state: 'missed' })
  await replanThisWeek()
}

// new suggestions, accepted blocks stay
export async function replanThisWeek() {
  const result = planWeek(await loadAll(), settings, new Date(), new Date())
  if (result.unchanged) return result
  await remove('blocks', result.remove)
  await saveMany('blocks', result.blocks)
  return result
}

// take clashing blocks out and plan their hours again
export async function moveClashes(blocks) {
  await remove('blocks', blocks.map(b => b.id))
  return replanThisWeek()
}

export function markAttended(tutorial) {
  return save('tutorials', { ...tutorial, attended: true })
}

// add a watch recording task if needed
export async function markMissedTutorial(tutorial, watchRecording) {
  await save('tutorials', { ...tutorial, attended: false })
  if (!watchRecording) return

  await save('tasks', {
    module_id: tutorial.module_id,
    assessment_id: null,
    title: `Watch recording: ${tutorial.title}`,
    est_hours: hoursBetween(new Date(tutorial.start), new Date(tutorial.end)),
    done_hours: 0,
    status: 'todo',
    created: Date.now()
  })
  await replanThisWeek()
}

// plan each week again, earliest first
async function replanWeeks(weekStarts) {
  const now = new Date()
  for (const week of [...new Set(weekStarts)].sort((a, b) => a - b)) {
    const result = planWeek(await loadAll(), settings, now, new Date(week))
    if (result.unchanged) continue
    await remove('blocks', result.remove)
    await saveMany('blocks', result.blocks)
  }
}

const weekOf = date => +weekBounds(new Date(date), settings.timeZone).start

// submitted work frees its upcoming blocks and every week they were in gets planned again
// unticking brings the hours back
export async function markSubmitted(assessment, submitted) {
  await save('assessments', { ...assessment, submitted, submitted_at: submitted ? new Date().toISOString() : null })

  const now = new Date()
  const weeks = [weekOf(now)]
  if (submitted) {
    const upcoming = await db.blocks
      .where('assessment_id').equals(assessment.id)
      .filter(b => !b.deleted && (b.state === 'accepted' || b.state === 'suggested') && new Date(b.start) > now)
      .toArray()
    await remove('blocks', upcoming.map(b => b.id))
    weeks.push(...upcoming.map(b => weekOf(b.start)))
  }
  await replanWeeks(weeks)
}

// extra study for a module until a date, this week and any later planned weeks get the hours
export async function startCatchUp(module, hours, until, label) {
  const now = new Date()
  await save('modules', { ...module, catch_up: { hours, from: now.toISOString(), until, label } })

  const planned = (await loadAll()).blocks
    .filter(b => (b.state === 'suggested' || (b.state === 'accepted' && b.auto)) && new Date(b.start) > now && new Date(b.start) < new Date(until))
  await replanWeeks([weekOf(now), ...planned.map(b => weekOf(b.start))])
}

// deleting a module frees its upcoming time, so those weeks get planned again
export async function deleteModule(module) {
  const now = new Date()
  const upcoming = (await loadAll()).blocks.filter(b => b.module_id === module.id && new Date(b.start) > now)
  await removeModule(module.id)
  await replanWeeks([weekOf(now), ...upcoming.map(b => weekOf(b.start))])
}

export async function stopCatchUp(module) {
  await save('modules', { ...module, catch_up: null })
  await replanWeeks([weekOf(new Date())])
}
