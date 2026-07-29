import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, createTenant, cleanupTestData, Tenant } from './helpers';

// Régression spécifique MySQL : contrairement au type `text` illimité de PostgreSQL,
// une colonne MySQL non typée explicitement vaut VARCHAR(191) et rejette toute valeur
// plus longue. Les champs ci-dessous stockent des URL S3 ou, en repli quand l'envoi S3
// échoue, l'image Base64 complète — ils doivent donc rester en Text / LongText.
describe('MySQL — champs longs (Text / LongText)', () => {
  let t: Tenant;

  const longUrl = `https://hel1.your-objectstorage.com/ratoufa/${'segment-de-chemin-tres-long/'.repeat(12)}fichier.pdf`;
  const base64Image = `data:image/png;base64,${'A'.repeat(300_000)}`;

  beforeAll(async () => {
    await cleanupTestData();
    t = await createTenant('cols');
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it('URL longue (> 191 caractères) persistée sans troncature', async () => {
    expect(longUrl.length).toBeGreaterThan(191);

    const doc = await prisma.document.update({
      where: { id: t.documentId },
      data: { pdfUrl: longUrl },
    });
    expect(doc.pdfUrl).toBe(longUrl);
  });

  it('signature Base64 volumineuse persistée sans troncature', async () => {
    const doc = await prisma.document.update({
      where: { id: t.documentId },
      data: { clientSignature: base64Image },
    });
    expect(doc.clientSignature).toHaveLength(base64Image.length);
  });

  it('photo de chantier Base64 volumineuse persistée sans troncature', async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { companyId: t.companyId } });

    const photo = await prisma.progressPhoto.create({
      data: {
        projectId: t.projectId,
        photoUrl: base64Image,
        type: 'QUOTIDIEN',
        comment: 'Coulage de la dalle du RDC',
        takenById: admin.id,
      },
    });

    const reloaded = await prisma.progressPhoto.findUniqueOrThrow({ where: { id: photo.id } });
    expect(reloaded.photoUrl).toHaveLength(base64Image.length);
  });
});
