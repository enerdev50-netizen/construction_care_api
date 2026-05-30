import { Router, Response } from 'express';
import { prisma } from '../prisma';
import { AuthenticatedRequest, authenticateToken } from '../middleware/auth';

const router = Router();

// Récupérer toutes les dépenses (filtrable par chantier)
router.get('/', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const { projectId } = req.query;

  try {
    const expenses = await prisma.expense.findMany({
      where: {
        project: {
          companyId: companyId!,
          id: projectId ? String(projectId) : undefined,
        },
      },
      include: {
        project: {
          select: { name: true },
        },
      },
      orderBy: { date: 'desc' },
    });

    res.json(expenses);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des dépenses.' });
  }
});

// Ajouter une nouvelle dépense
router.post('/', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const { projectId, amount, category, description, date } = req.body;

  if (!projectId || !amount || !category || !description) {
    return res.status(400).json({ error: 'Champs obligatoires manquants.' });
  }

  if (!['CIMENT', 'SABLE', 'TRANSPORT', 'MAIN_DOEUVRE', 'AUTRE'].includes(category)) {
    return res.status(400).json({ error: 'Catégorie de dépense invalide.' });
  }

  try {
    // Vérifier que le chantier appartient bien à l'entreprise
    const project = await prisma.project.findFirst({
      where: { id: projectId, companyId: companyId ?? undefined },
    });

    if (!project) {
      return res.status(404).json({ error: 'Chantier introuvable.' });
    }

    const expense = await prisma.expense.create({
      data: {
        projectId,
        amount: parseFloat(amount),
        category,
        description,
        date: date ? new Date(date) : new Date(),
      },
    });

    res.status(201).json(expense);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création de la dépense.' });
  }
});

// Récupérer le récapitulatif financier (agrégats) pour le tableau de bord de l'entreprise
router.get('/dashboard-summary', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;

  try {
    // Dépenses par chantier
    const projectsWithExpenses = await prisma.project.findMany({
      where: { companyId: companyId! },
      select: {
        id: true,
        name: true,
        expenses: {
          select: { amount: true },
        },
      },
    });

    const projectExpensesSummary = projectsWithExpenses.map((p) => {
      const total = p.expenses.reduce((sum, e) => sum + e.amount, 0);
      return { id: p.id, projectName: p.name, totalExpenses: total };
    });

    // Dépenses par catégorie
    const allExpenses = await prisma.expense.findMany({
      where: {
        project: {
          companyId: companyId!,
        },
      },
      select: {
        amount: true,
        category: true,
      },
    });

    const categoryBreakdown: Record<string, number> = {
      CIMENT: 0,
      SABLE: 0,
      TRANSPORT: 0,
      MAIN_DOEUVRE: 0,
      AUTRE: 0,
    };

    let grandTotal = 0;
    allExpenses.forEach((exp) => {
      if (categoryBreakdown[exp.category] !== undefined) {
        categoryBreakdown[exp.category] += exp.amount;
      } else {
        categoryBreakdown.AUTRE += exp.amount;
      }
      grandTotal += exp.amount;
    });

    res.json({
      grandTotal,
      byCategory: categoryBreakdown,
      byProject: projectExpensesSummary,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du calcul du récapitulatif.' });
  }
});

// Supprimer une dépense
router.delete('/:id', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const expenseId = req.params.id;

  try {
    const expense = await prisma.expense.findFirst({
      where: {
        id: expenseId,
        project: { companyId: companyId ?? undefined },
      },
    });

    if (!expense) {
      return res.status(404).json({ error: 'Dépense introuvable.' });
    }

    await prisma.expense.delete({ where: { id: expenseId } });
    res.json({ message: 'Dépense supprimée avec succès.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la suppression de la dépense.' });
  }
});

export default router;
