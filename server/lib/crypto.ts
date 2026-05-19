import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const KEY_FILE = path.join(process.cwd(), 'data', '.encryption-key');

/** Sensitive settings keys that should be encrypted */
export const SENSITIVE_KEYS = new Set([
  'telegram_bot_token',
  'slack_webhook_url',
  'slack_bot_token',
]);

/** Get or create the encryption key (stored locally in data/.encryption-key) */
function getEncryptionKey(): Buffer {
  try {
    if (fs.existsSync(KEY_FILE)) {
      const hex = fs.readFileSync(KEY_FILE, 'utf-8').trim();
      return Buffer.from(hex, 'hex');
    }
  } catch {
    // Key file missing or corrupted, regenerate
  }

  // Generate a new random key
  const key = crypto.randomBytes(KEY_LENGTH);
  const dir = path.dirname(KEY_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 });
  return key;
}

/** Encrypt a plaintext string → base64-encoded ciphertext */
export function encrypt(plaintext: string): string {
  if (!plaintext) return '';

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Format: iv + authTag + ciphertext, all base64
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return `enc:${combined.toString('base64')}`;
}

/** Decrypt a base64-encoded ciphertext → plaintext string */
export function decrypt(ciphertext: string): string {
  if (!ciphertext) return '';
  if (!ciphertext.startsWith('enc:')) return ciphertext; // Not encrypted (legacy)

  try {
    const key = getEncryptionKey();
    const combined = Buffer.from(ciphertext.slice(4), 'base64');

    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString('utf-8');
  } catch {
    console.error('[Crypto] Failed to decrypt value — returning empty');
    return '';
  }
}

/** Mask a sensitive value for UI display (e.g., "sk-ant-...abcd") */
export function maskValue(value: string): string {
  if (!value) return '';

  // Decrypt first if encrypted
  const plain = value.startsWith('enc:') ? decrypt(value) : value;
  if (!plain) return '';

  if (plain.length <= 8) {
    return '••••••••';
  }

  // Show first prefix (up to separator or 6 chars) + last 4 chars
  const last4 = plain.slice(-4);
  const prefix = plain.slice(0, Math.min(6, plain.indexOf('-') > 0 ? plain.indexOf('-') + 1 : 6));
  return `${prefix}...${last4}`;
}

/** Check if a value looks like a masked placeholder (not a real key) */
export function isMaskedValue(value: string): boolean {
  if (!value) return false;
  return value.includes('...') && !value.startsWith('enc:');
}
