import { save, saveMany, remove, live, loadAll } from '../db.js'
import { settings, saveSetting } from '../settings.js'
import { getShifts, getBlocked, getFreeTime, getBusy, dayPlan } from '../freetime.js'
import { getNeeds, moduleWeekSummary, planWeeks, weeksToEnd, checkRisks, findClashes } from '../planner.js'
import CapacityNote from '../components/capacity-note.js'
import { moveClashes, markSubmitted } from '../progress.js'
import { recordMove, habitSuggestion, acceptHabit, dismissHabit } from '../habits.js'
import { dateKey, clockTime, shortDate, weekBounds, toWall, fromWall, dayNames } from '../time.js'
import { oneDecimal } from '../estimates.js'
import { calendarEvents, buildCalendar } from '../ics.js'
import { downloadFile } from '../backup.js'

const { ref, computed, watch, onMounted, onUnmounted } = Vue

// uk dates and monday start
const enGb = { code: 'en-gb', week: { dow: 1, doy: 4 }, buttonText: { today: 'Today', month: 'Month', week: 'Week', day: 'Day' } }
const clock = { hour: '2-digit', minute: '2-digit', hour12: false }

// earliest study start across the week
const earliestStudy = () => [0, 1, 2, 3, 4, 5, 6].map(d => dayPlan(settings, d)).filter(d => d.study).map(d => d.start).sort()[0] || '09:00'

// start the grid early enough for every shift
function gridStart(pattern, exceptions) {
  const shifts = [...pattern, ...exceptions.filter(e => e.type === 'shift')]
  const times = [earliestStudy(), '07:00', ...shifts.map(s => s.end <= s.start ? '00:00' : s.start)]
  return times.sort()[0].slice(0, 2) + ':00'
}

