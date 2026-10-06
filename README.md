# WeFall

A multi-user skydiving logbook built with React, TypeScript, Vite, Tailwind CSS and Firebase
(Authentication + Cloud Firestore).

- Log jumps: number, date, time (optional), dropzone, aircraft, jump type, exit/deployment altitude (m), freefall time, canopy, notes
- New jumps are prefilled from your last jump; dropzone/aircraft/canopy autocomplete from history
- Stats dashboard: totals, freefall time, days since last jump, charts by month/year/type, top dropzones
- CSV import with automatic column matching (feet are converted to meters) and CSV export
- ProTrack import: select one or more ProTrack jump files (`.txt`) to import number, date, time, altitudes and freefall time
- Each user only sees their own jumps (enforced by Firestore security rules)
- Works offline: jumps logged without reception sync when you're back online

## Setup

The app is wired to the `wefall` Firebase project; its web config is inlined in
`src/lib/firebase.ts` (these values are public by design). To use a different project:

1. Create a project in the [Firebase console](https://console.firebase.google.com/).
2. **Authentication** → Sign-in method: enable **Email/Password** and **Google**.
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
firebase deploy --only firestore:rules
npm run deploy              # builds and deploys hosting + rules
```

Security rules (`firestore.rules`) must be deployed before the app can read or write data.
When deploying to a custom domain, add it under Authentication → Settings → Authorized domains.

## Data model

```
users/{uid}/jumps/{jumpId}
  jumpNumber, date (YYYY-MM-DD), time (HH:MM:SS or empty), dropzone, aircraft, jumpType,
  exitAltitude (m), deploymentAltitude (m), freefallTime (s),
  canopy, notes, createdAt, updatedAt
```
