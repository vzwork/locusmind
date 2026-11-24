import { lazy, Suspense, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertCircle,
  Check,
  Github,
  PanelLeftOpen,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import {
  createStarterWorkspace,
  getFileName,
  loadWorkspace,
  mergeGithubFiles,
  persistWorkspace,
  type GithubBase,
  type WorkspaceFile,
} from "./workspace";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  auth,
  beginGithubRepositoryAuthorization,
  completeGithubRepositoryAuthorization,
  isFirebaseConfigured,
  signInWithGithub,
  signOutFromFirebase,
} from "./firebase";
import { Sidebar } from "./components/Sidebar";
import { Breadcrumbs } from "./components/Breadcrumbs";
import { RepositoryPicker } from "./components/RepositoryPicker";
import { getGithubSyncChanges, importGithubRepository, loadGithubToken, loadSelectedRepository, removeGithubToken, saveGithubToken, syncGithubWorkspace, type SelectedRepository } from "./github";
import { useGithubRepositories } from "./useGithubRepositories";
import { ExplorerPanel } from "./explorer/ExplorerPanel";
import type { Notice } from "./explorer/types";
import { useCollapsedFolders } from "./explorer/useCollapsedFolders";
import { useExplorerActions } from "./explorer/useExplorerActions";
import { useWorkspaceSelection } from "./explorer/useWorkspaceSelection";

const DrawingEditor = lazy(() => import("./DrawingEditor"));

type ViewMode = "edit" | "preview" | "split";

type WorkspaceDialog =
  | { type: "reset" }
  | { type: "sync"; base: GithubBase; files: WorkspaceFile[] };

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [signInPending, setSignInPending] = useState(false);
  const [showAuthScreen, setShowAuthScreen] = useState(false);
  const [githubSession, setGithubSession] = useState<{ userId: string; token: string } | null>(null);
  const previousUserId = useRef<string | null>(null);
  const attemptedUserId = useRef<string | null>(null);
  const [redirectReady, setRedirectReady] = useState(false);
  const [authorizationPending, setAuthorizationPending] = useState(false);
  const [authorizationError, setAuthorizationError] = useState("");

  useEffect(() => {
    let active = true;
    completeGithubRepositoryAuthorization().then(
      (session) => {
        if (!active || !session) return;
        setGithubSession(session);
        try {
          saveGithubToken(session.userId, session.token);
        } catch {
          setAuthError("Could not save GitHub access in browser storage.");
        }
      },
      (error: unknown) => {
        if (active) {
          setAuthorizationError(error instanceof Error ? error.message : "Could not complete GitHub authorization.");
        }
      },
    ).finally(() => {
      if (active) setRedirectReady(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return;
    }

    return onAuthStateChanged(
      auth,
      (nextUser) => {
        setUser(nextUser);
        try {
          if (previousUserId.current && previousUserId.current !== nextUser?.uid) {
            removeGithubToken(previousUserId.current);
          }
          const token = nextUser ? loadGithubToken(nextUser.uid) : null;
          setGithubSession((current) =>
            current?.userId === nextUser?.uid ? current : nextUser && token ? { userId: nextUser.uid, token } : null,
          );
          setAuthError("");
        } catch {
          setGithubSession(null);
          setAuthError("Could not read or remove GitHub access in browser storage.");
        }
        previousUserId.current = nextUser?.uid ?? null;
        if (nextUser) {
          setShowAuthScreen(false);
        }
        setAuthLoading(false);
      },
      (error) => {
        setAuthError(error.message);
        setAuthLoading(false);
      },
    );
  }, []);

  function reconnectGithub(currentUser: User) {
    attemptedUserId.current = currentUser.uid;
    setAuthorizationError("");
    setAuthorizationPending(true);
    void beginGithubRepositoryAuthorization(currentUser).catch((error: unknown) => {
      setAuthorizationError(error instanceof Error ? error.message : "Could not start GitHub authorization.");
      setAuthorizationPending(false);
    });
  }

  const githubToken = user && githubSession?.userId === user.uid ? githubSession.token : null;
  const shouldAuthorize = Boolean(
    user && !githubToken && !authLoading && redirectReady && !signInPending &&
    !authError && !authorizationError && attemptedUserId.current !== user.uid,
  );

  useEffect(() => {
    if (shouldAuthorize && user && attemptedUserId.current !== user.uid) reconnectGithub(user);
  }, [shouldAuthorize, user]);

  async function handleSignIn() {
    setSignInPending(true);
    setAuthError("");
    try {
      const session = await signInWithGithub();
      setGithubSession(session);
      try {
        saveGithubToken(session.userId, session.token);
      } catch {
        setAuthError("Could not save GitHub access in browser storage. Sign in again after reloading.");
      }
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "Could not sign in with GitHub.",
      );
    } finally {
      setSignInPending(false);
    }
  }

  async function handleSignOut() {
    setAuthError("");
    try {
      await signOutFromFirebase();
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "Could not sign out.",
      );
    }
  }

  function handleGuestEntry() {
    setAuthError("");
    setShowAuthScreen(false);
  }

  function handleGuestExit() {
    setAuthError("");
    setShowAuthScreen(true);
  }

  if (authLoading || !redirectReady || signInPending || authorizationPending || shouldAuthorize) {
    return (
      <main className="auth-screen" aria-busy="true">
        <p className="auth-loading">
          <span className="loading-spinner" aria-hidden="true" />
          {authorizationPending || shouldAuthorize
            ? "Opening GitHub to authorize repository access…"
            : signInPending ? "Signing in and connecting to GitHub…" : "Checking your sign-in…"}
        </p>
      </main>
    );
  }

  if (!user && showAuthScreen) {
    return (
      <AuthScreen
        setupRequired={!isFirebaseConfigured}
        pending={signInPending}
        error={authError}
        onSignIn={handleSignIn}
        onGuestEntry={handleGuestEntry}
      />
    );
  }

  return (
    <WorkspaceApp
      key={user ? `user:${user.uid}` : "guest"}
      user={user}
      githubToken={githubToken}
      authError={authError || authorizationError}
      onReconnect={() => { if (user) reconnectGithub(user); }}
      onSignOut={user ? handleSignOut : handleGuestExit}
    />
  );
}

