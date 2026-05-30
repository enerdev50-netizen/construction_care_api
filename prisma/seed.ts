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

  console.log('👥 Utilisateurs créés : Admin, Chef d\'équipe, Ouvrier, Client');

  // 4. Création des matériaux (inventaire)
  const ciment = await prisma.material.create({
    data: {
      companyId: company.id,
      name: 'Ciment CPJ45',
      stock: 45, // suffisant
      minStockAlert: 10,
      unit: 'sacs',
    },
  });

  const sable = await prisma.material.create({
    data: {
      companyId: company.id,
      name: 'Sable fin de mer',
      stock: 12, // suffisant
      minStockAlert: 5,
      unit: 'tonnes',
    },
  });

  const gravier = await prisma.material.create({
    data: {
      companyId: company.id,
      name: 'Gravier 15/25 concassé',
      stock: 3, // ALERTE RUPTURE (3 <= 5)
      minStockAlert: 5,
      unit: 'tonnes',
    },
  });

  console.log('🏗️ Inventaire matériel créé (Ciment, Sable, Gravier en alerte)');

  // 5. Création du Chantier de démo
  const project = await prisma.project.create({
    data: {
      companyId: company.id,
      name: 'Villa Résidentielle Baguida',
      description: 'Construction d\'une villa moderne R+1 avec piscine à Baguida Plage.',
      address: 'Baguida Plage, Lomé, Togo',
      latitude: 6.1628,
      longitude: 1.3283,
      startDate: new Date(),
      endDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000), // dans 6 mois
      status: 'EN_COURS',
    },
  });

  console.log(`🚧 Chantier créé : ${project.name}`);

  // 6. Affectations au chantier
  await prisma.projectAssignment.createMany({
    data: [
      { projectId: project.id, userId: leader.id },
      { projectId: project.id, userId: worker.id },
      { projectId: project.id, userId: client.id },
    ],
  });

  // 7. Création des tâches pour ce chantier
  await prisma.task.createMany({
    data: [
      { projectId: project.id, name: 'Fondations', status: 'TERMINE', dueDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
      { projectId: project.id, name: 'Élévation', status: 'EN_COURS', dueDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000) },
      { projectId: project.id, name: 'Toiture', status: 'A_FAIRE', dueDate: new Date(Date.now() + 50 * 24 * 60 * 60 * 1000) },
      { projectId: project.id, name: 'Électricité', status: 'A_FAIRE', dueDate: new Date(Date.now() + 80 * 24 * 60 * 60 * 1000) },
      { projectId: project.id, name: 'Plomberie', status: 'A_FAIRE', dueDate: new Date(Date.now() + 100 * 24 * 60 * 60 * 1000) },
    ],
  });

  // 8. Création des dépenses pour ce chantier
  await prisma.expense.createMany({
    data: [
      {
        projectId: project.id,
        amount: 350000,
        category: 'CIMENT',
        description: 'Achat de 70 sacs de ciment CPJ45 pour dallage',
        date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      },
      {
        projectId: project.id,
        amount: 120000,
        category: 'SABLE',
        description: 'Achat de 6 tonnes de sable fin de mer',
        date: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000),
      },
      {
        projectId: project.id,
        amount: 45000,
        category: 'TRANSPORT',
        description: 'Transport de sable et ciment par camion benne',
        date: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000),
      },
      {
        projectId: project.id,
        amount: 150000,
        category: 'MAIN_DOEUVRE',
        description: 'Paiement hebdomadaire de l\'équipe de maçonnerie',
        date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      },
    ],
  });

  // 9. Enregistrement des mouvements de stock associés au chantier
  await prisma.materialMovement.createMany({
    data: [
      { materialId: ciment.id, projectId: project.id, type: 'ENTREE', quantity: 100, reason: 'Approvisionnement initial', date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) },
      { materialId: ciment.id, projectId: project.id, type: 'SORTIE', quantity: 55, reason: 'Utilisation pour coulage fondation', date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
      { materialId: sable.id, projectId: project.id, type: 'ENTREE', quantity: 15, reason: 'Livraison benne sable', date: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000) },
      { materialId: sable.id, projectId: project.id, type: 'SORTIE', quantity: 3, reason: 'Préparation mortier', date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
    ],
  });

  // 10. Documents devis et factures
  const mockSignature = 'M 10 50 L 50 10 L 100 80 L 150 20'; // Tracé SVG de signature factice
  await prisma.document.create({
    data: {
      projectId: project.id,
      title: 'Devis Gros Œuvre & Fondations',
      type: 'DEVIS',
      amount: 1500000,
      status: 'SIGNE',
      clientSignature: mockSignature,
      signedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.document.create({
    data: {
      projectId: project.id,
      title: 'Facture Acompte de Démarrage (30%)',
      type: 'FACTURE',
      amount: 450000,
      status: 'PAYE',
    },
  });

  await prisma.document.create({
    data: {
      projectId: project.id,
      title: 'Facture Élévation des Murs (Phase 2)',
      type: 'FACTURE',
      amount: 500000,
      status: 'EN_ATTENTE',
    },
  });

  // 11. Photos de suivi
  await prisma.progressPhoto.create({
    data: {
      projectId: project.id,
      photoUrl: 'https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=600&q=80',
      type: 'AVANT',
      comment: 'État du terrain avant terrassement. Validation de l\'implantation par le géomètre.',
      takenById: leader.id,
      createdAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.progressPhoto.create({
    data: {
      projectId: project.id,
      photoUrl: 'https://images.unsplash.com/photo-1581094288338-2314dddb7ecc?auto=format&fit=crop&w=600&q=80',
      type: 'QUOTIDIEN',
      comment: 'Fouilles terminées et ferraillage des semelles posé. Prêt pour le coulage du béton de propreté.',
      takenById: leader.id,
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.progressPhoto.create({
    data: {
      projectId: project.id,
      photoUrl: 'https://images.unsplash.com/photo-1590069261209-f8e9b8642343?auto=format&fit=crop&w=600&q=80',
      type: 'QUOTIDIEN',
      comment: 'Élévation en cours. Montage des agglos du rez-de-chaussée commencé.',
      takenById: worker.id,
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    },
  });

  console.log('✅ Base de données démo peuplée avec succès !');
}

main()
  .catch((e) => {
    console.error('❌ Erreur lors du peuplement de la base de données :', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
