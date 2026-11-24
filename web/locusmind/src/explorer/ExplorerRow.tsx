import type { HTMLAttributes } from "react";
import { ChevronDown, ChevronRight, FileImage, FileText, Folder, FolderOpen } from "lucide-react";
import { RenameInput } from "./RenameInput";
import type { ExplorerRowData } from "./types";

type Props = {
  row: ExplorerRowData;
  selected: boolean;
  tabbable: boolean;
  renaming: boolean;
  githubBaseline: boolean;
  dragSource: boolean;
  dropTarget: boolean;
  dragProps: HTMLAttributes<HTMLDivElement>;
  registerElement: (key: string, element: HTMLDivElement | null) => void;
  onActivate: () => void;
  onToggle: () => void;
  onFocus: () => void;
  onCommitRename: (value: string, viaKeyboard: boolean) => string | null;
  onCancelRename: (viaKeyboard: boolean) => void;
};

const INDENT_PX = 12;

export function ExplorerRow({
  row,
  selected,
  tabbable,
  renaming,
  githubBaseline,
  dragSource,
  dropTarget,
  dragProps,
  registerElement,
  onActivate,
  onToggle,
  onFocus,
  onCommitRename,
  onCancelRename,
}: Props) {
  const isFolder = row.kind === "folder";
  const status = row.kind === "file" ? row.status : null;
  const baseline = githubBaseline ? "GitHub import" : "last version";
  const className = [
    "explorer-row",
    row.kind,
    selected && "selected",
    dragSource && "dragging",
    dropTarget && "drop-target",
    status,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={(element) => registerElement(row.key, element)}
      role="treeitem"
      className={className}
      style={{ paddingLeft: 6 + row.depth * INDENT_PX }}
      tabIndex={tabbable ? 0 : -1}
      data-row-key={row.key}
      aria-level={row.depth + 1}
      aria-selected={selected}
      aria-expanded={isFolder ? row.expanded : undefined}
      aria-label={status ? `${row.name}, ${status} since ${baseline}` : undefined}
      title={status ? `${row.path} (${status} since ${baseline})` : row.path}
      onClick={onActivate}
      onFocus={onFocus}
      {...(renaming ? {} : dragProps)}
    >
      {isFolder ? (
        <span
          className="explorer-chevron"
          aria-hidden="true"
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          {row.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      ) : (
        <span className="explorer-chevron" aria-hidden="true" />
      )}
      {row.kind === "folder" ? (
        row.expanded ? <FolderOpen size={15} className="explorer-icon" /> : <Folder size={15} className="explorer-icon" />
      ) : row.file.type === "markdown" ? (
        <FileText size={15} className="explorer-icon" />
      ) : (
        <FileImage size={15} className="explorer-icon" />
      )}
      {renaming ? (
        <RenameInput
          name={row.name}
          label={`Rename ${row.name}`}
          selectBaseName={row.kind === "file"}
          onCommit={onCommitRename}
          onCancel={onCancelRename}
        />
      ) : (
        <span className="explorer-label">{row.name}</span>
      )}
      {status && !renaming && (
        <span className="explorer-status" aria-hidden="true">
          {status === "new" ? "N" : "M"}
        </span>
      )}
    </div>
  );
}
