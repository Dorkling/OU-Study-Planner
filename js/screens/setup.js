import { all, save, removeModule, removeAssessment, live } from '../db.js'
import { settings, saveSetting } from '../settings.js'
import { weeklyHours, oneDecimal } from '../estimates.js'
import { shortDate } from '../time.js'
import ModuleForm from '../components/module-form.js'
import AssessmentForm from '../components/assessment-form.js'
import WorkPattern from '../components/work-pattern.js'

const { ref, computed } = Vue

const typeNames = { tma: 'TMA', ema: 'EMA', exam: 'Exam' }

export default {
  components: { ModuleForm, AssessmentForm, WorkPattern },
  template: `
    <section class="setup">
      <h1>Set up your planner</h1>
      <ol class="steps">
        <li :class="{ current: step === 1 }">Modules</li>
        <li :class="{ current: step === 2 }">Assessments</li>
        <li :class="{ current: step === 3 }">Work pattern</li>
      </ol>

      <template v-if="step === 1">
        <p>Add the modules you're studying. Credits and dates are used to work out your weekly study hours.</p>

        <article v-for="m in modules" :key="m.id" class="card summary">
          <div>
            <strong>{{ m.code }}</strong> {{ m.title }}
            <p class="hint">{{ m.credits }} credits, {{ shortDate(m.start) }} to {{ shortDate(m.end) }}, about {{ weekly(m) }} hours a week</p>
          </div>
          <button class="link danger" @click="removeModule(m.id)">Remove</button>
        </article>

        <ModuleForm v-if="adding || !modules.length" :key="modules.length" @save="addModule" @cancel="adding = false" />
        <button v-else @click="adding = true">Add another module</button>

        <p v-if="modules.length > 1" class="total">Together that is about {{ totalWeekly }} hours of study a week.</p>

        <div class="actions spaced">
          <button class="primary" :disabled="!modules.length" @click="step = 2">Next</button>
          <button class="link" @click="finish">Skip setup</button>
        </div>
      </template>

      <template v-else-if="step === 2">
        <p>Add the TMA dates from each module's assessment page. Exam and EMA dates usually aren't set yet, so put a rough date and tick the box. You can add more later in Modules.</p>

        <article v-for="m in modules" :key="m.id" class="card">
          <h2>{{ m.code }} <span class="title">{{ m.title }}</span></h2>
          <ul v-if="assessmentsFor(m.id).length" class="list">
            <li v-for="a in assessmentsFor(m.id)" :key="a.id">
              <div class="grow">
                {{ a.title }}
                <span class="hint">{{ typeNames[a.type] }}, {{ a.provisional ? 'roughly ' : '' }}{{ shortDate(a.due, settings.timeZone) }}</span>
              </div>
              <button class="link danger" @click="removeAssessment(a.id)">Remove</button>
            </li>
          </ul>
          <AssessmentForm v-if="addingTo === m.id" :key="assessmentsFor(m.id).length" :assessment="nextDraft(m.id)" @save="a => addAssessment(m, a)" @cancel="addingTo = null" />
          <button v-else @click="addingTo = m.id">Add assessment</button>
        </article>

        <p class="hint">Without any TMA dates the planner still books weekly study from credits.</p>
        <div class="actions spaced">
          <button class="primary" @click="step = 3">Next</button>
          <button @click="step = 1">Back</button>
        </div>
      </template>

      <template v-else>
        <p>Add the shifts you work in a normal week. Holidays and swaps go in Settings later.</p>
        <div class="card"><WorkPattern /></div>
        <div class="actions spaced">
          <button class="primary" @click="finish">Finish</button>
          <button @click="step = 2">Back</button>
        </div>
      </template>
    </section>`,
  setup() {
    const step = ref(1)
    const adding = ref(false)
    const addingTo = ref(null)
    const modules = live(() => all('modules'))
    const assessments = live(async () => (await all('assessments')).sort((a, b) => a.due.localeCompare(b.due)))

    const weekly = m => oneDecimal(weeklyHours(m, settings.hoursPerCredit))
    const totalWeekly = computed(() => oneDecimal(modules.value.reduce((sum, m) => sum + weeklyHours(m, settings.hoursPerCredit), 0)))
    const assessmentsFor = id => assessments.value.filter(a => a.module_id === id)

    // suggest the next tma number
    function nextDraft(moduleId) {
      const tmas = assessmentsFor(moduleId).filter(a => a.type === 'tma').length
      return { type: 'tma', title: `TMA ${String(tmas + 1).padStart(2, '0')}` }
    }

    async function addModule(module) {
      await save('modules', module)
      adding.value = false
    }

    // form stays open for the next one
    async function addAssessment(module, assessment) {
      await save('assessments', { ...assessment, module_id: module.id })
    }

    async function finish() {
      await saveSetting('setupDone', true)
      location.hash = '#/week'
    }

    return {
      step, adding, addingTo, modules, settings, typeNames, weekly, totalWeekly, assessmentsFor,
      nextDraft, addModule, addAssessment, finish, removeModule, removeAssessment, shortDate
    }
  }
}
