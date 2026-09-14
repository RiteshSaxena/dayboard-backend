CREATE TABLE `activity` (
	`id` text(21) PRIMARY KEY NOT NULL,
	`org_id` text(21) NOT NULL,
	`project_id` text(21),
	`task_id` text(21),
	`actor_id` text(21) NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activity_project_created_idx` ON `activity` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`id` text(21) PRIMARY KEY NOT NULL,
	`user_id` text(21) NOT NULL,
	`kind` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "auth_tokens_kind_check" CHECK("auth_tokens"."kind" in ('verify', 'reset'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_tokens_token_hash_unique` ON `auth_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text(21) PRIMARY KEY NOT NULL,
	`org_id` text(21) NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by` text(21) NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invites_role_check" CHECK("invites"."role" in ('admin', 'member', 'guest'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_hash_unique` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invites_org_pending_idx` ON `invites` (`org_id`,`accepted_at`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`org_id` text(21) NOT NULL,
	`user_id` text(21) NOT NULL,
	`role` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`org_id`, `user_id`),
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memberships_role_check" CHECK("memberships"."role" in ('owner', 'admin', 'member', 'guest'))
);
--> statement-breakpoint
CREATE INDEX `memberships_user_id_idx` ON `memberships` (`user_id`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text(21) PRIMARY KEY NOT NULL,
	`project_id` text(21) NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	`created_by` text(21) NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notes_title_length" CHECK(length("notes"."title") <= 120),
	CONSTRAINT "notes_body_length" CHECK(length("notes"."body") <= 20000),
	CONSTRAINT "notes_not_empty" CHECK(length("notes"."title") > 0 or length("notes"."body") > 0),
	CONSTRAINT "notes_pinned_check" CHECK("notes"."pinned" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `notes_project_position_idx` ON `notes` (`project_id`,`deleted_at`,`pinned`,`position`);--> statement-breakpoint
CREATE TABLE `orgs` (
	`id` text(21) PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`personal` integer DEFAULT false NOT NULL,
	`created_by` text(21) NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "orgs_name_length" CHECK(length("orgs"."name") between 1 and 60),
	CONSTRAINT "orgs_personal_check" CHECK("orgs"."personal" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orgs_slug_unique` ON `orgs` (`slug`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text(21) PRIMARY KEY NOT NULL,
	`org_id` text(21) NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`position` integer NOT NULL,
	`archived_at` integer,
	`created_by` text(21) NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "projects_name_length" CHECK(length("projects"."name") between 1 and 40)
);
--> statement-breakpoint
CREATE INDEX `projects_org_position_idx` ON `projects` (`org_id`,`deleted_at`,`position`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text(21) PRIMARY KEY NOT NULL,
	`user_id` text(21) NOT NULL,
	`token_hash` text NOT NULL,
	`user_agent` text,
	`ip` text,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text(21) PRIMARY KEY NOT NULL,
	`project_id` text(21) NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`assignee_id` text(21),
	`due_date` text,
	`position` integer NOT NULL,
	`created_by` text(21) NOT NULL,
	`completed_at` integer,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tasks_title_length" CHECK(length("tasks"."title") between 1 and 240),
	CONSTRAINT "tasks_description_length" CHECK(length("tasks"."description") <= 2000),
	CONSTRAINT "tasks_status_check" CHECK("tasks"."status" in ('todo', 'doing', 'done')),
	CONSTRAINT "tasks_due_date_check" CHECK("tasks"."due_date" is null or "tasks"."due_date" glob '????-??-??')
);
--> statement-breakpoint
CREATE INDEX `tasks_project_position_idx` ON `tasks` (`project_id`,`deleted_at`,`position`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text(21) PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`email_verified_at` integer,
	`name` text NOT NULL,
	`avatar_url` text,
	`password_hash` text,
	`google_sub` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "users_name_length" CHECK(length("users"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_sub_unique` ON `users` (`google_sub`);