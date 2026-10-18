import crypto from 'node:crypto';

const KEY_PREFIX = 'enc:gcm:';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || process.env.API_KEY_ENCRYPTION_SECRET;

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
  throw new Error(
    'ENCRYPTION_KEY environment variable is required and must be at least 32 characters. ' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
}

const ENCRYPTION_SALT = process.env.ENCRYPTION_SALT;

if (!ENCRYPTION_SALT || ENCRYPTION_SALT.length < 16) {
  throw new Error(
    'ENCRYPTION_SALT environment variable is required and must be at least 16 characters. ' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(16).toString(\'hex\'))"'
  );
}

const key = crypto.scryptSync(ENCRYPTION_KEY, ENCRYPTION_SALT, 32);

export function isEncryptedSecret(value) {
  return String(value || '').startsWith(KEY_PREFIX);
}

export function encryptSecret(plainText) {
  const value = String(plainText || '').trim();
  if (!value) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${KEY_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(cipherText) {
  const value = String(cipherText || '').trim();
  if (!value) return '';
  if (!isEncryptedSecret(value)) return value;

  const payload = value.slice(KEY_PREFIX.length);
  const [ivBase64, tagBase64, dataBase64] = payload.split(':');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivBase64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataBase64, 'base64')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}
