import { z } from 'zod';

const contentRule = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object(shape)
    .strict()
    .refine((value) => {
      const title = 'title' in value && typeof value.title === 'string' ? value.title : undefined;
      const body = 'body' in value && typeof value.body === 'string' ? value.body : undefined;
      return (
        title === undefined ||
        body === undefined ||
        title.trim().length > 0 ||
        body.trim().length > 0
      );
    }, 'Title and body cannot both be empty');

export const createNoteSchema = contentRule({
  title: z.string().max(120).default(''),
  body: z.string().max(20000).default(''),
});

export const updateNoteSchema = z
  .object({
    title: z.string().max(120).optional(),
    body: z.string().max(20000).optional(),
    pinned: z.boolean().optional(),
    projectId: z.string().length(21).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const noteQuerySchema = z.object({ cursor: z.string().optional() });
