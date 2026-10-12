import { defaultZone, dateKey, clockTime, clockRange } from '../time.js'
import { settings } from '../settings.js'

const { reactive, computed } = Vue

// online tutorials are uk time, face to face use the user's zone
const zoneFor = type => type === 'online' ? defaultZone : settings.timeZone

// stored times to date and time inputs
function timeFields(t) {
  if (!t.start) return {}
  const zone = zoneFor(t.type)
  const start = new Date(t.start)
  return { date: dateKey(start, zone), startTime: clockTime(start, zone), endTime: clockTime(new Date(t.end), zone) }
}

export default {
  props: { tutorial: Object, modules: Array },
  emits: ['save', 'cancel'],
  template: `
    <form class="card form" @submit.prevent="submit">
      <h2>Check details</h2>
      <div class="grid">
        <label>Module
          <select v-model="form.module_id" required>
            <option value="" disabled>Choose a module</option>
            <option v-for="m in modules" :value="m.id">{{ m.code }}</option>
          </select>
        </label>
        <label class="wide">Title <input v-model.trim="form.title" required></label>
        <label>Date <input type="date" v-model="form.date" required></label>
        <label>Start <input type="time" v-model="form.startTime" required></label>
        <label>End <input type="time" v-model="form.endTime" required></label>
        <label>Type
          <select v-model="form.type">
            <option value="online">Online</option>
            <option value="face-to-face">Face to face</option>
          </select>
        </label>
        <label>Recorded
          <select v-model="form.recorded">
            <option :value="true">Yes</option>
            <option :value="false">No, live only</option>
            <option :value="null">Not sure</option>
          </select>
        </label>
        <label class="wide">Tutors <input v-model="form.tutorText" placeholder="Separate names with commas"></label>
      </div>
      <p v-if="unknownCode" class="hint">This booking is for {{ unknownCode }}, which isn't one of your modules yet.</p>
      <p v-if="form.type === 'online'" class="hint">Times are UK time, as shown on the booking page.</p>
      <div class="actions">
        <button class="primary" :disabled="!valid">Save tutorial</button>
        <button type="button" @click="$emit('cancel')">Cancel</button>
      </div>
    </form>`,
  setup(props, { emit }) {
    const t = props.tutorial || {}

    // match the parsed module code to a saved module
    const matched = props.modules.find(m => m.code === t.module)

    const form = reactive({
      id: t.id,
      module_id: t.module_id || matched?.id || (props.modules.length === 1 ? props.modules[0].id : ''),
      title: t.title || '',
      date: t.date || '',
      startTime: t.startTime || '',
      endTime: t.endTime || '',
      type: t.type || 'online',
      recorded: t.recorded ?? null,
      tutorText: (t.tutors || []).join(', '),
      attended: t.attended ?? null,
      ...timeFields(t)
    })

    const unknownCode = computed(() => t.module && !matched ? t.module : '')
    const valid = computed(() => form.module_id && form.title && form.date && form.startTime && form.endTime)

    function submit() {
      if (!valid.value) return
      const { date, startTime, endTime, tutorText, ...tutorial } = form
      const { start, end } = clockRange(date, startTime, endTime, zoneFor(form.type))

      emit('save', {
        ...tutorial,
        start: start.toISOString(),
        end: end.toISOString(),
        tutors: tutorText.split(',').map(name => name.trim()).filter(Boolean)
      })
    }

    return { form, unknownCode, valid, submit }
  }
}
