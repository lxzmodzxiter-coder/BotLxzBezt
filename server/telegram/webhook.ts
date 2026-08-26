import crypto from "crypto";
import type { Express, Request } from "express";
import { notifyOwner } from "../_core/notification";
import {
  claimTelegramUpdate,
  markTelegramUpdateProcessed,
  recordSecurityEvent,
} from "../db";
import { parseTelegramRuntimeSecrets, type TelegramRuntimeSecrets } from "./config";
import { isValidTelegramUpdateId } from "./policies";
import { processTelegramUpdate, type TelegramUpdate } from "./service";

export const TELEGRAM_WEBHOOK_BASE_PATH = "/api/telegram/webhook";

export function buildWebhookRouteSecret(secrets: TelegramRuntimeSecrets) {
  return crypto
    .createHmac("sha256", secrets.auditHashSecret)
    .update("telegram-webhook-route-v1")
    .digest("base64url")
    .slice(0, 32);
}

export function getTelegramWebhookPath(secrets: TelegramRuntimeSecrets) {
  return `${TELEGRAM_WEBHOOK_BASE_PATH}/${buildWebhookRouteSecret(secrets)}`;
}

export function matchesWebhookSecret(received: string | undefined, expected: string) {
  if (!received) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

function publicBaseUrl(request: Request, publicOrigin?: string) {
  if (publicOrigin) {
    const candidate = new URL(publicOrigin);
    if (candidate.protocol === "https:") return candidate.origin;
    throw new Error("The configured webhook origin must use HTTPS");
  }
  const referer = request.header("referer");
  if (referer) {
    try {
      const origin = new URL(referer);
      if (origin.protocol === "https:") return origin.origin;
    } catch {
      // Fall through to proxy headers and host checks.
    }
  }
  const forwardedProtocol = request.header("x-forwarded-proto")?.split(",")[0];
  const protocol = forwardedProtocol === "https" ? "https" : request.protocol === "https" ? "https" : "http";
  const host = request.header("x-forwarded-host")?.split(",")[0] || request.get("host");
  if (!host || !/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(host)) {
    throw new Error("A valid public host is required to configure the webhook");
  }
  return `${protocol}://${host}`;
}

export function getWebhookUrl(
  request: Request,
  secrets: TelegramRuntimeSecrets,
  publicOrigin?: string,
) {
  return `${publicBaseUrl(request, publicOrigin)}${getTelegramWebhookPath(secrets)}`;
}

async function alertOwner(title: string, content: string) {
  await notifyOwner({ title, content }).catch(() => false);
}

export function registerTelegramWebhook(app: Express) {
  app.post(`${TELEGRAM_WEBHOOK_BASE_PATH}/:routeSecret`, async (request, response) => {
    let secrets;
    try {
      secrets = parseTelegramRuntimeSecrets();
    } catch (error) {
      await recordSecurityEvent({
        eventType: "configuration_error",
        severity: "critical",
        details: { component: "telegram_webhook" },
      }).catch(() => undefined);
      await alertOwner("Alerta: configuración del bot", "Faltan o son inválidos secretos requeridos para procesar el webhook de Telegram.");
      response.status(503).json({ ok: false });
      return;
    }

    const header = request.header("x-telegram-bot-api-secret-token") || undefined;
    const routeMatches = matchesWebhookSecret(request.params.routeSecret, buildWebhookRouteSecret(secrets));
    const headerMatches = matchesWebhookSecret(header, secrets.telegramWebhookSecret);
    if (!routeMatches || !headerMatches) {
      await recordSecurityEvent({
        eventType: "webhook_auth_failed",
        severity: "critical",
        details: { component: "telegram_webhook" },
      }).catch(() => undefined);
      response.status(401).json({ ok: false });
      return;
    }

    const update = request.body as TelegramUpdate;
    if (!isValidTelegramUpdateId(update?.update_id)) {
      response.status(400).json({ ok: false });
      return;
    }

    try {
      const claimed = await claimTelegramUpdate(update.update_id);
      if (!claimed) {
        response.status(200).json({ ok: true, duplicate: true });
        return;
      }
      await processTelegramUpdate(update, secrets);
      await markTelegramUpdateProcessed(update.update_id);
      response.status(200).json({ ok: true });
    } catch {
      await recordSecurityEvent({
        eventType: "processing_error",
        severity: "critical",
        details: { component: "telegram_webhook" },
      }).catch(() => undefined);
      await alertOwner("Alerta: procesamiento del bot", "El webhook recibió una actualización, pero no pudo procesarla correctamente. Revisa la actividad interna.");
      response.status(200).json({ ok: true });
    }
  });
}
