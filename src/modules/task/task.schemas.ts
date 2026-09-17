import { z } from 'zod';

const id = z.string().length(21);
const status = z.enum(['todo', 'doing', 'done']);
const dueDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must use YYYY-MM-DD')
  .nullable();

// `stageId` picks an exact stage; `status` (legacy) picks the project's first stage in that category.
export const createTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    description: z.string().max(2000).default(''),
    dueDate: dueDate.optional(),
    assigneeId: id.nullable().optional(),
    typeId: id.nullable().optional(),
    stageId: id.optional(),
    status: status.optional(),
  })
  .strict()
  .refine((value) => !(value.stageId && value.status), {
    message: 'Send either stageId or status, not both',
    path: ['stageId'],
  });

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    description: z.string().max(2000).optional(),
    dueDate: dueDate.optional(),
    assigneeId: id.nullable().optional(),
    typeId: id.nullable().optional(),
    projectId: id.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const moveTaskSchema = z
  .object({ stageId: id.optional(), status: status.optional() })
  .strict()
  .refine((value) => Boolean(value.stageId) !== Boolean(value.status), {
    message: 'Send either stageId or status',
    path: ['stageId'],
  });

export const taskQuerySchema = z.object({
  status: status.optional(),
  stageId: id.optional(),
  typeId: id.optional(),
  archived: z.enum(['true', 'false']).optional(),
  cursor: z.string().optional(),
});
