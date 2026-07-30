/**
 * ⚠️ AMORÇAGE DE DÉVELOPPEMENT — DESTRUCTIF.
 *
 * Ce script VIDE 11 tables avant de créer une entreprise et des comptes de
 * démonstration. Il ne doit JAMAIS être exécuté sur une base de production.
 *
 * Pour la production, utiliser `npm run seed:prod` (`prisma/seed.prod.ts`) :
 * additif uniquement, 3 forfaits + 1 Super Administrateur.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { SYSTEM_PLANS } from '../src/bootstrap/systemPlans';

const prisma = new PrismaClient();

async function main() {
  // Garde-fou : `package.json#prisma.seed` pointe sur ce script, donc
  // `prisma migrate reset` le déclenche automatiquement. Sans ce contrôle, une
  // réinitialisation lancée par erreur avec l'environnement de production
  // viderait les données clients.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Ce script de démonstration est destructif et ne peut pas être exécuté avec ' +
        'NODE_ENV=production. Utilisez `npm run seed:prod` pour amorcer une base de production.'
    );
  }

  console.log('🌱 Début du peuplement de la base de données...');

  // Nettoyer la base de données
  await prisma.document.deleteMany();
  await prisma.materialMovement.deleteMany();
  await prisma.material.deleteMany();
  await prisma.progressPhoto.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.task.deleteMany();
  await prisma.projectAssignment.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
  await prisma.company.deleteMany();
  await prisma.subscriptionConfig.deleteMany();

  // 0. Configuration des forfaits d'abonnement — même grille qu'en production
  await prisma.subscriptionConfig.createMany({ data: SYSTEM_PLANS });

  // 1. Création d'une entreprise démo sous plan PREMIUM
  const company = await prisma.company.create({
    data: {
      name: 'Bâtisseur du Golfe S.A.',
      email: 'contact@batisseursgolfe.tg',
      phone: '+228 22 21 00 11',
      address: 'Boulevard du Mono, Lomé, Togo',
      subscriptionPlan: 'PREMIUM',
    },
  });

  console.log(`🏢 Entreprise créée : ${company.name}`);

  // 2. Hashage des mots de passe
  const hashedPassword = await bcrypt.hash('Pass@2026', 10);

  // 3. Création des utilisateurs
  const superadmin = await prisma.user.create({
    data: {
      email: 'superadmin@togo.com',
      password: hashedPassword,
      firstName: 'Super',
      lastName: 'Admin',
      phone: '+228 99 99 99 99',
      role: 'SUPER_ADMIN',
    },
  });

  const admin = await prisma.user.create({
    data: {
      email: 'admin@togo.com',
      password: hashedPassword,
      firstName: 'Koffi',
      lastName: 'Abalo',
      phone: '+228 90 12 34 56',
      role: 'COMPANY_ADMIN',
      companyId: company.id,
    },
  });

  const leader = await prisma.user.create({
    data: {
      email: 'chef@togo.com',
      password: hashedPassword,
      firstName: 'Yaovi',
      lastName: 'Mensah',
      phone: '+228 91 23 45 67',
      role: 'TEAM_LEADER',
      companyId: company.id,
    },
  });

  const worker = await prisma.user.create({
    data: {
      email: 'ouvrier@togo.com',
      password: hashedPassword,
      firstName: 'Kodjo',
      lastName: 'Dossou',
      phone: '+228 92 34 56 78',
      role: 'WORKER',
      companyId: company.id,
    },
  });

  const client = await prisma.user.create({
    data: {
      email: 'client@togo.com',
      password: hashedPassword,
      firstName: 'Afi',
      lastName: 'Johnson',
      phone: '+228 93 45 67 89',
      role: 'CLIENT',
      companyId: company.id,
    },
  });

  console.log('👥 Utilisateurs créés : SuperAdmin, Admin, Chef d\'équipe, Ouvrier, Client');

  console.log('✅ Base de données nettoyée et peuplée avec succès (Plans, Entreprise et Utilisateurs) !');
}

main()
  .catch((e: unknown) => {
    console.error(`\n❌ Peuplement interrompu : ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
