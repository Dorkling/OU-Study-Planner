import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// fake localStorage and google drive
const store = new Map()
globalThis.localStorage = {
  getItem: key => store.has(key) ? store.get(key) : null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key)
}

let drive
function resetDrive() {
  drive = { files: new Map(), nextId: 1, requests: [] }
}

const reply = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })

globalThis.fetch = async (url, options = {}) => {
  const u = new URL(url)
  const method = options.method || 'GET'
  drive.requests.push(`${method} ${u.pathname}`)
  if (options.headers?.Authorization !== 'Bearer good') return reply(401, {})

  const id = u.pathname.split('/files/')[1]

  // search by name and parent, skip binned files
  if (method === 'GET' && !id) {
    const q = u.searchParams.get('q')
    const name = q.match(/name='([^']+)'/)[1]
    const parent = q.match(/'([^']+)' in parents/)?.[1]
    const found = [...drive.files.values()].filter(f => f.name === name && !f.trashed && (!parent || f.parent === parent))
    return reply(200, { files: found.map(f => ({ id: f.id })) })
  }

  if (method === 'GET' && u.searchParams.get('alt') === 'media') return reply(200, drive.files.get(id).content)

  if (method === 'GET') {
    const file = drive.files.get(id)
    return file ? reply(200, { id, version: String(file.version), trashed: file.trashed }) : reply(404, {})
  }

  // new folder
  if (method === 'POST' && !u.pathname.startsWith('/upload')) {
    const meta = JSON.parse(options.body)
    const folder = { id: `f${drive.nextId++}`, name: meta.name, version: 1, trashed: false }
    drive.files.set(folder.id, folder)
    return reply(200, { id: folder.id })
  }

  // new file, metadata and content in one multipart body
  if (method === 'POST') {
    const parts = options.body.split(/--study-planner-[^\r\n]+/)
    const meta = JSON.parse(parts[1].split('\r\n\r\n')[1])
    const content = parts[2].split('\r\n\r\n')[1].replace(/\r\n$/, '')
    const file = { id: `d${drive.nextId++}`, name: meta.name, parent: meta.parents[0], content, version: 1, trashed: false }
    drive.files.set(file.id, file)
    return reply(200, { id: file.id })
  }

  if (method === 'PATCH') {
    const file = drive.files.get(id)
    file.content = options.body
    file.version++
    return reply(200, { id })
  }
}

const { driveClient } = await import('../js/drive.js')
const { syncWith, unpack } = await import('../js/merge.js')

beforeEach(() => {
  store.clear()
  resetDrive()
})

const syncFile = () => [...drive.files.values()].find(f => f.name === 'study-planner.json' && !f.trashed)

test('first write makes the folder and the file inside it', async () => {
  const client = driveClient('good')
  assert.equal(await client.read(), null)
  assert.equal(await client.write('{"hello":1}', undefined), true)

  const folder = [...drive.files.values()].find(f => f.name === 'OU Study Planner')
  assert.equal(syncFile().parent, folder.id)
  assert.equal(syncFile().content, '{"hello":1}')
})

test('reads give the content and version, and stale writes are refused', async () => {
  const client = driveClient('good')
  await client.write('one', undefined)
  const first = await client.read()
  assert.deepEqual(first, { text: 'one', version: '1' })

  // another device saves in between
  syncFile().content = 'two'
  syncFile().version = 2

  assert.equal(await client.write('mine', first.version), false)
  assert.equal(await client.write('mine', '2'), true)
  assert.equal(syncFile().content, 'mine')
})

test('a binned sync file is made again', async () => {
  const client = driveClient('good')
  await client.write('one', undefined)
  syncFile().trashed = true

  assert.equal(await client.read(), null)
  assert.equal(await client.write('again', undefined), true)
  assert.equal(syncFile().content, 'again')
  assert.equal([...drive.files.values()].filter(f => f.name === 'OU Study Planner').length, 1)
})

test('an expired token is reported so the app can ask to reconnect', async () => {
  await assert.rejects(driveClient('old').read(), error => error.expired === true)
})

test('two devices end up with the same data', async () => {
  const pc = { modules: [{ id: 'pc', updated: 1 }] }
  const phone = { modules: [{ id: 'phone', updated: 2 }] }

  await syncWith(driveClient('good'), pc)
  const result = await syncWith(driveClient('good'), phone)

  assert.deepEqual(result.toLocal.modules.map(m => m.id), ['pc'])
  assert.deepEqual(unpack(syncFile().content).modules.map(m => m.id).sort(), ['pc', 'phone'])
})
