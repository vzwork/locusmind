# locusmind — Technical Design

Nov 23, 2026 · @Vladislav Zakharov

## Overview

locusmind is a web app for organizing thoughts in markdown notes and Excalidraw drawings. It stores everything in a GitHub repo, supports live shared sessions, and includes an AI assistant that works inside the files. It is hosted on Firebase.

**Goals**

- Browse a workspace as a file tree and create, read, rename and delete `.md` and `.excalidraw` files.
- Use GitHub as the source of truth, so work can be picked up again from any device and every saved version is a commit.
- Let several people, and the AI, edit the same workspace live with presence and cursors.
- Credit each saved change to the people who made it in the GitHub history.

**Non-goals (v1)**

- Editing directly against arbitrary branches, or resolving merge conflicts in the UI.
- Offline-first native apps.
- Live sync for file types other than markdown and Excalidraw.

## Architecture

The browser talks only to Firebase. Cloud Functions hold the GitHub App key and the AI key and are the only part that writes commits or calls the model.

&#91;embedded content: system architecture · browser, Firebase, external services\]

Editors sync through Realtime Database. Functions read that live state to commit snapshots to GitHub and to apply the AI's edits back into the session.

## Data model and repo layout

A workspace maps to one GitHub repo, or to one folder in a repo. Files are kept in plain formats so the repo stays readable and usable without the app.

```
workspace-repo/
  .locusmind/
    workspace.json      # id, name, settings
  notes/
    ideas.md
  drawings/
    system-map.excalidraw
    system-map.svg      # export for GitHub previews
```

**Live state (Firebase Realtime Database)**

| Path | Holds |
| --- | --- |
| `/workspaces/{wid}/members/{uid}` | Role: `owner`, `editor` or `viewer` |
| `/workspaces/{wid}/tree` | Yjs updates for the file-tree map (path → file id) |
| `/workspaces/{wid}/docs/{fileId}/updates` | Yjs updates for one file's contents |
| `/workspaces/{wid}/presence/{uid}` | Name, colour, open file, cursor |
| `/workspaces/{wid}/session` | Base commit sha, dirty flag, contributor uids, last edit time |
| `/invites/{token}` | Workspace id, role, expiry |

**Yjs documents**

- **Tree doc:** one `Y.Map` per workspace, keyed by file id, with `{path, type}`. Renames change `path` only, so open editors stay attached.
- **Markdown file:** a `Y.Text`, bound to the editor (CodeMirror 6 or Tiptap).
- **Excalidraw file:** a `Y.Map` of element id → element JSON, plus `appState` fields worth sharing. Merges follow Excalidraw's own `version` / `versionNonce` rules.

## Auth and permissions

Users sign in with Firebase Auth. Commits go through a GitHub App installed only on workspace repos, and they credit each user as a co-author. Users never hand the browser broad `repo` access.

- **Sign-in:** Firebase Auth with the GitHub provider, plus Google as an option. A GitHub identity is needed only to show up as a GitHub-linked co-author.
- **Repo access:** a GitHub App with `contents: read/write` on the selected repos. Its private key lives in Secret Manager and is used only by Cloud Functions.
- **Workspace roles:** stored in `members`. Realtime Database security rules allow reads for any member, writes to `tree`, `docs` and `presence` for editors and owners, and changes to `members` only through Cloud Functions.
- **Invites:** an owner creates an invite token with a role and an expiry. The invitee opens the link and signs in, then a function checks the token, adds them to `members` and deletes the token.
- **Server calls:** every Cloud Function checks the Firebase ID token and the caller's role before it touches GitHub or the AI API.

**Fallback mode (solo use):** if the app is only for one person, skip the GitHub App and commit from the client with the user's OAuth token from GitHub sign-in. Firebase hands that token over only at sign-in and does not refresh it, so the app must keep it.

## Real-time collaboration and session lifecycle

Live edits are Yjs updates carried by Realtime Database. GitHub is loaded at the start of a session and written to at checkpoints, never on every keystroke.

**Session lifecycle**

1. **Open:** the client reads `/workspaces/{wid}/session`. If a live session exists, it joins by replaying the tree and doc updates. If not, it loads HEAD from GitHub, seeds the Yjs docs and records the base sha.
2. **Edit:** local changes become Yjs updates that are appended under `docs/{fileId}/updates`. Peers subscribe and apply them, and Yjs merges concurrent edits without conflicts.
3. **Presence:** each client writes its entry under `presence` and registers `onDisconnect().remove()`. Cursors and selections use Yjs awareness, also relayed through `presence`.
4. **Checkpoint:** a function commits the merged state to GitHub (see the next section), then compacts each doc's update log into a single snapshot.
5. **Close:** when presence is empty and the last checkpoint is clean, the live state can be cleared. The next open starts again from GitHub.

