import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app, request, createTenant, cleanupTestData, Tenant } from './helpers';

describe('Chantiers — budget & tâches', () => {
  let t: Tenant;

  beforeAll(async () => {
    await cleanupTestData();
    t = await createTenant('proj');
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it('création d’un chantier avec budget → budget persisté', async () => {
    const res = await request(app)
      .post('/projects')
      .set('Authorization', `Bearer ${t.token}`)
      .send({ name: 'vitest-iso-budget', startDate: '2026-08-01', endDate: '2026-12-31', budget: 5000000 });
    expect(res.status).toBe(201);
    expect(res.body.budget).toBe(5000000);
  });

  it('modification du budget via PUT → nouvelle valeur persistée', async () => {
    const created = await request(app)
      .post('/projects')
      .set('Authorization', `Bearer ${t.token}`)
      .send({ name: 'vitest-iso-budget2', startDate: '2026-08-01', endDate: '2026-12-31', budget: 1000 });
    const id = created.body.id;

    const res = await request(app)
      .put(`/projects/${id}`)
      .set('Authorization', `Bearer ${t.token}`)
      .send({ budget: 9999 });
    expect(res.status).toBe(200);
    expect(res.body.budget).toBe(9999);
  });

  it('création puis suppression d’une tâche', async () => {
    const created = await request(app)
      .post(`/projects/${t.projectId}/tasks`)
      .set('Authorization', `Bearer ${t.token}`)
      .send({ name: 'Coulage dalle RDC' });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('A_FAIRE');

    const del = await request(app)
      .delete(`/projects/${t.projectId}/tasks/${created.body.id}`)
      .set('Authorization', `Bearer ${t.token}`);
    expect(del.status).toBe(200);
  });
});
