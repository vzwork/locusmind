# locusmind

A React, TypeScript, and Zod workspace for Markdown notes and Excalidraw scene
files.

## Run locally

```sh
pnpm install
pnpm dev
```

Run `pnpm build` to type-check and create a production build.

## Firebase Hosting

After configuring `.env.local` as described below, build and deploy from this
directory:

```sh
pnpm build
pnpm dlx firebase-tools deploy --only hosting --project YOUR_FIREBASE_PROJECT_ID
```

Firebase Hosting serves the generated `dist/` directory.

## Firebase GitHub sign-in

1. Create a Firebase project and register a web app.
2. Copy `.env.example` to `.env.local` and fill in the Firebase web app values.
3. In Firebase Console, enable **Authentication → Sign-in method → GitHub**.
4. Create a GitHub OAuth App using the callback URL shown by Firebase, then add
   its client ID and client secret to the Firebase provider settings.
5. Add the local and production hostnames under Firebase Authentication's
   authorized domains.

The GitHub client secret belongs in Firebase Console, not in `.env.local` or
the frontend. Signed-in users currently get separate workspaces stored in
their browser; authentication does not yet sync workspace data to GitHub or
Firebase.

## Current scope

The app supports browsing, searching, creating, editing, renaming, deleting,
downloading, and locally checkpointing workspace files. Markdown has an
editor and rendered preview. Users authenticate with GitHub through Firebase
Auth. Workspace data is validated with Zod and stored in local storage,
separately for each signed-in account on that browser.

GitHub persistence, Realtime Database/Yjs collaboration, a visual Excalidraw
canvas, and AI assistance from the technical design are not connected yet.
