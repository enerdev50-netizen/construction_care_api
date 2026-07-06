import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
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

  // 0. Configuration des plans d'abonnement
  await prisma.subscriptionConfig.createMany({
    data: [
      {
        planName: 'FREE',
        maxProjects: 1,
        maxUsers: 3,
        price: 0,
        durationDays: 30,
        features: ['GEOLOCALISATION', 'MATERIAUX', 'DOCUMENTS', 'PDF'],
      },
      {
        planName: 'STANDARD',
        maxProjects: 10,
        maxUsers: 15,
        price: 5000,
        durationDays: 30,
        features: ['GEOLOCALISATION', 'MATERIAUX'],
      },
      {
        planName: 'PREMIUM',
        maxProjects: 9999,
        maxUsers: 9999,
        price: 15000,
        durationDays: 30,
        features: ['GEOLOCALISATION', 'MATERIAUX', 'DOCUMENTS', 'PDF'],
      },
    ],
  });

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
  const hashedPassword = await bcrypt.hash('password123', 10);

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
  .catch((e) => {
    console.error('❌ Erreur lors du peuplement de la base de données :', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
