import { parseTelegramRuntimeSecrets } from "../server/telegram/config.ts";
import { getTelegramWebhookPath } from "../server/telegram/webhook.ts";

const publicOrigin = "https://tel-api-peru-rzyqfkqw.manus.space";
const secrets = parseTelegramRuntimeSecrets();
const webhookUrl = `${publicOrigin}${getTelegramWebhookPath(secrets)}`;

const response = await fetch(`https://api.telegram.org/bot${secrets.telegramBotToken}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: secrets.telegramWebhookSecret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  }),
});

const payload = await response.json().catch(() => ({}));
if (!response.ok || payload.ok !== true) {
  throw new Error(`Telegram rejected webhook registration: ${payload.description || response.status}`);
}

console.log(JSON.stringify({ configured: true, urlHost: new URL(webhookUrl).host }));
