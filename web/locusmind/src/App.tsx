import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertCircle,
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronRight,
  FileImage,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  Github,
  LogOut,
  PanelLeftClose,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  createFile,
  createStarterWorkspace,
  getFileName,
  getFolderName,
  getUniquePath,
  loadWorkspace,
  persistWorkspace,
  saveSnapshot,
  type WorkspaceFile,
} from "./workspace";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  auth,
  isFirebaseConfigured,
  signInWithGithub,
  signOutFromFirebase,
} from "./firebase";

type ViewMode = "edit" | "preview";
type WorkspaceDialog =
  | { type: "rename"; fileId: string }
  | { type: "delete"; fileId: string }
  | { type: "snapshot" }
  | { type: "reset" };

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatDate(date: string): string {
  return dateFormatter.format(new Date(date));
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [signInPending, setSignInPending] = useState(false);

  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return;
    }

    return onAuthStateChanged(
      auth,
      (nextUser) => {
        setUser(nextUser);
        setAuthError("");
        setAuthLoading(false);
      },
      (error) => {
        setAuthError(error.message);
        setAuthLoading(false);
      },
    );
  }, []);

  async function handleSignIn() {
    setSignInPending(true);
    setAuthError("");
    try {
      await signInWithGithub();
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

  if (authLoading) {
    return (
      <main className="auth-screen" aria-busy="true">
        <p className="auth-loading">Checking your sign-in…</p>
      </main>
    );
  }

  if (!isFirebaseConfigured || !user) {
    return (
      <AuthScreen
        setupRequired={!isFirebaseConfigured}
        pending={signInPending}
        error={authError}
        onSignIn={handleSignIn}
      />
    );
  }

  return (
    <WorkspaceApp
      key={user.uid}
      user={user}
      authError={authError}
      onSignOut={handleSignOut}
    />
  );
}

type AuthScreenProps = {
  setupRequired: boolean;
  pending: boolean;
  error: string;
  onSignIn: () => void;
};

function AuthScreen({ setupRequired, pending, error, onSignIn }: AuthScreenProps) {
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
          Sign in with GitHub to open your personal workspace.
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
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <p className="auth-footnote">
          Your notes are stored in this browser for now. Signing in does not
          sync them to GitHub.
        </p>
      </section>
    </main>
  );
}

type WorkspaceAppProps = {
  user: User;
  authError: string;
  onSignOut: () => void;
};

