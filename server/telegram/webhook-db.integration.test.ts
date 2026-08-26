import { eq } from "drizzle-orm";
import express from "express";
import { createServer } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { telegramUpdates } from "../../drizzle/schema";
import { getDb } from "../db";

const testSecrets = {
  telegramBotToken: "123456789:abcdefghijklmnopqrstuvwxyz_1234567890",
  apiPeruToken: "apiperu_test_token_1234567890",
  telegramWebhookSecret: "webhook_secret_with_at_least_32_characters",
  auditHashSecret: "audit_hash_secret_with_at_least_32_chars",
};

const mocks = vi.hoisted(() => ({ processTelegramUpdate: vi.fn() }));
vi.mock("./config", () => ({ parseTelegramRuntimeSecrets: () => testSecrets }));
vi.mock("./service", () => ({ processTelegramUpdate: mocks.processTelegramUpdate }));
vi.mock("../_core/notification", () => ({ notifyOwner: vi.fn().mockResolvedValue(true) }));

import { getTelegramWebhookPath, registerTelegramWebhook } from "./webhook";

describe("webhook persistent update storage", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let updateId: number;

  beforeEach(async () => {
    mocks.processTelegramUpdate.mockReset();
    updateId = Math.floor(Date.now() % 1_500_000_000) + Math.floor(Math.random() * 10_000);
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
    const db = await getDb();
    await db?.delete(telegramUpdates).where(eq(telegramUpdates.telegramUpdateId, updateId));
  });

  it("stores the first update and persists duplicate detection for the same update_id", async () => {
    const url = `${baseUrl}${getTelegramWebhookPath(testSecrets)}`;
    const request = () =>
      fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": testSecrets.telegramWebhookSecret,
        },
        body: JSON.stringify({ update_id: updateId, message: { message_id: 1 } }),
      });

    const first = await request();
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ ok: true });
    expect(mocks.processTelegramUpdate).toHaveBeenCalledTimes(1);

    const db = await getDb();
    const stored = await db
      ?.select()
      .from(telegramUpdates)
      .where(eq(telegramUpdates.telegramUpdateId, updateId));
    expect(stored).toHaveLength(1);
    expect(stored?.[0]?.processedAt).toBeTruthy();

    const duplicate = await request();
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toEqual({ ok: true, duplicate: true });
    expect(mocks.processTelegramUpdate).toHaveBeenCalledTimes(1);
  });
});
