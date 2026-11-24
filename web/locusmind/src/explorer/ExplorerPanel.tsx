import { FilePlus2, FolderPlus, PencilRuler, RefreshCw, Search, X } from "lucide-react";
import { getGithubChanges, type Workspace, type WorkspaceFile } from "../workspace";
import { FileExplorer } from "./FileExplorer";
import type { Selection } from "./types";
import type { CollapsedFolders } from "./useCollapsedFolders";
import type { ExplorerActions } from "./useExplorerActions";
import type { Navigate } from "./useWorkspaceSelection";

type Props = {
  workspace: Workspace;
  selection: Selection;
  navigate: Navigate;
  actions: ExplorerActions;
  collapse: CollapsedFolders;
  search: string;
  onSearchChange: (value: string) => void;
  onCreateFile: (type: WorkspaceFile["type"]) => void;
  onCreateFolder: () => void;
  onSync: () => void;
  syncDisabled: boolean;
  syncDisabledReason: string;
};

export function ExplorerPanel({
  workspace,
  selection,
  navigate,
  actions,
  collapse,
  search,
  onSearchChange,
  onCreateFile,
  onCreateFolder,
  onSync,
  syncDisabled,
  syncDisabledReason,
}: Props) {
  const deleted = workspace.githubBase ? getGithubChanges(workspace).deleted : [];
  return (
    <>
      <button
        className="sync-button"
        onClick={onSync}
        disabled={syncDisabled}
        title={syncDisabled ? syncDisabledReason : "Review and sync workspace changes to GitHub"}
      >
        <RefreshCw size={15} />
        Sync to GitHub
      </button>
      {syncDisabled && syncDisabledReason && <p className="sync-hint">{syncDisabledReason}</p>}
      <label className="search-field explorer-search">
        <Search size={15} />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Find anything..."
          aria-label="Search files"
        />
        {search && (
          <button
            className="search-clear"
            onClick={() => onSearchChange("")}
            aria-label="Clear search"
            type="button"
          >
            <X size={14} />
          </button>
        )}
      </label>

      <div className="section-actions">
        <button
          className="icon-button small-icon"
          onClick={() => onCreateFile("markdown")}
          aria-label="Create note"
          title="Create note"
        >
          <FilePlus2 size={15} />
        </button>
        <button
          className="icon-button small-icon"
          onClick={() => onCreateFile("excalidraw")}
          aria-label="Create drawing"
          title="Create drawing"
        >
          <PencilRuler size={15} />
        </button>
        <button
          className="icon-button small-icon"
          onClick={onCreateFolder}
          aria-label="Create folder"
          title="Create folder"
        >
          <FolderPlus size={15} />
        </button>
      </div>

      {actions.error && (
        <div className="explorer-error" role="alert">
          <span>{actions.error}</span>
          <button onClick={actions.clearError} aria-label="Dismiss error">
            <X size={14} />
          </button>
        </div>
      )}

      {workspace.githubBase && <div className="explorer-change-heading">Uncommitted changes</div>}
      <FileExplorer
        workspace={workspace}
        query={search}
        selection={selection}
        navigate={navigate}
        actions={actions}
        collapse={collapse}
      />
      {deleted.length > 0 && (
        <div className="explorer-deleted" aria-label="Deleted uncommitted files">
          <strong>Deleted from workspace</strong>
          {deleted.map((path) => <div key={path} title={path}>D {path}</div>)}
        </div>
      )}
    </>
  );
}
