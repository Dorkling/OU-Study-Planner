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
      <nav v-if="!inSetup">
        <a v-for="link in links" :href="'#/' + link.path" :class="{ active: section === link.path }">{{ link.name }}</a>
      </nav>
    </header>
    <div v-if="syncState.status === 'signed-out' && !inSetup" class="banner">
      <span>Google Drive sync is paused.</span>
      <button class="link" @click="reconnect">Reconnect</button>
      <span v-if="reconnectError" class="error">{{ reconnectError }}</span>
    </div>
    <main>
      <component :is="current" :key="hash" v-bind="props" />
    </main>`,
  setup() {
    const parts = computed(() => hash.value.replace(/^#\/?/, '').split('/'))
    const name = computed(() => screens[parts.value[0]] ? parts.value[0] : 'today')
    const inSetup = computed(() => !settings.setupDone)

    const current = computed(() => inSetup.value ? Setup : screens[name.value])
    const props = computed(() => name.value === 'assessment' ? { id: parts.value[1] } : {})

    // assessment pages sit under modules in the nav
    const section = computed(() => name.value === 'assessment' ? 'modules' : name.value)

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

    return { links, hash, current, props, section, inSetup, syncState, reconnect, reconnectError }
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

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js')
