const { reactive } = Vue

// ready means a new version has downloaded and is waiting for a yes
export const update = reactive({ ready: false, later: false, accepted: false })

let registration

function watch(reg) {
  registration = reg
  if (reg.waiting && navigator.serviceWorker.controller) update.ready = true
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) update.ready = true
    })
  })
}

export async function startUpdates() {
  if (!('serviceWorker' in navigator)) return
  const reg = await navigator.serviceWorker.register('sw.js')
  watch(reg)

  // check for a new version every hour while the app is open
  setInterval(() => reg.update(), 60 * 60000)

  // once the new version takes over, load it, but only if the person asked for it
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !update.accepted) return
    reloading = true
    location.reload()
  })
}

export function applyUpdate() {
  update.accepted = true
  registration?.waiting?.postMessage('update')
}
