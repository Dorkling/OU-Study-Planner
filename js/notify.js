import { all } from './db.js'
import { settings, saveSetting } from './settings.js'
import { clockTime } from './time.js'

let timer

// reminders already shown, kept across reloads
function shownBefore() {
  try {
    return new Set(JSON.parse(localStorage.getItem('reminded')) || [])
  } catch {
    return new Set()
  }
}

function remember(shown) {
  try { localStorage.setItem('reminded', JSON.stringify([...shown].slice(-200))) } catch {}
}

export const canNotify = () => 'Notification' in window

// needs a click for the permission prompt
export async function turnOnReminders() {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return false
  await saveSetting('notifications', true)
  startReminders()
  return true
}

export async function turnOffReminders() {
  await saveSetting('notifications', false)
  startReminders()
}

// check every 30 seconds while open
export function startReminders() {
  clearInterval(timer)
  if (!settings.notifications || !canNotify() || Notification.permission !== 'granted') return
  check()
  timer = setInterval(check, 30000)
}

async function check() {
  const now = Date.now()
  const soon = now + settings.notifyBefore * 60000
  const shown = shownBefore()

  const [blocks, tutorials, modules, assessments] = await Promise.all([all('blocks'), all('tutorials'), all('modules'), all('assessments')])
  const code = id => modules.find(m => m.id === id)?.code || ''
  const title = b => b.assessment_id ? `${code(b.module_id)} ${assessments.find(a => a.id === b.assessment_id)?.title || ''}` : `${code(b.module_id)} study`

  const upcoming = [
    ...blocks.filter(b => b.state === 'accepted').map(b => ({ id: b.id, start: b.start, title: title(b) })),
    ...tutorials.map(t => ({ id: t.id, start: t.start, title: `${code(t.module_id)} tutorial: ${t.title}` }))
  ]

  for (const item of upcoming) {
    const start = new Date(item.start)
    const key = `${item.id}@${item.start}`
    if (start <= now || start > soon || shown.has(key)) continue

    await show(item.title, `Starts at ${clockTime(start, settings.timeZone)}`, item.id)
    shown.add(key)
  }
  remember(shown)
}

// use the service worker if there is one
async function show(title, body, tag) {
  const options = { body, tag, icon: 'icons/icon-192.png' }
  const worker = await navigator.serviceWorker?.getRegistration()
  if (worker) worker.showNotification(title, options)
  else new Notification(title, options)
}
