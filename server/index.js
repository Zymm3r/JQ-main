require('./loadEnv');
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const Queue = require('./models/Queue');
const Setting = require('./models/Setting');
const Counter = require('./models/Counter');
const Store = require('./models/Store');
const StoreSetting = require('./models/StoreSetting');
const { getActiveSession, resetSession } = require('./services/queueSessionService');
const { initDb } = require('./database');
const { DEFAULT_STORE_ID, normalizeStoreId } = require('./config');
const { getSetting, setSetting } = require('./services/settingsService');
const { loginAdmin, requireAdmin } = require('./services/adminAuth');
const { verifyAccountToken } = require('./services/accountAuth');
const authRoutes = require('./routes/authRoutes');
const merchantRoutes = require('./routes/merchantRoutes');
const platformRoutes = require('./routes/platformRoutes');
const createPublicQueueRoutes = require('./routes/publicQueueRoutes');
const createStoreQueueRoutes = require('./routes/storeQueueRoutes');
const qrRoutes = require('./routes/qrRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const teamRoutes = require('./routes/teamRoutes');
const { refreshSubscriptionState } = require('./services/subscriptionService');

const { client: lineClient } = require('./lineService');
const NotificationService = require('./services/notificationService');
const line = require('@line/bot-sdk');

const app = express();
const server = http.createServer(app);
let databaseReady = mongoose.connection.readyState === 1;
let databaseConnectionPromise = null;
let automationStarted = false;
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all for dev
        methods: ["GET", "POST"]
    }
});

app.use(cors());

// Liveness must not depend on an external database. Deployment platforms use
// this endpoint to confirm that the Node process has opened its HTTP port.
app.get('/ping', (req, res) => {
    res.status(200).send('Server is awake');
});

// Readiness is intentionally separate so operators can detect database issues
// without causing the deployment healthcheck itself to time out.
app.get('/health', (req, res) => {
    res.status(databaseReady ? 200 : 503).json({
        status: databaseReady ? 'ready' : 'starting',
        database: databaseReady ? 'connected' : 'disconnected',
        lineWebhook: lineWebhookEnabled ? 'enabled' : 'disabled'
    });
});

// --- LINE Webhook Config ---
const lineConfig = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const lineWebhookEnabled = Boolean(lineConfig.channelAccessToken && lineConfig.channelSecret);

// Webhook Route
if (lineWebhookEnabled) {
    app.post('/webhook', line.middleware(lineConfig), (req, res) => {
        Promise.all(req.body.events.map(handleEvent))
            .then((result) => res.json(result))
            .catch((err) => {
                console.error(err);
                res.status(500).end();
            });
    });
} else {
    console.warn('LINE webhook is disabled; set LINE_CHANNEL_ACCESS_TOKEN and LINE_CHANNEL_SECRET to enable it.');
    app.post('/webhook', (req, res) => res.status(503).json({ error: 'LINE webhook is not configured' }));
}

// Event Handler
function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return Promise.resolve(null);
    }
    if (!lineClient) return Promise.reject(new Error('LINE client is not configured'));

    // Reply with User ID
    const userId = event.source.userId;
    const replyText = `สวัสดีครับ! นี่คือ ID ของคุณ:\n\n${userId}\n\n(กดคัดลอก แล้วนำไปใส่ในช่องจองคิวได้เลยครับ)`;

    return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: replyText
    });
}

// --- Body Parser for other routes ---
app.use(express.json());

// Legacy URLs are permanently scoped to the legacy store. Multi-tenant public
// access resolves the store from its slug, never from a caller-controlled ID.
app.use('/api', (req, res, next) => {
    try {
        req.storeId = normalizeStoreId(DEFAULT_STORE_ID);
        next();
    } catch (error) {
        res.status(error.statusCode || 400).json({ error: 'Invalid store ID' });
    }
});

// Avoid Mongoose buffering requests indefinitely while Atlas is unavailable.
// A cold serverless invocation may wait briefly for the shared connection.
app.use('/api', async (req, res, next) => {
    try {
        await ensureDatabase();
        next();
    } catch (error) {
        res.status(503).json({ error: 'Database is temporarily unavailable' });
    }
});

app.use('/api/auth', authRoutes);
app.use('/api/merchant', merchantRoutes);
app.use('/api/platform', platformRoutes);
app.use('/api/store', qrRoutes);
app.use('/api/store', teamRoutes);
app.use('/api/store', notificationRoutes);
app.use('/api/public/stores/:storeSlug', createPublicQueueRoutes(broadcastUpdate));
app.use('/api/store', createStoreQueueRoutes(broadcastUpdate));

