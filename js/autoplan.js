import { save, remove, loadAll } from './db.js'
import { settings } from './settings.js'
import { planWeek } from './planner.js'

let running = false
let changeTimer
let everyQuarterHour

// replan auto modules for this week
export async function autoPlan() {
  if (running) return
  running = true
  try {
    const data = await loadAll()
    const anyAuto = data.modules.some(m => (m.mode_override || settings.plannerMode) === 'auto')
    if (!anyAuto) return

    // skip if nothing changed, saving would trigger another run
    const result = planWeek(data, settings, new Date(), new Date(), ['auto'])
    if (result.unchanged) return
    await remove('blocks', result.remove)
    for (const b of result.blocks) await save('blocks', b)
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
