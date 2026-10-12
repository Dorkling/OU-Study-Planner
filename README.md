# OU Study Planner

I made this to fit Open University study around shift work. You put in your shifts, modules and deadlines, and it shows the free time you've got left and plans study into it.

It runs in the browser with no server or accounts. Your data stays on your device, and in your own Google Drive if you turn on sync.

Not affiliated with or endorsed by The Open University.

## Features

- Weekly study hours worked out from each module's credits (the OU guide is about 10 hours per credit)
- Plans study around work, travel time, tutorials and anything else you block out, either as suggestions or straight into your week
- Spreads TMA work up to a few days before the deadline and warns you if it won't fit
- Add tutorials by pasting the booking confirmation page or from a screenshot
- Missed tutorials that were recorded get added as a "watch recording" task
- Calendar export for Google or Apple Calendar, and reminders on Windows
- Share a module's dates with classmates
- Works offline, light and dark mode, and any time zone (UK by default)

## Installing

Open the site in your browser, then:

- Windows: in Edge or Chrome choose Install from the address bar or menu. It then works like a normal app with its own window and Start menu entry. If you want reminders without opening it each day, set it to start when you sign in from the app's menu.
- Android: in Chrome open the menu and choose Install app.
- iPhone: in Safari tap Share, then Add to Home Screen. Open it from the home screen icon so iOS keeps your data.

To use it on more than one device, either turn on Google Drive sync in Settings or download a backup on one device and restore it on the other.

Phones pause web apps in the background, so reminders won't work there. Use Add to calendar on the Week screen instead and import the file into a calendar called Study Planner.

## Running your own copy

It's plain HTML, CSS and JavaScript with no build step, so any static host works.

1. Fork this repo
2. Turn on GitHub Pages for the main branch in the repo settings
3. Open `https://<your-username>.github.io/ou-study-planner/`

Everything works except Drive sync, which needs a Google client ID for your address. You can skip it and use backups, or set one up:

1. In the Google Cloud console, create a project and enable the Google Drive API
2. Set up the OAuth consent screen with the `drive.file` scope, adding `privacy.html` as the privacy policy and your Pages address as the home page
3. Create an OAuth client ID (Web application). Add your Pages domain as an authorised JavaScript origin and `oauth.html` on your address as a redirect URI
4. Put the client ID in `js/config.js`
5. Publish the consent screen, or add yourself as a test user while trying it out

The client ID is meant to be public so it's fine in the code.

## Development

Serve the folder with any static server, for example:

```
python -m http.server 8471
```

and open `http://localhost:8471`. For sync to work locally, add `http://localhost:8471` and `http://localhost:8471/oauth.html` to your Google client.

The planner, parser, time zone, sync and calendar code have tests that run in Node 22 or later, nothing to install:

```
node --test
```

## Libraries

These are saved in `vendor/` so the app works offline:

- [Vue](https://vuejs.org) 3.5.13 (MIT)
- [FullCalendar](https://fullcalendar.io) 6.1.15 (MIT)
- [Dexie](https://dexie.org) 4.0.10 (Apache 2.0)
- [Tesseract.js](https://tesseract.projectnaptha.com) 5.1.1 with English data (Apache 2.0), only loaded when reading a screenshot

## Licence

MIT, see `LICENSE`.
