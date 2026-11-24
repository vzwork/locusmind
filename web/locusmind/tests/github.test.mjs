import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  listGithubRepositories,
  createGithubRepository,
  importGithubRepository,
  loadGithubToken,
  loadSelectedRepository,
  removeGithubToken,
  saveGithubToken,
  saveSelectedRepository,
  syncGithubWorkspace,
} from "../src/github.ts";
import { getGithubChanges, mergeGithubFiles, saveSnapshot, workspaceSchema } from "../src/workspace.ts";

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else delete globalThis.localStorage;
});

function repository(id) {
  return {
    id,
    full_name: `owner/repo-${id}`,
    private: true,
    archived: false,
    permissions: { push: true },
  };
}

test("lists all repository pages using the GitHub token", async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    const data = requests.length === 1
      ? Array.from({ length: 100 }, (_, index) => repository(index + 1))
      : [repository(101)];
    return new Response(JSON.stringify(data));
  };
  const signal = new AbortController().signal;
  const result = await listGithubRepositories("test-token", signal);
  assert.equal(result.length, 101);
  assert.match(requests[1].url, /page=2/);
  assert.equal(requests[0].options.headers.Authorization, "Bearer test-token");
  assert.equal(requests[0].options.signal, signal);
});

test("surfaces API errors and invalid responses", async () => {
  globalThis.fetch = async () => new Response(null, { status: 401 });
  await assert.rejects(listGithubRepositories("expired", new AbortController().signal), /authorization expired/i);
  globalThis.fetch = async () => new Response(JSON.stringify([{ id: 1 }]));
  await assert.rejects(listGithubRepositories("token", new AbortController().signal));
});

test("creates an empty repository with the requested visibility", async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify(repository(1)), { status: 201 });
  };
  const signal = new AbortController().signal;
  assert.deepEqual(await createGithubRepository("token", "repo-1", true, signal), {
    id: 1, full_name: "owner/repo-1", private: true,
  });
  assert.equal(request.url, "https://api.github.com/user/repos");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer token");
  assert.deepEqual(JSON.parse(request.options.body), { name: "repo-1", private: true, auto_init: false });
  assert.equal(request.options.signal, signal);
});

test("reports repository creation errors and uncertain responses", async () => {
  globalThis.fetch = async () => new Response(null, { status: 401 });
  await assert.rejects(createGithubRepository("token", "repo", false, new AbortController().signal), /authorization expired/i);
  globalThis.fetch = async () => new Response(null, { status: 422 });
  await assert.rejects(createGithubRepository("token", "repo", false, new AbortController().signal), /HTTP 422/);
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 1 }), { status: 201 });
  await assert.rejects(createGithubRepository("token", "repo", false, new AbortController().signal), /check GitHub before retrying/i);
  globalThis.fetch = async () => new Response("not json", { status: 201 });
  await assert.rejects(createGithubRepository("token", "repo", false, new AbortController().signal), /check GitHub before retrying/i);
  globalThis.fetch = async () => new Response(null, { status: 500 });
  await assert.rejects(createGithubRepository("token", "repo", false, new AbortController().signal), /check GitHub before retrying/i);
});

test("stores selected repository per user without extra API data", () => {
  const values = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  });
  saveSelectedRepository("user/1", repository(1));
  assert.deepEqual(loadSelectedRepository("user/1"), {
    id: 1,
    full_name: "owner/repo-1",
    private: true,
  });
  assert.equal(loadSelectedRepository("user/2"), null);
});

test("retains tokens per account and removes only the signed-out account's token", () => {
  const values = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  });
  saveGithubToken("user/1", "first-token");
  saveGithubToken("user/2", "second-token");
  assert.equal(loadGithubToken("user/1"), "first-token");
  removeGithubToken("user/1");
  assert.equal(loadGithubToken("user/1"), null);
  assert.equal(loadGithubToken("user/2"), "second-token");
  assert.throws(() => saveGithubToken("user/1", ""));
});

