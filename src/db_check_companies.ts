import { prisma } from './prisma';

async function main() {
  const users = await prisma.user.findMany({
    include: { company: true }
  });
  console.log('USERS AND COMPANIES:', users.map(u => ({
    id: u.id,
    name: `${u.firstName} ${u.lastName}`,
    role: u.role,
    companyId: u.companyId,
    companyName: u.company?.name
  })));

  const projects = await prisma.project.findMany({
    include: { company: true }
  });
  console.log('PROJECTS AND COMPANIES:', projects.map(p => ({
    id: p.id,
    name: p.name,
    companyId: p.companyId,
    companyName: p.company?.name
  })));
}

main().catch(console.error);
