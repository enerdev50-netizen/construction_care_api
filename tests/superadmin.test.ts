import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import {
  app,
  request,
  prisma,
  createTenant,
  cleanupTestData,
  ensureSystemPlans,
  TAG,
  TEST_PASSWORD,
  Tenant,
} from './helpers';

const CUSTOM_PLAN = 'VITEST_ENTREP';
const OTHER_PLAN = 'VITEST_AUTRE';
const SUPERADMIN_EMAIL = `${TAG}-superadmin@test.com`;

const validPlanBody = {
  maxProjects: 42,
  maxUsers: 7,
  price: 25000,
  durationDays: 90,
  features: ['GEOLOCALISATION', 'MATERIAUX'],
};

describe('API Super Admin — forfaits & entreprises', () => {
  let tenant: Tenant;
  let superToken: string;

  async function cleanupPlans() {
    await prisma.subscriptionConfig.deleteMany({
      where: { planName: { in: [CUSTOM_PLAN, OTHER_PLAN] } },
    });
  }

  beforeAll(async () => {
    await cleanupTestData();
    await cleanupPlans();
    await ensureSystemPlans();
    await prisma.user.deleteMany({ where: { email: SUPERADMIN_EMAIL } });

    tenant = await createTenant('admin');

    // Le SUPER_ADMIN n'est rattaché à aucune entreprise : il est créé hors createTenant.
    await prisma.user.create({
      data: {
        email: SUPERADMIN_EMAIL,
        password: await bcrypt.hash(TEST_PASSWORD, 10),
        firstName: 'Super',
        lastName: 'Vitest',
        role: 'SUPER_ADMIN',
      },
    });
    const res = await request(app)
      .post('/auth/login')
      .send({ email: SUPERADMIN_EMAIL, password: TEST_PASSWORD });
    superToken = res.body.token;
  });

  afterAll(async () => {
    await cleanupPlans();
    await prisma.user.deleteMany({ where: { email: SUPERADMIN_EMAIL } });
    await cleanupTestData();
  });

  const asSuper = (req: any) => req.set('Authorization', `Bearer ${superToken}`);

  describe('contrôle d’accès', () => {
    it('sans jeton → 401', async () => {
      const res = await request(app).get('/superadmin/plans');
      expect(res.status).toBe(401);
    });

    it('avec un jeton COMPANY_ADMIN → 403', async () => {
      const res = await request(app)
        .get('/superadmin/plans')
        .set('Authorization', `Bearer ${tenant.token}`);
      expect(res.status).toBe(403);
    });
  });

  describe('création de forfait', () => {
    it('forfait personnalisé créé → 201', async () => {
      const res = await asSuper(request(app).post('/superadmin/plans')).send({
        planName: CUSTOM_PLAN,
        ...validPlanBody,
      });
      expect(res.status).toBe(201);
      expect(res.body.planName).toBe(CUSTOM_PLAN);
      expect(res.body.durationDays).toBe(90);
    });

    it('doublon → 409', async () => {
      const res = await asSuper(request(app).post('/superadmin/plans')).send({
        planName: CUSTOM_PLAN,
        ...validPlanBody,
      });
      expect(res.status).toBe(409);
    });

    it('maxProjects non numérique → 400', async () => {
      const res = await asSuper(request(app).post('/superadmin/plans')).send({
        planName: OTHER_PLAN,
        ...validPlanBody,
        maxProjects: 'abc',
      });
      expect(res.status).toBe(400);
    });

    it('maxUsers négatif → 400', async () => {
      const res = await asSuper(request(app).post('/superadmin/plans')).send({
        planName: OTHER_PLAN,
        ...validPlanBody,
        maxUsers: -5,
      });
      expect(res.status).toBe(400);
    });

    it('features contenant un objet → 400', async () => {
      const res = await asSuper(request(app).post('/superadmin/plans')).send({
        planName: OTHER_PLAN,
        ...validPlanBody,
        features: [{}],
      });
      expect(res.status).toBe(400);
    });

    it('features contenant une virgule → 400 (corromprait le stockage CSV)', async () => {
      const res = await asSuper(request(app).post('/superadmin/plans')).send({
        planName: OTHER_PLAN,
        ...validPlanBody,
        features: ['PDF,SIGNATURE'],
      });
      expect(res.status).toBe(400);
    });

    it('planName de plus de 20 caractères → 400', async () => {
      const res = await asSuper(request(app).post('/superadmin/plans')).send({
        planName: 'FORFAIT_BEAUCOUP_TROP_LONG_POUR_LA_COLONNE',
        ...validPlanBody,
      });
      expect(res.status).toBe(400);
    });
  });

  describe('modification de forfait', () => {
    it('forfait existant → 200', async () => {
      const res = await asSuper(request(app).put(`/superadmin/plans/${CUSTOM_PLAN}`)).send({
        ...validPlanBody,
        price: 30000,
      });
      expect(res.status).toBe(200);
      expect(res.body.price).toBe(30000);
    });

    it('forfait inexistant → 404', async () => {
      const res = await asSuper(request(app).put('/superadmin/plans/VITEST_NEANT')).send(validPlanBody);
      expect(res.status).toBe(404);
    });
  });

  describe('attribution du forfait à une entreprise', () => {
    it('forfait personnalisé attribuable → 200 (régression : liste en dur)', async () => {
      const res = await asSuper(
        request(app).put(`/superadmin/companies/${tenant.companyId}/plan`)
      ).send({ plan: CUSTOM_PLAN });

      expect(res.status).toBe(200);
      expect(res.body.subscriptionPlan).toBe(CUSTOM_PLAN);

      const company = await prisma.company.findUniqueOrThrow({ where: { id: tenant.companyId } });
      expect(company.subscriptionPlan).toBe(CUSTOM_PLAN);
    });

    it('forfait système toujours attribuable → 200', async () => {
      const res = await asSuper(
        request(app).put(`/superadmin/companies/${tenant.companyId}/plan`)
      ).send({ plan: 'PREMIUM' });
      expect(res.status).toBe(200);
    });

    it('forfait inconnu → 400', async () => {
      const res = await asSuper(
        request(app).put(`/superadmin/companies/${tenant.companyId}/plan`)
      ).send({ plan: 'VITEST_NEANT' });
      expect(res.status).toBe(400);
    });

    it('entreprise inexistante → 404', async () => {
      const res = await asSuper(
        request(app).put('/superadmin/companies/id-inexistant/plan')
      ).send({ plan: 'PREMIUM' });
      expect(res.status).toBe(404);
    });
  });

  describe('suppression de forfait', () => {
    it('forfait système → 403', async () => {
      const res = await asSuper(request(app).delete('/superadmin/plans/FREE'));
      expect(res.status).toBe(403);
    });

    it('forfait encore utilisé → 409', async () => {
      await asSuper(request(app).put(`/superadmin/companies/${tenant.companyId}/plan`)).send({
        plan: CUSTOM_PLAN,
      });

      const res = await asSuper(request(app).delete(`/superadmin/plans/${CUSTOM_PLAN}`));
      expect(res.status).toBe(409);
    });

    it('forfait inutilisé → 200', async () => {
      await asSuper(request(app).put(`/superadmin/companies/${tenant.companyId}/plan`)).send({
        plan: 'PREMIUM',
      });

      const res = await asSuper(request(app).delete(`/superadmin/plans/${CUSTOM_PLAN}`));
      expect(res.status).toBe(200);

      const gone = await prisma.subscriptionConfig.findUnique({ where: { planName: CUSTOM_PLAN } });
      expect(gone).toBeNull();
    });

    it('forfait inexistant → 404', async () => {
      const res = await asSuper(request(app).delete('/superadmin/plans/VITEST_NEANT'));
      expect(res.status).toBe(404);
    });
  });
});
