import { $, $all, el, escapeHtml, initials, toast, debounce, formatChatListTime, formatMessageTime, formatDateSeparator, formatLastSeen, formatFileSize } from './utils.js'
import { onAuthChange, registerUser, loginUser, logoutUser, requestPasswordReset, getUserProfile, setOnlineStatus, currentUid } from './auth.js'
import { subscribeToChats, getOrCreateDirectChat, togglePin, toggleMute, toggleArchive, leaveGroup, deleteChat, markChatRead, subscribeToTyping, pingTyping, joinViaInvite } from './chats.js'
import { subscribeToMessages, sendTextMessage, sendAttachmentMessage, editMessage, deleteMessage, toggleReaction, searchMessagesInChat } from './messages.js'
import { listContactRelations, acceptContactRequest, rejectContactRequest, removeContact, blockUser } from './contacts.js'
import { getUserProfile as fetchProfile } from './auth.js'
import {
  openProfileDialog,
  openNewChatDialog,
  openCreateGroupDialog,
  openSettingsDialog,
  openGroupInfoDialog,
  avatarFallback,
  closeModal,
} from './modals.js'

// ---------------- Global state ----------------
const state = {
  uid: null,
  profile: null,
  chats: [],
  activeChatId: null,
  activeChat: null,
  activeTab: 'chats',
  search: '',
  messages: [],
  replyingTo: null,
  editingMessageId: null,
  unsubChats: null,
  unsubMessages: null,
  unsubTyping: null,
  typingUserIds: [],
}

const QUICK_REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🙏']
const EMOJI_LIST = '😀😁😂🤣😊😍😘😜🤔😎😢😭😡🥳😴🤯👍👎👏🙏🤝💪🙌✌️👌🤙❤️🧡💛💚💙💜🖤🤍💯🔥✨🎉'.split('')

const userCache = new Map()
async function getCachedUser(uid) {
  if (!userCache.has(uid)) {
    const p = await fetchProfile(uid)
    userCache.set(uid, p)
  }
  return userCache.get(uid)
}

// ---------------- Theme ----------------
function initTheme() {
  const saved = localStorage.getItem('whippi-theme') || 'system'
  applyTheme(saved)
}
function applyTheme(mode) {
  localStorage.setItem('whippi-theme', mode)
  const resolved = mode === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode
  document.documentElement.dataset.theme = resolved
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((localStorage.getItem('whippi-theme') || 'system') === 'system') applyTheme('system')
})

// ---------------- Auth screen wiring ----------------
function initAuthScreen() {
  const forms = { login: $('#login-form'), register: $('#register-form'), reset: $('#reset-form') }
  const title = $('#auth-title')
  const subtitle = $('#auth-subtitle')
  const switchToRegister = $('#auth-switch-to-register')
  const switchToLogin = $('#auth-switch-to-login')

  function show(name) {
    for (const key of Object.keys(forms)) forms[key].classList.toggle('hidden', key !== name)
    const copy = {
      login: ['Welcome back to Whippi', 'Sign in to keep chatting.'],
      register: ['Create your Whippi account', 'It only takes a minute.'],
      reset: ['Reset your password', 'We will email you a reset link.'],
    }[name]
    title.textContent = copy[0]
    subtitle.textContent = copy[1]
    switchToRegister.classList.toggle('hidden', name !== 'login')
    switchToLogin.classList.toggle('hidden', name === 'login')
  }

  $all('[data-show]').forEach((btn) => btn.addEventListener('click', () => show(btn.dataset.show)))
  $('#forgot-password-link').addEventListener('click', () => show('reset'))

  forms.login.addEventListener('submit', async (e) => {
    e.preventDefault()
    const identifier = $('#login-identifier').value.trim()
    const password = $('#login-password').value
    try {
      await loginUser(identifier, password)
    } catch (err) {
      toast(err.message || 'Could not sign in.', 'error')
    }
  })

  forms.register.addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      await registerUser({
        fullName: $('#register-fullname').value.trim(),
        username: $('#register-username').value.trim(),
        email: $('#register-email').value.trim(),
        password: $('#register-password').value,
      })
      toast('Account created! Welcome to Whippi.', 'success')
    } catch (err) {
      toast(err.message || 'Could not create account.', 'error')
    }
  })

  forms.reset.addEventListener('submit', async (e) => {
    e.preventDefault()
    const email = $('#reset-email').value.trim()
    try {
      await requestPasswordReset(email)
      toast(`Check ${email} for a password reset link.`, 'success')
      show('login')
    } catch (err) {
      toast(err.message || 'Could not send reset link.', 'error')
    }
  })

  show('login')
}

