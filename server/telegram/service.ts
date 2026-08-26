import crypto from "crypto";
import { nanoid } from "nanoid";
import { notifyOwner } from "../_core/notification";
import {
  completeConsultationAudit,
  blockTelegramAccess,
  countSecurityEventsSince,
  createConsultationAudit,
  findAuthorizedTelegramUser,
  getActiveTelegramAccessBlock,
  getTelegramBotSettings,
  recordSecurityEvent,
  reserveDailyQuota,
} from "../db";
import { getAllowedDniFields, getAllowedRucFields, lookupApiPeru } from "./apiperu";
import { requireApiPeruToken, type TelegramRuntimeSecrets } from "./config";
import { inferDocumentType, parseDocument, type DocumentType } from "./domain";
import { shouldTemporarilyBlock, shouldWarnForQuota } from "./policies";
import { answerCallbackQuery, sendTelegramMessage } from "./telegramApi";

type TelegramUser = { id: number; first_name?: string; username?: string };
type TelegramChat = { id: number; type: string };
type TelegramMessage = { message_id: number; text?: string; from?: TelegramUser; chat: TelegramChat };
type TelegramCallback = { id: string; data?: string; from: TelegramUser; message?: { chat: TelegramChat } };
export type TelegramUpdate = { update_id: number; message?: TelegramMessage; callback_query?: TelegramCallback };

const authorizedNotice = "Uso autorizado únicamente. Las consultas se registran y están sujetas a límites de seguridad.";
const helpKeyboard = [
  [
    { text: "Consultar DNI", callback_data: "consult:dni" },
    { text: "Consultar RUC", callback_data: "consult:ruc" },
  ],
];

