import { getApp, getApps, initializeApp } from "firebase/app";
import {
  GithubAuthProvider,
  getAuth,
  signInWithPopup,
  signOut,
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

export async function signInWithGithub(): Promise<void> {
  if (!auth) {
    throw new Error("Firebase is not configured.");
  }

  await signInWithPopup(auth, new GithubAuthProvider());
}

export async function signOutFromFirebase(): Promise<void> {
  if (!auth) {
    throw new Error("Firebase is not configured.");
  }

  await signOut(auth);
}