// ---------------- Boot ----------------
function boot() {
  initTheme()
  initAuthScreen()
  wireSidebarChrome()
  wireMessageForm()

  onAuthChange(async (user) => {
    if (user) {
      state.uid = user.uid
      state.profile = await getUserProfile(user.uid)
      $('#auth-screen').classList.add('hidden')
      $('#app-screen').classList.remove('hidden')
      applyMyAvatar()
      startChatsSubscription()
      window.addEventListener('beforeunload', () => setOnlineStatus(user.uid, false))
      maybeJoinInviteFromHash()
    } else {
      state.uid = null
      state.profile = null
      state.unsubChats?.()
      state.unsubMessages?.()
      state.unsubTyping?.()
      $('#app-screen').classList.add('hidden')
      $('#auth-screen').classList.remove('hidden')
    }
  })
}

function applyMyAvatar() {
  $('#my-avatar').src = state.profile?.avatarUrl || avatarFallback(state.profile?.fullName)
}

async function maybeJoinInviteFromHash() {
  const match = window.location.hash.match(/invite=([A-Z0-9]+)/i)
  if (!match) return
  try {
    const chatId = await joinViaInvite(state.uid, match[1])
    history.replaceState(null, '', window.location.pathname)
    selectChatById(chatId)
  } catch (err) {
    toast(err.message || 'Could not join via invite.', 'error')
  }
}

// ---------------- Sidebar chrome (header, tabs, search, dropdowns) ----------------
function wireSidebarChrome() {
  $('#open-profile-btn').addEventListener('click', () => openProfileDialog(state.profile, state.uid, refreshMyProfile))

  const menuBtn = $('#menu-btn')
  const menuDropdown = $('#menu-dropdown')
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    menuDropdown.classList.toggle('hidden')
  })
  document.addEventListener('click', () => menuDropdown.classList.add('hidden'))
  menuDropdown.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action
    if (action === 'profile') openProfileDialog(state.profile, state.uid, refreshMyProfile)
    if (action === 'settings') openSettings()
    if (action === 'logout') handleLogout()
  })

  $('#new-chat-btn').addEventListener('click', () => {
    openNewChatDialog(state.uid, async (targetUser) => {
      const chatId = await getOrCreateDirectChat(state.uid, targetUser.uid)
      closeModal()
      selectChatById(chatId)
    })
  })

  $('#new-group-btn').addEventListener('click', () => {
    openCreateGroupDialog(state.uid, (chatId) => selectChatById(chatId))
  })

  $all('.tab').forEach((tab) =>
    tab.addEventListener('click', () => {
      $all('.tab').forEach((t) => t.classList.remove('active'))
      tab.classList.add('active')
      state.activeTab = tab.dataset.tab
      $('#contacts-panel').classList.toggle('hidden', state.activeTab !== 'contacts')
      $('#chat-list').classList.toggle('hidden', state.activeTab === 'contacts')
      if (state.activeTab === 'contacts') renderContactsPanel()
      else renderChatList()
    })
  )

  $('#chat-search').addEventListener('input', (e) => {
    state.search = e.target.value
    renderChatList()
  })

  $('#back-btn').addEventListener('click', () => {
    $('#app-screen').classList.remove('show-chat')
    state.activeChatId = null
  })

  function openSettings() {
    openSettingsDialog({
      uid: state.uid,
      profile: state.profile,
      currentTheme: localStorage.getItem('whippi-theme') || 'system',
      onThemeChange: applyTheme,
      onLogout: handleLogout,
    })
  }
}

async function refreshMyProfile() {
  state.profile = await getUserProfile(state.uid)
  applyMyAvatar()
}

async function handleLogout() {
  await logoutUser()
}

