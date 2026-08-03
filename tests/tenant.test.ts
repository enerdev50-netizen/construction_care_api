import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app, request, createTenant, cleanupTestData, Tenant } from './helpers';

// Verrouille les correctifs d'isolation multi-tenant : l'entreprise A ne doit jamais
// accéder aux données de l'entreprise B via les endpoints jadis vulnérables.
describe('Isolation multi-tenant', () => {
  let A: Tenant;
  let B: Tenant;

  beforeAll(async () => {
    await cleanupTestData();
    A = await createTenant('A');
    B = await createTenant('B');
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it('A accède à son propre PDF (200)', async () => {
    const res = await request(app).get(`/documents/${A.documentId}/pdf`).set('Authorization', `Bearer ${A.token}`);
    expect(res.status).toBe(200);
  });

  it("A NE peut PAS lire le PDF de B (404)", async () => {
    const res = await request(app).get(`/documents/${B.documentId}/pdf`).set('Authorization', `Bearer ${A.token}`);
    expect(res.status).toBe(404);
  });

  it("A NE peut PAS signer le document de B (404)", async () => {
    const res = await request(app)
      .post(`/documents/${B.documentId}/sign`)
      .set('Authorization', `Bearer ${A.token}`)
      .send({ clientSignature: 'data:image/png;base64,AAAA' });
    expect(res.status).toBe(404);
  });

  it("A NE peut PAS déclarer un paiement sur la facture de B (404)", async () => {
    const res = await request(app)
      .post(`/documents/${B.documentId}/client-declare-payment`)
      .set('Authorization', `Bearer ${A.token}`)
      .send({ amount: 100, type: 'ACHATS' });
    expect(res.status).toBe(404);
  });
});
