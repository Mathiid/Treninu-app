# Hybrid Athlete Tracker & Ducky Coach

A phone-first training log for your 16-week hybrid program (lifting, Zone 2 running, sprints, BJJ), built as an installable web app (PWA). It logs sets Hevy-style, runs the rest timer, sets your weights from your 1RMs and keeps them up to date from what you actually lift, exports the whole schedule to Google Calendar, and has an on-demand AI coach called Ducky.

There is no build step, no backend and no account. Everything runs in the browser and is stored on your device.

## Run it

You need to serve the folder over **HTTPS** (or `localhost`) because service workers, notifications and the screen wake lock only work on secure origins.

```bash
cd hybrid-athlete
python3 -m http.server 8080        # then open http://localhost:8080
```

To use it on your phone, put the folder on any static host. Netlify Drop, Cloudflare Pages, GitHub Pages and Vercel all work and are free. Upload the folder as it is.

**Install it** (this matters: installed apps get more reliable storage and notifications):

- **iPhone:** open the site in Safari, tap Share, then *Add to Home Screen*. Notifications for installed web apps need iOS 16.4 or later.
- **Android:** open the site in Chrome, then menu, *Install app*.

## First five minutes

1. **Lifts** tab: tap *Set 1RM* for Bench Press, Zercher Squat, Power Clean and Romanian Deadlift. Every working weight in the plan fills in from these. No 1RM tested? Use the calculator on the same screen (for example 100 kg × 5).
2. **Settings**: add your age (and resting heart rate if you know it) to get your Zone 2 range on run days. Check the **Program start** date; it defaults to the next Monday. Choose kg or lb.
3. **Today** tab: tap *Start workout*.

## How it behaves

**Logging.** Each exercise shows a thumbnail icon, set number, a *Previous* benchmark (what you did last time for that set), a weight field, a reps field and a tick. Targets are pre-filled; type over any of them. Use *Add set* and *Remove set* freely. The ⋯ menu on an exercise has a YouTube how-to link, *Ask Ducky* and *Skip*. Typed-over weights are stored in kg internally, so switching units never loses precision.