// ---------------- Chats subscription + sidebar list ----------------
function startChatsSubscription() {
  state.unsubChats?.()
  state.unsubChats = subscribeToChats(state.uid, (chats) => {
    state.chats = chats
    if (state.activeChatId) {
      state.activeChat = chats.find((c) => c.id === state.activeChatId) || state.activeChat
      if (state.activeChat) renderChatHeader(state.activeChat)
    }
    if (state.activeTab === 'contacts') renderContactsPanel()
    else renderChatList()
  })
}

function visibleChats() {
  let list = state.chats.filter((c) => !c.participants?.[state.uid]?.archived)
  if (state.activeTab === 'groups') list = list.filter((c) => c.type === 'group')
  if (state.search.trim()) {
    const q = state.search.trim().toLowerCase()
    list = list.filter((c) => {
      const name = c.type === 'direct' ? c.peer?.fullName : c.name
      return (name || '').toLowerCase().includes(q)
    })
  }
  return list
}

function renderChatList() {
  const container = $('#chat-list')
  container.innerHTML = ''
  const list = visibleChats()

  if (list.length === 0) {
    container.appendChild(
      el('div', { style: 'padding:3rem 1.5rem;text-align:center' }, [
        el('div', { style: 'font-size:2rem;margin-bottom:0.5rem' }, '💬'),
        el('p', { className: 'muted' }, 'No conversations yet. Start one with the message icon above.'),
      ])
    )
    return
  }

  for (const chat of list) {
    container.appendChild(renderChatListItem(chat))
  }
}

function renderChatListItem(chat) {
  const isDirect = chat.type === 'direct'
  const name = isDirect ? chat.peer?.fullName || 'Unknown user' : chat.name || 'Group'
  const avatarUrl = isDirect ? chat.peer?.avatarUrl : chat.avatarUrl
  const isOnline = isDirect ? chat.peer?.isOnline : null
  const participant = chat.participants?.[state.uid] || {}
  const unread = participant.unreadCount || 0

  const preview = getChatPreview(chat)

  const item = el(
    'button',
    {
      className: 'chat-item' + (chat.id === state.activeChatId ? ' active' : ''),
      onClick: () => selectChatById(chat.id),
    },
    [
      el('div', { className: 'avatar-wrap' }, [
        el('img', { className: 'avatar', src: avatarUrl || avatarFallback(name) }),
        isDirect ? el('span', { className: 'online-dot' + (isOnline ? '' : ' offline') }) : null,
      ]),
      el('div', { className: 'chat-item-body' }, [
        el('div', { className: 'chat-item-row' }, [
          el('span', { className: 'chat-item-name' }, name),
          el('span', { className: 'chat-item-time' }, formatChatListTime(chat.lastMessageAt)),
        ]),
        el('div', { className: 'chat-item-preview' }, [
          el('span', { className: 'chat-item-preview-text' }, preview),
          unread > 0 ? el('span', { className: 'unread-badge' }, unread > 99 ? '99+' : String(unread)) : null,
        ]),
      ]),
    ]
  )
  return item
}

function getChatPreview(chat) {
  const lm = chat.lastMessage
  if (!lm) return chat.type === 'group' ? 'Group created' : 'Say hi 👋'
  const icons = { image: '📷 Photo', video: '🎥 Video', audio: '🎵 Audio', document: '📄 Document' }
  if (icons[lm.type]) return icons[lm.type]
  if (lm.type === 'system') return lm.content || ''
  return lm.content || ''
}

