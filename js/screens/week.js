import { save, remove, live, loadAll } from '../db.js'
import { settings } from '../settings.js'
import { getShifts, getBlocked, getFreeTime } from '../freetime.js'
import { getNeeds, getModuleNeeds, planWeek, checkRisks } from '../planner.js'
import { dateKey, clockTime, shortDate, weekBounds, toWall, fromWall } from '../time.js'
import { oneDecimal } from '../estimates.js'
import { calendarEvents, buildCalendar } from '../ics.js'
import { downloadFile } from '../backup.js'

const { ref, computed, watch, onMounted, onUnmounted } = Vue

// uk dates and monday start
const enGb = { code: 'en-gb', week: { dow: 1, doy: 4 }, buttonText: { today: 'Today', week: 'Week', day: 'Day' } }
const clock = { hour: '2-digit', minute: '2-digit', hour12: false }

// start the grid early enough for every shift
function gridStart(pattern, exceptions) {
  const shifts = [...pattern, ...exceptions.filter(e => e.type === 'shift')]
  const times = [settings.studyWindow.start, '07:00', ...shifts.map(s => s.end <= s.start ? '00:00' : s.start)]
  return times.sort()[0].slice(0, 2) + ':00'
}

export default {
  template: `
    <section>
      <div class="page-head">
        <h1>Week</h1>
        <div class="actions">
          <button @click="exportCalendar">Add to calendar</button>
          <button v-if="suggestedCount" @click="acceptAll">Accept all</button>
          <button v-if="canPlan" class="primary" @click="plan">Plan my week</button>
        </div>
      </div>

      <div v-if="message || atRisk.length" class="notice" :class="{ warn: atRisk.length }">
        <p v-if="message">{{ message }}</p>
        <p v-for="r in atRisk">{{ label(r.assessment.module_id, r.assessment.id) }} is at risk: {{ r.hours }} h won't fit before {{ dayText(r.target) }}.</p>
      </div>

      <div v-if="selected" class="card panel">
        <p><strong>{{ label(selected.module_id, selected.assessment_id) }}</strong><template v-if="partTitle(selected.task_id)">, {{ partTitle(selected.task_id) }}</template></p>
        <p class="hint">{{ whenText(selected.start, selected.end) }}<template v-if="selected.state === 'suggested'">, suggested</template></p>
        <div class="actions">
          <button v-if="selected.state === 'suggested'" class="primary" @click="accept(selected)">Accept</button>
          <button @click="dismiss(selected)">{{ selected.state === 'suggested' ? 'Dismiss' : 'Remove' }}</button>
          <button class="link" @click="selected = null">Close</button>
        </div>
      </div>

      <div v-if="picked" class="card panel">
        <p>New study block, {{ whenText(picked.start, picked.end) }}</p>
        <div class="row">
          <select v-model="pickedFor" aria-label="What to work on">
            <option value="" disabled>Choose what to work on</option>
            <option v-for="n in needs" :value="'a:' + n.assessment.id">{{ label(n.assessment.module_id, n.assessment.id) }}</option>
            <option v-for="m in modules" :value="'m:' + m.id">{{ m.code }} study</option>
          </select>
          <button class="primary" :disabled="!pickedFor" @click="addBlock">Add block</button>
          <button class="link" @click="clearPick">Cancel</button>
        </div>
      </div>

      <div class="key">
        <span><i class="swatch ev-work"></i>Work</span>
        <span><i class="swatch ev-blocked"></i>Blocked</span>
        <span><i class="swatch ev-tutorial"></i>Tutorial</span>
        <span><i class="swatch ev-study"></i>Study</span>
        <span><i class="swatch ev-suggested"></i>Suggested</span>
        <span><i class="swatch ev-free"></i>Free</span>
        <span><i class="swatch ev-due"></i>Deadline</span>
      </div>
      <p class="hint">Drag over free time to add a block. Click a block to accept or remove it, drag to move it.</p>
      <div ref="el" class="calendar card"></div>

      <div v-if="moduleWeek.length" class="card">
        <h2>Module study this week</h2>
        <ul class="list">
          <li v-for="m in moduleWeek" :key="m.module_id">
            <div class="grow">
              <strong>{{ code(m.module_id) }}</strong>
              <p class="hint">{{ oneDecimal(m.covered) }} of about {{ oneDecimal(m.weekly) }} h booked, counting TMA work and tutorials</p>
            </div>
          </li>
        </ul>
      </div>

      <div class="card">
        <h2>Still to do</h2>
        <p v-if="!needs.length" class="hint">Nothing due. Add assessments in Modules.</p>
        <ul class="list">
          <li v-for="n in needs" :key="n.assessment.id">
            <div class="grow">
              <strong>{{ label(n.assessment.module_id, n.assessment.id) }}</strong>
              <p class="hint">
                <template v-if="n.remaining">{{ n.remaining }} h not yet in an accepted block</template>
                <template v-else>All planned</template>,
                aim to finish by {{ dayText(n.target) }}<template v-if="n.assessment.provisional"> (rough date)</template>
              </p>
            </div>
            <a :href="'#/assessment/' + n.assessment.id">Parts</a>
          </li>
        </ul>
      </div>
    </section>`,
  setup() {
    const el = ref(null)
    const message = ref('')
    const selected = ref(null)
    const picked = ref(null)
    const pickedFor = ref('')
    const viewStart = ref(new Date())
    let calendar, resizer

    const zone = () => settings.timeZone

    const data = live(loadAll, null)

    // recheck risks on every change
    const atRisk = computed(() => data.value ? checkRisks(data.value, settings, new Date()) : [])

    const modules = computed(() => data.value?.modules || [])
    const code = id => modules.value.find(m => m.id === id)?.code || ''
    const partTitle = id => data.value?.tasks.find(t => t.id === id)?.title || ''

    // no assessment means general module study
    function label(moduleId, assessmentId) {
      if (!assessmentId) return `${code(moduleId)} study`
      const a = data.value?.assessments.find(a => a.id === assessmentId)
      return `${code(moduleId)} ${a?.title || ''}`
    }

    const dayText = date => shortDate(date, zone())
    const whenText = (start, end) => `${shortDate(start, zone())}, ${clockTime(new Date(start), zone())} to ${clockTime(new Date(end), zone())}`

    // module mode overrides the setting
    const modeOf = moduleId => modules.value.find(m => m.id === moduleId)?.mode_override || settings.plannerMode

    const needs = computed(() => data.value ? getNeeds(data.value, settings, new Date()) : [])
    const canPlan = computed(() => modules.value.some(m => modeOf(m.id) !== 'manual'))
    const suggestedCount = computed(() => data.value ? data.value.blocks.filter(b => b.state === 'suggested').length : 0)

    const moduleWeek = computed(() => {
      if (!data.value || !settings.trackOptional) return []
      return getModuleNeeds(data.value, settings, weekBounds(viewStart.value, zone()), data.value.blocks)
    })

    // calendar uses device time, convert with toWall
    function events(range, success) {
      if (!data.value) return success([])
      const d = data.value
      const from = fromWall(range.start, zone())
      const to = fromWall(range.end, zone())
      const wall = item => ({ ...item, start: toWall(item.start, zone()), end: toWall(item.end, zone()) })

      const free = getFreeTime(from, to, d, settings)
        .map(f => wall({ start: f.start, end: f.end, display: 'background', classNames: ['ev-free'] }))

      const work = getShifts(from, to, d.pattern, d.exceptions, zone())
        .map(s => wall({ title: 'Work', start: s.start, end: s.end, classNames: ['ev-work'] }))

      const busy = getBlocked(from, to, d.blocked, zone())
        .map(b => wall({ title: b.label || 'Blocked', start: b.start, end: b.end, classNames: ['ev-blocked'] }))

      const tutorials = d.tutorials
        .map(t => wall({ title: `${code(t.module_id)} ${t.title}`, start: t.start, end: t.end, classNames: ['ev-tutorial'] }))

      // only study blocks can be moved
      const blocks = d.blocks
        .filter(b => b.state !== 'missed')
        .map(b => wall({
          id: b.id,
          title: label(b.module_id, b.assessment_id),
          start: b.start,
          end: b.end,
          editable: true,
          classNames: [{ suggested: 'ev-suggested', done: 'ev-done' }[b.state] || 'ev-study'],
          extendedProps: { block: b }
        }))

      // deadlines sit in the all day row
      const due = d.assessments.map(a => ({
        title: `${a.provisional ? '~' : ''}${label(a.module_id, a.id)} ${clockTime(new Date(a.due), zone())}`,
        start: dateKey(new Date(a.due), zone()),
        allDay: true,
        classNames: ['ev-due']
      }))

      success([...free, ...work, ...busy, ...tutorials, ...blocks, ...due])
    }

    // plan the week on screen
    async function plan() {
      const d = data.value
      const result = planWeek(d, settings, new Date(), viewStart.value)

      await remove('blocks', result.remove)
      for (const b of result.blocks) await save('blocks', b)

      const count = result.blocks.length
      selected.value = null
      if (!result.hadWork) message.value = `Nothing to plan, it's all covered.`
      else if (!count) message.value = 'No free time left this week for the work still to do.'
      else message.value = `Planned ${count} study ${count === 1 ? 'block' : 'blocks'} this week.`
    }

    // export the next few weeks as .ics
    function exportCalendar() {
      const now = new Date()
      const until = new Date(+now + settings.exportWeeks * 7 * 86400000)
      const labels = {
        block: b => label(b.module_id, b.assessment_id),
        tutorial: t => `${code(t.module_id)} tutorial: ${t.title}`,
        due: a => `${label(a.module_id, a.id)} ${a.type === 'exam' ? 'exam' : 'due'} ${clockTime(new Date(a.due), zone())}`
      }
      const events = calendarEvents(data.value, settings, now, until, labels)
      downloadFile('study-planner.ics', buildCalendar(events), 'text/calendar')
      message.value = `Saved ${events.length} ${events.length === 1 ? 'event' : 'events'} for the next ${settings.exportWeeks === 1 ? 'week' : settings.exportWeeks + ' weeks'}. Open the file to add them to your calendar. Only accepted blocks are included.`
    }

    async function accept(block) {
      await save('blocks', { ...block, state: 'accepted' })
      selected.value = null
    }

    async function acceptAll() {
      for (const b of data.value.blocks.filter(b => b.state === 'suggested')) {
        await save('blocks', { ...b, state: 'accepted' })
      }
      message.value = ''
    }

    async function dismiss(block) {
      await remove('blocks', block.id)
      selected.value = null
    }

    function clearPick() {
      picked.value = null
      pickedFor.value = ''
      calendar.unselect()
    }

    // a: is an assessment, m: is module study
    async function addBlock() {
      const [kind, id] = pickedFor.value.split(':')
      const assessment = kind === 'a' ? data.value.assessments.find(a => a.id === id) : null
      await save('blocks', {
        assessment_id: assessment?.id || null,
        module_id: assessment ? assessment.module_id : id,
        task_id: null,
        start: picked.value.start.toISOString(),
        end: picked.value.end.toISOString(),
        state: 'accepted'
      })
      clearPick()
    }

    // moving a block accepts it
    function moved(info) {
      const block = info.event.extendedProps.block
      const start = fromWall(info.event.start, zone())
      const end = fromWall(info.event.end, zone())
      save('blocks', { ...block, start: start.toISOString(), end: end.toISOString(), state: block.state === 'done' ? 'done' : 'accepted', auto: false })
    }

    onMounted(() => {
      calendar = new FullCalendar.Calendar(el.value, {
        locale: enGb,
        initialView: window.innerWidth < 700 ? 'timeGridDay' : 'timeGridWeek',
        headerToolbar: { left: 'prev,next today', center: 'title', right: 'timeGridWeek,timeGridDay' },
        dayHeaderFormat: { weekday: 'short', day: 'numeric' },
        slotLabelFormat: clock,
        eventTimeFormat: clock,
        slotMinTime: '07:00',
        slotMaxTime: '24:00',
        snapDuration: '00:15:00',
        allDayText: 'Due',
        height: '75vh',
        scrollTime: settings.studyWindow.start,
        nowIndicator: true,
        now: () => toWall(new Date(), zone()),
        selectable: true,
        selectMirror: true,
        unselectAuto: false,
        events,
        datesSet(info) {
          viewStart.value = fromWall(info.start, zone())
        },
        eventClick(info) {
          if (!info.event.extendedProps.block) return
          picked.value = null
          selected.value = info.event.extendedProps.block
        },
        select(info) {
          selected.value = null
          picked.value = { start: fromWall(info.start, zone()), end: fromWall(info.end, zone()) }
        },
        eventDrop: moved,
        eventResize: moved
      })
      calendar.render()

      // resize when the container changes
      resizer = new ResizeObserver(() => calendar.updateSize())
      resizer.observe(el.value)
    })

    onUnmounted(() => {
      resizer?.disconnect()
      calendar?.destroy()
    })

    // refresh when data changes
    watch(data, value => {
      if (!calendar) return
      calendar.setOption('slotMinTime', gridStart(value.pattern, value.exceptions))
      calendar.refetchEvents()
    })

    return {
      el, message, atRisk, selected, picked, pickedFor, needs, modules, moduleWeek, canPlan, suggestedCount,
      code, label, partTitle, dayText, whenText, oneDecimal, plan, exportCalendar, accept, acceptAll, dismiss, clearPick, addBlock
    }
  }
}
