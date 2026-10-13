import { all, save, remove, live } from '../db.js'
import { settings, saveSetting } from '../settings.js'
import { dayNames, weekOrder, dateKey, defaultZone, deviceZone } from '../time.js'
import { dayPlan } from '../freetime.js'
import WorkPattern from '../components/work-pattern.js'
import ZonePicker from '../components/zone-picker.js'
import { downloadBackup, restoreBackup } from '../backup.js'
import { canNotify, turnOnReminders, turnOffReminders } from '../notify.js'
import { syncState, syncNow, connectDrive, reconnectDrive, disconnectDrive, useDriveCopy, combineWithDrive, cancelConnect } from '../sync.js'
import { driveAvailable } from '../drive.js'

const byDate = (a, b) => a.date.localeCompare(b.date)

const { ref, computed } = Vue

export default {
  components: { WorkPattern, ZonePicker },
  template: `
    <section>
      <h1>Settings</h1>

      <div class="card">
        <h2>Work pattern</h2>
        <WorkPattern />
      </div>

      <div class="card">
        <h2>Changes to work</h2>
        <p class="hint">Holidays, swaps or extra shifts. These replace your normal pattern for that day.</p>
        <div v-for="e in exceptions" :key="e.id" class="row">
          <input type="date" v-model="e.date" @change="update('exceptions', e)" aria-label="Date">
          <select v-model="e.type" @change="update('exceptions', e)" aria-label="Change">
            <option value="off">Not working</option>
            <option value="shift">Working different hours</option>
          </select>
          <template v-if="e.type === 'shift'">
            <input type="time" v-model="e.start" @change="update('exceptions', e)" aria-label="Start">
            <span>to</span>
            <input type="time" v-model="e.end" @change="update('exceptions', e)" aria-label="End">
          </template>
          <button class="link danger" @click="remove('exceptions', e.id)">Remove</button>
        </div>
        <div class="actions"><button @click="addException">Add change</button></div>
      </div>

      <div class="card">
        <h2>Blocked time</h2>
        <p class="hint">Things the planner should never book over.</p>
        <div v-for="b in blocked" :key="b.id" class="row">
          <input v-model.trim="b.label" @change="update('blocked_time', b)" placeholder="Football" aria-label="Label">
          <select :value="b.date ? 'once' : 'weekly'" @change="setRepeat(b, $event.target.value)" aria-label="Repeat">
            <option value="weekly">Every week</option>
            <option value="once">Once</option>
          </select>
          <input v-if="b.date" type="date" v-model="b.date" @change="update('blocked_time', b)" aria-label="Date">
          <select v-else v-model.number="b.weekday" @change="update('blocked_time', b)" aria-label="Day">
            <option v-for="d in weekOrder" :value="d">{{ dayNames[d] }}</option>
          </select>
          <input type="time" v-model="b.start" @change="update('blocked_time', b)" aria-label="Start">
          <span>to</span>
          <input type="time" v-model="b.end" @change="update('blocked_time', b)" aria-label="End">
          <button class="link danger" @click="remove('blocked_time', b.id)">Remove</button>
        </div>
        <div class="actions"><button @click="addBlocked">Add blocked time</button></div>
      </div>

      <div class="card">
        <h2>Planning</h2>
        <div class="grid">
          <label>Planner mode
            <select v-model="settings.plannerMode" @change="put('plannerMode')">
              <option value="auto">Auto</option>
              <option value="suggest">Suggest</option>
              <option value="manual">Manual</option>
            </select>
            <span class="hint">{{ modeHints[settings.plannerMode] }}</span>
          </label>
          <label>How to plan
            <select v-model="settings.planStyle" @change="put('planStyle')">
              <option value="spread">Spread it out up to the deadline</option>
              <option value="early">Get it done as early as possible</option>
            </select>
          </label>
        </div>
        <label class="check"><input type="checkbox" v-model="settings.oneAtATime" @change="put('oneAtATime')"> Only plan for each module's next assessment until it's submitted</label>
        <p class="hint">Later TMAs and the EMA wait their turn. Weekly study from credits still fills the rest of the week.</p>
        <label class="check"><input type="checkbox" v-model="settings.groupByDay" @change="put('groupByDay')"> Keep each module to its own days where possible</label>
        <p class="hint">The module that needs the most time gets the biggest free day, and so on. If time is short, modules still share so none miss out.</p>
        <label class="check"><input type="checkbox" v-model="settings.trackOptional" @change="put('trackOptional')"> Plan weekly module study from credits</label>
        <p class="hint">Adds general study (reading, activities) to reach each module's weekly hours. TMA work and tutorials count toward it.</p>
      </div>

      <div class="card">
        <h2>When you study</h2>
        <p class="hint">Tick the days you study and when you're free. Preferred days get filled first, so give a day you like a long session more hours.</p>
        <div class="days">
          <div class="day-row day-head" aria-hidden="true">
            <span>Day</span><span>From</span><span>To</span><span>Max hours</span><span></span>
          </div>
          <div v-for="d in dayRows" :key="d.weekday" class="day-row" :class="{ off: !d.study }">
            <label class="check"><input type="checkbox" :checked="d.study" @change="editDay(d.weekday, 'study', $event.target.checked)"> {{ dayNames[d.weekday] }}</label>
            <input type="time" :value="d.start" :disabled="!d.study" @change="editDay(d.weekday, 'start', $event.target.value)" :aria-label="dayNames[d.weekday] + ' from'">
            <input type="time" :value="d.end" :disabled="!d.study" @change="editDay(d.weekday, 'end', $event.target.value)" :aria-label="dayNames[d.weekday] + ' to'">
            <input type="number" :value="d.maxHours" :disabled="!d.study" min="0.5" step="0.5" @change="editDay(d.weekday, 'maxHours', Number($event.target.value))" :aria-label="dayNames[d.weekday] + ' max hours'">
            <label class="check"><input type="checkbox" :checked="d.preferred" :disabled="!d.study" @change="editDay(d.weekday, 'preferred', $event.target.checked)"> Preferred</label>
          </div>
        </div>

        <h3>On days you work</h3>
        <div class="segmented" role="radiogroup" aria-label="Study on work days">
          <label><input type="radio" :value="false" v-model="settings.studyOnWorkDays" @change="put('studyOnWorkDays')"> Don't study</label>
          <label><input type="radio" :value="true" v-model="settings.studyOnWorkDays" @change="put('studyOnWorkDays')"> Study as well</label>
        </div>
        <div v-if="settings.studyOnWorkDays" class="grid spaced-top">
          <label>From <input type="time" v-model="settings.workDayWindow.start" @change="put('workDayWindow')"></label>
          <label>Until <input type="time" v-model="settings.workDayWindow.end" @change="put('workDayWindow')"></label>
          <label>Max hours <input type="number" v-model.number="settings.workDayMaxHours" @change="put('workDayMaxHours')" min="0" step="0.5"></label>
        </div>
        <label class="stack spaced-top">Travel time either side of a shift (minutes) <input type="number" v-model.number="settings.travelBuffer" @change="put('travelBuffer')" min="0" step="5"></label>
      </div>

      <div class="card">
        <h2>Study blocks</h2>
        <div class="grid">
          <label>Shortest block (minutes) <input type="number" v-model.number="settings.minBlock" @change="put('minBlock')" min="15" step="15"></label>
          <label>Longest block (minutes) <input type="number" v-model.number="settings.maxBlock" @change="put('maxBlock')" min="15" step="15"></label>
          <label>Break between blocks (minutes) <input type="number" v-model.number="settings.breakMins" @change="put('breakMins')" min="0" step="5"></label>
        </div>
      </div>

      <div class="card">
        <details>
          <summary>More options</summary>
          <p class="hint">Estimates the planner starts from. Most people won't need to change these.</p>
          <div class="grid">
            <label>Finish TMAs this many days early <input type="number" v-model.number="settings.tmaBuffer" @change="put('tmaBuffer')" min="0"></label>
            <label>Study hours per credit <input type="number" v-model.number="settings.hoursPerCredit" @change="put('hoursPerCredit')" min="1"></label>
            <label>Default hours per TMA <input type="number" v-model.number="settings.hoursPerTma" @change="put('hoursPerTma')" min="1"></label>
            <label>EMA and exam revision
              <select v-model="settings.revisionMode" @change="put('revisionMode')">
                <option value="planned">Planned to a total, like TMAs</option>
                <option value="weekly">A fixed amount each week</option>
              </select>
            </label>
            <label v-if="settings.revisionMode === 'planned'">Revision hours for an EMA or exam <input type="number" v-model.number="settings.hoursPerExam" @change="put('hoursPerExam')" min="1"></label>
            <label v-else>Revision hours each week <input type="number" v-model.number="settings.revisionHours" @change="put('revisionHours')" min="0" step="0.5"></label>
          </div>
        </details>
      </div>

      <div class="card">
        <h2>Time zone</h2>
        <p>All times are shown and planned in <strong>{{ zoneName(settings.timeZone) }}</strong>.</p>
        <ZonePicker :model-value="settings.timeZone" @update:model-value="z => put('timeZone', z)" />
        <p class="hint">Shifts and study times follow this zone, including summer time. Online tutorial times are always read as UK time.</p>
        <p v-if="device !== settings.timeZone" class="hint">This device is set to {{ zoneName(device) }}.
          <button class="link" @click="put('timeZone', device)">Use that instead</button>
          <button v-if="settings.timeZone !== defaultZone" class="link" @click="put('timeZone', defaultZone)">Go back to UK time</button>
        </p>
      </div>

      <div class="card">
        <h2>Reminders</h2>
        <p v-if="!canNotify()" class="hint">This browser can't show reminders, use the calendar export instead.</p>
        <template v-else>
          <label class="check"><input type="checkbox" :checked="settings.notifications" @change="toggleReminders($event.target)"> Remind me before study blocks and tutorials</label>
          <p v-if="reminderError" class="hint error">{{ reminderError }}</p>
          <label class="stack">Minutes before <input type="number" v-model.number="settings.notifyBefore" @change="put('notifyBefore')" min="0" step="5"></label>
          <p class="hint">Reminders only work while the app is open (minimised is fine). On Windows you can set the installed app to start when you sign in from its menu. On phones use the calendar export instead.</p>
        </template>
      </div>

      <div class="card">
        <h2>Calendar export</h2>
        <label class="stack">Add to calendar covers the next
          <select v-model.number="settings.exportWeeks" @change="put('exportWeeks')">
            <option v-for="n in [1, 2, 3, 4, 6, 8]" :value="n">{{ n }} {{ n === 1 ? 'week' : 'weeks' }}</option>
          </select>
        </label>
        <p class="hint">This is a snapshot, so export again after replanning. It's easiest to import into its own calendar called Study Planner. Google ignores reminders in the file, so set a default notification on that calendar.</p>
      </div>

      <div class="card">
        <h2>Google Drive sync</h2>
        <p v-if="!driveAvailable()" class="hint">Drive sync isn't set up on this copy of the app. Use a backup to move your data instead.</p>
        <template v-else-if="syncState.status === 'choosing'">
          <p>Your Google Drive already has a study plan with {{ syncState.choice.driveModules }} {{ syncState.choice.driveModules === 1 ? 'module' : 'modules' }}, and this device has its own with {{ syncState.choice.localModules }}.</p>
          <div class="choice">
            <button class="primary" @click="drive(useDriveCopy)">Use the plan from Drive</button>
            <p class="hint">Replaces everything on this device with the Drive copy. Best when adding a new phone or computer.</p>
          </div>
          <div class="choice">
            <button @click="drive(combineWithDrive)">Combine both</button>
            <p class="hint">Keeps everything from both. Where the same thing was changed on both, the newest change wins.</p>
          </div>
          <button class="link" @click="cancelConnect">Cancel</button>
        </template>
        <template v-else-if="!settings.driveSync">
          <p>Syncs your devices using a file in an OU Study Planner folder in your Google Drive. The app can only see files it created.</p>
          <p v-if="driveError" class="hint error">{{ driveError }}</p>
          <button class="primary" @click="drive(connectDrive)">Connect Google Drive</button>
        </template>
        <template v-else>
          <p>{{ syncText }}</p>
          <p v-if="driveError" class="hint error">{{ driveError }}</p>
          <div class="actions">
            <button v-if="syncState.status === 'signed-out'" class="primary" @click="drive(reconnectDrive)">Reconnect</button>
            <button v-else :disabled="syncState.status === 'syncing'" @click="syncNow">Sync now</button>
            <button class="link danger" @click="drive(disconnectDrive)">Stop syncing on this device</button>
          </div>
        </template>
      </div>

      <div class="card">
        <h2>Backup</h2>
        <p class="hint">Saves everything to one file. Use it as a backup or to move to another device.</p>
        <div class="actions"><button @click="downloadBackup">Download backup</button></div>

        <h3>Restore</h3>
        <div class="segmented" role="radiogroup" aria-label="How to restore">
          <label><input type="radio" value="merge" v-model="restoreMode"> Merge, newer changes win</label>
          <label><input type="radio" value="replace" v-model="restoreMode"> Replace everything here</label>
        </div>
        <label class="stack spaced-top">Backup file <input type="file" accept=".json,application/json" @change="restore($event.target)"></label>
        <p v-if="restoreMessage" class="hint" :class="{ error: restoreFailed }">{{ restoreMessage }}</p>
      </div>

      <div class="card">
        <h2>Appearance</h2>
        <div class="segmented" role="radiogroup" aria-label="Theme">
          <label v-for="t in themes"><input type="radio" :value="t.value" v-model="settings.theme" @change="put('theme')"> {{ t.name }}</label>
        </div>
      </div>

      <div class="card">
        <h2>About</h2>
        <p>Free and open source. Not affiliated with or endorsed by The Open University.</p>
        <p class="hint">Your data stays on this device, and in your Google Drive if sync is on. No accounts, analytics or tracking. <a href="privacy.html">Privacy policy</a></p>
      </div>

      <div class="card">
        <h2>Setup</h2>
        <p class="hint">Go through setup again. Nothing saved is lost.</p>
        <button @click="put('setupDone', false)">Run setup again</button>
      </div>
    </section>`,
  setup() {
    const exceptions = live(async () => (await all('exceptions')).sort(byDate))
    const blocked = live(() => all('blocked_time'))

    const modeHints = {
      auto: 'Plan my week adds blocks straight into the plan',
      suggest: 'Plan my week suggests blocks to accept, move or dismiss',
      manual: 'Shows free time and hours left, you place every block'
    }

    const dayRows = computed(() => weekOrder.map(weekday => ({ weekday, ...dayPlan(settings, weekday) })))

    // save the whole week so the older single study window turns into per day settings
    function editDay(weekday, field, value) {
      if ((field === 'start' || field === 'end') && !value) return
      const days = Object.fromEntries(weekOrder.map(d => [d, { ...dayPlan(settings, d) }]))
      days[weekday][field] = value
      put('days', days)
    }

    const device = deviceZone()
    const zoneName = z => z === defaultZone ? 'UK time' : z.replace(/_/g, ' ').replace(/\//g, ', ')

    const reminderError = ref('')
    const driveError = ref('')
    const restoreMode = ref('merge')
    const restoreMessage = ref('')
    const restoreFailed = ref(false)

    async function toggleReminders(box) {
      reminderError.value = ''
      if (!box.checked) return turnOffReminders()
      if (!(await turnOnReminders())) {
        box.checked = false
        reminderError.value = 'Notifications are blocked for this site. Allow them in your browser settings and try again.'
      }
    }

    // show drive errors on the card
    async function drive(action) {
      driveError.value = ''
      try {
        await action()
      } catch (error) {
        driveError.value = error.message
      }
    }

    const syncText = computed(() => {
      if (syncState.status === 'syncing') return 'Syncing...'
      if (syncState.status === 'signed-out') return 'Sync is paused. Google sign in only lasts about an hour, so reconnect to carry on.'
      if (syncState.status === 'error') return syncState.message
      if (syncState.last) return `Synced at ${syncState.last.toLocaleTimeString('en-GB', { timeZone: settings.timeZone, hour: '2-digit', minute: '2-digit' })}.`
      return 'Sync is on.'
    })

    async function restore(input) {
      const file = input.files[0]
      if (!file) return
      if (restoreMode.value === 'replace' && !confirm('Replace everything on this device with the backup? Anything not in the file gets deleted.')) {
        input.value = ''
        return
      }
      try {
        await restoreBackup(await file.text(), restoreMode.value)
        restoreFailed.value = false
        restoreMessage.value = `Restored from ${file.name}.`
      } catch (error) {
        restoreFailed.value = true
        restoreMessage.value = error.message
      }
      input.value = ''
    }

    const themes = [
      { value: 'light', name: 'Light' },
      { value: 'dark', name: 'Dark' },
      { value: 'system', name: 'System' }
    ]

    function put(key, value = settings[key]) {
      saveSetting(key, value)
    }

    // don't save while a field is half typed
    function update(table, row) {
      if (row.start && row.end && (row.date || row.weekday !== undefined)) save(table, row)
    }

    function addException() {
      save('exceptions', { date: dateKey(new Date(), settings.timeZone), type: 'off', start: '09:00', end: '17:00' })
    }

    function addBlocked() {
      save('blocked_time', { label: '', weekday: 1, start: '18:00', end: '20:00' })
    }

    // switch between weekly and one-off
    function setRepeat(b, repeat) {
      const { date, weekday, ...rest } = b
      save('blocked_time', repeat === 'once' ? { ...rest, date: dateKey(new Date(), settings.timeZone) } : { ...rest, weekday: 1 })
    }

    return {
      settings, exceptions, blocked, modeHints, dayRows, editDay, device, defaultZone, zoneName, themes,
      reminderError, driveError, restoreMode, restoreMessage, restoreFailed, syncState, syncText,
      canNotify, toggleReminders, drive, connectDrive, reconnectDrive, disconnectDrive, syncNow, useDriveCopy, combineWithDrive, cancelConnect,
      driveAvailable, downloadBackup, restore, dayNames, weekOrder, put, update, addException, addBlocked, setRepeat, remove
    }
  }
}
