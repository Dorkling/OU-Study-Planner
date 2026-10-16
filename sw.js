// bump when files change, people are asked before a new version takes over
const version = 'v25'

// the screenshot reader is big and rarely changes, so it keeps its own cache between versions
const ocrCache = 'tesseract-5.1.1'

// on your own machine changes show straight away instead of asking
const developing = ['localhost', '127.0.0.1'].includes(location.hostname)

const files = [
  './',
  'index.html',
  'oauth.html',
  'privacy.html',
  'manifest.json',
  'css/theme.css',
  'css/app.css',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'vendor/vue.global.prod.js',
  'vendor/dexie.min.js',
  'vendor/fullcalendar.min.js',
  'js/app.js',
  'js/db.js',
  'js/settings.js',
  'js/time.js',
  'js/estimates.js',
  'js/freetime.js',
  'js/config.js',
  'js/merge.js',
  'js/backup.js',
  'js/drive.js',
  'js/sync.js',
  'js/notify.js',
  'js/ics.js',
  'js/share.js',
  'js/ocr.js',
  'js/progress.js',
  'js/autoplan.js',
  'js/updates.js',
  'js/habits.js',
  'js/planner.js',
  'js/tutorials.js',
  'js/components/module-form.js',
  'js/components/assessment-form.js',
  'js/components/work-pattern.js',
  'js/components/tutorial-form.js',
  'js/components/zone-picker.js',
  'js/components/capacity-note.js',
  'js/screens/setup.js',
  'js/screens/today.js',
  'js/screens/week.js',
  'js/screens/modules.js',
  'js/screens/assessment.js',
  'js/screens/tutorials.js',
  'js/screens/settings.js'
]

// download the whole version before offering it, skipping the browser cache so nothing old sneaks in
self.addEventListener('install', event => {
  event.waitUntil(caches.open(version).then(cache => cache.addAll(files.map(file => new Request(file, { cache: 'reload' })))))
  if (developing) self.skipWaiting()
})

// the page says when the person has agreed to update
self.addEventListener('message', event => {
  if (event.data === 'update') self.skipWaiting()
})

// delete old versions, keep the screenshot reader
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== version && key !== ocrCache).map(key => caches.delete(key))))
    .then(() => self.clients.claim()))
})

async function fromNetwork(request, cacheName) {
  const response = await fetch(request.url, { cache: 'no-cache' })
  if (response.ok) {
    const copy = response.clone()
    await caches.open(cacheName).then(cache => cache.put(request, copy)).catch(() => {})
  }
  return response
}

// serve the installed version, so it all comes from one release
self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== location.origin) return

  if (url.pathname.includes('/vendor/tesseract/')) {
    event.respondWith(caches.open(ocrCache).then(cache => cache.match(request)).then(hit => hit || fromNetwork(request, ocrCache)))
    return
  }

  if (developing) {
    event.respondWith(fromNetwork(request, version).catch(() => caches.match(request, { ignoreSearch: true })))
    return
  }

  // the app is one page, so any visit to it gets this version's index.html
  const lookup = request.mode === 'navigate' && !url.pathname.endsWith('.html') ? 'index.html' : request
  event.respondWith(
    caches.open(version)
      .then(cache => cache.match(lookup, { ignoreSearch: true }))
      .then(hit => hit || fromNetwork(request, version))
  )
})

// focus the app when a reminder is clicked
self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then(windows =>
    windows.length ? windows[0].focus() : self.clients.openWindow('./#/week')
  ))
})
