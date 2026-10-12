import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pack, unpack, mergeData, syncWith } from '../js/merge.js'

const row = (id, updated, extra = {}) => ({ id, updated, deleted: false, ...extra })

test('the newer copy of a record wins either way', () => {
  const local = { modules: [row('a', 5, { code: 'NEW' }), row('b', 1, { code: 'OLD' })] }
  const remote = { modules: [row('a', 3, { code: 'OLD' }), row('b', 4, { code: 'NEW' })] }
  const { merged, toLocal, remoteChanged } = mergeData(local, remote)

  assert.deepEqual(merged.modules.map(m => m.code), ['NEW', 'NEW'])
  assert.deepEqual(toLocal.modules.map(m => m.id), ['b'])
  assert.equal(remoteChanged, true)
})

test('a delete on one device carries to the other', () => {
  const local = { tasks: [row('t', 1)] }
  const remote = { tasks: [row('t', 2, { deleted: true })] }
  const { merged, toLocal } = mergeData(local, remote)
  assert.equal(merged.tasks[0].deleted, true)
  assert.equal(toLocal.tasks.length, 1)
})

test('records on only one side are kept', () => {
  const { merged, toLocal, remoteChanged } = mergeData({ blocks: [row('mine', 1)] }, { blocks: [row('theirs', 1)] })
  assert.deepEqual(merged.blocks.map(b => b.id).sort(), ['mine', 'theirs'])
  assert.deepEqual(toLocal.blocks.map(b => b.id), ['theirs'])
  assert.equal(remoteChanged, true)
})

test('identical copies need no writing', () => {
  const data = { modules: [row('a', 1)], settings: [{ key: 'theme', value: 'dark', updated: 1 }] }
  const { toLocal, remoteChanged } = mergeData(data, data)
  assert.equal(remoteChanged, false)
  assert.equal(toLocal.modules.length, 0)
})

test('device settings never travel', () => {
  const local = { settings: [{ key: 'driveSync', value: true, updated: 9 }] }
  const remote = { settings: [{ key: 'notifications', value: true, updated: 9 }] }
  const { toLocal, remoteChanged } = mergeData(local, remote)
  assert.equal(toLocal.settings.length, 0)
  assert.equal(remoteChanged, false)
  assert.equal(JSON.parse(pack(local)).data.settings.length, 0)
})

test('backup files round trip and strangers are refused', () => {
  const data = unpack(pack({ modules: [row('a', 1)] }))
  assert.equal(data.modules[0].id, 'a')
  assert.deepEqual(data.tasks, [])
  assert.throws(() => unpack('{"hello":1}'), /isn't a study planner backup/)
  assert.throws(() => unpack('not json'), /isn't a study planner backup/)
})

// fake drive that can change between read and write
function fakeDrive(start) {
  return {
    text: start ? pack(start) : null,
    version: 1,
    writes: 0,
    meddle: null,
    async read() {
      return this.text ? { text: this.text, version: this.version } : null
    },
    async write(text, version) {
      if (this.meddle) { this.meddle(); this.meddle = null }
      if (this.text && version !== this.version) return false
      this.text = text
      this.version++
      this.writes++
      return true
    }
  }
}

test('first sync creates the drive copy', async () => {
  const drive = fakeDrive(null)
  await syncWith(drive, { modules: [row('a', 1)] })
  assert.equal(unpack(drive.text).modules[0].id, 'a')
})

test('sync merges again if another device saved in between', async () => {
  const drive = fakeDrive({ modules: [row('a', 1)] })
  drive.meddle = () => {
    drive.text = pack({ modules: [row('a', 1), row('phone', 5)] })
    drive.version++
  }
  const result = await syncWith(drive, { modules: [row('a', 1), row('pc', 4)] })

  assert.deepEqual(unpack(drive.text).modules.map(m => m.id).sort(), ['a', 'pc', 'phone'])
  assert.deepEqual(result.toLocal.modules.map(m => m.id), ['phone'])
})

test('nothing is written when nothing changed', async () => {
  const drive = fakeDrive({ modules: [row('a', 1)] })
  await syncWith(drive, { modules: [row('a', 1)] })
  assert.equal(drive.writes, 0)
})
