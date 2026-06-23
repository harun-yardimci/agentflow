import { describe, it, expect } from 'vitest';
import { detectAuthError } from '../auth-error-detector.js';

describe('detectAuthError', () => {
  it('returns null for empty or unrelated errors', () => {
    expect(detectAuthError('', 'claude')).toBeNull();
    expect(detectAuthError('TypeError: foo is not a function', 'claude')).toBeNull();
    expect(detectAuthError('Exit code: 1', 'codex')).toBeNull();
  });

  it('does not mistake a rate-limit message for an auth error', () => {
    expect(
      detectAuthError("You've hit your 5-hour limit. Resets in 3 hours.", 'claude'),
    ).toBeNull();
  });

  it('does not park benign agent output that merely mentions auth-ish words', () => {
    // bare verb — not a login directive
    expect(detectAuthError('Please run npm test to verify the changes.', 'claude')).toBeNull();
    // a /login route/URL, not a "run /login" instruction
    expect(detectAuthError('Failed to render the /login page (404).', 'claude')).toBeNull();
    expect(detectAuthError('See https://app.example.com/login for details.', 'gemini')).toBeNull();
    // env var name in documentation
    expect(detectAuthError('Docs: set GOOGLE_API_KEY in .env to enable Google.', 'gemini')).toBeNull();
    // a bare status word with no 401 / auth-failure framing
    expect(detectAuthError('Marked the request as unauthorized in the schema.', 'codex')).toBeNull();
  });

  it('detects Claude session/login errors', () => {
    expect(detectAuthError('Invalid API key · Please run /login', 'claude')).not.toBeNull();
    expect(
      detectAuthError('OAuth token has expired. Please obtain a new token.', 'claude'),
    ).not.toBeNull();
    expect(detectAuthError('Please run /login', 'claude')).not.toBeNull();
  });

  it('detects Codex auth errors', () => {
    expect(detectAuthError('stream error: unexpected status 401 Unauthorized', 'codex')).not.toBeNull();
    expect(detectAuthError('Not logged in. Please run `codex login`.', 'codex')).not.toBeNull();
  });

  it('detects Gemini auth errors', () => {
    expect(detectAuthError('API key not valid. Please pass a valid API key.', 'gemini')).not.toBeNull();
    expect(
      detectAuthError('Request had invalid authentication credentials.', 'gemini'),
    ).not.toBeNull();
  });

  it('detects generic 401/unauthorized across any provider', () => {
    expect(detectAuthError('Error: 401 Unauthorized', 'claude')).not.toBeNull();
    expect(detectAuthError('authentication failed', 'gemini')).not.toBeNull();
    expect(detectAuthError('your session has expired', 'codex')).not.toBeNull();
  });

  it('returns the matched substring for diagnostics', () => {
    const info = detectAuthError('fatal: Invalid API key provided', 'claude');
    expect(info).not.toBeNull();
    expect(info!.matched.toLowerCase()).toContain('invalid api key');
  });
});
