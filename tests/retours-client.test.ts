import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app, request, prisma, createTenant, cleanupTestData, ensureSystemPlans, Tenant } from './helpers';

// Couvre le lot de retours client du 2026-08-03 : Payment.type, calculs financiers
// unifiés du chantier (Trésorerie/Reste à payer/Avance globale), Cahier des charges
// et matériaux scopés par chantier.
describe('Retours client — Payment.type, finances chantier, cahier des charges, stock par chantier', () => {
  let A: Tenant;

  beforeAll(async () => {
    await ensureSystemPlans();
    await cleanupTestData();
    A = await createTenant('rc');
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it('record-payment refuse une requête sans type (validation)', async () => {
    const res = await request(app)
      .post(`/documents/${A.documentId}/record-payment`)
      .set('Authorization', `Bearer ${A.token}`)
      .send({ amount: 100 });
    expect(res.status).toBe(400);
  });

  it('record-payment persiste le type MAIN_DOEUVRE fourni', async () => {
    const res = await request(app)
      .post(`/documents/${A.documentId}/record-payment`)
      .set('Authorization', `Bearer ${A.token}`)
      .send({ amount: 200, type: 'MAIN_DOEUVRE' });
    expect(res.status).toBe(200);

    const payment = await prisma.payment.findFirst({ where: { documentId: A.documentId } });
    expect(payment?.type).toBe('MAIN_DOEUVRE');
    expect(payment?.status).toBe('VALIDE');
  });

  it('GET /projects/:id expose tresorerieDisponible / resteAPayer / avanceGlobale calculés sur les Payment VALIDE', async () => {
    await prisma.project.update({ where: { id: A.projectId }, data: { budget: 1000 } });

    const res = await request(app)
      .get(`/projects/${A.projectId}`)
      .set('Authorization', `Bearer ${A.token}`);

    expect(res.status).toBe(200);
    expect(res.body.tresorerieDisponible).toBe(200);
    expect(res.body.resteAPayer).toBe(800);
    expect(res.body.avanceGlobale).toBe(20);
  });

  it('resteAPayer ne descend jamais sous 0 même si la trésorerie dépasse le budget', async () => {
    await prisma.project.update({ where: { id: A.projectId }, data: { budget: 100 } });

    const res = await request(app)
      .get(`/projects/${A.projectId}`)
      .set('Authorization', `Bearer ${A.token}`);

    expect(res.body.tresorerieDisponible).toBe(200);
    expect(res.body.resteAPayer).toBe(0);
    expect(res.body.avanceGlobale).toBe(100);
  });

  it('Cahier des charges : POST crée une entrée pour une date, GET la retrouve', async () => {
    const postRes = await request(app)
      .post('/sitelog')
      .set('Authorization', `Bearer ${A.token}`)
      .send({
        projectId: A.projectId,
        date: '2026-08-03',
        items: [{ label: 'Coulage dalle RDC', done: false }],
      });
    expect(postRes.status).toBe(201);
    expect(postRes.body.items).toHaveLength(1);

    const getRes = await request(app)
      .get('/sitelog')
      .set('Authorization', `Bearer ${A.token}`)
      .query({ projectId: A.projectId, date: '2026-08-03' });
    expect(getRes.status).toBe(200);
    expect(getRes.body.items[0].label).toBe('Coulage dalle RDC');
  });

  it('Cahier des charges : un second POST sur la même date met à jour (upsert), ne duplique pas', async () => {
    await request(app)
      .post('/sitelog')
      .set('Authorization', `Bearer ${A.token}`)
      .send({
        projectId: A.projectId,
        date: '2026-08-03',
        items: [{ label: 'Coulage dalle RDC', done: true }],
      });

    const entries = await prisma.siteLogEntry.findMany({ where: { projectId: A.projectId } });
    expect(entries).toHaveLength(1);
    expect((entries[0].items as any)[0].done).toBe(true);
  });

  it('Cahier des charges : un WORKER ne peut pas écrire (403)', async () => {
    const workerEmail = `${A.adminEmail}-worker`;
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('Vitest@2026', 10);
    await prisma.user.create({
      data: { email: workerEmail, password: hash, firstName: 'W', lastName: 'Orker', role: 'WORKER', companyId: A.companyId },
    });
    const loginRes = await request(app).post('/auth/login').send({ email: workerEmail, password: 'Vitest@2026' });

    const res = await request(app)
      .post('/sitelog')
      .set('Authorization', `Bearer ${loginRes.body.token}`)
      .send({ projectId: A.projectId, date: '2026-08-04', items: [] });
    expect(res.status).toBe(403);
  });

  it('Matériaux : un matériau créé avec projectId est scopé à ce chantier', async () => {
    const otherProject = await prisma.project.create({
      data: { name: 'rc-other-proj', startDate: new Date(), endDate: new Date(), companyId: A.companyId },
    });

    const createRes = await request(app)
      .post('/materials')
      .set('Authorization', `Bearer ${A.token}`)
      .send({ name: 'Ciment RC', projectId: A.projectId, unit: 'sacs', initialStock: 10 });
    expect(createRes.status).toBe(201);
    expect(createRes.body.projectId).toBe(A.projectId);

    const listForProject = await request(app)
      .get('/materials')
      .set('Authorization', `Bearer ${A.token}`)
      .query({ projectId: A.projectId });
    expect(listForProject.body.some((m: any) => m.id === createRes.body.id)).toBe(true);

    const listForOtherProject = await request(app)
      .get('/materials')
      .set('Authorization', `Bearer ${A.token}`)
      .query({ projectId: otherProject.id });
    expect(listForOtherProject.body.some((m: any) => m.id === createRes.body.id)).toBe(false);

    await prisma.material.deleteMany({ where: { id: createRes.body.id } });
    await prisma.project.delete({ where: { id: otherProject.id } });
  });
});
