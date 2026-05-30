import { Router, Response } from 'express';
import { prisma } from '../prisma';
import { AuthenticatedRequest, authenticateToken } from '../middleware/auth';

const router = Router();

// Récupérer le journal de suivi (photos et commentaires) d'un chantier
router.get('/:projectId', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const { projectId } = req.params;
  const companyId = req.user?.companyId;

  try {
    // S'assurer que le chantier appartient bien à l'entreprise
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        companyId: companyId || undefined, // si admin
      },
    });

    if (!project && req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Accès refusé.' });
    }

    const logs = await prisma.progressPhoto.findMany({
      where: { projectId },
      include: {
        takenBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(logs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération du journal de suivi.' });
  }
});

// Ajouter un rapport quotidien / photo au chantier
router.post('/', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const { projectId, photoUrl, type, comment } = req.body;

  if (!projectId || !photoUrl || !type) {
    return res.status(400).json({ error: 'Champs obligatoires manquants.' });
  }

  if (!['AVANT', 'APRES', 'QUOTIDIEN'].includes(type)) {
    return res.status(400).json({ error: 'Type de photo de suivi invalide.' });
  }

  try {
    // Vérifier l'accès au chantier
    const project = await prisma.project.findFirst({
      where: { id: projectId, companyId: companyId || undefined },
    });

    if (!project && req.user?.role !== 'SUPER_ADMIN') {
      // Pour les ouvriers/chefs, s'assurer qu'ils sont assignés
      const isAssigned = await prisma.projectAssignment.findFirst({
        where: { projectId, userId: req.user?.id! },
      });
      if (!isAssigned) {
        return res.status(403).json({ error: 'Vous n\'êtes pas affecté à ce chantier.' });
      }
    }

    const newLog = await prisma.progressPhoto.create({
      data: {
        projectId,
        photoUrl, // Contient l'image encodée en Base64 ou un lien
        type,
        comment,
        takenById: req.user?.id!,
      },
      include: {
        takenBy: {
          select: {
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });

    res.status(201).json(newLog);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de l\'enregistrement du suivi.' });
  }
});

// Supprimer un log de suivi
router.delete('/:id', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const logId = req.params.id;

  try {
    const log = await prisma.progressPhoto.findFirst({
      where: {
        id: logId,
        project: { companyId: companyId ?? undefined },
      },
    });

    if (!log) {
      return res.status(404).json({ error: 'Rapport de suivi introuvable.' });
    }

    await prisma.progressPhoto.delete({ where: { id: logId } });
    res.json({ message: 'Rapport supprimé avec succès.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

export default router;
