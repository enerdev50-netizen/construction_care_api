/**
 * Script de vérification de l'isolation multi-tenant.
 *
 * Crée deux entreprises (A et B) avec chacune un gérant, un chantier et une facture,
 * puis vérifie qu'un utilisateur de l'entreprise A ne peut PAS accéder aux données
 * de l'entreprise B via les endpoints qui étaient vulnérables. Nettoie tout à la fin.
 *
 * Prérequis : le serveur API doit tourner sur http://localhost:3005.
 * Usage : npx ts-node scripts/verify-tenant-isolation.ts
 */
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE = 'http://localhost:3005';
const TAG = 'tenant-iso-test';

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
function assert(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data: any = await res.json();
  if (!data.token) throw new Error(`Login échoué pour ${email}: ${JSON.stringify(data)}`);
  return data.token;
}

async function status(path: string, token: string, method = 'GET', body?: any): Promise<number> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.status;
}

async function main() {
  const password = 'Verify@2026';
  const hash = await bcrypt.hash(password, 10);

  // Nettoyage préalable d'un éventuel run précédent
  await cleanup();

  // --- Setup entreprise A ---
  const companyA = await prisma.company.create({ data: { name: `${TAG}-A` } });
  const adminA = await prisma.user.create({
    data: { email: `admin-a@${TAG}.com`, password: hash, firstName: 'A', lastName: 'Admin', role: 'COMPANY_ADMIN', companyId: companyA.id },
  });
  const projectA = await prisma.project.create({
    data: { name: `${TAG}-projA`, startDate: new Date(), endDate: new Date(), companyId: companyA.id },
  });
  const docA = await prisma.document.create({
    data: { projectId: projectA.id, title: `${TAG}-factA`, type: 'FACTURE', amount: 1000 },
  });

  // --- Setup entreprise B ---
  const companyB = await prisma.company.create({ data: { name: `${TAG}-B` } });
  await prisma.user.create({
    data: { email: `admin-b@${TAG}.com`, password: hash, firstName: 'B', lastName: 'Admin', role: 'COMPANY_ADMIN', companyId: companyB.id },
  });
  const projectB = await prisma.project.create({
    data: { name: `${TAG}-projB`, startDate: new Date(), endDate: new Date(), companyId: companyB.id },
  });
  const docB = await prisma.document.create({
    data: { projectId: projectB.id, title: `${TAG}-factB`, type: 'FACTURE', amount: 2000 },
  });

  void adminA;
  const tokenA = await login(`admin-a@${TAG}.com`, password);

  // --- Contrôles positifs : A accède à SES données ---
  assert('A lit son propre PDF (200)', (await status(`/documents/${docA.id}/pdf`, tokenA)) === 200, 'doit être 200');

  // --- Contrôles négatifs : A ne doit PAS accéder aux données de B (attendu 404) ---
  const pdfB = await status(`/documents/${docB.id}/pdf`, tokenA);
  assert('A NE lit PAS le PDF de B (404)', pdfB === 404, `reçu ${pdfB}`);

  const signB = await status(`/documents/${docB.id}/sign`, tokenA, 'POST', { clientSignature: 'data:image/png;base64,AAAA' });
  assert('A NE signe PAS le document de B (404)', signB === 404, `reçu ${signB}`);

  const payB = await status(`/documents/${docB.id}/client-declare-payment`, tokenA, 'POST', { amount: 100 });
  assert('A NE déclare PAS de paiement sur B (404)', payB === 404, `reçu ${payB}`);

  await cleanup();

  // --- Rapport ---
  console.log('\n=== Vérification isolation multi-tenant ===');
  let allOk = true;
  for (const c of checks) {
    console.log(`${c.ok ? '✅' : '❌'} ${c.name} — ${c.detail}`);
    if (!c.ok) allOk = false;
  }
  console.log(allOk ? '\nRÉSULTAT : TOUS LES CONTRÔLES PASSENT ✅' : '\nRÉSULTAT : ÉCHEC ❌');
  await prisma.$disconnect();
  process.exit(allOk ? 0 : 1);
}

async function cleanup() {
  // Ordre : documents → projets → users → companies (portant le tag)
  const companies = await prisma.company.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const ids = companies.map((c) => c.id);
  if (ids.length === 0) return;
  const projects = await prisma.project.findMany({ where: { companyId: { in: ids } }, select: { id: true } });
  const pids = projects.map((p) => p.id);
  if (pids.length > 0) {
    await prisma.payment.deleteMany({ where: { document: { projectId: { in: pids } } } });
    await prisma.document.deleteMany({ where: { projectId: { in: pids } } });
    await prisma.projectAssignment.deleteMany({ where: { projectId: { in: pids } } });
    await prisma.project.deleteMany({ where: { id: { in: pids } } });
  }
  await prisma.user.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.company.deleteMany({ where: { id: { in: ids } } });
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
