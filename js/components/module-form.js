import { moduleHours, suggestedWeekly, oneDecimal } from '../estimates.js'
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
        <label>Study hours a week <input type="number" v-model.number="form.weekly_hours" :placeholder="suggested || ''" min="0.5" step="0.5"></label>
        <label>Planner mode
          <select v-model="form.mode_override">
            <option value="">Same as settings</option>
            <option value="auto">Auto</option>
            <option value="suggest">Suggest</option>
            <option value="manual">Manual</option>
          </select>
        </label>
      </div>
      <p v-if="valid && ownHours" class="hint">You've set {{ form.weekly_hours }} hours a week. The OU guide works out at about {{ suggested }} ({{ total }} hours in total).</p>
      <p v-else-if="valid" class="hint">About {{ total }} hours of study, so roughly {{ suggested }} hours a week. Change it above if you want more or less.</p>
      <p v-else-if="form.start && form.end && form.end <= form.start" class="hint error">The end date needs to be after the start.</p>
      <div class="actions">
        <button class="primary" :disabled="!valid">Save module</button>
        <button type="button" @click="$emit('cancel')">Cancel</button>
      </div>
    </form>`,
  setup(props, { emit }) {
    const form = reactive({ code: '', title: '', credits: 30, start: '', end: '', weekly_hours: null, mode_override: '', ...props.module })

    const valid = computed(() => form.code && form.credits > 0 && form.start && form.end && form.end > form.start)
    const total = computed(() => moduleHours(form, settings.hoursPerCredit))
    const suggested = computed(() => valid.value ? oneDecimal(suggestedWeekly(form, settings.hoursPerCredit)) : null)
    const ownHours = computed(() => form.weekly_hours > 0)

    // a blank box keeps following the suggestion if credits or dates change
    function submit() {
      if (!valid.value) return
      emit('save', { ...form, code: form.code.toUpperCase(), weekly_hours: ownHours.value ? form.weekly_hours : null })
    }

    return { form, valid, total, suggested, ownHours, submit }
  }
}
