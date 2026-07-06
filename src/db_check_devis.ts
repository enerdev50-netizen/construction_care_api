import { prisma } from './prisma';

async function check() {
  try {
    const devisList = await prisma.document.findMany({
      where: { type: 'DEVIS' },
      include: {
        factures: true,
        expenses: true,
        project: true
      }
    });

    console.log(`=== Liste des Devis (${devisList.length}) ===`);
    for (const devis of devisList) {
      const unpaidFactures = devis.factures.filter(f => f.status !== 'PAYE');
      const unpaidExpenses = devis.expenses.filter(e => e.status !== 'PAYE');
      
      console.log(`\nDevis ID: ${devis.id}`);
      console.log(`Titre: ${devis.title}`);
      console.log(`Chantier: ${devis.project?.name}`);
      console.log(`Statut Devis: ${devis.status}`);
      console.log(`Factures rattachées (${devis.factures.length}):`);
      devis.factures.forEach(f => {
        console.log(`  - Facture: ${f.title}, Montant: ${f.amount}, Statut: ${f.status}`);
      });
      console.log(`Dépenses rattachées (${devis.expenses.length}):`);
      devis.expenses.forEach(e => {
        console.log(`  - Dépense: ${e.description}, Cat: ${e.category}, Montant: ${e.amount}, Statut: ${e.status}`);
      });
      console.log(`-> Nombre de factures non payées: ${unpaidFactures.length}`);
      console.log(`-> Nombre de dépenses non payées: ${unpaidExpenses.length}`);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

check();