// ---------------- Contacts panel ----------------
async function renderContactsPanel() {
  const container = $('#contacts-panel')
  container.innerHTML = ''
  const relations = await listContactRelations(state.uid)
  const accepted = relations.filter((r) => r.status === 'accepted')
  const pending = relations.filter((r) => r.status === 'pending' && r.requestedBy !== state.uid)

  if (pending.length > 0) {
    const section = el('div', { className: 'contact-section' }, [el('p', { className: 'contact-section-title' }, 'Requests')])
    for (const rel of pending) {
      const requesterId = rel.participants.find((id) => id !== state.uid)
      const profile = await fetchProfile(requesterId)
      if (!profile) continue
      section.appendChild(
        el('div', { className: 'contact-row' }, [
          el('img', { className: 'avatar', src: profile.avatarUrl || avatarFallback(profile.fullName) }),
          el('div', { className: 'contact-row-body' }, [
            el('p', { className: 'contact-row-name' }, profile.fullName),
            el('p', { className: 'muted' }, `@${profile.usernameDisplay || profile.username}`),
          ]),
          el('button', {
            className: 'icon-btn',
            onClick: async () => {
              await acceptContactRequest(state.uid, requesterId)
              toast('Contact request accepted.', 'success')
              renderContactsPanel()
            },
          }, '✔️'),
          el('button', {
            className: 'icon-btn',
            onClick: async () => {
              await rejectContactRequest(state.uid, requesterId)
              renderContactsPanel()
            },
          }, '✕'),
        ])
      )
    }
    container.appendChild(section)
  }

  const listSection = el('div', { className: 'contact-section' }, [
    el('p', { className: 'contact-section-title' }, `Contacts (${accepted.length})`),
  ])
  if (accepted.length === 0) {
    listSection.appendChild(el('p', { className: 'muted', style: 'padding:1rem 0;text-align:center' }, 'No contacts yet. Use "New chat" to search and add people.'))
  }
  for (const rel of accepted) {
    const contactId = rel.participants.find((id) => id !== state.uid)
    const profile = await fetchProfile(contactId)
    if (!profile) continue
    const row = el('div', { className: 'contact-row' }, [
      el('button', {
        style: 'display:flex;align-items:center;gap:0.75rem;flex:1;text-align:left',
        onClick: async () => {
          const chatId = await getOrCreateDirectChat(state.uid, contactId)
          selectChatById(chatId)
        },
      }, [
        el('img', { className: 'avatar', src: profile.avatarUrl || avatarFallback(profile.fullName) }),
        el('div', { className: 'contact-row-body' }, [
          el('p', { className: 'contact-row-name' }, profile.fullName),
          el('p', { className: 'muted' }, profile.statusBio || ''),
        ]),
      ]),
      el('div', { className: 'dropdown' }, [
        (() => {
          const btn = el('button', { className: 'icon-btn' }, '⋮')
          const dd = el('div', { className: 'dropdown-menu hidden' }, [
            el('button', {
              onClick: async () => {
                await removeContact(state.uid, contactId)
                renderContactsPanel()
              },
            }, 'Remove contact'),
            el('button', {
              className: 'danger',
              onClick: async () => {
                await blockUser(state.uid, contactId)
                toast('User blocked.', 'success')
                renderContactsPanel()
              },
            }, 'Block user'),
          ])
          btn.addEventListener('click', (e) => {
            e.stopPropagation()
            $all('.dropdown-menu').forEach((m) => m !== dd && m.classList.add('hidden'))
            dd.classList.toggle('hidden')
          })
          const wrap = el('div', {}, [btn, dd])
          return wrap
        })(),
      ]),
    ])
    listSection.appendChild(row)
  }
  container.appendChild(listSection)
}

// ---------------- Selecting a chat ----------------
async function selectChatById(chatId) {
  state.activeChatId = chatId
  state.activeChat = state.chats.find((c) => c.id === chatId) || state.activeChat
  state.replyingTo = null
  state.editingMessageId = null

  $('#empty-state').classList.add('hidden')
  $('#active-chat').classList.remove('hidden')
  $('#app-screen').classList.add('show-chat')
  $('#chat-search-bar').classList.add('hidden')

  if (state.activeChat) renderChatHeader(state.activeChat)
  renderChatList()

  state.unsubMessages?.()
  state.unsubTyping?.()
  $('#message-list').innerHTML = '<div class="spinner"></div>'

  state.unsubMessages = subscribeToMessages(chatId, async (messages) => {
    const uniqueSenderIds = Array.from(new Set(messages.map((m) => m.senderId)))
    await Promise.all(uniqueSenderIds.map(getCachedUser))
    for (const m of messages) {
      m.senderName = userCache.get(m.senderId)?.fullName || 'Someone'
    }
    state.messages = messages
    renderMessages()
    markChatRead(chatId, state.uid)
  })
  state.unsubTyping = subscribeToTyping(chatId, state.uid, (ids) => {
    state.typingUserIds = ids
    if (state.activeChat) renderChatHeader(state.activeChat)
  })
}

