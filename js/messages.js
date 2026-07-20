import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteField,
  getDocs,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  increment,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js'
import { ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js'
import { db, storage } from './firebase.js'
import { classifyFile, validateUpload } from './utils.js'

const PAGE_SIZE = 50

export function subscribeToMessages(chatId, callback) {
  const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'desc'), limit(PAGE_SIZE))
  return onSnapshot(q, (snap) => {
    const messages = snap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse()
    callback(messages)
  })
}

export async function sendTextMessage(chatId, senderId, content, replyTo = null) {
  await addDoc(collection(db, 'chats', chatId, 'messages'), {
    senderId,
    type: 'text',
    content,
    replyTo: replyTo ? { id: replyTo.id, content: replyTo.content, senderName: replyTo.senderName } : null,
    createdAt: serverTimestamp(),
    reactions: {},
  })
  await touchChatAfterMessage(chatId, senderId, { type: 'text', content })
}

export async function sendAttachmentMessage(chatId, senderId, file, { caption = '', replyTo = null, onProgress } = {}) {
  const { valid, error } = validateUpload(file)
  if (!valid) throw new Error(error)

  const kind = classifyFile(file)
  const type = kind === 'image' ? 'image' : kind === 'video' ? 'video' : kind === 'audio' ? 'audio' : 'document'

  onProgress?.(10)
  const path = `attachments/${chatId}/${Date.now()}-${file.name}`
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, file)
  onProgress?.(70)
  const url = await getDownloadURL(storageRef)

  let width = null
  let height = null
  if (kind === 'image') {
    const dims = await getImageDimensions(file).catch(() => null)
    if (dims) ({ width, height } = dims)
  }

  await addDoc(collection(db, 'chats', chatId, 'messages'), {
    senderId,
    type,
    content: caption,
    attachment: { url, name: file.name, fileType: file.type, size: file.size, width, height },
    replyTo: replyTo ? { id: replyTo.id, content: replyTo.content, senderName: replyTo.senderName } : null,
    createdAt: serverTimestamp(),
    reactions: {},
  })
  onProgress?.(100)

  await touchChatAfterMessage(chatId, senderId, { type, content: caption })
}

async function touchChatAfterMessage(chatId, senderId, lastMessage) {
  const { getDoc } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js')
  const chatSnap = await getDoc(doc(db, 'chats', chatId))
  const chat = chatSnap.data()
  if (!chat) return

  const updates = {
    lastMessage: { ...lastMessage, senderId },
    lastMessageAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  for (const uid of chat.participantIds || []) {
    if (uid === senderId) continue
    updates[`participants.${uid}.unreadCount`] = increment(1)
  }
  await updateDoc(doc(db, 'chats', chatId), updates)
}

export async function editMessage(chatId, messageId, content) {
  await updateDoc(doc(db, 'chats', chatId, 'messages', messageId), { content, editedAt: serverTimestamp() })
}

export async function deleteMessage(chatId, messageId) {
  await updateDoc(doc(db, 'chats', chatId, 'messages', messageId), {
    content: null,
    attachment: deleteField(),
    deletedAt: serverTimestamp(),
  })
}

export async function toggleReaction(chatId, messageId, uid, emoji) {
  const { getDoc } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js')
  const msgRef = doc(db, 'chats', chatId, 'messages', messageId)
  const snap = await getDoc(msgRef)
  const reactions = { ...(snap.data()?.reactions || {}) }
  if (reactions[uid] === emoji) {
    delete reactions[uid]
  } else {
    reactions[uid] = emoji
  }
  await updateDoc(msgRef, { reactions })
}

export async function searchMessagesInChat(chatId, queryText) {
  const snap = await getDocs(query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'desc'), limit(200)))
  const q = queryText.trim().toLowerCase()
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((m) => !m.deletedAt && m.content && m.content.toLowerCase().includes(q))
}

function getImageDimensions(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = reject
    img.src = url
  })
}
