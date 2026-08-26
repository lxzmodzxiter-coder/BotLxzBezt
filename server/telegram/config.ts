import crypto from "crypto";

export type TelegramRuntimeSecrets = {
  telegramBotToken: string;
  apiPeruToken?: string;
  telegramWebhookSecret: string;
  auditHashSecret: string;
};

const PLACEHOLDER_PATTERN = /^(change-me|example|placeholder|tu[_-]?(token|clave|secreto)|your[_-]?(token|key|secret))$/i;

function requireSecret(
  environment: NodeJS.ProcessEnv,
  key: keyof NodeJS.ProcessEnv,
  minimumLength = 1,
): string {
  const value = environment[key]?.trim();
  if (!value || value.length < minimumLength || PLACEHOLDER_PATTERN.test(value)) {
    throw new Error(`Missing or invalid required secret: ${key}`);
  }
  return value;
}

function optionalSecret(environment: NodeJS.ProcessEnv, key: keyof NodeJS.ProcessEnv): string | undefined {
  const value = environment[key]?.trim();
  return value && !PLACEHOLDER_PATTERN.test(value) ? value : undefined;
}

function deriveInternalSecret(botToken: string, label: string) {
  return crypto.createHmac("sha256", botToken).update(label).digest("base64url");
}

/**
 * Keeps every credential server-only. The internal webhook and audit secrets are
 * deterministically derived from the validated bot token until the operator
 * chooses to provide dedicated secret values.
 */
export function parseTelegramRuntimeSecrets(
  environment: NodeJS.ProcessEnv = process.env,
): TelegramRuntimeSecrets {
  const telegramBotToken = requireSecret(environment, "TELEGRAM_BOT_TOKEN", 12);
  return {
    telegramBotToken,
    apiPeruToken: optionalSecret(environment, "API_PERU_TOKEN"),
    telegramWebhookSecret:
      optionalSecret(environment, "TELEGRAM_WEBHOOK_SECRET") ||
      deriveInternalSecret(telegramBotToken, "telegram-webhook-v1"),
    auditHashSecret:
      optionalSecret(environment, "AUDIT_HASH_SECRET") ||
      deriveInternalSecret(telegramBotToken, "audit-hash-v1"),
  };
}

export function requireApiPeruToken(secrets: TelegramRuntimeSecrets) {
  if (!secrets.apiPeruToken) {
    throw new Error("Missing or invalid required secret: API_PERU_TOKEN");
  }
  return secrets.apiPeruToken;
}
