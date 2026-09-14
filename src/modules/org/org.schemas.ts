import { z } from "zod";

export const createOrgSchema = z.object({ name: z.string().trim().min(1).max(60) }).strict();
export const updateOrgSchema = createOrgSchema;
export const updateMemberSchema = z.object({ role: z.enum(["admin", "member", "guest"]) }).strict();
export const transferOrgSchema = z.object({ userId: z.string().length(21) }).strict();
export const createInviteSchema = z.object({
  email: z.string().trim().email().max(254),
  role: z.enum(["admin", "member", "guest"]),
}).strict();
