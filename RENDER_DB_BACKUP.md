# Keeping ADAQ accounts across Render deploys

Render's free web services have an **ephemeral disk**. The SQLite database
(`server/data/adaq.db`) is recreated on every deploy, so accounts would reset.
The server now backs up and restores this database automatically using a
**free GitHub repository** as storage.

## One-time setup

1. Create a **private GitHub repository**, e.g. `adaq-auth-data`.
   Add a `README.md` and commit it so the `main` branch exists.
2. Create a **Personal Access Token** with write access to that repository:
   - GitHub → Settings → Developer settings → Personal access tokens
   - Classic token: tick `repo` (full control of private repositories), or
     fine-grained token: grant **Contents: read & write** on `adaq-auth-data`.
3. In Render → your service → **Environment**, add:

| Variable | Value |
|---|---|
| `GH_BACKUP_TOKEN` | the token from step 2 |
| `GH_BACKUP_REPO` | `your-username/adaq-auth-data` |
| `GH_BACKUP_PATH` | `adaq.db` (optional, default `adaq.db`) |
| `GH_BACKUP_BRANCH` | `main` (optional, default `main`) |

4. **Manual Deploy**. The server will:
   - on boot, download `adaq.db` from GitHub and restore it **before** opening the database;
   - if no backup exists yet, use the local DB and upload it after 5 seconds;
   - upload a fresh snapshot every 60 seconds.

## Notes

- Never put the token in client code — it is server-side environment only.
- With no env vars configured (local development), backup/restore is simply skipped.
- Worst-case data loss after an abrupt crash is about 60 seconds.
- Uploaded profile pictures under `server/data/uploads` are still ephemeral.
  If you want those preserved too, say so and I'll include them in the GitHub backup.
