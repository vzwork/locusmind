import { z } from "zod";

const fileSchema = z
  .object({
    id: z.string().uuid(),
    path: z.string().min(1),
    type: z.enum(["markdown", "excalidraw"]),
    content: z.string(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((file, context) => {
    const extension = file.type === "markdown" ? ".md" : ".excalidraw";
    if (!file.path.toLowerCase().endsWith(extension)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `File type must use the ${extension} extension.`,
        path: ["path"],
      });
    }
    if (
      file.path.includes("\\") ||
      file.path.split("/").some((segment) => !segment || segment === "." || segment === "..")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "File paths must contain valid workspace-relative segments.",
        path: ["path"],
      });
    }
  });

const snapshotSchema = z.object({
  id: z.string().uuid(),
  message: z.string().min(1),
  createdAt: z.string().datetime(),
  files: z.array(fileSchema),
});

const githubBaseSchema = z.object({
  repository: z.object({ id: z.number().int().positive(), full_name: z.string().min(1), private: z.boolean() }),
  branch: z.string().min(1),
  commit: z.string().min(1).nullable(),
  files: z.array(fileSchema),
});

export const workspaceSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
    files: z.array(fileSchema),
    snapshots: z.array(snapshotSchema),
    githubBase: githubBaseSchema.optional(),
    folders: z.array(
      z.string().refine(
        (path) =>
          path === "" ||
          (!path.includes("\\") &&
            path.split("/").every((segment) => segment && segment !== "." && segment !== "..")),
        "Folder paths must contain valid workspace-relative segments.",
      ),
    ).default([]),
  })
  .superRefine((workspace, context) => {
    const paths = new Set<string>();
    const ids = new Set<string>();
    workspace.files.forEach((file, index) => {
      if (paths.has(file.path)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Workspace file paths must be unique.",
          path: ["files", index, "path"],
        });
      }
      if (ids.has(file.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Workspace file IDs must be unique.",
          path: ["files", index, "id"],
        });
      }
      paths.add(file.path);
      ids.add(file.id);
    });
  });

export type WorkspaceFile = z.infer<typeof fileSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type GithubBase = z.infer<typeof githubBaseSchema>;

export function mergeGithubFiles(
  workspace: Workspace,
  repository: GithubBase["repository"],
  branch: string,
  commit: string | null,
  imported: WorkspaceFile[],
): Workspace {
  const localPaths = new Set(workspace.files.map((file) => file.path));
  const previousPaths = new Set(
    workspace.githubBase?.repository.id === repository.id
      ? workspace.githubBase.files.map((file) => file.path)
      : [],
  );
  const additions = imported.filter((file) => !localPaths.has(file.path) && !previousPaths.has(file.path));
  const allFiles = [...workspace.files, ...additions];
  const filePaths = new Set(allFiles.map((file) => file.path));
  const folders = new Set(workspace.folders);
  for (const folder of workspace.folders) {
    for (let parent = getFolderPath(folder); parent; parent = getFolderPath(parent)) {
      folders.add(parent);
    }
  }
  for (const file of allFiles) {
    for (let folder = getFolderPath(file.path); folder; folder = getFolderPath(folder)) {
      if (filePaths.has(folder)) throw new Error(`Cannot import: "${folder}" is both a file and a folder.`);
    }
    if (folders.has(file.path)) throw new Error(`Cannot import: "${file.path}" is an existing folder.`);
  }
  return workspaceSchema.parse({
    ...workspace,
    files: allFiles,
    githubBase: { repository, branch, commit, files: imported },
  });
}

export function getGithubChanges(workspace: Workspace): {
  deleted: string[];
  baseByPath: Map<string, WorkspaceFile>;
} {
  const baseByPath = new Map(workspace.githubBase?.files.map((file) => [file.path, file]));
  const paths = new Set(workspace.files.map((file) => file.path));
  return {
    baseByPath,
    deleted: [...baseByPath.keys()].filter((path) => !paths.has(path)).sort(),
  };
}

const STORAGE_KEY_PREFIX = "locusmind.workspace.v1";
const GUEST_STORAGE_KEY = "locusmind.guest.workspace.v1";

