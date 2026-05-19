import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// We test crypto functions directly (no DB needed)
// But we need to override KEY_FILE location for tests
let tmpDir: string;

// Import after env setup
let encrypt: typeof import('../server/lib/crypto.js').encrypt;
let decrypt: typeof import('../server/lib/crypto.js').decrypt;
let maskValue: typeof import('../server/lib/crypto.js').maskValue;
let isMaskedValue: typeof import('../server/lib/crypto.js').isMaskedValue;
let SENSITIVE_KEYS: typeof import('../server/lib/crypto.js').SENSITIVE_KEYS;

describe('Crypto module', () => {
  beforeEach(async () => {
    // Create temp dir for encryption key
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-test-'));
    const dataDir = path.join(tmpDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    // Override process.cwd for key file location
    const originalCwd = process.cwd;
    process.cwd = () => tmpDir;

    // Dynamic import to pick up mocked cwd
    // Reset module cache
    const mod = await import('../server/lib/crypto.js');
    encrypt = mod.encrypt;
    decrypt = mod.decrypt;
    maskValue = mod.maskValue;
    isMaskedValue = mod.isMaskedValue;
    SENSITIVE_KEYS = mod.SENSITIVE_KEYS;

    // Restore cwd (key was already created/read on first call)
    process.cwd = originalCwd;
  });

  afterEach(() => {
    // Clean up temp dir
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('encrypt / decrypt roundtrip', () => {
    it('should encrypt and decrypt a simple string', () => {
      const plain = 'sk-ant-api03-test-key-12345';
      const encrypted = encrypt(plain);

      expect(encrypted).toMatch(/^enc:/);
      expect(encrypted).not.toContain(plain);

      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plain);
    });

    it('should handle empty strings', () => {
      expect(encrypt('')).toBe('');
      expect(decrypt('')).toBe('');
    });

    it('should produce different ciphertexts for same plaintext (random IV)', () => {
      const plain = 'my-secret-key';
      const enc1 = encrypt(plain);
      const enc2 = encrypt(plain);

      expect(enc1).not.toBe(enc2);
      expect(decrypt(enc1)).toBe(plain);
      expect(decrypt(enc2)).toBe(plain);
    });

    it('should handle non-encrypted input in decrypt (legacy)', () => {
      const legacy = 'plain-text-value';
      expect(decrypt(legacy)).toBe(legacy);
    });

    it('should handle unicode characters', () => {
      const plain = 'api-key-with-unicode-日本語-🔑';
      const encrypted = encrypt(plain);
      expect(decrypt(encrypted)).toBe(plain);
    });

    it('should handle very long keys', () => {
      const plain = 'x'.repeat(10000);
      const encrypted = encrypt(plain);
      expect(decrypt(encrypted)).toBe(plain);
    });

    it('should return empty string for corrupted ciphertext', () => {
      const result = decrypt('enc:invalid-base64-data!!!');
      expect(result).toBe('');
    });
  });

  describe('maskValue', () => {
    it('should mask a typical API key', () => {
      const key = 'sk-ant-api03-abcdefghijklmnop-1234';
      const masked = maskValue(key);

      expect(masked).toContain('...');
      expect(masked).toContain('1234'); // last 4
      expect(masked).not.toContain('abcdefghijklmnop');
    });

    it('should mask short values with bullets', () => {
      expect(maskValue('abcd')).toBe('••••••••');
      expect(maskValue('12345678')).toBe('••••••••');
    });

    it('should handle empty values', () => {
      expect(maskValue('')).toBe('');
    });

    it('should mask encrypted values (decrypt first)', () => {
      const plain = 'sk-ant-api03-longkey-abcd';
      const encrypted = encrypt(plain);
      const masked = maskValue(encrypted);

      expect(masked).toContain('...');
      expect(masked).toContain('abcd');
    });

    it('should show prefix up to first dash', () => {
      const key = 'sk-some-long-key-value-1234';
      const masked = maskValue(key);

      expect(masked.startsWith('sk-')).toBe(true);
      expect(masked.endsWith('1234')).toBe(true);
    });
  });

  describe('isMaskedValue', () => {
    it('should detect masked values', () => {
      expect(isMaskedValue('sk-...1234')).toBe(true);
      expect(isMaskedValue('prefix...abcd')).toBe(true);
    });

    it('should not detect encrypted values as masked', () => {
      expect(isMaskedValue('enc:somebase64data')).toBe(false);
    });

    it('should not detect plain values as masked', () => {
      expect(isMaskedValue('my-api-key-12345')).toBe(false);
      expect(isMaskedValue('')).toBe(false);
    });
  });

  describe('SENSITIVE_KEYS', () => {
    it('should contain expected keys', () => {
      expect(SENSITIVE_KEYS.has('telegram_bot_token')).toBe(true);
      expect(SENSITIVE_KEYS.has('slack_webhook_url')).toBe(true);
      expect(SENSITIVE_KEYS.has('slack_bot_token')).toBe(true);
    });

    it('should not include non-sensitive keys', () => {
      expect(SENSITIVE_KEYS.has('port')).toBe(false);
      expect(SENSITIVE_KEYS.has('working_directory')).toBe(false);
    });
  });
});
