import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Charge `.env.test` au moment de la configuration : les variables sont injectées dans
// l'environnement des tests AVANT que `src/app.ts` n'exécute `import 'dotenv/config'`.
// dotenv n'écrase jamais une variable déjà définie, la base de test l'emporte donc sur `.env`.
const testEnv = config({ path: '.env.test' }).parsed ?? {};

if (!testEnv.DATABASE_URL) {
  throw new Error(
    "`.env.test` est manquant ou n'expose pas DATABASE_URL. " +
      'Les tests doivent viser la base dédiée `constructcare_test`, jamais la base de développement.'
  );
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: testEnv,
    // Les tests écrivent dans une vraie base MySQL : exécution en série pour éviter
    // les interférences entre fichiers sur les mêmes tables.
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
