import { verifyTokenPayload, consumeTicket } from './tokenAuth.js';
import { query } from './db.js';

export async function resolveCurrentUserId(req = null) {
  if (!req) {
    return null;
  }

  let candidateToken = null;

  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (authHeader && typeof authHeader === 'string') {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) {
      candidateToken = match[1].trim();
    }
  }

  if (!candidateToken) {
    const sessionTokenHeader = req.headers?.['x-session-token'];
    if (sessionTokenHeader && typeof sessionTokenHeader === 'string') {
      candidateToken = sessionTokenHeader.trim();
    }
  }

  // Short-lived single-use ticket for SSE or file download links
  const queryTicket = req.query?.ticket;
  if (queryTicket && typeof queryTicket === 'string') {
    const ticketUserId = consumeTicket(queryTicket.trim());
    if (ticketUserId) return ticketUserId;
  }

  // NOTE: General req.query?.token is intentionally rejected for security (token leaks in URLs/logs)

  if (!candidateToken) {
    return null;
  }

  const payload = verifyTokenPayload(candidateToken);
  if (!payload || !payload.userId) {
    return null;
  }

  // Check token_version against database if users table is accessible
  try {
    const rows = await query(
      'SELECT token_version FROM users WHERE id = :userId LIMIT 1',
      { userId: payload.userId }
    );
    if (rows && rows.length > 0) {
      const currentVersion = Number(rows[0].token_version ?? 1);
      if (Number(payload.tokenVersion ?? 1) !== currentVersion) {
        return null; // Token revoked by logout or password change
      }
    }
  } catch {
    // Database query failed or table not ready; signature and expiration are already verified
  }

  return payload.userId;
}

export async function requireCurrentUserId(req = null) {
  const userId = await resolveCurrentUserId(req);
  if (!userId) {
    const error = new Error('No active user found. Please sign up or log in first.');
    error.statusCode = 401;
    throw error;
  }
  return userId;
}
