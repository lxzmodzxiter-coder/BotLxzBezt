import type { TelegramRuntimeSecrets } from "./config";

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";

type TelegramApiResponse<T> = { ok: boolean; result?: T; description?: string };

async function telegramRequest<T>(
  secrets: TelegramRuntimeSecrets,
  method: string,
  body: Record<string, unknown>,
): Promise<TelegramApiResponse<T>> {
  try {
    const response = await fetch(`${TELEGRAM_API_BASE_URL}/bot${secrets.telegramBotToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await response.json()) as TelegramApiResponse<T>;
  } catch {
    return { ok: false, description: "Telegram is temporarily unavailable" };
  }
}

export async function sendTelegramMessage(
  secrets: TelegramRuntimeSecrets,
  chatId: string,
  text: string,
  inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>,
) {
  return telegramRequest(secrets, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(inlineKeyboard ? { reply_markup: { inline_keyboard: inlineKeyboard } } : {}),
  });
}

export async function sendTelegramPhoto(
  secrets: TelegramRuntimeSecrets,
  chatId: string,
  photoUrl: string,
  caption: string,
  inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>,
) {
  return telegramRequest(secrets, "sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    caption,
    ...(inlineKeyboard ? { reply_markup: { inline_keyboard: inlineKeyboard } } : {}),
  });
}

export async function answerCallbackQuery(
  secrets: TelegramRuntimeSecrets,
  callbackQueryId: string,
) {
  return telegramRequest(secrets, "answerCallbackQuery", { callback_query_id: callbackQueryId });
}

export async function setTelegramWebhook(
  secrets: TelegramRuntimeSecrets,
  webhookUrl: string,
) {
  return telegramRequest<boolean>(secrets, "setWebhook", {
    url: webhookUrl,
    secret_token: secrets.telegramWebhookSecret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
}
