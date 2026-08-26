import { describe, expect, it } from "vitest";

describe("Telegram bot token integration", () => {
  it("authenticates against the lightweight getMe endpoint", async () => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    expect(token).toBeTruthy();

    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const payload = (await response.json()) as {
      ok: boolean;
      result?: { is_bot?: boolean; id?: number };
    };

    expect(response.ok).toBe(true);
    expect(payload.ok).toBe(true);
    expect(payload.result?.is_bot).toBe(true);
    expect(payload.result?.id).toBeTypeOf("number");
  }, 15_000);
});
