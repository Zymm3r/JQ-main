const NotificationLog = require('../models/NotificationLog');
const NotificationUsage = require('../models/NotificationUsage');
const Queue = require('../models/Queue');
const Store = require('../models/Store');
const StoreSetting = require('../models/StoreSetting');
const QueueSession = require('../models/QueueSession');

const NOTIFICATION_POLICY = Object.freeze({ unlimited: true, limit: null });
const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);
const MESSAGE_TEXT = {
    QUEUE_RESERVED: 'รับคิวเรียบร้อยแล้ว',
    QUEUE_UPDATED: 'อัปเดตลำดับคิวของคุณแล้ว',
    QUEUE_NEAR: 'ใกล้ถึงคิวของคุณแล้ว',
    QUEUE_CALLED: 'ถึงคิวของคุณแล้ว กรุณาติดต่อพนักงานหน้าร้าน',
    QUEUE_CANCELLED: 'ยกเลิกคิวของคุณแล้ว',
    QUEUE_COMPLETED: 'ใช้บริการเสร็จสิ้นแล้ว ขอบคุณค่ะ/ครับ',
    STORE_CLOSED: 'ร้านปิดรับคิวแล้ว'
};
const STATUS_TEXT = {
    waiting: 'รอคิว', called: 'เรียกคิวแล้ว', dining: 'กำลังใช้บริการ', completed: 'เสร็จสิ้น', cancelled: 'ยกเลิกแล้ว', closed: 'ร้านปิดรับคิว'
};

let transport = async (lineUserId, message) => {
    const { client } = require('../lineService');
    if (!client) return { mock: true };
    return client.pushMessage(lineUserId, message);
};

function periodFor(date = new Date()) {
    return date.toISOString().slice(0, 7);
}

function quotaForStore(store) {
    const plan = store.plan || 'free';
    return { plan, ...NOTIFICATION_POLICY };
}

function errorDetails(error) {
    const statusCode = Number(error?.statusCode || error?.status || error?.originalError?.response?.status || error?.response?.status) || null;
    const apiCode = error?.originalError?.response?.data?.message || error?.response?.data?.message || error?.code;
    return {
        statusCode,
        errorCode: String(apiCode || (statusCode ? `HTTP_${statusCode}` : error?.message || 'LINE_API_ERROR')).slice(0, 200),
        retryable: RETRYABLE_STATUS_CODES.has(statusCode)
    };
}

