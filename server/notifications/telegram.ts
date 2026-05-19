const TELEGRAM_API = 'https://api.telegram.org/bot';

export interface NotificationPayload {
  emoji: string;
  title: string;
  body: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Send a notification message via Telegram Bot API (HTML parse mode) */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  message: NotificationPayload,
): Promise<void> {
  const url = `${TELEGRAM_API}${botToken}/sendMessage`;

  const titleLine = `${message.emoji} <b>${escapeHtml(message.title)}</b>`;
  const bodyLine = escapeHtml(message.body);
  const text = `${titleLine}\n${bodyLine}`;

  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Telegram API error ${response.status}: ${errorText}`);
  }
}
