import { useEffect, useState } from "react";
import { GithubAuthorizationError, listGithubRepositories, type GithubRepository } from "./github";

type Result = {
  token: string;
  repositories: GithubRepository[] | null;
  error: string;
  authorizationFailed: boolean;
};

export function useGithubRepositories(token: string | null) {
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    listGithubRepositories(token, controller.signal).then(
      (repositories) => {
        if (!controller.signal.aborted) setResult({ token, repositories, error: "", authorizationFailed: false });
      },
      (reason: unknown) => {
        if (!controller.signal.aborted) {
          setResult({
            token,
            repositories: null,
            error: reason instanceof Error ? reason.message : "Could not load GitHub repositories.",
            authorizationFailed: reason instanceof GithubAuthorizationError,
          });
        }
      },
    );
    return () => controller.abort();
  }, [token, attempt]);

  const current = result?.token === token ? result : null;
  return {
    repositories: current?.repositories ?? null,
    pending: token !== null && current === null,
    error: current?.error ?? "",
    authorizationFailed: current?.authorizationFailed ?? false,
    retry: () => {
      setResult(null);
      setAttempt((value) => value + 1);
    },
  };
}
