import { z } from "zod";
import type { GithubBase, WorkspaceFile } from "./workspace";

const repositorySchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string().min(1),
  private: z.boolean(),
  archived: z.boolean(),
  permissions: z.object({ push: z.boolean() }),
});

export type GithubRepository = z.infer<typeof repositorySchema>;

export class GithubAuthorizationError extends Error {}

const selectedRepositorySchema = repositorySchema.pick({
  id: true,
  full_name: true,
  private: true,
});
export type SelectedRepository = z.infer<typeof selectedRepositorySchema>;

function tokenStorageKey(userId: string): string {
  return `locusmind.github-token.v1.${encodeURIComponent(userId)}`;
}

export function loadGithubToken(userId: string): string | null {
  const token = localStorage.getItem(tokenStorageKey(userId));
  return token === null ? null : z.string().min(1).parse(token);
}

export function saveGithubToken(userId: string, token: string): void {
  localStorage.setItem(tokenStorageKey(userId), z.string().min(1).parse(token));
}

export function removeGithubToken(userId: string): void {
  localStorage.removeItem(tokenStorageKey(userId));
}

function storageKey(userId: string): string {
  return `locusmind.github-repository.v1.${encodeURIComponent(userId)}`;
}

export function loadSelectedRepository(userId: string): SelectedRepository | null {
  const value = localStorage.getItem(storageKey(userId));
  return value === null ? null : selectedRepositorySchema.parse(JSON.parse(value));
}

export function saveSelectedRepository(userId: string, repository: SelectedRepository): void {
  localStorage.setItem(storageKey(userId), JSON.stringify(selectedRepositorySchema.parse(repository)));
}

