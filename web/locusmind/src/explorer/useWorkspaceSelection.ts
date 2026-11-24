import { useCallback, useEffect, useState } from "react";
import { getFolderPath, type Workspace } from "../workspace";
import { workspaceFolders } from "./paths";
import type { Selection } from "./types";

type Location = { selection: Selection; error: string };

export function selectionHash(type: "file" | "folder", path: string): string {
  if (type === "folder") {
    return `#/folder/${encodePath(path)}`;
  }
  return `#/${encodePath(path)}`;
}

function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function decodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

function selectionFromUrl(workspace: Workspace): Location {
  if (!window.location.hash) {
    const file = workspace.files[0];
    return { selection: file ? { type: "file", id: file.id } : null, error: "" };
  }

  const route = window.location.hash.slice(1);
  if (route.startsWith("/")) {
    const modernPath = decodePath(route.slice(1));
    if (modernPath.startsWith("folder/")) {
      const folderPath = modernPath.slice("folder/".length).replace(/\/$/, "");
      if (workspaceFolders(workspace).includes(folderPath)) {
        return { selection: { type: "folder", path: folderPath }, error: "" };
      }
    } else {
      const file = workspace.files.find((item) => item.path === modernPath);
      if (file) return { selection: { type: "file", id: file.id }, error: "" };
    }
    return {
      selection: null,
      error: "The file or folder in this URL was not found in this workspace.",
    };
  }

  const params = new URLSearchParams(window.location.hash.slice(1));
  if (params.has("file") && !params.has("folder")) {
    const file = workspace.files.find((item) => item.path === params.get("file"));
    if (file) return { selection: { type: "file", id: file.id }, error: "" };
  } else if (params.has("folder") && !params.has("file")) {
    const path = params.get("folder") ?? "";
    if (workspaceFolders(workspace).includes(path)) {
      return { selection: { type: "folder", path }, error: "" };
    }
  }
  return {
    selection: null,
    error: "The file or folder in this URL was not found in this workspace.",
  };
}

// Keeps the selected file or folder in sync with the URL hash and with
// browser back/forward navigation.
export function useWorkspaceSelection(
  workspace: Workspace,
  onReveal: (folder: string) => void,
) {
  const [location, setLocation] = useState(() => selectionFromUrl(workspace));

  useEffect(() => {
    const file = workspace.files[0];
    if (!window.location.hash && file) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}${selectionHash("file", file.path)}`,
      );
    } else if (window.location.hash && !window.location.hash.startsWith("#/")) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      if (params.has("file") && !params.has("folder")) {
        const selectedFile = workspace.files.find(
          (item) => item.path === params.get("file"),
        );
        if (selectedFile) {
          window.history.replaceState(
            null,
            "",
            `${window.location.pathname}${window.location.search}${selectionHash("file", selectedFile.path)}`,
          );
        }
      } else if (params.has("folder") && !params.has("file")) {
        const folderPath = params.get("folder") ?? "";
        if (workspaceFolders(workspace).includes(folderPath)) {
          window.history.replaceState(
            null,
            "",
            `${window.location.pathname}${window.location.search}${selectionHash("folder", folderPath)}`,
          );
        }
      }
    }
    // Only the initial URL is normalised.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function syncLocation() {
      const next = selectionFromUrl(workspace);
      setLocation(next);
      const selected = next.selection;
      if (selected?.type === "folder") {
        onReveal(selected.path);
      } else if (selected?.type === "file") {
        const file = workspace.files.find((item) => item.id === selected.id);
        if (file) onReveal(getFolderPath(file.path));
      }
    }
    window.addEventListener("popstate", syncLocation);
    window.addEventListener("hashchange", syncLocation);
    return () => {
      window.removeEventListener("popstate", syncLocation);
      window.removeEventListener("hashchange", syncLocation);
    };
  }, [workspace, onReveal]);

  const navigate = useCallback((next: Selection, path: string, replace = false) => {
    const hash = next ? selectionHash(next.type, path) : "";
    if (window.location.hash !== hash) {
      window.history[replace ? "replaceState" : "pushState"](
        null,
        "",
        `${window.location.pathname}${window.location.search}${hash}`,
      );
    }
    setLocation({ selection: next, error: "" });
  }, []);

  const selection = location.selection;
  const activeFile =
    selection?.type === "file"
      ? workspace.files.find((file) => file.id === selection.id)
      : undefined;

  return { selection, locationError: location.error, activeFile, navigate };
}

export type Navigate = ReturnType<typeof useWorkspaceSelection>["navigate"];
