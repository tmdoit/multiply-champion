# Multiply Champion

Offline-first PWA for children to practice multiplication with:

- confirmed online account with unique child name
- installable app experience
- in-app numeric keypad
- host-controlled optional per-task timer
- always-on self-improvement mode
- multiple groups with per-group ranking
- game modes with best result per user and per mode
- shared leaderboard and activity feed with offline sync

The app now requires online account creation or login first. After the account is confirmed and stored on the device, the child can keep using the app offline and sync later.

## Architecture

- Frontend PWA: GitHub Pages
- Backend API: Cloudflare Workers
- Database: Cloudflare D1

GitHub Pages is static hosting, so the shared leaderboard and sync API must run elsewhere. This repo includes both pieces.

## Local development

### Frontend

```bash
npm install
npm run dev
```

For full account testing, point the frontend at the local worker:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8787 npm run dev
```

Set the API base URL before building for production:

```bash
VITE_API_BASE_URL=https://your-worker.your-subdomain.workers.dev npm run build
```

Optional host-level app config can also be set at build time:

```bash
VITE_API_BASE_URL=https://your-worker.your-subdomain.workers.dev \
VITE_TASK_COUNT=10 \
VITE_DEFAULT_MODE_CODE=to100-table10 \
VITE_TIMER_ENABLED=false \
VITE_TIMER_SECONDS_PER_TASK=20 \
npm run build
```

### Worker

```bash
cd worker
npm install
npx wrangler d1 create multiply-db
npx wrangler d1 execute multiply-db --file=schema.sql
npm run dev
```

Update `worker/wrangler.toml` with the generated `database_id`.

## Deployment

### 1. Deploy the Worker API

```bash
cd worker
npm run deploy
```

### 2. Build the PWA against the Worker URL

```bash
VITE_API_BASE_URL=https://your-worker.your-subdomain.workers.dev npm run build
```

### 3. Publish `dist/` to GitHub Pages

Use a GitHub Actions Pages workflow or another static deployment flow.

## GitHub Actions secrets

Set these in the GitHub repository before pushing `main`:

- `VITE_API_BASE_URL`: your deployed Worker URL, for example `https://multiply-api.your-subdomain.workers.dev`
- `VITE_TASK_COUNT`: optional, defaults to `10`
- `VITE_DEFAULT_MODE_CODE`: optional, defaults to `to100-table10`
- `VITE_TIMER_ENABLED`: optional, `true` or `false`, defaults to `false`
- `VITE_TIMER_SECONDS_PER_TASK`: optional, defaults to `20`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Data model

- `accounts`: unique child names with hashed PINs
- `auth_sessions`: persisted login sessions for confirmed devices
- `groups_table`: groups, including the system group `World`
- `group_memberships`: owner/admin/member membership records
- `group_invites`: expiring invitation links
- `modes`: game mode definitions such as `Do 100, Tabliczka 10`
- `best_results`: one best result per user and mode
- `progress_facts`: per confirmed account, per mode, per ordered multiplication fact such as `6x7`
- `activity_events`: feed events for each group

## Current product behavior

- Every account automatically belongs to the `World` group.
- Leaderboard is always filtered by `group + mode`.
- A user has one best result per mode, shared across all groups they belong to.
- The selected group only changes where that best result is visible socially.
- Group owners can create groups.
- Group owners and admins can create invitation links.
- Invitation links expire after a chosen number of hours.
- Invitation link opens the app, then the user logs in or registers, and then confirms the display name used in that group.
- Group feed shows social events and best-result updates.

The app works offline by storing:

- confirmed account session
- selected group
- selected mode
- progress snapshot
- pending best-result uploads
- pending progress sync uploads

When the device reconnects, pending items are sent to the Worker.

The Worker stores a hash of the child PIN rather than the raw PIN.
