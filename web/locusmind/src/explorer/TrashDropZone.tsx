import type { HTMLAttributes } from "react";
import { Trash2 } from "lucide-react";

type Props = {
  hovered: boolean;
  dropProps: HTMLAttributes<HTMLDivElement>;
};

export function TrashDropZone({ hovered, dropProps }: Props) {
  return (
    <div
      className={`explorer-trash${hovered ? " active" : ""}`}
      role="region"
      aria-label="Drop here to delete"
      {...dropProps}
    >
      <Trash2 size={15} />
      Drop here to delete
    </div>
  );
}
