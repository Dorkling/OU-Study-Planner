import { remove, restore } from './db.js'

const { reactive } = Vue

// the last thing removed, offered back for a few seconds
export const undo = reactive({ text: '', steps: null })

let timer

export function clearUndo() {
  clearTimeout(timer)
  undo.text = ''
  undo.steps = null
}

// steps say what to bring back and what to take out again, each as [table, ids]
export function offerUndo(text, steps) {
  clearUndo()
  undo.text = text
  undo.steps = steps
  timer = setTimeout(clearUndo, 8000)
}

export async function undoLast() {
  const steps = undo.steps
  clearUndo()
  if (!steps) return
  for (const [table, ids] of steps.remove || []) await remove(table, ids)
  for (const [table, ids] of steps.restore || []) await restore(table, ids)
}

// remove one record and offer it back
export async function removeWithUndo(table, id, text) {
  await remove(table, id)
  offerUndo(text, { restore: [[table, [id]]] })
}
