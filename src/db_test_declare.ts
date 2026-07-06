import { prisma } from './prisma';

async function test() {
  const documentId = 'f4d62882-9433-4777-bf6e-24dae6ad8432';
  const userId = 'bb3a36f5-7d70-4ff5-8fe7-c529b43d17b0';
  const amount = 50000;

  try {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: { project: { include: { assignments: { where: { userId: userId! } } } } },
    });

    console.log('Document fetched:', document);

    if (!document) {
      console.log('Error: Document introuvable.');
      return;
    }

    const isManager = false; // Simulating Client role
    const isAssigned = document.project.assignments.length > 0;
    console.log('isManager:', isManager, 'isAssigned:', isAssigned);

    if (!isManager && !isAssigned) {
      console.log('Error: Vous n\'êtes pas autorisé à accéder à cette facture.');
      return;
    }

    if (document.type !== 'FACTURE') {
      console.log('Error: Les paiements ne peuvent être déclarés que sur des factures.');
      return;
    }

    if (document.status === 'PAYE') {
      console.log('Error: Cette facture est déjà entièrement réglée.');
      return;
    }

    // Empêcher une nouvelle déclaration si une est déjà en attente
    if (document.status === 'PAYE_CLIENT') {
      console.log('Error: Un versement est déjà en attente de validation par le gérant.');
      return;
    }

    const remaining = document.amount - (document.paidAmount || 0);
    const declaredAmount = Math.min(amount, remaining);
    console.log('Remaining:', remaining, 'Declared:', declaredAmount);

    const updatedDocument = await prisma.document.update({
      where: { id: documentId },
      data: {
        status: 'PAYE_CLIENT',
        declaredPaidAmount: declaredAmount,
      },
    });

    console.log('SUCCESS updated doc:', updatedDocument);
  } catch (err) {
    console.error('CATCH ERROR:', err);
  } finally {
    await prisma.$disconnect();
  }
}

test();
