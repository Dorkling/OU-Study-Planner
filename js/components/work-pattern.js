import { all, save, remove, live } from '../db.js'
import { dayNames, weekOrder } from '../time.js'

// monday first, then by start time
function byDayThenStart(a, b) {
  return weekOrder.indexOf(a.weekday) - weekOrder.indexOf(b.weekday) || a.start.localeCompare(b.start)
}

export default {
  template: `
    <div>
      <p v-if="!shifts.length" class="hint">No shifts yet.</p>
      <div v-for="s in shifts" :key="s.id" class="row">
        <select v-model.number="s.weekday" @change="update(s)" aria-label="Day">
          <option v-for="d in weekOrder" :value="d">{{ dayNames[d] }}</option>
        </select>
        <input type="time" v-model="s.start" @change="update(s)" aria-label="Start">
        <span>to</span>
        <input type="time" v-model="s.end" @change="update(s)" aria-label="End">
        <button type="button" class="link danger" @click="remove('work_pattern', s.id)">Remove</button>
      </div>
      <div class="actions">
        <button type="button" @click="add">Add shift</button>
      </div>
      <p class="hint">A finish time before the start counts as a night shift running past midnight.</p>
    </div>`,
  setup() {
    const shifts = live(async () => (await all('work_pattern')).sort(byDayThenStart))

    // don't save while a time is half typed
    function update(s) {
      if (s.start && s.end) save('work_pattern', s)
    }

    // copy the last shift to the next day
    function add() {
      const last = shifts.value.at(-1)
      const next = last
        ? { weekday: (last.weekday + 1) % 7, start: last.start, end: last.end }
        : { weekday: 1, start: '09:00', end: '17:00' }
      save('work_pattern', next)
    }

    return { shifts, dayNames, weekOrder, update, add, remove }
  }
}