**Implementation notes**

- Use a small custom Yjs provider over Realtime Database, or adapt a community one. Batch updates every 100–300 ms to keep write counts down.
- Compaction matters: without it, joining a long session means replaying thousands of small updates.
- Firebase Hosting serves only static files. If Realtime Database becomes the bottleneck, swap the provider for `y-websocket` or Hocuspocus on Cloud Run without changing the editors.

## GitHub persistence and commit strategy

A `commitWorkspace` Cloud Function writes every changed file in one atomic commit and credits everyone who edited since the last checkpoint.

**Triggers**

- Idle: no edits for 2 minutes while `session.dirty` is true.
- Interval: at most every 10 minutes during continuous editing.
- Manual: a "Save version" button, with an optional commit message.
- Session end: the last person leaves.

**Commit steps (Git Data API)**

1. Read the branch ref and compare it with the session's base sha.
2. Create blobs for changed `.md`, `.excalidraw` and exported `.svg` files.
3. Create a tree on the base tree, including deletes and renames from the tree doc.
4. Create a commit with the message and `Co-authored-by:` trailers, then move the ref.
5. Store the new sha as the base and clear `dirty` and the contributor list.

**Example commit message**

```
Update notes/ideas.md, drawings/system-map.excalidraw

Co-authored-by: Ada <ada@users.noreply.github.com>
Co-authored-by: locusmind AI <ai@locusmind.app>
```

**Out-of-band changes:** if the ref moved because someone pushed directly, the function does a three-way merge for markdown files against the base. If a merge fails, it commits to a `locusmind/conflict-<date>` branch and flags the session in the UI. It never force-pushes.

## AI integration

The AI joins the session as a collaborator: its edits arrive as Yjs updates that everyone sees live and can undo. Every call goes through a Cloud Function, so the API key never reaches the browser.

**Request flow**

1. The user asks in the AI panel and can attach the open file, selected text or other files from the tree.
2. `aiAssist` checks the caller's role and loads the current file contents from the live Yjs state.
3. The model is called with tools, for example `read_file`, `list_files`, `edit_markdown(fileId, range, text)`, `create_file(path, content)` and `add_excalidraw_elements(fileId, elements)`.
4. The function turns each tool call into a Yjs update and writes it to Realtime Database. It streams the chat reply back to the panel.

**Behaviour**

- The AI shows in presence as "AI" with its own colour, and it is credited in the next commit's co-authors.
- Edits are applied as small, separate changes so a user can undo just the AI's change with Yjs `UndoManager` tracking that origin.
- Optional review mode: the AI suggests a diff in the panel and nothing is applied until someone accepts it.
- Excalidraw: v1 reads drawings (via element text and the SVG export) and adds simple elements such as boxes, arrows and labels. Full layout editing comes later.
- Limits: per-user rate limits and a cap on context size per request, enforced in the function.

## Risks, open questions and build plan

**Risks**

| Risk | Mitigation |
| --- | --- |
| Realtime Database write volume grows with keystrokes | Batch Yjs updates, compact on checkpoint, move to Cloud Run WebSockets if needed |
| Someone pushes to the repo directly during a live session | Check the base sha on commit, three-way merge, conflict branch as a fallback |
| Excalidraw merges produce odd results | Use element-level maps and Excalidraw's version rules, add an "undo AI" path |
| AI edits are wrong or too broad | Small edits, origin-tracked undo, optional review mode |
| Cost of Blaze plan plus AI API | Per-user rate limits, usage dashboard, idle-session cleanup |

**Open questions**

- [ ] One repo per workspace, or one repo with many workspace folders?
- [ ] Which markdown editor: CodeMirror 6 (source view) or Tiptap (rich text)?
- [ ] Is review mode for AI edits on by default?
- [ ] Is a GitHub identity required for every collaborator?

**Build plan**

1. **Single user:** Firebase Auth, a file tree and CRUD backed directly by the GitHub API, with debounced commits.
2. **Editors:** embed markdown and Excalidraw editors, plus SVG export on save.
3. **Live sync:** Yjs and a Realtime Database provider, the session lifecycle, and checkpoint commits through the GitHub App.
4. **Sharing:** roles, invite links, presence and cursors, and co-author credits.
5. **AI:** the `aiAssist` function, tool calls applied as Yjs updates, and review mode.

Each phase leaves a working app. Phase 3 is the largest and riskiest, so it is worth prototyping early with two browser windows.