function hashDocument(secret: string, documentType: DocumentType, document: string) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${documentType}:${document}`)
    .digest("hex");
}

async function notifySecurity(title: string, content: string) {
  await notifyOwner({ title, content }).catch(() => false);
}

async function handleUnauthorized(chatId: string, actorId: string, secrets: TelegramRuntimeSecrets) {
  await recordSecurityEvent({
    eventType: "unauthorized_attempt",
    severity: "warning",
    telegramUserId: actorId,
    details: { channel: "telegram" },
  });
  const settings = await getTelegramBotSettings();
  const attempts = await countSecurityEventsSince(
    "unauthorized_attempt",
    actorId,
    new Date(Date.now() - settings.alertWindowMinutes * 60 * 1000),
  );
  if (shouldTemporarilyBlock(attempts, settings.unauthorizedAlertThreshold)) {
    const blockedUntil = new Date(Date.now() + settings.alertWindowMinutes * 60 * 1000);
    await blockTelegramAccess(actorId, "unauthorized_attempt_threshold", blockedUntil);
    await recordSecurityEvent({
      eventType: "temporary_blocked",
      severity: "critical",
      telegramUserId: actorId,
      details: { attempts, windowMinutes: settings.alertWindowMinutes, blockedUntil: blockedUntil.toISOString() },
    });
    await notifySecurity(
      "Alerta: acceso bloqueado temporalmente",
      `El usuario de Telegram ${actorId} alcanzó ${attempts} intentos no autorizados y fue bloqueado durante ${settings.alertWindowMinutes} minutos.`,
    );
  }
  await sendTelegramMessage(
    secrets,
    chatId,
    `Acceso no autorizado. Esta herramienta es interna y solo procesa consultas aprobadas. Tu identificador de Telegram es: ${actorId}. Solicita autorización al responsable.`,
  );
}

function formatFoundDni(data: Record<string, unknown> | undefined) {
  const fields = getAllowedDniFields(data);
  return [
    "Consulta DNI autorizada",
    fields.numero ? `DNI: ${fields.numero}` : undefined,
    fields.nombreCompleto ? `Nombre completo: ${fields.nombreCompleto}` : undefined,
    fields.codigoVerificacion ? `Código de verificación: ${fields.codigoVerificacion}` : undefined,
    "",
    authorizedNotice,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatFoundRuc(data: Record<string, unknown> | undefined) {
  const fields = getAllowedRucFields(data);
  return [
    "Consulta RUC autorizada",
    fields.ruc ? `RUC: ${fields.ruc}` : undefined,
    fields.razonSocial ? `Razón social: ${fields.razonSocial}` : undefined,
    fields.estado ? `Estado: ${fields.estado}` : undefined,
    fields.condicion ? `Condición: ${fields.condicion}` : undefined,
    fields.departamento ? `Departamento: ${fields.departamento}` : undefined,
    fields.esAgenteRetencion ? `Agente de retención: ${fields.esAgenteRetencion}` : undefined,
    fields.esBuenContribuyente ? `Buen contribuyente: ${fields.esBuenContribuyente}` : undefined,
    "",
    authorizedNotice,
  ]
    .filter(Boolean)
    .join("\n");
}

function providerErrorMessage(code: string) {
  if (code === "document_not_found") return "No se encontró un resultado para el documento indicado.";
  if (code === "invalid_input") return "El documento no cumple el formato requerido.";
  if (code === "quota_exceeded") return "El servicio proveedor alcanzó su cuota. Contacta al responsable.";
  if (code === "invalid_sol_credentials") return "El proveedor rechazó sus credenciales operativas. Se alertó al responsable.";
  if (code === "upstream_unavailable") return "El servicio de consulta no está disponible temporalmente. Intenta más tarde.";
  return "No fue posible completar la consulta en este momento.";
}

async function executeLookup(
  chatId: string,
  actorId: string,
  documentType: DocumentType,
  rawDocument: string,
  secrets: TelegramRuntimeSecrets,
) {
  const document = parseDocument(documentType, rawDocument);
  const documentHash = hashDocument(secrets.auditHashSecret, documentType, rawDocument.trim());
  if (!document) {
    await createConsultationAudit({
      requestId: nanoid(),
      telegramUserId: actorId,
      documentType,
      documentHash,
      status: "invalid_input",
    });
    await sendTelegramMessage(
      secrets,
      chatId,
      documentType === "dni"
        ? "El DNI debe contener exactamente 8 dígitos válidos."
        : "El RUC debe contener 11 dígitos y un dígito verificador válido.",
    );
    return;
  }

  const settings = await getTelegramBotSettings();
  if (!settings.isEnabled) {
    await sendTelegramMessage(secrets, chatId, "El servicio está temporalmente en mantenimiento. Intenta más tarde.");
    return;
  }

  let apiPeruToken: string;
  try {
    apiPeruToken = requireApiPeruToken(secrets);
  } catch {
    await recordSecurityEvent({
      eventType: "configuration_error",
      severity: "critical",
      telegramUserId: actorId,
      details: { component: "apiperu_consultation" },
    });
    await notifySecurity(
      "Alerta: APIperú no configurada",
      "Se recibió una consulta autorizada, pero falta el token privado de APIperú.",
    );
    await sendTelegramMessage(secrets, chatId, "Las consultas están temporalmente deshabilitadas por configuración. El responsable ya fue alertado.");
    return;
  }

  const quota = await reserveDailyQuota(actorId);
  if (!quota.allowed || !("currentCount" in quota) || !("dailyLimit" in quota)) {
    await createConsultationAudit({
      requestId: nanoid(),
      telegramUserId: actorId,
      documentType,
      documentHash,
      status: "denied",
    });
    if (quota.reason === "limit" && "currentCount" in quota && "dailyLimit" in quota) {
      await recordSecurityEvent({
        eventType: "quota_reached",
        severity: "warning",
        telegramUserId: actorId,
        details: { dailyLimit: quota.dailyLimit, currentCount: quota.currentCount },
      });
      await sendTelegramMessage(secrets, chatId, "Alcanzaste tu límite diario de consultas autorizadas.");
      return;
    }
    await sendTelegramMessage(secrets, chatId, "No fue posible validar tu autorización en este momento.");
    return;
  }

  const reservedQuota = quota as { currentCount: number; dailyLimit: number };
  if (shouldWarnForQuota(reservedQuota.currentCount, reservedQuota.dailyLimit, settings.quotaWarningPercent)) {
    await recordSecurityEvent({
      eventType: "quota_warning",
      severity: "warning",
      telegramUserId: actorId,
      details: { dailyLimit: reservedQuota.dailyLimit, currentCount: reservedQuota.currentCount },
    });
    await notifySecurity(
      "Alerta: consumo elevado",
      `El usuario de Telegram ${actorId} alcanzó ${reservedQuota.currentCount}/${reservedQuota.dailyLimit} consultas en su ventana diaria.`,
    );
  }

  const requestId = nanoid();
  await createConsultationAudit({
    requestId,
    telegramUserId: actorId,
    documentType,
    documentHash,
    status: "requested",
  });
  const result = await lookupApiPeru(documentType, document, apiPeruToken);
  const auditStatus = result.success
    ? "found"
    : result.code === "document_not_found"
      ? "not_found"
      : result.code === "invalid_input"
        ? "invalid_input"
        : result.code === "upstream_unavailable"
          ? "upstream_unavailable"
          : "failed";
  await completeConsultationAudit(requestId, auditStatus, result.code, result.durationMs);

  if (!result.success) {
    if (auditStatus === "upstream_unavailable" || auditStatus === "failed") {
      await recordSecurityEvent({
        eventType: "provider_error",
        severity: auditStatus === "failed" ? "critical" : "warning",
        telegramUserId: actorId,
        details: { providerCode: result.code },
      });
      if (auditStatus === "failed") {
        await notifySecurity(
          "Alerta: fallo de proveedor",
          `APIperú devolvió el código ${result.code} durante una consulta autorizada.`,
        );
      }
    }
    await sendTelegramMessage(secrets, chatId, providerErrorMessage(result.code));
    return;
  }

  await sendTelegramMessage(
    secrets,
    chatId,
    documentType === "dni" ? formatFoundDni(result.data) : formatFoundRuc(result.data),
  );
}

export async function processTelegramUpdate(update: TelegramUpdate, secrets: TelegramRuntimeSecrets) {
  const callback = update.callback_query;
  const message = update.message;
  const actor = callback?.from || message?.from;
  const chat = callback?.message?.chat || message?.chat;
  if (!actor || !chat) return;

  const actorId = String(actor.id);
  const chatId = String(chat.id);
  if (chat.type !== "private") {
    await sendTelegramMessage(secrets, chatId, "Por seguridad, este bot solo atiende consultas por chat privado.");
    return;
  }

  const accessBlock = await getActiveTelegramAccessBlock(actorId);
  if (accessBlock) {
    await sendTelegramMessage(
      secrets,
      chatId,
      "El acceso está temporalmente bloqueado por seguridad. Contacta al responsable si crees que se trata de un error.",
    );
    return;
  }

  const authorized = await findAuthorizedTelegramUser(actorId);
  if (!authorized) {
    await handleUnauthorized(chatId, actorId, secrets);
    return;
  }

  if (callback) {
    await answerCallbackQuery(secrets, callback.id);
    if (callback.data === "consult:dni") {
      await sendTelegramMessage(secrets, chatId, `Envía el DNI de 8 dígitos que deseas consultar.\n\n${authorizedNotice}`);
    } else if (callback.data === "consult:ruc") {
      await sendTelegramMessage(secrets, chatId, `Envía el RUC de 11 dígitos que deseas consultar.\n\n${authorizedNotice}`);
    }
    return;
  }

  const text = message?.text?.trim();
  if (!text) return;
  if (text.startsWith("/start") || text === "/help") {
    await sendTelegramMessage(
      secrets,
      chatId,
      `Bienvenido. Puedes usar /dni <8 dígitos>, /ruc <11 dígitos> o enviar un número válido.\n\n${authorizedNotice}`,
      helpKeyboard,
    );
    return;
  }

  const commandMatch = text.match(/^\/(dni|ruc)\s+(.+)$/i);
  if (commandMatch) {
    await executeLookup(chatId, actorId, commandMatch[1].toLowerCase() as DocumentType, commandMatch[2], secrets);
    return;
  }

  const inferredType = inferDocumentType(text);
  if (inferredType) {
    await executeLookup(chatId, actorId, inferredType, text, secrets);
    return;
  }

  await sendTelegramMessage(
    secrets,
    chatId,
    `Ingresa un DNI de 8 dígitos, un RUC de 11 dígitos o utiliza los comandos /dni y /ruc.\n\n${authorizedNotice}`,
    helpKeyboard,
  );
}
