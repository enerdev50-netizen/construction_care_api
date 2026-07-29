import { Router, Response } from 'express';
import { prisma } from '../prisma';
import { AuthenticatedRequest, authenticateToken, requireRole } from '../middleware/auth';
import {
  ValidationError,
  normalizePlanName,
  parseFeatureList,
  parsePositiveInt,
} from '../utils/validation';

const router = Router();

/** Forfaits livrés avec le produit : modifiables, mais jamais supprimables. */
const SYSTEM_PLANS = ['FREE', 'STANDARD', 'PREMIUM'];

/** Durée par défaut d'un forfait, en jours, lorsque `durationDays` n'est pas fourni. */
const DEFAULT_DURATION_DAYS = 30;

/** Toutes les routes de ce module sont réservées au Super Admin. */
router.use(authenticateToken as any, requireRole(['SUPER_ADMIN']) as any);

/**
 * Traduit une exception en réponse HTTP : 400 pour une entrée invalide,
 * 500 (journalisé) pour tout le reste.
 */
function handleError(res: Response, context: string, err: unknown): Response {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.message });
  }
  console.error(`[superadmin] ${context}`, err);
  return res.status(500).json({ error: `Erreur lors de ${context}.` });
}

/** Champs de configuration communs à la création et à la modification d'un forfait. */
function parsePlanPayload(body: any) {
  return {
    maxProjects: parsePositiveInt(body.maxProjects, 'maxProjects'),
    maxUsers: parsePositiveInt(body.maxUsers, 'maxUsers'),
    price: parsePositiveInt(body.price, 'price'),
    durationDays:
      body.durationDays !== undefined
        ? parsePositiveInt(body.durationDays, 'durationDays')
        : DEFAULT_DURATION_DAYS,
    features: parseFeatureList(body.features),
  };
}

// ─── FORFAITS ─────────────────────────────────────────────────────────────────

// Récupérer toutes les configurations de forfaits
router.get('/plans', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const plans = await prisma.subscriptionConfig.findMany({ orderBy: { price: 'asc' } });
    res.json(plans);
  } catch (err) {
    handleError(res, 'la récupération des configurations de forfaits', err);
  }
});

// Créer un nouveau forfait
router.post('/plans', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const planName = normalizePlanName(req.body.planName);
    const payload = parsePlanPayload(req.body);

    const created = await prisma.subscriptionConfig.create({
      data: { planName, ...payload, features: payload.features as any },
    });
    res.status(201).json(created);
  } catch (err: any) {
    // Contrainte d'unicité : plus fiable qu'un contrôle « lire puis écrire »,
    // qui laisserait passer deux créations concurrentes.
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'Ce forfait existe déjà.' });
    }
    handleError(res, 'la création du forfait', err);
  }
});

// Modifier la configuration d'un forfait
router.put('/plans/:name', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const planName = normalizePlanName(req.params.name);
    const payload = parsePlanPayload(req.body);

    const updated = await prisma.subscriptionConfig.update({
      where: { planName },
      data: { ...payload, features: payload.features as any },
    });
    res.json(updated);
  } catch (err: any) {
    if (err?.code === 'P2025') {
      return res.status(404).json({ error: `Forfait "${req.params.name}" introuvable.` });
    }
    handleError(res, 'la mise à jour de la configuration du forfait', err);
  }
});

// Supprimer un forfait (les forfaits système sont protégés)
router.delete('/plans/:name', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const planName = normalizePlanName(req.params.name);

    if (SYSTEM_PLANS.includes(planName)) {
      return res
        .status(403)
        .json({ error: `Le forfait "${planName}" est un forfait système et ne peut pas être supprimé.` });
    }

    // Un forfait encore attribué ne peut pas disparaître : les entreprises
    // concernées se retrouveraient sans configuration de quotas.
    const companiesUsing = await prisma.company.count({ where: { subscriptionPlan: planName } });
    if (companiesUsing > 0) {
      return res.status(409).json({
        error: `Impossible de supprimer "${planName}" : ${companiesUsing} entreprise(s) l'utilisent encore. Migrez-les d'abord vers un autre forfait.`,
      });
    }

    await prisma.subscriptionConfig.delete({ where: { planName } });
    res.json({ message: `Forfait "${planName}" supprimé avec succès.` });
  } catch (err: any) {
    if (err?.code === 'P2025') {
      return res.status(404).json({ error: `Forfait "${req.params.name}" introuvable.` });
    }
    handleError(res, 'la suppression du forfait', err);
  }
});

// ─── STATISTIQUES GLOBALES ────────────────────────────────────────────────────

// Tableau de bord du Super Admin : chiffres globaux de la plateforme
router.get('/stats', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [totalCompanies, totalUsers, totalProjects, totalExpenses, totalDocuments, companiesByPlan] =
      await Promise.all([
        prisma.company.count(),
        prisma.user.count({ where: { role: { not: 'SUPER_ADMIN' } } }),
        prisma.project.count(),
        prisma.expense.aggregate({ _sum: { amount: true } }),
        prisma.document.count(),
        prisma.company.groupBy({ by: ['subscriptionPlan'], _count: { id: true } }),
      ]);

    res.json({
      totalCompanies,
      totalUsers,
      totalProjects,
      totalExpensesAmount: totalExpenses._sum.amount || 0,
      totalDocuments,
      companiesByPlan,
    });
  } catch (err) {
    handleError(res, 'la récupération des statistiques', err);
  }
});

// ─── ENTREPRISES ──────────────────────────────────────────────────────────────

// Lister toutes les entreprises avec leurs statistiques
router.get('/companies', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companies = await prisma.company.findMany({
      include: { _count: { select: { users: true, projects: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(companies);
  } catch (err) {
    handleError(res, 'la récupération des entreprises', err);
  }
});

// Changer le forfait d'abonnement d'une entreprise (action admin)
router.put('/companies/:id/plan', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const planName = normalizePlanName(req.body.plan);

    // Validation contre les forfaits réellement configurés, et non contre une
    // liste en dur : un forfait personnalisé créé via POST /plans doit être attribuable.
    const planConfig = await prisma.subscriptionConfig.findUnique({ where: { planName } });
    if (!planConfig) {
      return res.status(400).json({ error: `Forfait "${planName}" inconnu.` });
    }

    const updated = await prisma.company.update({
      where: { id: req.params.id },
      data: { subscriptionPlan: planName },
    });
    res.json(updated);
  } catch (err: any) {
    if (err?.code === 'P2025') {
      return res.status(404).json({ error: 'Entreprise introuvable.' });
    }
    handleError(res, "la modification du forfait de l'entreprise", err);
  }
});

export default router;
