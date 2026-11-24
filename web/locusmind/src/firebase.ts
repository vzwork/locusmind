import { getApp, getApps, initializeApp } from "firebase/app";
import {
  GithubAuthProvider,
  getAuth,
  getRedirectResult,
  reauthenticateWithRedirect,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Object.values(firebaseConfig).every(
  (value) => typeof value === "string" && value.length > 0,
);

export const auth = isFirebaseConfigured
  ? getAuth(
      getApps().length > 0 ? getApp() : initializeApp(firebaseConfig),
    )
  : null;

const REPOSITORY_AUTH_KEY = "locusmind.github-reauth.v1";
type GithubSession = { userId: string; token: string };
let redirectResult: Promise<GithubSession | null> | null = null;

function githubRepositoryProvider(): GithubAuthProvider {
  const provider = new GithubAuthProvider();
  provider.addScope("repo");
  return provider;
}

export async function signInWithGithub(): Promise<{ userId: string; token: string }> {
  if (!auth) {
    throw new Error("Firebase is not configured.");
  }

  const result = await signInWithPopup(auth, githubRepositoryProvider());
  const token = GithubAuthProvider.credentialFromResult(result)?.accessToken;
  if (!token) {
    throw new Error("GitHub did not provide an access token. Reconnect GitHub to select a repository.");
  }
  return { userId: result.user.uid, token };
}

export async function beginGithubRepositoryAuthorization(user: User): Promise<void> {
  sessionStorage.setItem(REPOSITORY_AUTH_KEY, user.uid);
  try {
    await reauthenticateWithRedirect(user, githubRepositoryProvider());
    throw new Error("Could not start GitHub authorization.");
  } catch (error) {
    sessionStorage.removeItem(REPOSITORY_AUTH_KEY);
    throw error;
  }
}

export function completeGithubRepositoryAuthorization(): Promise<GithubSession | null> {
  if (!redirectResult) {
    redirectResult = (async () => {
      const expectedUserId = sessionStorage.getItem(REPOSITORY_AUTH_KEY);
      if (!expectedUserId) return null;
      try {
        if (!auth) throw new Error("Firebase is not configured.");
        const result = await getRedirectResult(auth);
        if (!result || result.operationType !== "reauthenticate" ||
            result.user.uid !== expectedUserId || auth.currentUser?.uid !== expectedUserId) {
          throw new Error("GitHub authorization was not completed for the signed-in account.");
        }
        const token = GithubAuthProvider.credentialFromResult(result)?.accessToken;
        if (!token) throw new Error("GitHub did not provide an access token.");
        return { userId: expectedUserId, token };
      } finally {
        sessionStorage.removeItem(REPOSITORY_AUTH_KEY);
      }
    })();
  }
  return redirectResult;
}

export async function signOutFromFirebase(): Promise<void> {
  if (!auth) {
    throw new Error("Firebase is not configured.");
  }

  await signOut(auth);
}
