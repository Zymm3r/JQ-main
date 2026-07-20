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
const { initDb } = require('./database');
const { DEFAULT_STORE_ID, normalizeStoreId } = require('./config');
const { getSetting, setSetting } = require('./services/settingsService');
const { loginAdmin, requireAdmin } = require('./services/adminAuth');

const { pushMessage, client: lineClient } = require('./lineService');
const line = require('@line/bot-sdk');

mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        console.log('Mongoose connected successfully.');
        await initDb();
    })
    .catch((err) => console.error('Mongoose connection error:', err));

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all for dev
        methods: ["GET", "POST"]
    }
});

app.use(cors());

// --- LINE Webhook Config ---
const lineConfig = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};

// Webhook Route
app.post('/webhook', line.middleware(lineConfig), (req, res) => {
    Promise.all(req.body.events.map(handleEvent))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error(err);
            res.status(500).end();
        });
});

// Event Handler
function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return Promise.resolve(null);
    }

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

// Existing URLs use the legacy store. Future store-specific pages can send x-store-id.
app.use('/api', (req, res, next) => {
    try {
        req.storeId = normalizeStoreId(req.get('x-store-id') || DEFAULT_STORE_ID);
        next();
    } catch (error) {
        res.status(error.statusCode || 400).json({ error: 'Invalid store ID' });
    }
});

// Helper: Get current Session ID
async function getCurrentSessionId(storeId) {
    const setting = await Setting.findOne({ storeId, key: 'active_session' }).lean();
    if (!setting || !setting.value) {
        throw new Error('NO_ACTIVE_SESSION');
    }
    return setting.value;
}

