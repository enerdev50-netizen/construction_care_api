import { prisma } from '../prisma';

export interface ProjectFinancials {
  tresorerieDisponible: number;
  resteAPayer: number;
  avanceGlobale: number;
}

// Trésorerie disponible = somme des Paiements VALIDE reçus sur les documents du chantier.
// Reste à Payer = Budget du chantier - Trésorerie disponible (jamais négatif).
// Avance globale = pourcentage du Budget déjà couvert par la Trésorerie disponible.
export async function getProjectFinancials(projectId: string, budget: number | null): Promise<ProjectFinancials> {
  const result = await prisma.payment.aggregate({
    where: { document: { projectId }, status: 'VALIDE' },
    _sum: { amount: true },
  });

  const tresorerieDisponible = result._sum.amount || 0;
  const resteAPayer = budget ? Math.max(0, budget - tresorerieDisponible) : 0;
  const avanceGlobale = budget ? Math.min(100, Math.round((tresorerieDisponible / budget) * 100)) : 0;

  return { tresorerieDisponible, resteAPayer, avanceGlobale };
}