function WorkspaceApp({ user, authError, onSignOut }: WorkspaceAppProps) {
  const [initialState] = useState(() => loadWorkspace(user.uid));
  const [workspace, setWorkspace] = useState(initialState.workspace);
  const [activeFileId, setActiveFileId] = useState(
    initialState.workspace.files[0]?.id ?? "",
  );
  const [storageError, setStorageError] = useState(initialState.error);
  const [canPersist, setCanPersist] = useState(initialState.error === null);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [collapsedFolders, setCollapsedFolders] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<WorkspaceDialog | null>(null);
  const [dialogValue, setDialogValue] = useState("");

  const activeFile =
    workspace.files.find((file) => file.id === activeFileId) ??
    workspace.files[0];

  useEffect(() => {
    if (!canPersist) return;
    const timeout = window.setTimeout(() => {
      try {
        persistWorkspace(user.uid, workspace);
        setStorageError(null);
      } catch {
        setStorageError("Could not save this workspace in browser storage.");
      }
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [workspace, canPersist, user.uid]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 2800);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const filteredFiles = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return workspace.files;
    return workspace.files.filter(
      (file) =>
        file.path.toLowerCase().includes(query) ||
        file.content.toLowerCase().includes(query),
    );
  }, [search, workspace.files]);

  const folders = useMemo(
    () =>
      [...new Set(filteredFiles.map((file) => getFolderName(file.path)))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [filteredFiles],
  );

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

  function addFile(type: WorkspaceFile["type"]) {
    const file = createFile(type, getUniquePath(workspace.files, type));
    setWorkspace((current) => ({
      ...current,
      files: [...current.files, file],
    }));
    setActiveFileId(file.id);
    setViewMode("edit");
  }

  function renameFile(file: WorkspaceFile) {
    setDialogValue(getFileName(file.path));
    setDialog({ type: "rename", fileId: file.id });
  }

  function deleteFile(file: WorkspaceFile) {
    setDialog({ type: "delete", fileId: file.id });
  }

  function saveVersion() {
    setDialogValue(`Workspace version — ${new Date().toLocaleString()}`);
    setDialog({ type: "snapshot" });
  }

  function resetWorkspace() {
    setDialog({ type: "reset" });
  }

  function submitDialog(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;

    if (dialog.type === "rename") {
    const file = workspace.files.find(
      (candidate) => candidate.id === dialog.fileId,
    );
    if (!file) {
      setDialog(null);
      return;
    }
    const name = dialogValue.trim();
    if (!name) {
      setNotice("A file name cannot be empty.");
      return;
    }

    const extension = file.type === "markdown" ? ".md" : ".excalidraw";
    const baseName = name
      .replace(/\.(md|excalidraw)$/i, "")
      .replace(/[\\/]/g, "-");
    if (!baseName || baseName === "." || baseName === "..") {
      setNotice("Choose a valid file name.");
      return;
    }
    const path = `${getFolderName(file.path)}/${baseName}${extension}`;
    if (
      workspace.files.some(
        (candidate) => candidate.id !== file.id && candidate.path === path,
      )
    ) {
      setNotice("A file with that name already exists.");
      return;
    }
    updateFile(file.id, { path });
    setDialog(null);
      return;
    }

    if (dialog.type === "delete") {
    const remaining = workspace.files.filter(
      (candidate) => candidate.id !== dialog.fileId,
    );
    setWorkspace((current) => ({ ...current, files: remaining }));
    if (activeFileId === dialog.fileId) {
      setActiveFileId(remaining[0]?.id ?? "");
    }
    setDialog(null);
      return;
    }

    if (dialog.type === "snapshot") {
    const message = dialogValue.trim();
    if (!message) {
      setNotice("Add a name to save a version.");
      return;
    }
    setWorkspace((current) => saveSnapshot(current, message));
    setNotice("Version saved in this browser.");
    setDialog(null);
    return;
    }

    const freshWorkspace = createStarterWorkspace();
    try {
      persistWorkspace(user.uid, freshWorkspace);
      setWorkspace(freshWorkspace);
      setActiveFileId(freshWorkspace.files[0]?.id ?? "");
      setStorageError(null);
      setCanPersist(true);
    setDialog(null);
    } catch {
      setStorageError("Could not reset the workspace in browser storage.");
    }
  }

  function toggleFolder(folder: string) {
    setCollapsedFolders((current) =>
      current.includes(folder)
        ? current.filter((value) => value !== folder)
        : [...current, folder],
    );
  }

  function downloadFile(file: WorkspaceFile) {
    const blob = new Blob([file.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = getFileName(file.path);
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={`app-shell${sidebarOpen ? "" : " sidebar-closed"}`}>
      {sidebarOpen && (
        <aside className="sidebar">
          <div className="brand-row">
            <div className="brand-mark" aria-hidden="true">
              <Sparkles size={16} strokeWidth={2.2} />
            </div>
            <span className="brand-name">locusmind</span>
            <button
              className="icon-button sidebar-toggle"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close sidebar"
              title="Close sidebar"
            >
              <PanelLeftClose size={17} />
            </button>
          </div>

          <button className="workspace-picker">
            <span className="workspace-avatar">L</span>
            <span className="workspace-picker-copy">
              <span className="workspace-label">WORKSPACE</span>
              <span className="workspace-name">{workspace.name}</span>
            </span>
            <ChevronDown size={16} className="muted-icon" />
          </button>

          <div className="sidebar-section-heading">
            <span>YOUR SPACE</span>
            <div className="section-actions">
              <button
                className="icon-button small-icon"
                onClick={() => addFile("markdown")}
                aria-label="Create note"
                title="Create note"
              >
                <FilePlus2 size={15} />
              </button>
              <button
                className="icon-button small-icon"
                onClick={() => addFile("excalidraw")}
                aria-label="Create drawing"
                title="Create drawing"
              >
                <FolderPlus size={15} />
              </button>
            </div>
          </div>

          <label className="search-field">
            <Search size={15} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find anything..."
              aria-label="Search files"
            />
            {search && (
              <button
                className="search-clear"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                type="button"
              >
                <X size={14} />
              </button>
            )}
          </label>

          <nav className="file-navigation" aria-label="Workspace files">
            {folders.length === 0 && (
              <p className="empty-search">No matching files</p>
            )}
            {folders.map((folder) => {
              const isCollapsed = collapsedFolders.includes(folder);
              const files = filteredFiles
                .filter((file) => getFolderName(file.path) === folder)
                .sort((a, b) => a.path.localeCompare(b.path));
              return (
                <section className="folder-group" key={folder}>
                  <button
                    className="folder-heading"
                    onClick={() => toggleFolder(folder)}
                    aria-expanded={!isCollapsed}
                  >
                    {isCollapsed ? (
                      <ChevronRight size={14} />
                    ) : (
                      <ChevronDown size={14} />
                    )}
                    <Folder size={15} className="folder-icon" />
                    <span>{folder}</span>
                    <span className="folder-count">{files.length}</span>
                  </button>
                  {!isCollapsed && (
                    <div className="file-list">
                      {files.map((file) => (
                        <FileRow
                          key={file.id}
                          file={file}
                          active={file.id === activeFile?.id}
                          onOpen={() => setActiveFileId(file.id)}
                          onRename={() => renameFile(file)}
                          onDelete={() => deleteFile(file)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </nav>

          <div className="sidebar-bottom">
            <div className="local-storage-status">
              <span className="status-dot" />
              Stored in this browser
            </div>
            <div className="profile-row">
              {user.photoURL ? (
                <img
                  className="profile-avatar"
                  src={user.photoURL}
                  alt=""
                />
              ) : (
                <div className="profile-avatar">
                  {user.displayName?.[0] ?? user.email?.[0] ?? "G"}
                </div>
              )}
              <div className="profile-copy">
                <span className="profile-name">
                  {user.displayName || user.email || "GitHub user"}
                </span>
                <span className="profile-role">Signed in with GitHub</span>
              </div>
            </div>
          </div>
        </aside>
      )}

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs">
            {!sidebarOpen && (
              <button
                className="icon-button open-sidebar"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open sidebar"
              >
                <PanelLeftClose size={17} />
              </button>
            )}
            <span className="breadcrumb-workspace">{workspace.name}</span>
            <ChevronRight size={14} />
            <span className="breadcrumb-current">
              {activeFile ? getFolderName(activeFile.path) : "Workspace"}
            </span>
            {activeFile && (
              <>
                <ChevronRight size={14} />
                <span className="breadcrumb-current strong">
                  {getFileName(activeFile.path)}
                </span>
              </>
            )}
          </div>
          <div className="topbar-actions">
            <span className="sync-label">
              <span className="status-dot" />
              Local workspace
            </span>
            <button className="save-version-button" onClick={saveVersion}>
              <ArrowDownToLine size={15} />
              <span>Save version</span>
            </button>
            <button
              className="icon-button sign-out-control"
              onClick={onSignOut}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>

        {authError && (
          <div className="storage-alert" role="alert">
            <AlertCircle size={17} />
            <span>Authentication error: {authError}</span>
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

        {activeFile ? (
          <article className="document-shell">
            <div className="document-toolbar">
              <div className="document-type">
                {activeFile.type === "markdown" ? (
                  <FileText size={16} />
                ) : (
                  <FileImage size={16} />
                )}
                <span>
                  {activeFile.type === "markdown"
                    ? "Markdown note"
                    : "Excalidraw file"}
                </span>
              </div>
              <div className="document-actions">
                <button
                  className="icon-button document-action"
                  onClick={() => downloadFile(activeFile)}
                  aria-label="Download file"
                  title="Download file"
                >
                  <ArrowDownToLine size={16} />
                </button>
                {activeFile.type === "markdown" && (
                  <div className="view-switch" role="group" aria-label="View">
                    <button
                      className={viewMode === "edit" ? "selected" : ""}
                      onClick={() => setViewMode("edit")}
                    >
                      Edit
                    </button>
                    <button
                      className={viewMode === "preview" ? "selected" : ""}
                      onClick={() => setViewMode("preview")}
                    >
                      Preview
                    </button>
                  </div>
                )}
                <button
                  className="icon-button document-action"
                  onClick={() => renameFile(activeFile)}
                  aria-label="Rename file"
                  title="Rename file"
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="icon-button document-action danger-hover"
                  onClick={() => deleteFile(activeFile)}
                  aria-label="Delete file"
                  title="Delete file"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>

            <div className="document-heading">
              <input
                className="document-title"
                value={getFileName(activeFile.path).replace(
                  /\.(md|excalidraw)$/i,
                  "",
                )}
                onChange={(event) => {
                  const name = event.target.value
                    .replace(/\.(md|excalidraw)$/i, "")
                    .replace(/[\\/]/g, "-")
                    .trim();
                  if (!name || name === "." || name === "..") return;
                  const extension =
                    activeFile.type === "markdown" ? ".md" : ".excalidraw";
                  const path = `${getFolderName(activeFile.path)}/${name}${extension}`;
                  if (
                    workspace.files.some(
                      (file) => file.id !== activeFile.id && file.path === path,
                    )
                  ) {
                    setNotice("A file with that name already exists.");
                    return;
                  }
                  updateFile(activeFile.id, { path });
                }}
                aria-label="File title"
              />
              <div className="document-meta">
                <span>Edited {formatDate(activeFile.updatedAt)}</span>
                <span className="meta-separator">·</span>
                <span>
                  {activeFile.type === "markdown"
                    ? `${activeFile.content.trim().split(/\s+/).filter(Boolean).length} words`
                    : "Excalidraw document"}
                </span>
              </div>
            </div>

            {activeFile.type === "markdown" ? (
              viewMode === "edit" ? (
                <textarea
                  className="markdown-editor"
                  value={activeFile.content}
                  onChange={(event) =>
                    updateFile(activeFile.id, { content: event.target.value })
                  }
                  placeholder="Start writing..."
                  aria-label="Markdown editor"
                  spellCheck
                />
              ) : (
                <div className="markdown-preview">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {activeFile.content || "*Nothing to preview yet.*"}
                  </ReactMarkdown>
                </div>
              )
            ) : (
              <div className="drawing-editor-wrap">
                <div className="drawing-callout">
                  <div className="drawing-icon">
                    <FileImage size={19} />
                  </div>
                  <div>
                    <h2>Drawing document</h2>
                    <p>
                      Edit the Excalidraw scene data below or download it to
                      open in Excalidraw.
                    </p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() =>
                      updateFile(activeFile.id, {
                        content: JSON.stringify(
                          {
                            type: "excalidraw",
                            version: 2,
                            source: "locusmind",
                            elements: [],
                            appState: {},
                            files: {},
                          },
                          null,
                          2,
                        ),
                      })
                    }
                  >
                    Reset scene
                  </button>
                </div>
                <textarea
                  className="drawing-editor"
                  value={activeFile.content}
                  onChange={(event) =>
                    updateFile(activeFile.id, { content: event.target.value })
                  }
                  aria-label="Excalidraw scene JSON"
                  spellCheck={false}
                />
              </div>
            )}

            <footer className="document-footer">
              <span>
                <Check size={14} />
                {storageError ? "Changes not saved" : "All changes saved"}
              </span>
              <span>
                {activeFile.type === "markdown" ? "Markdown" : "Excalidraw"}
                <span className="meta-separator"> · </span>
                {workspace.snapshots.length}{" "}
                {workspace.snapshots.length === 1 ? "version" : "versions"}
              </span>
            </footer>
          </article>
        ) : (
          <div className="empty-workspace">
            <div className="empty-icon">
              <Sparkles size={22} />
            </div>
            <h1>Your next thought starts here.</h1>
            <p>Create a note or sketch an idea to get your workspace going.</p>
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
            {notice}
            <button
              className="toast-close"
              onClick={() => setNotice("")}
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
            if (event.target === event.currentTarget) setDialog(null);
          }}
        >
          <form
            className="dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onSubmit={submitDialog}
          >
            <button
              type="button"
              className="icon-button dialog-close"
              aria-label="Close dialog"
              onClick={() => setDialog(null)}
            >
              <X size={17} />
            </button>
            <div className="dialog-eyebrow">LOCUSMIND</div>
            <h2 id="dialog-title">
              {dialog.type === "rename"
                ? "Rename file"
                : dialog.type === "delete"
                  ? "Delete this file?"
                  : dialog.type === "snapshot"
                    ? "Save a version"
                    : "Start fresh?"}
            </h2>
            {dialog.type === "rename" || dialog.type === "snapshot" ? (
              <label className="dialog-label">
                {dialog.type === "rename" ? "File name" : "Version name"}
                <input
                  autoFocus
                  value={dialogValue}
                  onChange={(event) => setDialogValue(event.target.value)}
                  aria-label={
                    dialog.type === "rename" ? "File name" : "Version name"
                  }
                />
              </label>
            ) : (
              <p className="dialog-description">
                {dialog.type === "delete"
                  ? `“${getFileName(workspace.files.find((file) => file.id === dialog.fileId)?.path ?? "")}” will be removed from this workspace.`
                  : "Replace the unreadable saved workspace with a fresh workspace in this browser."}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setDialog(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={
                  dialog.type === "delete" || dialog.type === "reset"
                    ? "dialog-danger-button"
                    : "save-version-button"
                }
              >
                {dialog.type === "rename"
                  ? "Save name"
                  : dialog.type === "delete"
                    ? "Delete file"
                    : dialog.type === "snapshot"
                      ? "Save version"
                      : "Start fresh"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

type FileRowProps = {
  file: WorkspaceFile;
  active: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
};

function FileRow({ file, active, onOpen, onRename, onDelete }: FileRowProps) {
  return (
    <div className={`file-row-wrap${active ? " active" : ""}`}>
      <button className="file-row" onClick={onOpen} title={file.path}>
        {file.type === "markdown" ? (
          <FileText size={15} />
        ) : (
          <FileImage size={15} />
        )}
        <span>{getFileName(file.path)}</span>
      </button>
      <div className="file-row-menu">
        <button
          className="icon-button file-more"
          onClick={onRename}
          aria-label={`Rename ${getFileName(file.path)}`}
          title="Rename"
        >
          <Pencil size={13} />
        </button>
        <button
          className="icon-button file-more danger-hover"
          onClick={onDelete}
          aria-label={`Delete ${getFileName(file.path)}`}
          title="Delete"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
