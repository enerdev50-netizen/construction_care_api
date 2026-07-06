import { prisma } from './prisma';

async function run() {
  console.log('=== DB Debug ===');
  const companies = await prisma.company.findMany();
  console.log('Companies:', companies);

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      companyId: true,
    }
  });
  console.log('Users:', users);
}

run().finally(async () => {
  await prisma.$disconnect();
});