function renderChatHeader(chat) {
  const isDirect = chat.type === 'direct'
  const name = isDirect ? chat.peer?.fullName || 'Unknown user' : chat.name || 'Group'
  const avatarUrl = isDirect ? chat.peer?.avatarUrl : chat.avatarUrl
  $('#chat-avatar').src = avatarUrl || avatarFallback(name)
  $('#chat-title').textContent = name

  const subtitleEl = $('#chat-subtitle')
  if (state.typingUserIds.length > 0) {
    subtitleEl.innerHTML = ''
    subtitleEl.style.color = 'var(--primary)'
    subtitleEl.appendChild(document.createTextNode(state.typingUserIds.length === 1 ? 'typing' : 'several people typing'))
    const dots = el('span', { className: 'typing-indicator' }, [el('span'), el('span'), el('span')])
    subtitleEl.appendChild(dots)
  } else {
    subtitleEl.style.color = ''
    subtitleEl.textContent = isDirect
      ? formatLastSeen(chat.peer?.lastSeen, !!chat.peer?.isOnline)
      : `${chat.participantIds?.length ?? 0} members`
  }

  $('#chat-header-info').onclick = () => {
    if (chat.type === 'group') openGroupInfoDialog(chat, state.uid, (leftOrDeleted) => {
      if (leftOrDeleted) backToList()
    })
  }
}

function backToList() {
  $('#app-screen').classList.remove('show-chat')
  state.activeChatId = null
  state.activeChat = null
}

// ---------------- Chat menu (pin/mute/archive/leave/delete) ----------------
$('#chat-menu-btn').addEventListener('click', (e) => {
  e.stopPropagation()
  $('#chat-menu-dropdown').classList.toggle('hidden')
})
document.addEventListener('click', () => $('#chat-menu-dropdown')?.classList.add('hidden'))
$('#chat-menu-dropdown').addEventListener('click', async (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action
  if (!action || !state.activeChat) return
  const chat = state.activeChat
  const participant = chat.participants?.[state.uid] || {}
  try {
    if (action === 'pin') await togglePin(chat.id, state.uid, !participant.pinned)
    if (action === 'mute') await toggleMute(chat.id, state.uid, !participant.muted)
    if (action === 'archive') {
      await toggleArchive(chat.id, state.uid, !participant.archived)
      backToList()
    }
    if (action === 'leave-delete') {
      if (chat.type === 'group') await leaveGroup(chat.id, state.uid)
      else await deleteChat(chat.id)
      backToList()
    }
  } catch (err) {
    toast(err.message || 'Action failed.', 'error')
  }
})

$('#chat-search-btn').addEventListener('click', () => {
  $('#chat-search-bar').classList.toggle('hidden')
  $('#chat-search-input').focus()
})
$('#chat-search-input').addEventListener(
  'input',
  debounce(async (e) => {
    const q = e.target.value.trim()
    const resultsEl = $('#chat-search-results')
    resultsEl.innerHTML = ''
    if (!q || !state.activeChatId) return
    const results = await searchMessagesInChat(state.activeChatId, q)
    if (results.length === 0) {
      resultsEl.appendChild(el('p', { className: 'muted' }, 'No matches.'))
      return
    }
    for (const m of results) {
      resultsEl.appendChild(el('div', { className: 'result-row' }, [`${m.content}`]))
    }
  }, 300)
)

// ---------------- Messages rendering ----------------
function renderMessages() {
  const container = $('#message-list')
  const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200
  container.innerHTML = ''

  let lastDate = ''
  let lastSenderId = ''

  for (const message of state.messages) {
    const dateLabel = formatDateSeparator(message.createdAt)
    if (dateLabel !== lastDate) {
      container.appendChild(el('div', { className: 'date-sep' }, [el('span', {}, dateLabel)]))
      lastDate = dateLabel
      lastSenderId = ''
    }

    const isOwn = message.senderId === state.uid
    const showSender = state.activeChat?.type === 'group' && !isOwn && message.senderId !== lastSenderId
    lastSenderId = message.senderId

    container.appendChild(renderMessageRow(message, isOwn, showSender))
  }

  if (wasNearBottom || state.messages.length < 30) {
    container.scrollTop = container.scrollHeight
  }
}