test("imports supported regular files from a pinned default-branch commit", async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    const data = url.endsWith("/repos/owner/repo-1") ? { id: 1, default_branch: "main" }
      : url.endsWith("/git/ref/heads/main") ? { object: { sha: "commit1" } }
      : url.endsWith("/git/commits/commit1") ? { tree: { sha: "tree1" } }
      : url.endsWith("/git/trees/tree1?recursive=1") ? { truncated: false, tree: [
        { path: "notes/idea.md", type: "blob", mode: "100644", sha: "blob1" },
        { path: "link.md", type: "blob", mode: "120000", sha: "link" },
        { path: "image.png", type: "blob", mode: "100644", sha: "image" },
      ] }
      : url.endsWith("/git/blobs/blob1") ? { encoding: "base64", content: Buffer.from("Hello 🌍").toString("base64") }
      : null;
    assert.ok(data, `Unexpected request ${url}`);
    return new Response(JSON.stringify(data));
  };
  const result = await importGithubRepository(repository(1), "token", new AbortController().signal);
  assert.equal(result.commit, "commit1");
  assert.equal(result.branch, "main");
  assert.deepEqual(result.files.map(({ path, content }) => ({ path, content })), [
    { path: "notes/idea.md", content: "Hello 🌍" },
  ]);
  assert.equal(requests.length, 5);
  assert.ok(requests.every(({ options }) => options.headers.Authorization === "Bearer token"));
});

test("rejects a truncated GitHub tree without importing partial data", async () => {
  let call = 0;
  const responses = [
    { id: 1, default_branch: "main" },
    { object: { sha: "commit1" } },
    { tree: { sha: "tree1" } },
    { truncated: true, tree: [] },
  ];
  globalThis.fetch = async () => new Response(JSON.stringify(responses[call++]));
  await assert.rejects(importGithubRepository(repository(1), "token", new AbortController().signal), /too large/);
});

test("imports an empty repository without inventing a commit", async () => {
  let call = 0;
  globalThis.fetch = async () => ++call === 1
    ? new Response(JSON.stringify({ id: 1, default_branch: "main" }))
    : new Response(JSON.stringify({ message: "Git Repository is empty." }), { status: 409 });
  assert.deepEqual(await importGithubRepository(repository(1), "token", new AbortController().signal), {
    branch: "main", commit: null, files: [],
  });
});

function file(path, content) {
  return { id: crypto.randomUUID(), path, type: "markdown", content, updatedAt: new Date().toISOString() };
}

test("sync commits reviewed additions, edits and deletions without replacing unrelated files", async () => {
  const base = {
    repository: repository(1), branch: "main", commit: "commit1",
    files: [file("edit.md", "old"), file("delete.md", "delete"), file("same.md", "same")],
  };
  const files = [file("edit.md", "new 🌍"), file("added.md", "added"), base.files[2]];
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    const data = url.endsWith("/repos/owner/repo-1") ? { id: 1, default_branch: "main" }
      : url.endsWith("/git/ref/heads/main") ? { object: { sha: "commit1" } }
      : url.endsWith("/git/commits/commit1") ? { tree: { sha: "tree1" } }
      : url.endsWith("/git/trees/tree1?recursive=1") ? { truncated: false, tree: [
        { path: "edit.md", type: "blob", mode: "100755", sha: "a" },
        { path: "delete.md", type: "blob", mode: "100644", sha: "b" },
        { path: "same.md", type: "blob", mode: "100644", sha: "c" },
        { path: "image.png", type: "blob", mode: "100644", sha: "d" },
      ] }
      : url.endsWith("/git/trees") ? { sha: "tree2" }
      : url.endsWith("/git/commits") ? { sha: "commit2" }
      : url.endsWith("/git/refs/heads/main") ? { object: { sha: "commit2" } }
      : null;
    assert.ok(data, `Unexpected request ${url}`);
    return new Response(JSON.stringify(data));
  };
  assert.equal(await syncGithubWorkspace(base, files, "token", new AbortController().signal), "commit2");
  const tree = JSON.parse(requests.find(({ url }) => url.endsWith("/git/trees")).options.body);
  assert.equal(tree.base_tree, "tree1");
  assert.deepEqual(tree.tree, [
    { path: "added.md", mode: "100644", type: "blob", content: "added" },
    { path: "edit.md", mode: "100755", type: "blob", content: "new 🌍" },
    { path: "delete.md", mode: "100644", type: "blob", sha: null },
  ]);
  const update = requests.at(-1);
  assert.equal(update.options.method, "PATCH");
  assert.deepEqual(JSON.parse(update.options.body), { sha: "commit2", force: false });
  assert.ok(requests.every(({ options }) => options.headers.Authorization === "Bearer token"));
});

