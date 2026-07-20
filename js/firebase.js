import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js'
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js'
import { getFirestore, enableIndexedDbPersistence } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js'
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js'
import { firebaseConfig } from './firebase-config.js'

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)

setPersistence(auth, browserLocalPersistence).catch(() => {})

// Offline cache is best-effort; ignore if unsupported (e.g. private browsing, multiple tabs).
enableIndexedDbPersistence(db).catch(() => {})
