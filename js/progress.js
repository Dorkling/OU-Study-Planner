import { db, save, loadAll, remove } from './db.js'
import { settings } from './settings.js'
import { planWeek } from './planner.js'
import { hoursBetween } from './time.js'

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
  for (const b of result.blocks) await save('blocks', b)
  return result
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
