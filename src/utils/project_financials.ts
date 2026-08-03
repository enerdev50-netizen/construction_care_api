import { prisma } from '../prisma';

export interface ProjectFinancials {
  tresorerieDisponible: number;
  resteAPayer: number;
  avanceGlobale: number;
}

function computeFinancials(tresorerieDisponible: number, budget: number | null): ProjectFinancials {
  const resteAPayer = budget ? Math.max(0, budget - tresorerieDisponible) : 0;
  const avanceGlobale = budget ? Math.min(100, Math.round((tresorerieDisponible / budget) * 100)) : 0;
  return { tresorerieDisponible, resteAPayer, avanceGlobale };
}

// Trésorerie disponible = somme des Paiements VALIDE reçus sur les documents du chantier.
// Reste à Payer = Budget du chantier - Trésorerie disponible (jamais négatif).
// Avance globale = pourcentage du Budget déjà couvert par la Trésorerie disponible.
export async function getProjectFinancials(projectId: string, budget: number | null): Promise<ProjectFinancials> {
  const result = await prisma.payment.aggregate({
    where: { document: { projectId }, status: 'VALIDE' },
    _sum: { amount: true },
  });

  return computeFinancials(result._sum.amount || 0, budget);
}

// Version groupée pour une liste de chantiers (évite N requêtes) : une seule
// requête sur les Payment VALIDE de tous les projets demandés, agrégée en mémoire.
export async function getProjectsFinancialsBatch(
  projects: { id: string; budget: number | null }[]
): Promise<Record<string, ProjectFinancials>> {
  const projectIds = projects.map((p) => p.id);
  if (projectIds.length === 0) return {};

  const payments = await prisma.payment.findMany({
    where: { document: { projectId: { in: projectIds } }, status: 'VALIDE' },
    select: { amount: true, document: { select: { projectId: true } } },
  });

  const tresorerieByProject: Record<string, number> = {};
  for (const p of payments) {
    tresorerieByProject[p.document.projectId] = (tresorerieByProject[p.document.projectId] || 0) + p.amount;
  }

  const result: Record<string, ProjectFinancials> = {};
  for (const project of projects) {
    result[project.id] = computeFinancials(tresorerieByProject[project.id] || 0, project.budget);
  }
  return result;
}
