import { Router, Response } from 'express';
import { prisma } from '../prisma';
import { AuthenticatedRequest, authenticateToken } from '../middleware/auth';

const router = Router();

// Récupérer tous les chantiers de l'entreprise (ou ceux assignés à l'ouvrier/chef ou appartenant au client)
router.get('/', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const userId = req.user?.id;
  const role = req.user?.role;

  if (!companyId && role !== 'SUPER_ADMIN') {
    // Si c'est un client externe, il n'a peut-être pas de companyId directement s'il n'est pas lié,
    // mais dans notre modèle, les clients sont créés par l'entreprise et liés à son companyId.
    return res.status(400).json({ error: 'Identifiant entreprise manquant.' });
  }

  try {
    let projects;

    if (role === 'COMPANY_ADMIN') {
      // Les admins voient tout
      projects = await prisma.project.findMany({
        where: { companyId: companyId! },
        include: {
          assignments: { include: { user: true } },
          tasks: true,
          expenses: true,
        },
      });
    } else if (role === 'CLIENT') {
      // Les clients voient les chantiers dont ils sont le "client"
      // Wait, let's look at how client is linked.
      // In the implementation plan, the client relation can be represented by assignments,
      // or we can query users assigned or match by description/name, or we can check project assignments where user is CLIENT.
      // Let's allow clients to see projects where they are assigned as CLIENT, or let's create a clientId field on Project?
      // Wait, in schema.prisma, Project doesn't have a direct clientId field. We can link clients by creating a project assignment,
      // or we can add a clientId field. Let's see, in the schema.prisma I created above, Project has:
      // companyId and assignments. So we can assign a CLIENT user to a project using ProjectAssignment.
      // That's clean because a project can have multiple client representatives if needed, or we can just assign the client to the project.
      // Let's filter projects where the client is assigned:
      projects = await prisma.project.findMany({
        where: {
          companyId: companyId!,
          assignments: {
            some: { userId: userId! }
          }
        },
        include: {
          tasks: true,
          expenses: true,
          assignments: { include: { user: true } },
        }
      });
    } else {
      // Ouvriers et chefs d'équipe voient les chantiers auxquels ils sont assignés
      projects = await prisma.project.findMany({
        where: {
          companyId: companyId!,
          assignments: {
            some: { userId: userId! }
          }
        },
        include: {
          tasks: true,
          expenses: true,
          assignments: { include: { user: true } },
        },
      });
    }

    res.json(projects);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des chantiers.' });
  }
});

// Récupérer un chantier en détail
router.get('/:id', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const projectId = req.params.id;

  try {
    const project = await prisma.project.findFirst({
      where: { id: projectId, companyId: companyId || undefined },
      include: {
        assignments: { include: { user: true } },
        tasks: {
          orderBy: { createdAt: 'asc' }
        },
        expenses: {
          orderBy: { date: 'desc' }
        },
        documents: {
          orderBy: { createdAt: 'desc' }
        },
        progressLogs: {
          include: { takenBy: true },
          orderBy: { createdAt: 'desc' }
        },
        movements: {
          include: { material: true },
          orderBy: { date: 'desc' }
        }
      },
    });

    if (!project) {
      return res.status(404).json({ error: 'Chantier introuvable.' });
    }

    res.json(project);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération du chantier.' });
  }
});

// Créer un nouveau chantier (avec vérification des limites de plan)
router.post('/', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const role = req.user?.role;

  if (!companyId || role !== 'COMPANY_ADMIN') {
    return res.status(403).json({ error: 'Permissions insuffisantes.' });
  }

  const { name, description, address, latitude, longitude, startDate, endDate, clientIds } = req.body;

  if (!name || !startDate || !endDate) {
    return res.status(400).json({ error: 'Champs obligatoires manquants.' });
  }

  try {
    // Vérifier l'abonnement et le nombre de chantiers actuels
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      include: { _count: { select: { projects: true } } },
    });

    if (!company) {
      return res.status(404).json({ error: 'Entreprise introuvable.' });
    }

    const currentProjectCount = company._count.projects;
    const plan = company.subscriptionPlan;

    if (plan === 'FREE' && currentProjectCount >= 1) {
      return res.status(403).json({
        error: 'Limite de chantiers atteinte (Max 1 pour le plan Gratuit). Veuillez passer au plan supérieur.',
        limitReached: true,
      });
    }

    if (plan === 'STANDARD' && currentProjectCount >= 10) {
      return res.status(403).json({
        error: 'Limite de chantiers atteinte (Max 10 pour le plan Standard). Veuillez passer au plan supérieur.',
        limitReached: true,
      });
    }

    // Créer le chantier, ses tâches par défaut, et assigner le client s'il y en a un
    const project = await prisma.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: {
          name,
          description,
          address,
          latitude: latitude ? parseFloat(latitude) : null,
          longitude: longitude ? parseFloat(longitude) : null,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          companyId,
        },
      });

      // Création des tâches par défaut
      const defaultTaskNames = ['Fondations', 'Élévation', 'Toiture', 'Électricité', 'Plomberie'];
      const tasksData = defaultTaskNames.map(taskName => ({
        projectId: p.id,
        name: taskName,
        status: 'A_FAIRE',
      }));

      await tx.task.createMany({
        data: tasksData,
      });

      // Assigner des clients / ouvriers dès le début si fournis
      if (clientIds && Array.isArray(clientIds)) {
        const assignmentsData = clientIds.map((cId: string) => ({
          projectId: p.id,
          userId: cId,
        }));
        await tx.projectAssignment.createMany({
          data: assignmentsData,
        });
      }

      return p;
    });

    const fullProject = await prisma.project.findUnique({
      where: { id: project.id },
      include: { tasks: true, assignments: true },
    });

    res.status(201).json(fullProject);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du chantier.' });
  }
});

