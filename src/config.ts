import 'dotenv/config';

const secret = process.env.JWT_SECRET;

if (!secret) {
  throw new Error(
    'JWT_SECRET est manquant. Définissez-le dans le fichier .env avant de démarrer le serveur.'
  );
}

export const JWT_SECRET: string = secret;
