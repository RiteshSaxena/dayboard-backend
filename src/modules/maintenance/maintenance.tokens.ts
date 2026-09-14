import { createToken } from "../../core/di/container";
import type { PurgeService } from "./purge.service";

export const PURGE_SERVICE = createToken<PurgeService>("PurgeService");
