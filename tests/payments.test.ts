import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { app, request, prisma, createTenant, cleanupTestData, TAG, TEST_PASSWORD, Tenant } from './helpers';

// Le SDK FedaPay est simulé : aucune clé réelle, aucun appel réseau. Seul le
// comportement de notre code (routes, webhook, idempotence) est sous test.
let nextFedapayId = 900000;
const generateTokenMock = vi.fn(async () => ({ token: 'tok_test' }));
const sendNowWithTokenMock = vi.fn(async () => ({ status: 'pending' }));

vi.mock('fedapay', () => ({
  FedaPay: { setApiKey: vi.fn(), setEnvironment: vi.fn() },
  Transaction: {
    create: vi.fn(async (data: any) => ({ id: nextFedapayId++, ...data })),
    retrieve: vi.fn(async (id: number) => ({
      id,
      generateToken: generateTokenMock,
      sendNowWithToken: sendNowWithTokenMock,
    })),
  },
}));

const WEBHOOK_SECRET = process.env.FEDAPAY_WEBHOOK_KEY!;

function signWebhookBody(rawBody: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},s=${signature}`;
}

function fedapayEvent(name: string, transaction: Record<string, any>) {
  return JSON.stringify({ name, data: { object: transaction } });
}

async function postWebhook(rawBody: string, signatureHeader?: string) {
  const req = request(app).post('/payments/webhooks/fedapay').set('Content-Type', 'application/json');
  if (signatureHeader !== undefined) req.set('x-fedapay-signature', signatureHeader);
  return req.send(rawBody);
}

describe('API Paiement Mobile Money (FedaPay)', () => {
  let tenantA: Tenant;
  let tenantB: Tenant;
  let unassignedClientToken: string;

  beforeAll(async () => {
    await cleanupTestData();
    await prisma.user.deleteMany({ where: { email: { startsWith: `${TAG}-` }, role: 'CLIENT' } });

    tenantA = await createTenant('pay-a');
    tenantB = await createTenant('pay-b');

    const client = await prisma.user.create({
      data: {
        email: `${TAG}-pay-client-non-assigne@test.com`,
        password: await bcrypt.hash(TEST_PASSWORD, 10),
        firstName: 'Client',
        lastName: 'NonAssigne',
        role: 'CLIENT',
        companyId: tenantA.companyId,
      },
    });
    const res = await request(app)
      .post('/auth/login')
      .send({ email: client.email, password: TEST_PASSWORD });
    unassignedClientToken = res.body.token;
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  const asA = (req: any) => req.set('Authorization', `Bearer ${tenantA.token}`);

  describe('initiation — validations', () => {
    it('montant valide, gérant assigné de fait → 201, transaction PENDING en base', async () => {
      const res = await asA(request(app).post('/payments/mobile-money')).send({
        documentId: tenantA.documentId,
        amount: 500,
        phoneNumber: '90000000',
        provider: 'togocel',
      });

      expect(res.status).toBe(201);
      expect(res.body.transaction.status).toBe('PENDING');
      expect(res.body.pushSent).toBe(true);

      const stored = await prisma.mobileMoneyTransaction.findUnique({
        where: { id: res.body.transaction.id },
      });
      expect(stored?.amount).toBe(500);
      expect(stored?.documentId).toBe(tenantA.documentId);
    });

    it('montant supérieur au reste à payer → 400', async () => {
      const res = await asA(request(app).post('/payments/mobile-money')).send({
        documentId: tenantA.documentId,
        amount: 999999,
        phoneNumber: '90000000',
        provider: 'togocel',
      });
      expect(res.status).toBe(400);
    });

    it('montant non entier → 400 (FedaPay XOF exige un entier)', async () => {
      const res = await asA(request(app).post('/payments/mobile-money')).send({
        documentId: tenantA.documentId,
        amount: 12.5,
        phoneNumber: '90000000',
        provider: 'togocel',
      });
      expect(res.status).toBe(400);
    });

    it('opérateur inconnu → 400', async () => {
      const res = await asA(request(app).post('/payments/mobile-money')).send({
        documentId: tenantA.documentId,
        amount: 100,
        phoneNumber: '90000000',
        provider: 'orange_money_mars',
      });
      expect(res.status).toBe(400);
    });

    it('document d’une autre entreprise → 404 (isolation multi-tenant)', async () => {
      const res = await asA(request(app).post('/payments/mobile-money')).send({
        documentId: tenantB.documentId,
        amount: 100,
        phoneNumber: '90000000',
        provider: 'togocel',
      });
      expect(res.status).toBe(404);
    });

    it('client non assigné au chantier → 403', async () => {
      const res = await request(app)
        .post('/payments/mobile-money')
        .set('Authorization', `Bearer ${unassignedClientToken}`)
        .send({
          documentId: tenantA.documentId,
          amount: 100,
          phoneNumber: '90000000',
          provider: 'togocel',
        });
      expect(res.status).toBe(403);
    });

    it('sans jeton → 401', async () => {
      const res = await request(app).post('/payments/mobile-money').send({
        documentId: tenantA.documentId,
        amount: 100,
        phoneNumber: '90000000',
        provider: 'togocel',
      });
      expect(res.status).toBe(401);
    });

    it('FedaPay non configuré → 503 (sans altérer la configuration des autres tests)', async () => {
      const saved = process.env.FEDAPAY_SECRET_KEY;
      delete process.env.FEDAPAY_SECRET_KEY;
      try {
        const res = await asA(request(app).post('/payments/mobile-money')).send({
          documentId: tenantA.documentId,
          amount: 100,
          phoneNumber: '90000000',
          provider: 'togocel',
        });
        expect(res.status).toBe(503);
      } finally {
        process.env.FEDAPAY_SECRET_KEY = saved;
      }
    });
  });

  describe('webhook — vérification de signature', () => {
    it('sans en-tête de signature → 400, aucune écriture', async () => {
      const fedapayId = nextFedapayId++;
      await prisma.mobileMoneyTransaction.create({
        data: { fedapayId, documentId: tenantA.documentId, amount: 100, provider: 'togocel', phoneNumber: '90000000' },
      });
      const rawBody = fedapayEvent('transaction.approved', { id: fedapayId, amount: 100, reference: 'ref' });

      const res = await postWebhook(rawBody);
      expect(res.status).toBe(400);

      const stored = await prisma.mobileMoneyTransaction.findUnique({ where: { fedapayId } });
      expect(stored?.status).toBe('PENDING');
    });

    it('signature invalide → 400, aucune écriture', async () => {
      const fedapayId = nextFedapayId++;
      await prisma.mobileMoneyTransaction.create({
        data: { fedapayId, documentId: tenantA.documentId, amount: 100, provider: 'togocel', phoneNumber: '90000000' },
      });
      const rawBody = fedapayEvent('transaction.approved', { id: fedapayId, amount: 100, reference: 'ref' });

      const res = await postWebhook(rawBody, 't=9999999999,s=deadbeef');
      expect(res.status).toBe(400);

      const stored = await prisma.mobileMoneyTransaction.findUnique({ where: { fedapayId } });
      expect(stored?.status).toBe('PENDING');
    });

    it('horodatage trop ancien (rejeu) → 400', async () => {
      const fedapayId = nextFedapayId++;
      await prisma.mobileMoneyTransaction.create({
        data: { fedapayId, documentId: tenantA.documentId, amount: 100, provider: 'togocel', phoneNumber: '90000000' },
      });
      const rawBody = fedapayEvent('transaction.approved', { id: fedapayId, amount: 100, reference: 'ref' });
      const staleTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1h — hors tolérance de 5 min

      const res = await postWebhook(rawBody, signWebhookBody(rawBody, staleTimestamp));
      expect(res.status).toBe(400);
    });
  });

  describe('webhook — approbation', () => {
    it('transaction.approved signé → Payment VALIDE créé, facture soldée (paiement total)', async () => {
      const fedapayId = nextFedapayId++;
      const mm = await prisma.mobileMoneyTransaction.create({
        data: {
          fedapayId,
          documentId: tenantA.documentId,
          amount: 1000,
          provider: 'togocel',
          phoneNumber: '90000000',
          createdByUserId: null,
        },
      });
      // La facture de createTenant vaut 1000, pas encore réglée.
      const rawBody = fedapayEvent('transaction.approved', { id: fedapayId, amount: 1000, reference: 'ref-full' });

      const res = await postWebhook(rawBody, signWebhookBody(rawBody));
      expect(res.status).toBe(200);

      const stored = await prisma.mobileMoneyTransaction.findUniqueOrThrow({ where: { fedapayId } });
      expect(stored.status).toBe('APPROVED');
      expect(stored.paymentId).not.toBeNull();

      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: stored.paymentId! } });
      expect(payment.status).toBe('VALIDE');
      expect(payment.amount).toBe(1000);

      const document = await prisma.document.findUniqueOrThrow({ where: { id: tenantA.documentId } });
      expect(document.paidAmount).toBe(1000);
      expect(document.status).toBe('PAYE');

      // Remise à zéro pour ne pas polluer les tests suivants sur le même document.
      await prisma.document.update({ where: { id: tenantA.documentId }, data: { paidAmount: 0, status: 'EN_ATTENTE' } });
      void mm;
    });

    it('webhook rejoué (même fedapayId) → aucune double écriture (idempotence)', async () => {
      const fedapayId = nextFedapayId++;
      await prisma.mobileMoneyTransaction.create({
        data: { fedapayId, documentId: tenantA.documentId, amount: 400, provider: 'togocel', phoneNumber: '90000000' },
      });
      const rawBody = fedapayEvent('transaction.approved', { id: fedapayId, amount: 400, reference: 'ref-replay' });
      const signature = signWebhookBody(rawBody);

      const res1 = await postWebhook(rawBody, signature);
      expect(res1.status).toBe(200);
      const res2 = await postWebhook(rawBody, signature);
      expect(res2.status).toBe(200);

      const payments = await prisma.payment.findMany({
        where: { document: { id: tenantA.documentId } },
      });
      // Un seul paiement Mobile Money doit exister pour ce montant précis (400),
      // même si le webhook a été reçu deux fois.
      expect(payments.filter((p) => p.amount === 400).length).toBe(1);

      const document = await prisma.document.findUniqueOrThrow({ where: { id: tenantA.documentId } });
      expect(document.paidAmount).toBe(400);
      expect(document.status).toBe('PAYE_PARTIEL');

      await prisma.payment.deleteMany({ where: { documentId: tenantA.documentId } });
      await prisma.document.update({ where: { id: tenantA.documentId }, data: { paidAmount: 0, status: 'EN_ATTENTE' } });
    });

    it('approbation partielle puis totale → PAYE_PARTIEL puis PAYE', async () => {
      const firstId = nextFedapayId++;
      await prisma.mobileMoneyTransaction.create({
        data: { fedapayId: firstId, documentId: tenantA.documentId, amount: 300, provider: 'togocel', phoneNumber: '90000000' },
      });
      const firstBody = fedapayEvent('transaction.approved', { id: firstId, amount: 300, reference: 'ref-1' });
      await postWebhook(firstBody, signWebhookBody(firstBody));

      let document = await prisma.document.findUniqueOrThrow({ where: { id: tenantA.documentId } });
      expect(document.status).toBe('PAYE_PARTIEL');
      expect(document.paidAmount).toBe(300);

      const secondId = nextFedapayId++;
      await prisma.mobileMoneyTransaction.create({
        data: { fedapayId: secondId, documentId: tenantA.documentId, amount: 700, provider: 'togocel', phoneNumber: '90000000' },
      });
      const secondBody = fedapayEvent('transaction.approved', { id: secondId, amount: 700, reference: 'ref-2' });
      await postWebhook(secondBody, signWebhookBody(secondBody));

      document = await prisma.document.findUniqueOrThrow({ where: { id: tenantA.documentId } });
      expect(document.status).toBe('PAYE');
      expect(document.paidAmount).toBe(1000);

      await prisma.payment.deleteMany({ where: { documentId: tenantA.documentId } });
      await prisma.document.update({ where: { id: tenantA.documentId }, data: { paidAmount: 0, status: 'EN_ATTENTE' } });
    });
  });

  describe('webhook — refus', () => {
    it('transaction.declined signé → transaction marquée, facture intacte', async () => {
      const fedapayId = nextFedapayId++;
      await prisma.mobileMoneyTransaction.create({
        data: { fedapayId, documentId: tenantA.documentId, amount: 100, provider: 'togocel', phoneNumber: '90000000' },
      });
      const rawBody = fedapayEvent('transaction.declined', { id: fedapayId, last_error_code: 'insufficient_funds' });

      const res = await postWebhook(rawBody, signWebhookBody(rawBody));
      expect(res.status).toBe(200);

      const stored = await prisma.mobileMoneyTransaction.findUniqueOrThrow({ where: { fedapayId } });
      expect(stored.status).toBe('DECLINED');
      expect(stored.paymentId).toBeNull();

      const document = await prisma.document.findUniqueOrThrow({ where: { id: tenantA.documentId } });
      expect(document.status).toBe('EN_ATTENTE');
      expect(document.paidAmount).toBe(0);
    });
  });

  describe('polling du statut', () => {
    it('transaction accessible par le tenant propriétaire', async () => {
      const fedapayId = nextFedapayId++;
      const mm = await prisma.mobileMoneyTransaction.create({
        data: { fedapayId, documentId: tenantA.documentId, amount: 50, provider: 'togocel', phoneNumber: '90000000' },
      });
      const res = await asA(request(app).get(`/payments/mobile-money/${mm.id}`));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PENDING');
    });

    it('transaction d’une autre entreprise → 404', async () => {
      const fedapayId = nextFedapayId++;
      const mm = await prisma.mobileMoneyTransaction.create({
        data: { fedapayId, documentId: tenantB.documentId, amount: 50, provider: 'togocel', phoneNumber: '90000000' },
      });
      const res = await asA(request(app).get(`/payments/mobile-money/${mm.id}`));
      expect(res.status).toBe(404);
    });
  });
});
