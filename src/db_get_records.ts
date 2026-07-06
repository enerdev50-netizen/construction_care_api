import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('Fetching seeded companies...');
    const companies = await prisma.company.findMany();
    console.log('Seeded Companies:', companies);

    console.log('Fetching seeded users...');
    const users = await prisma.user.findMany();
    console.log('Seeded Users:', users.map(u => ({ id: u.id, name: `${u.firstName} ${u.lastName}`, phone: u.phone, role: u.role })));

    console.log('Fetching seeded projects...');
    const projects = await prisma.project.findMany();
    console.log('Seeded Projects:', projects.map(p => ({ id: p.id, name: p.name })));
  } catch (error) {
    console.error('Error querying database records:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