// Modifier un chantier
router.put('/:id', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const projectId = req.params.id;
  const { name, description, address, latitude, longitude, startDate, endDate, status } = req.body;

  try {
    const existingProject = await prisma.project.findFirst({
      where: { id: projectId, companyId: companyId ?? undefined },
    });

    if (!existingProject) {
      return res.status(404).json({ error: 'Chantier introuvable.' });
    }

    const updated = await prisma.project.update({
      where: { id: projectId },
      data: {
        name: name !== undefined ? name : existingProject.name,
        description: description !== undefined ? description : existingProject.description,
        address: address !== undefined ? address : existingProject.address,
        latitude: latitude !== undefined ? (latitude ? parseFloat(latitude) : null) : existingProject.latitude,
        longitude: longitude !== undefined ? (longitude ? parseFloat(longitude) : null) : existingProject.longitude,
        startDate: startDate !== undefined ? new Date(startDate) : existingProject.startDate,
        endDate: endDate !== undefined ? new Date(endDate) : existingProject.endDate,
        status: status !== undefined ? status : existingProject.status,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du chantier.' });
  }
});

// Assigner des membres d'équipe / clients à un chantier
router.post('/:id/assign', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const projectId = req.params.id;
  const { userIds } = req.body; // Tableau d'IDs d'utilisateurs à assigner

  if (!userIds || !Array.isArray(userIds)) {
    return res.status(400).json({ error: 'Tableau userIds requis.' });
  }

  try {
    const project = await prisma.project.findFirst({
      where: { id: projectId, companyId: companyId ?? undefined },
    });

    if (!project) {
      return res.status(404).json({ error: 'Chantier introuvable.' });
    }

    // On supprime d'abord les anciennes affectations pour les remplacer ou on ajoute?
    // Remplacer est souvent plus propre pour les formulaires d'édition.
    await prisma.$transaction([
      prisma.projectAssignment.deleteMany({
        where: { projectId },
      }),
      prisma.projectAssignment.createMany({
        data: userIds.map((uId: string) => ({
          projectId,
          userId: uId,
        })),
      }),
    ]);

    const updatedAssignments = await prisma.projectAssignment.findMany({
      where: { projectId },
      include: { user: true },
    });

    res.json({ message: 'Affectations mises à jour.', assignments: updatedAssignments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de l\'affectation du personnel.' });
  }
});

// Mettre à jour le statut d'une tâche du chantier
router.put('/:projectId/tasks/:taskId', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const { status, dueDate } = req.body; // "A_FAIRE", "EN_COURS", "TERMINE"
  const { projectId, taskId } = req.params;

  try {
    // Vérifier l'accès au chantier
    const project = await prisma.project.findFirst({
      where: { id: projectId, companyId: req.user?.companyId! },
    });

    if (!project && req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Accès refusé.' });
    }

    const updatedTask = await prisma.task.update({
      where: { id: taskId, projectId },
      data: {
        status: status !== undefined ? status : undefined,
        dueDate: dueDate !== undefined ? (dueDate ? new Date(dueDate) : null) : undefined,
      },
    });

    res.json(updatedTask);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la tâche.' });
  }
});

// Supprimer un chantier
router.delete('/:id', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const projectId = req.params.id;

  try {
    const existingProject = await prisma.project.findFirst({
      where: { id: projectId, companyId: companyId ?? undefined },
    });

    if (!existingProject) {
      return res.status(404).json({ error: 'Chantier introuvable.' });
    }

    await prisma.project.delete({ where: { id: projectId } });
    res.json({ message: 'Chantier supprimé avec succès.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la suppression du chantier.' });
  }
});

export default router;