type AuthScreenProps = {
  setupRequired: boolean;
  pending: boolean;
  error: string;
  onSignIn: () => void;
  onGuestEntry: () => void;
};

function AuthScreen({ setupRequired, pending, error, onSignIn, onGuestEntry }: AuthScreenProps) {
  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          <div className="brand-mark" aria-hidden="true">
            <Sparkles size={16} strokeWidth={2.2} />
          </div>
          <span className="brand-name">locusmind</span>
        </div>
        <h1 id="auth-title">A space to think, connected to you.</h1>
        <p className="auth-description">
          Sign in with GitHub or continue as a guest to open your workspace.
        </p>
        <p className="auth-permission">
          GitHub sign-in requests repo access, including read and write access to private repositories, so you can select a sync target.
          The access token is stored in this browser and can be accessed by scripts running on this site.
        </p>
        {setupRequired ? (
          <p className="auth-setup-message" role="status">
            Firebase Auth is not configured. Add the Firebase web app settings
            to <code>.env.local</code> and enable GitHub sign-in in Firebase
            Console.
          </p>
        ) : (
          <button
            className="github-sign-in"
            onClick={onSignIn}
            disabled={pending}
          >
            <Github size={18} />
            {pending ? "Connecting to GitHub…" : "Continue with GitHub"}
          </button>
        )}
        <button className="guest-sign-in" onClick={onGuestEntry} disabled={pending}>
          Continue as guest
        </button>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <p className="auth-footnote">
          Your notes are stored in this browser. Guest and GitHub workspaces
          are separate; signing in does not merge or sync them.
        </p>
      </section>
    </main>
  );
}

type WorkspaceAppProps = {
  user: User | null;
  githubToken: string | null;
  authError: string;
  onReconnect: () => void;
  onSignOut: () => void;
};