test("sync refuses a changed branch before writing anything", async () => {
  const base = { repository: repository(1), branch: "main", commit: "commit1", files: [] };
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify(url.endsWith("/repos/owner/repo-1")
      ? { id: 1, default_branch: "main" }
      : { object: { sha: "commit2" } }));
  };
  await assert.rejects(syncGithubWorkspace(base, [file("new.md", "new")], "token", new AbortController().signal), /changed since import/);
  assert.ok(requests.every(({ options }) => options.method === "GET"));
});

test("sync refuses to overwrite a non-regular remote file", async () => {
  const base = { repository: repository(1), branch: "main", commit: "commit1", files: [] };
  const responses = [
    { id: 1, default_branch: "main" },
    { object: { sha: "commit1" } },
    { tree: { sha: "tree1" } },
    { truncated: false, tree: [{ path: "link.md", type: "blob", mode: "120000", sha: "a" }] },
  ];
  let call = 0;
  globalThis.fetch = async () => new Response(JSON.stringify(responses[call++]));
  await assert.rejects(syncGithubWorkspace(base, [file("link.md", "new")], "token", new AbortController().signal), /already exists/);
  assert.equal(call, 4);
});

test("sync stops if the branch changes while the commit is being prepared", async () => {
  const base = { repository: repository(1), branch: "main", commit: "commit1", files: [] };
  const responses = [
    { id: 1, default_branch: "main" },
    { object: { sha: "commit1" } },
    { tree: { sha: "tree1" } },
    { truncated: false, tree: [] },
    { sha: "tree2" },
    { sha: "commit2" },
    { object: { sha: "commit3" } },
  ];
  let call = 0;
  globalThis.fetch = async () => new Response(JSON.stringify(responses[call++]));
  await assert.rejects(syncGithubWorkspace(base, [file("new.md", "new")], "token", new AbortController().signal), /changed during sync/);
  assert.equal(call, 7);
});

test("sync reports a rejected branch update without claiming success", async () => {
  const base = { repository: repository(1), branch: "main", commit: "commit1", files: [] };
  const responses = [
    { id: 1, default_branch: "main" },
    { object: { sha: "commit1" } },
    { tree: { sha: "tree1" } },
    { truncated: false, tree: [] },
    { sha: "tree2" },
    { sha: "commit2" },
    { object: { sha: "commit1" } },
  ];
  let call = 0;
  globalThis.fetch = async () => call < responses.length
    ? new Response(JSON.stringify(responses[call++]))
    : new Response(null, { status: 422 });
  await assert.rejects(syncGithubWorkspace(base, [file("new.md", "new")], "token", new AbortController().signal), /protected.*check GitHub/i);
});

test("sync initializes an empty repository with a UTF-8 workspace file", async () => {
  const base = { repository: repository(1), branch: "main", commit: null, files: [] };
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/repos/owner/repo-1")) return new Response(JSON.stringify({ id: 1, default_branch: "main" }));
    if (url.endsWith("/git/ref/heads/main")) return new Response(JSON.stringify({ message: "Git Repository is empty." }), { status: 409 });
    if (url.endsWith("/contents/notes/hello%20world.md")) return new Response(JSON.stringify({ commit: { sha: "initial", parents: [] } }));
    throw new Error(`Unexpected request ${url}`);
  };
  assert.equal(await syncGithubWorkspace(base, [file("notes/hello world.md", "Hello 🌍")], "token", new AbortController().signal), "initial");
  assert.equal(requests[2].options.method, "PUT");
  assert.equal(Buffer.from(JSON.parse(requests[2].options.body).content, "base64").toString("utf8"), "Hello 🌍");
});

