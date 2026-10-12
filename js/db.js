const { ref, onUnmounted } = Vue

export const db = new Dexie('ou-study-planner')

db.version(1).stores({
  settings: 'key',
  work_pattern: 'id, weekday',
  blocked_time: 'id',
  exceptions: 'id, date',
  modules: 'id',
  assessments: 'id, module_id',
  tasks: 'id, assessment_id, module_id',
  tutorials: 'id, module_id',
  blocks: 'id, task_id'
})

// indexes for tutorials and blocks
db.version(2).stores({
  tutorials: 'id, module_id, start',
  blocks: 'id, assessment_id, task_id, start'
})

// add or update a record
export async function save(table, record) {
  // strip vue proxies before saving
  const row = JSON.parse(JSON.stringify(record))
  row.id = row.id || crypto.randomUUID()
  row.updated = Date.now()
  row.deleted = false
  await db[table].put(row)
  return row
}

// add several records in one go
export async function saveMany(table, records) {
  const now = Date.now()
  const rows = JSON.parse(JSON.stringify(records)).map(row => ({ ...row, id: row.id || crypto.randomUUID(), updated: now, deleted: false }))
  await db[table].bulkPut(rows)
  return rows
}

// soft delete so sync can pass it on
export function remove(table, ids) {
  const list = Array.isArray(ids) ? ids : [ids]
  return db[table].where('id').anyOf(list).modify({ deleted: true, updated: Date.now() })
}

export async function removeAssessment(id) {
  await remove('tasks', await db.tasks.where('assessment_id').equals(id).primaryKeys())
  await remove('blocks', await db.blocks.where('assessment_id').equals(id).primaryKeys())
  await remove('assessments', id)
}

export async function removeModule(id) {
  const assessments = await db.assessments.where('module_id').equals(id).primaryKeys()
  for (const a of assessments) await removeAssessment(a)
  await remove('tasks', await db.tasks.where('module_id').equals(id).primaryKeys())
  await remove('tutorials', await db.tutorials.where('module_id').equals(id).primaryKeys())
  await remove('modules', id)
}

export function all(table) {
  return db[table].filter(row => !row.deleted).toArray()
}

// load everything the planner needs
export async function loadAll() {
  const [pattern, exceptions, blocked, modules, assessments, tasks, tutorials, blocks] = await Promise.all(
    ['work_pattern', 'exceptions', 'blocked_time', 'modules', 'assessments', 'tasks', 'tutorials', 'blocks'].map(all)
  )
  return { pattern, exceptions, blocked, modules, assessments, tasks, tutorials, blocks }
}

// ref that updates when the query's data changes
export function live(query, initial = []) {
  const result = ref(initial)
  const sub = Dexie.liveQuery(query).subscribe(value => { result.value = value })
  onUnmounted(() => sub.unsubscribe())
  return result
}
