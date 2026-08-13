const StoreSetting = require('../models/StoreSetting');
const Queue = require('../models/Queue');
const Branch = require('../models/Branch');

const MINUTE_MS = 60_000;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function asPositiveMinutes(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

function localMinutes(date, timezone = 'Asia/Bangkok') {
    let parts;
    try {
        parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: timezone,
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(date);
    } catch {
        parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
        }).formatToParts(date);
    }
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return Number(values.hour) * 60 + Number(values.minute);
}

function parseClock(value) {
    if (!TIME_PATTERN.test(String(value || ''))) return null;
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
}

function isAutomaticCallWindowOpen(settings, timezone, now = new Date()) {
    if (!settings?.autoCallScheduleEnabled) return true;
    const start = parseClock(settings.autoCallScheduleStart);
    const end = parseClock(settings.autoCallScheduleEnd);
    if (start === null || end === null || start === end) return true;
    const current = localMinutes(now, timezone);
    return start < end
        ? current >= start && current < end
        : current >= start || current < end;
}

function alignToAutomaticCallWindow(candidate, settings, timezone) {
    if (!settings?.autoCallScheduleEnabled) return candidate;
    const aligned = new Date(candidate);
    // Search by persisted wall-clock minutes. This stays timezone/DST aware
    // without trusting the browser or assuming a fixed UTC offset.
    for (let index = 0; index < 2 * 24 * 60; index += 1) {
        if (isAutomaticCallWindowOpen(settings, timezone, aligned)) return aligned;
        aligned.setTime(aligned.getTime() + MINUTE_MS);
    }
    return candidate;
}

async function allocateScheduledCallAt(storeId, branchId, settings, now = new Date()) {
    if (!settings?.autoCallEnabled) return null;
    const delayMs = asPositiveMinutes(settings.autoCallDelayMinutes, 15) * MINUTE_MS;
    const intervalMs = asPositiveMinutes(settings.autoCallIntervalMinutes, 5) * MINUTE_MS;
    const branch = await Branch.findOne({ storeId, branchId }).select('timezone').lean();
    const timezone = branch?.timezone || 'Asia/Bangkok';
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const current = await StoreSetting.findOne({ storeId, branchId, autoCallEnabled: true }).lean();
        if (!current) return null;
        const earliest = new Date(now.getTime() + delayMs);
        const rawCandidate = current.nextAutoCallAt && current.nextAutoCallAt >= earliest
            ? new Date(current.nextAutoCallAt.getTime() + intervalMs)
            : earliest;
        const candidate = alignToAutomaticCallWindow(rawCandidate, current, timezone);
        const updated = await StoreSetting.findOneAndUpdate(
            { _id: current._id, autoCallEnabled: true, nextAutoCallAt: current.nextAutoCallAt || null },
            { $set: { nextAutoCallAt: candidate } },
            { new: true }
        ).lean();
        if (updated) return updated.nextAutoCallAt;
    }
    throw new Error('AUTO_CALL_SLOT_CONTENTION');
}

async function claimAutomaticCallSlot(storeId, branchId, settings, now = new Date()) {
    const intervalMs = asPositiveMinutes(settings?.autoCallIntervalMinutes, 5) * MINUTE_MS;
    const threshold = new Date(now.getTime() - intervalMs);
    return StoreSetting.findOneAndUpdate(
        {
            storeId,
            branchId,
            autoCallEnabled: true,
            $or: [{ lastAutoCallAt: null }, { lastAutoCallAt: { $lte: threshold } }]
        },
        { $set: { lastAutoCallAt: now } },
        { new: true }
    ).lean();
}

async function scheduleUnassignedQueues(storeId, branchId, sessionId, settings, now = new Date()) {
    const waiting = await Queue.find({ storeId, branchId, sessionId, status: 'waiting' })
        .sort({ queueNumber: 1 })
        .select('_id scheduledCallAt')
        .lean();
    const existingTimes = waiting.filter(queue => queue.scheduledCallAt).map(queue => queue.scheduledCallAt.getTime());
    let lastAllocatedAt = existingTimes.length ? new Date(Math.max(...existingTimes)) : null;
    if (lastAllocatedAt) {
        await StoreSetting.updateOne({ storeId, branchId }, { $max: { nextAutoCallAt: lastAllocatedAt } });
    }
    for (const queue of waiting) {
        if (queue.scheduledCallAt) continue;
        const scheduledCallAt = await allocateScheduledCallAt(storeId, branchId, settings, now);
        const result = await Queue.updateOne(
            { _id: queue._id, status: 'waiting', scheduledCallAt: null },
            { $set: { scheduledCallAt } }
        );
        if (result.modifiedCount > 0) lastAllocatedAt = scheduledCallAt;
    }
    settings.nextAutoCallAt = lastAllocatedAt;
    return lastAllocatedAt;
}

module.exports = {
    MINUTE_MS,
    TIME_PATTERN,
    isAutomaticCallWindowOpen,
    alignToAutomaticCallWindow,
    allocateScheduledCallAt,
    claimAutomaticCallSlot,
    scheduleUnassignedQueues
};
