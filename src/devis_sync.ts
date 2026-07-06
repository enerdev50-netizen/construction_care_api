import { prisma } from './prisma';

export async function syncDevisStatus(devisId: string | null) {
  if (!devisId) return;

  try {
    // 1. Récupérer le devis
    const devis = await prisma.document.findUnique({
      where: { id: devisId },
      include: {
        factures: {
          select: { status: true }
        },
        expenses: {
          select: { status: true }
        }
      }
    });

    if (!devis || devis.type !== 'DEVIS') return;

    // Si le devis est encore EN_ATTENTE de signature, on ne touche pas à son statut
    if (devis.status === 'EN_ATTENTE') return;

    // Compter les factures et dépenses liées qui ne sont pas "PAYE"
    const totalItems = devis.factures.length + devis.expenses.length;
    const unpaidFacturesCount = devis.factures.filter(f => f.status !== 'PAYE').length;
    const unpaidExpensesCount = devis.expenses.filter(e => e.status !== 'PAYE').length;
    const totalUnpaid = unpaidFacturesCount + unpaidExpensesCount;

    let newStatus = devis.status;

    if (totalItems > 0 && totalUnpaid === 0) {
      // Si tout est payé, le devis passe à PAYE
      newStatus = 'PAYE';
    } else if (devis.status === 'PAYE' && totalUnpaid > 0) {
      // Si le devis était payé mais qu'un élément n'est pas payé, il repasse à SIGNE
      newStatus = 'SIGNE';
    }

    if (newStatus !== devis.status) {
      await prisma.document.update({
        where: { id: devisId },
        data: { status: newStatus }
      });
      console.log(`[DEVIS_SYNC] Le statut du Devis ${devisId} est passé de ${devis.status} à ${newStatus}`);
    }
  } catch (err) {
    console.error(`[DEVIS_SYNC] Erreur lors de la synchronisation du devis ${devisId}:`, err);
  }
}

export async function syncExpenseFromDocument(documentId: string) {
  try {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document || document.type !== 'FACTURE') return;

    // Supprimer le préfixe "Facture : " pour retrouver la description de la dépense
    const expenseDescription = document.title.replace(/^Facture : /, '');

    const expense = await prisma.expense.findFirst({
      where: {
        projectId: document.projectId,
        description: expenseDescription,
      },
    });

    if (expense) {
      await prisma.expense.update({
        where: { id: expense.id },
        data: { status: document.status },
      });
      console.log(`[EXPENSE_SYNC] Statut de la dépense ${expense.id} synchronisé avec le document : ${document.status}`);
    }
  } catch (err) {
    console.error(`[EXPENSE_SYNC] Erreur lors de la synchronisation de la dépense depuis le document ${documentId}:`, err);
  }
}
