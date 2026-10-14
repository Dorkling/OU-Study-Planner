import { saveMany, remove, loadAll } from './db.js'
import { settings } from './settings.js'
import { planWeek, replanAuto, findClashes } from './planner.js'
import { weekBounds } from './time.js'

let running = false
let changeTimer

// start of the week each block is in, earliest first, no repeats
function weeksOf(blocks) {
  const starts = blocks.map(b => +weekBounds(new Date(b.start), settings.timeZone).start)
  return [...new Set(starts)].sort((a, b) => a - b).map(start => new Date(start))
}

// replan one week, skip saving if nothing changed as that would trigger another run
async function replan(weekOf, modes) {
  const result = planWeek(await loadAll(), settings, new Date(), weekOf, modes)
  if (result.unchanged) return
  await remove('blocks', result.remove)
  await saveMany('blocks', result.blocks)
}

// keep the plan in line with shifts, study hours and anything else that changes
export async function autoPlan(changed = true) {
  if (running) return
  running = true
  try {
    const now = new Date()
    let data = await loadAll()

    // blocks left behind by a deleted module or assessment
    const orphans = data.blocks.filter(b =>
      !data.modules.some(m => m.id === b.module_id) ||
      (b.assessment_id && !data.assessments.some(a => a.id === b.assessment_id))
    )
    if (orphans.length) {
      await remove('blocks', orphans.map(b => b.id))
      data = await loadAll()
    }

    // suggestions that clash or no longer fit the block length settings are out of date
    const minutes = b => (new Date(b.end) - new Date(b.start)) / 60000
    const wrongLength = data.blocks.filter(b => b.state === 'suggested' && new Date(b.start) > now && (minutes(b) < settings.minBlock || minutes(b) > settings.maxBlock))
    const clashing = findClashes(data, settings, now).filter(c => c.block.state === 'suggested').map(c => c.block)
    const stale = [...new Set([...clashing, ...wrongLength])]
    if (stale.length) {
      await remove('blocks', stale.map(b => b.id))
      for (const week of weeksOf(stale)) await replan(week, ['suggest'])
      data = await loadAll()
    }

    // keep auto modules planned from this week to the last week that has auto blocks, in one run
    const isAuto = id => (data.modules.find(m => m.id === id)?.mode_override || settings.plannerMode) === 'auto'
    if (!data.modules.some(m => isAuto(m.id))) return

    // on opening nothing has changed but the time, so a plan that still fits is left where it is
    const week = weekBounds(now, settings.timeZone)
    const planned = data.blocks.some(b => b.auto && b.state === 'accepted' && new Date(b.start) > now && new Date(b.start) < week.end)
    const broken = findClashes(data, settings, now).some(c => c.block.auto)
    if (!changed && planned && !broken) return

    const result = replanAuto(data, settings, now)
    if (result.unchanged) return
    await remove('blocks', result.remove)
    await saveMany('blocks', result.blocks)
  } finally {
    running = false
  }
}

// replan whenever something changes, not on a timer, so the plan doesn't move just because time passed
export function startAutoPlan() {
  autoPlan(false)
}

Dexie.on('storagemutated', () => {
  clearTimeout(changeTimer)
  changeTimer = setTimeout(() => autoPlan(), 3000)
})