// Helper: Broadcast update
async function getQueuesData(storeId) {
    const sessionId = await getCurrentSessionId(storeId);
    const queues = await Queue.find({ storeId, sessionId, status: { $in: ['waiting', 'called', 'dining'] } }).sort({ queueNumber: 1 }).lean();
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

// Keep-Alive Ping for Render / cron-job.org
app.get('/ping', (req, res) => {
    res.status(200).send('Server is awake');
});

app.get('/api/store', async (req, res) => {
    const store = await Store.findOne({ storeId: req.storeId, status: 'active' }).lean();
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.json({ storeId: req.storeId, name: await getSetting(req.storeId, 'store_name', 'Store') });
});

// Get active queues
app.get('/api/queues', async (req, res) => {
    try {
        res.json(await getQueuesData(req.storeId));
    } catch (e) {
        res.json([]);
    }
});

// Get single queue status
app.get('/api/queues/:id', async (req, res) => {
    try {
        const numId = Number(req.params.id);
        if (!Number.isSafeInteger(numId) || numId < 1) return res.status(400).json({ error: 'Invalid queue number' });

        let sessionId;
        try {
            sessionId = await getCurrentSessionId(req.storeId);
        } catch (e) {
            return res.status(400).json({ error: 'No active session found. Please reset the queue.' });
        }

        const queue = await Queue.findOne({ storeId: req.storeId, sessionId, queueNumber: numId }).lean();
        if (!queue) return res.status(404).json({ error: 'Queue not found' });
        queue.id = queue.queueNumber;

        // Calculate position
        if (queue.status === 'waiting') {
            const position = await Queue.countDocuments({
                storeId: req.storeId,
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
app.post('/api/reserve', async (req, res) => {
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
            const existing = await Queue.findOne({ storeId: req.storeId, sessionId, lineUserId: lineId, status: { $in: ['waiting', 'called', 'dining'] } }).lean();
            if (existing) {
                const displayId = existing.queueNumber !== undefined ? existing.queueNumber : existing._id.toString();
                return res.status(409).json({ error: 'คุณมีคิวอยู่แล้ว (You already have a queue)', queueId: displayId });
            }
        }

        // Atomic queue number increment
        const counter = await Counter.findOneAndUpdate(
            { storeId: req.storeId, sessionId },
            { $inc: { seq: 1 } },
            { new: true, upsert: true }
        );

        const cancelToken = crypto.randomBytes(32).toString('base64url');
        const newQueue = await Queue.create({
            storeId: req.storeId,
            sessionId,
            queueNumber: counter.seq,
            customer_name: name,
            lineUserId: lineId || null,
            cancelTokenHash: crypto.createHash('sha256').update(cancelToken).digest('hex'),
            phone_number: phone || null,
            pax: pax || 1,
            time_slot: timeSlot || null,
            status: 'waiting',
            history: [{ action: 'reserved' }]
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
app.post('/api/cancel', async (req, res) => {
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
        const query = { storeId: req.storeId, sessionId, queueNumber: numId, cancelTokenHash, status: { $in: ['waiting', 'called'] } };

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
            { storeId: req.storeId, sessionId, queueNumber, status: { $in: ['waiting', 'called'] } },
            {
                $set: { status: 'cancelled', cancelledAt: new Date(), manualAction: true },
                $push: { history: { action: 'cancelled' } }
            },
            { new: true }
        );
        if (!queue) return res.status(404).json({ error: 'Queue not found or cannot be cancelled' });
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

        const queue = await Queue.findOneAndUpdate(
            { storeId: req.storeId, sessionId, queueNumber: numId, status: 'waiting' },
            {
                status: 'called',
                calledAt: new Date(),
                $push: { history: { action: 'called' } }
            },
            { new: true }
        );

        if (!queue) return res.status(404).json({ error: 'Queue not found or not waiting' });

        // Send LINE
        if (queue.lineUserId) {
            const displayId = queue.queueNumber !== undefined ? queue.queueNumber : queue._id.toString();
            const msg = `ถึงคิวของคุณแล้ว! (คิวที่ ${displayId})\nกรุณามาที่หน้าร้านได้เลยครับ\n\nYour queue (${displayId}) is ready!`;
            await pushMessage(queue.lineUserId, msg);
        }

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

        const queue = await Queue.findOneAndUpdate(
            { storeId: req.storeId, sessionId, queueNumber: numId, status: { $in: ['waiting', 'called'] } },
            {
                status: 'dining',
                start_time: new Date(),
                $push: { history: { action: 'seated' } }
            },
            { new: true }
        );

        if (!queue) return res.status(404).json({ error: 'Queue not found or cannot be seated' });

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
            { storeId: req.storeId, sessionId, queueNumber: numId, status: 'dining' },
            {
                status: 'completed',
                end_time: new Date(),
                $push: { history: { action: 'completed' } }
            },
            { new: true }
        );

        if (!queue) return res.status(404).json({ error: 'Queue not found or not dining' });

        broadcastUpdate(req.storeId);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Admin: Reset Session
app.post('/api/admin/reset', async (req, res) => {
    try {
        const newSessionId = `session_${Date.now()}`;

        // Ensure active_session is uniquely stored
        await setSetting(req.storeId, 'active_session', newSessionId);

        // Reset counter for that session
        await Counter.findOneAndUpdate(
            { storeId: req.storeId, sessionId: newSessionId },
            { $set: { seq: 0 } },
            { upsert: true, new: true }
        );

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
        const scope = { storeId: req.storeId, sessionId };
        const total = await Queue.countDocuments({ ...scope, created_at: { $gte: startOfToday } });
        const completed = await Queue.countDocuments({ ...scope, status: 'completed', created_at: { $gte: startOfToday } });
        const cancelled = await Queue.countDocuments({ ...scope, status: 'cancelled', created_at: { $gte: startOfToday } });
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
        const storeId = normalizeStoreId(socket.handshake.auth?.storeId || DEFAULT_STORE_ID);
        socket.join(`store:${storeId}`);
        socket.data.storeId = storeId;
        socket.emit('queue_updated', await getQueuesData(storeId));
    } catch (error) {
        socket.emit('queue_updated', []);
        console.error('Socket init error:', error);
    }
});

const { startAutomation } = require('./services/queueAutomation');

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startAutomation(broadcastUpdate);
});
