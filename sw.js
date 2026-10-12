// bump when files change
const version = 'v5'

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
  'js/screens/setup.js',
  'js/screens/today.js',
  'js/screens/week.js',
  'js/screens/modules.js',
  'js/screens/assessment.js',
  'js/screens/tutorials.js',
  'js/screens/settings.js'
]

self.addEventListener('install', event => {
  event.waitUntil(caches.open(version).then(cache => cache.addAll(files)))
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
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== location.origin) return

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone()
        caches.open(version).then(cache => cache.put(event.request, copy))
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
