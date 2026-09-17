CREATE TABLE `comments` (
	`id` text(21) PRIMARY KEY NOT NULL,
	`task_id` text(21) NOT NULL,
	`author_id` text(21) NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "comments_body_length" CHECK(length("comments"."body") between 1 and 5000)
);
--> statement-breakpoint
CREATE INDEX `comments_task_created_idx` ON `comments` (`task_id`,`deleted_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `project_stages` (
	`id` text(21) PRIMARY KEY NOT NULL,
	`project_id` text(21) NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_stages_name_length" CHECK(length("project_stages"."name") between 1 and 30),
	CONSTRAINT "project_stages_category_check" CHECK("project_stages"."category" in ('todo', 'doing', 'done'))
);
--> statement-breakpoint
CREATE INDEX `project_stages_project_position_idx` ON `project_stages` (`project_id`,`position`);--> statement-breakpoint
CREATE TABLE `task_types` (
	`id` text(21) PRIMARY KEY NOT NULL,
	`org_id` text(21) NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "task_types_name_length" CHECK(length("task_types"."name") between 1 and 30)
);
--> statement-breakpoint
CREATE INDEX `task_types_org_position_idx` ON `task_types` (`org_id`,`position`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `parent_id` text(21) REFERENCES tasks(id) ON UPDATE no action ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `tasks` ADD `stage_id` text(21) REFERENCES project_stages(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `type_id` text(21) REFERENCES task_types(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
CREATE INDEX `tasks_parent_idx` ON `tasks` (`parent_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `tasks_stage_idx` ON `tasks` (`stage_id`);--> statement-breakpoint
CREATE INDEX `tasks_type_idx` ON `tasks` (`type_id`);--> statement-breakpoint
-- Backfill (hand-written; drizzle-kit does not generate data migrations). Keep the starter values
-- in sync with buildStarterStages and buildStarterTaskTypes.
-- 1. Give every existing project the starter stages.
INSERT INTO `project_stages` (`id`, `project_id`, `name`, `category`, `position`, `created_at`, `updated_at`)
SELECT
	substr(lower(hex(randomblob(11))), 1, 21),
	`projects`.`id`,
	`defaults`.`name`,
	`defaults`.`category`,
	`defaults`.`position`,
	CAST(strftime('%s', 'now') AS integer) * 1000,
	CAST(strftime('%s', 'now') AS integer) * 1000
FROM `projects`
CROSS JOIN (
	SELECT 'To do' AS `name`, 'todo' AS `category`, 0 AS `position`
	UNION ALL SELECT 'In progress', 'doing', 1
	UNION ALL SELECT 'Done', 'done', 2
) AS `defaults`;--> statement-breakpoint
-- 2. Place each task in its project's stage matching the task's status.
UPDATE `tasks` SET `stage_id` = (
	SELECT `project_stages`.`id` FROM `project_stages`
	WHERE `project_stages`.`project_id` = `tasks`.`project_id`
		AND `project_stages`.`category` = `tasks`.`status`
);--> statement-breakpoint
-- 3. Give every existing org the starter task types.
INSERT INTO `task_types` (`id`, `org_id`, `name`, `color`, `position`, `created_at`, `updated_at`)
SELECT
	substr(lower(hex(randomblob(11))), 1, 21),
	`orgs`.`id`,
	`starter`.`name`,
	`starter`.`color`,
	`starter`.`position`,
	CAST(strftime('%s', 'now') AS integer) * 1000,
	CAST(strftime('%s', 'now') AS integer) * 1000
FROM `orgs`
CROSS JOIN (
	SELECT 'Task' AS `name`, '#7788ad' AS `color`, 0 AS `position`
	UNION ALL SELECT 'Bug', '#bc6b73', 1
	UNION ALL SELECT 'Feature', '#617a59', 2
	UNION ALL SELECT 'Story', '#57534e', 3
) AS `starter`;
