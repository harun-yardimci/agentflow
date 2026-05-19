import { eventBus, type EventMap } from '../engine/event-bus.js';
import { getDb } from '../db/connection.js';
import { decrypt } from '../lib/crypto.js';
import { sendTelegramMessage } from './telegram.js';
import { sendSlackMessage } from './slack.js';

/** Which events trigger notifications */
const NOTIFY_EVENTS = [
  'task:completed',
  'task:failed',
  'task:blocked',
  'task:approval_needed',
  'pipeline:completed',
  'pipeline:failed',
] as const;

type NotifyEvent = typeof NOTIFY_EVENTS[number];

interface NotificationConfig {
  telegramEnabled: boolean;
  telegramBotToken: string;
  telegramChatId: string;
  slackEnabled: boolean;
  slackWebhookUrl: string;
  slackBotToken: string;
  slackChannel: string;
}

/** Load notification config from settings (with decryption) */
function loadConfig(): NotificationConfig {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT key, value FROM settings WHERE key LIKE 'telegram_%' OR key LIKE 'slack_%'"
    ).all() as { key: string; value: string }[];

    const get = (key: string): string => {
      const row = rows.find((r) => r.key === key);
      if (!row?.value) return '';
      if (row.value.startsWith('enc:')) return decrypt(row.value);
      return row.value;
    };

    return {
      telegramEnabled: get('telegram_enabled') === 'true',
      telegramBotToken: get('telegram_bot_token'),
      telegramChatId: get('telegram_chat_id'),
      slackEnabled: get('slack_enabled') === 'true',
      slackWebhookUrl: get('slack_webhook_url'),
      slackBotToken: get('slack_bot_token'),
      slackChannel: get('slack_channel'),
    };
  } catch {
    return {
      telegramEnabled: false, telegramBotToken: '', telegramChatId: '',
      slackEnabled: false, slackWebhookUrl: '', slackBotToken: '', slackChannel: '',
    };
  }
}

/** Format event into a user-friendly notification message */
export function formatMessage(event: NotifyEvent, data: EventMap[NotifyEvent & keyof EventMap]): { text: string; emoji: string } {
  switch (event) {
    case 'task:completed': {
      const d = data as EventMap['task:completed'];
      return {
        emoji: '\u2705',
        text: `Task "${d.taskName}" completed\n\u2022 Tokens: ${d.tokens}\n\u2022 Duration: ${(d.durationMs / 1000).toFixed(1)}s`,
      };
    }
    case 'task:failed': {
      const d = data as EventMap['task:failed'];
      return {
        emoji: '\u274c',
        text: `Task "${d.taskName}" failed\n\u2022 Attempt: ${d.attempt}\n\u2022 Error: ${d.error.slice(0, 200)}`,
      };
    }
    case 'task:blocked': {
      const d = data as EventMap['task:blocked'];
      return {
        emoji: '\u26d4',
        text: `Task "${d.taskName}" blocked\n\u2022 Reason: ${d.reason}`,
      };
    }
    case 'task:approval_needed': {
      const d = data as EventMap['task:approval_needed'];
      return {
        emoji: '\u23f3',
        text: `Task "${d.taskName}" needs approval`,
      };
    }
    case 'pipeline:completed': {
      const d = data as EventMap['pipeline:completed'];
      return {
        emoji: '\ud83c\udf89',
        text: `Pipeline "${d.pipelineName}" completed!`,
      };
    }
    case 'pipeline:failed': {
      const d = data as EventMap['pipeline:failed'];
      return {
        emoji: '\ud83d\udea8',
        text: `Pipeline "${d.pipelineName}" failed`,
      };
    }
    default:
      return { emoji: '\u2139\ufe0f', text: `Event: ${event}` };
  }
}

/** Dispatch notification to all enabled channels */
async function dispatch(event: NotifyEvent, data: EventMap[NotifyEvent & keyof EventMap]): Promise<void> {
  const config = loadConfig();
  const { text, emoji } = formatMessage(event, data);
  const payload = { emoji, title: 'AgentFlow', body: text };

  // Telegram
  if (config.telegramEnabled && config.telegramBotToken && config.telegramChatId) {
    try {
      await sendTelegramMessage(config.telegramBotToken, config.telegramChatId, payload);
    } catch (err) {
      console.error('[Notifications] Telegram send failed:', (err as Error).message);
    }
  }

  // Slack
  if (config.slackEnabled && (config.slackWebhookUrl || config.slackBotToken)) {
    try {
      await sendSlackMessage(
        config.slackWebhookUrl || '',
        config.slackBotToken || '',
        config.slackChannel || '',
        payload,
      );
    } catch (err) {
      console.error('[Notifications] Slack send failed:', (err as Error).message);
    }
  }
}

/** Register event listeners on EventBus */
export function startNotificationService(): void {
  for (const event of NOTIFY_EVENTS) {
    eventBus.on(event, (data) => {
      dispatch(event, data as EventMap[NotifyEvent & keyof EventMap]).catch((err) => {
        console.error(`[Notifications] Error dispatching ${event}:`, (err as Error).message);
      });
    });
  }
  console.log('[AgentFlow] Notification service started');
}
