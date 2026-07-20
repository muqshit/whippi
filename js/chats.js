import {
  collection,
  doc,
  addDoc,
  updateDoc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js'
import { db } from './firebase.js'
import { generateInviteCode } from './utils.js'

export function subscribeToChats(uid, callback) {
  const q = query(collection(db, 'chats'), where('participantIds', 'array-contains', uid))
  return onSnapshot(q, async (snap) => {
    const chats = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    await hydratePeerProfiles(chats, uid)
    callback(sortChats(chats, uid))
  })
}

async function hydratePeerProfiles(chats, uid) {
  const peerIds = new Set()
  for (const chat of chats) {
    if (chat.type === 'direct') {
      const other = (chat.participantIds || []).find((id) => id !== uid)
      if (other) peerIds.add(other)
    }
  }
  const profiles = new Map()
  await Promise.all(
    Array.from(peerIds).map(async (id) => {
      const snap = await getDoc(doc(db, 'users', id))
      if (snap.exists()) profiles.set(id, snap.data())
    })
  )
  for (const chat of chats) {
    if (chat.type === 'direct') {
      const other = (chat.participantIds || []).find((id) => id !== uid)
      chat.peer = profiles.get(other) || null
    }
  }
}

function sortChats(chats, uid) {
  return chats.slice().sort((a, b) => {
    const aPinned = !!a.participants?.[uid]?.pinned
    const bPinned = !!b.participants?.[uid]?.pinned
    if (aPinned !== bPinned) return aPinned ? -1 : 1
    const at = a.lastMessageAt?.toMillis?.() ?? 0
    const bt = b.lastMessageAt?.toMillis?.() ?? 0
    return bt - at
  })
}

export async function findDirectChat(uid, targetUid) {
  const q = query(collection(db, 'chats'), where('participantIds', 'array-contains', uid), where('type', '==', 'direct'))
  const snap = await getDocs(q)
  const match = snap.docs.find((d) => (d.data().participantIds || []).includes(targetUid))
  return match ? match.id : null
}

export async function getOrCreateDirectChat(uid, targetUid) {
  const existing = await findDirectChat(uid, targetUid)
  if (existing) return existing

  const chatRef = await addDoc(collection(db, 'chats'), {
    type: 'direct',
    name: null,
    avatarUrl: null,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastMessageAt: serverTimestamp(),
    lastMessage: null,
    participantIds: [uid, targetUid],
    participants: {
      [uid]: { role: 'owner', pinned: false, archived: false, muted: false, unreadCount: 0, lastReadAt: serverTimestamp() },
      [targetUid]: { role: 'member', pinned: false, archived: false, muted: false, unreadCount: 0, lastReadAt: serverTimestamp() },
    },
  })
  return chatRef.id
}

export async function createGroup(uid, name, memberUids, avatarUrl = null) {
  const participants = {
    [uid]: { role: 'owner', pinned: false, archived: false, muted: false, unreadCount: 0, lastReadAt: serverTimestamp() },
  }
  for (const memberId of memberUids) {
    if (memberId === uid) continue
    participants[memberId] = { role: 'member', pinned: false, archived: false, muted: false, unreadCount: 0, lastReadAt: serverTimestamp() }
  }

  const chatRef = await addDoc(collection(db, 'chats'), {
    type: 'group',
    name,
    avatarUrl,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastMessageAt: serverTimestamp(),
    lastMessage: { type: 'system', content: 'Group created', senderId: uid },
    participantIds: [uid, ...memberUids.filter((id) => id !== uid)],
    participants,
  })

  await addDoc(collection(db, 'chats', chatRef.id, 'messages'), {
    senderId: uid,
    type: 'system',
    content: 'Group created',
    createdAt: serverTimestamp(),
  })

  return chatRef.id
}

export async function updateGroup(chatId, updates) {
  await updateDoc(doc(db, 'chats', chatId), { ...updates, updatedAt: serverTimestamp() })
}

export async function addMembers(chatId, uids) {
  const chatSnap = await getDoc(doc(db, 'chats', chatId))
  const chat = chatSnap.data()
  const participants = { ...chat.participants }
  const participantIds = new Set(chat.participantIds)
  for (const id of uids) {
    if (participantIds.has(id)) continue
    participantIds.add(id)
    participants[id] = { role: 'member', pinned: false, archived: false, muted: false, unreadCount: 0, lastReadAt: serverTimestamp() }
  }
  await updateDoc(doc(db, 'chats', chatId), {
    participants,
    participantIds: Array.from(participantIds),
    updatedAt: serverTimestamp(),
  })
}

export async function removeMember(chatId, targetUid) {
  const chatSnap = await getDoc(doc(db, 'chats', chatId))
  const chat = chatSnap.data()
  const participants = { ...chat.participants }
  delete participants[targetUid]
  await updateDoc(doc(db, 'chats', chatId), {
    participants,
    participantIds: chat.participantIds.filter((id) => id !== targetUid),
    updatedAt: serverTimestamp(),
  })
}

export async function setMemberRole(chatId, targetUid, role) {
  await updateDoc(doc(db, 'chats', chatId), { [`participants.${targetUid}.role`]: role, updatedAt: serverTimestamp() })
}

export async function leaveGroup(chatId, uid) {
  const chatSnap = await getDoc(doc(db, 'chats', chatId))
  const chat = chatSnap.data()
  const remainingIds = chat.participantIds.filter((id) => id !== uid)

  if (remainingIds.length === 0) {
    await deleteChatCascade(chatId)
    return
  }

  const participants = { ...chat.participants }
  const wasOwner = participants[uid]?.role === 'owner'
  delete participants[uid]

  if (wasOwner) {
    const nextOwnerId = remainingIds.find((id) => participants[id]?.role === 'admin') || remainingIds[0]
    if (nextOwnerId) participants[nextOwnerId] = { ...participants[nextOwnerId], role: 'owner' }
  }

  await updateDoc(doc(db, 'chats', chatId), { participants, participantIds: remainingIds, updatedAt: serverTimestamp() })
  await addDoc(collection(db, 'chats', chatId, 'messages'), {
    senderId: uid,
    type: 'system',
    content: 'left the group',
    createdAt: serverTimestamp(),
  })
}

export async function deleteChat(chatId) {
  await deleteChatCascade(chatId)
}

async function deleteChatCascade(chatId) {
  const messagesSnap = await getDocs(collection(db, 'chats', chatId, 'messages'))
  const batch = writeBatch(db)
  messagesSnap.docs.forEach((d) => batch.delete(d.ref))
  batch.delete(doc(db, 'chats', chatId))
  await batch.commit()
}

export async function togglePin(chatId, uid, pinned) {
  await updateDoc(doc(db, 'chats', chatId), { [`participants.${uid}.pinned`]: pinned })
}

export async function toggleArchive(chatId, uid, archived) {
  await updateDoc(doc(db, 'chats', chatId), { [`participants.${uid}.archived`]: archived })
}

export async function toggleMute(chatId, uid, muted) {
  await updateDoc(doc(db, 'chats', chatId), { [`participants.${uid}.muted`]: muted })
}

export async function markChatRead(chatId, uid) {
  await updateDoc(doc(db, 'chats', chatId), {
    [`participants.${uid}.unreadCount`]: 0,
    [`participants.${uid}.lastReadAt`]: serverTimestamp(),
  }).catch(() => {})
}

export async function createInvite(chatId) {
  const code = generateInviteCode()
  await addDoc(collection(db, 'groupInvites'), { code, chatId, uses: 0, createdAt: serverTimestamp() })
  return code
}

export async function joinViaInvite(uid, code) {
  const q = query(collection(db, 'groupInvites'), where('code', '==', code))
  const snap = await getDocs(q)
  if (snap.empty) throw new Error('Invalid invite code.')
  const inviteDoc = snap.docs[0]
  const invite = inviteDoc.data()
  await addMembers(invite.chatId, [uid])
  await updateDoc(inviteDoc.ref, { uses: (invite.uses || 0) + 1 })
  await addDoc(collection(db, 'chats', invite.chatId, 'messages'), {
    senderId: uid,
    type: 'system',
    content: 'joined via invite link',
    createdAt: serverTimestamp(),
  })
  return invite.chatId
}

export function subscribeToTyping(chatId, uid, callback) {
  return onSnapshot(collection(db, 'chats', chatId, 'typing'), (snap) => {
    const cutoff = Date.now() - 4000
    const typingIds = snap.docs
      .filter((d) => d.id !== uid && (d.data().updatedAt?.toMillis?.() ?? 0) > cutoff)
      .map((d) => d.id)
    callback(typingIds)
  })
}

export async function pingTyping(chatId, uid) {
  await setDoc(doc(db, 'chats', chatId, 'typing', uid), { updatedAt: serverTimestamp() }, { merge: true })
}
