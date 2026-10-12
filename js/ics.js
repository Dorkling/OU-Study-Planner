import { dateKey, addDaysToKey } from './time.js'

const encoder = new TextEncoder()

// utc time like 20261012T180000Z
const utc = date => new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

// escape commas, semicolons and new lines
const escape = text => String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

// split lines over 75 bytes
function fold(line) {
  const lines = []
  let current = ''
  for (const ch of line) {
    const limit = lines.length ? 74 : 75
    if (encoder.encode(current + ch).length > limit) {
      lines.push(current)
      current = ''
    }
    current += ch
  }
  lines.push(current)
  return lines.join('\r\n ')
}

// events to export, labels come from the caller
export function calendarEvents(data, settings, from, to, labels) {
  const zone = settings.timeZone
  const inRange = item => new Date(item.end || item.due) > from && new Date(item.start || item.due) < to
  const events = []

  for (const b of data.blocks.filter(b => b.state === 'accepted' && inRange(b))) {
    events.push({ uid: b.id, title: labels.block(b), start: b.start, end: b.end, alarm: settings.notifyBefore })
  }

  for (const t of data.tutorials.filter(inRange)) {
    events.push({ uid: t.id, title: labels.tutorial(t), start: t.start, end: t.end, alarm: settings.notifyBefore, description: t.tutors.join(', ') })
  }

  // deadlines as all day events
  for (const a of data.assessments.filter(inRange)) {
    const key = dateKey(new Date(a.due), zone)
    events.push({ uid: `${a.id}-due`, title: labels.due(a), day: key })
  }

  return events
}

// build the .ics file
export function buildCalendar(events, now = new Date()) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OU Study Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Study Planner'
  ]

  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}@ou-study-planner`, `DTSTAMP:${utc(now)}`, `SUMMARY:${escape(e.title)}`)

    if (e.day) {
      lines.push(`DTSTART;VALUE=DATE:${e.day.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDaysToKey(e.day, 1).replace(/-/g, '')}`)
    } else {
      lines.push(`DTSTART:${utc(e.start)}`, `DTEND:${utc(e.end)}`)
    }

    if (e.description) lines.push(`DESCRIPTION:${escape(e.description)}`)

    // apple uses this, google ignores it
    if (e.alarm) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escape(e.title)}`, `TRIGGER:-PT${e.alarm}M`, 'END:VALARM')

    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
