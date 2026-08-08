import { initializeApp } from 'firebase/app'
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  signInWithCredential, signOut,
} from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'
import { Capacitor } from '@capacitor/core'
import { FirebaseAuthentication } from '@capacitor-firebase/authentication'

// Point the app at your own Firebase project via .env.local — see .env.example
const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
})

export const auth = getAuth(app)
export const db = getFirestore(app)
export const functions = getFunctions(app, import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION ?? 'europe-west1')

export const signIn = async () => {
  // inside the Android/iOS shell Google blocks WebView popups — use the
  // native account sheet and hand its credential to the web SDK
  if (Capacitor.isNativePlatform()) {
    const result = await FirebaseAuthentication.signInWithGoogle()
    const idToken = result.credential?.idToken
    if (!idToken) throw new Error('Google sign-in was cancelled')
    return signInWithCredential(auth, GoogleAuthProvider.credential(idToken))
  }
  return signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => {
    if (e.code === 'auth/popup-blocked') {
      return signInWithRedirect(auth, new GoogleAuthProvider())
    }
    throw e
  })
}

export const logOut = async () => {
  if (Capacitor.isNativePlatform()) {
    await FirebaseAuthentication.signOut().catch(() => {})
  }
  return signOut(auth)
}
