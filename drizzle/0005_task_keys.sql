ALTER TABLE `projects` ADD `key` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `task_counter` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_org_key_unique` ON `projects` (`org_id`,`key`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `number` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `key_project_id` text(21) REFERENCES projects(id);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_key_unique` ON `tasks` (`key_project_id`,`number`);--> statement-breakpoint
-- Backfill (hand-written). Existing projects get a key built from the first letter of their name
-- plus two characters encoding their position in the org, which is unique without any randomness.
-- New projects use the generator in project.service.ts instead.
UPDATE `projects`
SET `key` = (
  SELECT
    CASE WHEN upper(substr(`projects`.`name`, 1, 1)) GLOB '[A-Z]'
      THEN upper(substr(`projects`.`name`, 1, 1)) ELSE 'P' END
    || substr('ABCDEFGHJKMNPQRSTVWXYZ23456789', 1 + (ordered.n / 30) % 30, 1)
    || substr('ABCDEFGHJKMNPQRSTVWXYZ23456789', 1 + ordered.n % 30, 1)
  FROM (
    SELECT `id`, row_number() OVER (PARTITION BY `org_id` ORDER BY `created_at`, `id`) - 1 AS n
    FROM `projects`
  ) AS ordered
  WHERE ordered.`id` = `projects`.`id`
)
WHERE `key` IS NULL;--> statement-breakpoint
-- Number every task within the project that holds it, in creation order.
UPDATE `tasks`
SET `number` = (
      SELECT ordered.n FROM (
        SELECT `id`, row_number() OVER (PARTITION BY `project_id` ORDER BY `created_at`, `id`) AS n
        FROM `tasks`
      ) AS ordered
      WHERE ordered.`id` = `tasks`.`id`
    ),
    `key_project_id` = `project_id`
WHERE `number` IS NULL;--> statement-breakpoint
-- Each project continues from its highest number.
UPDATE `projects`
SET `task_counter` = (
  SELECT coalesce(max(`number`), 0) FROM `tasks` WHERE `tasks`.`key_project_id` = `projects`.`id`
)
WHERE `task_counter` IS NULL;
