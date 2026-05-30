import { Router, Response } from 'express';
import { prisma } from '../prisma';
import { AuthenticatedRequest, authenticateToken } from '../middleware/auth';

const router = Router();

// Récupérer les documents (filtrable par chantier)
router.get('/', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const { projectId } = req.query;

  try {
    const documents = await prisma.document.findMany({
      where: {
        project: {
          companyId: companyId!,
          id: projectId ? String(projectId) : undefined,
        },
      },
      include: {
        project: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(documents);
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la récupération des documents.' });
  }
});

// Créer un devis ou une facture
router.post('/', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const { projectId, title, type, amount } = req.body;

  if (!projectId || !title || !type || !amount) {
    return res.status(400).json({ error: 'Champs obligatoires manquants.' });
  }

  if (!['DEVIS', 'FACTURE'].includes(type)) {
    return res.status(400).json({ error: 'Type de document invalide.' });
  }

  try {
    // Vérifier que le chantier appartient bien à l'entreprise
    const project = await prisma.project.findFirst({
      where: { id: projectId, companyId: companyId ?? undefined },
    });

    if (!project) {
      return res.status(404).json({ error: 'Chantier introuvable.' });
    }

    const document = await prisma.document.create({
      data: {
        projectId,
        title,
        type,
        amount: parseFloat(amount),
        status: 'EN_ATTENTE',
      },
    });

    res.status(201).json(document);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du document.' });
  }
});

// Signature client (pour devis)
router.post('/:id/sign', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const documentId = req.params.id;
  const { clientSignature } = req.body; // Image Base64 de la signature

  if (!clientSignature) {
    return res.status(400).json({ error: 'La signature client est requise.' });
  }

  try {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: { project: true },
    });

    if (!document) {
      return res.status(404).json({ error: 'Document introuvable.' });
    }

    // Si l'utilisateur est un client, s'assurer que c'est bien son chantier
    if (req.user?.role === 'CLIENT') {
      const isAssigned = await prisma.projectAssignment.findFirst({
        where: { projectId: document.projectId, userId: req.user.id },
      });
      if (!isAssigned) {
        return res.status(403).json({ error: 'Vous n\'êtes pas autorisé à signer ce document.' });
      }
    }

    const updatedDocument = await prisma.document.update({
      where: { id: documentId },
      data: {
        clientSignature,
        status: 'SIGNE',
        signedAt: new Date(),
      },
    });

    res.json({ message: 'Document signé avec succès.', document: updatedDocument });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la signature du document.' });
  }
});

// Téléchargement / Visualisation PDF (Premium uniquement)
router.get('/:id/pdf', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const documentId = req.params.id;

  try {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        project: {
          include: {
            company: true,
          },
        },
      },
    });

    if (!document) {
      return res.status(404).json({ error: 'Document introuvable.' });
    }

    // Vérifier l'abonnement de l'entreprise
    const plan = document.project.company.subscriptionPlan;
    if (plan !== 'PREMIUM') {
      return res.status(403).json({
        error: 'La génération de rapports PDF est une fonctionnalité Premium (15 000 FCFA/mois). Veuillez passer au plan Premium.',
        premiumRequired: true,
      });
    }

    // Simuler le PDF en renvoyant des données structurées prêtes à l'impression
    // Le frontend convertira cela en une vue HTML optimisée pour l'impression (window.print() / pdf)
    res.json({
      document,
      company: {
        name: document.project.company.name,
        email: document.project.company.email,
        phone: document.project.company.phone,
        address: document.project.company.address,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la génération du document.' });
  }
});

export default router;
