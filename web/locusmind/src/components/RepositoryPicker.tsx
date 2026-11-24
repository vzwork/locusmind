import { useState } from "react";
import { Check, Lock, Plus, Search } from "lucide-react";
import { createGithubRepository, GithubAuthorizationError, type GithubRepository, type SelectedRepository } from "../github";

type Props = {
  token: string | null;
  repositories: GithubRepository[] | null;
  pending: boolean;
  loadError: string;
  authorizationFailed: boolean;
  onRetry: () => void;
  onReconnect: () => void;
  selected: SelectedRepository | null;
  importing: boolean;
  creating: boolean;
  onCreatingChange: (creating: boolean) => void;
  onSelect: (repository: SelectedRepository) => Promise<void>;
};

export function RepositoryPicker({ token, repositories, pending, loadError, authorizationFailed, onRetry, onReconnect, selected, importing, creating, onCreatingChange, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [importAuthorizationFailed, setImportAuthorizationFailed] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [created, setCreated] = useState("");

  const matches = repositories?.filter((repository) =>
    repository.full_name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  async function select(repository: GithubRepository) {
    setError("");
    setImportAuthorizationFailed(false);
    try {
      await onSelect(repository);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not import the repository.");
      setImportAuthorizationFailed(reason instanceof GithubAuthorizationError);
    }
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || creating || !name.trim()) return;
    setError("");
    setCreated("");
    setImportAuthorizationFailed(false);
    onCreatingChange(true);
    try {
      const repository = await createGithubRepository(token, name.trim(), isPrivate, new AbortController().signal);
      setCreated(`Created ${repository.full_name}. Select it below to import it.`);
      setName("");
      setQuery("");
      setShowCreate(false);
      onRetry();
    } catch (reason) {
      setError(reason instanceof TypeError
        ? "Could not reach GitHub. The repository may have been created; check GitHub before retrying."
        : reason instanceof Error ? reason.message : "Could not create the repository. Check GitHub before retrying.");
      setImportAuthorizationFailed(reason instanceof GithubAuthorizationError);
    } finally {
      onCreatingChange(false);
    }
  }

  return (
    <div>
      {importing && <p className="repository-loading" role="status">Importing repository…</p>}
      {repositories === null ? (
        <>
          {pending ? (
            <p className="repository-loading" role="status">
              <span className="loading-spinner" aria-hidden="true" />
              Loading repositories from GitHub…
            </p>
          ) : token ? (
            <button className="github-sign-in" onClick={authorizationFailed ? onReconnect : onRetry} autoFocus>
              {authorizationFailed ? "Reconnect GitHub" : "Try again"}
            </button>
          ) : (
            <>
              <p className="repository-permission" role="status">
                GitHub repository access is not available. Reconnect GitHub to choose a repository.
              </p>
              <button className="github-sign-in" onClick={onReconnect}>Reconnect GitHub</button>
            </>
          )}
        </>
      ) : (
        <>
          <label className="search-field repository-search">
            <Search size={15} />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search repositories" aria-label="Search repositories" disabled={importing || creating} />
          </label>
          <div className="repository-list" aria-label="GitHub repositories">
            {matches?.length ? matches.map((repository) => {
              const unavailable = repository.archived || !repository.permissions.push;
              return (
                <button
                  className="repository-option"
                  key={repository.id}
                  disabled={unavailable || importing || creating}
                  onClick={() => { void select(repository); }}
                >
                  <span className="repository-option-copy">
                    <span className="repository-option-name">{repository.full_name}</span>
                    <span className="repository-option-meta">
                      {repository.private && <Lock size={11} />}
                      {repository.private ? "Private" : "Public"}
                      {repository.archived ? " · Archived" : !repository.permissions.push ? " · No write access" : ""}
                    </span>
                  </span>
                  {selected?.id === repository.id && <Check size={16} aria-label="Selected" />}
                </button>
              );
            }) : <p className="repository-empty">{repositories.length ? "No repositories match your search." : "No repositories available to this GitHub account."}</p>}
          </div>
        </>
      )}
      {(error || loadError) && <p className="auth-error" role="alert">{error || loadError}</p>}
      {importAuthorizationFailed && <button className="github-sign-in" onClick={onReconnect}>Reconnect GitHub</button>}
      {created && <p className="repository-created" role="status">{created}</p>}
      {token && !authorizationFailed && (
        showCreate ? (
          <form className="repository-create" onSubmit={(event) => { void create(event); }}>
            <label htmlFor="repository-name">Repository name</label>
            <input id="repository-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="my-repository" required autoFocus disabled={creating} />
            <label className="repository-private">
              <input type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} disabled={creating} />
              Private repository
            </label>
            <div className="repository-create-actions">
              <button type="submit" className="workspace-menu-action" disabled={creating || importing || !name.trim()}>{creating ? "Creating…" : "Create repository"}</button>
              <button type="button" className="workspace-menu-action" disabled={creating} onClick={() => { setShowCreate(false); setError(""); }}>Cancel</button>
            </div>
          </form>
        ) : (
          <button className="workspace-menu-action" disabled={importing} onClick={() => { setError(""); setCreated(""); setShowCreate(true); }}>
            <Plus size={15} /> Create repository
          </button>
        )
      )}
      {repositories && <button className="workspace-menu-action" onClick={onRetry} disabled={importing || creating}>Refresh repositories</button>}
    </div>
  );
}
