import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'

const app = initializeApp({
  apiKey: 'AIzaSyCWA0HX45p_Ya-1GgIdr51a5xvfkcp0WWA',
  authDomain: 'meat-grinder-88722.firebaseapp.com',
  projectId: 'meat-grinder-88722',
  storageBucket: 'meat-grinder-88722.firebasestorage.app',
  messagingSenderId: '21326285887',
  appId: '1:21326285887:web:a79582aedc7080a3f37c8a',
})

export const auth = getAuth(app)
export const db = getFirestore(app)
export const functions = getFunctions(app, 'europe-west1')

export const signIn = () =>
  signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => {
    if (e.code === 'auth/popup-blocked') {
      return signInWithRedirect(auth, new GoogleAuthProvider())
    }
    throw e
  })

export const logOut = () => signOut(auth)
