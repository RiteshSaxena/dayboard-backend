import { createToken } from "../../core/di/container";
import type { ProjectRepository } from "./project.repository";
import type { ProjectService } from "./project.service";

export const PROJECT_REPOSITORY = createToken<ProjectRepository>("ProjectRepository");
export const PROJECT_SERVICE = createToken<ProjectService>("ProjectService");
