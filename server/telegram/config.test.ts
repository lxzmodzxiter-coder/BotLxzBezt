import { describe, expect, it } from "vitest";
import { parseTelegramRuntimeSecrets, requireApiPeruToken } from "./config";

const validEnvironment: NodeJS.ProcessEnv = {
  TELEGRAM_BOT_TOKEN: "123456789:abcdefghijklmnopqrstuvwxyz_1234567890",
  API_PERU_TOKEN: "apiperu_test_token_1234567890",
  TELEGRAM_WEBHOOK_SECRET: "webhook_secret_with_at_least_32_characters",
  AUDIT_HASH_SECRET: "audit_hash_secret_with_at_least_32_chars",
};

describe("telegram runtime secrets", () => {
  it("accepts a complete server-side credential set without exposing values", () => {
    const secrets = parseTelegramRuntimeSecrets(validEnvironment);

    expect(secrets.telegramBotToken).toHaveLength(validEnvironment.TELEGRAM_BOT_TOKEN!.length);
    expect(requireApiPeruToken(secrets)).toHaveLength(validEnvironment.API_PERU_TOKEN!.length);
  });

  it("derives internal secrets from a valid bot token and blocks consultation without APIperú", () => {
    expect(() =>
      parseTelegramRuntimeSecrets({
        ...validEnvironment,
        TELEGRAM_BOT_TOKEN: "",
      }),
    ).toThrow("TELEGRAM_BOT_TOKEN");

    const secrets = parseTelegramRuntimeSecrets({ TELEGRAM_BOT_TOKEN: validEnvironment.TELEGRAM_BOT_TOKEN });
    expect(secrets.telegramWebhookSecret).toHaveLength(43);
    expect(secrets.auditHashSecret).toHaveLength(43);
    expect(() => requireApiPeruToken(secrets)).toThrow("API_PERU_TOKEN");
  });
});
