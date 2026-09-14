import { z } from 'zod';

const email = z.string().trim().email().max(254);
const password = z.string().min(8).max(128);
const turnstile = z.string().min(1).max(2048);

export const signupSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    email,
    password,
    turnstile,
  })
  .strict();

export const signinSchema = z.object({ email, password: z.string().min(1).max(128) }).strict();
export const verifySchema = z.object({ token: z.string().min(20).max(512) }).strict();
export const resetRequestSchema = z.object({ email, turnstile }).strict();
export const resetSchema = z.object({ token: z.string().min(20).max(512), password }).strict();
export const updateMeSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    avatarUrl: z.string().url().max(2048).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');
export const changePasswordSchema = z
  .object({ current: z.string().min(1).max(128), next: password })
  .strict();
