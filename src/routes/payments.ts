/**
 * Encaissement Mobile Money (FedaPay) — P0-6.
 *
 * Aucune redirection : un push USSD est déclenché sur le téléphone du payeur et
 * c'est le webhook FedaPay SIGNÉ, et lui seul, qui fait foi de l'approbation
 * (voir POST /payments/webhooks/fedapay). Les routes authentifiées ne font
 * qu'initier une transaction et exposer son statut en lecture seule.
 */
import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import { AuthenticatedRequest, authenticateToken } from '../middleware/auth';
import { syncDevisStatus } from '../devis_sync';
import { ValidationError, parsePositiveInt } from '../utils/validation';
import {
  MOBILE_MONEY_PROVIDERS,
  createTransaction,
  getOperatorMethod,
  isFedaPayConfigured,
  isMobileMoneyProvider,
  triggerDirectPayment,
  verifyWebhookSignature,
} from '../services/fedapay';

const router = Router();

function handleError(res: Response, context: string, err: unknown): Response {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.message });
  }
  console.error(`[payments] ${context}`, err);
  return res.status(500).json({ error: `Erreur lors de ${context}.` });
}

/** Répond 503 tant que FedaPay n'est pas configuré, plutôt que de laisser planter la route. */
function requireFedaPay(res: Response): boolean {
  if (!isFedaPayConfigured()) {
    res.status(503).json({ error: "Le paiement Mobile Money n'est pas disponible pour le moment." });
    return false;
  }
  return true;
}

// ─── INITIATION ───────────────────────────────────────────────────────────────

// [CLIENT / GÉRANT / CHEF] Initier un paiement Mobile Money sur une facture
router.post('/mobile-money', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  if (!requireFedaPay(res)) return;

  const { documentId, phoneNumber } = req.body;
  const provider = req.body.provider;
  const companyId = req.user?.companyId;
  const userId = req.user?.id;

  if (req.user?.role === 'WORKER') {
    return res.status(403).json({ error: 'Action non autorisée.' });
  }

  try {
    if (!documentId || typeof documentId !== 'string') {
      throw new ValidationError('Le champ "documentId" est obligatoire.');
    }
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      throw new ValidationError('Le champ "phoneNumber" est obligatoire.');
    }
    if (!isMobileMoneyProvider(provider)) {
      throw new ValidationError(
        `Opérateur "${provider}" inconnu. Valeurs acceptées : ${MOBILE_MONEY_PROVIDERS.join(', ')}.`
      );
    }
    // Entier strict : FedaPay refuse les décimales sur les paiements Mobile Money XOF.
    const amount = parsePositiveInt(req.body.amount, 'amount');
    if (amount <= 0) {
      throw new ValidationError('Le montant doit être supérieur à 0.');
    }

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        project: {
          include: {
            company: true,
            assignments: { where: { userId: userId! } },
          },
        },
      },
    });

    // Isolation multi-tenant : même règle que client-declare-payment (SUPER_ADMIN exempté).
    if (!document || (companyId && document.project.companyId !== companyId)) {
      return res.status(404).json({ error: 'Document introuvable.' });
    }

    const isManager = req.user?.role === 'COMPANY_ADMIN' || req.user?.role === 'TEAM_LEADER';
    const isAssigned = document.project.assignments.length > 0;
    if (!isManager && !isAssigned) {
      return res.status(403).json({ error: "Vous n'êtes pas autorisé à payer cette facture." });
    }

    if (document.type !== 'FACTURE') {
      return res.status(400).json({ error: 'Seules les factures peuvent être réglées par Mobile Money.' });
    }
    if (document.status === 'PAYE') {
      return res.status(400).json({ error: 'Cette facture est déjà entièrement réglée.' });
    }

    const remaining = document.amount - (document.paidAmount || 0);
    if (amount > remaining) {
      return res.status(400).json({
        error: `Le montant dépasse le reste à payer (${remaining.toLocaleString()} FCFA).`,
      });
    }

    const fedapayTransaction = await createTransaction({
      amount,
      description: `${document.title} — ${document.project.company.name}`,
      customerName: `${req.user!.email || 'Client'}`,
      customerPhone: phoneNumber,
      provider,
    });

    const saved = await prisma.mobileMoneyTransaction.create({
      data: {
        fedapayId: fedapayTransaction.id,
        documentId,
        amount,
        provider,
        phoneNumber,
        status: 'PENDING',
        createdByUserId: userId,
      },
    });

    // L'échec du push n'annule pas la transaction : elle reste PENDING et le
    // webhook (ou une relance manuelle côté FedaPay) tranchera son sort.
    let pushSent = true;
    try {
      await triggerDirectPayment(fedapayTransaction.id, provider);
    } catch (pushError) {
      pushSent = false;
      console.error('[payments] échec du push USSD', pushError);
    }

    res.status(201).json({
      message: pushSent
        ? 'Paiement initié. Validez la demande reçue sur votre téléphone.'
        : "Paiement créé, mais le push automatique a échoué. Réessayez si rien n'arrive sur votre téléphone.",
      transaction: saved,
      pushSent,
      operatorMethod: getOperatorMethod(provider),
    });
  } catch (err: any) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.message });
    }
    handleError(res, "l'initiation du paiement Mobile Money", err);
  }
});

