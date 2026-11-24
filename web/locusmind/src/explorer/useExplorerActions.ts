import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  createFile,
  drawingStarter,
  getFileName,
  getFolderPath,
  getUniquePath,
  type Workspace,
  type WorkspaceFile,
} from "../workspace";
import type { CollapsedFolders } from "./useCollapsedFolders";
import type { Navigate } from "./useWorkspaceSelection";
import {
  ancestorPaths,
  getUniqueFolderPath,
  isWithinFolder,
  joinPath,
  validateFolderName,
  workspaceFolders,
} from "./paths";
import type { ExplorerItem, Notice, Selection } from "./types";

type TrashEntry = {
  files: { file: WorkspaceFile; index: number }[];
  folders: string[];
  selection: ExplorerItem | null;
  reveal: string;
};

type Options = {
  workspace: Workspace;
  setWorkspace: Dispatch<SetStateAction<Workspace>>;
  selection: Selection;
  activeFile: WorkspaceFile | undefined;
  navigate: Navigate;
  collapse: CollapsedFolders;
  notify: (notice: Notice | null) => void;
  undoEnabled: boolean;
};

export function useExplorerActions({
  workspace,
  setWorkspace,
  selection,
  activeFile,
  navigate,
  collapse,
  notify,
  undoEnabled,
}: Options) {
  const [error, setError] = useState("");
  const [pendingRename, setPendingRename] = useState<Selection>(null);
  const [trash, setTrash] = useState<TrashEntry[]>([]);

  const allFolders = useMemo(
    () => workspaceFolders(workspace),
    [workspace.files, workspace.folders],
  );

  const clearPendingRename = useCallback(() => setPendingRename(null), []);
  const clearError = useCallback(() => setError(""), []);
  const resetHistory = useCallback(() => setTrash([]), []);

  function createNewFile(type: WorkspaceFile["type"]) {
    const parent = selection?.type === "folder" ? selection.path : undefined;
    const file = createFile(
      type,
      getUniquePath(workspace.files, type, allFolders, parent),
    );
    setWorkspace((current) => ({ ...current, files: [...current.files, file] }));
    setPendingRename({ type: "file", id: file.id });
    collapse.reveal(getFolderPath(file.path));
    navigate({ type: "file", id: file.id }, file.path);
  }

  function createNewFolder() {
    const parent =
      selection?.type === "folder"
        ? selection.path
        : activeFile
          ? getFolderPath(activeFile.path)
          : "";
    const path = getUniqueFolderPath(
      [...allFolders, ...workspace.files.map((file) => file.path)],
      parent,
    );
    setWorkspace((current) => ({ ...current, folders: [...current.folders, path] }));
    setPendingRename({ type: "folder", path });
    collapse.reveal(parent);
    navigate({ type: "folder", path }, path);
  }

  function renameFile(file: WorkspaceFile, value: string): string | null {
    const name = value.trim();
    if (!name) return "A file name cannot be empty.";

    const requested = name.match(/\.(md|excalidraw)$/i)?.[1].toLowerCase();
    const type: WorkspaceFile["type"] =
      requested === "md" ? "markdown" : requested === "excalidraw" ? "excalidraw" : file.type;
    const baseName = name.replace(/\.(md|excalidraw)$/i, "").replace(/[\\/]/g, "-");
    if (!baseName || baseName === "." || baseName === "..") {
      return "Choose a valid file name.";
    }
    const path = joinPath(
      getFolderPath(file.path),
      `${baseName}${type === "markdown" ? ".md" : ".excalidraw"}`,
    );
    if (allFolders.includes(path)) return "A folder with that name already exists.";
    if (workspace.files.some((other) => other.id !== file.id && other.path === path)) {
      return "A file with that name already exists.";
    }
    if (path !== file.path) {
      const changes: Partial<WorkspaceFile> =
        type === file.type
          ? { path }
          : { path, type, content: type === "markdown" ? "" : drawingStarter };
      const now = new Date().toISOString();
      setWorkspace((current) => ({
        ...current,
        files: current.files.map((item) =>
          item.id === file.id ? { ...item, ...changes, updatedAt: now } : item,
        ),
      }));
      if (selection?.type === "file" && selection.id === file.id) {
        navigate(selection, path, true);
      }
    }
    return null;
  }

  function relocateFolder(folder: string, path: string): string | null {
    if (path === folder) return null;
    if (allFolders.includes(path) || workspace.files.some((file) => file.path === path)) {
      return "A file or folder with that name already exists.";
    }
    const rewrite = (value: string) =>
      isWithinFolder(value, folder) ? `${path}${value.slice(folder.length)}` : value;
    const now = new Date().toISOString();

    setWorkspace((current) => ({
      ...current,
      folders: [...new Set(workspaceFolders(current).filter(Boolean).map(rewrite))],
      files: current.files.map((file) => {
        const next = rewrite(file.path);
        return next === file.path ? file : { ...file, path: next, updatedAt: now };
      }),
    }));
    collapse.remap(rewrite);
    if (selection?.type === "folder") {
      const next = rewrite(selection.path);
      if (next !== selection.path) navigate({ type: "folder", path: next }, next, true);
    } else if (activeFile) {
      const next = rewrite(activeFile.path);
      if (next !== activeFile.path) navigate(selection, next, true);
    }
    return null;
  }

  function renameFolder(folder: string, value: string): string | null {
    const name = value.trim();
    return (
      validateFolderName(name) ?? relocateFolder(folder, joinPath(getFolderPath(folder), name))
    );
  }

  function moveFile(fileId: string, destination: string): string | null {
    const file = workspace.files.find((candidate) => candidate.id === fileId);
    if (!file) return "The file no longer exists.";
    if (destination && !allFolders.includes(destination)) {
      return "The destination folder no longer exists.";
    }
    if (getFolderPath(file.path) === destination) return null;

    const path = joinPath(destination, getFileName(file.path));
    if (allFolders.includes(path)) {
      return "A folder with that name already exists in the destination folder.";
    }
    if (workspace.files.some((other) => other.id !== file.id && other.path === path)) {
      return "A file with that name already exists in the destination folder.";
    }

    const now = new Date().toISOString();
    setWorkspace((current) => ({
      ...current,
      folders: workspaceFolders(current).filter(Boolean),
      files: current.files.map((item) =>
        item.id === fileId ? { ...item, path, updatedAt: now } : item,
      ),
    }));
    if (selection?.type === "file" && selection.id === fileId) navigate(selection, path, true);
    return null;
  }

  function moveFolder(source: string, destination: string): string | null {
    if (!allFolders.includes(source)) return "The folder no longer exists.";
    if (destination && !allFolders.includes(destination)) {
      return "The destination folder no longer exists.";
    }
    if (isWithinFolder(destination, source)) {
      return "A folder cannot be moved into itself or its descendants.";
    }
    if (getFolderPath(source) === destination) return null;
    return relocateFolder(source, joinPath(destination, getFileName(source)));
  }

  function moveItem(item: ExplorerItem, destination: string) {
    const source =
      item.type === "file"
        ? workspace.files.find((file) => file.id === item.id)?.path
        : item.path;
    const failure =
      item.type === "file"
        ? moveFile(item.id, destination)
        : moveFolder(item.path, destination);
    setError(failure ?? "");
    if (failure || source === undefined) return;
    collapse.reveal(destination);
    if (getFolderPath(source) !== destination) {
      notify({
        message: `Moved ${getFileName(source)} to ${destination || "Workspace (root)"}.`,
      });
    }
  }

  function deleteItem(item: ExplorerItem) {
    let removed: TrashEntry["files"];
    let removedFolders: string[] = [];
    let label: string;
    let reveal: string;

    if (item.type === "file") {
      const index = workspace.files.findIndex((file) => file.id === item.id);
      if (index < 0) {
        setError("The file no longer exists.");
        return;
      }
      const file = workspace.files[index];
      removed = [{ file, index }];
      label = getFileName(file.path);
      reveal = getFolderPath(file.path);
    } else {
      if (!allFolders.includes(item.path)) {
        setError("The folder no longer exists.");
        return;
      }
      removed = workspace.files.flatMap((file, index) =>
        isWithinFolder(file.path, item.path) ? [{ file, index }] : [],
      );
      removedFolders = allFolders.filter((folder) => isWithinFolder(folder, item.path));
      label = getFileName(item.path);
      reveal = getFolderPath(item.path);
    }

    const removedIds = new Set(removed.map(({ file }) => file.id));
    const selectionRemoved =
      selection?.type === "file"
        ? removedIds.has(selection.id)
        : selection?.type === "folder" &&
          item.type === "folder" &&
          isWithinFolder(selection.path, item.path);

    setTrash((current) => [
      ...current,
      {
        files: removed,
        folders: removedFolders,
        selection: selectionRemoved ? selection : null,
        reveal,
      },
    ]);
    setWorkspace((current) => ({
      ...current,
      files: current.files.filter((file) => !removedIds.has(file.id)),
      folders: workspaceFolders(current).filter(
        (folder) => folder && !removedFolders.includes(folder),
      ),
    }));
    if (selectionRemoved) {
      const next = workspace.files.find((file) => !removedIds.has(file.id));
      navigate(next ? { type: "file", id: next.id } : null, next?.path ?? "", true);
    }
    setError("");
    notify({ message: `Deleted ${label}.`, undo: true });
  }

  function undoDelete() {
    const entry = trash.at(-1);
    if (!entry) return;

    const paths = new Set(workspace.files.map((file) => file.path));
    const ids = new Set(workspace.files.map((file) => file.id));
    const conflict =
      entry.files.find(
        ({ file }) =>
          ids.has(file.id) ||
          paths.has(file.path) ||
          allFolders.includes(file.path) ||
          ancestorPaths(file.path).some((ancestor) => paths.has(ancestor)),
      )?.file.path ??
      entry.folders.find(
        (folder) => paths.has(folder) || ancestorPaths(folder).some((ancestor) => paths.has(ancestor)),
      );
    if (conflict) {
      setError(`Cannot restore ${conflict}: its path is already in use.`);
      return;
    }

    setWorkspace((current) => {
      const files = [...current.files];
      for (const { file, index } of [...entry.files].sort((a, b) => a.index - b.index)) {
        files.splice(Math.min(index, files.length), 0, file);
      }
      return {
        ...current,
        files,
        folders: [
          ...new Set([...workspaceFolders(current).filter(Boolean), ...entry.folders.filter(Boolean)]),
        ],
      };
    });
    setTrash((current) => current.slice(0, -1));
    collapse.reveal(entry.reveal);
    if (entry.selection?.type === "file") {
      const { id } = entry.selection;
      const file = entry.files.find((candidate) => candidate.file.id === id)?.file;
      if (file) navigate(entry.selection, file.path, true);
    } else if (entry.selection?.type === "folder") {
      navigate(entry.selection, entry.selection.path, true);
    }
    setError("");
    notify({ message: "Restored deleted item." });
  }

  useEffect(() => {
    function handleUndo(event: KeyboardEvent) {
      if (
        !undoEnabled ||
        trash.length === 0 ||
        event.defaultPrevented ||
        event.isComposing ||
        event.key.toLowerCase() !== "z" ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        (event.target instanceof Element &&
          event.target.closest(
            "input, textarea, select, [contenteditable]:not([contenteditable='false']), .excalidraw",
          ))
      ) {
        return;
      }
      event.preventDefault();
      undoDelete();
    }
    document.addEventListener("keydown", handleUndo);
    return () => document.removeEventListener("keydown", handleUndo);
  });

  return {
    allFolders,
    error,
    clearError,
    pendingRename,
    clearPendingRename,
    resetHistory,
    createFile: createNewFile,
    createFolder: createNewFolder,
    renameFile,
    renameFolder,
    moveItem,
    deleteItem,
    undoDelete,
  };
}

export type ExplorerActions = ReturnType<typeof useExplorerActions>;
