import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveTelegramAccessBlock: vi.fn(),
  findAuthorizedTelegramUser: vi.fn(),
  getTelegramBotSettings: vi.fn(),
  reserveDailyQuota: vi.fn(),
  createConsultationAudit: vi.fn(),
  completeConsultationAudit: vi.fn(),
  recordSecurityEvent: vi.fn(),
  countSecurityEventsSince: vi.fn(),
  blockTelegramAccess: vi.fn(),
  sendTelegramMessage: vi.fn(),
  answerCallbackQuery: vi.fn(),
  lookupApiPeru: vi.fn(),
  notifyOwner: vi.fn(),
}));

vi.mock("../db", () => ({
  getActiveTelegramAccessBlock: mocks.getActiveTelegramAccessBlock,
  findAuthorizedTelegramUser: mocks.findAuthorizedTelegramUser,
  getTelegramBotSettings: mocks.getTelegramBotSettings,
  reserveDailyQuota: mocks.reserveDailyQuota,
  createConsultationAudit: mocks.createConsultationAudit,
  completeConsultationAudit: mocks.completeConsultationAudit,
  recordSecurityEvent: mocks.recordSecurityEvent,
  countSecurityEventsSince: mocks.countSecurityEventsSince,
  blockTelegramAccess: mocks.blockTelegramAccess,
}));

vi.mock("./telegramApi", () => ({
  sendTelegramMessage: mocks.sendTelegramMessage,
  answerCallbackQuery: mocks.answerCallbackQuery,
}));

vi.mock("./apiperu", async importOriginal => {
  const actual = await importOriginal<typeof import("./apiperu")>();
  return { ...actual, lookupApiPeru: mocks.lookupApiPeru };
});

vi.mock("../_core/notification", () => ({ notifyOwner: mocks.notifyOwner }));

import { processTelegramUpdate } from "./service";

const secrets = {
  telegramBotToken: "123456789:abcdefghijklmnopqrstuvwxyz_1234567890",
  apiPeruToken: "apiperu_test_token_1234567890",
  telegramWebhookSecret: "webhook_secret_with_at_least_32_characters",
  auditHashSecret: "audit_hash_secret_with_at_least_32_chars",
};

const settings = {
  isEnabled: true,
  defaultDailyLimit: 30,
  unauthorizedAlertThreshold: 3,
  alertWindowMinutes: 15,
  quotaWarningPercent: 80,
};

function update(text: string, actorId = 111111): Parameters<typeof processTelegramUpdate>[0] {
  return {
    update_id: 99,
    message: {
      message_id: 1,
      text,
      from: { id: actorId, first_name: "Operador" },
      chat: { id: actorId, type: "private" },
    },
  };
}

describe("integrated Telegram consultation flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveTelegramAccessBlock.mockResolvedValue(undefined);
    mocks.findAuthorizedTelegramUser.mockResolvedValue({ telegramUserId: "111111" });
    mocks.getTelegramBotSettings.mockResolvedValue(settings);
    mocks.reserveDailyQuota.mockResolvedValue({ allowed: true, currentCount: 1, dailyLimit: 30 });
    mocks.countSecurityEventsSince.mockResolvedValue(1);
    mocks.lookupApiPeru.mockResolvedValue({
      success: true,
      code: "found",
      retryable: false,
      durationMs: 120,
      data: { numero: "44556677", nombre_completo: "PEREZ GARCIA JUAN CARLOS", direccion: "EXCLUIDA" },
    });
  });

  it("allows an authorized DNI request, audits it and filters fields before replying", async () => {
    await processTelegramUpdate(update("/dni 44556677"), secrets);

    expect(mocks.reserveDailyQuota).toHaveBeenCalledWith("111111");
    expect(mocks.lookupApiPeru).toHaveBeenCalledWith("dni", "44556677", secrets.apiPeruToken);
    expect(mocks.completeConsultationAudit).toHaveBeenCalledWith(expect.any(String), "found", "found", 120);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(
      secrets,
      "111111",
      expect.stringContaining("Nombre completo: PEREZ GARCIA JUAN CARLOS"),
    );
    expect(mocks.sendTelegramMessage.mock.calls[0]?.[2]).not.toContain("EXCLUIDA");
  });

  it("rejects a non-authorized user without contacting APIperú", async () => {
    mocks.findAuthorizedTelegramUser.mockResolvedValue(undefined);
    await processTelegramUpdate(update("/dni 44556677", 222222), secrets);

    expect(mocks.lookupApiPeru).not.toHaveBeenCalled();
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "unauthorized_attempt" }));
    expect(mocks.sendTelegramMessage.mock.calls[0]?.[2]).toContain("Acceso no autorizado");
  });

  it("enforces an active temporary block before authorization or provider calls", async () => {
    mocks.getActiveTelegramAccessBlock.mockResolvedValue({ blockedUntil: new Date(Date.now() + 60_000) });
    await processTelegramUpdate(update("/dni 44556677"), secrets);

    expect(mocks.findAuthorizedTelegramUser).not.toHaveBeenCalled();
    expect(mocks.lookupApiPeru).not.toHaveBeenCalled();
    expect(mocks.sendTelegramMessage.mock.calls[0]?.[2]).toContain("temporalmente bloqueado");
  });

  it("maps a documented not-found response without leaking the requested document", async () => {
    mocks.lookupApiPeru.mockResolvedValue({
      success: false,
      code: "document_not_found",
      retryable: false,
      durationMs: 99,
    });
    await processTelegramUpdate(update("/dni 44556677"), secrets);

    expect(mocks.completeConsultationAudit).toHaveBeenCalledWith(expect.any(String), "not_found", "document_not_found", 99);
    expect(mocks.sendTelegramMessage.mock.calls[0]?.[2]).toContain("No se encontró");
    expect(mocks.sendTelegramMessage.mock.calls[0]?.[2]).not.toContain("44556677");
  });

  it("enforces the persisted daily limit without calling APIperú", async () => {
    mocks.reserveDailyQuota.mockResolvedValue({
      allowed: false,
      reason: "limit",
      currentCount: 30,
      dailyLimit: 30,
    });
    await processTelegramUpdate(update("/dni 44556677"), secrets);

    expect(mocks.lookupApiPeru).not.toHaveBeenCalled();
    expect(mocks.createConsultationAudit).toHaveBeenCalledWith(expect.objectContaining({ status: "denied" }));
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "quota_reached" }));
    expect(mocks.sendTelegramMessage.mock.calls[0]?.[2]).toContain("límite diario");
  });

  it("maps the documented transient provider outage into audit, alert and retry-safe feedback", async () => {
    mocks.lookupApiPeru.mockResolvedValue({
      success: false,
      code: "upstream_unavailable",
      retryable: true,
      durationMs: 211,
    });
    await processTelegramUpdate(update("/dni 44556677"), secrets);

    expect(mocks.completeConsultationAudit).toHaveBeenCalledWith(expect.any(String), "upstream_unavailable", "upstream_unavailable", 211);
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "provider_error" }));
    expect(mocks.sendTelegramMessage.mock.calls[0]?.[2]).toContain("no está disponible temporalmente");
  });

  it("rejects invalid input before consuming quota or calling APIperú", async () => {
    await processTelegramUpdate(update("/ruc 20131312954"), secrets);

    expect(mocks.reserveDailyQuota).not.toHaveBeenCalled();
    expect(mocks.lookupApiPeru).not.toHaveBeenCalled();
    expect(mocks.createConsultationAudit).toHaveBeenCalledWith(expect.objectContaining({ status: "invalid_input" }));
  });
});
