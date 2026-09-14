import { createToken } from "../../core/di/container";
import type { ActivityRepository } from "./activity.repository";
import type { ActivityService } from "./activity.service";

export const ACTIVITY_REPOSITORY = createToken<ActivityRepository>("ActivityRepository");
export const ACTIVITY_SERVICE = createToken<ActivityService>("ActivityService");
