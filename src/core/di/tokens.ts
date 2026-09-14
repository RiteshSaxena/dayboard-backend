import type { DatabaseService } from "../../database/database.service";
import type { RuntimeContext } from "../runtime/runtime-context";
import { createToken } from "./container";

export const RUNTIME_CONTEXT = createToken<RuntimeContext>("RuntimeContext");
export const DATABASE_SERVICE = createToken<DatabaseService>("DatabaseService");
