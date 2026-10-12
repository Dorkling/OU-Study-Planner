import { saveMany, remove, loadAll } from './db.js'
import { settings } from './settings.js'
import { planWeek, findClashes } from './planner.js'
import { weekBounds } from './time.js'

let running = false
let changeTimer
let everyQuarterHour

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
export async function autoPlan() {
  if (running) return
  running = true
  try {
    const now = new Date()
    let data = await loadAll()

    // suggestions that clash are out of date, clear them and suggest again for their week
    const stale = findClashes(data, settings, now).filter(c => c.block.state === 'suggested').map(c => c.block)
    if (stale.length) {
      await remove('blocks', stale.map(b => b.id))
      for (const week of weeksOf(stale)) await replan(week, ['suggest'])
      data = await loadAll()
    }

    // keep auto modules planned for this week and any later week that already has auto blocks
    const isAuto = id => (data.modules.find(m => m.id === id)?.mode_override || settings.plannerMode) === 'auto'
    if (!data.modules.some(m => isAuto(m.id))) return
    const autoBlocks = data.blocks.filter(b => b.auto && b.state === 'accepted' && new Date(b.start) > now && isAuto(b.module_id))
    for (const week of weeksOf([{ start: now }, ...autoBlocks])) await replan(week, ['auto'])
  } finally {
    running = false
  }
}

export function startAutoPlan() {
  clearInterval(everyQuarterHour)
  autoPlan()
  everyQuarterHour = setInterval(autoPlan, 15 * 60000)
}

Dexie.on('storagemutated', () => {
  clearTimeout(changeTimer)
  changeTimer = setTimeout(autoPlan, 3000)
})
