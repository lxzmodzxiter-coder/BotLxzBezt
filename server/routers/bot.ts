import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { notifyOwner } from "../_core/notification";
import { adminProcedure, router } from "../_core/trpc";
import {
  defaultTelegramBotSettings,
  getDashboardMetrics,
  getRecentAudits,
  getRecentSecurityEvents,
  getTelegramBotSettings,
  listAuthorizedTelegramUsers,
  recordSecurityEvent,
  recordWebhookConfiguration,
  saveAuthorizedTelegramUser,
  saveTelegramBotSettings,
} from "../db";
import { parseTelegramRuntimeSecrets } from "../telegram/config";
import { isValidTelegramUserId } from "../telegram/domain";
import { setTelegramWebhook } from "../telegram/telegramApi";
import { getWebhookUrl } from "../telegram/webhook";

const telegramUserSchema = z.object({
  telegramUserId: z.string().trim().min(5).max(20),
  displayName: z.string().trim().max(120).optional(),
  username: z.string().trim().max(120).optional(),
  dailyLimit: z.number().int().min(1).max(1000),
  isActive: z.boolean().optional(),
});

const settingsSchema = z.object({
  isEnabled: z.boolean(),
  defaultDailyLimit: z.number().int().min(1).max(1000),
  unauthorizedAlertThreshold: z.number().int().min(1).max(20),
  alertWindowMinutes: z.number().int().min(1).max(1440),
  quotaWarningPercent: z.number().int().min(10).max(100),
});

const webhookOriginSchema = z.object({
  publicOrigin: z.string().url().optional(),
});

function redactFailure(description?: string) {
  return description?.slice(0, 110).replace(/\d{6,}:[A-Za-z0-9_-]+/g, "[redacted]") || "Telegram no confirmó la configuración.";
}

export const botRouter = router({
  dashboard: adminProcedure.query(async () => getDashboardMetrics()),

  authorizedUsers: adminProcedure.query(async () => listAuthorizedTelegramUsers()),

  saveAuthorizedUser: adminProcedure.input(telegramUserSchema).mutation(async ({ input }) => {
    if (!isValidTelegramUserId(input.telegramUserId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "El identificador de Telegram debe ser numérico." });
    }
    await saveAuthorizedTelegramUser(input);
    return { success: true } as const;
  }),

  settings: adminProcedure.query(async () => getTelegramBotSettings()),

  saveSettings: adminProcedure.input(settingsSchema).mutation(async ({ input }) => {
    await saveTelegramBotSettings(input);
    return { success: true } as const;
  }),

  recentAudits: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => getRecentAudits(input?.limit || 20)),

  securityEvents: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => getRecentSecurityEvents(input?.limit || 20)),

  webhookInfo: adminProcedure.input(webhookOriginSchema.optional()).query(({ ctx, input }) => {
    let secretsConfigured = false;
    try {
      parseTelegramRuntimeSecrets();
      secretsConfigured = true;
    } catch {
      secretsConfigured = false;
    }
    let webhookUrl: string | null = null;
    try {
      if (!secretsConfigured) throw new Error("Secrets unavailable");
      const candidate = getWebhookUrl(ctx.req, parseTelegramRuntimeSecrets(), input?.publicOrigin);
      webhookUrl = candidate.startsWith("https://") ? candidate : null;
    } catch {
      webhookUrl = null;
    }
    return getTelegramBotSettings().then(settings => ({
      webhookDisplayUrl: webhookUrl ? `${webhookUrl.slice(0, -8)}••••••••` : null,
      publicUrlReady: Boolean(webhookUrl),
      webhookPath: webhookUrl ? "Ruta protegida configurada" : "Ruta protegida pendiente de secretos",
      secretsConfigured,
      lastConfiguredAt: settings.webhookLastConfiguredAt,
      lastStatus: settings.webhookLastStatus,
    }));
  }),

  configureWebhook: adminProcedure.input(webhookOriginSchema.optional()).mutation(async ({ ctx, input }) => {
    let secrets;
    try {
      secrets = parseTelegramRuntimeSecrets();
    } catch {
      await recordSecurityEvent({
        eventType: "configuration_error",
        severity: "critical",
        details: { component: "webhook_configuration" },
      });
      await notifyOwner({
        title: "Alerta: secretos incompletos",
        content: "Se intentó configurar el webhook de Telegram sin todos los secretos obligatorios.",
      }).catch(() => false);
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Primero configura de forma segura los secretos del bot y APIperú.",
      });
    }

    let webhookUrl: string;
    try {
      webhookUrl = getWebhookUrl(ctx.req, secrets, input?.publicOrigin);
    } catch {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Publica el proyecto en un dominio HTTPS antes de registrar el webhook.",
      });
    }
    if (!webhookUrl.startsWith("https://")) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Publica el proyecto en un dominio HTTPS antes de registrar el webhook.",
      });
    }
    const result = await setTelegramWebhook(secrets, webhookUrl);
    const status = result.ok ? "Webhook configurado correctamente" : redactFailure(result.description);
    await recordWebhookConfiguration(status);

    if (!result.ok) {
      await recordSecurityEvent({
        eventType: "configuration_error",
        severity: "critical",
        details: { component: "telegram_set_webhook" },
      });
      await notifyOwner({
        title: "Alerta: webhook no configurado",
        content: `Telegram no confirmó la configuración del webhook. Motivo: ${status}`,
      }).catch(() => false);
    }

    return { success: result.ok, status };
  }),

  operationalDefaults: adminProcedure.query(() => defaultTelegramBotSettings),
});
