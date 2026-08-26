import {
  boolean,
  char,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["admin", "user"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const telegramAuthorizedUsers = mysqlTable(
  "telegram_authorized_users",
  {
    id: int("id").autoincrement().primaryKey(),
    telegramUserId: varchar("telegramUserId", { length: 32 }).notNull().unique(),
    displayName: varchar("displayName", { length: 120 }),
    username: varchar("username", { length: 120 }),
    isActive: boolean("isActive").default(true).notNull(),
    dailyLimit: int("dailyLimit").default(30).notNull(),
    queriesInWindow: int("queriesInWindow").default(0).notNull(),
    quotaWindowStart: timestamp("quotaWindowStart").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("telegram_authorized_users_active_idx").on(table.isActive),
  ],
);

export const telegramAccessBlocks = mysqlTable(
  "telegram_access_blocks",
  {
    id: int("id").autoincrement().primaryKey(),
    telegramUserId: varchar("telegramUserId", { length: 32 }).notNull().unique(),
    reason: varchar("reason", { length: 120 }).notNull(),
    blockedUntil: timestamp("blockedUntil").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("telegram_access_blocks_until_idx").on(table.blockedUntil)],
);

export const consultationAudits = mysqlTable(
  "consultation_audits",
  {
    id: int("id").autoincrement().primaryKey(),
    requestId: varchar("requestId", { length: 36 }).notNull().unique(),
    telegramUserId: varchar("telegramUserId", { length: 32 }).notNull(),
    documentType: mysqlEnum("documentType", ["dni", "ruc"]).notNull(),
    documentHash: char("documentHash", { length: 64 }).notNull(),
    status: mysqlEnum("status", [
      "requested",
      "found",
      "not_found",
      "invalid_input",
      "upstream_unavailable",
      "denied",
      "failed",
    ])
      .default("requested")
      .notNull(),
    providerCode: varchar("providerCode", { length: 80 }),
    providerDurationMs: int("providerDurationMs"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
  },
  table => [
    index("consultation_audits_user_created_idx").on(
      table.telegramUserId,
      table.createdAt,
    ),
    index("consultation_audits_created_idx").on(table.createdAt),
  ],
);

export const telegramUpdates = mysqlTable("telegram_updates", {
  id: int("id").autoincrement().primaryKey(),
  telegramUpdateId: int("telegramUpdateId").notNull().unique(),
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
  processedAt: timestamp("processedAt"),
});

export const securityEvents = mysqlTable(
  "security_events",
  {
    id: int("id").autoincrement().primaryKey(),
    eventType: mysqlEnum("eventType", [
      "unauthorized_attempt",
      "unauthorized_threshold",
      "webhook_auth_failed",
      "configuration_error",
      "quota_warning",
      "quota_reached",
      "provider_error",
      "processing_error",
      "temporary_blocked",
    ]).notNull(),
    severity: mysqlEnum("severity", ["info", "warning", "critical"])
      .default("info")
      .notNull(),
    telegramUserId: varchar("telegramUserId", { length: 32 }),
    details: json("details"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("security_events_type_user_created_idx").on(
      table.eventType,
      table.telegramUserId,
      table.createdAt,
    ),
    index("security_events_created_idx").on(table.createdAt),
  ],
);

/** Singleton row (id = 1) for non-secret operational controls. */
export const telegramBotSettings = mysqlTable("telegram_bot_settings", {
  id: int("id").primaryKey(),
  isEnabled: boolean("isEnabled").default(true).notNull(),
  defaultDailyLimit: int("defaultDailyLimit").default(30).notNull(),
  unauthorizedAlertThreshold: int("unauthorizedAlertThreshold").default(3).notNull(),
  alertWindowMinutes: int("alertWindowMinutes").default(15).notNull(),
  quotaWarningPercent: int("quotaWarningPercent").default(80).notNull(),
  webhookLastConfiguredAt: timestamp("webhookLastConfiguredAt"),
  webhookLastStatus: varchar("webhookLastStatus", { length: 120 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
