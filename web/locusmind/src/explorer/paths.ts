import { getFolderPath, type Workspace } from "../workspace";

export function workspaceFolders(
  workspace: Pick<Workspace, "files" | "folders">,
): string[] {
  const paths = new Set([
    ...workspace.folders,
    ...workspace.files.map((file) => getFolderPath(file.path)),
  ]);
  for (const folder of [...paths]) {
    let parent = getFolderPath(folder);
    while (parent) {
      paths.add(parent);
      parent = getFolderPath(parent);
    }
  }
  return [...paths].sort((a, b) => a.localeCompare(b));
}

// True when `path` is the folder itself or anything nested inside it.
export function isWithinFolder(path: string, folder: string): boolean {
  return folder === "" || path === folder || path.startsWith(`${folder}/`);
}

export function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function ancestorPaths(path: string): string[] {
  const segments = path.split("/").slice(0, -1);
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
}

export function getUniqueFolderPath(taken: Iterable<string>, parent: string): string {
  const existing = new Set(taken);
  let path = joinPath(parent, "Untitled folder");
  let index = 1;
  while (existing.has(path)) {
    index += 1;
    path = joinPath(parent, `Untitled folder ${index}`);
  }
  return path;
}

export function validateFolderName(name: string): string | null {
  return !name || name === "." || name === ".." || /[\\/]/.test(name)
    ? "Enter a valid folder name without slashes."
    : null;
}
