# Hybrid Athlete Tracker & Ducky Coach

A phone-first training log for your 16-week hybrid program (lifting, Zone 2 running, sprints, BJJ), built as an installable web app (PWA). It logs sets Hevy-style, runs the rest timer, sets your weights from your 1RMs and keeps them up to date from what you actually lift, coaches your Zone 2 runs live from a heart-rate sensor, keeps your schedule in two-way sync with Google Calendar, and has an on-demand AI coach called Ducky.

There is no build step for the app itself (the single-file page below is an optional one), no backend and no account. Everything runs in the browser and is stored on your device.

## The flat layout (read this first)

**Every file sits side by side in one folder. There are no subfolders.** Upload all of them together to the root of your GitHub repository (or any static host) and the links between them already match: `index.html` loads `styles.css`, `fonts.css`, `guard.js`, `spec.js`, `engine.js` and the other scripts by plain file name, the manifest points at `icon-192.png` and its siblings, and the service worker caches the same names.

- **`index.html` is the app.** Open that one (on GitHub Pages: `https://<you>.github.io/<repo>/`). It needs the other files next to it.
- **`index-single.html` is an optional alternative:** the whole app in one file (see below). You do not need it if you upload everything. If you want to use it instead, rename it to `index.html` (and `sw-single.js` to `sw.js`).
- `program.json` is the 16-week plan as plain data. The app itself reads the same plan from `spec.js`; the build and the tests check that the two are identical.
- `*.test.js`, `build-single.js`, `gcal-off.js` and `fake-gcal.js` are for developers. The app does not load them, so uploading them is harmless.
- The file list is in *Project layout* at the end.


## The single-file page (`index-single.html`)

**Two editions.** `node build-single.js` builds the **safe edition** (`index-single.html`). It has no Google sign-in and no sync: nothing is loaded from anywhere except the file itself, and the only site it ever talks to is Google Gemini, when you ask Ducky, with your own key. Calendar export is the `.ics` file plus a one-tap *Add to Google Calendar* link on each session. Its Content-Security-Policy does not pin scripts by hash, so a file that was re-saved or changed by a host still starts. `node build-single.js --full` builds the **full edition** (`index-single-full.html`) with Google sign-in and two-way Calendar sync (section below), and pins every script by hash. Everything after this heading applies to both unless noted.

**If something goes wrong anyway**, the app does not go blank: a screen that cannot be drawn shows a message with a *Reload* button, a failing tap or stray error shows a short notice and leaves your data alone, and if the app cannot start at all, an explanation (with the technical detail) replaces the black page.

`index-single.html` is the whole app in one file: styles, the font, icons, all 16 JavaScript modules (the Google module is a do-nothing stand-in in the safe edition), the 16-week program data and a web app manifest (a `data:` URL in the page head, with the icons inside it). Nothing else is needed to run it.

```bash
node build-single.js      # rebuilds index-single.html (and sw-single.js) from the loose source files
```

**The service worker is the one thing that cannot be inside the file.** Browsers only register a service worker from a real http(s) file: Chromium rejects one from a `blob:` or `data:` URL and from the page itself (tested). So the page carries the worker's source as inert text and does this:

- If a `sw.js` is served next to the page, the page registers it. You get offline start after the first visit and the background rest-timer notification fallback. `sw-single.js` is that file, identical to the embedded text. **Name matters:** the page asks for `sw.js`, and in this flat folder `sw.js` is the worker of the multi-file app, so when you use the single page, rename `index-single.html` to `index.html` and `sw-single.js` to `sw.js` (replacing the loose-file ones).
- If it is not there, everything else works. Settings, *Install and offline* shows *Offline mode is off* and a *Download sw.js* button that saves the embedded copy, ready to upload next to the page.
- Opened from disk (`file://`), service workers are unavailable. Logging, the timer, backups and the calendar download still work and data survives reloads.

**Installing.**

