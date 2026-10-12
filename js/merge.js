// backup and sync file format

export const tables = ['settings', 'work_pattern', 'blocked_time', 'exceptions', 'modules', 'assessments', 'tasks', 'tutorials', 'blocks']

// per device settings, never synced
const deviceOnly = ['driveSync', 'notifications']

const keyOf = (table, row) => table === 'settings' ? row.key : row.id
const travels = (table, row) => table !== 'settings' || !deviceOnly.includes(row.key)

// all stores into one json string
export function pack(data) {
  const out = {}
  for (const table of tables) out[table] = (data[table] || []).filter(row => travels(table, row))
  return JSON.stringify({ app: 'ou-study-planner', format: 1, saved: new Date().toISOString(), data: out })
}

// read a backup or sync file
export function unpack(text) {
  let file
  try {
    file = JSON.parse(text)
  } catch {
    throw new Error(`That file isn't a study planner backup.`)
  }
  if (file?.app !== 'ou-study-planner' || !file.data) throw new Error(`That file isn't a study planner backup.`)
  if (file.format > 1) throw new Error('That backup is from a newer version of the app. Update the app and try again.')

  const data = {}
  for (const table of tables) data[table] = Array.isArray(file.data[table]) ? file.data[table] : []
  return data
}

// newest copy of each record wins
export function mergeData(local, remote) {
  const merged = {}
  const toLocal = {}
  let remoteChanged = false

  for (const table of tables) {
    const mine = new Map((local[table] || []).map(row => [keyOf(table, row), row]))
    const theirs = new Map((remote[table] || []).filter(row => travels(table, row)).map(row => [keyOf(table, row), row]))
    const rows = new Map(mine)
    toLocal[table] = []

    for (const [key, row] of theirs) {
      const own = mine.get(key)
      if (!own || (row.updated || 0) > (own.updated || 0)) {
        rows.set(key, row)
        toLocal[table].push(row)
      }
    }

    // check if drive is missing anything from here
    for (const [key, row] of mine) {
      if (!travels(table, row)) continue
      const other = theirs.get(key)
      if (!other || (row.updated || 0) > (other.updated || 0)) remoteChanged = true
    }

    merged[table] = [...rows.values()]
  }

  return { merged, toLocal, remoteChanged }
}

// read, merge, write back if needed
export async function syncWith(drive, local) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const remote = await drive.read()
    const result = mergeData(local, remote ? unpack(remote.text) : {})
    if (remote && !result.remoteChanged) return result

    // write fails if drive changed since the read, try again
    if (await drive.write(pack(result.merged), remote?.version)) return result
  }
  throw new Error('The Drive copy kept changing. Sync will try again shortly.')
}