function renderMessageRow(message, isOwn, showSender) {
  if (message.type === 'system') {
    return el('div', { className: 'bubble-system' }, [el('span', {}, message.content)])
  }

  const row = el('div', { className: 'msg-row' + (isOwn ? ' own' : '') })

  if (message.deletedAt) {
    row.appendChild(el('div', { className: 'bubble bubble-deleted' }, 'This message was deleted'))
    return row
  }

  const bubble = el('div', { className: 'bubble' })

  if (showSender && message.senderName) {
    bubble.appendChild(el('p', { className: 'bubble-sender' }, message.senderName))
  }

  if (message.replyTo) {
    bubble.appendChild(
      el('div', { className: 'bubble-reply' }, [
        el('p', { className: 'bubble-reply-sender' }, message.replyTo.senderName || 'Message'),
        el('p', { className: 'muted' }, message.replyTo.content || ''),
      ])
    )
  }

  if (message.attachment) {
    bubble.appendChild(renderAttachment(message.attachment, message.type))
  }

  if (message.content) {
    const p = el('p', { className: 'bubble-text' }, message.content)
    if (message.editedAt) p.appendChild(el('span', { style: 'font-size:0.65rem;color:var(--muted-fg);margin-left:0.3rem' }, '(edited)'))
    bubble.appendChild(p)
  }

  const meta = el('div', { className: 'bubble-meta' }, [formatMessageTime(message.createdAt)])
  if (isOwn) meta.appendChild(el('span', {}, '✓'))
  bubble.appendChild(meta)

  const reactions = message.reactions || {}
  const grouped = groupReactions(reactions)
  if (grouped.length > 0) {
    bubble.appendChild(
      el('div', { className: 'bubble-reactions' }, grouped.map((r) => el('span', {}, `${r.emoji}${r.count > 1 ? r.count : ''}`)))
    )
  }

  const actions = el('div', { className: 'msg-actions' })
  const reactBtn = el('button', { title: 'React' }, '🙂')
  reactBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    showReactionPicker(reactBtn, message)
  })
  actions.appendChild(reactBtn)

  const replyBtn = el('button', { title: 'Reply' }, '↩')
  replyBtn.addEventListener('click', () => setReplyTarget(message))
  actions.appendChild(replyBtn)

  if (isOwn) {
    if (message.type === 'text') {
      const editBtn = el('button', { title: 'Edit' }, '✏️')
      editBtn.addEventListener('click', () => startEditMessage(message))
      actions.appendChild(editBtn)
    }
    const deleteBtn = el('button', { title: 'Delete' }, '🗑')
    deleteBtn.addEventListener('click', async () => {
      await deleteMessage(state.activeChatId, message.id)
    })
    actions.appendChild(deleteBtn)
  }

  const wrap = el('div', { className: 'bubble-wrap' }, [bubble, actions])
  row.appendChild(wrap)
  return row
}

function groupReactions(reactionsMap) {
  const counts = new Map()
  for (const emoji of Object.values(reactionsMap)) counts.set(emoji, (counts.get(emoji) || 0) + 1)
  return Array.from(counts.entries()).map(([emoji, count]) => ({ emoji, count }))
}

function renderAttachment(attachment, type) {
  if (type === 'image') {
    return el('a', { href: attachment.url, target: '_blank' }, [el('img', { className: 'attachment-image', src: attachment.url, alt: attachment.name })])
  }
  if (type === 'video') {
    const video = el('video', { className: 'attachment-video', controls: true })
    video.src = attachment.url
    return video
  }
  if (type === 'audio') {
    const audio = el('audio', { className: 'attachment-audio', controls: true })
    audio.src = attachment.url
    return audio
  }
  return el('a', { className: 'attachment-doc', href: attachment.url, target: '_blank' }, [
    el('span', { style: 'font-size:1.4rem' }, '📄'),
    el('div', {}, [
      el('p', { className: 'attachment-doc-name' }, attachment.name),
      el('p', { className: 'attachment-doc-size' }, formatFileSize(attachment.size || 0)),
    ]),
  ])
}

