# WeFall

A multi-user skydiving logbook built with React, TypeScript, Vite, Tailwind CSS and Firebase
(Authentication + Cloud Firestore).

- Log jumps: number, date, time (optional), dropzone, aircraft, jump type, exit/deployment altitude (m), freefall time, canopy, notes
- New jumps are prefilled from your last jump; dropzone/aircraft/canopy autocomplete from history
- Stats dashboard: totals, freefall time, days since last jump, charts by month/year/type, top dropzones
- CSV import with automatic column matching (feet are converted to meters) and CSV export
- ProTrack import: select one or more ProTrack jump files (`.txt`) to import number, date, time, altitudes and freefall time;
  each file is attached to its jump (re-importing replaces the attachment with the same file name)
- Attachments: add files such as FlySight CSVs to a saved jump (up to 20 files of 10 MB each);
  participants can download them from the shared jump page. The file type (ProTrack, FlySight, FlySight 2,
  GPX, KML, image) is detected from the file's content on upload and shown next to it
- FlySight track viewer: **View** next to a FlySight or FlySight 2 track attachment opens it on a street or
  satellite map, colored by phase (climb, freefall, opening, canopy), with a side profile, a chart of altitude,
  speeds, glide ratio, dive angle and GPS accuracy over time (drag across it to zoom in), min/avg/max of the shown
  section and key numbers for each phase (exit and deployment altitudes, freefall and canopy times, top speeds,
  opening, landing point). Hovering the map or the chart shows the values at that point on all of them.
  A **3D** view shows the track over the map in perspective; it can be turned, tilted, zoomed and opened
  fullscreen, and optionally drops lines to the ground every few seconds to make heights easier to read
  Logs with several jumps can be viewed one jump at a time