async function requireActivePublicStore(req, res, next) {
    try {
        const store = await refreshSubscriptionState(await Store.findOne({ storeId: req.storeId }));
        if (!store || store.verificationStatus !== 'verified' || !store.isActive) {
            return res.status(403).json({ error: 'Store queue is not active' });
        }
        req.publicStore = store.toObject();
        next();
    } catch (error) {
        res.status(500).json({ error: 'Unable to validate store' });
    }
}

// Helper: Get current Session ID
async function getCurrentSessionId(storeId) {
    return (await getActiveSession(storeId)).sessionId;
}

// Helper: Broadcast update
async function getQueuesData(storeId) {
    const sessionId = await getCurrentSessionId(storeId);
    const queues = await Queue.find({ storeId, branchId: 'default', sessionId, status: { $in: ['waiting', 'called', 'dining'] } }).sort({ queueNumber: 1 }).lean();
    queues.forEach(queue => {
        queue.id = queue.queueNumber;
    });

    const avgTime = Number.parseFloat(await getSetting(storeId, 'avg_time', '30')) || 30;
    const tableCount = Math.max(1, Number.parseInt(await getSetting(storeId, 'table_count', '10'), 10) || 10);
    const timePerTable = avgTime / tableCount;
    let waitingCount = 0;
    return queues.map(queue => {
        if (queue.status !== 'waiting') return { ...queue, estimatedWaitTime: 0 };
        const estimatedWaitTime = Math.ceil((waitingCount + 1) * timePerTable);
        waitingCount += 1;
        return { ...queue, estimatedWaitTime };
    });
}

async function broadcastUpdate(storeId = DEFAULT_STORE_ID) {
    // Return only active queues (waiting, called, dining)
    try {
        io.to(`store:${storeId}`).emit('queue_updated', await getQueuesData(storeId));
    } catch (e) {
        if (e.message === 'NO_ACTIVE_SESSION') {
            io.to(`store:${storeId}`).emit('queue_updated', []);
        } else {
            console.error('Broadcast update error:', e);
        }
    }
}

// --- API Routes ---

app.get('/api/store', requireActivePublicStore, async (req, res) => {
    res.json({ storeId: req.storeId, name: req.publicStore.name || await getSetting(req.storeId, 'store_name', 'Store') });
});

// Get active queues
app.get('/api/queues', requireActivePublicStore, async (req, res) => {
    try {
        res.json(await getQueuesData(req.storeId));
    } catch (e) {
        res.json([]);
    }
});

// Get single queue status
app.get('/api/queues/:id', requireActivePublicStore, async (req, res) => {
    try {
        const numId = Number(req.params.id);
        if (!Number.isSafeInteger(numId) || numId < 1) return res.status(400).json({ error: 'Invalid queue number' });

        let sessionId;
        try {
            sessionId = await getCurrentSessionId(req.storeId);
        } catch (e) {
            return res.status(400).json({ error: 'No active session found. Please reset the queue.' });
        }

        const queue = await Queue.findOne({ storeId: req.storeId, branchId: 'default', sessionId, queueNumber: numId }).lean();
        if (!queue) return res.status(404).json({ error: 'Queue not found' });
        queue.id = queue.queueNumber;

        // Calculate position
        if (queue.status === 'waiting') {
            const position = await Queue.countDocuments({
                storeId: req.storeId,
                branchId: 'default',
                sessionId,
                status: 'waiting',
                queueNumber: { $lt: queue.queueNumber }
            });
            const avgTime = Number.parseFloat(await getSetting(req.storeId, 'avg_time', '30')) || 30;
            const tableCount = Math.max(1, Number.parseInt(await getSetting(req.storeId, 'table_count', '10'), 10) || 10);
            const timePerTable = avgTime / tableCount;
            queue.estimatedWaitTime = Math.ceil((position + 1) * timePerTable);
            queue.queueAhead = position;
        }

        res.json(queue);
    } catch (err) {
        res.status(400).json({ error: 'Invalid ID' });
    }
});

