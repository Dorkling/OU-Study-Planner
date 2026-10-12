// labels on the ou booking confirmation page
const labels = {
  date: 'tutorial date',
  type: 'tutorial type',
  start: 'start time',
  end: 'end time',
  title: 'tutorial title',
  contact: 'tutorial contact'
}

const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

// find each label and take the text up to the next one
function findValues(text) {
  const lower = text.toLowerCase()
  const found = Object.entries(labels)
    .map(([key, label]) => ({ key, at: lower.indexOf(label), length: label.length }))
    .filter(f => f.at >= 0)
    .sort((a, b) => a.at - b.at)

  const values = {}
  found.forEach((f, i) => {
    const end = found[i + 1]?.at ?? text.length
    values[f.key] = text.slice(f.at + f.length, end).replace(/^[\s:]+/, '')
  })
  return values
}

// first non-empty line
function firstLine(value = '') {
  return value.split('\n').map(line => line.trim()).find(Boolean) || ''
}

// date like 2 november 2026, drop the weekday
export function parseDate(value) {
  const match = value.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,})\.?\s+(\d{4})/i)
  if (!match) return ''
  const month = months.indexOf(match[2].slice(0, 3).toLowerCase())
  if (month < 0) return ''
  return `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`
}

// times as hh:mm, ocr can read : as .
export function parseTime(value) {
  const match = value.match(/(\d{1,2})[:.](\d{2})/)
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : ''
}

// [Recorded ...] means recorded, [Not Recorded ...] means live only
export function parseRecorded(title) {
  if (/\[\s*not\s+recorded/i.test(title)) return false
  if (/\[\s*recorded/i.test(title)) return true
  return null
}

// module code like SM380 from breadcrumb or url
export function parseModule(text) {
  const match = text.match(/tutorials for\s+([a-z]{1,3}\d{3})/i) || text.match(/\b([A-Z]{1,3}\d{3})\b/)
  return match ? match[1].toUpperCase() : ''
}

// pasted page to form fields
export function parseTutorial(text) {
  const values = findValues(text)
  const rawTitle = (values.title || '').split('\n').map(l => l.trim()).filter(Boolean).join(' ')

  return {
    module: parseModule(text),
    date: parseDate(firstLine(values.date)),
    type: /face/i.test(firstLine(values.type)) ? 'face-to-face' : 'online',
    start: parseTime(firstLine(values.start)),
    end: parseTime(firstLine(values.end)),
    title: rawTitle.replace(/\s*\[[^\]]*recorded[^\]]*\]\s*/i, ' ').trim(),
    recorded: parseRecorded(rawTitle),
    tutors: firstLine(values.contact).split(',').map(t => t.trim()).filter(Boolean)
  }
}

// skip if module, date, start and title already saved
export function isDuplicate(tutorial, saved) {
  return saved.some(t =>
    t.module_id === tutorial.module_id &&
    t.start === tutorial.start &&
    t.title.toLowerCase() === tutorial.title.toLowerCase()
  )
}
