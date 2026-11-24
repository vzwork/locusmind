# locusmind

A React, TypeScript, and Zod workspace for Markdown notes and Excalidraw scene
files.

## Run locally

```sh
pnpm install
pnpm dev
```

Run `pnpm build` to type-check and create a production build.
Run `node --test tests/github.test.mjs` with Node.js 24 or newer to test the
repository-selection data flow.

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
the frontend. Firebase configuration is optional for guest access.

Visitors open the guest workspace by default unless already signed in. Use
**Sign in** in the workspace to open the GitHub sign-in screen. The guest
workspace is stored in the browser and remains available on return. It is
separate from signed-in workspaces and is not merged when signing in. Clearing
browser storage removes locally stored workspaces.

GitHub sign-in requests the `repo` OAuth scope, which grants read and write
access to public and private repositories. Signed-in users can open the
repository dropdown at the top of the sidebar and select a repository to import
Markdown and Excalidraw files from its default branch.
Existing local files are preserved if paths overlap. GitHub organization restrictions
may limit the repositories shown. Archived and read-only repositories cannot
be selected. Use **Refresh repositories** to update the background-loaded list.
Use **Create repository** in the dropdown to create an empty repository under
the signed-in GitHub account, choosing private or public visibility. Creation
does not switch repositories; select the new repository to import it.
The selected repository appears in the repository dropdown. The imported repository
and its base commit are stored with the workspace in this browser.
The GitHub token is stored in browser local storage and used to load
repositories in the background. Scripts running on this site, including
injected scripts, can access it. Signing out removes the stored token. If a
signed-in account has no token, GitHub authorization opens in the current tab
without signing the user out. If a token expires, use **Reconnect GitHub**.
Selecting the same repository again imports newly added remote files and updates
the comparison base; previously deleted local files remain deleted. Import is read-only.

Use **Sync to GitHub** to review additions, modifications, and deletions before
committing them to the selected repository's default branch. The sync preserves
other repository files and refuses to proceed if the branch has changed since
the import or if a path conflicts with a non-regular file. Reselect the
repository and review the resulting changes before retrying. For an empty
repository, sync first commits one file to initialize it, then commits the
remaining files. If the second step fails, reselect the repository and review
the remaining changes before retrying. Protected branches or missing write
permissions can also prevent a sync. Changes made locally during a sync
remain in the workspace and are not included in that commit.

## Current scope

The app supports browsing, searching, creating, editing, renaming, deleting,
and downloading workspace files. Markdown has an
editor and rendered preview; drawings use the Excalidraw canvas. Users can
continue as a guest or authenticate with GitHub through Firebase Auth.
For Markdown, **Split** shows the editor and live preview side by side. Drag
the divider to resize them, or focus it and use the arrow keys (Shift for
larger steps, Home/End for the limits).
Workspace data is validated with Zod and stored in local storage, separately
for guests and each signed-in account on that browser. Authentication and import
do not automatically sync or commit data to GitHub or Firebase.

In the file explorer, green **N** marks files not present in a previously saved
local version and amber **M** marks files whose content or name has changed since
that version. Without a saved version, all files are marked new. These
indicators track versions, not browser auto-save. After importing a repository,
they instead compare paths and contents against the imported GitHub commit,
and deleted files are listed separately. Files other than Markdown and Excalidraw, symbolic
links, and submodules are not imported or included in this comparison.

The explorer works like the VS Code file explorer. Folders are listed before
files; click a file to open it, or click a folder to select it and toggle it open
(selecting a folder closes the current file). Selection is reflected in the URL
and supports browser back and forward. Links refer to files in the current
browser workspace, not synced or shared content.
Hover over a folder breadcrumb in the top bar to browse it, or use its button
with a keyboard or touch. Select a file or folder in the list to open it.
Drag the sidebar's right edge to resize it, or focus the divider and use the
arrow keys (Shift for larger steps, Home/End for the limits).

| Action | How |
| --- | --- |
| Navigate | Arrow keys, Home/End; Right expands a folder or enters it, Left collapses it or goes to its parent |
| Open or toggle | Space, or click |
| Rename | Enter or F2 on a row. Enter or clicking away saves a valid name, Escape cancels |
| Delete | Delete (Cmd+Backspace on Mac) on a row, or drag it onto the Trash that appears while dragging |
| Undo delete | Ctrl+Z / Cmd+Z outside editors, or the Undo button in the notification |
| Move | Drag a file or folder onto a folder (or onto a file to move it beside that file). Drop on empty space to move to the top level. Hovering a collapsed folder while dragging opens it |

The folder button creates a folder inside the selected folder or selected
file's folder, or at the workspace root if nothing is selected. When a folder is
selected, new notes and drawings are created inside it. New files and folders
are created with a unique default name and immediately open for inline renaming.

Moves preserve content and cannot overwrite existing files or folders. Folders
cannot be moved into themselves or their descendants, and folders emptied by a
move or delete remain available. Deleting a folder deletes everything inside it;
undo restores it, and refuses to overwrite anything that now uses the same path.

Changing a file's extension between `.md` and `.excalidraw` switches its editor
and discards its existing content, leaving an empty file of the new type.

Realtime Database/Yjs collaboration and AI assistance from
the technical design are not connected yet.
