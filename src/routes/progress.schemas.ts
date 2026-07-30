import { z } from 'zod';
import { requiredString } from '../utils/validate';

const PHOTO_TYPES = ['AVANT', 'APRES', 'QUOTIDIEN'] as const;

export const createProgressSchema = z.object({
  projectId: requiredString('Le chantier est obligatoire.'),
  photoUrl: requiredString('La photo est obligatoire.'),
  type: z.enum(PHOTO_TYPES, { error: 'Type de photo de suivi invalide.' }),
  comment: z.string().optional().nullable(),
});
