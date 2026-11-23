# ADAQ Auth Server (accounts, TOTP, admin, messaging)

Full-stack account system for ADAQ: Google-Authenticator (TOTP) login, admin/sub-admin/user roles, invitations, profiles, theming, journal, announcements, messaging, activity tracking.

## Run locally
1. Install Node.js 18+.
2. Double-click `start.cmd` (or `cd server && npm install && node server.js`).
3. Open http://localhost:4000

## First login (admin)
- Username: `admin`
- Password: `123456`
- You will be forced to change the password, then scan the QR with Google Authenticator.

## Create accounts for friends
- Admin (or sub-admin) opens the shield button -> Invite tab -> choose role -> Generate Invitation Link.
- Send the link. The friend opens it, registers username/password, then enrolls their authenticator.
- Sub-admin accounts can only be created via web (admin generates a sub-admin invite link).

## Deploy to a public URL (so friends can reach it from anywhere)
Deploy the whole `adaq-auth` folder to any Node host (Render, Railway, Fly.io, VPS). Set env var `JWT_SECRET` to a long random string. The server serves the ADAQ client at `/`.

## Notes
- Admin can only use the desktop app / browser (not the APK, per your spec). Sub-admins are web-only.
- Users can use APK, desktop, or browser; all sync through this server (use the same account).
- Themes: Dark, Light, Blue, Yellow, Brown (profile -> theme).
- Announcements appear as a banner below the header for all users/sub-admins.
- Messaging: admin/sub-admin can message users; users see "You cannot reply on this".
- All data is stored in `server/data/adaq.db` (SQLite) and `server/data/uploads/`.

## Files
- `server/` - Node backend (Express + SQLite + WebSocket + TOTP)
- `client/public/` - ADAQ web client with auth UI
- `start.cmd` - local launcher