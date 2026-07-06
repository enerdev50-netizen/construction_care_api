import { Router, Response } from 'express';
import { prisma } from '../prisma';
import { AuthenticatedRequest, authenticateToken, requireRole } from '../middleware/auth';

const router = Router();

// ─── PLANS ────────────────────────────────────────────────────────────────────

// Récupérer toutes les configurations de plans
router.get('/plans', authenticateToken as any, requireRole(['SUPER_ADMIN']) as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const plans = await prisma.subscriptionConfig.findMany({
      orderBy: { price: 'asc' },
    });
    res.json(plans);
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la récupération des configurations de plans.' });
  }
});

// Créer un nouveau plan
router.post('/plans', authenticateToken as any, requireRole(['SUPER_ADMIN']) as any, async (req: AuthenticatedRequest, res: Response) => {
  const { planName, maxProjects, maxUsers, price, durationDays, features } = req.body;

  if (!planName || maxProjects === undefined || maxUsers === undefined || price === undefined || !Array.isArray(features)) {
    return res.status(400).json({ error: 'Paramètres planName, maxProjects, maxUsers, price et features (array) requis.' });
  }

  const normalizedName = planName.trim().toUpperCase().replace(/\s+/g, '_');

  try {
    const existing = await prisma.subscriptionConfig.findUnique({ where: { planName: normalizedName } });
    if (existing) {
      return res.status(409).json({ error: `Le plan "${normalizedName}" existe déjà.` });
    }

    const created = await prisma.subscriptionConfig.create({
      data: {
        planName: normalizedName,
        maxProjects: parseInt(maxProjects),
        maxUsers: parseInt(maxUsers),
        price: parseInt(price),
        durationDays: durationDays !== undefined ? parseInt(durationDays) : 30,
        features: features as any,
      },
    });
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la création du plan.' });
  }
});

// Modifier la configuration d'un plan
router.put('/plans/:name', authenticateToken as any, requireRole(['SUPER_ADMIN']) as any, async (req: AuthenticatedRequest, res: Response) => {
  const planName = req.params.name.toUpperCase();
  const { maxProjects, maxUsers, price, durationDays, features } = req.body;

  if (maxProjects === undefined || maxUsers === undefined || price === undefined || !Array.isArray(features)) {
    return res.status(400).json({ error: 'Paramètres maxProjects, maxUsers, price et features (array) requis.' });
  }

  try {
    const updated = await prisma.subscriptionConfig.update({
      where: { planName },
      data: {
        maxProjects: parseInt(maxProjects),
        maxUsers: parseInt(maxUsers),
        price: parseInt(price),
        durationDays: durationDays !== undefined ? parseInt(durationDays) : 30,
        features: features as any,
      },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la configuration du plan.' });
  }
});

// Supprimer un plan (protection des plans système)
router.delete('/plans/:name', authenticateToken as any, requireRole(['SUPER_ADMIN']) as any, async (req: AuthenticatedRequest, res: Response) => {
  const planName = req.params.name.toUpperCase();
  const SYSTEM_PLANS = ['FREE', 'STANDARD', 'PREMIUM'];

  if (SYSTEM_PLANS.includes(planName)) {
    return res.status(403).json({ error: `Le plan "${planName}" est un plan système et ne peut pas être supprimé.` });
  }

  try {
    // Vérifier qu'aucune entreprise n'utilise ce plan
    const companiesUsing = await prisma.company.count({ where: { subscriptionPlan: planName } });
    if (companiesUsing > 0) {
      return res.status(409).json({
        error: `Impossible de supprimer "${planName}" : ${companiesUsing} entreprise(s) l'utilisent encore. Migrez-les d'abord vers un autre plan.`,
      });
    }

    await prisma.subscriptionConfig.delete({ where: { planName } });
    res.json({ message: `Plan "${planName}" supprimé avec succès.` });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: `Plan "${planName}" introuvable.` });
    }
    res.status(500).json({ error: 'Erreur lors de la suppression du plan.' });
  }
});

// ─── STATISTIQUES GLOBALES ────────────────────────────────────────────────────


// Tableau de bord du Super Admin : chiffres globaux de la plateforme
router.get('/stats', authenticateToken as any, requireRole(['SUPER_ADMIN']) as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [
      totalCompanies,
      totalUsers,
      totalProjects,
      totalExpenses,
      totalDocuments,
      companiesByPlan,
    ] = await Promise.all([
      prisma.company.count(),
      prisma.user.count({ where: { role: { not: 'SUPER_ADMIN' } } }),
      prisma.project.count(),
      prisma.expense.aggregate({ _sum: { amount: true } }),
      prisma.document.count(),
      prisma.company.groupBy({
        by: ['subscriptionPlan'],
        _count: { id: true },
      }),
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
    res.status(500).json({ error: 'Erreur lors de la récupération des statistiques.' });
  }
});

// ─── ENTREPRISES ──────────────────────────────────────────────────────────────

// Lister toutes les entreprises avec leurs stats
router.get('/companies', authenticateToken as any, requireRole(['SUPER_ADMIN']) as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companies = await prisma.company.findMany({
      include: {
        _count: {
          select: {
            users: true,
            projects: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(companies);
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la récupération des entreprises.' });
  }
});

// Changer le plan d'abonnement d'une entreprise (action admin)
router.put('/companies/:id/plan', authenticateToken as any, requireRole(['SUPER_ADMIN']) as any, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { plan } = req.body;

  if (!['FREE', 'STANDARD', 'PREMIUM'].includes(plan)) {
    return res.status(400).json({ error: 'Plan invalide.' });
  }

  try {
    const updated = await prisma.company.update({
      where: { id },
      data: { subscriptionPlan: plan },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la modification du plan de l\'entreprise.' });
  }
});

export default router;
