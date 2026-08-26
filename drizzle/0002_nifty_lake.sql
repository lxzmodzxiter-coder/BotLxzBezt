CREATE TABLE `telegram_bot_settings` (
	`id` int NOT NULL,
	`isEnabled` boolean NOT NULL DEFAULT true,
	`defaultDailyLimit` int NOT NULL DEFAULT 30,
	`unauthorizedAlertThreshold` int NOT NULL DEFAULT 3,
	`alertWindowMinutes` int NOT NULL DEFAULT 15,
	`quotaWarningPercent` int NOT NULL DEFAULT 80,
	`webhookLastConfiguredAt` timestamp,
	`webhookLastStatus` varchar(120),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `telegram_bot_settings_id` PRIMARY KEY(`id`)
);
