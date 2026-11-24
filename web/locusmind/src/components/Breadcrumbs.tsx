import { useEffect, useId, useRef, useState } from "react";
import { ChevronRight, FileImage, FileText, Folder } from "lucide-react";
import { getFileName, getFolderPath, type Workspace, type WorkspaceFile } from "../workspace";
import type { Selection } from "../explorer/types";
import type { Navigate } from "../explorer/useWorkspaceSelection";

type Props = {
  workspace: Workspace;
  rootName: string;
  folders: string[];
  selection: Selection;
  activeFile: WorkspaceFile | undefined;
  navigate: Navigate;
  reveal: (folder: string) => void;
};

export function Breadcrumbs({ workspace, rootName, folders, selection, activeFile, navigate, reveal }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const menuId = useId();
  const folderPath = activeFile ? getFolderPath(activeFile.path) : selection?.type === "folder" ? selection.path : "";
  const segments = folderPath ? folderPath.split("/") : [];
  const crumbs = [
    { key: "root", label: rootName, folder: "", className: "breadcrumb-workspace" },
    ...segments.map((label, index) => ({
      key: `folder:${segments.slice(0, index + 1).join("/")}`,
      label,
      folder: segments.slice(0, index + 1).join("/"),
      className: "breadcrumb-current",
    })),
    ...(activeFile ? [{
      key: "file",
      label: getFileName(activeFile.path),
      folder: folderPath,
      className: "breadcrumb-current strong",
    }] : []),
  ];

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  useEffect(() => {
    if (open === null) return;
    function dismiss(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(null);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  function select(item: { type: "folder"; path: string } | { type: "file"; file: WorkspaceFile }) {
    if (item.type === "folder") {
      reveal(item.path);
      navigate({ type: "folder", path: item.path }, item.path);
    } else {
      reveal(getFolderPath(item.file.path));
      navigate({ type: "file", id: item.file.id }, item.file.path);
    }
    setOpen(null);
  }

  return (
    <div className="breadcrumb-path" ref={containerRef}>
      {crumbs.map((crumb, index) => {
        if (crumb.key === "file") {
          return (
            <div className="breadcrumb-part" key={crumb.key}>
              <ChevronRight className="breadcrumb-separator" size={14} aria-hidden="true" />
              <span className="breadcrumb-file breadcrumb-current strong" aria-current="page">{crumb.label}</span>
            </div>
          );
        }
        const childFolders = folders
          .filter((folder) => folder !== "" && getFolderPath(folder) === crumb.folder)
          .sort((a, b) => getFileName(a).localeCompare(getFileName(b), undefined, { numeric: true, sensitivity: "base" }));
        const childFiles = workspace.files
          .filter((file) => getFolderPath(file.path) === crumb.folder)
          .sort((a, b) => getFileName(a.path).localeCompare(getFileName(b.path), undefined, { numeric: true, sensitivity: "base" }));
        const expanded = open === crumb.key;
        const id = `${menuId}-${index}`;
        return (
          <div className="breadcrumb-part" key={crumb.key}>
            {index > 0 && <ChevronRight className="breadcrumb-separator" size={14} aria-hidden="true" />}
            <div
              className="breadcrumb-menu-anchor"
              onMouseEnter={() => {
                window.clearTimeout(closeTimer.current);
                setOpen(crumb.key);
              }}
              onMouseLeave={() => {
                window.clearTimeout(closeTimer.current);
                closeTimer.current = window.setTimeout(
                  () => setOpen((current) => current === crumb.key ? null : current),
                  250,
                );
              }}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setOpen(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape" && expanded) {
                  setOpen(null);
                  event.currentTarget.querySelector("button")?.focus();
                }
              }}
            >
              <button
                type="button"
                className={`breadcrumb-trigger ${crumb.className}`}
                aria-expanded={expanded}
                aria-controls={expanded ? id : undefined}
                onClick={() => setOpen(expanded ? null : crumb.key)}
              >
                {crumb.label}
              </button>
              {expanded && (
                <div className="breadcrumb-menu" id={id} aria-label={`Contents of ${crumb.folder || "workspace"}`}>
                  {childFolders.map((folder) => (
                    <button type="button" className="breadcrumb-menu-item" key={folder} onClick={() => select({ type: "folder", path: folder })}>
                      <Folder size={15} aria-hidden="true" />
                      <span>{getFileName(folder)}</span>
                    </button>
                  ))}
                  {childFiles.map((file) => {
                    const Icon = file.type === "markdown" ? FileText : FileImage;
                    return (
                      <button type="button" className="breadcrumb-menu-item" key={file.id} aria-current={file.id === activeFile?.id ? "page" : undefined} onClick={() => select({ type: "file", file })}>
                        <Icon size={15} aria-hidden="true" />
                        <span>{getFileName(file.path)}</span>
                      </button>
                    );
                  })}
                  {childFolders.length === 0 && childFiles.length === 0 && <span className="breadcrumb-menu-empty">This folder is empty</span>}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
