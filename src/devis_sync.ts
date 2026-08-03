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
        }
      }
    });

    if (!devis || devis.type !== 'DEVIS') return;

    // Si le devis est encore EN_ATTENTE de signature, on ne touche pas à son statut
    if (devis.status === 'EN_ATTENTE') return;

    // Compter les factures liées qui ne sont pas "PAYE"
    const totalItems = devis.factures.length;
    const unpaidFacturesCount = devis.factures.filter(f => f.status !== 'PAYE').length;

    let newStatus = devis.status;

    if (totalItems > 0 && unpaidFacturesCount === 0) {
      // Si tout est payé, le devis passe à PAYE
      newStatus = 'PAYE';
    } else if (devis.status === 'PAYE' && unpaidFacturesCount > 0) {
      // Si le devis était payé mais qu'une facture n'est pas payée, il repasse à SIGNE
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
