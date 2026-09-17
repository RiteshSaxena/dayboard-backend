import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
};

export const users = sqliteTable(
  'users',
  {
    id: text('id', { length: 21 }).primaryKey(),
    email: text('email').notNull(),
    emailVerifiedAt: integer('email_verified_at'),
    name: text('name').notNull(),
    avatarUrl: text('avatar_url'),
    passwordHash: text('password_hash'),
    googleSub: text('google_sub'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('users_email_unique').on(table.email),
    uniqueIndex('users_google_sub_unique').on(table.googleSub),
    check('users_name_length', sql`length(${table.name}) between 1 and 60`),
  ],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id', { length: 21 }).primaryKey(),
    userId: text('user_id', { length: 21 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: integer('created_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
    index('sessions_user_id_idx').on(table.userId),
  ],
);

export const authTokens = sqliteTable(
  'auth_tokens',
  {
    id: text('id', { length: 21 }).primaryKey(),
    userId: text('user_id', { length: 21 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['verify', 'reset'] }).notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('auth_tokens_token_hash_unique').on(table.tokenHash),
    check('auth_tokens_kind_check', sql`${table.kind} in ('verify', 'reset')`),
  ],
);

export const orgs = sqliteTable(
  'orgs',
  {
    id: text('id', { length: 21 }).primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    personal: integer('personal', { mode: 'boolean' }).notNull().default(false),
    createdBy: text('created_by', { length: 21 })
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('orgs_slug_unique').on(table.slug),
    check('orgs_name_length', sql`length(${table.name}) between 1 and 60`),
    check('orgs_personal_check', sql`${table.personal} in (0, 1)`),
  ],
);

export const memberships = sqliteTable(
  'memberships',
  {
    orgId: text('org_id', { length: 21 })
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: text('user_id', { length: 21 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', {
      enum: ['owner', 'admin', 'member', 'guest'],
    }).notNull(),
    joinedAt: integer('joined_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.userId] }),
    index('memberships_user_id_idx').on(table.userId),
    check('memberships_role_check', sql`${table.role} in ('owner', 'admin', 'member', 'guest')`),
  ],
);

export const invites = sqliteTable(
  'invites',
  {
    id: text('id', { length: 21 }).primaryKey(),
    orgId: text('org_id', { length: 21 })
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role', { enum: ['admin', 'member', 'guest'] }).notNull(),
    tokenHash: text('token_hash').notNull(),
    invitedBy: text('invited_by', { length: 21 })
      .notNull()
      .references(() => users.id),
    expiresAt: integer('expires_at').notNull(),
    acceptedAt: integer('accepted_at'),
    revokedAt: integer('revoked_at'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('invites_token_hash_unique').on(table.tokenHash),
    index('invites_org_pending_idx').on(table.orgId, table.acceptedAt),
    check('invites_role_check', sql`${table.role} in ('admin', 'member', 'guest')`),
  ],
);

export const projects = sqliteTable(
  'projects',
  {
    id: text('id', { length: 21 }).primaryKey(),
    orgId: text('org_id', { length: 21 })
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull(),
    position: integer('position').notNull(),
    archivedAt: integer('archived_at'),
    createdBy: text('created_by', { length: 21 })
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (table) => [
    index('projects_org_position_idx').on(table.orgId, table.deletedAt, table.position),
    check('projects_name_length', sql`length(${table.name}) between 1 and 40`),
  ],
);

export const taskTypes = sqliteTable(
  'task_types',
  {
    id: text('id', { length: 21 }).primaryKey(),
    orgId: text('org_id', { length: 21 })
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull(),
    position: integer('position').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('task_types_org_position_idx').on(table.orgId, table.position),
    check('task_types_name_length', sql`length(${table.name}) between 1 and 30`),
  ],
);

export const projectStages = sqliteTable(
  'project_stages',
  {
    id: text('id', { length: 21 }).primaryKey(),
    projectId: text('project_id', { length: 21 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category', { enum: ['todo', 'doing', 'done'] }).notNull(),
    position: integer('position').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('project_stages_project_position_idx').on(table.projectId, table.position),
    check('project_stages_name_length', sql`length(${table.name}) between 1 and 30`),
    check('project_stages_category_check', sql`${table.category} in ('todo', 'doing', 'done')`),
  ],
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id', { length: 21 }).primaryKey(),
    projectId: text('project_id', { length: 21 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    parentId: text('parent_id', { length: 21 }).references((): AnySQLiteColumn => tasks.id, {
      onDelete: 'cascade',
    }),
    stageId: text('stage_id', { length: 21 }).references(() => projectStages.id),
    typeId: text('type_id', { length: 21 }).references(() => taskTypes.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status', { enum: ['todo', 'doing', 'done'] }).notNull(),
    assigneeId: text('assignee_id', { length: 21 }).references(() => users.id),
    dueDate: text('due_date'),
    position: integer('position').notNull(),
    createdBy: text('created_by', { length: 21 })
      .notNull()
      .references(() => users.id),
    completedAt: integer('completed_at'),
    archivedAt: integer('archived_at'),
    ...timestamps,
  },
  (table) => [
    index('tasks_project_position_idx').on(table.projectId, table.deletedAt, table.position),
    index('tasks_parent_idx').on(table.parentId, table.deletedAt),
    index('tasks_stage_idx').on(table.stageId),
    index('tasks_type_idx').on(table.typeId),
    check('tasks_title_length', sql`length(${table.title}) between 1 and 240`),
    check('tasks_description_length', sql`length(${table.description}) <= 2000`),
    check('tasks_status_check', sql`${table.status} in ('todo', 'doing', 'done')`),
    check(
      'tasks_due_date_check',
      sql`${table.dueDate} is null or ${table.dueDate} glob '????-??-??'`,
    ),
  ],
);

export const comments = sqliteTable(
  'comments',
  {
    id: text('id', { length: 21 }).primaryKey(),
    taskId: text('task_id', { length: 21 })
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: text('author_id', { length: 21 })
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    ...timestamps,
  },
  (table) => [
    index('comments_task_created_idx').on(table.taskId, table.deletedAt, table.createdAt),
    check('comments_body_length', sql`length(${table.body}) between 1 and 5000`),
  ],
);

export const notes = sqliteTable(
  'notes',
  {
    id: text('id', { length: 21 }).primaryKey(),
    projectId: text('project_id', { length: 21 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default(''),
    body: text('body').notNull().default(''),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    position: integer('position').notNull(),
    createdBy: text('created_by', { length: 21 })
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (table) => [
    index('notes_project_position_idx').on(
      table.projectId,
      table.deletedAt,
      table.pinned,
      table.position,
    ),
    check('notes_title_length', sql`length(${table.title}) <= 120`),
    check('notes_body_length', sql`length(${table.body}) <= 20000`),
    check('notes_not_empty', sql`length(${table.title}) > 0 or length(${table.body}) > 0`),
    check('notes_pinned_check', sql`${table.pinned} in (0, 1)`),
  ],
);

export const commentMentions = sqliteTable(
  'comment_mentions',
  {
    commentId: text('comment_id', { length: 21 })
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    userId: text('user_id', { length: 21 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.commentId, table.userId] }),
    index('comment_mentions_user_idx').on(table.userId),
  ],
);

export const notificationPreferences = sqliteTable('notification_preferences', {
  userId: text('user_id', { length: 21 })
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  emailAssigned: integer('email_assigned', { mode: 'boolean' }).notNull().default(true),
  emailComments: integer('email_comments', { mode: 'boolean' }).notNull().default(true),
  emailMentions: integer('email_mentions', { mode: 'boolean' }).notNull().default(true),
  updatedAt: integer('updated_at').notNull(),
});

export const activity = sqliteTable(
  'activity',
  {
    id: text('id', { length: 21 }).primaryKey(),
    orgId: text('org_id', { length: 21 })
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    projectId: text('project_id', { length: 21 }).references(() => projects.id, {
      onDelete: 'cascade',
    }),
    taskId: text('task_id', { length: 21 }).references(() => tasks.id, {
      onDelete: 'set null',
    }),
    actorId: text('actor_id', { length: 21 })
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('activity_project_created_idx').on(table.projectId, table.createdAt),
    index('activity_task_created_idx').on(table.taskId, table.createdAt),
  ],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Org = typeof orgs.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type TaskType = typeof taskTypes.$inferSelect;
export type ProjectStage = typeof projectStages.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type NotificationPreferences = typeof notificationPreferences.$inferSelect;
export type Note = typeof notes.$inferSelect;
