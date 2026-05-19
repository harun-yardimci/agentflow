import type { NotificationPayload } from './telegram.js';

function escapeSlack(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Send a notification via Slack Incoming Webhook or Bot API */
export async function sendSlackMessage(
  webhookUrl: string,
  botToken: string,
  channel: string,
  message: NotificationPayload,
): Promise<void> {
  const titleLine = `${message.emoji} *${escapeSlack(message.title)}*`;
  const bodyLine = escapeSlack(message.body);
  const text = `${titleLine}\n${bodyLine}`;

  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text },
    },
  ];

  // Prefer bot token, fall back to webhook
  if (botToken) {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${botToken}`,
      },
      body: JSON.stringify({ channel, text, blocks }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Slack API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as { ok: boolean; error?: string };
    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`);
    }
  } else if (webhookUrl) {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, blocks }),
    });

    if (!response.ok) {
      throw new Error(`Slack webhook error ${response.status}`);
    }
  } else {
    throw new Error('No Slack webhook URL or bot token configured');
  }
}
