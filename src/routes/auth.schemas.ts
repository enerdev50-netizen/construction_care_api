import { z } from 'zod';
import { passwordSchema, requiredString } from '../utils/validate';

export const sendOtpSchema = z.object({
  phone: requiredString('Numéro de téléphone requis.'),
});

export const registerSchema = z.object({
  companyName: requiredString("Le nom de l'entreprise est obligatoire."),
  companyEmail: z.string().optional().nullable(),
  companyPhone: requiredString("Le téléphone de l'entreprise est obligatoire."),
  companyAddress: z.string().optional().nullable(),
  firstName: requiredString('Le prénom est obligatoire.'),
  lastName: requiredString('Le nom est obligatoire.'),
  email: requiredString("L'email est obligatoire."),
  password: passwordSchema,
  otpCode: z.string().optional().nullable(),
});

export const loginSchema = z
  .object({
    phone: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    password: requiredString('Le mot de passe est requis.'),
  })
  .refine((data) => (data.phone && data.phone.trim() !== '') || (data.email && data.email.trim() !== ''), {
    message: "Le téléphone ou l'email est requis.",
    path: ['email'],
  });

export const subscriptionSchema = z.object({
  plan: requiredString("Le forfait d'abonnement est obligatoire."),
});

export const updateCompanySchema = z.object({
  name: requiredString("Le nom de l'entreprise est obligatoire."),
  nif: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  logoFile: z.string().optional().nullable(),
});

export const updateMeSchema = z.object({
  firstName: requiredString('Le prénom et le nom sont obligatoires.'),
  lastName: requiredString('Le prénom et le nom sont obligatoires.'),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  // Le frontend n'envoie ce champ que lorsqu'un nouveau mot de passe est saisi.
  password: passwordSchema.optional(),
});
