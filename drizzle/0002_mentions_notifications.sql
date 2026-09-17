CREATE TABLE `comment_mentions` (
	`comment_id` text(21) NOT NULL,
	`user_id` text(21) NOT NULL,
	PRIMARY KEY(`comment_id`, `user_id`),
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comment_mentions_user_idx` ON `comment_mentions` (`user_id`);--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`user_id` text(21) PRIMARY KEY NOT NULL,
	`email_assigned` integer DEFAULT true NOT NULL,
	`email_comments` integer DEFAULT true NOT NULL,
	`email_mentions` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `activity_task_created_idx` ON `activity` (`task_id`,`created_at`);