export function $(selector, root = document) {
  return root.querySelector(selector)
}

export function $all(selector, root = document) {
  return Array.from(root.querySelectorAll(selector))
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (key === 'className') node.className = value
    else if (key === 'dataset') Object.assign(node.dataset, value)
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value)
    } else if (value !== undefined && value !== null) {
      node.setAttribute(key, value)
    }
  }
  for (const child of [].concat(children)) {
    if (child == null) continue
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return node
}

export function escapeHtml(str = '') {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

export function initials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function isValidUsername(username) {
  return /^[a-zA-Z0-9_.]{3,20}$/.test(username)
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function toDate(value) {
  if (!value) return null
  if (value.toDate) return value.toDate()
  return new Date(value)
}

export function formatMessageTime(value) {
  const d = toDate(value)
  if (!d) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatChatListTime(value) {
  const d = toDate(value)
  if (!d) return ''
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'

  const weekAgo = new Date(now)
  weekAgo.setDate(now.getDate() - 7)
  if (d > weekAgo) return d.toLocaleDateString([], { weekday: 'long' })

  return d.toLocaleDateString()
}

export function formatDateSeparator(value) {
  const d = toDate(value)
  if (!d) return ''
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
}

export function formatLastSeen(value, isOnline) {
  if (isOnline) return 'online'
  const d = toDate(value)
  if (!d) return 'offline'
  const diffMs = Date.now() - d.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'last seen just now'
  if (mins < 60) return `last seen ${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `last seen ${hours}h ago`
  const days = Math.floor(hours / 24)
  return `last seen ${days}d ago`
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']
const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp4']
const ALLOWED_DOC_TYPES = [
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
]

export const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

export function classifyFile(file) {
  if (ALLOWED_IMAGE_TYPES.includes(file.type)) return 'image'
  if (ALLOWED_VIDEO_TYPES.includes(file.type)) return 'video'
  if (ALLOWED_AUDIO_TYPES.includes(file.type)) return 'audio'
  if (ALLOWED_DOC_TYPES.includes(file.type)) return 'document'
  return 'unsupported'
}

export function validateUpload(file) {
  if (file.size > MAX_FILE_SIZE) return { valid: false, error: `File exceeds ${formatFileSize(MAX_FILE_SIZE)} limit.` }
  if (classifyFile(file) === 'unsupported') return { valid: false, error: 'Unsupported file type.' }
  return { valid: true }
}

export function generateInviteCode(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

export function debounce(fn, wait = 300) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
}

export function toast(message, variant = 'info') {
  const container = $('#toast-container')
  if (!container) return
  const node = el('div', { className: `toast toast--${variant}` }, [message])
  container.appendChild(node)
  requestAnimationFrame(() => node.classList.add('toast--visible'))
  setTimeout(() => {
    node.classList.remove('toast--visible')
    setTimeout(() => node.remove(), 250)
  }, 3800)
}
