import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAt,
  endAt,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js'
import { db } from './firebase.js'

function pairId(a, b) {
  return [a, b].sort().join('_')
}

// Firestore has no full-text search, so this does a prefix match on the
// lowercase username field: ordered range query from "query" to "query\uf8ff".
export async function searchUsers(currentUid, queryText) {
  const q = queryText.trim().toLowerCase()
  if (!q) return []
  const usersRef = collection(db, 'users')
  const usernameQuery = query(usersRef, orderBy('username'), startAt(q), endAt(q + '\uf8ff'), limit(20))
  const snap = await getDocs(usernameQuery)
  return snap.docs.map((d) => d.data()).filter((u) => u.uid !== currentUid)
}

export async function sendContactRequest(uid, targetUid) {
  const id = pairId(uid, targetUid)
  await setDoc(doc(db, 'contacts', id), {
    participants: [uid, targetUid],
    status: 'pending',
    requestedBy: uid,
    createdAt: serverTimestamp(),
  })
}

export async function acceptContactRequest(uid, requesterUid) {
  const id = pairId(uid, requesterUid)
  await setDoc(doc(db, 'contacts', id), { status: 'accepted', respondedAt: serverTimestamp() }, { merge: true })
}

export async function rejectContactRequest(uid, requesterUid) {
  await deleteDoc(doc(db, 'contacts', pairId(uid, requesterUid)))
}

export async function removeContact(uid, contactUid) {
  await deleteDoc(doc(db, 'contacts', pairId(uid, contactUid)))
}

export async function listContactRelations(uid) {
  const q = query(collection(db, 'contacts'), where('participants', 'array-contains', uid))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function blockUser(uid, blockedUid) {
  await setDoc(doc(db, 'users', uid, 'blocked', blockedUid), { blockedAt: serverTimestamp() })
  await deleteDoc(doc(db, 'contacts', pairId(uid, blockedUid))).catch(() => {})
}

export async function unblockUser(uid, blockedUid) {
  await deleteDoc(doc(db, 'users', uid, 'blocked', blockedUid))
}

export async function listBlockedUsers(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'blocked'))
  return snap.docs.map((d) => d.id)
}

export async function isBlocked(uid, otherUid) {
  const snap = await getDocs(query(collection(db, 'users', uid, 'blocked'), where('__name__', '==', otherUid)))
  return !snap.empty
}
