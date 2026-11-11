import { save, saveMany, remove, live, loadAll } from '../db.js'
import { settings, saveSetting } from '../settings.js'
import { keepModuleDays } from '../autoplan.js'
import { getShifts, getBlocked, getFreeTime, getBusy, dayPlan } from '../freetime.js'
import { getNeeds, moduleWeekSummary, planWeeks, weeksToEnd, checkRisks, findClashes, joinDropped, overdueWork, swapModuleDay } from '../planner.js'
import CapacityNote from '../components/capacity-note.js'
import { moveClashes, markSubmitted, markDone, markMissed } from '../progress.js'
import { offerUndo } from '../undo.js'
import { recordMove, habitSuggestion, acceptHabit, dismissHabit } from '../habits.js'
import { dateKey, clockTime, clockRange, shortDate, weekBounds, toWall, fromWall, dayNames, weekdayOf, hoursBetween } from '../time.js'
import { oneDecimal } from '../estimates.js'
import { calendarEvents, buildCalendar } from '../ics.js'
import { downloadFile } from '../backup.js'

const { ref, computed, watch, onMounted, onUnmounted } = Vue

// uk dates and monday start
const enGb = { code: 'en-gb', week: { dow: 1, doy: 4 }, buttonText: { today: 'Today', month: 'Month', week: 'Week', day: 'Day' } }
const clock = { hour: '2-digit', minute: '2-digit', hour12: false }

// earliest study start across the week
const earliestStudy = () => [0, 1, 2, 3, 4, 5, 6].map(d => dayPlan(settings, d)).filter(d => d.study).map(d => d.start).sort()[0] || '09:00'

// phone width, where columns only have room for a word or two
const narrow = () => window.innerWidth <= 600

// a night shift or anything else that runs past midnight needs the grid from the start of the day
// ending at midnight exactly doesn't count
const startOf = item => item.end <= item.start && item.end !== '00:00' ? '00:00' : item.start

// start the grid early enough for every shift
// a phone has no room to spare, so it starts at the first thing that's actually on
function gridStart(d) {
  const shifts = [...d.pattern, ...d.exceptions.filter(e => e.type === 'shift')]
  const times = [earliestStudy(), ...shifts.map(startOf)]
  if (narrow()) times.push(...d.blocked.map(startOf), ...[...d.tutorials, ...d.blocks].map(i => clockTime(new Date(i.start), settings.timeZone)))
  else times.push('07:00')
  return times.sort()[0].slice(0, 2) + ':00'
}

// what's in the key besides the modules
const keyItems = [
  { style: 'ev-study ev-tma', name: 'TMA work' },
  { style: 'ev-suggested', name: 'Suggested' },
  { style: 'ev-work', name: 'Work' },
  { style: 'ev-blocked', name: 'Blocked' },
  { style: 'ev-tutorial', name: 'Tutorial' },
  { style: 'ev-free', name: 'Free' },
  { style: 'ev-due', name: 'Deadline' }
]

// one row of buttons on a phone with the views underneath, and the calendar as tall as its hours so only the page scrolls
const layout = () => narrow()
  ? {
      headerToolbar: { left: 'prev,next', center: 'title', right: 'today' },
      footerToolbar: { center: 'dayGridMonth,timeGridWeek,threeDay,timeGridDay' },
      titleFormat: { day: 'numeric', month: 'short' },
      height: 'auto',
      displayEventEnd: false
    }
  : {
      headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,threeDay,timeGridDay' },
      footerToolbar: false,
      titleFormat: { day: 'numeric', month: 'short', year: 'numeric' },
      height: '75vh',
      displayEventEnd: true
    }

