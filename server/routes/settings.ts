import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { UpdateSettingsSchema } from '../types/api.js';
import { getDb } from '../db/connection.js';
import { SENSITIVE_KEYS, encrypt, maskValue, isMaskedValue } from '../lib/crypto.js';

const router = Router();

export const SETTINGS_KEY_ALIASES: Record<string, string> = {
  post_task_hook: 'post_run_hook',
  pre_task_hook: 'pre_run_hook',
};

export function toCanonicalSettingKey(key: string): string {
  return SETTINGS_KEY_ALIASES[key] ?? key;
}

export function serializeSettings(
  rows: { key: string; value: string }[],
): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const row of rows) {
    const canonicalKey = toCanonicalSettingKey(row.key);
    const shouldMask = SENSITIVE_KEYS.has(canonicalKey);
    if (shouldMask) {
      settings[canonicalKey] = maskValue(row.value);
    } else if (!(canonicalKey in settings) || canonicalKey === row.key) {
      settings[canonicalKey] = row.value;
    }
  }
  return settings;
}

/** GET /api/settings — returns all settings with sensitive values masked */
router.get('/', (_req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM settings').all() as { key: string; value: string }[];
  res.json(serializeSettings(rows));
});

/** PUT /api/settings — upsert settings, encrypting sensitive values */
router.put('/', validate(UpdateSettingsSchema), (req, res) => {
  const db = getDb();
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const run = db.transaction(() => {
    for (const [key, value] of Object.entries(req.body as Record<string, string>)) {
      const canonicalKey = toCanonicalSettingKey(key);
      if (SENSITIVE_KEYS.has(canonicalKey)) {
        // Skip if value is masked (user didn't change it)
        if (isMaskedValue(value)) continue;
        // Encrypt before storing
        if (value) {
          upsert.run(canonicalKey, encrypt(value));
        } else {
          // Empty value = clear the key
          upsert.run(canonicalKey, '');
        }
      } else {
        upsert.run(canonicalKey, value);
      }
    }
  });
  run();

  // Return updated settings (masked)
  const rows = db.prepare('SELECT * FROM settings').all() as { key: string; value: string }[];
  res.json(serializeSettings(rows));
});

// NOTE: A `GET /decrypt/:key` endpoint that returned plaintext secrets over
// HTTP used to live here. It was unused (executors read secrets directly via
// the crypto lib) and an unauthenticated exfiltration vector, so it was removed.

export default router;
