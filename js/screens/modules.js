import { all, save, remove, live } from '../db.js'
import { weeklyHours, oneDecimal } from '../estimates.js'
import { settings } from '../settings.js'
import { shortDate, dateAndTime } from '../time.js'
import { packModule, unpackModule, mergeModule } from '../share.js'
import { downloadFile } from '../backup.js'
import { markSubmitted, startCatchUp, stopCatchUp, deleteModule as deleteModuleAndReplan } from '../progress.js'
import ModuleForm from '../components/module-form.js'
import AssessmentForm from '../components/assessment-form.js'

const { ref } = Vue

const typeNames = { tma: 'TMA', ema: 'EMA', exam: 'Exam' }

export default {
  components: { ModuleForm, AssessmentForm },
  template: `
    <section>
      <h1>Modules</h1>
      <p v-if="!modules.length && !editing" class="hint">No modules yet.</p>
      <p v-if="message" class="notice">{{ message }}</p>

      <template v-for="m in modules" :key="m.id">
        <ModuleForm v-if="editing === m.id" :module="m" @save="saveModule" @cancel="editing = null" />

        <article v-else class="card">
          <header class="card-head">
            <div>
              <h2>{{ m.code }} <span class="title">{{ m.title }}</span></h2>
              <p class="hint">{{ m.credits }} credits, {{ shortDate(m.start) }} to {{ shortDate(m.end) }}, about {{ weekly(m) }} hours a week</p>
              <p v-if="catchingUpNow(m)" class="hint catch-up">Catching up: {{ m.catch_up.hours }} extra hours a week until {{ m.catch_up.label }}. <button class="link" @click="stopCatchUp(m)">Stop</button></p>
            </div>
            <div class="actions">
              <button v-if="!catchingUpNow(m)" class="link" @click="openCatchUp(m)">Catch up</button>
              <button class="link" @click="editing = m.id">Edit</button>
              <button class="link" @click="share(m)">Share dates</button>
              <button class="link danger" @click="deleteModule(m)">Delete</button>
            </div>
          </header>

          <div v-if="catchForm?.module === m.id" class="panel-inline">
            <p>Behind with {{ m.code }}? This books extra study for it each week until the date you pick.</p>
            <div class="row">
              <label>Extra hours a week <input type="number" v-model.number="catchForm.hours" min="0.5" max="20" step="0.5"></label>
              <label>Until
                <select v-model="catchForm.until">
                  <option v-for="o in untilOptions(m)" :value="o.value">{{ o.label }}</option>
                </select>
              </label>
            </div>
            <div class="actions">
              <button class="primary" :disabled="!(catchForm.hours > 0)" @click="confirmCatchUp(m)">Start catching up</button>
              <button class="link" @click="catchForm = null">Cancel</button>
            </div>
          </div>

          <ul v-if="assessmentsFor(m.id).length" class="list">
            <li v-for="a in assessmentsFor(m.id)" :key="a.id">
              <a :href="'#/assessment/' + a.id">{{ a.title }}</a>
              <span class="hint">{{ typeNames[a.type] }}, {{ a.type === 'exam' ? 'on' : 'due' }} {{ dueText(a) }}<template v-if="a.weight">, {{ a.weight }}%</template></span>
              <label class="check submitted"><input type="checkbox" :checked="a.submitted" @change="markSubmitted(a, $event.target.checked)"> {{ a.type === 'exam' ? 'Done' : 'Submitted' }}</label>
            </li>
          </ul>

          <div v-if="todosFor(m.id).length" class="todos">
            <h3>To do</h3>
            <div v-for="t in todosFor(m.id)" :key="t.id" class="part">
              <input type="checkbox" @change="save('tasks', { ...t, status: 'done' })" :aria-label="'Done: ' + t.title">
              <span class="grow">{{ t.title }}</span>
              <span class="hint">{{ oneDecimal(t.est_hours) }} h</span>
              <button class="link danger" @click="remove('tasks', t.id)">Remove</button>
            </div>
          </div>

          <AssessmentForm v-if="addingTo === m.id" @save="a => addAssessment(m, a)" @cancel="addingTo = null" />
          <button v-else @click="addingTo = m.id">Add assessment</button>
        </article>
      </template>

      <ModuleForm v-if="editing === 'new'" @save="saveModule" @cancel="editing = null" />
      <div v-else class="actions">
        <button class="primary" @click="editing = 'new'">Add module</button>
      </div>

      <div class="card spaced-top">
        <h2>Import a classmate's module</h2>
        <p class="hint">Adds any assessments you don't have and updates changed dates. Confirmed dates are never replaced by rough ones.</p>
        <label class="stack">Module file <input type="file" accept=".json,application/json" @change="importModule($event.target)"></label>
        <p v-if="importError" class="hint error">{{ importError }}</p>
      </div>
    </section>`,
  setup() {
    const editing = ref(null)
    const addingTo = ref(null)
    const message = ref('')
    const importError = ref('')

    const modules = live(async () => (await all('modules')).sort((a, b) => a.start.localeCompare(b.start)))
    const assessments = live(async () => (await all('assessments')).sort((a, b) => a.due.localeCompare(b.due)))
    const tasks = live(() => all('tasks'))

    const assessmentsFor = id => assessments.value.filter(a => a.module_id === id)
    const todosFor = id => tasks.value.filter(t => t.module_id === id && !t.assessment_id && t.status !== 'done')
    const weekly = m => oneDecimal(weeklyHours(m, settings.hoursPerCredit))
    const dueText = a => (a.provisional ? 'roughly ' : '') + dateAndTime(a.due, settings.timeZone)

    // the next upcoming piece of work comes first, then a plain 4 weeks
    function untilOptions(m) {
      const now = new Date()
      const upcoming = assessmentsFor(m.id)
        .filter(a => !a.submitted && new Date(a.due) > now)
        .map(a => ({ value: a.due, label: `${a.title} (${shortDate(a.due, settings.timeZone)})`, keep: `${a.title} (${shortDate(a.due, settings.timeZone)})` }))
      const fourWeeks = new Date(+now + 28 * 86400000).toISOString()
      return [...upcoming, { value: fourWeeks, label: `4 weeks from now (${shortDate(fourWeeks, settings.timeZone)})`, keep: shortDate(fourWeeks, settings.timeZone) }]
    }

    const catchForm = ref(null)
    const catchingUpNow = m => m.catch_up && new Date(m.catch_up.until) > new Date()

    function openCatchUp(m) {
      catchForm.value = { module: m.id, hours: 2, until: untilOptions(m)[0].value }
    }

    async function confirmCatchUp(m) {
      const choice = untilOptions(m).find(o => o.value === catchForm.value.until)
      const label = choice.keep
      const hours = catchForm.value.hours
      await startCatchUp(m, hours, choice.value, label)
      catchForm.value = null
      message.value = `Catching up on ${m.code}: ${hours} extra hours a week until ${label}. This week has been planned again with them.`
    }

    async function saveModule(module) {
      await save('modules', module)
      editing.value = null
    }

    async function deleteModule(m) {
      if (!confirm(`Delete ${m.code} and all of its assessments?`)) return
      await deleteModuleAndReplan(m)
    }

    async function addAssessment(module, assessment) {
      await save('assessments', { ...assessment, module_id: module.id })
      addingTo.value = null
    }

    function share(m) {
      downloadFile(`${m.code}-dates.json`, packModule(m, assessmentsFor(m.id)), 'application/json')
      message.value = `Saved ${m.code}-dates.json. Send it to a classmate to import.`
    }

    async function importModule(input) {
      const file = input.files[0]
      if (!file) return
      importError.value = ''
      try {
        const result = mergeModule(unpackModule(await file.text()), modules.value, assessments.value)
        const module = await save('modules', result.module)
        for (const a of result.assessments) await save('assessments', { ...a, module_id: module.id })

        const changes = `${result.added} new, ${result.updated} updated`
        const count = `${result.added} ${result.added === 1 ? 'assessment' : 'assessments'}`
        message.value = result.isNew ? `Added ${module.code} with ${count}.` : `Updated ${module.code}: ${changes}.`
      } catch (error) {
        importError.value = error.message
      }
      input.value = ''
    }

    return {
      editing, addingTo, message, importError, modules, assessmentsFor, todosFor, weekly, dueText, typeNames,
      shortDate, oneDecimal, save, remove, markSubmitted, catchForm, catchingUpNow, untilOptions, openCatchUp, confirmCatchUp, stopCatchUp, saveModule, deleteModule, addAssessment, share, importModule
    }
  }
}
