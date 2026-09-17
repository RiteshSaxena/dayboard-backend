import { z } from 'zod';

const name = z.string().trim().min(1).max(30);
const color = z.string().trim().min(1).max(32);

export const createTaskTypeSchema = z.object({ name, color }).strict();

export const updateTaskTypeSchema = z
  .object({ name: name.optional(), color: color.optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const reorderTaskTypesSchema = z
  .object({ taskTypeIds: z.array(z.string().length(21)).min(1).max(50) })
  .strict();
