import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import type { ExplorerItem } from "./types";

const ITEM_TYPE = "application/x-locusmind-item";
const SPRING_OPEN_DELAY_MS = 700;

type Options = {
  canDrop: (item: ExplorerItem, folder: string) => boolean;
  onMove: (item: ExplorerItem, folder: string) => void;
  onDelete: (item: ExplorerItem) => void;
  onSpringOpen: (folder: string) => void;
};

// Drag and drop for the explorer. The dragged item lives in a ref so drag
// events never depend on a render. Visual state is committed only after
// `dragstart` has returned: changing the DOM inside that event makes Chrome
// cancel the drag immediately.
export function useExplorerDrag({ canDrop, onMove, onDelete, onSpringOpen }: Options) {
  const draggedRef = useRef<ExplorerItem | null>(null);
  const springRef = useRef<{ folder: string; timer: number } | null>(null);
  const [dragging, setDragging] = useState<ExplorerItem | null>(null);
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const [overTrash, setOverTrash] = useState(false);

  const cancelSpring = useCallback(() => {
    if (springRef.current) {
      window.clearTimeout(springRef.current.timer);
      springRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    cancelSpring();
    draggedRef.current = null;
    setDragging(null);
    setDropFolder(null);
    setOverTrash(false);
  }, [cancelSpring]);

  useEffect(() => cancelSpring, [cancelSpring]);

  // Hovering a collapsed folder while dragging opens it after a short delay.
  function scheduleSpring(folder?: string) {
    if (!folder) {
      cancelSpring();
      return;
    }
    if (springRef.current?.folder === folder) return;
    cancelSpring();
    springRef.current = {
      folder,
      timer: window.setTimeout(() => {
        springRef.current = null;
        onSpringOpen(folder);
      }, SPRING_OPEN_DELAY_MS),
    };
  }

  function sourceProps(item: ExplorerItem) {
    return {
      draggable: true,
      onDragStart(event: DragEvent) {
        draggedRef.current = item;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(ITEM_TYPE, JSON.stringify(item));
        window.setTimeout(() => {
          if (draggedRef.current === item) setDragging(item);
        }, 0);
      },
      onDragEnd: reset,
    };
  }

  // `folder` is where the item lands; `springFolder` is set on collapsed
  // folder rows so hovering them expands them.
  function targetProps(folder: string, springFolder?: string) {
    return {
      onDragOver(event: DragEvent) {
        const item = draggedRef.current;
        if (!item) return;
        event.stopPropagation();
        if (!canDrop(item, folder)) {
          cancelSpring();
          setDropFolder(null);
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropFolder(folder);
        setOverTrash(false);
        scheduleSpring(springFolder);
      },
      onDrop(event: DragEvent) {
        const item = draggedRef.current;
        if (!item) return;
        event.preventDefault();
        event.stopPropagation();
        const allowed = canDrop(item, folder);
        reset();
        if (allowed) onMove(item, folder);
      },
    };
  }

  // The scrollable list, so dropping on empty space targets the root.
  const rootProps = {
    ...targetProps(""),
    onDragLeave(event: DragEvent) {
      if (!draggedRef.current) return;
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
        return;
      }
      cancelSpring();
      setDropFolder(null);
    },
  };

  const trashProps = {
    onDragOver(event: DragEvent) {
      if (!draggedRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      cancelSpring();
      setDropFolder(null);
      setOverTrash(true);
    },
    onDragLeave(event: DragEvent) {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
        return;
      }
      setOverTrash(false);
    },
    onDrop(event: DragEvent) {
      const item = draggedRef.current;
      if (!item) return;
      event.preventDefault();
      event.stopPropagation();
      reset();
      onDelete(item);
    },
  };

  return { dragging, dropFolder, overTrash, sourceProps, targetProps, rootProps, trashProps };
}