test("sync initializes an empty repository then commits the remaining files", async () => {
  const base = { repository: repository(1), branch: "main", commit: null, files: [] };
  const first = file("first.md", "one");
  const second = file("second.md", "two");
  const requests = [];
  let refs = 0;
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/repos/owner/repo-1")) return new Response(JSON.stringify({ id: 1, default_branch: "main" }));
    if (url.endsWith("/git/ref/heads/main")) {
      if (refs++ === 0) return new Response(JSON.stringify({ message: "Git Repository is empty." }), { status: 409 });
      return new Response(JSON.stringify({ object: { sha: "initial" } }));
    }
    const data = url.endsWith("/contents/first.md") ? { commit: { sha: "initial", parents: [] } }
      : url.endsWith("/git/commits/initial") ? { tree: { sha: "tree1" } }
      : url.endsWith("/git/trees/tree1?recursive=1") ? { truncated: false, tree: [
        { path: "first.md", type: "blob", mode: "100644", sha: "blob1" },
      ] }
      : url.endsWith("/git/trees") ? { sha: "tree2" }
      : url.endsWith("/git/commits") ? { sha: "final" }
      : url.endsWith("/git/refs/heads/main") ? { object: { sha: "final" } }
      : null;
    assert.ok(data, `Unexpected request ${url}`);
    return new Response(JSON.stringify(data));
  };
  assert.equal(await syncGithubWorkspace(base, [first, second], "token", new AbortController().signal), "final");
  const tree = JSON.parse(requests.find(({ url }) => url.endsWith("/git/trees")).options.body);
  assert.deepEqual(tree.tree, [{ path: "second.md", mode: "100644", type: "blob", content: "two" }]);
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), { sha: "final", force: false });
});

test("sync reports a partial initialization if the remaining commit fails", async () => {
  const base = { repository: repository(1), branch: "main", commit: null, files: [] };
  let metadataCalls = 0;
  globalThis.fetch = async (url) => {
    if (url.endsWith("/repos/owner/repo-1")) {
      if (metadataCalls++ === 0) return new Response(JSON.stringify({ id: 1, default_branch: "main" }));
      return new Response(null, { status: 403 });
    }
    if (url.endsWith("/git/ref/heads/main")) return new Response(JSON.stringify({ message: "Git Repository is empty." }), { status: 409 });
    if (url.endsWith("/contents/first.md")) return new Response(JSON.stringify({ commit: { sha: "initial", parents: [] } }));
    throw new Error(`Unexpected request ${url}`);
  };
  await assert.rejects(syncGithubWorkspace(base, [file("first.md", "one"), file("second.md", "two")], "token", new AbortController().signal), /first file was committed.*remaining sync.*reselect/i);
});

test("sync detects if an empty repository was initialized elsewhere", async () => {
  const base = { repository: repository(1), branch: "main", commit: null, files: [] };
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify(url.endsWith("/repos/owner/repo-1")
      ? { id: 1, default_branch: "main" }
      : { object: { sha: "other" } }));
  };
  await assert.rejects(syncGithubWorkspace(base, [file("new.md", "new")], "token", new AbortController().signal), /changed since import/i);
  assert.ok(requests.every(({ options }) => options.method === "GET"));
});

test("sync reports when another commit raced with repository initialization", async () => {
  const base = { repository: repository(1), branch: "main", commit: null, files: [] };
  globalThis.fetch = async (url) => {
    if (url.endsWith("/repos/owner/repo-1")) return new Response(JSON.stringify({ id: 1, default_branch: "main" }));
    if (url.endsWith("/git/ref/heads/main")) return new Response(JSON.stringify({ message: "Git Repository is empty." }), { status: 409 });
    return new Response(JSON.stringify({ commit: { sha: "initial", parents: [{ sha: "other" }] } }));
  };
  await assert.rejects(syncGithubWorkspace(base, [file("new.md", "new")], "token", new AbortController().signal), /changed during initialization.*first file was committed/i);
});

