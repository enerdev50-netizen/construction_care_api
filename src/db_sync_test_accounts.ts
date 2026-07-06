import { prisma } from './prisma';

async function run() {
  const clientEmail = 'client@togo.com';
  const projectCodeName = 'Chantier Test Antigravity';

  try {
    // 1. Find the client user
    const client = await prisma.user.findFirst({
      where: { email: clientEmail }
    });

    if (!client) {
      console.log(`Error: User with email ${clientEmail} not found.`);
      return;
    }

    // 2. Find the project
    const project = await prisma.project.findFirst({
      where: { name: projectCodeName }
    });

    if (!project) {
      console.log(`Error: Project with name ${projectCodeName} not found.`);
      return;
    }

    console.log(`Found client: ${client.firstName} ${client.lastName} (ID: ${client.id})`);
    console.log(`Found project: ${project.name} (ID: ${project.id})`);

    // 3. Create project assignment if it doesn't exist
    const existingAssignment = await prisma.projectAssignment.findFirst({
      where: {
        projectId: project.id,
        userId: client.id
      }
    });

    if (!existingAssignment) {
      await prisma.projectAssignment.create({
        data: {
          projectId: project.id,
          userId: client.id
        }
      });
      console.log(`SUCCESS: Assigned client@togo.com to project ${projectCodeName}`);
    } else {
      console.log(`INFO: client@togo.com is already assigned to project ${projectCodeName}`);
    }

    // 4. Create a test invoice if it doesn't exist
    const existingInvoice = await prisma.document.findFirst({
      where: {
        projectId: project.id,
        type: 'FACTURE',
        title: 'Facture : Test'
      }
    });

    if (!existingInvoice) {
      const invoice = await prisma.document.create({
        data: {
          projectId: project.id,
          title: 'Facture : Test',
          type: 'FACTURE',
          amount: 350000,
          paidAmount: 150000,
          declaredPaidAmount: 0,
          status: 'EN_ATTENTE'
        }
      });
      console.log(`SUCCESS: Created test invoice (350 000 F, paid: 150 000 F) for project ${projectCodeName}:`, invoice);
    } else {
      console.log(`INFO: Test invoice already exists for project ${projectCodeName}`);
    }

  } catch (err) {
    console.error('Database setup error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
