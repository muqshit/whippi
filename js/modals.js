import { el, escapeHtml, initials, isValidUsername, toast, debounce, validateUpload, generateInviteCode } from './utils.js'
import { updateProfile, uploadAvatar, uploadRawImage } from './profile.js'
import {
  searchUsers,
  sendContactRequest,
  listContactRelations,
  listBlockedUsers,
  unblockUser,
} from './contacts.js'
import { getUserProfile } from './auth.js'
import {
  createGroup,
  updateGroup,
  addMembers,
  removeMember,
  setMemberRole,
  leaveGroup,
  deleteChat,
  createInvite,
} from './chats.js'

const root = () => document.getElementById('modal-root')

function openModal(contentNode, { wide = false } = {}) {
  closeModal()
  const modal = el('div', { className: 'modal' + (wide ? ' modal-wide' : '') }, [
    el('button', { className: 'modal-close', onClick: closeModal }, '✕'),
    contentNode,
  ])
  const overlay = el('div', { className: 'modal-overlay', onClick: (e) => e.target === overlay && closeModal() }, [modal])
  root().appendChild(overlay)
  return overlay
}

export function closeModal() {
  root().innerHTML = ''
}

// ---------------- Profile dialog ----------------
export function openProfileDialog(profile, uid, onSaved) {
  const nameInput = el('input', { type: 'text', value: profile.fullName || '' })
  const usernameInput = el('input', { type: 'text', value: profile.usernameDisplay || profile.username || '' })
  const bioInput = el('textarea', { rows: 2, maxlength: 140 }, [])
  bioInput.value = profile.statusBio || ''

  const avatarImg = el('img', { src: profile.avatarUrl || avatarFallback(profile.fullName) })
  const fileInput = el('input', { type: 'file', accept: 'image/*', className: 'hidden' })
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0]
    if (!file) return
    try {
      const url = await uploadAvatar(uid, file)
      avatarImg.src = url
      toast('Profile photo updated.', 'success')
    } catch (err) {
      toast(err.message || 'Could not upload photo.', 'error')
    }
  })
  const avatarBtn = el('button', { className: 'avatar-upload-btn', type: 'button', onClick: () => fileInput.click() }, [
    avatarImg,
    el('div', { className: 'avatar-upload-overlay' }, '📷'),
  ])

  const saveBtn = el('button', { className: 'btn btn-primary btn-block' }, 'Save changes')
  saveBtn.addEventListener('click', async () => {
    if (!isValidUsername(usernameInput.value.trim())) {
      toast('Usernames must be 3-20 characters: letters, numbers, . or _', 'error')
      return
    }
    saveBtn.disabled = true
    try {
      await updateProfile(uid, {
        fullName: nameInput.value.trim(),
        statusBio: bioInput.value.trim(),
        username: usernameInput.value.trim(),
      })
      toast('Profile saved.', 'success')
      onSaved?.()
      closeModal()
    } catch (err) {
      toast(err.message || 'Could not save profile.', 'error')
    } finally {
      saveBtn.disabled = false
    }
  })

  const content = el('div', {}, [
    el('h2', {}, 'Your profile'),
    el('p', { className: 'muted' }, 'This is how others see you on Whippi.'),
    el('div', { className: 'avatar-upload' }, [avatarBtn, fileInput]),
    el('label', {}, 'Full name'),
    nameInput,
    el('label', {}, 'Username'),
    usernameInput,
    el('label', {}, 'About'),
    bioInput,
    el('div', { className: 'modal-actions' }, [saveBtn]),
  ])
  openModal(content)
}

function avatarFallback(name) {
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#e3f5e9'
  ctx.fillRect(0, 0, 96, 96)
  ctx.fillStyle = '#16a34a'
  ctx.font = 'bold 34px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(initials(name || '?'), 48, 50)
  return canvas.toDataURL()
}

export { avatarFallback }

