import { googleClientId } from './config.js'

const scope = 'https://www.googleapis.com/auth/drive.file'
const files = 'https://www.googleapis.com/drive/v3/files'
const uploads = 'https://www.googleapis.com/upload/drive/v3/files'
const folderName = 'OU Study Planner'
const fileName = 'study-planner.json'

export const driveAvailable = () => Boolean(googleClientId)

// last token if it has over a minute left
export function savedToken() {
  try {
    const saved = JSON.parse(localStorage.getItem('drive-token'))
    if (saved?.expires > Date.now() + 60000) return saved.token
  } catch {}
  return null
}

export function forgetToken() {
  localStorage.removeItem('drive-token')
  localStorage.removeItem('drive-file')
}

// google popup sign in, oauth.html sends the token back through localStorage
export function signIn() {
  return new Promise((resolve, reject) => {
    const state = crypto.randomUUID()
    localStorage.setItem('drive-state', state)
    localStorage.removeItem('drive-result')

    const params = new URLSearchParams({
      client_id: googleClientId,
      redirect_uri: new URL('oauth.html', location.href).href,
      response_type: 'token',
      scope,
      include_granted_scopes: 'true',
      state
    })

    const popup = window.open(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 'google-sign-in', 'width=500,height=650')
    if (!popup) return reject(new Error('The sign in window was blocked. Allow pop-ups for this site and try again.'))

    // give up after 5 minutes
    const timeout = setTimeout(() => finish(new Error('Sign in took too long. Try again.')), 300000)

    function finish(error, token) {
      clearTimeout(timeout)
      window.removeEventListener('storage', heard)
      localStorage.removeItem('drive-result')
      if (error) reject(error)
      else resolve(token)
    }

    function heard(event) {
      if (event.key !== 'drive-result' || !event.newValue) return
      // ignore results from other sign in attempts
      const result = JSON.parse(event.newValue)
      if (result.state !== state) return
      if (!result.token) return finish(new Error(result.error === 'access_denied' ? `Google Drive access wasn't allowed.` : `Google sign in didn't finish.`))

      localStorage.setItem('drive-token', JSON.stringify({ token: result.token, expires: Date.now() + result.expiresIn * 1000 }))
      finish(null, result.token)
    }

    window.addEventListener('storage', heard)
  })
}

// drive request with readable errors
async function call(token, url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers } })
  if (response.status === 401) throw Object.assign(new Error('Google sign in has expired.'), { expired: true })
  if (!response.ok) throw new Error(`Google Drive couldn't be reached (error ${response.status}).`)
  return response
}

// drive.file only shows files the app made
async function findId(token, query) {
  const url = `${files}?q=${encodeURIComponent(`${query} and trashed=false`)}&fields=files(id)&spaces=drive`
  const { files: found } = await (await call(token, url)).json()
  return found[0]?.id || null
}

// read and write the sync file in the OU Study Planner folder
export function driveClient(token) {
  async function folderId() {
    const found = await findId(token, `name='${folderName}' and mimeType='application/vnd.google-apps.folder'`)
    if (found) return found
    const response = await call(token, `${files}?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder' })
    })
    return (await response.json()).id
  }

  // file id and version, null if missing
  async function locate() {
    const remembered = localStorage.getItem('drive-file')
    if (remembered) {
      const response = await fetch(`${files}/${remembered}?fields=id,version,trashed`, { headers: { Authorization: `Bearer ${token}` } })
      if (response.status === 401) throw Object.assign(new Error('Google sign in has expired.'), { expired: true })
      if (response.ok) {
        const meta = await response.json()
        if (!meta.trashed) return meta
      }
    }

    // not found by id, search for it
    const id = await findId(token, `name='${fileName}' and '${await folderId()}' in parents`)
    if (!id) return null
    localStorage.setItem('drive-file', id)
    return (await call(token, `${files}/${id}?fields=id,version`)).json()
  }

  return {
    async read() {
      const meta = await locate()
      if (!meta) return null
      const text = await (await call(token, `${files}/${meta.id}?alt=media`)).text()
      return { text, version: meta.version }
    },

    // false if another device saved first
    async write(text, version) {
      const meta = await locate()
      if (meta && meta.version !== version) return false

      if (meta) {
        await call(token, `${uploads}/${meta.id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text })
        return true
      }

      // create the file
      const boundary = `study-planner-${crypto.randomUUID()}`
      const details = JSON.stringify({ name: fileName, parents: [await folderId()], mimeType: 'application/json' })
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${details}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`
      const response = await call(token, `${uploads}?uploadType=multipart&fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body
      })
      localStorage.setItem('drive-file', (await response.json()).id)
      return true
    }
  }
}
