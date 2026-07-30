import { Router, Response } from 'express';
import { prisma } from '../prisma';
import { AuthenticatedRequest, authenticateToken } from '../middleware/auth';
import { uploadBase64ToS3 } from '../s3';
import { syncDevisStatus } from '../devis_sync';
import { validateBody } from '../utils/validate';
import { createExpenseSchema, updateExpenseSchema, updateExpenseStatusSchema } from './expenses.schemas';

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
          assignments: req.user?.role === 'CLIENT' ? {
            some: { userId: req.user.id }
          } : undefined,
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
router.post('/', authenticateToken as any, validateBody(createExpenseSchema), async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const { projectId, amount, category, description, date, beneficiaryId, devisId, receiptFile } = req.body;

  // Règle métier (non redondante avec la validation de forme) : une dépense ne peut pas être future.
  const expenseDate = date ?? new Date();
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (expenseDate > today) {
    return res.status(400).json({ error: 'La date de la dépense ne peut pas être dans le futur.' });
  }

  try {
    // Vérifier que le chantier appartient bien à l'entreprise
    const project = await prisma.project.findFirst({
      where: { id: projectId, companyId: companyId ?? undefined },
    });

    if (!project) {
      return res.status(404).json({ error: 'Chantier introuvable.' });
    }

    let finalReceiptUrl = null;
    if (receiptFile && receiptFile.startsWith('data:')) {
      try {
        finalReceiptUrl = await uploadBase64ToS3(receiptFile, 'receipts');
      } catch (s3Err) {
        console.warn('S3 upload error for expense receipt, falling back to base64:', s3Err);
        finalReceiptUrl = receiptFile;
      }
    }

    const expense = await prisma.expense.create({
      data: {
        projectId,
        amount,
        category,
        description,
        date: expenseDate,
        beneficiaryId: beneficiaryId || null,
        devisId: devisId || null,
        receiptUrl: finalReceiptUrl,
      },
    });

    // Créer automatiquement le document facture correspondant au statut EN_ATTENTE
    const docTitle = `Facture : ${expense.description}`;
    await prisma.document.create({
      data: {
        projectId: expense.projectId,
        title: docTitle,
        type: 'FACTURE',
        amount: expense.amount,
        paidAmount: 0,
        status: 'EN_ATTENTE',
        devisId: expense.devisId,
      }
    });

    await syncDevisStatus(expense.devisId);

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

    // Supprimer également le document FACTURE correspondant si présent
    const docTitle = `Facture : ${expense.description}`;
    await prisma.document.deleteMany({
      where: {
        projectId: expense.projectId,
        title: docTitle,
        type: 'FACTURE',
      }
    });

    await prisma.expense.delete({ where: { id: expenseId } });
    res.json({ message: 'Dépense supprimée avec succès.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la suppression de la dépense.' });
  }
});

// Modifier une dépense
router.put('/:id', authenticateToken as any, validateBody(updateExpenseSchema), async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const expenseId = req.params.id;
  const { amount, category, description, date, beneficiaryId, devisId, receiptFile } = req.body;

  try {
    const existingExpense = await prisma.expense.findFirst({
      where: {
        id: expenseId,
        project: { companyId: companyId ?? undefined },
      },
    });

    if (!existingExpense) {
      return res.status(404).json({ error: 'Dépense introuvable.' });
    }

    // Règle métier (non redondante avec la validation de forme) : une dépense ne peut pas être future.
    if (date !== undefined) {
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (date > today) {
        return res.status(400).json({ error: 'La date de la dépense ne peut pas être dans le futur.' });
      }
    }

    let finalReceiptUrl = existingExpense.receiptUrl;
    if (receiptFile && receiptFile.startsWith('data:')) {
      try {
        finalReceiptUrl = await uploadBase64ToS3(receiptFile, 'receipts');
      } catch (s3Err) {
        console.warn('S3 upload error for expense receipt, falling back to base64:', s3Err);
        finalReceiptUrl = receiptFile;
      }
    }

    const updated = await prisma.expense.update({
      where: { id: expenseId },
      data: {
        amount,
        category,
        description,
        date,
        beneficiaryId: beneficiaryId !== undefined ? (beneficiaryId || null) : undefined,
        devisId: devisId !== undefined ? (devisId || null) : undefined,
        receiptUrl: finalReceiptUrl,
      },
    });

    // Mettre à jour le document FACTURE correspondant si présent
    const oldDocTitle = `Facture : ${existingExpense.description}`;
    const newDocTitle = `Facture : ${description !== undefined ? description : existingExpense.description}`;
    await prisma.document.updateMany({
      where: {
        projectId: existingExpense.projectId,
        title: oldDocTitle,
        type: 'FACTURE',
      },
      data: {
        title: newDocTitle,
        amount,
        devisId: devisId !== undefined ? (devisId || null) : undefined,
      }
    });

    await syncDevisStatus(existingExpense.devisId);
    if (updated.devisId !== existingExpense.devisId) {
      await syncDevisStatus(updated.devisId);
    }

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la dépense.' });
  }
});

