import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  updatePassword as fbUpdatePassword,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js'
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  runTransaction,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js'
import { auth, db } from './firebase.js'
import { isValidEmail, isValidUsername } from './utils.js'

// usernames/{username} -> { uid } is a reservation doc that makes usernames
// unique and lets us resolve "login by username" to an email without a backend.
export async function registerUser({ email, password, username, fullName }) {
  if (!isValidUsername(username)) throw new Error('Usernames must be 3-20 characters: letters, numbers, . or _')
  if (!isValidEmail(email)) throw new Error('Enter a valid email address.')
  if (password.length < 6) throw new Error('Password must be at least 6 characters.')

  const usernameRef = doc(db, 'usernames', username.toLowerCase())
  const existing = await getDoc(usernameRef)
  if (existing.exists()) throw new Error('That username is already taken.')

  const credential = await createUserWithEmailAndPassword(auth, email, password)
  const uid = credential.user.uid

  await setDoc(usernameRef, { uid, email })
  await setDoc(doc(db, 'users', uid), {
    uid,
    username: username.toLowerCase(),
    usernameDisplay: username,
    email,
    fullName,
    avatarUrl: null,
    statusBio: 'Hey there! I am using Whippi.',
    isOnline: true,
    lastSeen: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  return credential.user
}

export async function loginUser(identifier, password) {
  let email = identifier.trim()
  if (!email.includes('@')) {
    const usernameRef = doc(db, 'usernames', email.toLowerCase())
    const snap = await getDoc(usernameRef)
    if (!snap.exists()) throw new Error('No account found with that username.')
    email = snap.data().email
  }
  const credential = await signInWithEmailAndPassword(auth, email, password)
  await setDoc(doc(db, 'users', credential.user.uid), { isOnline: true, lastSeen: serverTimestamp() }, { merge: true })
  return credential.user
}

export async function logoutUser() {
  if (auth.currentUser) {
    await setDoc(
      doc(db, 'users', auth.currentUser.uid),
      { isOnline: false, lastSeen: serverTimestamp() },
      { merge: true }
    ).catch(() => {})
  }
  await signOut(auth)
}

export async function requestPasswordReset(email) {
  await sendPasswordResetEmail(auth, email)
}

export async function updatePassword(newPassword) {
  if (!auth.currentUser) throw new Error('Not signed in.')
  await fbUpdatePassword(auth.currentUser, newPassword)
}

export async function setOnlineStatus(uid, isOnline) {
  await updateDoc(doc(db, 'users', uid), { isOnline, lastSeen: serverTimestamp() }).catch(() => {})
}

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid))
  return snap.exists() ? snap.data() : null
}

// Changing username means releasing the old reservation and claiming a new one atomically.
export async function changeUsername(uid, newUsername) {
  if (!isValidUsername(newUsername)) throw new Error('Usernames must be 3-20 characters: letters, numbers, . or _')
  const lower = newUsername.toLowerCase()

  await runTransaction(db, async (tx) => {
    const userRef = doc(db, 'users', uid)
    const userSnap = await tx.get(userRef)
    const oldUsername = userSnap.data()?.username
    const email = userSnap.data()?.email

    if (oldUsername === lower) return

    const newRef = doc(db, 'usernames', lower)
    const newSnap = await tx.get(newRef)
    if (newSnap.exists()) throw new Error('That username is already taken.')

    tx.set(newRef, { uid, email })
    if (oldUsername) tx.delete(doc(db, 'usernames', oldUsername))
    tx.update(userRef, { username: lower, usernameDisplay: newUsername, updatedAt: serverTimestamp() })
  })
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback)
}

export function currentUid() {
  return auth.currentUser?.uid ?? null
}