function showReactionPicker(anchorBtn, message) {
  $all('.reaction-picker').forEach((n) => n.remove())
  const picker = el(
    'div',
    { className: 'reaction-picker' },
    QUICK_REACTIONS.map((emoji) =>
      el('button', {
        onClick: async (e) => {
          e.stopPropagation()
          await toggleReaction(state.activeChatId, message.id, state.uid, emoji)
          picker.remove()
        },
      }, emoji)
    )
  )
  anchorBtn.parentElement.style.position = 'relative'
  anchorBtn.parentElement.appendChild(picker)
  setTimeout(() => document.addEventListener('click', () => picker.remove(), { once: true }), 0)
}

function setReplyTarget(message) {
  const senderName = message.senderId === state.uid ? 'You' : message.senderName || 'Someone'
  state.replyingTo = { id: message.id, content: message.content || '[attachment]', senderName }
  state.editingMessageId = null
  renderReplyPreview()
}

function startEditMessage(message) {
  state.editingMessageId = message.id
  state.replyingTo = null
  $('#message-text').value = message.content || ''
  $('#message-text').focus()
  renderReplyPreview(true)
}

function renderReplyPreview(isEditing = false) {
  const bar = $('#reply-preview')
  if (!state.replyingTo && !isEditing) {
    bar.classList.add('hidden')
    return
  }
  bar.classList.remove('hidden')
  $('#reply-preview-label').textContent = isEditing ? 'Editing message' : `Replying to ${state.replyingTo.senderName}`
  $('#reply-preview-content').textContent = isEditing ? $('#message-text').value : state.replyingTo.content
}

// ---------------- Message input wiring ----------------
function wireMessageForm() {
  const form = $('#message-form')
  const textarea = $('#message-text')
  const fileInput = $('#file-input')

  $('#reply-cancel-btn').addEventListener('click', () => {
    state.replyingTo = null
    state.editingMessageId = null
    textarea.value = ''
    renderReplyPreview()
  })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const text = textarea.value.trim()
    if (!text || !state.activeChatId) return

    if (state.editingMessageId) {
      await editMessage(state.activeChatId, state.editingMessageId, text)
      state.editingMessageId = null
    } else {
      await sendTextMessage(state.activeChatId, state.uid, text, state.replyingTo)
      state.replyingTo = null
    }
    textarea.value = ''
    renderReplyPreview()
  })

  textarea.addEventListener('input', () => {
    if (state.activeChatId) pingTyping(state.activeChatId, state.uid)
  })
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      form.requestSubmit()
    }
  })

  // Emoji picker
  const emojiBtn = $('#emoji-btn')
  const emojiPicker = $('#emoji-picker')
  emojiPicker.innerHTML = ''
  for (const emoji of EMOJI_LIST) {
    emojiPicker.appendChild(el('button', { type: 'button', onClick: () => { textarea.value += emoji; textarea.focus() } }, emoji))
  }
  emojiBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    emojiPicker.classList.toggle('hidden')
  })
  document.addEventListener('click', () => emojiPicker.classList.add('hidden'))

  // Attach dropdown
  const attachBtn = $('#attach-btn')
  const attachDropdown = $('#attach-dropdown')
  attachBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    attachDropdown.classList.toggle('hidden')
  })
  document.addEventListener('click', () => attachDropdown.classList.add('hidden'))
  attachDropdown.addEventListener('click', (e) => {
    const accept = e.target.closest('[data-accept]')?.dataset.accept
    if (!accept) return
    fileInput.accept = accept
    fileInput.click()
    attachDropdown.classList.add('hidden')
  })

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0]
    fileInput.value = ''
    if (!file || !state.activeChatId) return

    const progressWrap = $('#upload-progress')
    const progressBar = $('#upload-progress-bar')
    progressWrap.classList.remove('hidden')

    try {
      await sendAttachmentMessage(state.activeChatId, state.uid, file, {
        replyTo: state.replyingTo,
        onProgress: (pct) => { progressBar.style.width = `${pct}%` },
      })
      state.replyingTo = null
      renderReplyPreview()
    } catch (err) {
      toast(err.message || 'Upload failed.', 'error')
    } finally {
      setTimeout(() => {
        progressWrap.classList.add('hidden')
        progressBar.style.width = '0%'
      }, 400)
    }
  })
}

boot()