// ---------------- New chat dialog ----------------
export function openNewChatDialog(uid, onStartChat) {
  const input = el('input', { type: 'text', placeholder: 'Search Whippi users…', autofocus: true })
  const results = el('div', { className: 'contacts-panel', style: 'max-height:320px;overflow-y:auto;margin-top:0.75rem' })

  const runSearch = debounce(async (q) => {
    if (!q.trim()) {
      results.innerHTML = ''
      return
    }
    const users = await searchUsers(uid, q)
    results.innerHTML = ''
    if (users.length === 0) {
      results.appendChild(el('p', { className: 'muted', style: 'padding:1rem 0;text-align:center' }, `No users found for "${q}".`))
      return
    }
    for (const user of users) {
      const row = el('div', { className: 'contact-row' }, [
        el('button', {
          className: 'chat-item-body',
          style: 'display:flex;align-items:center;gap:0.75rem;text-align:left',
          onClick: () => onStartChat(user),
        }, [
          el('img', { className: 'avatar', src: user.avatarUrl || avatarFallback(user.fullName) }),
          el('div', {}, [
            el('p', { className: 'contact-row-name' }, user.fullName),
            el('p', { className: 'muted' }, `@${user.usernameDisplay || user.username}`),
          ]),
        ]),
        el('button', {
          className: 'icon-btn',
          title: 'Add contact',
          onClick: async () => {
            try {
              await sendContactRequest(uid, user.uid)
              toast(`Contact request sent to ${user.fullName}.`, 'success')
            } catch (err) {
              toast(err.message || 'Could not send request.', 'error')
            }
          },
        }, '➕'),
      ])
      results.appendChild(row)
    }
  }, 300)

  input.addEventListener('input', () => runSearch(input.value))

  const content = el('div', {}, [
    el('h2', {}, 'New chat'),
    el('p', { className: 'muted' }, 'Search by username or name.'),
    input,
    results,
  ])
  openModal(content)
  setTimeout(() => input.focus(), 30)
}

// ---------------- Create group dialog ----------------
export function openCreateGroupDialog(uid, onCreated) {
  let step = 'members'
  const selected = new Set()

  const body = el('div', {})
  const content = el('div', {}, [el('h2', {}, 'Add group members'), el('p', { className: 'muted' }, 'Select contacts, then name your group.'), body])
  const overlay = openModal(content)

  async function renderMembers() {
    body.innerHTML = ''
    const relations = await listContactRelations(uid)
    const accepted = relations.filter((r) => r.status === 'accepted')
    if (accepted.length === 0) {
      body.appendChild(el('p', { className: 'muted', style: 'padding:1.5rem 0;text-align:center' }, 'Add some contacts first, then come back to create a group.'))
    }
    for (const rel of accepted) {
      const contactId = rel.participants.find((id) => id !== uid)
      const profile = await getUserProfile(contactId)
      if (!profile) continue
      const isSelected = selected.has(contactId)
      const row = el('button', {
        style: 'display:flex;align-items:center;gap:0.75rem;width:100%;text-align:left;padding:0.5rem 0',
        onClick: () => {
          if (selected.has(contactId)) selected.delete(contactId)
          else selected.add(contactId)
          renderMembers()
        },
      }, [
        el('img', { className: 'avatar', src: profile.avatarUrl || avatarFallback(profile.fullName) }),
        el('div', { style: 'flex:1' }, [
          el('p', { style: 'font-weight:500' }, profile.fullName),
          el('p', { className: 'muted' }, `@${profile.usernameDisplay || profile.username}`),
        ]),
        el('span', { style: `width:20px;height:20px;border-radius:50%;border:2px solid ${isSelected ? 'var(--primary)' : 'var(--border)'};background:${isSelected ? 'var(--primary)' : 'transparent'};display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.7rem` }, isSelected ? '✓' : ''),
      ])
      body.appendChild(row)
    }
    const nextBtn = el('button', { className: 'btn btn-primary btn-block', disabled: selected.size === 0 }, 'Next')
    nextBtn.addEventListener('click', () => {
      step = 'details'
      renderDetails()
    })
    content.querySelector('h2').textContent = 'Add group members'
    body.appendChild(el('div', { className: 'modal-actions' }, [nextBtn]))
  }

  function renderDetails() {
    content.querySelector('h2').textContent = 'Name your group'
    body.innerHTML = ''
    const nameInput = el('input', { type: 'text', placeholder: 'Group name', maxlength: 60, autofocus: true })
    const createBtn = el('button', { className: 'btn btn-primary' }, 'Create group')
    const backBtn = el('button', { className: 'btn btn-outline' }, 'Back')
    backBtn.addEventListener('click', () => {
      step = 'members'
      renderMembers()
    })
    createBtn.addEventListener('click', async () => {
      if (!nameInput.value.trim()) {
        toast('Give your group a name.', 'error')
        return
      }
      createBtn.disabled = true
      try {
        const chatId = await createGroup(uid, nameInput.value.trim(), Array.from(selected))
        closeModal()
        onCreated(chatId)
      } catch (err) {
        toast(err.message || 'Could not create group.', 'error')
      } finally {
        createBtn.disabled = false
      }
    })
    body.appendChild(el('label', {}, 'Group name'))
    body.appendChild(nameInput)
    body.appendChild(el('div', { className: 'modal-actions' }, [backBtn, createBtn]))
  }

  renderMembers()
}

