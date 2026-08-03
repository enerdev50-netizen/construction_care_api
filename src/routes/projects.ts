import { Router, Response } from 'express';
import { prisma } from '../prisma';
import { AuthenticatedRequest, authenticateToken } from '../middleware/auth';
import { validateBody } from '../utils/validate';
import { getProjectFinancials, getProjectsFinancialsBatch } from '../utils/project_financials';
import {
  createProjectSchema,
  updateProjectSchema,
  assignUsersSchema,
  taskStatusSchema,
  createTaskSchema,
} from './projects.schemas';

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

    if (role === 'SUPER_ADMIN') {
      // Le super-administrateur de la plateforme voit tous les chantiers, toutes entreprises confondues
      projects = await prisma.project.findMany({
        include: {
          company: true,
          assignments: { include: { user: true } },
          tasks: true,
        },
      });
    } else if (role === 'COMPANY_ADMIN') {
      // Les admins voient tout
      projects = await prisma.project.findMany({
        where: { companyId: companyId! },
        include: {
          company: true,
          assignments: { include: { user: true } },
          tasks: true,
        },
      });
    } else if (role === 'CLIENT') {
      // Les clients voient les chantiers dont ils sont le "client"
      projects = await prisma.project.findMany({
        where: {
          companyId: companyId!,
          assignments: {
            some: { userId: userId! }
          }
        },
        include: {
          company: true,
          tasks: true,
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
          company: true,
          tasks: true,
          assignments: { include: { user: true } },
        },
      });
    }

    const financialsByProject = await getProjectsFinancialsBatch(
      projects.map((p) => ({ id: p.id, budget: p.budget }))
    );
    const projectsWithFinancials = projects.map((p) => ({ ...p, ...financialsByProject[p.id] }));

    res.json(projectsWithFinancials);
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
        documents: {
          include: {
            factures: true,
          },
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

    const financials = await getProjectFinancials(projectId, project.budget);

    res.json({ ...project, ...financials });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération du chantier.' });
  }
});

// Créer un nouveau chantier (avec vérification des limites de plan)
router.post('/', authenticateToken as any, validateBody(createProjectSchema), async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const role = req.user?.role;

  if (!companyId || role !== 'COMPANY_ADMIN') {
    return res.status(403).json({ error: 'Permissions insuffisantes.' });
  }

  const { name, description, address, latitude, longitude, startDate, endDate, budget, clientIds } = req.body;

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
    const config = await prisma.subscriptionConfig.findUnique({ where: { planName: plan } });

    if (config && currentProjectCount >= config.maxProjects) {
      return res.status(403).json({
        error: `Limite de chantiers atteinte (Max ${config.maxProjects} pour le plan ${plan}). Veuillez passer au plan supérieur.`,
        limitReached: true,
      });
    }

    // Créer le chantier et assigner le client s'il y en a un
    const project = await prisma.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: {
          name,
          description,
          address,
          latitude: latitude ?? null,
          longitude: longitude ?? null,
          startDate,
          endDate,
          budget: budget ?? null,
          companyId,
        },
      });



      // Assigner des clients / ouvriers dès le début si fournis
      if (clientIds && Array.isArray(clientIds) && clientIds.length > 0) {
        // Isolation multi-tenant : ne garder que les utilisateurs appartenant à l'entreprise
        const validUsers = await tx.user.findMany({
          where: { id: { in: clientIds }, companyId },
          select: { id: true },
        });
        const assignmentsData = validUsers.map((u) => ({
          projectId: p.id,
          userId: u.id,
        }));
        if (assignmentsData.length > 0) {
          await tx.projectAssignment.createMany({
            data: assignmentsData,
          });
        }
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
router.put('/:id', authenticateToken as any, validateBody(updateProjectSchema), async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const projectId = req.params.id;
  const { name, description, address, latitude, longitude, startDate, endDate, status, budget } = req.body;

  try {
    const existingProject = await prisma.project.findFirst({
      where: { id: projectId, companyId: companyId ?? undefined },
    });

    if (!existingProject) {
      return res.status(404).json({ error: 'Chantier introuvable.' });
    }

    // Un champ absent (`undefined`) est ignoré par Prisma et laisse la valeur
    // existante intacte ; un champ explicitement `null` (latitude, longitude,
    // budget) l'efface.
    const updated = await prisma.project.update({
      where: { id: projectId },
      data: { name, description, address, latitude, longitude, startDate, endDate, status, budget },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du chantier.' });
  }
});

// Assigner des membres d'équipe / clients à un chantier
router.post('/:id/assign', authenticateToken as any, validateBody(assignUsersSchema), async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const projectId = req.params.id;
  const { userIds } = req.body; // Tableau d'IDs d'utilisateurs à assigner

  try {
    const project = await prisma.project.findFirst({
      where: { id: projectId, companyId: companyId ?? undefined },
    });

    if (!project) {
      return res.status(404).json({ error: 'Chantier introuvable.' });
    }

    // Isolation multi-tenant : ne conserver que les utilisateurs appartenant à l'entreprise du chantier
    const validUsers = await prisma.user.findMany({
      where: { id: { in: userIds }, companyId: project.companyId },
      select: { id: true },
    });

    // On supprime d'abord les anciennes affectations pour les remplacer ou on ajoute?
    // Remplacer est souvent plus propre pour les formulaires d'édition.
    await prisma.$transaction([
      prisma.projectAssignment.deleteMany({
        where: { projectId },
      }),
      prisma.projectAssignment.createMany({
        data: validUsers.map((u) => ({
          projectId,
          userId: u.id,
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
router.put('/:projectId/tasks/:taskId', authenticateToken as any, validateBody(taskStatusSchema), async (req: AuthenticatedRequest, res: Response) => {
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
      data: { status, dueDate },
    });

    res.json(updatedTask);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la tâche.' });
  }
});

// Ajouter une tâche à un chantier
router.post('/:projectId/tasks', authenticateToken as any, validateBody(createTaskSchema), async (req: AuthenticatedRequest, res: Response) => {
  const { name, dueDate } = req.body;
  const { projectId } = req.params;

  try {
    const project = await prisma.project.findFirst({
      where: { id: projectId, companyId: req.user?.companyId! },
    });

    if (!project && req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Accès refusé.' });
    }

    const newTask = await prisma.task.create({
      data: {
        projectId,
        name,
        status: 'A_FAIRE',
        dueDate: dueDate ?? null,
      },
    });

    res.status(201).json(newTask);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création de la tâche.' });
  }
});

// Supprimer une tâche d'un chantier
router.delete('/:projectId/tasks/:taskId', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const { projectId, taskId } = req.params;

  try {
    const project = await prisma.project.findFirst({
      where: { id: projectId, companyId: req.user?.companyId! },
    });

    if (!project && req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Accès refusé.' });
    }

    await prisma.task.delete({
      where: { id: taskId, projectId },
    });

    res.json({ message: 'Tâche supprimée avec succès.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la suppression de la tâche.' });
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
