import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'eu-central-1',
  endpoint: process.env.AWS_S3_ENDPOINT || 'https://hel1.your-objectstorage.com',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
  forcePathStyle: true, // Requis pour la compatibilité avec la plupart des services S3 alternatifs
});

/**
 * Téléverse une image encodée en base64 vers AWS S3 ou compatible et renvoie l'URL publique.
 * @param base64Data Le contenu base64 (commençant par data:image/...)
 * @param folder Le sous-dossier de destination (ex: "photos", "signatures")
 */
export const uploadBase64ToS3 = async (base64Data: string, folder: string): Promise<string> => {
  // Extraire les données utiles du base64
  const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    throw new Error('Format de données base64 invalide.');
  }

  const contentType = matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  
  // Déterminer l'extension
  let extension = 'png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) extension = 'jpg';
  else if (contentType.includes('gif')) extension = 'gif';
  else if (contentType.includes('pdf')) extension = 'pdf';

  const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${extension}`;
  const bucketName = process.env.AWS_S3_BUCKET_NAME || 'ratoufa';

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileName,
    Body: buffer,
    ContentType: contentType,
    ACL: 'public-read', // Rend le fichier accessible publiquement par URL
  });

  await s3Client.send(command);

  // Générer l'URL publique
  const endpoint = process.env.AWS_S3_ENDPOINT || 'https://hel1.your-objectstorage.com';
  return `${endpoint}/${bucketName}/${fileName}`;
};