function getStorageKey(userId: string | null): string {
  return userId === null
    ? GUEST_STORAGE_KEY
    : `${STORAGE_KEY_PREFIX}.${encodeURIComponent(userId)}`;
}

export const drawingStarter = JSON.stringify(
  {
    type: "excalidraw",
    version: 2,
    source: "locusmind",
    elements: [],
    appState: {},
    files: {},
  },
  null,
  2,
);

export function createStarterWorkspace(): Workspace {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: "My locusmind",
    files: [
      {
        id: crypto.randomUUID(),
        path: "notes/Welcome.md",
        type: "markdown",
        content:
          "# A space to think\n\nWelcome to locusmind. Capture an idea, connect it to another, and let your thinking take shape.\n\n## Start here\n\n- Create a note for something on your mind\n- Sketch a system or a process\n\n> Your workspace is saved in this browser for now.",
        updatedAt: now,
      },
      {
        id: crypto.randomUUID(),
        path: "notes/Ideas.md",
        type: "markdown",
        content:
          "# Ideas\n\nA quiet place for thoughts that are still becoming.",
        updatedAt: now,
      },
      {
        id: crypto.randomUUID(),
        path: "drawings/System map.excalidraw",
        type: "excalidraw",
        content: drawingStarter,
        updatedAt: now,
      },
    ],
    snapshots: [],
    folders: ["notes", "drawings"],
  };
}

export function loadWorkspace(
  userId: string | null,
): { workspace: Workspace; error: string | null } {
  try {
    const stored = window.localStorage.getItem(getStorageKey(userId));
    if (!stored) {
      return { workspace: createStarterWorkspace(), error: null };
    }
    return { workspace: workspaceSchema.parse(JSON.parse(stored)), error: null };
  } catch (error) {
    const reason =
      error instanceof z.ZodError
        ? "The saved workspace does not match the expected format."
        : error instanceof Error
          ? `The saved workspace could not be read: ${error.message}`
          : "The saved workspace could not be read.";
    return { workspace: createStarterWorkspace(), error: reason };
  }
}

export function persistWorkspace(userId: string | null, workspace: Workspace): void {
  const validatedWorkspace = workspaceSchema.parse(workspace);
  window.localStorage.setItem(
    getStorageKey(userId),
    JSON.stringify(validatedWorkspace),
  );
}

export function createFile(
  type: WorkspaceFile["type"],
  path: string,
): WorkspaceFile {
  const normalizedPath = path.trim().replace(/^\/+|\/+$/g, "");
  const extension = type === "markdown" ? ".md" : ".excalidraw";
  const finalPath = normalizedPath.endsWith(extension)
    ? normalizedPath
    : `${normalizedPath}${extension}`;

  return {
    id: crypto.randomUUID(),
    path: finalPath,
    type,
    content:
      type === "markdown"
        ? `# ${finalPath.split("/").at(-1)?.replace(/\.md$/, "") ?? "Untitled"}\n\n`
        : drawingStarter,
    updatedAt: new Date().toISOString(),
  };
}

export function getFileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

export function getFolderPath(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

export function getFolderName(path: string): string {
  return getFolderPath(path) || "Workspace";
}

export function getUniquePath(
  files: WorkspaceFile[],
  type: WorkspaceFile["type"],
  folders: string[] = [],
  parent?: string,
): string {
  const folder = parent ?? (type === "markdown" ? "notes" : "drawings");
  const extension = type === "markdown" ? ".md" : ".excalidraw";
  const existing = new Set([...folders, ...files.map((file) => file.path)]);
  const prefix = folder ? `${folder}/` : "";
  let index = 1;
  let path = `${prefix}Untitled${extension}`;
  while (existing.has(path)) {
    index += 1;
    path = `${prefix}Untitled ${index}${extension}`;
  }
  return path;
}

export function saveSnapshot(
  workspace: Workspace,
  message: string,
): Workspace {
  const snapshot: Snapshot = {
    id: crypto.randomUUID(),
    message,
    createdAt: new Date().toISOString(),
    files: workspace.files,
  };
  return { ...workspace, snapshots: [snapshot, ...workspace.snapshots] };
}
