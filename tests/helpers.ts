import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../src/app';
import { prisma } from '../src/prisma';

export const TAG = 'vitest-iso';
export const TEST_PASSWORD = 'Vitest@2026';

export interface Tenant {
  companyId: string;
  adminEmail: string;
  token: string;
  projectId: string;
  documentId: string;
}

// Supprime toutes les données de test taguées (entreprises dont le nom commence par TAG)
export async function cleanupTestData(): Promise<void> {
  const companies = await prisma.company.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = companies.map((c) => c.id);
  if (ids.length === 0) return;

  const projects = await prisma.project.findMany({
    where: { companyId: { in: ids } },
    select: { id: true },
  });
  const pids = projects.map((p) => p.id);
  if (pids.length > 0) {
    await prisma.payment.deleteMany({ where: { document: { projectId: { in: pids } } } });
    await prisma.task.deleteMany({ where: { projectId: { in: pids } } });
    await prisma.document.deleteMany({ where: { projectId: { in: pids } } });
    await prisma.projectAssignment.deleteMany({ where: { projectId: { in: pids } } });
    await prisma.project.deleteMany({ where: { id: { in: pids } } });
  }
  await prisma.user.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.company.deleteMany({ where: { id: { in: ids } } });
}

// Garantit la présence des forfaits système, données de référence attendues par l'API
// (quotas d'abonnement, attribution d'un forfait à une entreprise). Idempotent.
export async function ensureSystemPlans(): Promise<void> {
  const plans = [
    { planName: 'FREE', maxProjects: 1, maxUsers: 3, price: 0 },
    { planName: 'STANDARD', maxProjects: 10, maxUsers: 15, price: 5000 },
    { planName: 'PREMIUM', maxProjects: 9999, maxUsers: 9999, price: 15000 },
  ];

  for (const plan of plans) {
    await prisma.subscriptionConfig.upsert({
      where: { planName: plan.planName },
      update: {},
      create: { ...plan, durationDays: 30, features: 'GEOLOCALISATION,MATERIAUX' },
    });
  }
}

// Crée une entreprise complète (gérant + chantier + facture) et retourne un token de connexion réel
export async function createTenant(suffix: string): Promise<Tenant> {
  const hash = await bcrypt.hash(TEST_PASSWORD, 10);
  const adminEmail = `${TAG}-${suffix}-admin@test.com`;

  // PREMIUM pour ne pas buter sur la limite de chantiers du plan FREE pendant les tests
  const company = await prisma.company.create({ data: { name: `${TAG}-${suffix}`, subscriptionPlan: 'PREMIUM' } });
  await prisma.user.create({
    data: {
      email: adminEmail,
      password: hash,
      firstName: suffix,
      lastName: 'Admin',
      role: 'COMPANY_ADMIN',
      companyId: company.id,
    },
  });
  const project = await prisma.project.create({
    data: { name: `${TAG}-${suffix}-proj`, startDate: new Date(), endDate: new Date(), companyId: company.id },
  });
  const doc = await prisma.document.create({
    data: { projectId: project.id, title: `${TAG}-${suffix}-fact`, type: 'FACTURE', amount: 1000 },
  });

  const res = await request(app).post('/auth/login').send({ email: adminEmail, password: TEST_PASSWORD });

  return {
    companyId: company.id,
    adminEmail,
    token: res.body.token,
    projectId: project.id,
    documentId: doc.id,
  };
}

export { app, prisma, request };
