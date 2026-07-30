import { z } from 'zod';
import { requiredString, nonNegativeNumber } from '../utils/validate';

const CATEGORIES = ['CIMENT', 'SABLE', 'TRANSPORT', 'MAIN_DOEUVRE', 'AUTRE'] as const;
const EXPENSE_STATUSES = ['EN_ATTENTE', 'PAYE_CLIENT', 'PAYE'] as const;

export const createExpenseSchema = z.object({
  projectId: requiredString('Le chantier est obligatoire.'),
  amount: nonNegativeNumber('Le montant doit être un nombre positif.'),
  category: z.enum(CATEGORIES, { error: 'Catégorie de dépense invalide.' }),
  description: requiredString('La description est obligatoire.'),
  date: z.coerce.date({ error: 'Date invalide.' }).optional(),
  beneficiaryId: z.string().optional().nullable(),
  devisId: z.string().optional().nullable(),
  receiptFile: z.string().optional().nullable(),
});

export const updateExpenseSchema = z.object({
  amount: nonNegativeNumber('Le montant doit être un nombre positif.').optional(),
  category: z.enum(CATEGORIES, { error: 'Catégorie de dépense invalide.' }).optional(),
  description: requiredString('La description ne peut pas être vide.').optional(),
  date: z.coerce.date({ error: 'Date invalide.' }).optional(),
  beneficiaryId: z.string().optional().nullable(),
  devisId: z.string().optional().nullable(),
  receiptFile: z.string().optional().nullable(),
});

export const updateExpenseStatusSchema = z.object({
  status: z.enum(EXPENSE_STATUSES, { error: 'Statut invalide.' }),
  paidAmount: nonNegativeNumber('Le montant payé doit être un nombre positif.').optional(),
});