async function consumeQuota(store, period) {
    const quota = quotaForStore(store);
    const usage = await NotificationUsage.findOneAndUpdate(
        { storeId: store.storeId, period },
        { $inc: { count: 1 }, $set: { limit: null, unlimited: true, plan: quota.plan } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return { allowed: true, usage, ...quota };
}

function buildQueueUrls(store, data) {
    const baseUrl = String(process.env.APP_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
    const path = `/liff/${encodeURIComponent(store.liffSlug || store.slug)}/status/${encodeURIComponent(data.publicToken)}`;
    return { viewUrl: `${baseUrl}${path}`, cancelUrl: `${baseUrl}${path}?cancel=1` };
}

function buildFlexMessage(store, type, data, sentAt = new Date()) {
    const queueNumber = data.queueNumber === undefined || data.queueNumber === null ? '-' : `Q${data.queueNumber}`;
    const status = STATUS_TEXT[data.status] || data.status || '-';
    const details = [];
    if (Number.isFinite(data.queueAhead)) details.push(`เหลือ ${data.queueAhead} คิวก่อนหน้า`);
    if (Number.isFinite(data.estimatedWaitTime)) details.push(`รอประมาณ ${data.estimatedWaitTime} นาที`);
    const bodyContents = [
        { type: 'text', text: store.name || 'ร้านค้า', weight: 'bold', size: 'xl', wrap: true },
        { type: 'text', text: MESSAGE_TEXT[type], size: 'md', wrap: true, margin: 'md' },
        { type: 'text', text: queueNumber, weight: 'bold', size: '3xl', color: '#2563EB', margin: 'lg' },
        { type: 'box', layout: 'baseline', margin: 'md', contents: [
            { type: 'text', text: 'สถานะ', color: '#64748B', size: 'sm', flex: 2 },
            { type: 'text', text: status, weight: 'bold', size: 'sm', flex: 4, wrap: true }
        ] }
    ];
    if (details.length) bodyContents.push({ type: 'text', text: details.join(' · '), color: '#475569', size: 'sm', wrap: true, margin: 'md' });
    bodyContents.push(
        { type: 'separator', margin: 'lg' },
        { type: 'text', text: `ส่งเมื่อ ${sentAt.toISOString()}`, color: '#94A3B8', size: 'xs', wrap: true, margin: 'md' },
        { type: 'text', text: 'ข้อความแจ้งเตือนคิวนี้ส่งโดยแพลตฟอร์มจัดการคิวกลาง', color: '#94A3B8', size: 'xs', wrap: true, margin: 'sm' }
    );

    const footerContents = [];
    if (data.publicToken && store.liffSlug) {
        const urls = buildQueueUrls(store, data);
        footerContents.push({ type: 'button', style: 'primary', color: '#2563EB', action: { type: 'uri', label: 'ดูสถานะคิว', uri: urls.viewUrl } });
        if (data.cancellationPossible) {
            footerContents.push({ type: 'button', style: 'secondary', action: { type: 'uri', label: 'ยกเลิกคิว', uri: urls.cancelUrl }, margin: 'sm' });
        }
    }
    return {
        type: 'flex',
        altText: `${store.name || 'ร้านค้า'}: ${MESSAGE_TEXT[type]} ${queueNumber}`.slice(0, 400),
        contents: {
            type: 'bubble',
            body: { type: 'box', layout: 'vertical', contents: bodyContents },
            ...(footerContents.length ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: footerContents } } : {})
        }
    };
}

async function send({ storeId, queueId = null, lineUserId, type, data = {} }) {
    if (!NotificationLog.TYPES.includes(type)) throw new Error('INVALID_NOTIFICATION_TYPE');
    if (!lineUserId) return { status: 'skipped', reason: 'NO_LINE_USER' };
    const store = await Store.findOne({ storeId }).lean();
    if (!store) throw new Error('STORE_NOT_FOUND');
    const period = periodFor();
    const quota = await consumeQuota(store, period);
    const log = await NotificationLog.create({ storeId, queueId, lineUserId, type, period, status: 'pending', errorCode: null });

    const message = buildFlexMessage(store, type, data);
    let lastErrorCode = null;
    for (let attempt = 0; attempt <= 2; attempt += 1) {
        try {
            await transport(lineUserId, message);
            log.status = 'sent';
            log.sentAt = new Date();
            log.retryCount = attempt;
            log.errorCode = lastErrorCode;
            log.retryNeeded = false;
            await log.save();
            return { status: 'sent', log, message, usage: quota.usage, limit: quota.limit };
        } catch (error) {
            const details = errorDetails(error);
            lastErrorCode = details.errorCode;
            log.retryCount = attempt;
            log.errorCode = details.errorCode;
            if (!details.retryable || attempt === 2) {
                log.status = 'failed';
                log.retryNeeded = details.retryable;
                await log.save();
                return { status: 'failed', log, message, retryNeeded: details.retryable };
            }
            await log.save();
        }
    }
}

function queueNotificationData(queue, extra = {}) {
    return {
        queueNumber: queue.queueNumber,
        publicToken: queue.publicToken,
        status: queue.status,
        estimatedWaitTime: queue.estimatedWaitTime,
        cancellationPossible: ['waiting', 'called'].includes(queue.status),
        ...extra
    };
}

async function sendForQueue(queue, type, extra = {}) {
    return send({
        storeId: queue.storeId,
        queueId: queue._id,
        lineUserId: queue.lineUserId,
        type,
        data: queueNotificationData(queue, extra)
    });
}

async function syncQueuePositions(storeId, branchId = 'default') {
    const [session, settings] = await Promise.all([
        QueueSession.findOne({ storeId, branchId, status: 'active' }).lean(),
        StoreSetting.findOne({ storeId, branchId }).lean()
    ]);
    if (!session || !settings) return [];
    const queues = await Queue.find({ storeId, branchId, sessionId: session.sessionId, status: 'waiting' }).sort({ queueNumber: 1 });
    const results = [];
    for (let index = 0; index < queues.length; index += 1) {
        const queue = queues[index];
        const queueAhead = index;
        const estimatedWaitTime = Math.ceil(((queueAhead + 1) / settings.totalTables) * settings.averageTableTime);
        const changed = queue.lastNotifiedQueueAhead !== null && queue.lastNotifiedQueueAhead !== queueAhead;
        queue.estimatedWaitTime = estimatedWaitTime;
        if (queue.lineUserId && changed) {
            const near = queueAhead <= 2 && !queue.nearNotificationSentAt;
            const result = await sendForQueue(queue, near ? 'QUEUE_NEAR' : 'QUEUE_UPDATED', { queueAhead, estimatedWaitTime });
            results.push(result);
            if (near) queue.nearNotificationSentAt = new Date();
        }
        queue.lastNotifiedQueueAhead = queueAhead;
        await queue.save();
    }
    return results;
}

async function notifyStoreClosed(storeId, branchId = 'default') {
    const session = await QueueSession.findOne({ storeId, branchId, status: 'active' }).lean();
    if (!session) return [];
    const queues = await Queue.find({ storeId, branchId, sessionId: session.sessionId, status: { $in: ['waiting', 'called'] }, lineUserId: { $nin: [null, ''] } });
    return Promise.all(queues.map(queue => sendForQueue(queue, 'STORE_CLOSED', { status: 'closed', cancellationPossible: true })));
}

async function getUsage(storeId, date = new Date()) {
    const store = await Store.findOne({ storeId }).lean();
    if (!store) throw new Error('STORE_NOT_FOUND');
    const period = periodFor(date);
    const quota = quotaForStore(store);
    const usage = await NotificationUsage.findOneAndUpdate(
        { storeId, period },
        { $set: { limit: quota.limit, unlimited: quota.unlimited, plan: quota.plan } },
        { new: true }
    ).lean();
    const count = usage?.count || 0;
    return {
        storeId, period, plan: quota.plan, count, limit: quota.limit, unlimited: quota.unlimited,
        remaining: quota.unlimited ? null : Math.max(0, quota.limit - count)
    };
}

function setTransportForTests(value) { transport = value; }
function resetTransportForTests() {
    transport = async (lineUserId, message) => {
        const { client } = require('../lineService');
        if (!client) return { mock: true };
        return client.pushMessage(lineUserId, message);
    };
}

module.exports = {
    NOTIFICATION_POLICY, periodFor, quotaForStore, buildFlexMessage, send, sendForQueue,
    syncQueuePositions, notifyStoreClosed, getUsage, setTransportForTests, resetTransportForTests
};
