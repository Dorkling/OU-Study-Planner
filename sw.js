// bump when files change
const version = 'v14'

const files = [
  './',
  'index.html',
  'oauth.html',
  'privacy.html',
  'manifest.json',
  'css/theme.css',
  'css/app.css',
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

self.addEventListener('install', event => {
  // skip the browser cache so a new version never installs old files
  event.waitUntil(caches.open(version).then(cache => cache.addAll(files.map(file => new Request(file, { cache: 'reload' })))))
  self.skipWaiting()
})

// delete old caches
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(key => key !== version).map(key => caches.delete(key)))
  ))
  self.clients.claim()
})

// network first, cache when offline
// no-cache asks the server if each file changed, so an upload never mixes old and new files
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== location.origin) return

  event.respondWith(
    fetch(event.request.url, { cache: 'no-cache' })
      .then(response => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(version).then(cache => cache.put(event.request, copy))
        }
        return response
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  )
})

// focus the app when a reminder is clicked
self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then(windows =>
    windows.length ? windows[0].focus() : self.clients.openWindow('./#/week')
  ))
})
