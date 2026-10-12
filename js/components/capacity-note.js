import { live, loadAll } from '../db.js'
import { settings } from '../settings.js'
import { capacityCheck } from '../planner.js'

const { computed } = Vue

export default {
  props: { showOk: Boolean },
  template: `
    <div v-if="check?.short" class="notice warn">
      <p>Your modules need about {{ round(check.need) }} hours of study a week, but your shifts and study times only leave about {{ round(check.free) }}. The planner books what fits and shares it fairly between modules, but the rest won't get booked.</p>
      <p>To close the gap you could study on work days or add more study days and hours in <a href="#/settings">Settings</a>, lower a module's weekly hours in <a href="#/modules">Modules</a>, or take fewer credits at once.</p>
    </div>
    <p v-else-if="check && showOk" class="hint">That leaves about {{ round(check.free) }} hours a week for study, and your modules need about {{ round(check.need) }}.</p>`,
  setup() {
    const data = live(loadAll, null)
    const check = computed(() => data.value?.modules.length ? capacityCheck(data.value, settings, new Date()) : null)
    return { check, round: Math.round }
  }
}
