import { z } from 'zod';
import { requiredString } from '../utils/validate';

export const siteLogItemSchema = z.object({
  label: requiredString('Le libellé de la tâche est obligatoire.'),
  done: z.boolean().default(false),
});

export const upsertSiteLogSchema = z.object({
  projectId: requiredString('Le chantier est obligatoire.'),
  date: requiredString('La date est obligatoire.'),
  items: z.array(siteLogItemSchema).default([]),
});
