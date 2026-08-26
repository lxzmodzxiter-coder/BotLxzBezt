import { and, count, desc, eq, gt, gte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  consultationAudits,
  InsertUser,
  securityEvents,
  telegramAuthorizedUsers,
  telegramAccessBlocks,
  telegramBotSettings,
  telegramUpdates,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { isQuotaLimitReached } from "./telegram/policies";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId, lastSignedIn: new Date() };
  const updateSet: Record<string, unknown> = { lastSignedIn: new Date() };
  (["name", "email", "loginMethod"] as const).forEach(field => {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  });
  values.role = user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user");
  updateSet.role = values.role;
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export type AuthorizedTelegramUserInput = {
  telegramUserId: string;
  displayName?: string;
  username?: string;
  dailyLimit: number;
  isActive?: boolean;
};

export async function saveAuthorizedTelegramUser(input: AuthorizedTelegramUserInput) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");

  await db
    .insert(telegramAuthorizedUsers)
    .values({
      telegramUserId: input.telegramUserId,
      displayName: input.displayName || null,
      username: input.username?.replace(/^@/, "") || null,
      dailyLimit: input.dailyLimit,
      isActive: input.isActive ?? true,
    })
    .onDuplicateKeyUpdate({
      set: {
        displayName: input.displayName || null,
        username: input.username?.replace(/^@/, "") || null,
        dailyLimit: input.dailyLimit,
        isActive: input.isActive ?? true,
      },
    });
}

export async function listAuthorizedTelegramUsers() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(telegramAuthorizedUsers)
    .orderBy(desc(telegramAuthorizedUsers.updatedAt));
}

export async function findAuthorizedTelegramUser(telegramUserId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(telegramAuthorizedUsers)
    .where(
      and(
        eq(telegramAuthorizedUsers.telegramUserId, telegramUserId),
        eq(telegramAuthorizedUsers.isActive, true),
      ),
    )
    .limit(1);
  return result[0];
}

function utcWindowStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function reserveDailyQuota(telegramUserId: string) {
  const db = await getDb();
  if (!db) return { allowed: false, reason: "storage" as const };

  const windowStart = utcWindowStart();
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT ${telegramAuthorizedUsers.id} FROM ${telegramAuthorizedUsers} WHERE ${telegramAuthorizedUsers.telegramUserId} = ${telegramUserId} FOR UPDATE`);
    const result = await tx
      .select()
      .from(telegramAuthorizedUsers)
      .where(
        and(
          eq(telegramAuthorizedUsers.telegramUserId, telegramUserId),
          eq(telegramAuthorizedUsers.isActive, true),
        ),
      )
      .limit(1);
    const user = result[0];
    if (!user) return { allowed: false, reason: "unauthorized" as const };

    const isNewWindow = user.quotaWindowStart.getTime() < windowStart.getTime();
    const currentCount = isNewWindow ? 0 : user.queriesInWindow;
    if (isQuotaLimitReached(currentCount, user.dailyLimit)) {
      return {
        allowed: false,
        reason: "limit" as const,
        currentCount,
        dailyLimit: user.dailyLimit,
      };
    }

    const nextCount = currentCount + 1;
    await tx
      .update(telegramAuthorizedUsers)
      .set({
        queriesInWindow: nextCount,
        quotaWindowStart: isNewWindow ? windowStart : user.quotaWindowStart,
      })
      .where(eq(telegramAuthorizedUsers.id, user.id));

    return {
      allowed: true,
      currentCount: nextCount,
      dailyLimit: user.dailyLimit,
    };
  });
}

export async function claimTelegramUpdate(telegramUpdateId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");

  const existing = await db
    .select({ id: telegramUpdates.id })
    .from(telegramUpdates)
    .where(eq(telegramUpdates.telegramUpdateId, telegramUpdateId))
    .limit(1);
  if (existing[0]) return false;

  try {
    await db.insert(telegramUpdates).values({ telegramUpdateId });
    return true;
  } catch (error) {
    const racedRecord = await db
      .select({ id: telegramUpdates.id })
      .from(telegramUpdates)
      .where(eq(telegramUpdates.telegramUpdateId, telegramUpdateId))
      .limit(1);
    if (racedRecord[0]) return false;
    throw error;
  }
}

export async function markTelegramUpdateProcessed(telegramUpdateId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(telegramUpdates)
    .set({ processedAt: new Date() })
    .where(eq(telegramUpdates.telegramUpdateId, telegramUpdateId));
}

export type AuditStatus =
  | "requested"
  | "found"
  | "not_found"
  | "invalid_input"
  | "upstream_unavailable"
  | "denied"
  | "failed";

export async function createConsultationAudit(input: {
  requestId: string;
  telegramUserId: string;
  documentType: "dni" | "ruc";
  documentHash: string;
  status: AuditStatus;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.insert(consultationAudits).values(input);
}

export async function completeConsultationAudit(
  requestId: string,
  status: AuditStatus,
  providerCode?: string,
  providerDurationMs?: number,
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(consultationAudits)
    .set({ status, providerCode: providerCode || null, providerDurationMs: providerDurationMs ?? null, completedAt: new Date() })
    .where(eq(consultationAudits.requestId, requestId));
}

export type SecurityEventInput = {
  eventType:
    | "unauthorized_attempt"
    | "unauthorized_threshold"
    | "webhook_auth_failed"
    | "configuration_error"
    | "quota_warning"
    | "quota_reached"
    | "provider_error"
    | "processing_error"
    | "temporary_blocked";
  severity: "info" | "warning" | "critical";
  telegramUserId?: string;
  details?: Record<string, string | number | boolean>;
};

export async function recordSecurityEvent(input: SecurityEventInput) {
  const db = await getDb();
  if (!db) return;
  await db.insert(securityEvents).values({
    eventType: input.eventType,
    severity: input.severity,
    telegramUserId: input.telegramUserId || null,
    details: input.details || null,
  });
}

export async function countSecurityEventsSince(
  eventType: SecurityEventInput["eventType"],
  telegramUserId: string,
  since: Date,
) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .select({ total: count() })
    .from(securityEvents)
    .where(
      and(
        eq(securityEvents.eventType, eventType),
        eq(securityEvents.telegramUserId, telegramUserId),
        gte(securityEvents.createdAt, since),
      ),
    );
  return Number(result[0]?.total || 0);
}

export async function getActiveTelegramAccessBlock(telegramUserId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(telegramAccessBlocks)
    .where(
      and(
        eq(telegramAccessBlocks.telegramUserId, telegramUserId),
        gt(telegramAccessBlocks.blockedUntil, new Date()),
      ),
    )
    .limit(1);
  return result[0];
}

export async function blockTelegramAccess(
  telegramUserId: string,
  reason: string,
  blockedUntil: Date,
) {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(telegramAccessBlocks)
    .values({ telegramUserId, reason, blockedUntil })
    .onDuplicateKeyUpdate({ set: { reason, blockedUntil } });
}

export async function getDashboardMetrics() {
  const db = await getDb();
  if (!db) {
    return { authorizedUsers: 0, activeUsers: 0, todayQueries: 0, todayWarnings: 0 };
  }
  const today = utcWindowStart();
  const [authorized, active, queries, warnings] = await Promise.all([
    db.select({ total: count() }).from(telegramAuthorizedUsers),
    db.select({ total: count() }).from(telegramAuthorizedUsers).where(eq(telegramAuthorizedUsers.isActive, true)),
    db.select({ total: count() }).from(consultationAudits).where(gte(consultationAudits.createdAt, today)),
    db.select({ total: count() }).from(securityEvents).where(gte(securityEvents.createdAt, today)),
  ]);
  return {
    authorizedUsers: Number(authorized[0]?.total || 0),
    activeUsers: Number(active[0]?.total || 0),
    todayQueries: Number(queries[0]?.total || 0),
    todayWarnings: Number(warnings[0]?.total || 0),
  };
}

export async function getRecentAudits(limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      requestId: consultationAudits.requestId,
      telegramUserId: consultationAudits.telegramUserId,
      documentType: consultationAudits.documentType,
      status: consultationAudits.status,
      providerCode: consultationAudits.providerCode,
      providerDurationMs: consultationAudits.providerDurationMs,
      createdAt: consultationAudits.createdAt,
      completedAt: consultationAudits.completedAt,
      displayName: telegramAuthorizedUsers.displayName,
      username: telegramAuthorizedUsers.username,
    })
    .from(consultationAudits)
    .leftJoin(
      telegramAuthorizedUsers,
      eq(consultationAudits.telegramUserId, telegramAuthorizedUsers.telegramUserId),
    )
    .orderBy(desc(consultationAudits.createdAt))
    .limit(limit);
}

export async function getRecentSecurityEvents(limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(securityEvents).orderBy(desc(securityEvents.createdAt)).limit(limit);
}

export const defaultTelegramBotSettings = {
  isEnabled: true,
  defaultDailyLimit: 30,
  unauthorizedAlertThreshold: 3,
  alertWindowMinutes: 15,
  quotaWarningPercent: 80,
  webhookLastConfiguredAt: null,
  webhookLastStatus: null,
};

export async function getTelegramBotSettings() {
  const db = await getDb();
  if (!db) return defaultTelegramBotSettings;
  const result = await db
    .select()
    .from(telegramBotSettings)
    .where(eq(telegramBotSettings.id, 1))
    .limit(1);
  return result[0] || defaultTelegramBotSettings;
}

export type TelegramBotSettingsInput = {
  isEnabled: boolean;
  defaultDailyLimit: number;
  unauthorizedAlertThreshold: number;
  alertWindowMinutes: number;
  quotaWarningPercent: number;
};

export async function saveTelegramBotSettings(input: TelegramBotSettingsInput) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db
    .insert(telegramBotSettings)
    .values({ id: 1, ...input })
    .onDuplicateKeyUpdate({ set: input });
}

export async function recordWebhookConfiguration(status: string) {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(telegramBotSettings)
    .values({ id: 1, webhookLastConfiguredAt: new Date(), webhookLastStatus: status })
    .onDuplicateKeyUpdate({
      set: { webhookLastConfiguredAt: new Date(), webhookLastStatus: status },
    });
}