// Mettre à jour le statut d'une dépense (ex: marquer comme PAYE ou PAYE_CLIENT)
router.put('/:id/status', authenticateToken as any, validateBody(updateExpenseStatusSchema), async (req: AuthenticatedRequest, res: Response) => {
  const expenseId = req.params.id;
  const { status, paidAmount } = req.body;
  const companyId = req.user?.companyId;

  // Contrôle de Rôle : le client ne peut que déclarer son paiement, pas le valider.
  if (req.user?.role === 'CLIENT' && status === 'PAYE') {
    return res.status(403).json({ error: 'Seul le gérant peut valider le paiement.' });
  }

  try {
    const expense = await prisma.expense.findFirst({
      where: {
        id: expenseId,
        project: { companyId: companyId ?? undefined },
      },
    });

    if (!expense) {
      return res.status(404).json({ error: 'Dépense introuvable ou non autorisée.' });
    }

    const amountVal = expense.amount;
    let finalPaidAmount = 0;
    let docStatus = 'EN_ATTENTE';

    if (status === 'PAYE') {
      const valPaid = paidAmount !== undefined ? paidAmount : amountVal;
      finalPaidAmount = Math.min(valPaid, amountVal);
      docStatus = finalPaidAmount < amountVal ? 'PAYE_PARTIEL' : 'PAYE';
    } else if (status === 'PAYE_CLIENT') {
      docStatus = 'PAYE_CLIENT';
      finalPaidAmount = 0;
    } else if (status === 'EN_ATTENTE') {
      docStatus = 'EN_ATTENTE';
      finalPaidAmount = 0;
    }

    // Mettre à jour le statut de la dépense en fonction du statut du paiement (PAYE ou PAYE_PARTIEL)
    const updatedExpense = await prisma.expense.update({
      where: { id: expenseId },
      data: { status: docStatus },
    });

    // Synchronisation / Création du document facture correspondant pour la comptabilité et portail client
    const docTitle = `Facture : ${updatedExpense.description}`;
    
    // Rechercher si une facture associée existe déjà
    const existingDoc = await prisma.document.findFirst({
      where: {
        projectId: updatedExpense.projectId,
        title: docTitle,
        type: 'FACTURE',
      }
    });

    if (existingDoc) {
      await prisma.document.update({
        where: { id: existingDoc.id },
        data: {
          amount: amountVal,
          paidAmount: finalPaidAmount,
          status: docStatus,
          devisId: updatedExpense.devisId,
        }
      });
    } else {
      await prisma.document.create({
        data: {
          projectId: updatedExpense.projectId,
          title: docTitle,
          type: 'FACTURE',
          amount: amountVal,
          paidAmount: finalPaidAmount,
          status: docStatus,
          devisId: updatedExpense.devisId,
        }
      });
    }

    await syncDevisStatus(updatedExpense.devisId);

    res.json({ message: 'Statut mis à jour avec succès.', expense: updatedExpense });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du statut.' });
  }
});

export default router;
