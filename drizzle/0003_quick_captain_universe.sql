CREATE TABLE `telegram_access_blocks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telegramUserId` varchar(32) NOT NULL,
	`reason` varchar(120) NOT NULL,
	`blockedUntil` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `telegram_access_blocks_id` PRIMARY KEY(`id`),
	CONSTRAINT `telegram_access_blocks_telegramUserId_unique` UNIQUE(`telegramUserId`)
);
--> statement-breakpoint
ALTER TABLE `security_events` MODIFY COLUMN `eventType` enum('unauthorized_attempt','unauthorized_threshold','webhook_auth_failed','configuration_error','quota_warning','quota_reached','provider_error','processing_error','temporary_blocked') NOT NULL;--> statement-breakpoint
CREATE INDEX `telegram_access_blocks_until_idx` ON `telegram_access_blocks` (`blockedUntil`);