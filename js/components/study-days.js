import { settings, setDay } from '../settings.js'
import { dayNames, weekOrder } from '../time.js'
import { dayPlan } from '../freetime.js'

const { computed } = Vue

// the days and hours study can go in, used in settings and setup
export default {
  template: `
    <div class="days">
      <div class="day-row day-head" aria-hidden="true">
        <span>Day</span><span>From</span><span>To</span><span>Max hours</span><span>Use</span>
      </div>
      <div v-for="d in dayRows" :key="d.weekday" class="day-row" :class="{ off: !d.study }">
        <label class="check"><input type="checkbox" :checked="d.study" @change="setDay(d.weekday, 'study', $event.target.checked)"> {{ dayNames[d.weekday] }}</label>
        <input type="time" :value="d.start" :disabled="!d.study" @change="setDay(d.weekday, 'start', $event.target.value)" :aria-label="dayNames[d.weekday] + ' from'">
        <input type="time" :value="d.end" :disabled="!d.study" @change="setDay(d.weekday, 'end', $event.target.value)" :aria-label="dayNames[d.weekday] + ' to'">
        <input type="number" :value="d.maxHours" :disabled="!d.study" min="0.5" step="0.5" @change="setDay(d.weekday, 'maxHours', Number($event.target.value))" :aria-label="dayNames[d.weekday] + ' max hours'">
        <select :value="d.use" :disabled="!d.study" @change="setDay(d.weekday, 'use', $event.target.value)" :aria-label="dayNames[d.weekday] + ' use'">
          <option value="preferred">Preferred</option>
          <option value="normal">Normal</option>
          <option value="backup">Only if needed</option>
        </select>
      </div>
    </div>`,
  setup() {
    const dayRows = computed(() => weekOrder.map(weekday => ({ weekday, ...dayPlan(settings, weekday) })))
    return { dayRows, dayNames, setDay }
  }
}