export default {
  components: { CapacityNote },
  template: `
    <section>
      <div class="page-head">
        <h1>{{ viewType === 'dayGridMonth' ? 'Month' : 'Week' }}</h1>
        <div class="actions">
          <button @click="exportCalendar">Add to calendar</button>
          <button v-if="suggestedCount" @click="acceptAll">Accept all</button>
          <div v-if="canPlan" class="plan-range">
            <select v-model="settings.planAhead" @change="saveSetting('planAhead', settings.planAhead)" aria-label="How far ahead to plan">
              <option value="week">This week</option>
              <option value="4">Next 4 weeks</option>
              <option value="9">Next 2 months</option>
              <option value="end">Until my modules end</option>
            </select>
            <button class="primary" :disabled="planning" @click="plan">{{ planning ? 'Planning...' : 'Plan' }}</button>
          </div>
        </div>
      </div>

      <CapacityNote />

      <div v-if="habit" class="notice">
        <p v-if="habit.use === 'backup'">You've moved study off {{ dayNames[habit.weekday] }}s a few times. Only use {{ dayNames[habit.weekday] }}s when needed from now on?</p>
        <p v-else>You've moved study onto {{ dayNames[habit.weekday] }}s a few times. Make {{ dayNames[habit.weekday] }} a preferred day?</p>
        <div class="actions">
          <button class="primary" @click="acceptHabit(habit)">Yes</button>
          <button @click="dismissHabit(habit)">No thanks</button>
        </div>
      </div>

      <div v-if="clashes.length" class="notice warn">
        <p>{{ clashes.length }} study {{ clashes.length === 1 ? 'block clashes' : 'blocks clash' }} with your work, blocked time or study hours. They're marked in red.</p>
        <div class="actions"><button @click="moveAll">Move {{ clashes.length === 1 ? 'it' : 'them' }}</button></div>
      </div>

      <div v-if="message || atRisk.length" class="notice" :class="{ warn: atRisk.length }">
        <p v-if="message">{{ message }}</p>
        <p v-for="r in atRisk">{{ label(r.assessment.module_id, r.assessment.id) }} is at risk: {{ r.hours }} h won't fit before {{ dayText(r.target) }}.</p>
      </div>

      <div v-if="selected" class="card panel">
        <p><strong>{{ label(selected.module_id, selected.assessment_id) }}</strong><template v-if="partTitle(selected.task_id)">, {{ partTitle(selected.task_id) }}</template></p>
        <p class="hint">{{ whenText(selected.start, selected.end) }}<template v-if="selected.state === 'suggested'">, suggested</template></p>
        <p v-if="clashOf(selected)" class="hint error">{{ clashOf(selected) === 'busy' ? 'This clashes with work, blocked time or a tutorial.' : 'This is outside your study hours. Drag it to keep it somewhere else.' }}</p>
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
        <span v-if="clashes.length"><i class="swatch ev-clash-key"></i>Clash</span>
      </div>
      <p class="hint">Drag over free time to add a block. Click a block to accept or remove it, drag to move it. In Month, click a date to open that week.</p>
      <div ref="el" class="calendar card"></div>

      <div v-if="moduleWeek.length" class="card">
        <h2>Module study this week</h2>
        <ul class="list">
          <li v-for="m in moduleWeek" :key="m.module_id">
            <div class="grow">
              <strong>{{ code(m.module_id) }}</strong>
              <p class="hint">{{ oneDecimal(m.covered) }} of about {{ oneDecimal(m.weekly) }} h booked or suggested<template v-if="m.catchUp"> (with {{ m.catchUp }} h catch up)</template>, counting TMA work and tutorials</p>
              <p v-if="m.short" class="hint error">{{ oneDecimal(m.short) }} h short, with no free time left this week</p>
            </div>
          </li>
        </ul>
      </div>

      <div class="card">
        <h2>Still to do</h2>
        <p v-if="!needs.length" class="hint">Nothing left to plan for. Add assessments in Modules, and tick them off there once they're submitted.</p>
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
            <div class="actions">
              <button class="link" @click="markSubmitted(n.assessment, true)">{{ n.assessment.type === 'exam' ? 'Done' : 'Submitted' }}</button>
              <a :href="'#/assessment/' + n.assessment.id">Parts</a>
            </div>
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
    const viewType = ref('')
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

    // month view plans and totals this week, week and day views use the one on screen
    const weekOf = () => viewType.value === 'dayGridMonth' ? new Date() : viewStart.value

    const moduleWeek = computed(() => {
      if (!data.value || !settings.trackOptional) return []
      return moduleWeekSummary(data.value, settings, weekBounds(weekOf(), zone()), new Date())
    })

    // suggestions tidy themselves, so only accepted blocks are left to warn about
    const allClashes = computed(() => data.value ? findClashes(data.value, settings, new Date()) : [])
    const clashes = computed(() => allClashes.value.filter(c => c.block.state === 'accepted'))
    const clashOf = block => allClashes.value.find(c => c.block.id === block.id)?.reason

    async function moveAll() {
      await moveClashes(clashes.value.map(c => c.block))
      selected.value = null
      message.value = 'Clashing blocks taken out and the week planned again.'
    }

    // no dropping or drawing blocks over work, blocked time or tutorials
    function overlapsBusy(start, end) {
      const day = 86400000
      const busy = getBusy(new Date(start - day), new Date(+end + day), { ...data.value, blocks: [] }, settings)
      return busy.some(b => b.start < end && b.end > start)
    }

    // calendar uses device time, convert with toWall
    function events(range, success) {
      if (!data.value) return success([])
      const d = data.value
      const from = fromWall(range.start, zone())
      const to = fromWall(range.end, zone())
      const wall = item => ({ ...item, start: toWall(item.start, zone()), end: toWall(item.end, zone()) })

      // month shows what's on, not free time
      const month = calendar?.view.type === 'dayGridMonth'
      const free = month ? [] : getFreeTime(from, to, d, settings)
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
          classNames: [{ suggested: 'ev-suggested', done: 'ev-done' }[b.state] || 'ev-study', ...(clashOf(b) ? ['ev-clash'] : [])],
          extendedProps: { block: b }
        }))

      // deadlines sit in the all day row
      // submitted ones stay on the calendar but faded
      const due = d.assessments.map(a => ({
        title: `${a.provisional ? '~' : ''}${label(a.module_id, a.id)} ${a.submitted ? (a.type === 'exam' ? 'done' : 'submitted') : clockTime(new Date(a.due), zone())}`,
        start: dateKey(new Date(a.due), zone()),
        allDay: true,
        classNames: a.submitted ? ['ev-due', 'ev-submitted'] : ['ev-due']
      }))

      success([...free, ...work, ...busy, ...tutorials, ...blocks, ...due])
    }

    // plan from the week on screen, as far ahead as chosen
    const planning = ref(false)
    async function plan() {
      planning.value = true
      const d = data.value
      const ahead = settings.planAhead
      const weeks = ahead === 'week' ? 1 : ahead === 'end' ? weeksToEnd(d, settings, weekOf()) : Number(ahead)

      // let the button show planning before the work starts
      await new Promise(resolve => setTimeout(resolve, 20))
      const result = planWeeks(d, settings, new Date(), weekOf(), weeks)
      await remove('blocks', result.remove)
      await saveMany('blocks', result.blocks)

      const count = result.blocks.length
      const span = weeks === 1 ? 'this week' : `over ${weeks} weeks`
      selected.value = null
      planning.value = false
      if (!result.hadWork) message.value = `Nothing to plan, it's all covered.`
      else if (!count) message.value = `No free time left ${span} for the work still to do.`
      else message.value = `Planned ${count} study ${count === 1 ? 'block' : 'blocks'} ${span}.`
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
      await saveMany('blocks', data.value.blocks.filter(b => b.state === 'suggested').map(b => ({ ...b, state: 'accepted' })))
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
        state: 'accepted',
        byUser: true
      })
      clearPick()
    }

    // spot a pattern in where blocks get dragged, see habits.js
    const habit = computed(() => data.value && settings.habits ? habitSuggestion() : null)

    // moving a block accepts it
    function moved(info) {
      const block = info.event.extendedProps.block
      if (info.oldEvent) recordMove(new Date(block.start), fromWall(info.event.start, zone()))
      const start = fromWall(info.event.start, zone())
      const end = fromWall(info.event.end, zone())
      save('blocks', { ...block, start: start.toISOString(), end: end.toISOString(), state: block.state === 'done' ? 'done' : 'accepted', auto: false, byUser: true })
    }

    onMounted(() => {
      calendar = new FullCalendar.Calendar(el.value, {
        locale: enGb,
        initialView: window.innerWidth < 700 ? 'timeGridDay' : 'timeGridWeek',
        headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' },
        dayHeaderFormat: { weekday: 'short', day: 'numeric' },
        views: { dayGridMonth: { dayHeaderFormat: { weekday: 'short' }, dayMaxEvents: 4 } },
        navLinks: true,
        navLinkDayClick: date => calendar.changeView('timeGridWeek', date),
        slotLabelFormat: clock,
        eventTimeFormat: clock,
        slotMinTime: '07:00',
        slotMaxTime: '24:00',
        snapDuration: '00:15:00',
        eventShortHeight: 50,
        eventMinHeight: 18,
        allDayText: 'Due',
        height: '75vh',
        scrollTime: earliestStudy(),
        nowIndicator: true,
        now: () => toWall(new Date(), zone()),
        selectable: true,
        selectMirror: true,
        unselectAuto: false,
        events,
        datesSet(info) {
          viewStart.value = fromWall(info.start, zone())
          viewType.value = info.view.type
        },
        selectAllow(info) {
          return !info.allDay && !overlapsBusy(fromWall(info.start, zone()), fromWall(info.end, zone()))
        },
        eventAllow(info) {
          return !info.allDay && !overlapsBusy(fromWall(info.start, zone()), fromWall(info.end, zone()))
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
      el, message, viewType, markSubmitted, habit, acceptHabit, dismissHabit, dayNames, planning, settings, saveSetting, atRisk, clashes, clashOf, moveAll, selected, picked, pickedFor, needs, modules, moduleWeek, canPlan, suggestedCount,
      code, label, partTitle, dayText, whenText, oneDecimal, plan, exportCalendar, accept, acceptAll, dismiss, clearPick, addBlock
    }
  }
}
