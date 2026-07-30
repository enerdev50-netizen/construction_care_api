import { z } from 'zod';
import { requiredString, nonNegativeNumber, positiveNumber } from '../utils/validate';

const DOCUMENT_TYPES = ['DEVIS', 'FACTURE'] as const;
export const DOCUMENT_STATUSES = ['EN_ATTENTE', 'SIGNE', 'PAYE_CLIENT', 'PAYE_PARTIEL', 'PAYE'] as const;

export const createDocumentSchema = z.object({
  projectId: requiredString('Le chantier est obligatoire.'),
  title: requiredString('Le titre est obligatoire.'),
  type: z.enum(DOCUMENT_TYPES, { error: 'Type de document invalide.' }),
  amount: nonNegativeNumber('Le montant doit être un nombre positif.'),
  pdfFile: z.string().optional().nullable(),
  devisId: z.string().optional().nullable(),
});

export const signDocumentSchema = z.object({
  clientSignature: requiredString('La signature client est requise.'),
});

export const documentStatusSchema = z.object({
  status: z.enum(DOCUMENT_STATUSES, { error: 'Statut invalide.' }),
  declaredPaidAmount: nonNegativeNumber('Le montant déclaré doit être un nombre positif.').optional(),
});

export const paymentAmountSchema = z.object({
  amount: positiveNumber('Le montant du versement doit être supérieur à 0.'),
});

// Contrairement à `documentStatusSchema` (route dédiée /:id/status), cette route
// générique n'imposait jusqu'ici AUCUNE énumération sur `status` — lacune fermée :
// même liste de valeurs autorisées que le cycle de vie documenté du modèle.
export const updateDocumentSchema = z.object({
  title: requiredString('Le titre ne peut pas être vide.').optional(),
  type: z.enum(DOCUMENT_TYPES, { error: 'Type de document invalide.' }).optional(),
  amount: nonNegativeNumber('Le montant doit être un nombre positif.').optional(),
  status: z.enum(DOCUMENT_STATUSES, { error: 'Statut invalide.' }).optional(),
  pdfFile: z.string().optional().nullable(),
  devisId: z.string().optional().nullable(),
});
