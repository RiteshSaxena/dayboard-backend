import { z } from 'zod';

export const updatePreferencesSchema = z
  .object({
    emailAssigned: z.boolean().optional(),
    emailComments: z.boolean().optional(),
    emailMentions: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');
