import { z } from 'zod';

const name = z.string().trim().min(1).max(30);
const category = z.enum(['todo', 'doing', 'done']);

export const createStageSchema = z.object({ name, category }).strict();

export const updateStageSchema = z
  .object({ name: name.optional(), category: category.optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const reorderStagesSchema = z
  .object({ stageIds: z.array(z.string().length(21)).min(1).max(20) })
  .strict();

export const deleteStageQuerySchema = z.object({ moveTo: z.string().length(21).optional() });
