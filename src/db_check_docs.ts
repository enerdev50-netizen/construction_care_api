import { prisma } from './prisma';

async function main() {
  const docs = await prisma.document.findMany({
    include: { project: true }
  });
  console.log('ALL DOCUMENTS IN DB:', docs.map(d => ({
    id: d.id,
    title: d.title,
    type: d.type,
    amount: d.amount,
    status: d.status,
    projectId: d.projectId,
    projectName: d.project.name
  })));
}

main().catch(console.error);
