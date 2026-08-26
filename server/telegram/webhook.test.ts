import { describe, expect, it } from "vitest";
import {
  buildWebhookRouteSecret,
  getTelegramWebhookPath,
  matchesWebhookSecret,
} from "./webhook";

const secrets = {
  telegramBotToken: "123456789:abcdefghijklmnopqrstuvwxyz_1234567890",
  apiPeruToken: "apiperu_test_token_1234567890",
  telegramWebhookSecret: "webhook_secret_with_at_least_32_characters",
  auditHashSecret: "audit_hash_secret_with_at_least_32_chars",
};

describe("webhook hardening", () => {
  it("derives a stable secret route without exposing the audit secret", () => {
    const routeSecret = buildWebhookRouteSecret(secrets);
    expect(routeSecret).toHaveLength(32);
    expect(routeSecret).not.toContain(secrets.auditHashSecret);
    expect(getTelegramWebhookPath(secrets)).toBe(`/api/telegram/webhook/${routeSecret}`);
  });

  it("requires exact route and header secrets", () => {
    expect(matchesWebhookSecret(secrets.telegramWebhookSecret, secrets.telegramWebhookSecret)).toBe(true);
    expect(matchesWebhookSecret("incorrect_secret", secrets.telegramWebhookSecret)).toBe(false);
    expect(matchesWebhookSecret(undefined, secrets.telegramWebhookSecret)).toBe(false);
  });
});
