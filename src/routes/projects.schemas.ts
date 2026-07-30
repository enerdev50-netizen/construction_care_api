import { z } from 'zod';
import { requiredString, nonNegativeNumber } from '../utils/validate';

const PROJECT_STATUSES = ['EN_COURS', 'TERMINE', 'SUSPENDU'] as const;
const TASK_STATUSES = ['A_FAIRE', 'EN_COURS', 'TERMINE'] as const;

export const createProjectSchema = z.object({
  name: requiredString('Le nom du chantier est obligatoire.'),
  description: z.string().optional(),
  address: z.string().optional(),
  latitude: z.coerce.number().optional().nullable(),
  longitude: z.coerce.number().optional().nullable(),
  startDate: z.coerce.date({ error: 'La date de début est obligatoire ou invalide.' }),
  endDate: z.coerce.date({ error: 'La date de fin est obligatoire ou invalide.' }),
  budget: nonNegativeNumber('Le budget doit être un nombre positif.').optional().nullable(),
  clientIds: z.array(z.string()).optional(),
});

export const updateProjectSchema = z.object({
  name: requiredString('Le nom du chantier ne peut pas être vide.').optional(),
  description: z.string().optional(),
  address: z.string().optional(),
  latitude: z.coerce.number().optional().nullable(),
  longitude: z.coerce.number().optional().nullable(),
  startDate: z.coerce.date({ error: 'Date de début invalide.' }).optional(),
  endDate: z.coerce.date({ error: 'Date de fin invalide.' }).optional(),
  status: z.enum(PROJECT_STATUSES, { error: 'Statut de chantier invalide.' }).optional(),
  budget: nonNegativeNumber('Le budget doit être un nombre positif.').optional().nullable(),
});

export const assignUsersSchema = z.object({
  userIds: z.array(z.string(), { error: 'Tableau userIds requis.' }),
});

export const taskStatusSchema = z.object({
  status: z.enum(TASK_STATUSES, { error: 'Statut de tâche invalide.' }).optional(),
  dueDate: z.coerce.date({ error: "Date d'échéance invalide." }).optional().nullable(),
});

export const createTaskSchema = z.object({
  name: requiredString('Le nom de la tâche est requis.'),
  dueDate: z.coerce.date({ error: "Date d'échéance invalide." }).optional().nullable(),
});
