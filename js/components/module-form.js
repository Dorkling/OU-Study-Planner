import { moduleHours, weeklyHours, oneDecimal } from '../estimates.js'
import { settings } from '../settings.js'

const { reactive, computed } = Vue

export default {
  props: { module: Object },
  emits: ['save', 'cancel'],
  template: `
    <form class="card form" @submit.prevent="submit">
      <div class="grid">
        <label>Module code <input v-model.trim="form.code" placeholder="SM380" required></label>
        <label class="wide">Title <input v-model.trim="form.title" placeholder="Optional"></label>
        <label>Credits <input type="number" v-model.number="form.credits" min="1" step="1" required></label>
        <label>Start date <input type="date" v-model="form.start" required></label>
        <label>End date <input type="date" v-model="form.end" :min="form.start" required></label>
        <label>Planner mode
          <select v-model="form.mode_override">
            <option value="">Same as settings</option>
            <option value="auto">Auto</option>
            <option value="suggest">Suggest</option>
            <option value="manual">Manual</option>
          </select>
        </label>
      </div>
      <p v-if="valid" class="hint">About {{ total }} hours of study, roughly {{ weekly }} hours a week.</p>
      <p v-else-if="form.start && form.end && form.end <= form.start" class="hint error">The end date needs to be after the start.</p>
      <div class="actions">
        <button class="primary" :disabled="!valid">Save module</button>
        <button type="button" @click="$emit('cancel')">Cancel</button>
      </div>
    </form>`,
  setup(props, { emit }) {
    const form = reactive({ code: '', title: '', credits: 30, start: '', end: '', mode_override: '', ...props.module })

    const valid = computed(() => form.code && form.credits > 0 && form.start && form.end && form.end > form.start)
    const total = computed(() => moduleHours(form, settings.hoursPerCredit))
    const weekly = computed(() => oneDecimal(weeklyHours(form, settings.hoursPerCredit)))

    function submit() {
      if (!valid.value) return
      emit('save', { ...form, code: form.code.toUpperCase() })
    }

    return { form, valid, total, weekly, submit }
  }
}
