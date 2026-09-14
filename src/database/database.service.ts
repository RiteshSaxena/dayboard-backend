import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export class DatabaseService {
  readonly db: DrizzleD1Database<typeof schema>;

  constructor(readonly binding: D1Database) {
    this.db = drizzle(binding, { schema });
  }
}
