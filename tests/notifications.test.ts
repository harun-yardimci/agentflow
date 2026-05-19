import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb } from './helpers/test-db.js';

let db: Database.Database;

vi.mock('../server/db/connection.js', () => ({
  getDb: () => db,
  closeDb: () => { db?.close(); },
}));

vi.mock('../server/lib/crypto.js', () => ({
  decrypt: (val: string) => val.startsWith('enc:') ? val.slice(4) : val,
  encrypt: (val: string) => `enc:${val}`,
  maskValue: (val: string) => `****${val.slice(-4)}`,
  isMaskedValue: (val: string) => val.includes('...'),
  SENSITIVE_KEYS: new Set([
    'telegram_bot_token', 'slack_webhook_url', 'slack_bot_token',
  ]),
}));

/* ═══════════════════════════════════════════════════════════════
   Telegram sendTelegramMessage
   ═══════════════════════════════════════════════════════════════ */

const { sendTelegramMessage } = await import('../server/notifications/telegram.js');

describe('Telegram sendTelegramMessage', () => {
  beforeEach(() => {
    db = createTestDb();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it('should call Telegram Bot API with correct format', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
    } as unknown as Response);

    await sendTelegramMessage('bot-token', '12345', 'Hello!');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.telegram.org/botbot-token/sendMessage');
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.chat_id).toBe('12345');
    expect(body.text).toBe('Hello!');
    expect(body.parse_mode).toBe('Markdown');
  });

  it('should throw on API error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    } as unknown as Response);

    await expect(
      sendTelegramMessage('bad-token', '123', 'Hello')
    ).rejects.toThrow('Telegram API error 401');
  });
});

/* ═══════════════════════════════════════════════════════════════
   Slack sendSlackMessage
   ═══════════════════════════════════════════════════════════════ */

const { sendSlackMessage } = await import('../server/notifications/slack.js');

describe('Slack sendSlackMessage', () => {
  beforeEach(() => {
    db = createTestDb();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it('should call webhook URL for notification', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => 'ok',
    } as unknown as Response);

    await sendSlackMessage(
      'https://hooks.slack.com/services/test',
      '',
      '',
      'Hello from test',
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://hooks.slack.com/services/test');
  });

  it('should prefer bot token over webhook', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as unknown as Response);

    await sendSlackMessage(
      'https://hooks.slack.com/test',
      'xoxb-token',
      '#general',
      'Hello',
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://slack.com/api/chat.postMessage');
    expect((opts as RequestInit).headers).toHaveProperty('Authorization', 'Bearer xoxb-token');
  });

  it('should throw when no webhook or bot token', async () => {
    await expect(
      sendSlackMessage('', '', '', 'Hello')
    ).rejects.toThrow('No Slack webhook URL or bot token configured');
  });

  it('should throw on Slack API error response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: 'channel_not_found' }),
    } as unknown as Response);

    await expect(
      sendSlackMessage('', 'xoxb-token', '#bad', 'Hello')
    ).rejects.toThrow('Slack API error: channel_not_found');
  });

  it('should throw on webhook HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
    } as unknown as Response);

    await expect(
      sendSlackMessage('https://hooks.slack.com/test', '', '', 'Hello')
    ).rejects.toThrow('Slack webhook error 500');
  });
});

/* ═══════════════════════════════════════════════════════════════
   formatMessage
   ═══════════════════════════════════════════════════════════════ */

const { formatMessage } = await import('../server/notifications/index.js');

describe('formatMessage', () => {
  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('should format task:completed message', () => {
    const result = formatMessage('task:completed', {
      taskId: 't1', pipelineId: 'p1', taskName: 'Build',
      status: 'done', output: 'ok', tokens: 100, durationMs: 5000,
    });

    expect(result.text).toContain('Build');
    expect(result.text).toContain('completed');
    expect(result.text).toContain('100');
    expect(result.text).toContain('5.0');
    expect(result.emoji).toBe('\u2705');
  });

  it('should format task:failed message', () => {
    const result = formatMessage('task:failed', {
      taskId: 't1', pipelineId: 'p1', taskName: 'Deploy',
      status: 'error', error: 'Connection refused', attempt: 3,
    });

    expect(result.text).toContain('Deploy');
    expect(result.text).toContain('failed');
    expect(result.text).toContain('Connection refused');
    expect(result.text).toContain('3');
    expect(result.emoji).toBe('\u274c');
  });

  it('should format task:blocked message', () => {
    const result = formatMessage('task:blocked', {
      taskId: 't1', pipelineId: 'p1', taskName: 'Review',
      status: 'blocked', reason: 'Safety violation',
    });

    expect(result.text).toContain('Review');
    expect(result.text).toContain('blocked');
    expect(result.text).toContain('Safety violation');
    expect(result.emoji).toBe('\u26d4');
  });

  it('should format task:approval_needed message', () => {
    const result = formatMessage('task:approval_needed', {
      taskId: 't1', pipelineId: 'p1', taskName: 'Copy Review',
      status: 'pending_approval',
    });

    expect(result.text).toContain('Copy Review');
    expect(result.text).toContain('approval');
    expect(result.emoji).toBe('\u23f3');
  });

  it('should format pipeline:completed message', () => {
    const result = formatMessage('pipeline:completed', {
      pipelineId: 'p1', pipelineName: 'Marketing', status: 'done',
    });

    expect(result.text).toContain('Marketing');
    expect(result.text).toContain('completed');
  });

  it('should format pipeline:failed message', () => {
    const result = formatMessage('pipeline:failed', {
      pipelineId: 'p1', pipelineName: 'CI/CD', status: 'error',
    });

    expect(result.text).toContain('CI/CD');
    expect(result.text).toContain('failed');
  });

  it('should truncate long error messages', () => {
    const longError = 'X'.repeat(300);
    const result = formatMessage('task:failed', {
      taskId: 't1', pipelineId: 'p1', taskName: 'Fail',
      status: 'error', error: longError, attempt: 1,
    });

    // Error should be truncated to 200 chars
    expect(result.text.length).toBeLessThan(350);
  });
});
