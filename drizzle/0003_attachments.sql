CREATE TABLE `attachments` (
	`id` text(21) PRIMARY KEY NOT NULL,
	`org_id` text(21) NOT NULL,
	`task_id` text(21) NOT NULL,
	`comment_id` text(21),
	`uploaded_by` text(21) NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`kind` text NOT NULL,
	`size` integer NOT NULL,
	`key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "attachments_kind_check" CHECK("attachments"."kind" in ('image', 'video', 'file')),
	CONSTRAINT "attachments_status_check" CHECK("attachments"."status" in ('pending', 'ready')),
	CONSTRAINT "attachments_size_check" CHECK("attachments"."size" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachments_key_unique` ON `attachments` (`key`);--> statement-breakpoint
CREATE INDEX `attachments_task_idx` ON `attachments` (`task_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `attachments_org_idx` ON `attachments` (`org_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `attachments_status_idx` ON `attachments` (`status`,`created_at`);