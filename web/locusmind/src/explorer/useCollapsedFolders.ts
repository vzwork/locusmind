import { useCallback, useState } from "react";

export function useCollapsedFolders() {
  const [collapsed, setCollapsed] = useState<string[]>([]);

  const toggle = useCallback((folder: string) => {
    setCollapsed((current) =>
      current.includes(folder)
        ? current.filter((value) => value !== folder)
        : [...current, folder],
    );
  }, []);

  const collapse = useCallback((folder: string) => {
    setCollapsed((current) => (current.includes(folder) ? current : [...current, folder]));
  }, []);

  const expand = useCallback((folder: string) => {
    setCollapsed((current) => current.filter((value) => value !== folder));
  }, []);

  // Expands the folder and every ancestor so that something inside is visible.
  const reveal = useCallback((folder: string) => {
    setCollapsed((current) =>
      current.filter((value) => value !== folder && !folder.startsWith(`${value}/`)),
    );
  }, []);

  const remap = useCallback((rewrite: (path: string) => string) => {
    setCollapsed((current) => current.map(rewrite));
  }, []);

  return { collapsed, toggle, collapse, expand, reveal, remap };
}

export type CollapsedFolders = ReturnType<typeof useCollapsedFolders>;
