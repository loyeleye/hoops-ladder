# Play Console forms: what to answer

Everything under **Play Console → Policy and programs → App content** has to be filled in before the
first release, even for internal testing. These answers match the app as of November 2026: all data
stays on the phone, no account, cloud sync and "Ask the coach" hidden, camera clips analyzed on-device,
training videos stored on-device and sent only when the user shares them.
**If any of that changes (sync, the coach, a server, analytics, crash reporting, ads), redo the Data
safety form and the privacy policy before releasing that version.**

## Privacy policy

URL: `https://loyeleye.github.io/hoops-ladder/privacy.html`
(Live once GitHub Pages is turned on; see `docs/LEARNING.md`, step 7.)

## App access

**All functionality is available without special access.** No login.

## Ads

**No, my app does not contain ads.**

## Content rating (IARC questionnaire)

- Email: your developer email.
- Category: **All Other App Types** (it isn't a game, social app or store).
- Answer **No** to every question: violence, sexuality, language, controlled substances, gambling, user
  interaction or sharing between users, sharing location, digital purchases, unrestricted internet access
  (it only opens a few outside links you tap), and so on.
- Expected result: **Everyone / PEGI 3 / USK 0** or similar in each region.

## Target audience and content

- Target age groups: **13–15, 16–17, 18 and over.**
- Leave **under 13** unticked. Ticking any under-13 group puts the app under the Families policy (Teacher
  Approved rules, extra review, stricter SDK limits). You can add younger groups later.
- "Could your store listing unintentionally appeal to children?" Answer **No**: the listing is about
  training, without cartoon characters or kid-oriented wording.

## Data safety

Play asks what data the app **collects** (sends off the device) or **shares** (gives to a third party).
Data that's only processed on the phone doesn't count as collected, per Google's own guidance:
https://support.google.com/googleplay/android-developer/answer/10787469

- Does your app collect or share any of the required user data types? **No.**
- Is all user data encrypted in transit? Not asked once you answer No.
- Do you provide a way for users to request that their data be deleted? Not asked once you answer No.
  (The policy still explains how: uninstall or clear storage.)

Result on the listing: **"No data collected · No data shared."**

Why each feature still counts as "not collected":

| Feature | What happens | Leaves the phone? |
|---|---|---|
| Progress, settings, form numbers | WebView localStorage in the app's private storage | No |
| Form check video | Read in memory, pose model runs on-device, only numbers kept | No |
| Camera | Opened by Android's picker when you record a clip | No |
| Training videos (camera + mic audio) | Stored in the app's IndexedDB on the phone | No |
| Save to phone | Copies a video to Documents/Hoops Ladder, on the same phone | No |
| Send to coach | Android share sheet; the user picks the app and recipient | Only by the user's own action. Google's guidance doesn't count user-initiated transfers like this as "sharing" |
| Voice commands and dictating drills | `@capacitor-community/speech-recognition` hands audio to Android's recognizer (Google's on most phones) | Not by the app. The recognizer is a system service covered by Google's policy, like the keyboard; the app only gets text |
| Spoken scores | Android text-to-speech | No |
| Outside links (YouTube, articles) | Open in the browser or YouTube app | Not by the app |
| Android Auto Backup (`allowBackup="true"`) | Android backs up app data to the user's Google account if they turned backup on | Not to you. It's an Android system feature the user turns on, and you can't read the backup. If you'd rather not think about it, set `android:allowBackup="false"` (users then lose progress when they switch phones) |

## Health apps declaration

Play now asks every app whether it has health features.

- Pick the fitness option (labelled along the lines of **Activity and fitness**): the app tracks workouts and training progress. Wording in the Console changes; pick the closest match.
- Don't select anything medical, clinical, mental health, nutrition, sleep or period tracking.
- Health Connect: **No**, the app doesn't read or write Health Connect data.
- It isn't a medical device and makes no medical claims.

## Government apps, financial features, news, COVID-19

**No / not applicable** for each.

## Permissions to double-check

The manifest declares `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `VIBRATE` and `INTERNET`.
None of them needs a separate Play declaration form (those are for SMS, call log, location in the
background, all-files access, exact alarms and similar).

`RECORD_AUDIO` is needed: training videos record sound, and voice commands and dictation use a native
speech recognition plugin (added alongside the training videos).

## Listing wording to avoid

Some drill names and descriptions inside the app credit real coaches and programs. That's fine as credit
inside the app, but keep those names out of the store title, short description, full description and
screenshots' captions: Play's metadata and impersonation policies flag third-party names used to
promote an app. (Screenshot 3 shows one in the app's own drill blurb, which is normal app content.)