- Chromium's installability check passes for the single file with no service worker (the manifest is parsed with its three icons and reports no errors). Chrome has not needed a service worker for *Install app* in its menu since version 108 on Android and 112 on desktop. Chrome's own install *prompt* (the banner or address-bar icon) still needs a service worker with a fetch handler, so add `sw.js` if you want that. When the browser offers the prompt, Settings shows an *Install app* button.
- iPhone has no install criteria: Share, then Add to Home Screen. Settings shows these steps on an iPhone.
- I could not test a real phone. On Android, Chrome may install a plain shortcut instead of a full app when the icons come from a `data:` manifest; if that happens, use the loose-file app instead (`index.html` with `manifest.webmanifest` and the `icon-*.png` files beside it).

Other details: the safe edition's Content-Security-Policy allows the page's own inline scripts, `connect-src` only for itself and Gemini, `manifest-src data:` for the manifest and `worker-src 'self'` for `sw.js`. Without hash pinning it is weaker against an injected script than the full edition's policy; the app builds every screen from escaped text (tested), and your Gemini key can still only be sent to Gemini. The full edition lists the SHA-256 of each embedded script instead, and allows Google sign-in (`https://accounts.google.com/gsi/client`) only after you enter a client ID in Settings. For exercise photos in this version, give `thumbs.js` entries as `https://` addresses or `data:` URIs, then rebuild.

The rest of this README describes the loose-file app (`index.html`) and applies to both unless noted.

## Run it (loose files)

You need to serve the files over **HTTPS** (or `localhost`) because service workers, notifications and the screen wake lock only work on secure origins.

```bash
cd hybrid-athlete-flat
python3 -m http.server 8080        # then open http://localhost:8080
```

To use it on your phone, put the files on any static host. GitHub Pages, Netlify Drop, Cloudflare Pages and Vercel all work and are free. On GitHub: create a repository, upload every file from this folder into its root (drag them all in at once), then Settings, Pages, deploy from the `main` branch, `/ (root)`.

**Install it** (this matters: installed apps get more reliable storage and notifications):

- **iPhone:** open the site in Safari, tap Share, then *Add to Home Screen*. Notifications for installed web apps need iOS 16.4 or later.
- **Android:** open the site in Chrome, then menu, *Install app*.


## First five minutes

1. **Settings**: enter your **bodyweight** (pull-up weights need it), your age (and resting heart rate if you know it) for your Zone 2 range on run days, and check the **Program start** date; it defaults to the next Monday. Choose kg or lb.
2. **Lifts** tab: tap *Set 1RM* for Bench Press, Zercher Squat, Power Clean, Romanian Deadlift, Bulgarian Split Squat and Pull-up. Every working weight in the plan fills in from these. No 1RM tested? Use the calculator on the same screen (for example 100 kg × 5).
3. **Today** tab: tap *Start workout*.

## How it behaves

**Logging.** Each exercise shows a thumbnail icon, set number, a *Previous* benchmark (what you did last time for that set), a weight field, a reps field and a tick. Targets are pre-filled; type over any of them. Use *Add set* and *Remove set* freely. The ⋯ menu on an exercise has a YouTube how-to link, *Ask Ducky* and *Skip*. Typed-over weights are stored in kg internally, so switching units never loses precision.

