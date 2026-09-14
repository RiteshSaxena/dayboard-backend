import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';

export type DrizzleDB = DrizzleD1Database<typeof schema> & {
  readonly binding: D1Database;
};

export const createDatabase = (binding: D1Database): DrizzleDB =>
  Object.assign(drizzle(binding, { schema }), { binding });
