/**
 * Primitives de validation des entrées HTTP.
 *
 * Chaque fonction renvoie la valeur normalisée ou lève une `ValidationError`
 * portant un message destiné à l'utilisateur final. Les routes traduisent
 * cette exception en réponse 400.
 */

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Entier positif ou nul. Rejette les valeurs absentes, non numériques,
 * décimales et négatives — `parseInt` seul laisserait passer `NaN` jusqu'à
 * la base de données.
 */
export function parsePositiveInt(value: unknown, field: string): number {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError(`Le champ "${field}" est obligatoire.`);
  }

  const parsed = typeof value === 'number' ? value : Number(String(value).trim());

  if (!Number.isInteger(parsed)) {
    throw new ValidationError(`Le champ "${field}" doit être un nombre entier.`);
  }
  if (parsed < 0) {
    throw new ValidationError(`Le champ "${field}" ne peut pas être négatif.`);
  }

  return parsed;
}

/** Longueur maximale de `SubscriptionConfig.planName` (VARCHAR(20) en base). */
export const PLAN_NAME_MAX_LENGTH = 20;

/**
 * Normalise un nom de forfait : sans espaces superflus, en majuscules,
 * espaces internes remplacés par des underscores (ex : « Plan Pro » → « PLAN_PRO »).
 */
export function normalizePlanName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError('Le champ "planName" est obligatoire.');
  }

  const normalized = value.trim().toUpperCase().replace(/\s+/g, '_');

  if (normalized.length > PLAN_NAME_MAX_LENGTH) {
    throw new ValidationError(
      `Le nom du forfait ne peut pas dépasser ${PLAN_NAME_MAX_LENGTH} caractères (reçu : ${normalized.length}).`
    );
  }

  return normalized;
}

/**
 * Liste de fonctionnalités d'un forfait.
 *
 * La virgule est interdite : `src/prisma.ts` sérialise ce tableau en CSV
 * (`join(',')`) et le relit via `split(',')`. Un élément contenant une virgule
 * serait scindé de façon irréversible à la relecture.
 */
export function parseFeatureList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new ValidationError('Le champ "features" doit être un tableau.');
  }

  return value.map((item, index) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new ValidationError(
        `La fonctionnalité en position ${index + 1} doit être une chaîne de caractères non vide.`
      );
    }
    const feature = item.trim();
    if (feature.includes(',')) {
      throw new ValidationError(
        `La fonctionnalité "${feature}" ne peut pas contenir de virgule.`
      );
    }
    return feature;
  });
}
