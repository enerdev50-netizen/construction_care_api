import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app, request, createTenant, cleanupTestData, TEST_PASSWORD, Tenant } from './helpers';

describe('Authentification', () => {
  let tenant: Tenant;

  beforeAll(async () => {
    await cleanupTestData();
    tenant = await createTenant('auth');
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it('connexion avec les bons identifiants renvoie un token et pose le cookie de refresh', async () => {
    const res = await request(app).post('/auth/login').send({ email: tenant.adminEmail, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('refresh_token='))).toBe(true);
  });

  it('connexion avec un mauvais mot de passe échoue (401)', async () => {
    const res = await request(app).post('/auth/login').send({ email: tenant.adminEmail, password: 'mauvais' });
    expect(res.status).toBe(401);
  });

  it('une route protégée sans token renvoie 401', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('une route protégée avec token valide renvoie 200', async () => {
    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${tenant.token}`);
    expect(res.status).toBe(200);
  });

  it('/auth/refresh sans cookie renvoie 401', async () => {
    const res = await request(app).post('/auth/refresh');
    expect(res.status).toBe(401);
  });

  it('/auth/refresh avec le cookie de login renvoie un nouveau token', async () => {
    const login = await request(app).post('/auth/login').send({ email: tenant.adminEmail, password: TEST_PASSWORD });
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const res = await request(app).post('/auth/refresh').set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });
});
