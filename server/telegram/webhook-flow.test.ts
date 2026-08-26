import express from "express";
import { createServer } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimTelegramUpdate: vi.fn(),
  markTelegramUpdateProcessed: vi.fn(),
  recordSecurityEvent: vi.fn(),
  processTelegramUpdate: vi.fn(),
  notifyOwner: vi.fn(),
}));

const testSecrets = {
  telegramBotToken: "123456789:abcdefghijklmnopqrstuvwxyz_1234567890",
  apiPeruToken: "apiperu_test_token_1234567890",
  telegramWebhookSecret: "webhook_secret_with_at_least_32_characters",
  auditHashSecret: "audit_hash_secret_with_at_least_32_chars",
};

vi.mock("../db", () => ({
  claimTelegramUpdate: mocks.claimTelegramUpdate,
  markTelegramUpdateProcessed: mocks.markTelegramUpdateProcessed,
  recordSecurityEvent: mocks.recordSecurityEvent,
}));
vi.mock("./config", () => ({ parseTelegramRuntimeSecrets: () => testSecrets }));
vi.mock("./service", () => ({ processTelegramUpdate: mocks.processTelegramUpdate }));
vi.mock("../_core/notification", () => ({ notifyOwner: mocks.notifyOwner }));

import { getTelegramWebhookPath, registerTelegramWebhook } from "./webhook";

describe("persistent Telegram update deduplication", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    const app = express();
    app.use(express.json());
    registerTelegramWebhook(app);
    server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not start");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it("acknowledges a duplicate update without processing it again", async () => {
    mocks.claimTelegramUpdate.mockResolvedValue(false);
    const response = await fetch(`${baseUrl}${getTelegramWebhookPath(testSecrets)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": testSecrets.telegramWebhookSecret,
      },
      body: JSON.stringify({ update_id: 987654, message: { message_id: 1 } }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, duplicate: true });
    expect(mocks.claimTelegramUpdate).toHaveBeenCalledWith(987654);
    expect(mocks.processTelegramUpdate).not.toHaveBeenCalled();
    expect(mocks.markTelegramUpdateProcessed).not.toHaveBeenCalled();
  });

  it("processes a newly claimed update exactly once", async () => {
    mocks.claimTelegramUpdate.mockResolvedValue(true);
    const response = await fetch(`${baseUrl}${getTelegramWebhookPath(testSecrets)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": testSecrets.telegramWebhookSecret,
      },
      body: JSON.stringify({ update_id: 987655, message: { message_id: 2 } }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.processTelegramUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.markTelegramUpdateProcessed).toHaveBeenCalledWith(987655);
  });
});
