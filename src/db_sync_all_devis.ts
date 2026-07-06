import { prisma } from './prisma';
import { syncDevisStatus } from './devis_sync';

async function run() {
  try {
    const devisList = await prisma.document.findMany({
      where: { type: 'DEVIS' }
    });
    console.log(`Synchronisation de ${devisList.length} devis...`);
    for (const devis of devisList) {
      await syncDevisStatus(devis.id);
    }
    console.log("Synchronisation terminée !");
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
