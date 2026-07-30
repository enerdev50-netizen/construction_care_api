import { z } from 'zod';
import { requiredString, nonNegativeNumber, positiveNumber } from '../utils/validate';

const MOVEMENT_TYPES = ['ENTREE', 'SORTIE'] as const;

export const createMaterialSchema = z.object({
  name: requiredString('Le nom du matériau est obligatoire.'),
  minStockAlert: nonNegativeNumber("Le seuil d'alerte doit être un nombre positif.").optional(),
  unit: z.string().optional(),
  initialStock: nonNegativeNumber('Le stock initial doit être un nombre positif.').optional(),
});

export const movementSchema = z.object({
  materialId: requiredString('Le matériau est obligatoire.'),
  projectId: z.string().optional().nullable(),
  type: z.enum(MOVEMENT_TYPES, { error: 'Type de mouvement invalide.' }),
  // Un mouvement de 0 n'a pas de sens : strictement positif, pas seulement ≥ 0.
  quantity: positiveNumber('La quantité doit être supérieure à 0.'),
  reason: z.string().optional().nullable(),
});

export const updateMaterialSchema = z.object({
  name: requiredString('Le nom du matériau ne peut pas être vide.').optional(),
  minStockAlert: nonNegativeNumber("Le seuil d'alerte doit être un nombre positif.").optional(),
  unit: z.string().optional(),
  stock: nonNegativeNumber('Le stock doit être un nombre positif.').optional(),
});
