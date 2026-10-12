import { db } from './db.js'
import { tables, pack, unpack, mergeData } from './merge.js'
import { settings, loadSettings } from './settings.js'
import { dateKey } from './time.js'

// all stores, including deleted records
export async function exportData() {
  const data = {}
  for (const table of tables) data[table] = await db[table].toArray()
  return data
}

// save text as a file
export function downloadFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function downloadBackup() {
  const name = `study-planner-backup-${dateKey(new Date(), settings.timeZone)}.json`
  downloadFile(name, pack(await exportData()), 'application/json')
}

// write records without touching their updated times
export async function applyRecords(records) {
  const changed = tables.filter(table => records[table]?.length)
  if (!changed.length) return

  await db.transaction('rw', changed.map(table => db[table]), async () => {
    for (const table of changed) await db[table].bulkPut(records[table])
  })
  await loadSettings()
}

// merge keeps the newest of each record, replace matches the file
export async function restoreBackup(text, mode) {
  const incoming = unpack(text)

  if (mode === 'merge') {
    const { toLocal } = mergeData(await exportData(), incoming)
    await applyRecords(toLocal)
    return
  }

  // mark as updated now so the restore beats older synced copies
  const now = Date.now()
  const records = {}
  for (const table of tables) {
    const keep = incoming[table].map(row => ({ ...row, updated: now }))
    if (table === 'settings') {
      records[table] = keep
      continue
    }

    // delete anything not in the file
    const ids = new Set(keep.map(row => row.id))
    const gone = (await db[table].toArray())
      .filter(row => !ids.has(row.id) && !row.deleted)
      .map(row => ({ ...row, deleted: true, updated: now }))
    records[table] = [...keep, ...gone]
  }
  await applyRecords(records)
}
