import { settings, loadSettings } from './settings.js'
import Setup from './screens/setup.js'
import Today from './screens/today.js'
import Week from './screens/week.js'
import Modules from './screens/modules.js'
import Assessment from './screens/assessment.js'
import Tutorials from './screens/tutorials.js'
import Settings from './screens/settings.js'
import { syncState, startSync, reconnectDrive } from './sync.js'
import { startReminders } from './notify.js'
import { startAutoPlan } from './autoplan.js'
import { update, startUpdates, applyUpdate } from './updates.js'
import { downloadBackup } from './backup.js'
import { undo, undoLast } from './undo.js'

const { createApp, ref, computed } = Vue

// hash routes like #/week or #/assessment/<id>
const screens = { today: Today, week: Week, modules: Modules, assessment: Assessment, tutorials: Tutorials, settings: Settings }

const links = [
  { path: 'today', name: 'Today' },
  { path: 'week', name: 'Week' },
  { path: 'modules', name: 'Modules' },
  { path: 'tutorials', name: 'Tutorials' },
  { path: 'settings', name: 'Settings' }
]

const hash = ref(location.hash)
window.addEventListener('hashchange', () => { hash.value = location.hash })

const App = {
  template: `
    <header class="top">
      <a href="#/today" class="brand">OU Study Planner</a>
      <span v-if="syncText && !inSetup" class="sync">
        <button v-if="syncState.status === 'signed-out'" class="link" @click="reconnect">Sync paused, reconnect</button>
        <a v-else-if="syncState.status === 'error'" href="#/settings">Sync problem</a>
        <template v-else>{{ syncText }}</template>
      </span>
      <nav v-if="!inSetup">
        <a v-for="link in links" :href="'#/' + link.path" :class="{ active: section === link.path }">{{ link.name }}</a>
      </nav>
    </header>
    <div v-if="update.ready && !update.later" class="banner update">
      <span>A new version of the planner is ready. Your plans and settings stay as they are.</span>
      <button class="link" @click="applyUpdate">Update now</button>
      <button class="link" @click="downloadBackup">Download a backup first</button>
      <button class="link" @click="update.later = true">Later</button>
    </div>
    <div v-if="reconnectError && !inSetup" class="banner">
      <span class="error">{{ reconnectError }}</span>
    </div>
    <main>
      <component :is="current" :key="hash" v-bind="props" />
    </main>
    <div v-if="undo.text" class="toast" role="status">
      <span>{{ undo.text }}</span>
      <button class="link" @click="undoLast">Undo</button>
    </div>`,
  setup() {
    const parts = computed(() => hash.value.replace(/^#\/?/, '').split('/'))
    const name = computed(() => screens[parts.value[0]] ? parts.value[0] : 'today')
    const inSetup = computed(() => !settings.setupDone)

    const current = computed(() => inSetup.value ? Setup : screens[name.value])
    const props = computed(() => name.value === 'assessment' ? { id: parts.value[1] } : {})

    // assessment pages sit under modules in the nav
    const section = computed(() => name.value === 'assessment' ? 'modules' : name.value)

    // a quiet line in the header, as google's sign in runs out every hour and a warning each time is too much
    const syncText = computed(() => {
      if (!settings.driveSync || syncState.status === 'off' || syncState.status === 'choosing') return ''
      if (syncState.status === 'syncing') return 'Syncing...'
      if (syncState.status === 'waiting' && syncState.last) return `Synced ${syncState.last.toLocaleTimeString('en-GB', { timeZone: settings.timeZone, hour: '2-digit', minute: '2-digit' })}`
      return 'Sync on'
    })

    // sign in popup has to come from a click
    const reconnectError = ref('')
    async function reconnect() {
      reconnectError.value = ''
      try {
        await reconnectDrive()
      } catch (error) {
        reconnectError.value = error.message
      }
    }

    return { links, hash, current, props, section, inSetup, syncState, syncText, reconnect, reconnectError, update, applyUpdate, downloadBackup, undo, undoLast }
  }
}

await loadSettings()
createApp(App).mount('#app')

// started fine, so a later mixed update can reload again
try { sessionStorage.removeItem('reloaded') } catch {}

startSync()
startReminders()
startAutoPlan()

// stop the browser clearing data when space is low
navigator.storage?.persist?.()

// new versions wait for a yes, see updates.js
startUpdates()
