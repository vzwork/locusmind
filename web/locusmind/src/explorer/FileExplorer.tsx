import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getFolderPath, getGithubChanges, type Workspace } from "../workspace";
import { ExplorerRow } from "./ExplorerRow";
import { TrashDropZone } from "./TrashDropZone";
import { isWithinFolder, joinPath } from "./paths";
import { buildExplorerRows } from "./tree";
import { itemKey, rowItem, type ExplorerRowData, type Selection } from "./types";
import type { CollapsedFolders } from "./useCollapsedFolders";
import type { ExplorerActions } from "./useExplorerActions";
import { useExplorerDrag } from "./useExplorerDrag";
import type { Navigate } from "./useWorkspaceSelection";

type Props = {
  workspace: Workspace;
  query: string;
  selection: Selection;
  navigate: Navigate;
  actions: ExplorerActions;
  collapse: CollapsedFolders;
};

// A VS Code style file tree: a flat list of rows with roving keyboard focus
// (arrows, Enter/F2 to rename, Delete) and drag and drop to move or delete.
export function FileExplorer({ workspace, query, selection, navigate, actions, collapse }: Props) {
  const rowElements = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<string | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);

  const versionFiles = useMemo(
    () => {
      if (!workspace.githubBase) return new Map(workspace.snapshots[0]?.files.map((file) => [file.id, file]));
      const { baseByPath } = getGithubChanges(workspace);
      return new Map(workspace.files.flatMap((file) => {
        const base = baseByPath.get(file.path);
        return base ? [[file.id, base] as const] : [];
      }));
    },
    [workspace.files, workspace.githubBase, workspace.snapshots],
  );
  const rows = useMemo(
    () =>
      buildExplorerRows({
        files: workspace.files,
        folders: actions.allFolders,
        query,
        collapsed: collapse.collapsed,
        versionFiles,
      }),
    [workspace.files, actions.allFolders, query, collapse.collapsed, versionFiles],
  );

  const selectedKey = selection ? itemKey(selection) : null;
  const tabbableKey = rows.some((row) => row.key === focusedKey)
    ? focusedKey
    : rows.some((row) => row.key === selectedKey)
      ? selectedKey
      : rows[0]?.key;

  const registerElement = useCallback((key: string, element: HTMLElement | null) => {
    if (element) rowElements.current.set(key, element);
    else rowElements.current.delete(key);
  }, []);

  // Focus is moved after the next render, once the target row exists.
  function requestFocus(key: string) {
    pendingFocus.current = key;
    setFocusedKey(key);
  }

  useLayoutEffect(() => {
    const key = pendingFocus.current;
    if (key === null) return;
    pendingFocus.current = null;
    rowElements.current.get(key)?.focus();
  });

  // Newly created files and folders open straight into rename.
  const { pendingRename, clearPendingRename } = actions;
  useEffect(() => {
    if (!pendingRename) return;
    const key = itemKey(pendingRename);
    if (!rows.some((row) => row.key === key)) return;
    setRenamingKey(key);
    clearPendingRename();
  }, [pendingRename, rows, clearPendingRename]);

  const drag = useExplorerDrag({
    canDrop: (item, folder) => item.type === "file" || !isWithinFolder(folder, item.path),
    onMove: actions.moveItem,
    onDelete: actions.deleteItem,
    onSpringOpen: collapse.expand,
  });

  function activate(row: ExplorerRowData) {
    if (row.kind === "file") {
      navigate({ type: "file", id: row.file.id }, row.path);
    } else {
      navigate({ type: "folder", path: row.path }, row.path);
      collapse.toggle(row.path);
    }
  }

  function commitRename(row: ExplorerRowData, value: string, viaKeyboard: boolean) {
    const failure =
      row.kind === "file"
        ? actions.renameFile(row.file, value)
        : actions.renameFolder(row.path, value);
    if (failure) return failure;
    setRenamingKey(null);
    if (viaKeyboard) {
      requestFocus(
        row.kind === "file"
          ? row.key
          : `folder:${joinPath(getFolderPath(row.path), value.trim())}`,
      );
    }
    return null;
  }

  function cancelRename(row: ExplorerRowData, viaKeyboard: boolean) {
    setRenamingKey(null);
    if (viaKeyboard) requestFocus(row.key);
  }

  function removeRow(index: number) {
    const row = rows[index];
    const neighbor = rows.slice(index + 1).find((next) => next.depth <= row.depth) ?? rows[index - 1];
    actions.deleteItem(rowItem(row));
    if (neighbor) requestFocus(neighbor.key);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (renamingKey !== null || !(event.target instanceof HTMLElement)) return;
    const rowKey = event.target.closest<HTMLElement>("[data-row-key]")?.dataset.rowKey;
    const index = rows.findIndex((row) => row.key === rowKey);
    if (index < 0) return;
    const row = rows[index];
    const next = rows[index + 1];
    const noModifiers = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const focusRow = (target?: ExplorerRowData) => {
      event.preventDefault();
      if (target) rowElements.current.get(target.key)?.focus();
    };

    if (noModifiers) {
      switch (event.key) {
        case "ArrowDown":
          return focusRow(next);
        case "ArrowUp":
          return focusRow(rows[index - 1]);
        case "Home":
          return focusRow(rows[0]);
        case "End":
          return focusRow(rows.at(-1));
        case "ArrowRight":
          if (row.kind === "folder" && !row.expanded) {
            event.preventDefault();
            collapse.expand(row.path);
            return;
          }
          return focusRow(row.kind === "folder" && next && next.depth > row.depth ? next : undefined);
        case "ArrowLeft": {
          if (row.kind === "folder" && row.expanded) {
            event.preventDefault();
            collapse.collapse(row.path);
            return;
          }
          let parent: ExplorerRowData | undefined;
          for (let i = index - 1; i >= 0 && !parent; i--) {
            if (rows[i].depth < row.depth) parent = rows[i];
          }
          return focusRow(parent);
        }
        case "Enter":
        case "F2":
          event.preventDefault();
          if (!event.repeat) setRenamingKey(row.key);
          return;
        case " ":
          event.preventDefault();
          activate(row);
          return;
        case "Delete":
          event.preventDefault();
          if (!event.repeat) removeRow(index);
          return;
      }
    }
    if (event.key === "Backspace" && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      if (!event.repeat) removeRow(index);
    }
  }

  return (
    <div className="explorer">
      <div
        className={`explorer-scroll${drag.dropFolder === "" ? " drop-root" : ""}`}
        {...drag.rootProps}
      >
        <div
          role="tree"
          aria-label="Workspace files"
          className="explorer-tree"
          onKeyDown={handleKeyDown}
        >
          {rows.map((row) => {
            const item = rowItem(row);
            const destination = row.kind === "folder" ? row.path : getFolderPath(row.path);
            return (
              <ExplorerRow
                key={row.key}
                row={row}
                selected={row.key === selectedKey}
                tabbable={row.key === tabbableKey}
                renaming={row.key === renamingKey}
                githubBaseline={Boolean(workspace.githubBase)}
                dragSource={
                  drag.dragging !== null && itemKey(drag.dragging) === row.key
                }
                dropTarget={
                  drag.dropFolder !== null &&
                  drag.dropFolder !== "" &&
                  isWithinFolder(row.path, drag.dropFolder)
                }
                dragProps={{
                  ...drag.sourceProps(item),
                  ...drag.targetProps(
                    destination,
                    row.kind === "folder" && !row.expanded ? row.path : undefined,
                  ),
                }}
                registerElement={registerElement}
                onActivate={() => activate(row)}
                onToggle={() => collapse.toggle(row.path)}
                onFocus={() => setFocusedKey(row.key)}
                onCommitRename={(value, viaKeyboard) => commitRename(row, value, viaKeyboard)}
                onCancelRename={(viaKeyboard) => cancelRename(row, viaKeyboard)}
              />
            );
          })}
        </div>
        {rows.length === 0 && (
          <p className="explorer-empty">
            {query.trim() ? "No matching files" : "Nothing here yet. Create a note, drawing, or folder."}
          </p>
        )}
      </div>
      {drag.dragging && (
        <TrashDropZone hovered={drag.overTrash} dropProps={drag.trashProps} />
      )}
    </div>
  );
}
