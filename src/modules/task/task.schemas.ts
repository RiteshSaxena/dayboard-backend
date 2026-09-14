import { z } from 'zod';

const dueDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must use YYYY-MM-DD')
  .nullable();

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    description: z.string().max(2000).default(''),
    dueDate: dueDate.optional(),
    assigneeId: z.string().length(21).nullable().optional(),
    status: z.enum(['todo', 'doing', 'done']).default('todo'),
  })
  .strict();

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    description: z.string().max(2000).optional(),
    dueDate: dueDate.optional(),
    assigneeId: z.string().length(21).nullable().optional(),
    projectId: z.string().length(21).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const moveTaskSchema = z.object({ status: z.enum(['todo', 'doing', 'done']) }).strict();

export const taskQuerySchema = z.object({
  status: z.enum(['todo', 'doing', 'done']).optional(),
  archived: z.enum(['true', 'false']).optional(),
  cursor: z.string().optional(),
});