// ---------------- Settings dialog ----------------
export function openSettingsDialog({ uid, profile, currentTheme, onThemeChange, onLogout }) {
  const tabsBar = el('div', { className: 'tabs', style: 'padding:0 0 0.75rem' })
  const panels = { appearance: el('div'), privacy: el('div'), account: el('div') }
  const tabNames = { appearance: 'Appearance', privacy: 'Privacy', account: 'Account' }

  function showTab(name) {
    for (const key of Object.keys(panels)) panels[key].classList.toggle('hidden', key !== name)
    for (const btn of tabsBar.querySelectorAll('.tab')) btn.classList.toggle('active', btn.dataset.tab === name)
  }

  for (const key of Object.keys(tabNames)) {
    const btn = el('button', { className: 'tab', dataset: { tab: key }, onClick: () => showTab(key) }, tabNames[key])
    tabsBar.appendChild(btn)
  }

  // Appearance
  const themeRow = el('div', { style: 'display:flex;gap:0.5rem;margin-top:0.5rem' })
  for (const [value, label, icon] of [['light', 'Light', '☀️'], ['dark', 'Dark', '🌙'], ['system', 'System', '🖥️']]) {
    const btn = el(
      'button',
      {
        className: 'btn btn-outline',
        style: `flex:1;flex-direction:column;height:64px;${value === currentTheme ? 'border-color:var(--primary);color:var(--primary)' : ''}`,
        onClick: () => {
          onThemeChange(value)
          closeModal()
          openSettingsDialog({ uid, profile, currentTheme: value, onThemeChange, onLogout })
        },
      },
      [el('div', {}, icon), el('div', { style: 'font-size:0.75rem' }, label)]
    )
    themeRow.appendChild(btn)
  }
  panels.appearance.appendChild(el('label', {}, 'Theme'))
  panels.appearance.appendChild(themeRow)

  // Privacy - blocked users
  panels.privacy.appendChild(el('label', {}, 'Blocked users'))
  const blockedList = el('div', { style: 'margin-top:0.5rem' })
  panels.privacy.appendChild(blockedList)
  listBlockedUsers(uid).then(async (ids) => {
    if (ids.length === 0) {
      blockedList.appendChild(el('p', { className: 'muted' }, "You haven't blocked anyone."))
      return
    }
    for (const id of ids) {
      const p = await getUserProfile(id)
      if (!p) continue
      const row = el('div', { className: 'contact-row' }, [
        el('img', { className: 'avatar', src: p.avatarUrl || avatarFallback(p.fullName) }),
        el('span', { style: 'flex:1' }, p.fullName),
        el('button', {
          className: 'btn btn-outline btn-sm',
          onClick: async () => {
            await unblockUser(uid, id)
            row.remove()
            toast('User unblocked.', 'success')
          },
        }, 'Unblock'),
      ])
      blockedList.appendChild(row)
    }
  })

  // Account
  panels.account.appendChild(el('div', { style: 'border:1px solid var(--border);border-radius:10px;padding:0.9rem;margin-top:0.5rem' }, [
    el('p', { className: 'muted' }, 'Signed in as'),
    el('p', { style: 'font-weight:600' }, profile.email),
  ]))
  const logoutBtn = el('button', { className: 'btn btn-danger btn-block', style: 'margin-top:1rem' }, 'Log out')
  logoutBtn.addEventListener('click', () => {
    closeModal()
    onLogout()
  })
  panels.account.appendChild(logoutBtn)

  const content = el('div', {}, [
    el('h2', {}, 'Settings'),
    el('p', { className: 'muted' }, 'Manage how Whippi looks and behaves.'),
    tabsBar,
    panels.appearance,
    panels.privacy,
    panels.account,
  ])
  openModal(content)
  showTab('appearance')
}