function WorkspaceApp({ user, githubToken, authError, onReconnect, onSignOut }: WorkspaceAppProps) {
  const userId = user?.uid ?? null;
  const githubRepositories = useGithubRepositories(githubToken);
  const [initialState] = useState(() => loadWorkspace(userId));
  const [workspace, setWorkspace] = useState(initialState.workspace);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const importController = useRef<AbortController | null>(null);
  const syncController = useRef<AbortController | null>(null);
  const [storageError, setStorageError] = useState(initialState.error);
  const [canPersist, setCanPersist] = useState(initialState.error === null);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const [splitPosition, setSplitPosition] = useState(50);
  const documentRef = useRef<HTMLElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dialog, setDialog] = useState<WorkspaceDialog | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [repositoryPickerOpen, setRepositoryPickerOpen] = useState(false);
  const [importingRepository, setImportingRepository] = useState(false);
  const [creatingRepository, setCreatingRepository] = useState(false);
  const [repositoryState] = useState(() => {
    try {
      return { repository: initialState.workspace.githubBase?.repository ?? (userId ? loadSelectedRepository(userId) : null), error: "" };
    } catch {
      return { repository: null, error: "Could not read the selected GitHub repository from browser storage." };
    }
  });
  const [repository, setRepository] = useState(repositoryState.repository);
  const [repositoryError, setRepositoryError] = useState(repositoryState.error);

  useEffect(() => () => {
    importController.current?.abort();
    syncController.current?.abort();
  }, []);

  const collapse = useCollapsedFolders();
  const { selection, locationError, activeFile, navigate } = useWorkspaceSelection(
    workspace,
    collapse.reveal,
  );
  const explorer = useExplorerActions({
    workspace,
    setWorkspace,
    selection,
    activeFile,
    navigate,
    collapse,
    notify: setNotice,
    undoEnabled: dialog === null && !repositoryPickerOpen,
  });

  useEffect(() => {
    if (!canPersist) return;
    const timeout = window.setTimeout(() => {
      try {
        persistWorkspace(userId, workspace);
        setStorageError(null);
      } catch {
        setStorageError("Could not save this workspace in browser storage.");
      }
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [workspace, canPersist, userId]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function updateFile(fileId: string, changes: Partial<WorkspaceFile>) {
    setWorkspace((current) => ({
      ...current,
      files: current.files.map((file) =>
        file.id === fileId
          ? { ...file, ...changes, updatedAt: new Date().toISOString() }
          : file,
      ),
    }));
  }

  function resizeSplit(clientX: number) {
    const bounds = documentRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 12) return;
    const position = ((clientX - bounds.left - 6) / (bounds.width - 12)) * 100;
    setSplitPosition(Math.min(80, Math.max(20, position)));
  }

  function addFile(type: WorkspaceFile["type"]) {
    explorer.createFile(type);
    setSearch("");
    setSidebarOpen(true);
    setViewMode("edit");
  }

  function addFolder() {
    explorer.createFolder();
    setSearch("");
    setSidebarOpen(true);
  }

  function resetWorkspace() {
    setDialog({ type: "reset" });
  }

  async function submitDialog(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;

    if (dialog.type === "sync") {
      if (!githubToken || syncController.current) return;
      const controller = new AbortController();
      syncController.current = controller;
      setSyncing(true);
      setSyncError("");
      try {
        const commit = await syncGithubWorkspace(dialog.base, dialog.files, githubToken, controller.signal);
        if (controller.signal.aborted) return;
        const currentBase = workspaceRef.current.githubBase;
        if (currentBase?.repository.id !== dialog.base.repository.id || currentBase.commit !== dialog.base.commit) {
          throw new Error("Changes were committed, but the workspace changed during sync. Reselect the repository to refresh its baseline.");
        }
        setWorkspace((current) => ({
          ...current,
          githubBase: { ...dialog.base, commit, files: dialog.files },
        }));
        setDialog(null);
        setNotice({ message: `Synced workspace to ${dialog.base.repository.full_name}.` });
      } catch (error) {
        if (!controller.signal.aborted) {
          setSyncError(error instanceof Error ? error.message : "Could not sync the workspace to GitHub.");
        }
      } finally {
        syncController.current = null;
        setSyncing(false);
      }
      return;
    }

    const freshWorkspace = createStarterWorkspace();
    try {
      persistWorkspace(userId, freshWorkspace);
      setWorkspace(freshWorkspace);
      explorer.resetHistory();
      const first = freshWorkspace.files[0];
      navigate(first ? { type: "file", id: first.id } : null, first?.path ?? "", true);
      setStorageError(null);
      setCanPersist(true);
      setDialog(null);
    } catch {
      setStorageError("Could not reset the workspace in browser storage.");
    }
  }

  function leaveWorkspace() {
    if (!user && canPersist) {
      try {
        persistWorkspace(userId, workspace);
      } catch {
        setStorageError("Could not save this workspace in browser storage.");
        return;
      }
    }
    onSignOut();
  }

  function reconnectWorkspace() {
    if (!canPersist) {
      setStorageError("Resolve the workspace storage error before reconnecting GitHub.");
      setRepositoryPickerOpen(false);
      return;
    }
    try {
      persistWorkspace(userId, workspace);
    } catch {
      setStorageError("Could not save this workspace before reconnecting GitHub.");
      setRepositoryPickerOpen(false);
      return;
    }
    onReconnect();
  }

  async function selectRepository(next: SelectedRepository) {
    if (!userId) throw new Error("Sign in to select a repository.");
    if (!githubToken) throw new Error("Reconnect GitHub to import a repository.");
    if (!canPersist) throw new Error("Resolve the workspace storage error before importing.");
    if (importController.current) throw new Error("A repository import is already in progress.");
    const controller = new AbortController();
    importController.current = controller;
    setImportingRepository(true);
    try {
      const result = await importGithubRepository(next, githubToken, controller.signal);
      if (controller.signal.aborted) return;
      const merged = mergeGithubFiles(workspaceRef.current, next, result.branch, result.commit, result.files);
      persistWorkspace(userId, merged);
      workspaceRef.current = merged;
      setWorkspace(merged);
      setRepository(next);
      setRepositoryError("");
      setRepositoryPickerOpen(false);
      setNotice({ message: `Imported ${result.files.length} files from ${next.full_name}.` });
    } finally {
      importController.current = null;
      setImportingRepository(false);
    }
  }

  const syncDisabledReason = !repository
    ? "Select a GitHub repository to sync."
    : !githubToken
      ? "Reconnect GitHub to sync."
      : !canPersist
        ? "Resolve the workspace storage error before syncing."
        : !workspace.githubBase || workspace.githubBase.repository.id !== repository.id
          ? "Reselect the repository to import it before syncing."
          : importingRepository ? "Wait for the repository import to finish." : "";
  const syncChanges = dialog?.type === "sync" ? getGithubSyncChanges(dialog.base, dialog.files) : null;

  return (
    <div className={`app-shell${sidebarOpen ? "" : " sidebar-closed"}`}>
      {sidebarOpen && (
        <Sidebar
          user={user}
          repositoryName={repository?.full_name ?? null}
          repositoryPickerOpen={repositoryPickerOpen}
          importing={importingRepository || creatingRepository}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          onRepositoryPickerOpenChange={setRepositoryPickerOpen}
          onClose={() => { setRepositoryPickerOpen(false); setSidebarOpen(false); }}
          repositoryPicker={
            <RepositoryPicker
              token={githubToken}
              repositories={githubRepositories.repositories}
              pending={githubRepositories.pending}
              loadError={githubRepositories.error}
              authorizationFailed={githubRepositories.authorizationFailed}
              onRetry={githubRepositories.retry}
              onReconnect={reconnectWorkspace}
              selected={repository}
              importing={importingRepository}
              creating={creatingRepository}
              onCreatingChange={setCreatingRepository}
              onSelect={selectRepository}
            />
          }
          onLeaveWorkspace={leaveWorkspace}
        >
          <ExplorerPanel
            workspace={workspace}
            selection={selection}
            navigate={navigate}
            actions={explorer}
            collapse={collapse}
            search={search}
            onSearchChange={setSearch}
            onCreateFile={addFile}
            onCreateFolder={addFolder}
            onSync={() => {
              if (syncDisabledReason || !workspace.githubBase) return;
              setSyncError("");
              setDialog({ type: "sync", base: workspace.githubBase, files: [...workspace.files] });
            }}
            syncDisabled={Boolean(syncDisabledReason)}
            syncDisabledReason={syncDisabledReason}
          />
        </Sidebar>
      )}

      <main className={`main-panel${activeFile?.type === "markdown" && viewMode === "split" ? " main-panel-split" : ""}`}>
        <header className="topbar">
          <div className="breadcrumbs">
            {!sidebarOpen && (
              <button
                className="icon-button open-sidebar"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open sidebar"
                title="Open sidebar"
              >
                <PanelLeftOpen size={17} />
              </button>
            )}
            <Breadcrumbs
              workspace={workspace}
              rootName={repository?.full_name ?? workspace.name}
              folders={explorer.allFolders}
              selection={selection}
              activeFile={activeFile}
              navigate={navigate}
              reveal={collapse.reveal}
            />
          </div>
          <div className="topbar-actions">
            {activeFile?.type === "markdown" && (
              <div className="view-switch" role="group" aria-label="View">
                <button
                  className={viewMode === "edit" ? "selected" : ""}
                  aria-pressed={viewMode === "edit"}
                  onClick={() => setViewMode("edit")}
                >
                  Edit
                </button>
                <button
                  className={viewMode === "preview" ? "selected" : ""}
                  aria-pressed={viewMode === "preview"}
                  onClick={() => setViewMode("preview")}
                >
                  Preview
                </button>
                <button
                  className={viewMode === "split" ? "selected" : ""}
                  aria-pressed={viewMode === "split"}
                  onClick={() => setViewMode("split")}
                >
                  Split
                </button>
              </div>
            )}
          </div>
        </header>

        {authError && (
          <div className="storage-alert" role="alert">
            <AlertCircle size={17} />
            <span>Authentication error: {authError}</span>
          </div>
        )}

        {githubRepositories.error && !repositoryPickerOpen && (
          <div className="storage-alert" role="alert">
            <AlertCircle size={17} />
            <span>{githubRepositories.error}</span>
            <button onClick={githubRepositories.authorizationFailed ? reconnectWorkspace : githubRepositories.retry}>
              {githubRepositories.authorizationFailed ? "Reconnect GitHub" : "Retry"}
            </button>
          </div>
        )}

        {repositoryError && (
          <div className="storage-alert" role="alert">
            <AlertCircle size={17} />
            <span>{repositoryError} Choose a repository again to replace it.</span>
          </div>
        )}

        {storageError && (
          <div className="storage-alert" role="alert">
            <AlertCircle size={17} />
            <span>{storageError} Your changes are not being saved.</span>
            {initialState.error && (
              <button onClick={resetWorkspace}>Start fresh</button>
            )}
          </div>
        )}

        {locationError && (
          <div className="storage-alert" role="alert">
            <AlertCircle size={17} />
            <span>{locationError}</span>
          </div>
        )}

        {activeFile ? (
          <article
            ref={documentRef}
            className={`document-shell${activeFile.type === "excalidraw" ? " document-shell-drawing" : activeFile.type === "markdown" && viewMode === "split" ? " document-shell-split" : ""}`}
          >
            {activeFile.type === "markdown" ? (
              <>
                {viewMode !== "preview" && (
                  <textarea
                    className="markdown-editor"
                    id="markdown-editor"
                    style={viewMode === "split" ? { flex: `0 0 calc((100% - 12px) * ${splitPosition / 100})` } : undefined}
                    value={activeFile.content}
                    onChange={(event) =>
                      updateFile(activeFile.id, { content: event.target.value })
                    }
                    placeholder="Start writing..."
                    aria-label="Markdown editor"
                    spellCheck
                  />
                )}
                {viewMode === "split" && (
                  <div
                    className="split-divider"
                    role="separator"
                    tabIndex={0}
                    aria-label="Resize editor and preview"
                    aria-orientation="vertical"
                    aria-controls="markdown-editor"
                    aria-valuemin={20}
                    aria-valuemax={80}
                    aria-valuenow={Math.round(splitPosition)}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeSplit(event.clientX);
                    }}
                    onDoubleClick={() => setSplitPosition(50)}
                    onKeyDown={(event) => {
                      const step = event.shiftKey ? 10 : 5;
                      if (event.key === "ArrowLeft") setSplitPosition((value) => Math.max(20, value - step));
                      else if (event.key === "ArrowRight") setSplitPosition((value) => Math.min(80, value + step));
                      else if (event.key === "Home") setSplitPosition(20);
                      else if (event.key === "End") setSplitPosition(80);
                      else return;
                      event.preventDefault();
                    }}
                  />
                )}
                {viewMode !== "edit" && (
                  <div className="markdown-preview">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {activeFile.content || "*Nothing to preview yet.*"}
                    </ReactMarkdown>
                  </div>
                )}
              </>
            ) : (
              <Suspense fallback={<div className="drawing-editor-wrap">Loading drawing…</div>}>
                <DrawingEditor
                  key={activeFile.id}
                  content={activeFile.content}
                  onChange={(content) => updateFile(activeFile.id, { content })}
                />
              </Suspense>
            )}

          </article>
        ) : (
          <div className="empty-workspace">
            <div className="empty-icon">
              <Sparkles size={22} />
            </div>
            <h1>{selection?.type === "folder" ? getFileName(selection.path) || "Workspace" : "Your next thought starts here."}</h1>
            <p>{selection?.type === "folder" ? "Select a file in this folder to open it." : "Create a note or sketch an idea to get your workspace going."}</p>
            <div className="empty-actions">
              <button
                className="save-version-button"
                onClick={() => addFile("markdown")}
              >
                <Plus size={16} />
                New note
              </button>
              <button
                className="secondary-button"
                onClick={() => addFile("excalidraw")}
              >
                <Plus size={16} />
                New drawing
              </button>
            </div>
          </div>
        )}

        {notice && (
          <div className="toast" role="status">
            <Check size={15} />
            {notice.message}
            {notice.undo && <button className="toast-undo" onClick={explorer.undoDelete}>Undo</button>}
            <button
              className="toast-close"
              onClick={() => setNotice(null)}
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </main>
      {dialog && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (!syncing && event.target === event.currentTarget) setDialog(null);
          }}
        >
          <form
            className="dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            aria-busy={syncing}
            onSubmit={submitDialog}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !syncing) {
                event.preventDefault();
                setDialog(null);
              } else if (event.key === "Tab") {
                const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
                if (!buttons.length) {
                  event.preventDefault();
                } else if (event.shiftKey && document.activeElement === buttons[0]) {
                  event.preventDefault();
                  buttons[buttons.length - 1].focus();
                } else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) {
                  event.preventDefault();
                  buttons[0].focus();
                }
              }
            }}
          >
            <button
              type="button"
              className="icon-button dialog-close"
              aria-label="Close dialog"
              onClick={() => setDialog(null)}
              disabled={syncing}
            >
              <X size={17} />
            </button>
            <div className="dialog-eyebrow">LOCUSMIND</div>
            {dialog.type === "sync" && syncChanges ? (
              <>
                <h2 id="dialog-title">Sync to GitHub?</h2>
                <p className="dialog-description">
                  Commit these changes to {dialog.base.repository.full_name} on {dialog.base.branch}.
                  Deleted files will also be deleted from GitHub.
                  {!dialog.base.commit && " An empty repository is initialized with the first file before the remaining files are committed."}
                </p>
                <div className="sync-changes" aria-label="Changes to sync">
                  {syncChanges.added.map((file) => <div key={file.path}>Add: {file.path}</div>)}
                  {syncChanges.modified.map((file) => <div key={file.path}>Modify: {file.path}</div>)}
                  {syncChanges.deleted.map((file) => <div key={file.path}>Delete: {file.path}</div>)}
                  {!syncChanges.added.length && !syncChanges.modified.length && !syncChanges.deleted.length && "No changes to sync."}
                </div>
                {syncError && <p className="auth-error" role="alert">{syncError}</p>}
              </>
            ) : (
              <>
                <h2 id="dialog-title">Start fresh?</h2>
                <p className="dialog-description">
                  Replace the unreadable saved workspace with a fresh workspace in this browser.
                </p>
              </>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setDialog(null)}
                disabled={syncing}
                autoFocus
              >
                Cancel
              </button>
              <button
                type="submit"
                className={dialog.type === "sync" ? "save-version-button" : "dialog-danger-button"}
                disabled={syncing || Boolean(syncChanges && !syncChanges.added.length && !syncChanges.modified.length && !syncChanges.deleted.length)}
              >
                {dialog.type === "sync" ? syncing ? "Syncing…" : "Commit changes" : "Start fresh"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
