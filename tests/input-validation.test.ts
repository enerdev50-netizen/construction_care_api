import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app, request, prisma, createTenant, cleanupTestData, Tenant } from './helpers';

/**
 * Régression P1-4 : validation systématique des entrées (zod) sur les routes
 * projects/materials/documents/users/auth. Couvre spécifiquement les
 * lacunes fermées listées dans Docs/PRD/2026-07-30_validation-entrees-zod.md,
 * ainsi qu'une poignée de requêtes valides pour garantir la non-régression.
 */
describe('Validation des entrées — régression (P1-4)', () => {
  let tenant: Tenant;

  beforeAll(async () => {
    await cleanupTestData();
    tenant = await createTenant('validate');
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  const asTenant = (req: any) => req.set('Authorization', `Bearer ${tenant.token}`);

  describe('projects', () => {
    it('nom composé uniquement d’espaces → 400', async () => {
      const res = await asTenant(request(app).post('/projects')).send({
        name: '   ',
        startDate: '2026-08-01',
        endDate: '2026-12-31',
      });
      expect(res.status).toBe(400);
    });

    it('création valide → 201 (non-régression)', async () => {
      const res = await asTenant(request(app).post('/projects')).send({
        name: 'vitest-iso-validate-proj',
        startDate: '2026-08-01',
        endDate: '2026-12-31',
        budget: 1500,
      });
      expect(res.status).toBe(201);
      expect(res.body.budget).toBe(1500);
    });

    it('budget négatif → 400', async () => {
      const res = await asTenant(request(app).put(`/projects/${tenant.projectId}`)).send({
        budget: -500,
      });
      expect(res.status).toBe(400);
    });

    it('date de début invalide → 400', async () => {
      const res = await asTenant(request(app).post('/projects')).send({
        name: 'vitest-iso-validate-date',
        startDate: 'pas-une-date',
        endDate: '2026-12-31',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('materials', () => {
    let materialId: string;

    it('minStockAlert=0 explicite est conservé (bug corrigé : 0 était traité comme absent → 5)', async () => {
      const res = await asTenant(request(app).post('/materials')).send({
        name: 'vitest-iso-validate-materiau',
        minStockAlert: 0,
      });
      expect(res.status).toBe(201);
      expect(res.body.minStockAlert).toBe(0);
      materialId = res.body.id;
    });

    it('quantité négative sur un mouvement → 400', async () => {
      const res = await asTenant(request(app).post('/materials/movement')).send({
        materialId,
        type: 'ENTREE',
        quantity: -5,
      });
      expect(res.status).toBe(400);
    });

    it('quantité nulle sur un mouvement → 400 (strictement positif)', async () => {
      const res = await asTenant(request(app).post('/materials/movement')).send({
        materialId,
        type: 'ENTREE',
        quantity: 0,
      });
      expect(res.status).toBe(400);
    });

    it('type de mouvement inconnu → 400', async () => {
      const res = await asTenant(request(app).post('/materials/movement')).send({
        materialId,
        type: 'TRANSFERT',
        quantity: 5,
      });
      expect(res.status).toBe(400);
    });
  });

  describe('documents', () => {
    it('PUT /documents/:id avec un statut hors énumération → 400 (lacune fermée : aucun contrôle auparavant)', async () => {
      const res = await asTenant(request(app).put(`/documents/${tenant.documentId}`)).send({
        status: 'N_IMPORTE_QUOI',
      });
      expect(res.status).toBe(400);
    });

    it('PUT /documents/:id avec un statut valide → 200 (non-régression)', async () => {
      const res = await asTenant(request(app).put(`/documents/${tenant.documentId}`)).send({
        status: 'SIGNE',
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('SIGNE');
    });

    it('PUT /documents/:id/status avec un statut inconnu → 400', async () => {
      const res = await asTenant(request(app).put(`/documents/${tenant.documentId}/status`)).send({
        status: 'INVALIDE',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('users', () => {
    it('mot de passe trop court à la création → 400 (aucune longueur minimale auparavant)', async () => {
      const res = await asTenant(request(app).post('/users')).send({
        firstName: 'Test',
        lastName: 'Validation',
        phone: '90000001',
        role: 'WORKER',
        password: 'a',
      });
      expect(res.status).toBe(400);
    });

    it('création valide avec mot de passe conforme → 201 (non-régression)', async () => {
      const res = await asTenant(request(app).post('/users')).send({
        firstName: 'Test',
        lastName: 'Validation',
        phone: '90000002',
        role: 'WORKER',
        password: 'motdepasse',
      });
      expect(res.status).toBe(201);
      await prisma.user.delete({ where: { id: res.body.id } });
    });
  });

  describe('auth', () => {
    it('connexion sans téléphone ni email → 400', async () => {
      const res = await request(app).post('/auth/login').send({ password: 'peu-importe' });
      expect(res.status).toBe(400);
    });

    it('inscription sans mot de passe → 400', async () => {
      const res = await request(app).post('/auth/register').send({
        companyName: 'vitest-iso-validate-entreprise',
        companyPhone: '90000003',
        firstName: 'Test',
        lastName: 'Validation',
        email: 'vitest-iso-validate-noreg@test.com',
      });
      expect(res.status).toBe(400);
    });
  });
});
