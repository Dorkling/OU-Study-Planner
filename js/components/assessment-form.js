import { dateKey, clockTime, zonedTime } from '../time.js'
import { settings } from '../settings.js'

const { reactive, computed } = Vue

// due time to date and time inputs
function dueFields(due) {
  if (!due) return { dueDate: '', dueTime: '12:00' }
  const date = new Date(due)
  return { dueDate: dateKey(date, settings.timeZone), dueTime: clockTime(date, settings.timeZone) }
}

export default {
  props: { assessment: Object },
  emits: ['save', 'cancel'],
  template: `
    <form class="form" @submit.prevent="submit">
      <div class="grid">
        <label>Type
          <select v-model="form.type">
            <option value="tma">TMA</option>
            <option value="ema">EMA</option>
            <option value="exam">Exam</option>
          </select>
        </label>
        <label class="wide">Title <input v-model.trim="form.title" :placeholder="placeholder" required></label>
        <label>{{ form.type === 'exam' ? 'Exam date' : 'Due date' }} <input type="date" v-model="form.dueDate" required></label>
        <label>{{ form.type === 'exam' ? 'Start time' : 'Due time' }} <input type="time" v-model="form.dueTime" required></label>
        <label>Weighting % <input type="number" v-model.number="form.weight" min="0" max="100" placeholder="Optional"></label>
      </div>
      <label class="check"><input type="checkbox" v-model="form.provisional"> Rough date, not confirmed yet</label>
      <p v-if="form.provisional" class="hint">Planned from this date until you update it.</p>
      <div class="actions">
        <button class="primary" :disabled="!valid">Save assessment</button>
        <button type="button" @click="$emit('cancel')">Cancel</button>
      </div>
    </form>`,
  setup(props, { emit }) {
    const { due, ...rest } = props.assessment || {}
    const form = reactive({ type: 'tma', title: '', weight: null, provisional: false, ...rest, ...dueFields(due) })

    const placeholder = computed(() => ({ tma: 'TMA 01', ema: 'EMA', exam: 'Exam' })[form.type])
    const valid = computed(() => form.title && form.dueDate && form.dueTime)

    // save due as one time
    function submit() {
      if (!valid.value) return
      const { dueDate, dueTime, ...assessment } = form
      emit('save', { ...assessment, due: zonedTime(dueDate, dueTime, settings.timeZone).toISOString() })
    }

    return { form, placeholder, valid, submit }
  }
}
