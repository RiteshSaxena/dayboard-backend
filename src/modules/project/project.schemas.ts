import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().trim().min(1).max(32),
}).strict();

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  color: z.string().trim().min(1).max(32).optional(),
  position: z.number().int().nonnegative().optional(),
  archived: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");
