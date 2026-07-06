import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('--- PROJECTS ---');
    const projects = await prisma.project.findMany({
      include: {
        movements: {
          include: { material: true }
        },
        expenses: true
      }
    });
    for (const p of projects) {
      console.log(`Project: ${p.name} (ID: ${p.id})`);
      console.log(`Movements:`, p.movements.map(m => ({
        material: m.material.name,
        type: m.type,
        qty: m.quantity,
        reason: m.reason,
        date: m.date
      })));
      console.log(`Expenses:`, p.expenses.map(e => ({
        category: e.category,
        desc: e.description,
        amount: e.amount
      })));
      console.log('----------------');
    }

    console.log('--- MATERIALS ---');
    const materials = await prisma.material.findMany();
    console.log(materials);

  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
