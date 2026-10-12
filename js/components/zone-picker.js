import { defaultZone, clockTime } from '../time.js'

const { ref, computed } = Vue

// all zones, uk first
const zones = [defaultZone, ...(Intl.supportedValuesOf?.('timeZone') || []).filter(z => z !== defaultZone)]

// extra search words for uk
const aliases = { [defaultZone]: 'uk united kingdom britain british england scotland wales gmt bst' }

const nice = zone => zone.replace(/_/g, ' ').replace(/\//g, ', ')
const searchable = zone => `${zone.replace(/[_/]/g, ' ')} ${aliases[zone] || ''}`.toLowerCase()

export default {
  props: { modelValue: String },
  emits: ['update:modelValue'],
  template: `
    <div class="zone-picker">
      <label class="stack">Search for a city or region
        <input type="search" v-model="query" placeholder="London, New York, Madrid" autocomplete="off"
          @keydown.enter.prevent="matches[0] && pick(matches[0])" @keydown.esc="query = ''">
      </label>
      <ul v-if="query.trim()" class="results">
        <li v-for="z in matches" :key="z">
          <button type="button" @click="pick(z)">{{ nice(z) }} <span class="hint">{{ now(z) }} now</span></button>
        </li>
        <li v-if="!matches.length" class="hint">No match, try a nearby city.</li>
      </ul>
    </div>`,
  setup(props, { emit }) {
    const query = ref('')

    // match the start of words so uk doesn't find truk
    const matches = computed(() => {
      const words = query.value.toLowerCase().split(/\s+/).filter(Boolean)
      if (!words.length) return []
      return zones
        .filter(z => {
          const names = searchable(z).split(/\s+/)
          return words.every(w => names.some(name => name.startsWith(w)))
        })
        .slice(0, 8)
    })

    const now = zone => clockTime(new Date(), zone)

    function pick(zone) {
      emit('update:modelValue', zone)
      query.value = ''
    }

    return { query, matches, nice, now, pick }
  }
}
