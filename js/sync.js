import { settings, saveSetting } from './settings.js'
import { exportData, applyRecords } from './backup.js'
import { syncWith } from './merge.js'
import { driveAvailable, savedToken, forgetToken, signIn, driveClient } from './drive.js'

const { reactive } = Vue

// status: off, waiting, syncing, signed-out or error
export const syncState = reactive({ status: 'off', message: '', last: null })

let running = false
let changeTimer
let everyFewMinutes
let quietUntil = 0

export async function syncNow() {
  if (!settings.driveSync || !driveAvailable() || running) return

  const token = savedToken()
  if (!token) {
    syncState.status = 'signed-out'
    return
  }

  running = true
  syncState.status = 'syncing'
  try {
    const result = await syncWith(driveClient(token), await exportData())

    // ignore our own writes for a few seconds
    quietUntil = Date.now() + 3000
    await applyRecords(result.toLocal)

    syncState.status = 'waiting'
    syncState.message = ''
    syncState.last = new Date()
  } catch (error) {
    if (error.expired) {
      localStorage.removeItem('drive-token')
      syncState.status = 'signed-out'
    } else {
      syncState.status = 'error'
      syncState.message = navigator.onLine ? error.message : 'Offline. Changes will sync when you are back online.'
    }
  } finally {
    running = false
  }
}

// sync on start and every 5 minutes
export function startSync() {
  clearInterval(everyFewMinutes)
  if (!settings.driveSync || !driveAvailable()) {
    syncState.status = 'off'
    return
  }
  syncNow()
  everyFewMinutes = setInterval(syncNow, 5 * 60000)
}

// must be called from a click
export async function connectDrive() {
  await signIn()
  await saveSetting('driveSync', true)
  startSync()
}

export async function reconnectDrive() {
  await signIn()
  syncNow()
}

export async function disconnectDrive() {
  await saveSetting('driveSync', false)
  forgetToken()
  startSync()
}

// sync 5 seconds after a change
Dexie.on('storagemutated', () => {
  if (!settings.driveSync || Date.now() < quietUntil) return
  clearTimeout(changeTimer)
  changeTimer = setTimeout(syncNow, 5000)
})

window.addEventListener('online', syncNow)
