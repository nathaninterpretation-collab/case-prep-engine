import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

const ALGO = 'aes-256-gcm';

function getKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (hex && hex.length === 64) {
    return Buffer.from(hex, 'hex');
  }
  // Derive a 256-bit key from JWT_SECRET when ENCRYPTION_KEY is not set
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('Either ENCRYPTION_KEY (64-char hex) or JWT_SECRET must be set');
  return createHash('sha256').update(secret).digest();
}

export function encryptApiKey(plaintext) {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return { encrypted, iv: iv.toString('hex'), tag };
}

export function decryptApiKey(encrypted, ivHex, tagHex) {
  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
