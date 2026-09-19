const crypto = require('crypto');

const isProduction = process.env.NODE_ENV === 'production';
const port = Number.parseInt(process.env.PORT || '3000', 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const sessionSecret = process.env.SESSION_SECRET || (!isProduction ? 'development-only-session-secret-change-me-please' : '');
if (isProduction && sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must be configured and at least 32 characters in production.');
}

const adminUsername = (process.env.ADMIN_USERNAME || '').trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || '';
const adminRegistrationCode = process.env.ADMIN_REGISTRATION_CODE || '';

function getCookieOptions() {
  return {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction
  };
}

function verifyHmacToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const [payload, signature] = parts;
  const expected = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

module.exports = {
  adminPassword,
  adminRegistrationCode,
  adminUsername,
  getCookieOptions,
  generateOtp,
  isProduction,
  port,
  sessionSecret,
  verifyHmacToken
};
