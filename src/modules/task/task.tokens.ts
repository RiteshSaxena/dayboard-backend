import { createToken } from "../../core/di/container";
import type { TaskRepository } from "./task.repository";
import type { TaskService } from "./task.service";

export const TASK_REPOSITORY = createToken<TaskRepository>("TaskRepository");
export const TASK_SERVICE = createToken<TaskService>("TaskService");
