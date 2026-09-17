import { z } from 'zod';

const body = z.string().trim().min(1).max(5000);

export const createCommentSchema = z.object({ body }).strict();
export const updateCommentSchema = createCommentSchema;
export const commentQuerySchema = z.object({ cursor: z.string().optional() });