**Supersets.** Superset A and B on Days 1 and 5 sit together on a yellow rail with a round counter. Ticking a set starts the short rest from the plan (30 s) and the rest bar tells you which exercise comes next. After the last exercise of the round the full rest starts (90 s on Day 1's Superset A), and after the final round the group's rest applies. Nothing starts after your very last set.

**Rest timer.** Starts when you tick a set (you can turn that off). It shows a large countdown with −15 / +15 / Skip. When it ends you get a short chime and a vibration. The chime is a brief Web Audio beep, never a long audio stream, so YouTube Music or Spotify keeps playing underneath. On Safari the audio session is set to *ambient* so it mixes rather than interrupts.

**Progression.** Working weight = (current 1RM) × (target intensity), rounded to your plate step (2.5 kg or 5 lb by default; change it in Settings). Details:

- The intensity for a prescribed rep target comes from the Epley formula, `1RM = weight × (1 + reps / 30)`, with your planned reps in reserve (RIR) added so the maths is closed-loop. Do exactly what was prescribed and your 1RM estimate stays put instead of drifting down week after week. RIR by block: Block 1: 2, Block 2: 1, Block 3: 1, Block 4: 2; power cleans stop 2 reps further from failure.
- After every logged session, the 1RM for those four lifts is re-estimated from your best set (reps ≤ 12) and the weights for the remaining weeks update. Use the best estimate of the last 28 days, so one bad day does not crash your numbers.
- A 1RM you type in wins until a workout is logged *after* it (compared by time), then the logged estimate takes over. Entering a fresh tested 1RM later overrides again.
- A single rep counts as the weight itself.
- Deload weeks (weeks 4, 8, 12, 16) use 55% of 1RM (the middle of your spec's 50–60%) with reduced volume, and never lower your 1RM estimate.
- Weighted accessories without a 1RM (Bulgarian split squat, pull-ups, Pallof press) repeat last time's weight and add one plate step once every set hit the top of the rep range.

**Zone 2 heart rate.** Shown on every AM run day. With a resting heart rate it uses Karvonen (heart-rate reserve), otherwise a percentage of max heart rate. Defaults to 60–70%, max heart rate = 220 − age (or Tanaka, or your own measured number). All adjustable in Settings.

**Calendar.** Settings, then *Download calendar file (.ics)*. The file has 144 events with the right local dates and times: AM Zone 2 run and PM lift on Days 1 and 5, BJJ Gi, BJJ No-Gi, Recovery, Sprints, and all-day Rest entries (optional). Each timed event has a reminder 30 minutes before. To get it into Google Calendar: on a computer open Google Calendar, then Settings, *Import & export*, choose the file and pick the calendar. Every event has a stable ID and each export carries a higher revision number, so Google recognises a re-import as newer copies of the same events rather than adding a second set. If you ever do see duplicates (for instance after moving the start date by several weeks), delete the earlier events and import again.

**Ducky.** Paste a Gemini API key in Settings (get one at Google AI Studio). It is saved only in this browser's storage, sent only to Google, and never included in backups or exports. Ducky speaks only when you ask: open the tab, tap *Modify today's workout* or *How do I perform…*, or type a question. Ducky knows your whole program and today's resolved workout (with your weights) and answers briefly.

- *Modify today's workout* returns a short explanation plus changes (fewer sets, fewer reps, lighter weights, skip an exercise) that you apply with one tap. They apply to the workout in progress, or are saved and applied when you start today's session. Completed sets are never changed.
- *How do I perform X?* returns 4–6 cue bullets and a YouTube search link such as `https://www.youtube.com/results?search_query=how+to+do+zercher+squat`.
- "Today's workout" always means the workout you have open, or the real day's workout, not whichever day you are browsing.
- Model: defaults to `gemini-2.5-flash`; switch in Settings. If a model name is retired, the app falls back automatically.

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
- **Calendar is a file import, not a live feed.** A static app cannot host a subscribable `webcal://` URL, and a Google OAuth sync would need you to create a Google Cloud project. The .ics route needs neither and is repeatable.
- **Exercise thumbnails are category icons** (strength, plyo, core, sprint, …). I did not ship exercise photos because they are licensed. To use your own, see `js/thumbs.js`.
- **Sprints and recovery days** are logged as checklists and timed results from the spec's own wording.

## Your data

Everything is in the browser's `localStorage` on this device. The app asks the browser to keep it persistent. Still: **export a backup now and then** (Settings, *Export backup*), especially before switching phones or clearing browser data. Import restores logs, 1RMs and settings. *Erase all data* wipes the device including the API key.

A strict Content-Security-Policy limits the app to its own files and `generativelanguage.googleapis.com`, so a stray script could not send your key anywhere else.

## Project layout

```
index.html            shell: one <main>, nav, workout overlay, sheet root
manifest.webmanifest  PWA manifest (icons incl. maskable)
sw.js                 offline cache + background rest notification
css/styles.css        the whole design (tokens at the top)
js/spec.js            your 16-week JSON, embedded verbatim
js/engine.js          pure maths: 1RM, units, rest parsing, Zone 2, history, .ics
js/program.js         spec -> concrete workout for each of the 112 days
js/session.js         a live workout: prefill, supersets, rest plan, Ducky changes
js/store.js           state + localStorage (API key stored separately)
js/actions.js         every state change the UI can make (no DOM)
js/timer.js           rest timer, chime, vibration, notifications, wake lock
js/ai.js              Ducky: prompt, Gemini call, markdown, change parsing
js/thumbs.js          optional exercise photos
js/views.js           every screen as a pure function (state -> HTML)
js/app.js             DOM glue: events, overlay, sheets, files
tests/                logic, views and end-to-end tests
```

## Tests

```bash
node tests/logic.test.js     # maths, program for all 112 days, sessions, calendar  (no dependencies)
node tests/views.test.js     # renders every screen for every day; checks HTML, CSS classes, wiring
node tests/e2e.test.js       # drives the real UI in Chromium (needs: npm i playwright)
SHOTS=./shots node tests/e2e.test.js   # also saves screenshots
```

The end-to-end suite uses a fake clock, so it runs the rest timer, superset flow, reload recovery, Ducky (with a mocked Gemini), calendar download, backup/restore, unit switching, offline start and the CSP in about a minute.

## Updating

When you change any shipped file, bump `CACHE` in `sw.js` (for example `ha-v2`) so installed copies pick the change up on their next launch.

## Licences

Numerals and headings use **Big Shoulders** (SIL Open Font Licence 1.1; licence in `fonts/`). Body text uses your device's UI font.
