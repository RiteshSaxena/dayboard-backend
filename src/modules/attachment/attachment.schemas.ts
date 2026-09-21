import { z } from 'zod';

export const createAttachmentSchema = z
  .object({
    filename: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(255),
    size: z.number().int().positive(),
  })
  .strict();