// Reserve Queue (New Dynamic)
app.post('/api/reserve', requireActivePublicStore, async (req, res) => {
    const { name, lineId, pax, phone, timeSlot } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    try {
        let sessionId;
        try {
            sessionId = await getCurrentSessionId(req.storeId);
        } catch (e) {
            return res.status(400).json({ error: 'No active session available. Please contact admin.' });
        }

        // Check if Line ID already has active queue
        if (lineId) {
            const existing = await Queue.findOne({ storeId: req.storeId, branchId: 'default', sessionId, lineUserId: lineId, status: { $in: ['waiting', 'called', 'dining'] } }).lean();
            if (existing) {
                const displayId = existing.queueNumber !== undefined ? existing.queueNumber : existing._id.toString();
                return res.status(409).json({ error: 'คุณมีคิวอยู่แล้ว (You already have a queue)', queueId: displayId });
            }
        }

        // Atomic queue number increment
        const counter = await Counter.findOneAndUpdate(
            { storeId: req.storeId, branchId: 'default', sessionId },
            { $inc: { seq: 1 } },
            { new: true, upsert: true }
        );

        const cancelToken = crypto.randomBytes(32).toString('base64url');
        const typedSettings = await StoreSetting.findOne({ storeId: req.storeId, branchId: 'default' }).lean();
        const newQueue = await Queue.create({
            storeId: req.storeId,
            branchId: 'default',
            sessionId,
            queueNumber: counter.seq,
            customerName: name,
            lineUserId: lineId || null,
            cancelTokenHash: crypto.createHash('sha256').update(cancelToken).digest('hex'),
            phoneNumber: phone || null,
            pax: pax || 1,
            time_slot: timeSlot || null,
            status: 'waiting',
            scheduledCallAt: typedSettings?.autoCallEnabled
                ? new Date(Date.now() + (Number(typedSettings.autoCallDelayMinutes) || 15) * 60_000)
                : null,
            history: [{ action: 'reserved' }]
        });

        await NotificationService.sendForQueue(newQueue, 'QUEUE_RESERVED', {
            queueAhead: Math.max(0, counter.seq - 1),
            estimatedWaitTime: newQueue.estimatedWaitTime
        });

        broadcastUpdate(req.storeId);
        const outputId = newQueue.queueNumber !== undefined ? newQueue.queueNumber : newQueue._id.toString();
        res.json({ success: true, id: outputId, queueNumber: newQueue.queueNumber, cancelToken });
    } catch (err) {
        console.error('Error in /api/reserve:', err);
        if (err.code === 11000) return res.status(409).json({ error: 'Queue conflict (duplicate key)' });
        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
});

// Cancel Queue (Customer)
app.post('/api/cancel', requireActivePublicStore, async (req, res) => {
    try {
        const { id, cancelToken } = req.body;
        const numId = Number(id);
        if (isNaN(numId)) return res.status(400).json({ error: 'Invalid ID format' });

        let sessionId;
        try {
            sessionId = await getCurrentSessionId(req.storeId);
        } catch (e) {
            return res.status(400).json({ error: 'No active session found.' });
        }

        if (!cancelToken) return res.status(403).json({ error: 'Cancellation token is required' });
        const cancelTokenHash = crypto.createHash('sha256').update(String(cancelToken)).digest('hex');
        const query = { storeId: req.storeId, branchId: 'default', sessionId, queueNumber: numId, cancelTokenHash, status: { $in: ['waiting', 'called'] } };

        const queue = await Queue.findOneAndUpdate(
            query,
            {
                status: 'cancelled',
                cancelledAt: new Date(),
                manualAction: true,
                $push: { history: { action: 'cancelled' } }
            },
            { new: true }
        );

        if (!queue) return res.status(404).json({ error: 'Queue not found, unauthorized, or already cancelled' });

        await NotificationService.sendForQueue(queue, 'QUEUE_CANCELLED');
        await NotificationService.syncQueuePositions(req.storeId);

        broadcastUpdate(req.storeId);
        res.json({ success: true });
    } catch (err) {
        console.error('Error in /api/cancel:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/admin/login', async (req, res) => {
    try {
        const token = await loginAdmin(req.storeId, req.body.pin);
        res.json({ token, storeId: req.storeId });
    } catch (error) {
        const status = error.message === 'ADMIN_PIN_NOT_CONFIGURED' ? 503 : 401;
        res.status(status).json({ error: error.message === 'ADMIN_PIN_NOT_CONFIGURED' ? 'Admin PIN is not configured' : 'Invalid PIN' });
    }
});

app.use('/api/admin', requireAdmin);

app.get('/api/admin/me', (req, res) => res.json({ storeId: req.admin.storeId, role: req.admin.role }));

app.post('/api/admin/cancel', async (req, res) => {
    const queueNumber = Number(req.body.id);
    if (!Number.isSafeInteger(queueNumber) || queueNumber < 1) return res.status(400).json({ error: 'Invalid queue number' });
    try {
        const sessionId = await getCurrentSessionId(req.storeId);
        const queue = await Queue.findOneAndUpdate(
            { storeId: req.storeId, branchId: 'default', sessionId, queueNumber, status: { $in: ['waiting', 'called'] } },
            {
                $set: { status: 'cancelled', cancelledAt: new Date(), manualAction: true },
                $push: { history: { action: 'cancelled' } }
            },
            { new: true }
        );
        if (!queue) return res.status(404).json({ error: 'Queue not found or cannot be cancelled' });
        await NotificationService.sendForQueue(queue, 'QUEUE_CANCELLED');
        await NotificationService.syncQueuePositions(req.storeId);
        await broadcastUpdate(req.storeId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Admin: Call Queue
app.post('/api/admin/call', async (req, res) => {
    try {
        const { id } = req.body;
        const numId = Number(id);
        if (isNaN(numId)) return res.status(400).json({ error: 'Invalid ID format' });

        let sessionId;
        try {
            sessionId = await getCurrentSessionId(req.storeId);
        } catch (e) {
            return res.status(400).json({ error: 'No active session found.' });
        }

        const typedSettings = await StoreSetting.findOne({ storeId: req.storeId, branchId: 'default' }).lean();
        const now = new Date();
        const queue = await Queue.findOneAndUpdate(
            { storeId: req.storeId, branchId: 'default', sessionId, queueNumber: numId, status: 'waiting' },
            {
                status: 'called',
                calledAt: now,
                seatDeadlineAt: new Date(now.getTime() + (Number(typedSettings?.seatGracePeriodMinutes) || 10) * 60_000),
                manualAction: true,
                $push: { history: { action: 'called' } }
            },
            { new: true }
        );

        if (!queue) return res.status(404).json({ error: 'Queue not found or not waiting' });

        await NotificationService.sendForQueue(queue, 'QUEUE_CALLED');
        await NotificationService.syncQueuePositions(req.storeId);

        broadcastUpdate(req.storeId);
        res.json({ success: true });
    } catch (err) {
        console.error('Error in /api/admin/call:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Admin: Seat Customer (Start Timer)
app.post('/api/admin/seat', async (req, res) => {
    try {
        const { id } = req.body;
        const numId = Number(id);
        if (isNaN(numId)) return res.status(400).json({ error: 'Invalid ID format' });

        let sessionId;
        try {
            sessionId = await getCurrentSessionId(req.storeId);
        } catch (e) {
            return res.status(400).json({ error: 'No active session found.' });
        }

        const typedSettings = await StoreSetting.findOne({ storeId: req.storeId, branchId: 'default' }).lean();
        const now = new Date();
        const queue = await Queue.findOneAndUpdate(
            { storeId: req.storeId, branchId: 'default', sessionId, queueNumber: numId, status: { $in: ['waiting', 'called'] } },
            {
                status: 'dining',
                seatedAt: now,
                diningDeadlineAt: new Date(now.getTime() + (Number(typedSettings?.diningTimeLimitMinutes) || 90) * 60_000),
                manualAction: true,
                $push: { history: { action: 'seated' } }
            },
            { new: true }
        );

        if (!queue) return res.status(404).json({ error: 'Queue not found or cannot be seated' });

        await NotificationService.sendForQueue(queue, 'QUEUE_UPDATED');
        await NotificationService.syncQueuePositions(req.storeId);

        broadcastUpdate(req.storeId);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Admin: Complete Queue (Was Clear)
app.post('/api/admin/complete', async (req, res) => {
    try {
        const { id } = req.body;
        const numId = Number(id);
        if (isNaN(numId)) return res.status(400).json({ error: 'Invalid ID format' });

        let sessionId;
        try {
            sessionId = await getCurrentSessionId(req.storeId);
        } catch (e) {
            return res.status(400).json({ error: 'No active session found.' });
        }

        const queue = await Queue.findOneAndUpdate(
            { storeId: req.storeId, branchId: 'default', sessionId, queueNumber: numId, status: 'dining' },
            {
                status: 'completed',
                completedAt: new Date(),
                $push: { history: { action: 'completed' } }
            },
            { new: true }
        );

        if (!queue) return res.status(404).json({ error: 'Queue not found or not dining' });

        await NotificationService.sendForQueue(queue, 'QUEUE_COMPLETED');

        broadcastUpdate(req.storeId);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Admin: Reset Session
app.post('/api/admin/reset', async (req, res) => {
    try {
        await NotificationService.notifyStoreClosed(req.storeId);
        const session = await resetSession(req.storeId, null);
        const newSessionId = session.sessionId;

        broadcastUpdate(req.storeId);
        res.json({ success: true, sessionId: newSessionId, message: 'Queue system reset successfully for new session' });
    } catch (err) {
        console.error('Error in /api/admin/reset:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Admin: Get Stats
app.get('/api/admin/stats', async (req, res) => {
    try {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const sessionId = await getCurrentSessionId(req.storeId);
        const scope = { storeId: req.storeId, branchId: 'default', sessionId };
        const total = await Queue.countDocuments({ ...scope, createdAt: { $gte: startOfToday } });
        const completed = await Queue.countDocuments({ ...scope, status: 'completed', createdAt: { $gte: startOfToday } });
        const cancelled = await Queue.countDocuments({ ...scope, status: 'cancelled', createdAt: { $gte: startOfToday } });
        const waiting = await Queue.countDocuments({ ...scope, status: 'waiting' });

        res.json({ total, completed, cancelled, waiting });
    } catch (err) {
        console.error('Error in /api/admin/stats:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/api/admin/settings', async (req, res) => {
    const [storeName, tableCount, avgTime, avgWaitTime] = await Promise.all([
        getSetting(req.storeId, 'store_name', 'Store'),
        getSetting(req.storeId, 'table_count', '10'),
        getSetting(req.storeId, 'avg_time', '30'),
        getSetting(req.storeId, 'avg_wait_time', '15')
    ]);
    res.json({ storeName, tableCount: Number(tableCount), avgTime: Number(avgTime), avgWaitTime: Number(avgWaitTime) });
});

// Admin: Update Settings
app.post('/api/admin/settings', async (req, res) => {
    try {
        const { avgTime, avgWaitTime, tableCount, storeName } = req.body;
        const numericSettings = { avg_time: avgTime, avg_wait_time: avgWaitTime, table_count: tableCount };
        for (const [key, value] of Object.entries(numericSettings)) {
            if (value !== undefined) {
                const number = Number(value);
                if (!Number.isFinite(number) || number <= 0) return res.status(400).json({ error: `${key} must be greater than zero` });
                await setSetting(req.storeId, key, number);
            }
        }
        if (storeName !== undefined) {
            const name = String(storeName).trim();
            if (!name) return res.status(400).json({ error: 'store_name is required' });
            await setSetting(req.storeId, 'store_name', name);
        }
        broadcastUpdate(req.storeId);
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating settings:', err);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// Serve Static Files (Frontend)
const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));

// Handle SPA (React Router) - Send index.html for any other requests
// EXCLUDE /api routes
app.get(/.*/, (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
        return res.status(404).json({ error: 'Not Found' });
    }
    res.sendFile(path.join(clientDist, 'index.html'));
});

// Socket Connection
io.on('connection', async (socket) => {
    try {
        let storeId = DEFAULT_STORE_ID;
        const token = socket.handshake.auth?.token;
        if (token) {
            const claims = verifyAccountToken(token);
            if (!claims.storeId) throw new Error('STORE_TOKEN_REQUIRED');
            storeId = normalizeStoreId(claims.storeId);
        }
        socket.join(`store:${storeId}`);
        socket.data.storeId = storeId;
        socket.emit('queue_updated', await getQueuesData(storeId));
    } catch (error) {
        socket.emit('queue_updated', []);
        console.error('Socket init error:', error);
    }
});

const { startAutomation } = require('./services/queueAutomation');

function startAutomationOnce() {
    if (!automationStarted && databaseReady && server.listening) {
        automationStarted = true;
        startAutomation(broadcastUpdate);
    }
}

async function connectDatabase() {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
    if (mongoose.connection.readyState === 1) {
        databaseReady = true;
        return;
    }

    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    await initDb();
    databaseReady = true;
    startAutomationOnce();
}

function ensureDatabase() {
    if (databaseReady && mongoose.connection.readyState === 1) return Promise.resolve();
    if (!databaseConnectionPromise) {
        databaseConnectionPromise = connectDatabase()
            .catch(error => {
                databaseReady = false;
                throw error;
            })
            .finally(() => {
                databaseConnectionPromise = null;
            });
    }
    return databaseConnectionPromise;
}

mongoose.connection.on('disconnected', () => {
    databaseReady = false;
});

function start() {
    const port = Number(process.env.PORT) || 3000;
    if (server.listening) return server;

    server.listen(port, () => {
        console.log(`Server running on port ${port}`);
        startAutomationOnce();
    });
    ensureDatabase().catch(() => {
        console.error('Initial database connection failed; API requests will retry.');
    });
    return server;
}

if (require.main === module) {
    start();
} else {
    // Serverless runtimes import the Express app instead of calling start().
    ensureDatabase().catch(() => {
        console.error('Initial database connection failed; API requests will retry.');
    });
}

// Export the Express handler for Vercel while retaining helpers for local tests.
module.exports = app;
module.exports.app = app;
module.exports.server = server;
module.exports.start = start;
module.exports.ensureDatabase = ensureDatabase;
