import { doc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js'
import { ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js'
import { db, storage } from './firebase.js'
import { validateUpload } from './utils.js'
import { changeUsername } from './auth.js'

export async function updateProfile(uid, { fullName, statusBio, username }) {
  if (username) await changeUsername(uid, username)
  await updateDoc(doc(db, 'users', uid), {
    fullName,
    statusBio,
    updatedAt: serverTimestamp(),
  })
}

export async function uploadAvatar(uid, file) {
  const { valid, error } = validateUpload(file)
  if (!valid || !file.type.startsWith('image/')) throw new Error(error || 'Please choose an image file.')

  const path = `avatars/${uid}/${Date.now()}-${file.name}`
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, file)
  const url = await getDownloadURL(storageRef)

  await updateDoc(doc(db, 'users', uid), { avatarUrl: url, updatedAt: serverTimestamp() })
  return url
}

// Used for group icons too, so it does NOT touch the users/{uid} document.
export async function uploadRawImage(ownerId, file) {
  const { valid, error } = validateUpload(file)
  if (!valid || !file.type.startsWith('image/')) throw new Error(error || 'Please choose an image file.')

  const path = `avatars/${ownerId}/${Date.now()}-${file.name}`
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, file)
  return getDownloadURL(storageRef)
}
