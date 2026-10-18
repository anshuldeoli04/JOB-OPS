import crypto from 'node:crypto';
import { loadLocalEnv } from './loadEnv.js';

loadLocalEnv();

const isTestEnv =
  process.env.NODE_ENV === 'test' ||
  Boolean(process.env.NODE_TEST_CONTEXT) ||
  (Array.isArray(process.execArgv) && process.execArgv.some((arg) => arg.includes('test')));

const SECRET =
  process.env.SESSION_SECRET ||
  (isTestEnv ? 'test-session-secret-key-at-least-32-chars-long!!' : null);

if (!SECRET || SECRET.length < 32) {
  throw new Error(
    'SESSION_SECRET environment variable is required and must be at least 32 characters. ' +
    'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
}

const TOKEN_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 24) * 60 * 60 * 1000;

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return Buffer.from(str, 'base64').toString('utf8');
}

const activeTickets = new Map();
const TICKET_TTL_MS = 60 * 1000; // 60 seconds
let maxActiveTickets = 5000;

export function purgeExpiredTickets() {
  const now = Date.now();
  let count = 0;
  for (const [ticket, record] of activeTickets.entries()) {
    if (now > record.expiresAt) {
      activeTickets.delete(ticket);
      count++;
    }
  }
  return count;
}

// Periodic cleanup sweep every 5 minutes without keeping event loop alive
const cleanupInterval = setInterval(purgeExpiredTickets, 5 * 60 * 1000);
if (cleanupInterval && typeof cleanupInterval.unref === 'function') {
  cleanupInterval.unref();
}

export function issueTicket(userId) {
  if (activeTickets.size >= maxActiveTickets) {
    purgeExpiredTickets();
  }
  while (activeTickets.size >= maxActiveTickets) {
    const oldestKey = activeTickets.keys().next().value;
    if (oldestKey !== undefined) {
      activeTickets.delete(oldestKey);
    } else {
      break;
    }
  }

  const ticket = crypto.randomBytes(24).toString('base64url');
  activeTickets.set(ticket, {
    userId,
    expiresAt: Date.now() + TICKET_TTL_MS
  });
  return ticket;
}

export function consumeTicket(ticket) {
  if (!ticket || typeof ticket !== 'string') return null;
  const record = activeTickets.get(ticket);
  if (!record) return null;
  activeTickets.delete(ticket); // single use!
  if (Date.now() > record.expiresAt) return null;
  return record.userId;
}

export function getActiveTicketCount() {
  return activeTickets.size;
}

export function clearActiveTicketsForTest() {
  activeTickets.clear();
}

export function setMaxActiveTicketsForTest(limit) {
  maxActiveTickets = Number(limit) || 5000;
}


export function generateToken(userId, tokenVersion = 1) {
  const payload = {
    userId,
    tokenVersion: Number(tokenVersion) || 1,
    exp: Date.now() + TOKEN_TTL_MS,
    iat: Date.now()
  };
  const payloadStr = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(payloadStr)
    .digest('base64url');

  return `${payloadStr}.${signature}`;
}

export function verifyTokenPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadStr, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SECRET)
    .update(payloadStr)
    .digest('base64url');

  try {
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSig)
    );
    if (!isValid) return null;

    const payload = JSON.parse(base64UrlDecode(payloadStr));
    if (!payload.userId || (payload.exp && Date.now() > payload.exp)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function verifyToken(token, expectedVersion = null) {
  const payload = verifyTokenPayload(token);
  if (!payload) return null;
  if (expectedVersion !== null && Number(payload.tokenVersion ?? 1) !== Number(expectedVersion)) {
    return null;
  }
  return payload.userId;
}
