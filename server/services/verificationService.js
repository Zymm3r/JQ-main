const crypto = require('crypto');
require('../loadEnv');

const CODE_TTL_MINUTES = 10;

function hashVerificationCode(userId, code) {
    const secret = process.env.ADMIN_TOKEN_SECRET || 'development-verification-secret';
    return crypto.createHmac('sha256', secret).update(`${userId}:${code}`).digest('hex');
}

async function issueVerificationCode(user) {
    const now = new Date();
    if (user.verificationSentAt && now.getTime() - user.verificationSentAt.getTime() < 60_000) {
        const error = new Error('PLEASE_WAIT_BEFORE_RESENDING');
        error.statusCode = 429;
        throw error;
    }

    const code = String(crypto.randomInt(100000, 1000000));
    user.verificationCodeHash = hashVerificationCode(user._id, code);
    user.verificationExpiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60_000);
    user.verificationSentAt = now;
    await user.save();

    if (process.env.EMAIL_VERIFICATION_WEBHOOK_URL) {
        const response = await fetch(process.env.EMAIL_VERIFICATION_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(process.env.EMAIL_VERIFICATION_WEBHOOK_TOKEN ? { authorization: `Bearer ${process.env.EMAIL_VERIFICATION_WEBHOOK_TOKEN}` } : {})
            },
            body: JSON.stringify({ to: user.email, template: 'verification_code', code, expiresInMinutes: CODE_TTL_MINUTES })
        });
        if (!response.ok) throw new Error('EMAIL_DELIVERY_FAILED');
    } else if (process.env.NODE_ENV !== 'production') {
        console.log(`[DEV EMAIL OTP] ${user.email}: ${code}`);
    } else {
        throw new Error('EMAIL_DELIVERY_NOT_CONFIGURED');
    }
    return code;
}

function isVerificationCodeValid(user, code) {
    if (!user.verificationCodeHash || !user.verificationExpiresAt || user.verificationExpiresAt <= new Date()) return false;
    const expected = Buffer.from(user.verificationCodeHash);
    const actual = Buffer.from(hashVerificationCode(user._id, String(code)));
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

module.exports = { issueVerificationCode, isVerificationCodeValid };
