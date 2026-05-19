/**
 * Notification dispatch tests — EventBus → Telegram/Slack
 * Separate file for clean module isolation (telegram/slack mocked at top level)
 */
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

// Mock send functions at module level — notification/index.ts will pick these up
const mockSendTelegram = vi.fn().mockResolvedValue(undefined);
const mockSendSlack = vi.fn().mockResolvedValue(undefined);

vi.mock('../server/notifications/telegram.js', () => ({
  sendTelegramMessage: mockSendTelegram,
}));

vi.mock('../server/notifications/slack.js', () => ({
  sendSlackMessage: mockSendSlack,
}));

const { startNotificationService } = await import('../server/notifications/index.js');
const { eventBus } = await import('../server/engine/event-bus.js');

function setNotifSettings(overrides: Record<string, string> = {}): void {
  const defaults: Record<string, string> = {
    telegram_enabled: 'true',
    telegram_bot_token: 'enc:test-bot-token',
    telegram_chat_id: '12345',
    slack_enabled: 'true',
    slack_webhook_url: 'enc:https://hooks.slack.com/test',
    slack_bot_token: '',
    slack_channel: '#test',
    ...overrides,
  };

  const insert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(defaults)) {
    insert.run(key, value);
  }
}

describe('Notification Dispatch', () => {
  beforeEach(() => {
    db = createTestDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  // Register listeners once (idempotent — eventBus is singleton)
  startNotificationService();

  it('should send to Telegram on task:completed', async () => {
    setNotifSettings({ slack_enabled: 'false' });

    eventBus.emit('task:completed', {
      taskId: 't1', pipelineId: 'p1', taskName: 'Build Widget',
      status: 'done', output: 'ok', tokens: 150, durationMs: 3200,
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(mockSendTelegram).toHaveBeenCalled();
    const [token, chatId, text] = mockSendTelegram.mock.calls[0]!;
    expect(token).toBe('test-bot-token');
    expect(chatId).toBe('12345');
    expect(text).toContain('Build Widget');
    expect(text).toContain('completed');
  });

  it('should send to Slack on task:failed', async () => {
    setNotifSettings({ telegram_enabled: 'false' });

    eventBus.emit('task:failed', {
      taskId: 't2', pipelineId: 'p1', taskName: 'Deploy',
      status: 'error', error: 'Connection timeout', attempt: 2,
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(mockSendSlack).toHaveBeenCalled();
    const [webhook, , , text] = mockSendSlack.mock.calls[0]!;
    expect(webhook).toBe('https://hooks.slack.com/test');
    expect(text).toContain('Deploy');
    expect(text).toContain('failed');
  });

  it('should send to both channels when both enabled', async () => {
    setNotifSettings();

    eventBus.emit('pipeline:completed', {
      pipelineId: 'p1', pipelineName: 'Marketing', status: 'done',
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(mockSendTelegram).toHaveBeenCalled();
    expect(mockSendSlack).toHaveBeenCalled();
  });

  it('should not send when both disabled', async () => {
    setNotifSettings({ telegram_enabled: 'false', slack_enabled: 'false' });

    eventBus.emit('task:completed', {
      taskId: 't1', pipelineId: 'p1', taskName: 'X',
      status: 'done', output: '', tokens: 0, durationMs: 0,
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(mockSendTelegram).not.toHaveBeenCalled();
    expect(mockSendSlack).not.toHaveBeenCalled();
  });

  it('should not send when token is empty', async () => {
    setNotifSettings({
      telegram_enabled: 'true',
      telegram_bot_token: '',
      slack_enabled: 'false',
    });

    eventBus.emit('task:completed', {
      taskId: 't1', pipelineId: 'p1', taskName: 'X',
      status: 'done', output: '', tokens: 0, durationMs: 0,
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(mockSendTelegram).not.toHaveBeenCalled();
  });

  it('should not crash on send failure', async () => {
    setNotifSettings({ slack_enabled: 'false' });
    mockSendTelegram.mockRejectedValueOnce(new Error('Network error'));

    eventBus.emit('task:completed', {
      taskId: 't1', pipelineId: 'p1', taskName: 'X',
      status: 'done', output: '', tokens: 0, durationMs: 0,
    });

    await new Promise((r) => setTimeout(r, 100));
    // Just checking no crash — the rejection is caught inside dispatch
  });

  it('should handle pipeline:failed event', async () => {
    setNotifSettings({ slack_enabled: 'false' });

    eventBus.emit('pipeline:failed', {
      pipelineId: 'p2', pipelineName: 'CI/CD Pipeline', status: 'error',
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(mockSendTelegram).toHaveBeenCalled();
    const text = mockSendTelegram.mock.calls[0]![2];
    expect(text).toContain('CI/CD Pipeline');
    expect(text).toContain('failed');
  });

  it('should handle task:blocked event', async () => {
    setNotifSettings({ slack_enabled: 'false' });

    eventBus.emit('task:blocked', {
      taskId: 't8', pipelineId: 'p1', taskName: 'Code Review',
      status: 'blocked', reason: 'Safety rule violation',
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(mockSendTelegram).toHaveBeenCalled();
    const text = mockSendTelegram.mock.calls[0]![2];
    expect(text).toContain('Code Review');
    expect(text).toContain('blocked');
  });

  it('should handle task:approval_needed event', async () => {
    setNotifSettings({ slack_enabled: 'false' });

    eventBus.emit('task:approval_needed', {
      taskId: 't9', pipelineId: 'p1', taskName: 'Final Review',
      status: 'pending_approval',
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(mockSendTelegram).toHaveBeenCalled();
    const text = mockSendTelegram.mock.calls[0]![2];
    expect(text).toContain('Final Review');
    expect(text).toContain('approval');
  });
});
