import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

export async function hashPassword(password) {
  return await bcrypt.hash(String(password), SALT_ROUNDS);
}

export async function verifyPassword(plaintext, storedHash) {
  return await bcrypt.compare(String(plaintext), storedHash);
}

export function sanitizeUser(user) {
  const { passwordHash, ...rest } = user;
  return rest;
}