export default {
  components: { CapacityNote },
  template: `
    <section>
      <div class="page-head">
        <h1>{{ viewType === 'dayGridMonth' ? 'Month' : 'Week' }}</h1>
        <div class="actions">
          <button class="wide-only" @click="exportCalendar">Add to calendar</button>
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

      <div v-if="dayChange" class="notice">
        <p>You moved {{ codeOf(dayChange.module_id) }} from {{ dayNames[dayChange.from] }} to {{ dayNames[dayChange.to] }}. Keep {{ codeOf(dayChange.module_id) }} on {{ dayNames[dayChange.to] }}s from now on?</p>
        <div class="actions">
          <button class="primary" @click="moveModuleDay">Every week</button>
          <button @click="dayChange = null">Just this week</button>
        </div>
      </div>

      <div v-else-if="habit" class="notice">
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

      <div v-if="overdue.length" class="notice warn">
        <p v-for="a in overdue">{{ label(a.module_id, a.id) }} was due {{ dayText(a.due) }} and isn't ticked off. <button class="link" @click="markSubmitted(a, true)">{{ a.type === 'exam' ? 'Done' : 'Submitted' }}</button></p>
      </div>

      <div v-if="message || atRisk.length" class="notice" :class="{ warn: atRisk.length }">
        <p v-if="message">{{ message }}</p>
        <p v-for="r in atRisk">{{ label(r.assessment.module_id, r.assessment.id) }} is at risk: {{ r.hours }} h won't fit before {{ dayText(r.target) }}.</p>
      </div>

      <div v-if="unplanned" class="notice">
        <p>Nothing's planned yet. Choose how far ahead and press Plan.</p>
      </div>

      <div v-if="selected" class="card panel">
        <p><strong>{{ label(selected.module_id, selected.assessment_id) }}</strong><template v-if="partTitle(selected.task_id)">, {{ partTitle(selected.task_id) }}</template></p>
        <p class="hint">{{ whenText(selected.start, selected.end) }}<template v-if="selected.state === 'suggested'">, suggested</template></p>
        <p v-if="clashOf(selected)" class="hint error">{{ clashOf(selected) === 'busy' ? 'This clashes with work, blocked time, a tutorial or an exam day.' : 'This is outside your study hours. Drag it to keep it somewhere else.' }}</p>
        <label v-if="canChange(selected)" class="inline">Change to
          <select :value="workOf(selected)" @change="changeWork(selected, $event.target.value)">
            <option v-if="!workOptions.some(o => o.value === workOf(selected))" :value="workOf(selected)">{{ label(selected.module_id, selected.assessment_id) }}</option>
            <option v-for="o in workOptions" :value="o.value">{{ o.name }}</option>
          </select>
        </label>
        <p v-if="keepsFree(selected)" class="hint">Removing it keeps this time free, so the planner won't book it again. You can change that in Settings under Blocked time.</p>
        <div class="actions">
          <button v-if="selected.state === 'suggested'" class="primary" @click="accept(selected)">Accept</button>
          <template v-if="selected.state === 'accepted' && isOver(selected)">
            <button class="primary" @click="finish(selected)">Done</button>
            <button @click="miss(selected)">Missed</button>
          </template>
          <button @click="dismiss(selected)">{{ selected.state === 'suggested' ? 'Dismiss' : keepsFree(selected) ? 'Remove and keep free' : 'Remove' }}</button>
          <button class="link" @click="selected = null">Close</button>
        </div>
      </div>

      <div v-if="picked" class="card panel">
        <p>New study block, {{ whenText(picked.start, picked.end) }}</p>
        <div class="row">
          <label class="inline">Ends <input type="time" :value="clockOf(picked.end)" @change="setPickedEnd($event.target.value)"></label>
          <select v-model="pickedFor" aria-label="What to work on">
            <option value="" disabled>Choose what to work on</option>
            <option v-for="o in workOptions" :value="o.value">{{ o.name }}</option>
          </select>
        </div>
        <p v-if="pickError" class="hint error">{{ pickError }}</p>
        <div class="actions">
          <button class="primary" :disabled="!pickedFor" @click="addBlock">Add block</button>
          <button class="link" @click="clearPick">Cancel</button>
        </div>
      </div>

      <div class="key">
        <span v-for="(m, i) in modules" :key="m.id"><i class="swatch ev-study" :class="'mod-' + (i % 5)"></i>{{ m.code }}</span>
        <span v-for="k in keyItems" :key="k.name" class="wide-only"><i class="swatch" :class="k.style"></i>{{ k.name }}</span>
        <span v-if="clashes.length" class="wide-only"><i class="swatch ev-clash-key"></i>Clash</span>
      </div>
      <p class="hint wide-only">Click or drag over free time to add a block. Click a block for options, drag to move it. In Month, click a date to open that week.</p>
      <div ref="el" class="calendar card"></div>

      <div class="narrow-only below-calendar">
        <p class="hint">Tap free time to add a block. Tap a block for options, press and hold to move it.</p>
        <details>
          <summary>Key</summary>
          <div class="key">
            <span v-for="k in keyItems" :key="k.name"><i class="swatch" :class="k.style"></i>{{ k.name }}</span>
            <span v-if="clashes.length"><i class="swatch ev-clash-key"></i>Clash</span>
          </div>
        </details>
        <div class="actions"><button @click="exportCalendar">Add to calendar</button></div>
      </div>

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
    const pickError = ref('')
    const viewStart = ref(new Date())
    const viewEnd = ref(new Date())
    const viewType = ref('')
    let calendar, resizer

    const zone = () => settings.timeZone

    const data = live(loadAll, null)

    // recheck risks on every change
    const atRisk = computed(() => data.value ? checkRisks(data.value, settings, new Date()) : [])

    const modules = computed(() => data.value?.modules || [])
    const code = id => modules.value.find(m => m.id === id)?.code || ''
    const colourOf = id => `mod-${Math.max(0, modules.value.findIndex(m => m.id === id)) % 5}`

    // each module has its own colour, so a phone label can leave the code out
    const shortLabel = assessmentId => assessmentId ? data.value?.assessments.find(a => a.id === assessmentId)?.title || 'TMA' : 'study'
    const partTitle = id => data.value?.tasks.find(t => t.id === id)?.title || ''

    // no assessment means general module study
    function label(moduleId, assessmentId) {
      if (!assessmentId) return `${code(moduleId)} study`
      const a = data.value?.assessments.find(a => a.id === assessmentId)
      return `${code(moduleId)} ${a?.title || ''}`
    }

    const dayText = date => shortDate(date, zone())
    const clockOf = date => clockTime(new Date(date), zone())
    const whenText = (start, end) => `${shortDate(start, zone())}, ${clockTime(new Date(start), zone())} to ${clockTime(new Date(end), zone())}`

    // module mode overrides the setting
    const modeOf = moduleId => modules.value.find(m => m.id === moduleId)?.mode_override || settings.plannerMode

    const needs = computed(() => data.value ? getNeeds(data.value, settings, new Date()) : [])
    const overdue = computed(() => data.value ? overdueWork(data.value.assessments, new Date()) : [])
    const canPlan = computed(() => modules.value.some(m => modeOf(m.id) !== 'manual'))
    const suggestedCount = computed(() => data.value ? data.value.blocks.filter(b => b.state === 'suggested').length : 0)

    // nothing on the calendar yet, so say what to do first
    const unplanned = computed(() => data.value && canPlan.value && !data.value.blocks.some(b => b.state !== 'missed'))

    // what a block can be for, a: is an assessment and m: is module study
    const workOptions = computed(() => [
      ...needs.value.map(n => ({ value: `a:${n.assessment.id}`, name: label(n.assessment.module_id, n.assessment.id) })),
      ...modules.value.map(m => ({ value: `m:${m.id}`, name: `${m.code} study` }))
    ])
    const workOf = block => block.assessment_id ? `a:${block.assessment_id}` : `m:${block.module_id}`
    function workFrom(value) {
      const [kind, id] = value.split(':')
      const assessment = kind === 'a' ? data.value.assessments.find(a => a.id === id) : null
      return { assessment_id: assessment?.id || null, module_id: assessment ? assessment.module_id : id }
    }

    // the deadline row only earns its space on a phone when something is due in the days showing
    const showDue = () => !narrow() || viewType.value === 'dayGridMonth' || (data.value?.assessments || []).some(a => new Date(a.due) >= viewStart.value && new Date(a.due) < viewEnd.value)

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
      // each module has its own colour, so on a phone the label can drop the module code
      const blocks = d.blocks
        .filter(b => b.state !== 'missed')
        .map(b => wall({
          id: b.id,
          title: narrow() ? shortLabel(b.assessment_id) : label(b.module_id, b.assessment_id),
          start: b.start,
          end: b.end,
          editable: true,
          classNames: [
            { suggested: 'ev-suggested', done: 'ev-done' }[b.state] || 'ev-study',
            colourOf(b.module_id),
            ...(b.assessment_id ? ['ev-tma'] : []),
            ...(clashOf(b) ? ['ev-clash'] : [])
          ],
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
      if (weekBounds(weekOf(), zone()).end <= new Date()) {
        message.value = `That week has already passed, so there's nothing to plan. Go to this week or a later one.`
        return
      }
      planning.value = true
      const d = data.value
      const ahead = settings.planAhead
      const weeks = ahead === 'week' ? 1 : ahead === 'end' ? weeksToEnd(d, settings, weekOf()) : Number(ahead)

      // let the button show planning before the work starts
      await new Promise(resolve => setTimeout(resolve, 20))
      await keepModuleDays(d)
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

    const isOver = block => new Date(block.end) <= new Date()
    const canChange = block => block.state !== 'done' && !isOver(block)

    // a block the planner made would be booked straight back into the gap, so removing one keeps the time free
    const keepsFree = block => block.state === 'accepted' && block.auto && new Date(block.start) > new Date()

    async function dismiss(block) {
      const steps = { restore: [['blocks', [block.id]]] }
      if (keepsFree(block)) {
        const start = new Date(block.start)
        const kept = await save('blocked_time', { label: 'Kept free', date: dateKey(start, zone()), start: clockTime(start, zone()), end: clockTime(new Date(block.end), zone()) })
        steps.remove = [['blocked_time', [kept.id]]]
      }
      await remove('blocks', block.id)
      offerUndo(`Removed ${label(block.module_id, block.assessment_id)}.`, steps)
      selected.value = null
    }

    // done for its full length, the today screen is where hours get changed
    async function finish(block) {
      await markDone(block, hoursBetween(new Date(block.start), new Date(block.end)))
      selected.value = null
    }

    async function miss(block) {
      await markMissed(block)
      selected.value = null
    }

    // switching what a block is for makes it yours, so the planner leaves it alone
    async function changeWork(block, value) {
      selected.value = await save('blocks', { ...block, ...workFrom(value), task_id: null, auto: false, byUser: true })
    }

    function clearPick() {
      picked.value = null
      pickedFor.value = ''
      pickError.value = ''
      calendar.unselect()
    }

    // a new end time for the block being added
    function setPickedEnd(time) {
      if (!time) return
      const start = picked.value.start
      const { end } = clockRange(dateKey(start, zone()), clockTime(start, zone()), time, zone())
      if (overlapsBusy(start, end)) {
        pickError.value = 'That runs into work, blocked time or a tutorial.'
        return
      }
      pickError.value = ''
      calendar.select(toWall(start, zone()), toWall(end, zone()))
    }

    async function addBlock() {
      await save('blocks', {
        ...workFrom(pickedFor.value),
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

    // a module's study moved to another weekday, asking if that's for good
    const dayChange = ref(null)
    const codeOf = id => modules.value.find(m => m.id === id)?.code || 'Module'
    const weekdayIn = date => weekdayOf(dateKey(date, zone()))

    // the module takes the new weekday, and whatever had it swaps onto the old one
    async function moveModuleDay() {
      const { module_id, to } = dayChange.value
      dayChange.value = null
      await saveSetting('moduleDays', swapModuleDay(settings.moduleDays, module_id, to))
    }

    // moving a block accepts it, and dropping it against the same work joins them
    async function moved(info) {
      const block = info.event.extendedProps.block
      if (info.oldEvent) recordMove(new Date(block.start), fromWall(info.event.start, zone()))
      const start = fromWall(info.event.start, zone())
      const end = fromWall(info.event.end, zone())
      const from = weekdayIn(new Date(block.start))
      const to = weekdayIn(start)
      const studyDay = dayPlan(settings, to).study !== false && dayPlan(settings, to).use !== 'backup'
      if (info.oldEvent && studyDay && from !== to && settings.moduleDays?.[from] === block.module_id && settings.moduleDays[to] !== block.module_id) {
        dayChange.value = { module_id: block.module_id, from, to }
      }
      const placed = { ...block, start: start.toISOString(), end: end.toISOString(), state: block.state === 'done' ? 'done' : 'accepted', auto: false, byUser: true }
      const joined = joinDropped(placed, data.value.blocks)
      if (joined.remove.length) await remove('blocks', joined.remove)
      await save('blocks', joined.block)
    }

    onMounted(() => {
      calendar = new FullCalendar.Calendar(el.value, {
        locale: enGb,
        initialView: narrow() ? 'threeDay' : 'timeGridWeek',
        ...layout(),
        dayHeaderFormat: { weekday: 'short', day: 'numeric' },
        views: {
          dayGridMonth: { dayHeaderFormat: { weekday: 'short' }, dayMaxEvents: 4, titleFormat: { month: 'long', year: 'numeric' } },
          threeDay: { type: 'timeGrid', duration: { days: 3 }, buttonText: '3 days' }
        },
        navLinks: true,
        navLinkDayClick: date => calendar.changeView(narrow() ? 'threeDay' : 'timeGridWeek', date),
        slotLabelFormat: clock,
        eventTimeFormat: clock,
        slotMinTime: '07:00',
        slotMaxTime: '24:00',
        snapDuration: '00:15:00',
        eventShortHeight: 50,
        eventMinHeight: 18,
        allDayText: 'Due',
        scrollTime: earliestStudy(),
        nowIndicator: true,
        now: () => toWall(new Date(), zone()),
        selectable: true,
        selectMirror: true,
        unselectAuto: false,
        // a plain click or tap is handled by dateClick, and a shorter hold makes dragging on a phone less of a wait
        selectMinDistance: 5,
        longPressDelay: 400,
        events,
        datesSet(info) {
          viewStart.value = fromWall(info.start, zone())
          viewEnd.value = fromWall(info.end, zone())
          viewType.value = info.view.type
          fitDueRow()
        },
        // a click or tap on free time starts an hour long block there
        dateClick(info) {
          if (info.allDay || info.view.type === 'dayGridMonth') return
          const end = new Date(+info.date + Math.max(60, settings.minBlock) * 60000)
          if (overlapsBusy(fromWall(info.date, zone()), fromWall(end, zone()))) return
          calendar.select(info.date, end)
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
          pickError.value = ''
          picked.value = { start: fromWall(info.start, zone()), end: fromWall(info.end, zone()) }

          // offer the module that usually has this day
          const usual = settings.moduleDays?.[weekdayIn(picked.value.start)]
          if (!pickedFor.value && modules.value.some(m => m.id === usual)) pickedFor.value = `m:${usual}`
        },
        eventDrop: moved,
        eventResize: moved
      })
      calendar.render()

      // resize when the container changes, and swap layout and labels if it crosses phone width
      let wasNarrow = narrow()
      resizer = new ResizeObserver(() => {
        calendar.updateSize()
        if (narrow() === wasNarrow) return
        wasNarrow = narrow()
        for (const [option, value] of Object.entries(layout())) calendar.setOption(option, value)
        if (data.value) calendar.setOption('slotMinTime', gridStart(data.value))
        fitDueRow()
        calendar.refetchEvents()
      })
      resizer.observe(el.value)
    })

    // only set when it changes, as setting it redraws the calendar
    let dueRow = true
    function fitDueRow() {
      if (!calendar || showDue() === dueRow) return
      dueRow = showDue()
      calendar.setOption('allDaySlot', dueRow)
    }

    onUnmounted(() => {
      resizer?.disconnect()
      calendar?.destroy()
    })

    // refresh when data changes
    watch(data, value => {
      // the block in the panel may have been replanned or changed elsewhere
      if (selected.value) selected.value = value.blocks.find(b => b.id === selected.value.id) || null
      if (!calendar) return
      calendar.setOption('slotMinTime', gridStart(value))
      fitDueRow()
      calendar.refetchEvents()
    })

    return {
      el, message, viewType, markSubmitted, overdue, habit, acceptHabit, dismissHabit, dayChange, moveModuleDay, codeOf, dayNames, planning, settings, saveSetting, atRisk, clashes, clashOf, moveAll, selected, picked, pickedFor, needs, modules, moduleWeek, canPlan, suggestedCount,
      code, label, partTitle, dayText, whenText, oneDecimal, plan, exportCalendar, accept, acceptAll, dismiss, clearPick, addBlock,
      keyItems, unplanned, workOptions, workOf, changeWork, canChange, isOver, keepsFree, finish, miss, clockOf, setPickedEnd, pickError
    }
  }
}