- FlySight 2 configurator: connect to a FlySight 2 over Bluetooth (Web Bluetooth: Chrome on Android; Windows
  can't keep a connection with the current FlySight firmware) and
  edit `config.txt` or the selectable configs in `/config` as a form or as text. Selectable configs only
  write the settings they set; everything else keeps its `config.txt` value, as on the device.
  Its **Tracks** tab finds the exits in each recorded session's `track.csv`, suggests the logbook jump for each
  (by time, or by order on days without jump times), and attaches the session's `track.csv` and `sensor.csv`
  to it, named after the session (e.g. `26-10-22_10-15-30_track.csv`) so attached sessions are skipped next time
- Bluetooth explorer (`/bluetooth`): connect to any Bluetooth LE device, list its services, characteristics
  and descriptors, read, write and subscribe to characteristics, and copy a timestamped log, for working out
  undocumented protocols such as the AON2 X2's. Custom services must be added by UUID, since browsers only
  expose the services they're told about
- Android companion app (`android/`): plug a ProTrack II or FlySight 2 into the phone over USB and the app
  opens by itself, reads the device and opens WeFall in the browser with its data: ProTrack jumps on the
  import page, FlySight 2 sessions on the FlySight page's Tracks tab (which finds their jumps right away).
  See [Android app](#android-app)
- Each user only sees their own jumps (enforced by Firestore security rules)
- Jump sharing: add participants to a jump by email; they can open it via its direct link
  (`/shared/{ownerUid}/{jumpId}`) after signing in with Google, and see it under **Shared**,
  even without a logbook of their own
- Jump links use the jump number, e.g. `/jumps/700` or `/shared/{ownerUid}/700`; jumps with a
  duplicated number fall back to their id, and id-based links keep working
- Works offline: jumps logged without reception sync when you're back online

## Setup

The app is wired to the `wefall` Firebase project; its web config is inlined in
`src/lib/firebase.ts` (these values are public by design). To use a different project:

1. Create a project in the [Firebase console](https://console.firebase.google.com/).
2. **Authentication** → Sign-in method: enable **Google**.
3. **Firestore Database** → Create database (production mode).
4. **Project settings** → Your apps → add a **Web app** and paste its config into `src/lib/firebase.ts`.
5. Update the project ID in `.firebaserc` and `.github/workflows/`.

Install and run:

```sh
npm install
npm run dev
```

## Deploying rules and hosting

```sh
npm install -g firebase-tools
firebase login
firebase use --add          # select your project
firebase deploy --only firestore   # rules + indexes
npm run deploy              # builds and deploys hosting + rules
```

Security rules (`firestore.rules`, `storage.rules`) must be deployed before the app can read or write data.
`storage.rules` reads jump documents to let participants download attachments; allow the Storage
service agent access to Firestore when the CLI or console asks. The `deleteJumpAttachments` Cloud
Function removes a jump's files when the jump is deleted (`firebase deploy --only functions`).

Attachments are downloaded through the Storage SDK, which needs CORS on the bucket (once per bucket;
add custom domains to `cors.json` first):

```sh
gcloud storage buckets update gs://wefall.firebasestorage.app --cors-file=cors.json
```
The **Shared** page needs the collection-group index on `participants` from `firestore.indexes.json`.
When deploying to a custom domain, add it under Authentication → Settings → Authorized domains.

## Android app

`android/` is a small Kotlin app (no Firebase of its own) that hands a plugged-in device's files to the site:

1. Its `USB_DEVICE_ATTACHED` filter (`res/xml/device_filter.xml`) opens it for the FlySight 2 (16d0:0569) and
   the ProTrack II (c1ca:babb), and for no other USB device.
2. It waits for Android to mount the drive and reads it through the Storage Access Framework. Android asks
   once per drive for access.
3. A drive with `flysight.txt` in its root is a FlySight 2; one with `SETUP/STATUS.TXT` is a ProTrack, whose
   jump files (`.txt` files starting with `JIB`) are copied to the phone so it can be unplugged. Jumps copied
   on an earlier plug-in aren't read again.
4. It serves the files on `http://127.0.0.1:<port>` (`LocalServer.kt`; only to the WeFall site and the
   Vite dev server, with a per-share token) from a foreground service that stops after 15 idle minutes, and opens
   `/import` or `/flysight` with `#app=<port>:<token>` in a Chrome Custom Tab, which shares Chrome's sign-in.
   Chrome asks once per site to let the page access other apps and services on the device.

The page it opens is `WEFALL_URL` in `android/app/build.gradle.kts` (`https://wefall.web.app`).
It runs on Android 16 and later (targets Android 17) and builds with Android Gradle Plugin 9.4 and Gradle 9.8,
which need JDK 17 or later (Android Studio's bundled JDK works). Build with Android Studio or:

```sh
cd android
./gradlew assembleDebug    # app/build/outputs/apk/debug/app-debug.apk
```

To try it against the dev server, run `adb reverse tcp:5173 tcp:5173` and build with
`./gradlew assembleDebug -PwefallUrl=http://localhost:5173`.

### Releasing the Android app

Pushing a tag like `android-v1.2.3` runs `.github/workflows/android-release.yml`, which builds the app as
version 1.2.3 (version code 10203; each release needs a higher version), signs it with the release key and
publishes it as a GitHub release with `wefall.apk` attached. The Import and FlySight pages link to
`https://github.com/aeremin/wefall/releases/latest/download/wefall.apk`.

```sh
git tag android-v0.1.0
git push origin android-v0.1.0
```

The release key is created once and must never be lost: Android only installs an update signed with the same
key, so without it everyone would have to uninstall the app to get a new version. Keep it out of the repo
(`*.jks` is ignored) and back up the file and its password somewhere safe, such as a password manager.

1. Create the key with the `keytool` that comes with Android Studio's JDK. It asks for a password and your
   name:

   ```sh
   keytool -genkeypair -keystore wefall-release.jks -alias wefall -keyalg RSA -keysize 4096 -validity 10000
   ```

2. Add three repository secrets under GitHub → Settings → Secrets and variables → Actions:
   - `ANDROID_KEYSTORE_BASE64`: the key file in base64. In PowerShell,
     `[Convert]::ToBase64String([IO.File]::ReadAllBytes("wefall-release.jks")) | Set-Clipboard` copies it.
   - `ANDROID_KEYSTORE_PASSWORD`: its password.
   - `ANDROID_KEY_ALIAS`: `wefall`.

To build a signed release locally, set `WEFALL_KEYSTORE` (the key file's path), `WEFALL_KEYSTORE_PASSWORD`
and `WEFALL_KEY_ALIAS` and run `./gradlew assembleRelease -PreleaseVersion=1.2.3`. Without them,
`assembleRelease` leaves the APK unsigned.

A phone with a debug build installed has to uninstall it before installing a release, since they're signed
with different keys. It then asks again for access to each device's drive.

## Data model

```
users/{uid}/jumps/{jumpId}
  jumpNumber, date (YYYY-MM-DD), time (HH:MM:SS or empty), dropzone, aircraft, jumpType,
  exitAltitude (m), deploymentAltitude (m), freefallTime (s),
  canopy, notes, createdAt, updatedAt,
  participants (lowercased emails that may view the jump), ownerName (shown to participants),
  attachments: [{ id, name, size (bytes), contentType, uploadedAt (ISO),
    type (protrack | flysight | flysight2 | gpx | kml | image | other; absent on older uploads) }]
```

Attachment files are stored in Cloud Storage at `users/{uid}/jumps/{jumpId}/{attachmentId}`.
