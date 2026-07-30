import { Router, Response } from 'express';
import { prisma } from '../prisma';
import { AuthenticatedRequest, authenticateToken } from '../middleware/auth';
import { uploadBase64ToS3 } from '../s3';
import { syncDevisStatus, syncExpenseFromDocument } from '../devis_sync';
import { validateBody } from '../utils/validate';
import {
  createDocumentSchema,
  signDocumentSchema,
  documentStatusSchema,
  paymentAmountSchema,
  updateDocumentSchema,
} from './documents.schemas';

const router = Router();

// Récupérer les documents du CLIENT connecté (tous ses projets)
router.get('/client-docs', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  const companyId = req.user?.companyId;

  try {
    // Trouver tous les projets où l'utilisateur est assigné
    const assignments = await prisma.projectAssignment.findMany({
      where: { userId: userId! },
      select: { projectId: true },
    });

    const projectIds = assignments.map((a) => a.projectId);

    const documents = await prisma.document.findMany({
      where: {
        projectId: { in: projectIds },
      },
      include: {
        project: {
          include: {
            assignments: {
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                  },
                },
              },
            },
          },
        },
        factures: {
          select: { id: true, title: true, amount: true, status: true, createdAt: true },
        },
        expenses: {
          include: {
            beneficiary: { select: { firstName: true, lastName: true } },
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          include: {
            createdByUser: { select: { id: true, firstName: true, lastName: true, role: true } },
            validatedByUser: { select: { id: true, firstName: true, lastName: true, role: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(documents);
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la récupération des documents client.' });
  }
});

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
          assignments: req.user?.role === 'CLIENT' ? {
            some: { userId: req.user.id }
          } : undefined,
        },
      },
      include: {
        project: {
          include: {
            assignments: {
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                  },
                },
              },
            },
          },
        },
        factures: {
          select: { id: true, title: true, amount: true, status: true, createdAt: true },
        },
        expenses: {
          include: {
            beneficiary: { select: { firstName: true, lastName: true } },
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          include: {
            createdByUser: { select: { id: true, firstName: true, lastName: true, role: true } },
            validatedByUser: { select: { id: true, firstName: true, lastName: true, role: true } },
          },
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
router.post('/', authenticateToken as any, validateBody(createDocumentSchema), async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const { projectId, title, type, amount, pdfFile, devisId } = req.body;

  try {
    // Vérifier que le chantier appartient bien à l'entreprise
    const project = await prisma.project.findFirst({
      where: { id: projectId, companyId: companyId ?? undefined },
    });

    if (!project) {
      return res.status(404).json({ error: 'Chantier introuvable.' });
    }

    let finalPdfUrl = null;
    if (pdfFile && pdfFile.startsWith('data:')) {
      try {
        finalPdfUrl = await uploadBase64ToS3(pdfFile, 'documents');
      } catch (s3Err) {
        console.warn('S3 upload error for pdf, falling back to base64:', s3Err);
        finalPdfUrl = pdfFile;
      }
    }

    const document = await prisma.document.create({
      data: {
        projectId,
        title,
        type,
        amount,
        status: 'EN_ATTENTE',
        pdfUrl: finalPdfUrl,
        devisId: devisId || null,
      },
    });

    await syncDevisStatus(document.devisId);

    res.status(201).json(document);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création du document.' });
  }
});

// Signature client (pour devis)
router.post('/:id/sign', authenticateToken as any, validateBody(signDocumentSchema), async (req: AuthenticatedRequest, res: Response) => {
  const documentId = req.params.id;
  const { clientSignature } = req.body; // Image Base64 de la signature

  try {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: { project: true },
    });

    if (!document) {
      return res.status(404).json({ error: 'Document introuvable.' });
    }

    // Isolation multi-tenant : le document doit appartenir à l'entreprise de l'utilisateur (le SUPER_ADMIN est exempté)
    if (req.user?.companyId && document.project.companyId !== req.user.companyId) {
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

    // Téléverser la signature vers S3 si elle est encodée en base64
    let finalSignatureUrl = clientSignature;
    if (clientSignature.startsWith('data:')) {
      try {
        finalSignatureUrl = await uploadBase64ToS3(clientSignature, 'signatures');
        console.log('Client signature successfully uploaded to S3:', finalSignatureUrl);
      } catch (s3Err) {
        console.warn('S3 upload error for signature, falling back to base64:', s3Err);
        finalSignatureUrl = clientSignature;
      }
    }

    const updatedDocument = await prisma.document.update({
      where: { id: documentId },
      data: {
        clientSignature: finalSignatureUrl,
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

// Mettre à jour le statut d'un document (ex: marquer comme PAYE ou SIGNE)
router.put('/:id/status', authenticateToken as any, validateBody(documentStatusSchema), async (req: AuthenticatedRequest, res: Response) => {
  const documentId = req.params.id;
  const { status } = req.body;
  const companyId = req.user?.companyId;

  if (req.user?.role === 'CLIENT' && status === 'PAYE') {
    return res.status(403).json({ error: 'Seul le gérant ou chef d\'équipe peut valider le paiement.' });
  }

  if (req.user?.role === 'WORKER') {
    return res.status(403).json({ error: 'Action non autorisée.' });
  }

  try {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: { project: true },
    });

    if (!document || (companyId && document.project.companyId !== companyId)) {
      return res.status(404).json({ error: 'Document introuvable ou non autorisé.' });
    }

    let paidAmountUpdate = undefined;
    let declaredAmountUpdate = undefined;
    let nextStatus = status;

    if (status === 'PAYE') {
      const declaredAmount = document.declaredPaidAmount || 0;
      if (declaredAmount > 0) {
        const newPaidAmount = document.paidAmount + declaredAmount;
        paidAmountUpdate = Math.min(newPaidAmount, document.amount);
        nextStatus = paidAmountUpdate >= document.amount ? 'PAYE' : 'PAYE_PARTIEL';

        // Mark pending payments as VALIDE
        await prisma.payment.updateMany({
          where: { documentId, status: 'EN_ATTENTE' },
          data: {
            status: 'VALIDE',
            validatedByUserId: req.user!.id,
          },
        });
      } else {
        const remaining = document.amount - document.paidAmount;
        if (remaining > 0) {
          await prisma.payment.create({
            data: {
              documentId,
              amount: remaining,
              status: 'VALIDE',
              createdByUserId: req.user!.id,
              validatedByUserId: req.user!.id,
            },
          });
        }
        paidAmountUpdate = document.amount;
        nextStatus = 'PAYE';
      }
      declaredAmountUpdate = 0;
    } else if (status === 'PAYE_CLIENT') {
      const versement = req.body.declaredPaidAmount;
      const remaining = document.amount - document.paidAmount;
      declaredAmountUpdate = versement !== undefined ? Math.min(versement, remaining) : remaining;
      nextStatus = 'PAYE_CLIENT';
    } else if (status === 'EN_ATTENTE') {
      await prisma.payment.deleteMany({
        where: { documentId }
      });
      paidAmountUpdate = 0;
      declaredAmountUpdate = 0;
      nextStatus = 'EN_ATTENTE';
    }

    const updatedDocument = await prisma.document.update({
      where: { id: documentId },
      data: {
        status: nextStatus,
        paidAmount: paidAmountUpdate !== undefined ? paidAmountUpdate : undefined,
        declaredPaidAmount: declaredAmountUpdate !== undefined ? declaredAmountUpdate : undefined,
      },
      include: {
        project: true,
        payments: {
          orderBy: { createdAt: 'desc' },
          include: {
            createdByUser: { select: { id: true, firstName: true, lastName: true, role: true } },
            validatedByUser: { select: { id: true, firstName: true, lastName: true, role: true } },
          },
        },
      },
    });

    await syncExpenseFromDocument(updatedDocument.id);
    await syncDevisStatus(updatedDocument.devisId);

    res.json({ message: 'Statut mis à jour avec succès.', document: updatedDocument });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du statut.' });
  }
});



// [CLIENT] Déclarer un paiement partiel ou total sur une facture (en attente de validation gérant)
router.post('/:id/client-declare-payment', authenticateToken as any, validateBody(paymentAmountSchema), async (req: AuthenticatedRequest, res: Response) => {
  const documentId = req.params.id;
  const { amount: versement } = req.body;
  const userId = req.user?.id;
  const companyId = req.user?.companyId;

  if (req.user?.role === 'WORKER') {
    return res.status(403).json({ error: 'Action non autorisée.' });
  }

  try {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: { project: { include: { assignments: { where: { userId: userId! } } } } },
    });

    if (!document) {
      return res.status(404).json({ error: 'Document introuvable.' });
    }

    // Isolation multi-tenant : la facture doit appartenir à l'entreprise de l'utilisateur (le SUPER_ADMIN est exempté)
    if (companyId && document.project.companyId !== companyId) {
      return res.status(404).json({ error: 'Document introuvable.' });
    }

    // Vérifier que le client est bien assigné à ce projet (ou que c'est un gérant/chef)
    const isManager = req.user?.role === 'COMPANY_ADMIN' || req.user?.role === 'TEAM_LEADER';
    const isAssigned = document.project.assignments.length > 0;
    if (!isManager && !isAssigned) {
      return res.status(403).json({ error: 'Vous n\'êtes pas autorisé à accéder à cette facture.' });
    }

    if (document.type !== 'FACTURE') {
      return res.status(400).json({ error: 'Les paiements ne peuvent être déclarés que sur des factures.' });
    }

    if (document.status === 'PAYE') {
      return res.status(400).json({ error: 'Cette facture est déjà entièrement réglée.' });
    }

    // Empêcher une nouvelle déclaration si une est déjà en attente
    if (document.status === 'PAYE_CLIENT') {
      return res.status(400).json({ error: 'Un versement est déjà en attente de validation par le gérant.' });
    }

    const remaining = document.amount - (document.paidAmount || 0);
    const declaredAmount = Math.min(versement, remaining);

    // Create a pending payment record
    await prisma.payment.create({
      data: {
        documentId,
        amount: declaredAmount,
        status: 'EN_ATTENTE',
        createdByUserId: req.user!.id,
      },
    });

    const updatedDocument = await prisma.document.update({
      where: { id: documentId },
      data: {
        status: 'PAYE_CLIENT',
        declaredPaidAmount: declaredAmount,
      },
      include: {
        project: true,
        payments: {
          orderBy: { createdAt: 'desc' },
          include: {
            createdByUser: { select: { id: true, firstName: true, lastName: true, role: true } },
            validatedByUser: { select: { id: true, firstName: true, lastName: true, role: true } },
          },
        },
      },
    });

    await syncDevisStatus(updatedDocument.devisId);

    res.json({
      message: 'Versement déclaré avec succès. Le gérant va valider votre paiement.',
      document: updatedDocument,
      declared: declaredAmount,
      remaining: Math.max(0, remaining - declaredAmount),
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: `Erreur lors de la déclaration du paiement : ${err.message || err}` });
  }
});

// Enregistrer un paiement (partiel ou total) sur une facture existante (GÉRANT / CHEF uniquement)
router.post('/:id/record-payment', authenticateToken as any, validateBody(paymentAmountSchema), async (req: AuthenticatedRequest, res: Response) => {
  const documentId = req.params.id;
  const { amount: versement } = req.body;
  const companyId = req.user?.companyId;

  if (req.user?.role === 'CLIENT' || req.user?.role === 'WORKER') {
    return res.status(403).json({ error: 'Seul le gérant ou le chef d\'équipe peut valider ou enregistrer un règlement.' });
  }

  try {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: { project: true },
    });

    if (!document || (companyId && document.project.companyId !== companyId)) {
      return res.status(404).json({ error: 'Document introuvable.' });
    }

    if (document.type !== 'FACTURE') {
      return res.status(400).json({ error: 'Les paiements ne peuvent être enregistrés que sur des factures.' });
    }

    const newPaidAmount = document.paidAmount + versement;
    const remaining = document.amount - newPaidAmount;

    let nextStatus = 'PAYE_PARTIEL';
    if (newPaidAmount >= document.amount) {
      nextStatus = 'PAYE';
    }

    // Create a validated payment record
    await prisma.payment.create({
      data: {
        documentId,
        amount: versement,
        status: 'VALIDE',
        createdByUserId: req.user!.id,
        validatedByUserId: req.user!.id,
      },
    });

    const updatedDocument = await prisma.document.update({
      where: { id: documentId },
      data: {
        paidAmount: Math.min(newPaidAmount, document.amount),
        declaredPaidAmount: 0,
        status: nextStatus,
      },
      include: {
        project: true,
        payments: {
          orderBy: { createdAt: 'desc' },
          include: {
            createdByUser: { select: { id: true, firstName: true, lastName: true, role: true } },
            validatedByUser: { select: { id: true, firstName: true, lastName: true, role: true } },
          },
        },
      },
    });

    await syncExpenseFromDocument(updatedDocument.id);
    await syncDevisStatus(updatedDocument.devisId);

    res.json({
      message: 'Paiement partiel enregistré avec succès.',
      document: updatedDocument,
      remaining: Math.max(0, remaining),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de l\'enregistrement du paiement.' });
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
        expenses: {
          include: {
            beneficiary: { select: { firstName: true, lastName: true } },
          },
        },
        factures: true,
      },
    });

    if (!document) {
      return res.status(404).json({ error: 'Document introuvable.' });
    }

    // Isolation multi-tenant : le document doit appartenir à l'entreprise de l'utilisateur (le SUPER_ADMIN est exempté)
    if (companyId && document.project.companyId !== companyId) {
      return res.status(404).json({ error: 'Document introuvable.' });
    }

    // Simuler le PDF en renvoyant des données structurées prêtes à l'impression
    // Le frontend convertira cela en une vue HTML optimisée pour l'impression (window.print() / pdf)
    res.json({
      document,
      company: {
        name: document.project.company.name,
        nif: document.project.company.nif,
        email: document.project.company.email,
        phone: document.project.company.phone,
        address: document.project.company.address,
        logoUrl: document.project.company.logoUrl,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la génération du document.' });
  }
});

