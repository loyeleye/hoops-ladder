# Google Play store listing

Copy each block into **Play Console → Grow users → Store presence → Main store listing**.
Character limits are Google's; the counts were checked when this was written.
Don't name real coaches, players, teams or the NBA here: Play's metadata policy treats that as
using someone else's name to promote the app.

## App name (30 max)

```
Hoops Ladder
```

## Short description (80 max)

```
Basketball drills that level up with you. Shooting, handling and finishing.
```

## Full description (4,000 max)

```
Hoops Ladder turns solo basketball practice into a ladder you climb. Pick how long you have, get a workout built for your level, and earn XP for every drill. Hit your goals and harder drills unlock, so you always know what to work on next.

WORKOUTS FOR THE TIME YOU HAVE
• Choose 20, 30 or 45 minutes and get today's session
• Tell it if you have a partner or a heavy ball, and the plan adjusts
• One cue a day to focus on, so you're not thinking about ten things at once

55 DRILLS ACROSS THREE SKILLS
• Shooting: form work, a tracked five-spot 3-point test, free throws, and game-speed decision reps
• Handling: stationary and on-the-move ball-handling, two-ball work and called-move reaction drills
• Finishing: layup footwork, both hands, off the glass and through contact
• Every drill has animated steps and a demo, so you can learn it alone at the gym

LEVEL UP
• Separate levels for Shooting, Handling and Finishing, plus an overall player level
• Ranks from Rookie to Gym legend
• Skill checks: hit your goal twice and the next rung of drills opens

TRACK WHAT MATTERS
• A 3-point map that shows your percentage from each spot over 30 days or all time
• Your coldest spot, flagged so you know where to put in reps
• Free-throw percentage, streaks and weekly sessions

HANDS-FREE LOGGING
• Log makes and misses with a tap, your earbuds' buttons or a Bluetooth clicker
• The app reads your score out loud, so you can keep your eyes on the rim

FORM CHECK
• Record a clip of your shot from the side, or pick one from your phone
• Pose tracking runs on your phone and measures your balance, dip, set point, release and tempo
• Your clips never leave your phone

PRIVATE BY DESIGN
No account. No ads. No tracking. Your progress is saved on your phone and nowhere else, and the app works offline.

For every level, from your first layup line to your hundredth 3-point test.
```

## Graphics

| Asset | File | Play's requirement |
|---|---|---|
| App icon | `graphics/icon-512.png` | 512 × 512 PNG, up to 1 MB. Play rounds the corners. |
| Feature graphic | `graphics/feature-graphic.png` | 1024 × 500 PNG or JPEG, no transparency |
| Phone screenshots | `screenshots/phone-1.png` … `phone-5.png` | 2 to 8; 1080 × 1920 (9:16) qualifies for featuring |

All of them are rendered from the app by `node tools/make_store_art.mjs` (see `docs/LEARNING.md`, step 9).
The progress in the screenshots is demo data.

## Other listing fields

| Field | Value |
|---|---|
| App category | Sports (Health & Fitness also fits; Sports puts it next to other basketball apps) |
| Tags | Basketball, Sports training, Workout |
| Contact email | Required and shown publicly. Use an address you're happy to publish. |
| Website | https://loyeleye.github.io/hoops-ladder/ |
| Privacy policy | https://loyeleye.github.io/hoops-ladder/privacy.html |
