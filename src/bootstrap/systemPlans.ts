/**
 * Grille des forfaits d'abonnement livrés avec le produit.
 *
 * Source unique, utilisée par l'amorçage de production (`seedProduction`) et par
 * le seed de démonstration (`prisma/seed.ts`) : les deux environnements ne
 * peuvent pas diverger.
 *
 * `features` est une chaîne CSV et non un tableau. L'extension Prisma de
 * `src/prisma.ts` convertit les tableaux en CSV, mais les scripts d'amorçage
 * utilisent le client brut, sans extension : fournir directement la chaîne rend
 * la valeur correcte quel que soit le client employé.
 */
export interface SystemPlan {
  planName: string;
  maxProjects: number;
  maxUsers: number;
  price: number;
  durationDays: number;
  features: string;
}

export const SYSTEM_PLANS: SystemPlan[] = [
  {
    planName: 'FREE',
    maxProjects: 1,
    maxUsers: 3,
    price: 0,
    durationDays: 30,
    features: 'GEOLOCALISATION,MATERIAUX,DOCUMENTS,PDF',
  },
  {
    planName: 'STANDARD',
    maxProjects: 10,
    maxUsers: 15,
    price: 5000,
    durationDays: 30,
    features: 'GEOLOCALISATION,MATERIAUX',
  },
  {
    planName: 'PREMIUM',
    maxProjects: 9999,
    maxUsers: 9999,
    price: 15000,
    durationDays: 30,
    features: 'GEOLOCALISATION,MATERIAUX,DOCUMENTS,PDF',
  },
];
