import { live, loadAll, save } from '../db.js'
import { settings } from '../settings.js'
import { getNeeds, moduleWeekSummary, checkRisks, findClashes } from '../planner.js'
import CapacityNote from '../components/capacity-note.js'
import { shortDate, clockTime, dateKey, weekBounds, hoursBetween } from '../time.js'
import { oneDecimal } from '../estimates.js'
import { markDone, markMissed, markAttended, markMissedTutorial, moveClashes, markSubmitted } from '../progress.js'

const { ref, computed } = Vue

const day = 86400000

export default {
  components: { CapacityNote },
  template: `
    <section v-if="data">
      <h1>Today</h1>

      <CapacityNote />

      <div v-if="clashes.length" class="notice warn">
        <p>{{ clashes.length }} study {{ clashes.length === 1 ? 'block clashes' : 'blocks clash' }} with your work, blocked time or study hours. <a href="#/week">See the week</a></p>
        <div class="actions"><button @click="moveAll">Move {{ clashes.length === 1 ? 'it' : 'them' }}</button></div>
      </div>

      <div v-if="risks.length" class="notice warn">
        <p v-for="r in risks">{{ label(r.assessment.module_id, r.assessment.id) }} is at risk: about {{ r.hours }} h won't fit before {{ dayText(r.target) }}.</p>
      </div>

      <div v-if="checkIns.length || tutorialCheckIns.length" class="card">
        <h2>How did it go?</h2>
        <div v-for="b in checkIns" :key="b.id" class="check-in">
          <div class="grow">
            <strong>{{ label(b.module_id, b.assessment_id) }}</strong>
            <p class="hint">{{ whenText(b) }}</p>
          </div>
          <label>Spent <input type="number" v-model.number="spent[b.id]" :placeholder="blockLength(b)" min="0" step="0.25" :aria-label="'Hours spent on ' + label(b.module_id, b.assessment_id)"> h</label>
          <button class="primary" @click="done(b)">Done</button>
          <button @click="missed(b)">Missed</button>
        </div>
        <div v-for="t in tutorialCheckIns" :key="t.id" class="check-in">
          <div class="grow">
            <strong>{{ code(t.module_id) }} tutorial</strong> {{ t.title }}
            <p class="hint">{{ whenText(t) }}</p>
          </div>
          <button class="primary" @click="markAttended(t)">Went</button>
          <button v-if="t.recorded !== false" @click="markMissedTutorial(t, true)">Missed, I'll watch the recording</button>
          <button @click="markMissedTutorial(t, false)">Missed</button>
        </div>
        <p v-if="replanned" class="hint">This week has been replanned.</p>
      </div>

      <div class="card">
        <h2>Coming up</h2>
        <p v-if="!upcoming.length" class="hint">Nothing booked for today or tomorrow. <a href="#/week">Plan your week</a></p>
        <ul class="list">
          <li v-for="item in upcoming" :key="item.id">
            <div class="grow">
              <strong>{{ item.title }}</strong>
              <p class="hint">{{ item.when }}</p>
            </div>
          </li>
        </ul>
      </div>

      <div class="card">
        <h2>Due in the next two weeks</h2>
        <p v-if="!dueSoon.length" class="hint">Nothing due.</p>
        <ul class="list">
          <li v-for="n in dueSoon" :key="n.assessment.id">
            <div class="grow">
              <strong>{{ label(n.assessment.module_id, n.assessment.id) }}</strong>
              <p class="hint">
                {{ n.assessment.type === 'exam' ? 'On' : 'Due' }} {{ dayText(n.assessment.due) }},
                {{ oneDecimal(n.done) }} of {{ oneDecimal(n.total) }} h done<template v-if="atRisk(n)">, at risk</template><template v-else>, on track</template>
              </p>
            </div>
            <div class="actions">
              <button class="link" @click="markSubmitted(n.assessment, true)">{{ n.assessment.type === 'exam' ? 'Done' : 'Submitted' }}</button>
              <a :href="'#/assessment/' + n.assessment.id">Parts</a>
            </div>
          </li>
        </ul>
      </div>

      <div v-if="todos.length" class="card">
        <h2>To do</h2>
        <div v-for="t in todos" :key="t.id" class="part">
          <input type="checkbox" @change="finishTodo(t)" :aria-label="'Done: ' + t.title">
          <span class="grow">{{ code(t.module_id) }} {{ t.title }}</span>
          <span class="hint">{{ oneDecimal(t.est_hours) }} h</span>
        </div>
      </div>

      <div v-if="moduleWeek.length" class="card">
        <h2>Module study this week</h2>
        <ul class="list">
          <li v-for="m in moduleWeek" :key="m.module_id">
            <div class="grow">
              <strong>{{ code(m.module_id) }}</strong>
              <div class="progress"><span :style="{ width: Math.min(100, m.covered / m.weekly * 100) + '%' }"></span></div>
              <p class="hint">{{ oneDecimal(m.covered) }} of about {{ oneDecimal(m.weekly) }} h booked or suggested<template v-if="m.catchUp"> (with {{ m.catchUp }} h catch up)</template></p>
              <p v-if="m.short" class="hint error">{{ oneDecimal(m.short) }} h short, with no free time left this week</p>
            </div>
          </li>
        </ul>
      </div>
    </section>`,
  setup() {
    const data = live(loadAll, null)
    const spent = ref({})
    const replanned = ref(false)
    const zone = () => settings.timeZone

    const code = id => data.value.modules.find(m => m.id === id)?.code || ''
    function label(moduleId, assessmentId) {
      if (!assessmentId) return `${code(moduleId)} study`
      return `${code(moduleId)} ${data.value.assessments.find(a => a.id === assessmentId)?.title || ''}`
    }

    const dayText = date => shortDate(date, zone())
    const whenText = item => `${shortDate(item.start, zone())}, ${clockTime(new Date(item.start), zone())} to ${clockTime(new Date(item.end), zone())}`

    // finished in the last 2 weeks
    const recent = item => new Date(item.end) < new Date() && new Date(item.end) > new Date(Date.now() - 14 * day)
    const checkIns = computed(() => data.value.blocks
      .filter(b => b.state === 'accepted' && recent(b))
      .sort((a, b) => a.start.localeCompare(b.start)))
    const tutorialCheckIns = computed(() => data.value.tutorials.filter(t => t.attended == null && recent(t)))

    // use the block length if left blank
    const blockLength = b => hoursBetween(new Date(b.start), new Date(b.end))
    function hoursFor(b) {
      const typed = spent.value[b.id]
      return typeof typed === 'number' ? typed : blockLength(b)
    }

    async function done(b) {
      await markDone(b, hoursFor(b))
    }

    async function missed(b) {
      await markMissed(b)
      replanned.value = true
    }

    // today and tomorrow in the user's zone
    const upcoming = computed(() => {
      const now = new Date()
      const keys = [dateKey(now, zone()), dateKey(new Date(+now + day), zone())]
      const soon = item => new Date(item.end) > now && keys.includes(dateKey(new Date(item.start), zone()))
      return [
        ...data.value.blocks.filter(b => b.state === 'accepted' && soon(b)).map(b => ({ id: b.id, start: b.start, title: label(b.module_id, b.assessment_id), when: whenText(b) })),
        ...data.value.tutorials.filter(soon).map(t => ({ id: t.id, start: t.start, title: `${code(t.module_id)} tutorial: ${t.title}`, when: whenText(t) }))
      ].sort((a, b) => a.start.localeCompare(b.start))
    })

    const risks = computed(() => checkRisks(data.value, settings, new Date()))

    // suggestions tidy themselves, accepted blocks need a nudge
    const clashes = computed(() => findClashes(data.value, settings, new Date()).filter(c => c.block.state === 'accepted'))
    const moveAll = () => moveClashes(clashes.value.map(c => c.block))
    const atRisk = n => risks.value.some(r => r.assessment.id === n.assessment.id)

    const dueSoon = computed(() => getNeeds(data.value, settings, new Date())
      .filter(n => new Date(n.assessment.due) < new Date(Date.now() + 14 * day))
      .sort((a, b) => a.assessment.due.localeCompare(b.assessment.due)))

    const todos = computed(() => data.value.tasks.filter(t => !t.assessment_id && t.status !== 'done'))
    const finishTodo = t => save('tasks', { ...t, status: 'done' })

    const moduleWeek = computed(() => settings.trackOptional
      ? moduleWeekSummary(data.value, settings, weekBounds(new Date(), zone()), new Date())
      : [])

    return {
      data, spent, replanned, risks, clashes, moveAll, checkIns, tutorialCheckIns, upcoming, dueSoon, todos, moduleWeek,
      code, label, dayText, whenText, oneDecimal, blockLength, atRisk, done, missed, finishTodo, markAttended, markMissedTutorial, markSubmitted
    }
  }
}
