# Whippi (vanilla JS + Firebase)

Same app, no framework and no build step this time — plain HTML/CSS/JavaScript (ES modules) talking directly to Firebase (Auth, Firestore, Storage). You can open `index.html` on any static host and it just works, which sidesteps the whole "did the environment variables apply on this build" class of problem the React/Vite/Supabase version could run into.

## 1. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project**.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable.**
3. **Build → Firestore Database → Create database** (start in production mode — the rules file below locks it down properly).
4. **Build → Storage → Get started** (also production mode).
5. **Project settings (gear icon) → General → Your apps → Add app → Web (`</>`)**. Register it (no need for Firebase Hosting yet), and copy the `firebaseConfig` object it gives you.

## 2. Add your config

Open `js/firebase-config.js` and paste your values in:

```js
export const firebaseConfig = {
  apiKey: '...',
  authDomain: '...',
  projectId: '...',
  storageBucket: '...',
  messagingSenderId: '...',
  appId: '...',
}
```

This file is safe to commit — a Firebase web config isn't a secret. Actual access control lives in `firestore.rules` and `storage.rules` (below), not in hiding this object.

## 3. Deploy the security rules

Install the Firebase CLI once: `npm install -g firebase-tools`, then from this folder:

```bash
firebase login
firebase use --add          # pick your project
firebase deploy --only firestore:rules,firestore:indexes,storage
```

(Or paste `firestore.rules` / `storage.rules` directly into the console's Rules tabs if you'd rather skip the CLI.) Without this step, every read/write will be denied and the app will look "broken" — this is almost always what a blank screen after login means.

## 4. Run it locally

No `npm install`, no build. ES modules need to be served over HTTP though (not opened as a `file://` URL), so use any static server:

```bash
npx serve .
# or: python3 -m http.server 8080
```

## 5. Deploy

Pick one — it's just static files:

- **Firebase Hosting** (simplest, same project as your backend): `firebase deploy --only hosting`
- **Vercel**: import the repo, no build command needed, `vercel.json` handles SPA routing
- **Netlify**: drag-and-drop the folder, or connect the repo (no build command needed)
- **Any static host** (nginx, Caddy, S3+CloudFront, GitHub Pages): upload the files as-is; if the host supports it, rewrite unknown paths to `index.html`

## What's implemented

- Email/password auth (register, login by username *or* email, logout, password reset, session persistence)
- Profiles: edit name/username/bio, avatar upload, online status, last seen
- Contacts: search (prefix match on username), send/accept/reject requests, remove, block/unblock
- Direct + group chats: create, rename, group icon, admin/owner roles, add/remove members, invite links, leave/delete
- Messaging: text, images, video, audio/documents via upload, reply, edit, delete (soft delete), emoji reactions, unread counts, typing indicators, realtime sync, in-chat search
- Sidebar: chats/groups/contacts tabs, search, pin/mute/archive per chat
- Settings: theme (light/dark/system, persisted), blocked users list, account info

## Simplified / stubbed by design

- **Voice notes**: the mic-style attach option opens a file picker for pre-recorded audio rather than doing in-browser recording (needs `MediaRecorder` + a permissions flow, best tested on a real deployed host rather than simulated here).
- **Voice/video calls**: not included — needs a signaling server + WebRTC/TURN infrastructure outside a static frontend's scope.
- **Push/browser notifications**: not wired up — would need the Notifications API + a service worker.
- **Stickers/GIFs**: images/GIFs send fine as regular image attachments; there's no dedicated sticker/GIF picker.
- **Location/contact-card messages**: not implemented as message types in this build.

## A note on security rules

Firestore and Storage rules can check *who* is reading/writing and *which document*, but they can't cheaply check *which field* changed without Cloud Functions. Concretely: any chat participant can technically call `update` on a message document (needed so anyone can add a reaction), even though the app's UI only lets the original sender edit the text content or delete it. If you need that enforced server-side too (not just client-side), add a Cloud Function trigger that validates diffs on write — flagged here rather than silently glossed over.

## Project structure

```
index.html              # single-page shell: auth screens + app screen
css/
  main.css              # layout, auth screens, app shell
  components.css        # buttons, modals, chat bubbles, list items, toasts
  themes.css             # light/dark CSS variables
js/
  firebase-config.js    # <- put your Firebase project keys here
  firebase.js           # SDK init (auth/db/storage exports)
  auth.js               # register/login/logout/reset, username<->email resolution
  profile.js            # profile edits, avatar upload
  contacts.js           # search, requests, block/unblock
  chats.js              # chat CRUD, membership, pin/mute/archive, invites, typing
  messages.js           # send/edit/delete/react, attachment upload, search
  modals.js             # profile/new-chat/create-group/settings/group-info dialogs
  app.js                # boots everything, renders sidebar + chat area, event wiring
  utils.js               # DOM helpers, formatting, validation
firestore.rules
firestore.indexes.json
storage.rules
firebase.json           # optional, for `firebase deploy`
```
