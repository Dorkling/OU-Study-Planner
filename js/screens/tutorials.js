import { all, save, remove, live } from '../db.js'
import { parseTutorial, isDuplicate } from '../tutorials.js'
import { shortDate, clockTime } from '../time.js'
import { settings } from '../settings.js'
import { readImage } from '../ocr.js'
import TutorialForm from '../components/tutorial-form.js'

const { ref, computed } = Vue

export default {
  components: { TutorialForm },
  template: `
    <section>
      <h1>Tutorials</h1>

      <div v-if="!modules.length" class="card">
        <p>Add a module first so tutorials can be linked to it. <a href="#/modules">Go to modules</a></p>
      </div>

      <template v-else-if="!draft">
        <div class="card">
          <h2>Add a tutorial</h2>
          <div class="segmented" role="radiogroup" aria-label="How to add">
            <label><input type="radio" value="paste" v-model="method"> Paste</label>
            <label><input type="radio" value="screenshot" v-model="method"> Screenshot</label>
            <label><input type="radio" value="manual" v-model="method"> Type it in</label>
          </div>

          <div v-if="method === 'paste'" class="paste">
            <p class="hint">Copy the details table from the booking confirmation page and paste it here. On iPhone you can copy text from a screenshot with Live Text.</p>
            <textarea v-model="pasted" rows="8" aria-label="Pasted booking details"></textarea>
            <p v-if="readError" class="hint error">{{ readError }}</p>
            <div class="actions">
              <button class="primary" :disabled="!pasted.trim()" @click="readPasted">Read details</button>
            </div>
          </div>
          <div v-else-if="method === 'screenshot'" class="paste">
            <p class="hint">Screenshot the booking confirmation page with the details table showing and choose it here. It's read on your device and not uploaded. The first one takes longer while the reader downloads.</p>
            <label class="stack">Screenshot <input type="file" accept="image/*" @change="readScreenshot($event.target)" :disabled="reading !== null"></label>
            <div v-if="reading !== null" class="progress-wrap">
              <div class="progress"><span :style="{ width: Math.round(reading * 100) + '%' }"></span></div>
              <p class="hint">Reading the screenshot...</p>
            </div>
            <p v-if="readError" class="hint error">{{ readError }}</p>
          </div>
          <div v-else class="actions spaced">
            <button class="primary" @click="open({})">Start</button>
          </div>
        </div>
        <p v-if="message" class="notice">{{ message }}</p>
      </template>

      <TutorialForm v-else :tutorial="draft" :modules="modules" :key="draftKey" @save="saveTutorial" @cancel="draft = null" />

      <div class="card">
        <h2>Upcoming</h2>
        <p v-if="!upcoming.length" class="hint">No tutorials booked.</p>
        <ul class="list">
          <li v-for="t in upcoming" :key="t.id">
            <div class="grow">
              <strong>{{ code(t.module_id) }}</strong> {{ t.title }}
              <p class="hint">{{ when(t) }}<template v-if="t.recorded === false">, live only</template><template v-else-if="t.recorded">, recorded</template><template v-if="t.tutors.length">, {{ t.tutors.join(', ') }}</template></p>
            </div>
            <div class="actions">
              <button class="link" @click="open(t)">Edit</button>
              <button class="link danger" @click="remove('tutorials', t.id)">Delete</button>
            </div>
          </li>
        </ul>
      </div>
    </section>`,
  setup() {
    const method = ref('paste')
    const pasted = ref('')
    const readError = ref('')
    const message = ref('')
    const draft = ref(null)
    const draftKey = ref(0)

    const modules = live(() => all('modules'))
    const tutorials = live(async () => (await all('tutorials')).sort((a, b) => a.start.localeCompare(b.start)))
    const upcoming = computed(() => tutorials.value.filter(t => new Date(t.end) > new Date()))

    const code = id => modules.value.find(m => m.id === id)?.code || ''
    const when = t => `${shortDate(t.start, settings.timeZone)}, ${clockTime(new Date(t.start), settings.timeZone)} to ${clockTime(new Date(t.end), settings.timeZone)}`

    function open(tutorial) {
      draft.value = tutorial
      draftKey.value++
      message.value = ''
    }

    // parse text into the form to check
    function useText(text, tryAgain) {
      const parsed = parseTutorial(text)
      if (!parsed.date && !parsed.start && !parsed.title) {
        readError.value = `Couldn't find any tutorial details. ${tryAgain}, or type it in instead.`
        return
      }
      readError.value = ''
      const { start, end, ...rest } = parsed
      open({ ...rest, startTime: start, endTime: end })
    }

    const readPasted = () => useText(pasted.value, 'Try copying the whole details table')

    // ocr progress, null when not reading
    const reading = ref(null)

    async function readScreenshot(input) {
      const image = input.files[0]
      if (!image) return
      readError.value = ''
      reading.value = 0
      try {
        const text = await readImage(image, progress => { reading.value = progress })
        useText(text, 'Try a clearer screenshot of the whole table')
      } catch (error) {
        readError.value = error.message || `Couldn't read that image.`
      }
      reading.value = null
      input.value = ''
    }

    async function saveTutorial(tutorial) {
      const others = tutorials.value.filter(t => t.id !== tutorial.id)
      if (isDuplicate(tutorial, others)) {
        message.value = 'That tutorial is already saved.'
      } else {
        await save('tutorials', tutorial)
        message.value = `Saved ${tutorial.title}.`
      }
      draft.value = null
      pasted.value = ''
    }

    return {
      method, pasted, readError, message, draft, draftKey, modules, upcoming,
      code, when, open, readPasted, reading, readScreenshot, saveTutorial, remove
    }
  }
}
