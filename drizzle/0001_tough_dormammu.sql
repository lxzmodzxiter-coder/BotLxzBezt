CREATE TABLE `consultation_audits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` varchar(36) NOT NULL,
	`telegramUserId` varchar(32) NOT NULL,
	`documentType` enum('dni','ruc') NOT NULL,
	`documentHash` char(64) NOT NULL,
	`status` enum('requested','found','not_found','invalid_input','upstream_unavailable','denied','failed') NOT NULL DEFAULT 'requested',
	`providerCode` varchar(80),
	`providerDurationMs` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `consultation_audits_id` PRIMARY KEY(`id`),
	CONSTRAINT `consultation_audits_requestId_unique` UNIQUE(`requestId`)
);
--> statement-breakpoint
CREATE TABLE `security_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventType` enum('unauthorized_attempt','unauthorized_threshold','webhook_auth_failed','configuration_error','quota_warning','quota_reached','provider_error','processing_error') NOT NULL,
	`severity` enum('info','warning','critical') NOT NULL DEFAULT 'info',
	`telegramUserId` varchar(32),
	`details` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `security_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `telegram_authorized_users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telegramUserId` varchar(32) NOT NULL,
	`displayName` varchar(120),
	`username` varchar(120),
	`isActive` boolean NOT NULL DEFAULT true,
	`dailyLimit` int NOT NULL DEFAULT 30,
	`queriesInWindow` int NOT NULL DEFAULT 0,
	`quotaWindowStart` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `telegram_authorized_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `telegram_authorized_users_telegramUserId_unique` UNIQUE(`telegramUserId`)
);
--> statement-breakpoint
CREATE TABLE `telegram_updates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telegramUpdateId` int NOT NULL,
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	`processedAt` timestamp,
	CONSTRAINT `telegram_updates_id` PRIMARY KEY(`id`),
	CONSTRAINT `telegram_updates_telegramUpdateId_unique` UNIQUE(`telegramUpdateId`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('admin','user') NOT NULL DEFAULT 'user';--> statement-breakpoint
CREATE INDEX `consultation_audits_user_created_idx` ON `consultation_audits` (`telegramUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `consultation_audits_created_idx` ON `consultation_audits` (`createdAt`);--> statement-breakpoint
CREATE INDEX `security_events_type_user_created_idx` ON `security_events` (`eventType`,`telegramUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `security_events_created_idx` ON `security_events` (`createdAt`);--> statement-breakpoint
CREATE INDEX `telegram_authorized_users_active_idx` ON `telegram_authorized_users` (`isActive`);