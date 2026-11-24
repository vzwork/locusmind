import type { WorkspaceFile } from "../workspace";

export type ExplorerItem =
  | { type: "file"; id: string }
  | { type: "folder"; path: string };

export type Selection = ExplorerItem | null;

export type FileStatus = "new" | "edited" | null;

export type Notice = { message: string; undo?: boolean };

type RowBase = { key: string; depth: number; path: string; name: string };

export type FolderRowData = RowBase & { kind: "folder"; expanded: boolean };

export type FileRowData = RowBase & {
  kind: "file";
  file: WorkspaceFile;
  status: FileStatus;
};

export type ExplorerRowData = FolderRowData | FileRowData;

export function itemKey(item: ExplorerItem): string {
  return item.type === "file" ? `file:${item.id}` : `folder:${item.path}`;
}

export function rowItem(row: ExplorerRowData): ExplorerItem {
  return row.kind === "file"
    ? { type: "file", id: row.file.id }
    : { type: "folder", path: row.path };
}
