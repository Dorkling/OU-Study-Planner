import { db, all, save, remove, removeAssessment, live } from '../db.js'
import { dateAndTime, shortDate } from '../time.js'
import { markSubmitted } from '../progress.js'
import { oneDecimal } from '../estimates.js'
import { settings } from '../settings.js'
import { partEstimates, assessmentHours, defaultHours } from '../planner.js'
import AssessmentForm from '../components/assessment-form.js'

const { ref, computed } = Vue

export default {
  props: { id: String },
  components: { AssessmentForm },
  template: `
    <section v-if="assessment">
      <p><a href="#/modules">Back to modules</a></p>

      <AssessmentForm v-if="editing" class="card" :assessment="assessment" @save="saveAssessment" @cancel="editing = false" />
      <header v-else class="card-head">
        <div>
          <h1>{{ module?.code }} {{ assessment.title }}</h1>
          <p class="hint">{{ assessment.type === 'exam' ? 'On' : 'Due' }} {{ dueText }}<template v-if="assessment.weight">, worth {{ assessment.weight }}%</template></p>
          <p v-if="assessment.submitted" class="hint">{{ assessment.type === 'exam' ? 'Done' : 'Submitted' }} on {{ shortDate(assessment.submitted_at, settings.timeZone) }}, no more time is being planned for it.</p>
        </div>
        <div class="actions">
          <button :class="{ primary: !assessment.submitted }" @click="markSubmitted(assessment, !assessment.submitted)">{{ assessment.submitted ? 'Undo' : assessment.type === 'exam' ? 'Mark exam as done' : 'Mark as submitted' }}</button>
          <button class="link" @click="editing = true">Edit</button>
          <button class="link danger" @click="deleteAssessment">Delete</button>
        </div>
      </header>

      <div v-if="assessment.type === 'exam'" class="card">
        <p class="hint">Exams don't get hours of their own. Once the module's last TMA is in, your weekly study for it is your revision.</p>
      </div>

      <div v-else class="card">
        <h2>Parts</h2>
        <p v-if="!tasks.length" class="hint">Estimated at {{ estHours }} hours from the default in Settings. Split it into parts or questions to make the estimate more exact.</p>
        <p v-else class="hint">Parts with no estimate share what is left of the {{ defaultHours(assessment, settings) }} hour default.</p>

        <div v-for="t in tasks" :key="t.id" class="part" :class="{ done: t.status === 'done' }">
          <input type="checkbox" :checked="t.status === 'done'" @change="toggleDone(t)" :aria-label="'Done: ' + t.title">
          <input class="part-title" v-model.trim="t.title" @change="save('tasks', t)" aria-label="Part">
          <label>Estimate <input type="number" v-model.number="t.est_hours" @change="save('tasks', t)" :placeholder="autoEstimate(t)" min="0" step="0.5"> h</label>
          <label>Done <input type="number" v-model.number="t.done_hours" @change="save('tasks', t)" min="0" step="0.25"> h</label>
          <button class="link danger" @click="remove('tasks', t.id)">Remove</button>
        </div>

        <form class="row" @submit.prevent="addPart">
          <input v-model.trim="newTitle" placeholder="Question 1" aria-label="New part">
          <button :disabled="!newTitle">Add part</button>
        </form>

        <div v-if="tasks.length" class="progress-wrap">
          <div class="progress"><span :style="{ width: percent + '%' }"></span></div>
          <p class="hint">{{ doneHours }} of {{ estHours }} hours logged</p>
        </div>
      </div>
    </section>
    <section v-else-if="loaded">
      <p>That assessment no longer exists. <a href="#/modules">Back to modules</a></p>
    </section>`,
  setup(props) {
    const editing = ref(false)
    const newTitle = ref('')

    const data = live(async () => {
      const assessment = await db.assessments.get(props.id)
      if (!assessment || assessment.deleted) return { assessment: null, tasks: [] }
      const tasks = (await all('tasks')).filter(t => t.assessment_id === props.id)
      return { assessment, module: await db.modules.get(assessment.module_id), tasks }
    }, null)

    const loaded = computed(() => data.value !== null)
    const assessment = computed(() => data.value?.assessment)
    const module = computed(() => data.value?.module)
    const tasks = computed(() => [...(data.value?.tasks || [])].sort((a, b) => a.created - b.created))

    const estHours = computed(() => oneDecimal(assessmentHours(tasks.value, defaultHours(assessment.value, settings))))
    const estimates = computed(() => partEstimates(tasks.value, defaultHours(assessment.value, settings)))
    const autoEstimate = t => oneDecimal(estimates.value.get(t.id))
    const doneHours = computed(() => oneDecimal(tasks.value.reduce((sum, t) => sum + (t.done_hours || 0), 0)))
    const percent = computed(() => estHours.value ? Math.min(100, doneHours.value / estHours.value * 100) : 0)
    const dueText = computed(() => {
      const a = assessment.value
      return (a.provisional ? 'roughly ' : '') + dateAndTime(a.due, settings.timeZone)
    })

    async function saveAssessment(updated) {
      await save('assessments', updated)
      editing.value = false
    }

    async function deleteAssessment() {
      if (!confirm(`Delete ${assessment.value.title} and its parts?`)) return
      await removeAssessment(props.id)
      location.hash = '#/modules'
    }

    function addPart() {
      const a = assessment.value
      save('tasks', { assessment_id: a.id, module_id: a.module_id, title: newTitle.value, est_hours: null, done_hours: 0, status: 'todo', created: Date.now() })
      newTitle.value = ''
    }

    function toggleDone(t) {
      save('tasks', { ...t, status: t.status === 'done' ? 'todo' : 'done' })
    }

    return {
      editing, newTitle, loaded, assessment, module, tasks, estHours, doneHours, percent, dueText, settings, autoEstimate, defaultHours, markSubmitted, shortDate,
      saveAssessment, deleteAssessment, addPart, toggleDone, save, remove
    }
  }
}
