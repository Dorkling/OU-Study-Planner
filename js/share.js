// module dates to share, no personal data

export function packModule(module, assessments) {
  return JSON.stringify({
    app: 'ou-study-planner',
    kind: 'module',
    format: 1,
    module: { code: module.code, title: module.title, credits: module.credits, start: module.start, end: module.end },
    assessments: assessments
      .filter(a => !a.deleted)
      .map(a => ({ type: a.type, title: a.title, due: a.due, weight: a.weight ?? null, provisional: Boolean(a.provisional) }))
  }, null, 2)
}

export function unpackModule(text) {
  let file
  try {
    file = JSON.parse(text)
  } catch {
    throw new Error(`That file isn't a shared module.`)
  }
  if (file?.app !== 'ou-study-planner' || file.kind !== 'module' || !file.module?.code) throw new Error(`That file isn't a shared module.`)
  return { module: file.module, assessments: Array.isArray(file.assessments) ? file.assessments : [] }
}

// add a new module or update dates, matching assessments by title
export function mergeModule(shared, modules, assessments) {
  const existing = modules.find(m => !m.deleted && m.code === shared.module.code)
  const module = existing || { ...shared.module, mode_override: '' }
  const saves = []
  let added = 0
  let updated = 0

  for (const incoming of shared.assessments) {
    const match = existing && assessments.find(a => !a.deleted && a.module_id === existing.id && a.title.toLowerCase() === incoming.title.toLowerCase())
    if (!match) {
      saves.push({ ...incoming })
      added++
    } else if (match.due !== incoming.due || Boolean(match.provisional) !== incoming.provisional) {
      // don't swap a confirmed date for a rough one
      if (!match.provisional && incoming.provisional) continue
      saves.push({ ...match, due: incoming.due, provisional: incoming.provisional })
      updated++
    }
  }

  return { module, isNew: !existing, assessments: saves, added, updated }
}
