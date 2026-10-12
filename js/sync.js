import { settings, saveSetting } from './settings.js'
import { exportData, applyRecords, copyOnto } from './backup.js'
import { syncWith, unpack, tables } from './merge.js'
import { driveAvailable, savedToken, forgetToken, signIn, driveClient } from './drive.js'

const { reactive } = Vue

// status: off, waiting, syncing, signed-out or error
// choosing means drive and this device both have a plan and the user picks which to keep
export const syncState = reactive({ status: 'off', message: '', last: null, choice: null })

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

const modulesIn = data => data.modules.filter(m => !m.deleted).length
const hasData = data => tables.some(table => table !== 'settings' && data[table].some(row => !row.deleted))

// must be called from a click
// a device joining a plan already in drive takes the drive copy, or asks first if it has its own plan too
export async function connectDrive() {
  const token = await signIn()
  const remote = await driveClient(token).read()
  const drive = remote && unpack(remote.text)

  if (drive && hasData(drive)) {
    const local = await exportData()
    if (hasData(local)) {
      syncState.status = 'choosing'
      syncState.choice = { driveModules: modulesIn(drive), localModules: modulesIn(local) }
      return
    }
    await copyOnto(drive)
  }
  await turnOn()
}

async function turnOn() {
  syncState.choice = null
  await saveSetting('driveSync', true)
  startSync()
}

// replace this device with what's in drive, then carry on syncing as normal
export async function useDriveCopy() {
  const remote = await driveClient(savedToken()).read()
  if (remote) await copyOnto(unpack(remote.text))
  await turnOn()
}

// keep both, newest change of each record wins
export const combineWithDrive = turnOn

export function cancelConnect() {
  syncState.choice = null
  syncState.status = 'off'
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