// ---------------- Group info dialog ----------------
export function openGroupInfoDialog(chat, uid, onUpdated) {
  const myRole = chat.participants?.[uid]?.role
  const isOwnerOrAdmin = myRole === 'owner' || myRole === 'admin'

  const body = el('div', {})
  const content = el('div', {}, [el('h2', {}, 'Group info'), el('p', { className: 'muted' }, `${chat.participantIds?.length ?? 0} members`), body])
  openModal(content)

  async function render() {
    body.innerHTML = ''

    const avatarImg = el('img', { src: chat.avatarUrl || avatarFallback(chat.name) })
    const fileInput = el('input', { type: 'file', accept: 'image/*', className: 'hidden' })
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0]
      if (!file) return
      try {
        const url = await uploadRawImage(uid, file)
        await updateGroup(chat.id, { avatarUrl: url })
        onUpdated()
        avatarImg.src = url
      } catch {
        toast('Could not update group icon.', 'error')
      }
    })
    const avatarBtn = el('button', { className: 'avatar-upload-btn', onClick: () => isOwnerOrAdmin && fileInput.click() }, [
      avatarImg,
      isOwnerOrAdmin ? el('div', { className: 'avatar-upload-overlay' }, '📷') : null,
    ])
    body.appendChild(el('div', { className: 'avatar-upload' }, [avatarBtn, fileInput]))

    if (isOwnerOrAdmin) {
      const nameInput = el('input', { type: 'text', value: chat.name || '', maxlength: 60 })
      nameInput.addEventListener('blur', async () => {
        if (nameInput.value.trim() && nameInput.value !== chat.name) {
          await updateGroup(chat.id, { name: nameInput.value.trim() })
          onUpdated()
        }
      })
      body.appendChild(nameInput)

      const inviteBox = el('div', { style: 'border:1px solid var(--border);border-radius:10px;padding:0.75rem;margin-top:0.75rem' })
      const genBtn = el('button', { className: 'btn btn-outline btn-sm' }, 'Generate invite link')
      genBtn.addEventListener('click', async () => {
        const code = await createInvite(chat.id)
        inviteBox.innerHTML = ''
        const link = `${window.location.origin}${window.location.pathname}#invite=${code}`
        const codeEl = el('code', { style: 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.75rem;background:var(--panel-alt);padding:0.35rem 0.5rem;border-radius:6px' }, link)
        const copyBtn = el('button', {
          className: 'btn btn-outline btn-sm',
          onClick: () => {
            navigator.clipboard.writeText(link)
            toast('Invite link copied.', 'success')
          },
        }, 'Copy')
        inviteBox.appendChild(el('p', { style: 'font-weight:500;margin-bottom:0.4rem' }, 'Invite link'))
        inviteBox.appendChild(el('div', { style: 'display:flex;gap:0.4rem;align-items:center' }, [codeEl, copyBtn]))
      })
      inviteBox.appendChild(el('p', { style: 'font-weight:500;margin-bottom:0.4rem' }, 'Invite link'))
      inviteBox.appendChild(genBtn)
      body.appendChild(inviteBox)
    } else {
      body.appendChild(el('p', { style: 'text-align:center;font-weight:600;font-size:1.05rem' }, chat.name))
    }

    const membersHeader = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-top:1rem' }, [
      el('p', { style: 'font-weight:600;font-size:0.85rem' }, 'Members'),
    ])
    body.appendChild(membersHeader)

    const memberList = el('div', { style: 'max-height:220px;overflow-y:auto;margin-top:0.4rem' })
    body.appendChild(memberList)

    for (const pid of chat.participantIds || []) {
      const p = await getUserProfile(pid)
      if (!p) continue
      const role = chat.participants?.[pid]?.role
      const row = el('div', { className: 'contact-row' }, [
        el('img', { className: 'avatar', src: p.avatarUrl || avatarFallback(p.fullName), style: 'width:36px;height:36px' }),
        el('div', { style: 'flex:1' }, [
          el('p', { style: 'font-size:0.88rem;font-weight:500' }, p.fullName + (pid === uid ? ' (you)' : '')),
          role !== 'member' ? el('p', { style: 'font-size:0.72rem;color:var(--primary)' }, role) : null,
        ]),
      ])
      if (isOwnerOrAdmin && pid !== uid && myRole === 'owner') {
        const removeBtn = el('button', {
          className: 'icon-btn',
          title: 'Remove from group',
          onClick: async () => {
            await removeMember(chat.id, pid)
            onUpdated()
            row.remove()
          },
        }, '✕')
        row.appendChild(removeBtn)
        if (role === 'member') {
          const promoteBtn = el('button', {
            className: 'icon-btn',
            title: 'Make admin',
            onClick: async () => {
              await setMemberRole(chat.id, pid, 'admin')
              onUpdated()
              render()
            },
          }, '⬆')
          row.appendChild(promoteBtn)
        }
      }
      memberList.appendChild(row)
    }

    const actions = el('div', { className: 'modal-actions', style: 'justify-content:stretch;gap:0.5rem' })
    const leaveBtn = el('button', { className: 'btn btn-outline', style: 'flex:1' }, 'Leave group')
    leaveBtn.addEventListener('click', async () => {
      await leaveGroup(chat.id, uid)
      closeModal()
      onUpdated(true)
    })
    actions.appendChild(leaveBtn)
    if (myRole === 'owner') {
      const deleteBtn = el('button', { className: 'btn btn-danger', style: 'flex:1' }, 'Delete group')
      deleteBtn.addEventListener('click', async () => {
        await deleteChat(chat.id)
        closeModal()
        onUpdated(true)
      })
      actions.appendChild(deleteBtn)
    }
    body.appendChild(actions)
  }

  render()
}
