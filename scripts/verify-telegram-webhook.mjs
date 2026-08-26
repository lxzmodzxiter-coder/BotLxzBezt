import { parseTelegramRuntimeSecrets } from "../server/telegram/config.ts";

const secrets = parseTelegramRuntimeSecrets();
const response = await fetch(`https://api.telegram.org/bot${secrets.telegramBotToken}/getWebhookInfo`);
const payload = await response.json();

if (!response.ok || payload.ok !== true) {
  throw new Error(`Telegram did not return webhook information: ${payload.description || response.status}`);
}

const info = payload.result || {};
console.log(JSON.stringify({
  configured: Boolean(info.url),
  urlHost: info.url ? new URL(info.url).host : null,
  pendingUpdateCount: info.pending_update_count ?? 0,
  lastErrorDate: info.last_error_date ?? null,
  lastErrorMessage: info.last_error_message ?? null,
}));