**Supersets.** Superset A and B on Days 1 and 5 sit together on a yellow rail with a round counter. Ticking a set starts the short rest from the plan (30 s) and the rest bar tells you which exercise comes next. After the last exercise of the round the full rest starts (90 s on Day 1's Superset A), and after the final round the group's rest applies. Nothing starts after your very last set.

**Rest timer.** Starts when you tick a set (you can turn that off). It shows a large countdown with −15 / +15 / Skip. When it ends you get a short chime and a vibration. The chime is a brief Web Audio beep, never a long audio stream, so YouTube Music or Spotify keeps playing underneath. On Safari the audio session is set to *ambient* so it mixes rather than interrupts.

**Progression.** Working weight = (current 1RM) × (target intensity), rounded to your plate step (2.5 kg or 5 lb by default; change it in Settings). Six lifts work this way. Details:

- **Bulgarian split squat:** the 1RM is the total weight you hold (both dumbbells together, or the bar) for one rep on one leg; reps are counted per leg. Day 1 shows the weight and what percentage of your estimated 1RM it is.
- **Pull-up:** weighted. The 1RM and every percentage are about the *total* load, bodyweight plus added weight, and the weight field in the logger is the **added** weight (empty means bodyweight only). Example: bodyweight 80 kg, 1RM 120 kg total, 10 reps at 71.4% means 85.7 kg total, so add 5 kg. If the plan would be below your bodyweight it says so and leaves the field empty. Enter the 1RM as the total, or type `+40` for 40 kg added to bodyweight. The bodyweight at the time is saved with each logged session, so later bodyweight changes never rewrite old estimates.
- **Live percentage:** under each of these exercises the logger shows the weight on the set you are doing as a share of your estimated 1RM (for example *27.5 kg = 68.8% of estimated 1RM 40 kg*). It follows what you type, so you see the true percentage after plate rounding next to the planned one.

- The intensity for a prescribed rep target comes from the Epley formula, `1RM = weight × (1 + reps / 30)`, with your planned reps in reserve (RIR) added so the maths is closed-loop. Do exactly what was prescribed and your 1RM estimate stays put instead of drifting down week after week. RIR by block: Block 1: 2, Block 2: 1, Block 3: 1, Block 4: 2; power cleans stop 2 reps further from failure.
- After every logged session, the 1RM for those six lifts is re-estimated from your best set (reps ≤ 12) and the weights for the remaining weeks update. Use the best estimate of the last 28 days, so one bad day does not crash your numbers.
- A 1RM you type in wins until a workout is logged *after* it (compared by time), then the logged estimate takes over. Entering a fresh tested 1RM later overrides again.
- A single rep counts as the weight itself.
- Deload weeks (weeks 4, 8, 12, 16) use 55% of 1RM (the middle of your spec's 50–60%) with reduced volume, and never lower your 1RM estimate.
- Weighted accessories without a 1RM (Pallof press) repeat last time's weight and add one plate step once every set hit the top of the rep range. Pull-ups do the same until a bodyweight is set.

**Zone 2 heart rate.** Shown on every AM run day. With a resting heart rate it uses Karvonen (heart-rate reserve), otherwise a percentage of max heart rate. Defaults to 60–70%, max heart rate = 220 − age (or Tanaka, or your own measured number). All adjustable in Settings.

**Calendar.** Settings, then *Download calendar file (.ics)*. The file has 144 events with the right local dates and times: AM Zone 2 run and PM lift on Days 1 and 5, BJJ Gi, BJJ No-Gi, Recovery, Sprints, and all-day Rest entries (optional). Each timed event has a reminder 30 minutes before. To get it into Google Calendar: on a computer open Google Calendar, then Settings, *Import & export*, choose the file and pick the calendar. Every event has a stable ID and each export carries a higher revision number, so Google recognises a re-import as newer copies of the same events rather than adding a second set. If you ever do see duplicates (for instance after moving the start date by several weeks), delete the earlier events and import again.

**Ducky.** Paste a Gemini API key in Settings (get one at Google AI Studio). It is saved only in this browser's storage, sent only to Google, and never included in backups or exports. Ducky speaks only when you ask: open the tab, tap *Modify today's workout* or *How do I perform…*, or type a question. Ducky knows your whole program and today's resolved workout (with your weights) and answers briefly.

- *Modify today's workout* returns a short explanation plus changes (fewer sets, fewer reps, lighter weights, skip an exercise) that you apply with one tap. They apply to the workout in progress, or are saved and applied when you start today's session. Completed sets are never changed.
- *How do I perform X?* returns 4–6 cue bullets and a YouTube search link such as `https://www.youtube.com/results?search_query=how+to+do+zercher+squat`.
- "Today's workout" always means the workout you have open, or the real day's workout, not whichever day you are browsing.
- Model: defaults to `gemini-2.5-flash`; switch in Settings. If a model name is retired, the app falls back automatically.

## Zone 2 running: heart rate, pace and live coaching

**Target heart rate** is Karvonen: `((max HR − resting HR) × intensity) + resting HR`, by default 60 to 70% of heart-rate reserve. Set age (max HR is 220 − age unless you enter your own) and resting HR in Settings. Without a resting HR it falls back to a plain percentage of max HR and says so.

**Target pace** (min/km or min/mile, Settings, *Running pace*) comes from your own runs. Log a run (*Log a run* on the run card, or import one) with its distance, time and average heart rate. Pace is scaled with heart-rate reserve, using the median of up to 5 recent steady runs (up to 56 days old, at least 1.5 km and 15 minutes, between 40 and 92% of reserve). With no usable run, a recent race result (distance and time, same section) gives the pace through the Daniels–Gilbert VDOT model. It is a guide: heat, hills and fatigue move it. If resting HR is missing, 60 is assumed and the pace line says so.

**No sensor?** On the same screen you can **type your heart rate** (from a watch, or a 15-second pulse count times 4) and get the same blue / green / red and words. It works in every browser, including iPhone Safari, and a typed number counts for 3 minutes. Bluetooth errors (no device chosen, no heart-rate data, a dropped signal) are explained on screen and never stop the app.

**Live heart rate** (*Live heart rate* on the run card) reads a Bluetooth sensor through Web Bluetooth (Heart Rate Service). It shows the bpm large and coloured: **blue** below Zone 2, **green** inside it, **red** above it. The words ("Below Zone 2: pick it up", "In Zone 2", "Above Zone 2: ease off") say the same thing, so colour is never the only signal. With a run started you also get a beep and a buzz when you stay out of the zone: after 10 seconds, then every 30 seconds, plus a soft cue when you are back in. The first 3 minutes do not nag about being too low. Cues can be switched off in Settings. *Stop and save run* opens the run sheet with time and average heart rate filled in; add the distance and it feeds your pace.

- **Browsers.** Web Bluetooth exists in Chrome and Edge on Android, Windows, macOS and ChromeOS, on an https address (or localhost). Safari and Firefox do not have it. On an iPhone the free Bluefy browser does. The screen says so when it is missing.
- **Sensors.** Chest straps and optical armbands that advertise the standard heart-rate service work. A **Garmin watch** works if it is set to broadcast heart rate over Bluetooth (on many models: hold MENU on the heart-rate widget, then *Heart Rate Options*, then *Broadcast Heart Rate*; the menu differs by model). Older Garmins broadcast over ANT+ only, which no browser can read. If the watch is not in the list, use *Show all Bluetooth devices*.
- **Keep the screen on.** The app asks for a wake lock during a run, but a phone that locks or a browser that is sent to the background can stop Bluetooth updates. The sensor reconnects up to six times on its own.

**Garmin Connect without an API.** Garmin's Connect API is for approved companies and needs a server, so a single-file app cannot use it. Instead, export an activity from Garmin Connect on the web (open the activity, gear icon, *Export to TCX* or *Export to GPX*) and import it in *Log a run*. Time (pauses over 30 s are not counted), distance and average heart rate are read from the file, and the time you spent in Zone 2 is shown. FIT files are not supported.

## Google Calendar

**Safe edition:** *Settings, Calendar, Download calendar file (.ics)* exports all 16 weeks (times you moved included; importing it again updates the same events instead of duplicating them). On the Today screen each timed session also has an *Add to Google Calendar* link that opens Google Calendar's own "new event" page with the title, time and workout filled in; nothing is signed in or stored. The rest of this section is the **full edition** only.

### Two-way sync (full edition)

Settings, *Google Calendar*. The app signs in with Google (OAuth 2.0, Google Identity Services), makes a calendar called **Hybrid Athlete Schedule**, and keeps it in step with the app through the Calendar API v3.

- **App to calendar.** Change a session's time (*Change* next to it on the Today screen), a default time or the start date in Settings, or apply a Ducky change, and the affected events are updated a moment later. Each session has a fixed event id, so an update never makes a duplicate. Ducky's changes are added to the event description.
- **Calendar to app.** On launch, when you come back to the app, and on *Sync now*, changes since the last sync are fetched (an incremental sync). A session you dragged to a new time in Google Calendar becomes a moved session in the app's schedule. If both sides changed the same session, the later change wins. A session you delete in Google Calendar is left alone until you change it here again.
- **Scope.** Only `calendar.app.created`: the app can see and change calendars it created itself, nothing else of yours. It cannot read your other calendars.
- **Sign-in lasts about an hour.** A static page has no server to hold a refresh token, so Google's token expires. Changes you make meanwhile are counted ("3 changes are not in Google Calendar yet"); one tap on *Sync now* signs in again and sends them. The token is stored under its own key and never goes into a backup.

**Set-up (about 5 minutes, free; the same steps are in the app).** You need your own client ID because the app has no server and no owner account to hold one:

1. Open console.cloud.google.com, create a project, and enable the **Google Calendar API** (APIs & Services, Library).
2. Set up the OAuth consent screen (External) and add your own Google account under **Test users**.
3. Credentials, *Create credentials*, **OAuth client ID**, type *Web application*. Under **Authorized JavaScript origins** add the address of the app without the page name, for example `https://yourname.github.io`. Leave redirect URIs empty.
4. Paste the client ID into Settings and press *Connect Google Calendar*. Google warns the app is not verified (it is yours): *Advanced*, then *Continue*.

While the app is in *Testing* mode, only the Google accounts listed as Test users can sign in. The calendar and its events stay in your Google account if you press *Disconnect*. The **.ics download** still works and now includes any times you moved.

## What to know about the rest timer on a phone

Browsers freeze a web page when the screen locks. Because the timer stores its *end time*, the countdown is always correct when you look again, but nothing can chime while the page is frozen. What the app does about it:

1. **Keeps the screen on during a workout** (Screen Wake Lock, on by default). This is the reliable way to get the chime on time. Turn it off in Settings if you prefer.
2. **Fallback notification** from the service worker when the rest ends and the app is not visible. It works on Android Chrome and on iPhone for installed apps, but browsers may stop the service worker early, so treat it as best effort.
3. **Vibration** works on Android only. iOS does not allow it for web apps.

A truly guaranteed alarm with the screen locked would need a native app or a push server. This project deliberately has neither.

## Assumptions and deviations (please read)

- **Blocks 2 and 3 are generated from your rules, not copied.** Your spec gives explicit exercises only for Block 1; for Blocks 2 and 3 it gives rules. The app builds those weeks from Block 1's exercises plus your rules: reps dropped to 4–6 at 80–88% (Block 2) and 1–3 at 88–92+% (Block 3), Nordics 3×4–6 then 2×3–4, the contrast complex on Days 1 and 5 (iso vs pins, 20 s rest, jump, 2 min rest, 3 rounds), Depth Jumps / bounds / Flying 20s in Block 3, and the sprint distances from the rules. Those days are tagged *Built from your Block N rules* in the app so it is never silent about it.
- **Weeks 13–16 are an assumption.** Your spec ends at week 12 with "reset cycle at higher baselines", so weeks 13–16 repeat Block 1 with weights recalibrated from your logs. They are tagged *Assumed block, not in your spec*.
- **Epley with a rep-in-reserve term** instead of the plain formula, for the closed-loop reason above. The plain formula is used in the 1RM calculator.
- **Google Calendar sync needs your own client ID** (see above), because a static app has no server to own one. The .ics file route needs nothing and is still there. A subscribable `webcal://` feed is impossible without a server.
- **No Garmin Connect API.** It is for approved companies and needs a server. Live heart rate comes from Bluetooth broadcast, and finished runs come in as TCX or GPX files.

- **Exercise thumbnails are category icons** (strength, plyo, core, sprint, …). I did not ship exercise photos because they are licensed. To use your own, see `thumbs.js`.
- **Sprints and recovery days** are logged as checklists and timed results from the spec's own wording.

## Your data

Everything is in the browser's `localStorage` on this device. The app asks the browser to keep it persistent. Still: **export a backup now and then** (Settings, *Export backup*), especially before switching phones or clearing browser data. Import restores logs, 1RMs and settings. *Erase all data* wipes the device including the API key.

A strict Content-Security-Policy limits the app to its own files, `generativelanguage.googleapis.com` (Ducky), `www.googleapis.com` (Calendar) and Google sign-in, so a stray script could not send your key anywhere else.

## Project layout

All of these are in one folder, with no subfolders.

```
index.html            the app: shell with one <main>, nav, workout overlay, sheet root
manifest.webmanifest  PWA manifest
sw.js                 offline cache + background rest notification (the loose-file app's worker)
styles.css            the whole design (tokens at the top)
fonts.css             @font-face for Big Shoulders
BigShoulders-Bold.woff, OFL-BigShoulders.txt   the font and its licence
icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png   app icons
program.json          the 16-week plan as plain data (same content as spec.js; checked by the build and tests)

guard.js              shows an explanation instead of a blank page if the app cannot start
spec.js               your 16-week JSON, embedded verbatim
engine.js             pure maths: 1RM, units, rest parsing, Zone 2, history, .ics
program.js            spec -> concrete workout for each of the 112 days
session.js            a live workout: prefill, supersets, rest plan, Ducky changes
store.js              state + localStorage (API key and Google token stored separately)
zone2.js              Karvonen, pace model, Bluetooth packets, TCX/GPX files, zone watcher (pure)
sched.js              session times and moves, Google event ids and bodies, who-wins rule (pure)
actions.js            every state change the UI can make (no DOM)
timer.js              rest timer, chime, vibration, notifications, wake lock, zone cues
hr.js                 Web Bluetooth heart-rate sensor and the run in progress
gcal.js               Google sign-in and Calendar API v3 sync (talks only through what it is handed)
ai.js                 Ducky: prompt, Gemini call, markdown, change parsing
thumbs.js             optional exercise photos
views.js              every screen as a pure function (state -> HTML)
app.js                DOM glue: events, overlay, sheets, files

build-single.js       builds index-single.html (everything above in one file) and sw-single.js
gcal-off.js           the do-nothing stand-in for gcal.js that the safe single-file edition uses
index-single.html     the single-file build (generated: edit the source files, then rebuild)
sw-single.js          the optional service worker for it (the same text is embedded in index-single.html)

logic.test.js, zone2.test.js, sync.test.js, views.test.js, single.test.js, e2e.test.js, fake-gcal.js   tests
```

The scripts must load in the order `index.html` lists them (`guard`, `spec`, `engine`, `program`, `session`, `store`, `zone2`, `sched`, `actions`, `timer`, `hr`, `gcal`, `ai`, `thumbs`, `views`, `app`); each one uses what the earlier ones define.

## Tests

Run these from inside the folder.

```bash
node logic.test.js     # maths, program for all 112 days, sessions, calendar  (no dependencies)
node views.test.js     # renders every screen for every day; checks HTML, CSS classes, wiring
node single.test.js    # both single-file editions: self-contained, CSP, manifest, embedded sw.js, modules copied verbatim
node zone2.test.js     # Karvonen, pace, Bluetooth packets, TCX/GPX, zone alerts
node sync.test.js      # schedule layer and Google Calendar sync against a fake Calendar API
node e2e.test.js       # drives the real UI in Chromium (needs: npm i playwright)
SINGLE=1 node e2e.test.js        # the same tests against the safe index-single.html (+ sw-single.js served as /sw.js), plus opening it from file:// and checking it contacts no other site
SINGLE=alone node e2e.test.js    # index-single.html served without a service worker, like a host that only got the one file
SHOTS=./shots node e2e.test.js   # also saves screenshots
```

The end-to-end suite fakes Bluetooth (a heart-rate strap), Google sign-in and the Calendar API, so the running and sync features are tested through the real UI. It uses a fake clock, so it runs the rest timer, superset flow, reload recovery, Ducky (with a mocked Gemini), calendar download, backup/restore, unit switching, the weighted split squat and pull-ups, install/offline state (including Chromium's installability check), offline start and the CSP in about a minute.

## Updating

When you change any shipped file, bump `CACHE` in `sw.js` (for example `ha-v5`; it is `ha-v4` now) so installed copies pick the change up on their next launch. Then run `node build-single.js` to refresh `index-single.html`; `single.test.js` fails if it is out of date. If you add a new script, add it to `index.html` (in order), and to the `SHELL` list in `sw.js` (the single-file build picks scripts up from `index.html` by itself).

## Licences

Numerals and headings use **Big Shoulders** (SIL Open Font Licence 1.1; the licence is in `OFL-BigShoulders.txt`). Body text uses your device's UI font.
