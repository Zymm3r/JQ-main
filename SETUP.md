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