test("merges without overwriting local files and tracks changes against GitHub across local snapshots", () => {
  const local = file("notes/overlap.md", "local");
  const localOnly = file("local.md", "local only");
  const remote = [file("notes/overlap.md", "remote"), file("notes/new.md", "new")];
  const initial = { id: crypto.randomUUID(), name: "test", files: [local, localOnly], folders: [], snapshots: [] };
  const merged = mergeGithubFiles(initial, repository(1), "main", "commit1", remote);
  assert.equal(merged.files.find((item) => item.path === local.path).content, "local");
  assert.equal(merged.files.find((item) => item.path === "notes/new.md").content, "new");
  const changes = getGithubChanges(merged);
  assert.equal(changes.baseByPath.get(local.path).content, "remote");
  assert.equal(changes.baseByPath.has(localOnly.path), false);
  const deleted = { ...merged, files: merged.files.filter((item) => item.path !== "notes/new.md") };
  const saved = saveSnapshot(deleted, "local checkpoint");
  assert.deepEqual(getGithubChanges(saved).deleted, ["notes/new.md"]);
  const refreshed = mergeGithubFiles(saved, repository(1), "main", "commit2", [...remote, file("added.md", "added")]);
  assert.equal(refreshed.files.some((item) => item.path === "notes/new.md"), false);
  assert.equal(refreshed.files.some((item) => item.path === "added.md"), true);
  assert.deepEqual(getGithubChanges(workspaceSchema.parse(JSON.parse(JSON.stringify(refreshed)))).deleted, ["notes/new.md"]);
});

test("refuses an import that conflicts with an existing folder", () => {
  const workspace = { id: crypto.randomUUID(), name: "test", files: [], folders: ["notes.md/nested"], snapshots: [] };
  assert.throws(() => mergeGithubFiles(workspace, repository(1), "main", "commit1", [file("notes.md", "remote")]), /existing folder/);
  assert.equal(workspace.files.length, 0);
});

test("the explorer shows creation controls below search without a section title", async () => {
  const { createServer } = await import("vite");
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
  try {
    const { ExplorerPanel } = await server.ssrLoadModule("/src/explorer/ExplorerPanel.tsx");
    const html = renderToStaticMarkup(createElement(ExplorerPanel, {
      workspace: { files: [], folders: [], snapshots: [] },
      selection: null, navigate() {}, actions: { allFolders: [] },
      collapse: { collapsed: new Set() }, search: "", onSearchChange() {},
      onCreateFile() {}, onCreateFolder() {}, onSync() {}, syncDisabled: false, syncDisabledReason: "",
    }));
    const searchIndex = html.indexOf('aria-label="Search files"');
    assert.ok(searchIndex >= 0);
    assert.ok(html.indexOf("Sync to GitHub") < searchIndex);
    for (const label of ["Create note", "Create drawing", "Create folder"]) {
      assert.ok(html.indexOf(`aria-label="${label}"`) > searchIndex);
    }
    assert.doesNotMatch(html, /your space/i);
  } finally {
    await server.close();
  }
});

test("the open repository dropdown lists available repositories and their selection state", async () => {
  const { createServer } = await import("vite");
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
  try {
    const { Sidebar } = await server.ssrLoadModule("/src/components/Sidebar.tsx");
    const { RepositoryPicker } = await server.ssrLoadModule("/src/components/RepositoryPicker.tsx");
    const first = repository(1);
    const second = repository(2);
    const archived = { ...repository(3), archived: true };
    const picker = createElement(RepositoryPicker, {
      token: "token", repositories: [first, second, archived], pending: false, loadError: "",
      authorizationFailed: false, onRetry() {}, onReconnect() {}, selected: first,
      importing: false, async onSelect() {},
    });
    const html = renderToStaticMarkup(createElement(Sidebar, {
      user: { displayName: "User" }, repositoryName: first.full_name,
      repositoryPickerOpen: true, importing: false, repositoryPicker: picker,
      onClose() {}, onRepositoryPickerOpenChange() {}, onLeaveWorkspace() {},
    }));
    assert.match(html, /aria-expanded="true"/);
    assert.match(html, /owner\/repo-1/);
    assert.match(html, /owner\/repo-2/);
    assert.match(html, /aria-label="Selected"/);
    assert.match(html, /disabled=""><span class="repository-option-copy"><span class="repository-option-name">owner\/repo-3/);
    assert.doesNotMatch(html, /role="dialog"/);
    assert.doesNotMatch(html, /Save version/);
  } finally {
    await server.close();
  }
});
