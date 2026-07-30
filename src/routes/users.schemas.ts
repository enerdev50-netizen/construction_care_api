import { z } from 'zod';
import { passwordSchema, requiredString } from '../utils/validate';

// Rôles assignables par un COMPANY_ADMIN via cette route. SUPER_ADMIN et
// COMPANY_ADMIN restent hors de portée (comportement existant préservé).
const ASSIGNABLE_ROLES = ['TEAM_LEADER', 'WORKER', 'CLIENT'] as const;

export const createUserSchema = z
  .object({
    email: z.string().optional().nullable(),
    password: passwordSchema,
    firstName: requiredString('Le prénom est obligatoire.'),
    lastName: requiredString('Le nom est obligatoire.'),
    phone: z.string().optional().nullable(),
    role: z.enum(ASSIGNABLE_ROLES, { error: 'Rôle invalide.' }),
  })
  .refine((data) => (data.email && data.email.trim() !== '') || (data.phone && data.phone.trim() !== ''), {
    message: "L'adresse email ou le numéro de téléphone est obligatoire.",
    path: ['email'],
  });

export const updateUserSchema = z.object({
  email: z.string().optional().nullable(),
  firstName: requiredString('Le prénom ne peut pas être vide.').optional(),
  lastName: requiredString('Le nom ne peut pas être vide.').optional(),
  phone: z.string().optional().nullable(),
  role: z.enum(ASSIGNABLE_ROLES, { error: 'Rôle invalide.' }).optional(),
  password: passwordSchema.optional(),
});
