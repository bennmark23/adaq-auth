# ADAQ engineering conventions

## Stack
- Server: Node.js + Express 4 + `node:sqlite` (better-sqlite3-free), `ws`, `otplib`, `multer`, `sharp`.
- Client: static HTML/CSS/JS in `client/public` (source of truth), plus `auth.js`, `auth.css`, `sw.js`.
- Storage: SQLite + files under `ADAQ_DATA_DIR` (default `server/data`). Never inside deployed code.
- Free tier only. No paid APIs, no hosted chat/push services.

## Commands
- Start (Windows): `start.cmd` or `cd server && node server.js`
- Start (Docker): `docker build -t adaq . && docker run -v adaq-data:/data -p 4000:4000 adaq`
- Tests: `cd server && node --test tests/*.test.js`
- Icon audit: `node scripts/icon-audit.js` (Phase 2)

## Data safety rules
1. All data lives in `ADAQ_DATA_DIR`. Deployments replace code only.
2. Migrations are additive, idempotent, versioned in `schema_version`; never drop/truncate in a normal migration.
3. A backup is copied to `DATA_DIR/backups` before every migration; failure restores it and the server refuses to start.
4. Missing DB + existing backups/uploads = safety stop, never a blank database.
5. Seed only when the database is brand new AND `ADAQ_SEED=1`.
6. Clients migrate stored keys in place; they never clear localStorage/IndexedDB on version bumps.
7. Admin backup/restore endpoints are admin-only and audit logged.

## UI rules
- Plain monochrome SVG icons using `currentColor` and theme tokens; no emoji icons, no CDN icon fonts.
- 44px minimum touch targets, aria-labels on icon-only buttons, safe-area aware.
- Themes: dark / light / auto.

## Messenger rules
- Own WebSocket only; participants-only authorization on server for REST + WS.
- Users cannot message Admin or bots; Admin notices are one-way.
- Escape all message text; linkify only http/https with `noopener noreferrer`.
