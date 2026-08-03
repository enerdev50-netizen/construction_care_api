import { Router, Response } from 'express';
import { prisma } from '../prisma';
import { AuthenticatedRequest, authenticateToken } from '../middleware/auth';
import { validateBody } from '../utils/validate';
import { upsertSiteLogSchema } from './sitelog.schemas';

const router = Router();

async function findAuthorizedProject(companyId: string | null | undefined, projectId: string) {
  return prisma.project.findFirst({
    where: { id: projectId, companyId: companyId ?? undefined },
  });
}

// Récupérer le cahier des charges d'un chantier (toutes les entrées, ou une date précise)
router.get('/', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const { projectId, date } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return res.status(400).json({ error: 'Le paramètre "projectId" est obligatoire.' });
  }

  try {
    const project = await findAuthorizedProject(companyId, projectId);
    if (!project) {
      return res.status(404).json({ error: 'Chantier introuvable.' });
    }

    if (date && typeof date === 'string') {
      const entry = await prisma.siteLogEntry.findUnique({
        where: { projectId_date: { projectId, date: new Date(date) } },
        include: { createdBy: { select: { firstName: true, lastName: true } } },
      });
      return res.json(entry);
    }

    const entries = await prisma.siteLogEntry.findMany({
      where: { projectId },
      include: { createdBy: { select: { firstName: true, lastName: true } } },
      orderBy: { date: 'desc' },
    });
    res.json(entries);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération du cahier des charges.' });
  }
});

// Créer ou mettre à jour l'entrée du cahier des charges pour une date donnée (GÉRANT / CHEF)
router.post('/', authenticateToken as any, validateBody(upsertSiteLogSchema), async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const { projectId, date, items } = req.body;

  if (req.user?.role !== 'COMPANY_ADMIN' && req.user?.role !== 'TEAM_LEADER') {
    return res.status(403).json({ error: 'Seul le gérant ou le chef de chantier peut renseigner le cahier des charges.' });
  }

  try {
    const project = await findAuthorizedProject(companyId, projectId);
    if (!project) {
      return res.status(404).json({ error: 'Chantier introuvable.' });
    }

    const entryDate = new Date(date);
    const entry = await prisma.siteLogEntry.upsert({
      where: { projectId_date: { projectId, date: entryDate } },
      create: { projectId, date: entryDate, items, createdById: req.user!.id },
      update: { items },
      include: { createdBy: { select: { firstName: true, lastName: true } } },
    });

    res.status(201).json(entry);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement du cahier des charges." });
  }
});

// Supprimer l'entrée d'une date (GÉRANT / CHEF)
router.delete('/:id', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;

  if (req.user?.role !== 'COMPANY_ADMIN' && req.user?.role !== 'TEAM_LEADER') {
    return res.status(403).json({ error: 'Action non autorisée.' });
  }

  try {
    const entry = await prisma.siteLogEntry.findUnique({
      where: { id: req.params.id },
      include: { project: true },
    });

    if (!entry || (companyId && entry.project.companyId !== companyId)) {
      return res.status(404).json({ error: 'Entrée introuvable.' });
    }

    await prisma.siteLogEntry.delete({ where: { id: entry.id } });
    res.json({ message: 'Entrée supprimée avec succès.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la suppression de l'entrée." });
  }
});

export default router;
