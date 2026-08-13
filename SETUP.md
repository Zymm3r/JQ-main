# Thai QR Code Queue System Setup

## Prerequisites
- Node.js (v18+)
- NPM

## Installation

### 1. Backend (Server) setup
```bash
cd server
npm install
```

### 2. Frontend (Client) setup
```bash
cd client
npm install
```

## Running the System

You need to run both the server and client terminals.

**Terminal 1 (Backend):**
```bash
cd server
node index.js
```
Server runs on `http://localhost:3000`.

**Terminal 2 (Frontend):**
```bash
cd client
npm run dev
```
Client runs on `http://localhost:5173`.

## Usage

1. **Admin Dashboard**: Open `http://localhost:5173/admin`
2. **Customer View**: 
   - Simulate a QR code scan by visiting `http://localhost:5173/queue/1` (change 1 to 1-10).
   - Or use the links on the Home page (`http://localhost:5173/`).

## LINE Integration (Optional)
To enable real LINE notifications:
1. Create a provider and channel on [LINE Developers Console](https://developers.line.biz/).
2. Get `Channel Access Token` and `Channel Secret`.
3. Create a `.env` file in `server/` folder:
   ```
   LINE_CHANNEL_ACCESS_TOKEN=your_token
   LINE_CHANNEL_SECRET=your_secret
   ```
4. Without this, notifications are logged to the backend console.

## Milestone 0 environment

Copy `server/.env.example` to `server/.env` and configure at least:

```env
MONGO_URI=mongodb://127.0.0.1:27017/shabu_queue
ADMIN_TOKEN_SECRET=replace-with-a-long-random-secret
LEGACY_ADMIN_PIN=replace-with-the-initial-admin-pin
```

`LEGACY_ADMIN_PIN` is only used to create the hashed `admin_pin_hash` setting when it does not already exist. The raw PIN is never stored in MongoDB.

Before starting the multi-tenant server against an existing database, make a database backup and run the non-destructive migration once:

```bash
cd server
npm run migrate:multi-tenant
```

The migration assigns existing queues, users, counters, and settings to `legacy-store`, copies `line_id` into `lineUserId`, preserves the old field, and replaces global unique indexes with store-scoped indexes. It does not delete application data.

## Milestone 1 membership setup

Add `PLATFORM_ADMIN_EMAIL` and `PLATFORM_ADMIN_PASSWORD` to `server/.env` to seed the first platform reviewer. Then run:

```bash
cd server
npm run migrate:membership
npm start
```

Merchant pages are available at `/register`, `/login`, `/onboarding`, and `/store/setup`. The platform review page is `/platform/admin`.

## Milestone 2 multi-tenant queue migration

After deploying the Milestone 2 code, migrate the queue domain once before accepting traffic:

```bash
cd server
npm run migrate:milestone2
```

This creates per-store queue sessions and typed store settings, backfills canonical queue fields and public tokens, and removes the obsolete `active_session` key after it has been converted. Merchant queue APIs derive `storeId` from the signed account token.

## Milestone 3 LIFF and store QR codes

Configure the public app URL and LIFF ID in the server environment:

```env
APP_BASE_URL=https://app.example.com
LINE_LIFF_ID=your-liff-id
```

Set the LIFF endpoint URL in LINE Developers to `https://app.example.com/liff`, then run the one-time migration:

```bash
cd server
npm run migrate:milestone3
```

Merchants manage printable store, branch, point, and event QR codes at `/store/qr`. Production reservations require a valid LINE access token and use the LINE profile user ID; customers do not create a separate account.

## Milestone 4 central LINE notifications

The central LINE OA uses `LINE_CHANNEL_ACCESS_TOKEN` for every store. After backing up MongoDB, create notification audit and monthly-usage indexes once:

The LINE Login/LIFF channel and Messaging API channel must belong to the same LINE provider so their user IDs match. Enable the LIFF option that prompts customers to add the central OA as a friend; LINE cannot push notifications to customers who have blocked or cannot receive messages from the OA.

```bash
cd server
npm run migrate:milestone4
```

LINE notifications are free and unlimited for every store and plan; no per-store monthly quota blocks delivery. Actual message counts are still recorded so merchants can inspect usage and recent delivery logs on `/store/package`, while platform administrators can monitor Central LINE OA usage and provider costs through `/api/platform/notifications/summary`.

The server can start without LINE credentials; in that state `/webhook` returns `503` and `/health` reports `lineWebhook: disabled`. Set both `LINE_CHANNEL_ACCESS_TOKEN` and `LINE_CHANNEL_SECRET` to enable webhook signature validation and LINE delivery. Set a persistent `ADMIN_TOKEN_SECRET` of at least 32 random characters in every deployed environment so account and admin sessions remain valid across restarts.

## Milestone 6 staff accounts and branches

Run the Milestone 6 migration after deploying the new models:

```bash
cd server
npm run migrate:milestone6
```

The migration creates one `default` branch per existing store, adds the owner as an active `StoreMember`, backfills `branchId` into queues, sessions, counters and store settings, and replaces store-only indexes with branch-scoped indexes. Merchant queue requests use the default branch unless the client sends a validated `x-branch-id` header. The header is resolved only within the token-derived `storeId`; a branch from another store is rejected.

Roles are `owner`, `manager`, `staff`, and `viewer`. Queue mutations, session reset, settings, and member management use explicit permissions. Merchants manage separate staff accounts and branches at `/store/team`.

## Milestone 7 platform control plane

Run the role/package migration before starting the new platform backend:

```bash
cd server
npm run migrate:milestone7
```

The dedicated control plane is `/platform-admin`. Platform identities use `PLATFORM_ADMIN` or `PLATFORM_SUPPORT`; store identities use `STORE_OWNER` or `STORE_STAFF` plus their `StoreMember` role. A platform identity cannot also be a store member. Support access to a store uses a reason-required, 30-minute impersonation token and creates an immutable platform audit record.

Platform Admin can view stores, queue and LINE usage, delivery errors, revenue, service model status, and audit records. Subscription and per-store notification quota controls are disabled; stores remain free and unlimited once verified and active.

## Milestone 8 production hardening pre-launch

Run the Milestone 8 migration after deploying the hardening changes:

```bash
cd server
npm run migrate:milestone8
```

This creates the public booking idempotency index, normalizes verified stores to the free active service model, clears subscription end dates and notification quota overrides, and marks notification usage as unlimited. Public LIFF reservations accept an `Idempotency-Key` header to prevent duplicate bookings on customer refresh/retry, and reservation requests are rate-limited per store/source/IP.

In non-production environments, the email verification OTP is returned to the onboarding UI and logged by the server. In production, configure `EMAIL_VERIFICATION_WEBHOOK_URL` (and its optional bearer token); production neither logs nor returns OTP values in API responses.

## Deployment healthcheck

From the repository root, use:

```bash
npm run build
npm start
```

Configure the deployment platform's healthcheck path as `/ping`. This liveness endpoint returns `200` as soon as the HTTP server is listening and does not wait for MongoDB. `/health` is a separate readiness endpoint and returns `503` until MongoDB is connected.

Set all production environment variables on the deployment platform. If the MongoDB Atlas password contains a reserved URI character such as `@`, percent-encode that character in `MONGO_URI` (for example, `@` becomes `%40`).

## Milestone 9 retail queue automation

Back up MongoDB and run the non-destructive migration once:

```bash
cd server
npm run migrate:milestone9
```

Owners and managers configure automatic calls, arrival grace time, dining time limits, and optional no-show cancellation on `/store/queues`. Staff with `queue.call` permission can schedule an individual waiting queue. Automatic seating and automatic table completion were removed because those physical events require staff confirmation.

The worker checks persisted queue deadlines every five seconds by default. Override this only when required with `QUEUE_AUTOMATION_POLL_MS` (minimum 1000 milliseconds). See `RETAIL_OPERATIONS_PLAN.md` for the reviewed milestone plan and complete time-trigger audit.

## Milestone 10 server-authoritative retail operations

After deploying Milestone 10, run the non-destructive migration once before enabling the new automation controls:

```powershell
cd server
npm run migrate:milestone10
```

This adds the persisted queue-call interval cursor, optional automatic-call hours, optional automatic completion, the dining-deadline index, and the unique LINE event index. Existing queue routes and existing notification logs are preserved.

For Railway, keep the healthcheck path set to `/ping`. Use `/health` for readiness and operations monitoring; its `automation` object reports the worker's last run, last success, next run, and latest error. Railway `SIGTERM` stops the worker, Socket.IO listener, HTTP server, and MongoDB connection gracefully. Persist `ADMIN_TOKEN_SECRET`, `MONGO_URI`, and LINE credentials as Railway variables rather than committing them.