export async function listGithubRepositories(
  token: string,
  signal: AbortSignal,
): Promise<GithubRepository[]> {
  const repositories: GithubRepository[] = [];
  for (let page = 1; ; page += 1) {
    const response = await fetch(
      `https://api.github.com/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal,
      },
    );
    if (!response.ok) {
      if (response.status === 401) {
        throw new GithubAuthorizationError("GitHub authorization expired. Reconnect GitHub to continue.");
      }
      throw new Error(`Could not load repositories from GitHub (HTTP ${response.status}).`);
    }
    const result = z.array(repositorySchema).parse(await response.json());
    repositories.push(...result);
    if (result.length < 100) return repositories;
  }
}

export async function createGithubRepository(
  token: string,
  name: string,
  isPrivate: boolean,
  signal: AbortSignal,
): Promise<SelectedRepository> {
  const response = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, private: isPrivate, auto_init: false }),
    signal,
  });
  if (!response.ok) {
    if (response.status === 401) throw new GithubAuthorizationError("GitHub authorization expired. Reconnect GitHub to continue.");
    if (response.status >= 500) throw new Error(`GitHub returned HTTP ${response.status}. The repository may have been created; check GitHub before retrying.`);
    throw new Error(`Could not create the GitHub repository (HTTP ${response.status}). Check the name and your GitHub permissions.`);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error("GitHub may have created the repository, but its response was invalid. Check GitHub before retrying.");
  }
  const result = selectedRepositorySchema.safeParse(data);
  if (!result.success) throw new Error("GitHub may have created the repository, but its response was invalid. Check GitHub before retrying.");
  return result.data;
}

const treeEntrySchema = z.object({
  path: z.string().min(1),
  type: z.string(),
  mode: z.string(),
  sha: z.string().min(1),
});

class EmptyGithubRepositoryError extends Error {}

export async function importGithubRepository(
  repository: SelectedRepository,
  token: string,
  signal: AbortSignal,
): Promise<{ branch: string; commit: string | null; files: WorkspaceFile[] }> {
  const parts = repository.full_name.split("/");
  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw new Error("Invalid GitHub repository name.");
  }
  const base = `https://api.github.com/repos/${parts.map(encodeURIComponent).join("/")}`;
  async function get(path: string): Promise<unknown> {
    const response = await fetch(`${base}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal,
    });
    if (!response.ok) {
      if (response.status === 401) throw new GithubAuthorizationError("GitHub authorization expired. Reconnect GitHub to continue.");
      if (response.status === 409 && path.startsWith("/git/ref/heads/")) {
        const error = z.object({ message: z.string() }).safeParse(await response.json());
        if (error.success && error.data.message === "Git Repository is empty.") {
          throw new EmptyGithubRepositoryError();
        }
      }
      throw new Error(`Could not import the GitHub repository (HTTP ${response.status}).`);
    }
    return response.json();
  }
  const metadata = z.object({ id: z.number(), default_branch: z.string().min(1) }).parse(await get(""));
  if (metadata.id !== repository.id) throw new Error("The selected repository no longer matches GitHub.");
  const branch = metadata.default_branch;
  let ref: { object: { sha: string } };
  try {
    ref = z.object({ object: z.object({ sha: z.string().min(1) }) }).parse(
      await get(`/git/ref/heads/${encodeURIComponent(branch)}`),
    );
  } catch (error) {
    if (error instanceof EmptyGithubRepositoryError) return { branch, commit: null, files: [] };
    throw error;
  }
  const commit = ref.object.sha;
  const commitData = z.object({ tree: z.object({ sha: z.string().min(1) }) }).parse(await get(`/git/commits/${encodeURIComponent(commit)}`));
  const tree = z.object({ truncated: z.boolean(), tree: z.array(treeEntrySchema) }).parse(
    await get(`/git/trees/${encodeURIComponent(commitData.tree.sha)}?recursive=1`),
  );
  if (tree.truncated) throw new Error("The GitHub repository tree is too large to import completely.");

  const files: WorkspaceFile[] = [];
  for (const entry of tree.tree) {
    const path = entry.path;
    const lower = path.toLowerCase();
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode) ||
        (!lower.endsWith(".md") && !lower.endsWith(".excalidraw"))) continue;
    const blob = z.object({ encoding: z.literal("base64"), content: z.string() }).parse(
      await get(`/git/blobs/${encodeURIComponent(entry.sha)}`),
    );
    const binary = atob(blob.content.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    files.push({
      id: crypto.randomUUID(),
      path,
      type: lower.endsWith(".md") ? "markdown" : "excalidraw",
      content,
      updatedAt: new Date().toISOString(),
    });
  }
  return { branch, commit, files };
}

export function getGithubSyncChanges(base: GithubBase, files: WorkspaceFile[]) {
  const previous = new Map(base.files.map((file) => [file.path, file]));
  const current = new Map(files.map((file) => [file.path, file]));
  return {
    added: files.filter((file) => !previous.has(file.path)),
    modified: files.filter((file) => previous.has(file.path) && previous.get(file.path)?.content !== file.content),
    deleted: base.files.filter((file) => !current.has(file.path)),
  };
}

export async function syncGithubWorkspace(
  base: GithubBase,
  files: WorkspaceFile[],
  token: string,
  signal: AbortSignal,
): Promise<string> {
  const parts = base.repository.full_name.split("/");
  if (parts.length !== 2 || parts.some((part) => !part)) throw new Error("Invalid GitHub repository name.");
  const url = `https://api.github.com/repos/${parts.map(encodeURIComponent).join("/")}`;
  async function request(path: string, method = "GET", body?: unknown): Promise<unknown> {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });
    if (!response.ok) {
      if (response.status === 401) throw new GithubAuthorizationError("GitHub authorization expired. Reconnect GitHub to continue.");
      if (response.status === 409 && method === "GET" && path.startsWith("/git/ref/heads/")) {
        const error = z.object({ message: z.string() }).safeParse(await response.json());
        if (error.success && error.data.message === "Git Repository is empty.") throw new EmptyGithubRepositoryError();
      }
      if (path.startsWith("/git/refs/heads/") && (response.status === 409 || response.status === 422)) {
        throw new Error("Could not update the GitHub branch. It may have changed or be protected; reselect the repository and review its branch rules.");
      }
      throw new Error(`Could not sync with GitHub (HTTP ${response.status}).`);
    }
    return response.json();
  }

  const changes = getGithubSyncChanges(base, files);
  if (!changes.added.length && !changes.modified.length && !changes.deleted.length) {
    throw new Error("There are no workspace changes to sync.");
  }
  const metadata = z.object({ id: z.number(), default_branch: z.string().min(1) }).parse(await request(""));
  if (metadata.id !== base.repository.id || metadata.default_branch !== base.branch) {
    throw new Error("The selected repository or its default branch changed. Reselect the repository before syncing.");
  }
  const refPath = `/git/ref/heads/${encodeURIComponent(base.branch)}`;
  let head: string | null;
  try {
    head = z.object({ object: z.object({ sha: z.string().min(1) }) }).parse(await request(refPath)).object.sha;
  } catch (error) {
    if (!(error instanceof EmptyGithubRepositoryError)) throw error;
    head = null;
  }
  if (head !== base.commit) {
    throw new Error("The GitHub branch changed since import. Reselect the repository and review changes before syncing.");
  }
  if (!base.commit) {
    if (base.files.length || !files.length) throw new Error("The empty repository baseline is invalid. Reselect the repository before syncing.");
    const first = files[0];
    const bytes = new TextEncoder().encode(first.content);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    let initial: { commit: { sha: string; parents: { sha: string }[] } };
    try {
      initial = z.object({
        commit: z.object({ sha: z.string().min(1), parents: z.array(z.object({ sha: z.string() })) }),
      }).parse(await request(`/contents/${first.path.split("/").map(encodeURIComponent).join("/")}`, "PUT", {
        message: "Initialize workspace from locusmind",
        content: btoa(binary),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not initialize the GitHub repository.";
      throw new Error(`${message} Check GitHub before retrying; the initial file may have been committed.`);
    }
    if (initial.commit.parents.length) {
      throw new Error("The repository changed during initialization and the first file was committed. Reselect the repository and review the remaining changes.");
    }
    if (files.length === 1) return initial.commit.sha;
    try {
      return await syncGithubWorkspace(
        { ...base, commit: initial.commit.sha, files: [first] },
        files,
        token,
        signal,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not sync the remaining files.";
      throw new Error(`The first file was committed, but the remaining sync did not finish. ${message} Reselect the repository and review changes before retrying.`);
    }
  }
  const commitData = z.object({ tree: z.object({ sha: z.string().min(1) }) }).parse(
    await request(`/git/commits/${encodeURIComponent(base.commit)}`),
  );
  const tree = z.object({ truncated: z.boolean(), tree: z.array(treeEntrySchema) }).parse(
    await request(`/git/trees/${encodeURIComponent(commitData.tree.sha)}?recursive=1`),
  );
  if (tree.truncated) throw new Error("The GitHub repository tree is too large to sync safely.");
  const remote = new Map(tree.tree.map((entry) => [entry.path, entry]));
  for (const file of changes.added) {
    if (remote.has(file.path)) throw new Error(`Cannot sync "${file.path}" because it already exists on GitHub.`);
  }
  for (const file of [...changes.modified, ...changes.deleted]) {
    if (!remote.has(file.path)) throw new Error(`Cannot sync "${file.path}" because it is missing from the imported GitHub commit.`);
  }
  for (const file of [...changes.added, ...changes.modified, ...changes.deleted]) {
    const entry = remote.get(file.path);
    if (entry && (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode))) {
      throw new Error(`Cannot sync "${file.path}" because it conflicts with a non-regular GitHub file.`);
    }
    const segments = file.path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const parent = segments.slice(0, index).join("/");
      const remoteEntry = remote.get(parent);
      if (remoteEntry && remoteEntry.type !== "tree") {
        throw new Error(`Cannot sync "${file.path}" because "${parent}" is not a directory on GitHub.`);
      }
    }
  }
  const entries = [
    ...[...changes.added, ...changes.modified].map((file) => ({
      path: file.path,
      mode: remote.get(file.path)?.mode ?? "100644",
      type: "blob",
      content: file.content,
    })),
    ...changes.deleted.map((file) => ({
      path: file.path,
      mode: remote.get(file.path)?.mode ?? "100644",
      type: "blob",
      sha: null,
    })),
  ];
  const newTree = z.object({ sha: z.string().min(1) }).parse(
    await request("/git/trees", "POST", { base_tree: commitData.tree.sha, tree: entries }),
  );
  const commit = z.object({ sha: z.string().min(1) }).parse(
    await request("/git/commits", "POST", {
      message: "Sync workspace from locusmind",
      tree: newTree.sha,
      parents: [base.commit],
    }),
  );
  const latest = z.object({ object: z.object({ sha: z.string().min(1) }) }).parse(await request(refPath));
  if (latest.object.sha !== base.commit) {
    throw new Error("The GitHub branch changed during sync. Reselect the repository and review changes before syncing.");
  }
  try {
    await request(`/git/refs/heads/${encodeURIComponent(base.branch)}`, "PATCH", { sha: commit.sha, force: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update the GitHub branch.";
    throw new Error(`${message} Check GitHub before retrying; the update may have completed.`);
  }
  return commit.sha;
}
