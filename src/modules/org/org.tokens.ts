import { createToken } from "../../core/di/container";
import type { OrgRepository } from "./org.repository";
import type { OrgService } from "./org.service";

export const ORG_REPOSITORY = createToken<OrgRepository>("OrgRepository");
export const ORG_SERVICE = createToken<OrgService>("OrgService");
