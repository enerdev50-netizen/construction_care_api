/**
 * Middleware générique de validation de `req.body` via un schéma zod (v4).
 *
 * En cas d'échec : réponse 400 au format déjà utilisé partout dans l'API
 * (`{ error: string }`), un seul message clair — jamais une liste structurée.
 * En cas de succès : `req.body` est REMPLACÉ par la sortie validée (nombres et
 * dates coercés), afin que les handlers reçoivent des types déjà corrects et
 * n'aient plus besoin de `parseFloat`/`new Date()` disséminés.
 */
import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodTypeAny, z } from 'zod';

function formatZodError(error: ZodError): string {
  // Un seul message : cohérent avec le reste de l'API, qui ne renvoie jamais
  // de liste d'erreurs structurée.
  return error.issues[0]?.message || 'Requête invalide.';
}

export function validateBody<T extends ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: formatZodError(result.error) });
    }
    req.body = result.data;
    next();
  };
}

/** Chaîne obligatoire non vide (les espaces seuls sont rejetés). */
export function requiredString(message: string) {
  return z.string({ error: message }).trim().min(1, message);
}

/** Nombre positif ou nul, tolérant aux chaînes numériques (compat. payloads existants). */
export function nonNegativeNumber(message: string) {
  return z.coerce.number({ error: message }).min(0, message);
}

/** Nombre strictement positif. */
export function positiveNumber(message: string) {
  return z.coerce.number({ error: message }).gt(0, message);
}

/** Mot de passe nouvellement défini — longueur minimale appliquée uniformément. */
export const passwordSchema = z
  .string()
  .min(6, 'Le mot de passe doit contenir au moins 6 caractères.');
