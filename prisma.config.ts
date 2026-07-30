/**
 * Configuration du CLI Prisma.
 *
 * Remplace la clé `package.json#prisma`, dépréciée et supprimée dans Prisma 7.
 *
 * ⚠️ Le chargement du `.env` n'est PAS automatique dans ce fichier (contrairement
 * au comportement historique du CLI) : d'où l'import explicite ci-dessous.
 * `dotenv` n'écrase jamais une variable déjà définie, donc
 * `dotenv -e .env.test -- prisma migrate deploy` (script `test:db:setup`)
 * continue de viser la base de test — même garantie que dans `vitest.config.ts`.
 */
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node prisma/seed.ts',
  },
});
