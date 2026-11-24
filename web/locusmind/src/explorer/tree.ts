import { getFileName, getFolderPath, type WorkspaceFile } from "../workspace";
import type { ExplorerRowData, FileStatus } from "./types";

const compareNames = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

export function getFileStatus(file: WorkspaceFile, versionFile?: WorkspaceFile): FileStatus {
  if (!versionFile) return "new";
  return file.path !== versionFile.path ||
    file.type !== versionFile.type ||
    file.content !== versionFile.content
    ? "edited"
    : null;
}

type BuildOptions = {
  files: WorkspaceFile[];
  folders: string[];
  query: string;
  collapsed: string[];
  versionFiles: Map<string, WorkspaceFile>;
};

// Flattens the workspace into the rows that are currently visible, folders
// first and then files, the way the VS Code explorer lists them.
export function buildExplorerRows({
  files,
  folders,
  query,
  collapsed,
  versionFiles,
}: BuildOptions): ExplorerRowData[] {
  const needle = query.trim().toLowerCase();
  const visibleFiles = needle
    ? files.filter(
        (file) =>
          file.path.toLowerCase().includes(needle) ||
          file.content.toLowerCase().includes(needle),
      )
    : files;

  let visibleFolders: Set<string>;
  if (needle) {
    visibleFolders = new Set();
    const reveal = (path: string) => {
      for (let current = path; current; current = getFolderPath(current)) {
        visibleFolders.add(current);
      }
    };
    visibleFiles.forEach((file) => reveal(getFolderPath(file.path)));
    folders
      .filter((folder) => folder.toLowerCase().includes(needle))
      .forEach(reveal);
  } else {
    visibleFolders = new Set(folders.filter(Boolean));
  }

  const foldersByParent = new Map<string, string[]>();
  for (const folder of visibleFolders) {
    const parent = getFolderPath(folder);
    foldersByParent.set(parent, [...(foldersByParent.get(parent) ?? []), folder]);
  }
  const filesByFolder = new Map<string, WorkspaceFile[]>();
  for (const file of visibleFiles) {
    const parent = getFolderPath(file.path);
    filesByFolder.set(parent, [...(filesByFolder.get(parent) ?? []), file]);
  }

  const rows: ExplorerRowData[] = [];
  const walk = (parent: string, depth: number) => {
    const childFolders = (foldersByParent.get(parent) ?? []).sort((a, b) =>
      compareNames(getFileName(a), getFileName(b)),
    );
    for (const path of childFolders) {
      const expanded = needle ? true : !collapsed.includes(path);
      rows.push({
        kind: "folder",
        key: `folder:${path}`,
        depth,
        path,
        name: getFileName(path),
        expanded,
      });
      if (expanded) walk(path, depth + 1);
    }
    const childFiles = (filesByFolder.get(parent) ?? []).sort((a, b) =>
      compareNames(getFileName(a.path), getFileName(b.path)),
    );
    for (const file of childFiles) {
      rows.push({
        kind: "file",
        key: `file:${file.id}`,
        depth,
        path: file.path,
        name: getFileName(file.path),
        file,
        status: getFileStatus(file, versionFiles.get(file.id)),
      });
    }
  };
  walk("", 0);
  return rows;
}