// Modifier un document (Devis / Facture)
router.put('/:id', authenticateToken as any, validateBody(updateDocumentSchema), async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const documentId = req.params.id;
  const { title, type, amount, status, pdfFile, devisId } = req.body;

  try {
    const existingDoc = await prisma.document.findUnique({
      where: { id: documentId },
      include: { project: true },
    });

    if (!existingDoc || (companyId && existingDoc.project.companyId !== companyId)) {
      return res.status(404).json({ error: 'Document introuvable.' });
    }

    let finalPdfUrl = existingDoc.pdfUrl;
    if (pdfFile && pdfFile.startsWith('data:')) {
      try {
        finalPdfUrl = await uploadBase64ToS3(pdfFile, 'documents');
      } catch (s3Err) {
        console.warn('S3 upload error for pdf, falling back to base64:', s3Err);
        finalPdfUrl = pdfFile;
      }
    }

    const updated = await prisma.document.update({
      where: { id: documentId },
      data: {
        title,
        type,
        amount,
        status,
        pdfUrl: finalPdfUrl,
        devisId: devisId !== undefined ? (devisId || null) : undefined,
      },
    });

    await syncDevisStatus(existingDoc.devisId);
    if (updated.devisId !== existingDoc.devisId) {
      await syncDevisStatus(updated.devisId);
    }

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du document.' });
  }
});

// Supprimer un document
router.delete('/:id', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;
  const documentId = req.params.id;

  try {
    const existingDoc = await prisma.document.findUnique({
      where: { id: documentId },
      include: { project: true },
    });

    if (!existingDoc || (companyId && existingDoc.project.companyId !== companyId)) {
      return res.status(404).json({ error: 'Document introuvable.' });
    }

    await prisma.document.delete({ where: { id: documentId } });
    res.json({ message: 'Document supprimé avec succès.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la suppression du document.' });
  }
});

export default router;