// [CLIENT / GÉRANT / CHEF] Consulter le statut d'une transaction (polling, lecture seule)
router.get('/mobile-money/:id', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const companyId = req.user?.companyId;

  try {
    const transaction = await prisma.mobileMoneyTransaction.findUnique({
      where: { id: req.params.id },
      include: { document: { include: { project: true } } },
    });

    if (!transaction || (companyId && transaction.document.project.companyId !== companyId)) {
      return res.status(404).json({ error: 'Transaction introuvable.' });
    }

    res.json({
      id: transaction.id,
      status: transaction.status,
      amount: transaction.amount,
      failureReason: transaction.failureReason,
      document: {
        id: transaction.document.id,
        status: transaction.document.status,
        paidAmount: transaction.document.paidAmount,
        amount: transaction.document.amount,
      },
    });
  } catch (err) {
    handleError(res, 'la récupération du statut du paiement', err);
  }
});

// ─── WEBHOOK ──────────────────────────────────────────────────────────────────

/**
 * Notification FedaPay. AUCUNE authentification JWT : la sécurité repose
 * entièrement sur la vérification de signature HMAC ci-dessous, sur le corps
 * BRUT capturé dans `app.ts` (`req.rawBody`).
 */
router.post('/webhooks/fedapay', async (req: Request, res: Response) => {
  const rawBody: Buffer | undefined = (req as any).rawBody;
  const signature = req.header('x-fedapay-signature');

  if (!rawBody || !verifyWebhookSignature(rawBody, signature)) {
    console.error('[payments] webhook FedaPay refusé : signature invalide ou absente');
    return res.status(400).json({ error: 'Signature invalide.' });
  }

  const event = req.body;
  const fedapayTransaction = event?.data?.object ?? event?.data;
  const fedapayId: number | undefined = fedapayTransaction?.id;
  const eventName: string | undefined = event?.name;

  if (!fedapayId || !eventName) {
    // Corps signé mais forme inattendue : acquitté pour éviter les relances,
    // mais journalisé pour investigation.
    console.error('[payments] webhook FedaPay signé mais illisible', event);
    return res.status(200).json({ received: true });
  }

  try {
    const terminalStatus = mapFedaPayEventToStatus(eventName);
    if (!terminalStatus) {
      // Événement non géré (ex: transaction.created) : simple accusé de réception.
      return res.status(200).json({ received: true });
    }

    if (terminalStatus === 'APPROVED') {
      await approveTransaction(fedapayId, fedapayTransaction);
    } else {
      await markTransactionTerminal(fedapayId, terminalStatus, fedapayTransaction?.last_error_code);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[payments] erreur de traitement du webhook FedaPay', err);
    // 200 malgré l'erreur : la signature était valide, on ne veut pas de tempête
    // de relances FedaPay sur un bug applicatif. L'incident reste journalisé.
    res.status(200).json({ received: true });
  }
});

function mapFedaPayEventToStatus(eventName: string): 'APPROVED' | 'DECLINED' | 'CANCELED' | 'EXPIRED' | 'FAILED' | null {
  switch (eventName) {
    case 'transaction.approved':
      return 'APPROVED';
    case 'transaction.declined':
      return 'DECLINED';
    case 'transaction.canceled':
      return 'CANCELED';
    case 'transaction.expired':
      return 'EXPIRED';
    case 'transaction.transferred':
    case 'transaction.failed':
      return eventName === 'transaction.failed' ? 'FAILED' : null;
    default:
      return null;
  }
}

/**
 * Approuve une transaction : idempotent par construction — la transition
 * `PENDING -> APPROVED` est conditionnelle (`updateMany` sur `status: 'PENDING'`).
 * Si aucune ligne n'est modifiée (déjà traitée), on s'arrête : un webhook rejoué
 * ne peut donc jamais créer un second `Payment`.
 */
async function approveTransaction(fedapayId: number, fedapayTransaction: any): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.mobileMoneyTransaction.updateMany({
      where: { fedapayId, status: 'PENDING' },
      data: { status: 'APPROVED', fedapayReference: String(fedapayTransaction?.reference ?? '') },
    });
    if (count === 0) {
      return; // déjà traité (webhook rejoué) ou transaction inconnue : rien à faire
    }

    const mmTransaction = await tx.mobileMoneyTransaction.findUniqueOrThrow({
      where: { fedapayId },
      include: { document: true },
    });

    const document = mmTransaction.document;
    const remaining = document.amount - (document.paidAmount || 0);
    // Le montant crédité vient de LA NOTIFICATION FedaPay, jamais de la requête
    // client, et reste plafonné au reste à payer réel au moment de l'approbation.
    const notifiedAmount = Number(fedapayTransaction?.amount ?? mmTransaction.amount);
    const creditedAmount = Math.max(0, Math.min(notifiedAmount, remaining));

    const payment = await tx.payment.create({
      data: {
        documentId: document.id,
        amount: creditedAmount,
        status: 'VALIDE',
        createdByUserId: mmTransaction.createdByUserId,
        validatedByUserId: mmTransaction.createdByUserId,
      },
    });

    const newPaidAmount = document.paidAmount + creditedAmount;
    const newStatus = newPaidAmount >= document.amount ? 'PAYE' : 'PAYE_PARTIEL';

    await tx.document.update({
      where: { id: document.id },
      data: { paidAmount: newPaidAmount, status: newStatus, declaredPaidAmount: 0 },
    });

    await tx.mobileMoneyTransaction.update({
      where: { fedapayId },
      data: { paymentId: payment.id },
    });
  });

  // Hors transaction : réutilise la synchronisation existante du devis parent,
  // même flux que la validation manuelle d'un paiement.
  const mmTransaction = await prisma.mobileMoneyTransaction.findUnique({
    where: { fedapayId },
    include: { document: true },
  });
  if (mmTransaction) {
    await syncDevisStatus(mmTransaction.document.devisId);
  }
}

async function markTransactionTerminal(
  fedapayId: number,
  status: 'DECLINED' | 'CANCELED' | 'EXPIRED' | 'FAILED',
  failureReason?: string
): Promise<void> {
  // Même garde d'idempotence : seule une transaction encore PENDING est modifiée.
  await prisma.mobileMoneyTransaction.updateMany({
    where: { fedapayId, status: 'PENDING' },
    data: { status, failureReason: failureReason ? String(failureReason) : null },
  });
}

export default router;
