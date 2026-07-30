/**
 * Application des migrations Prisma au démarrage.
 *
 * `prisma migrate deploy` est la commande prévue pour la production : elle
 * applique les migrations en attente, n'en génère jamais de nouvelle et ne
 * demande aucune confirmation. Elle est idempotente et pose un verrou côté
 * SGBD, ce qui rend sûr le démarrage simultané de plusieurs instances.
 *
 * Prisma n'expose pas d'API programmatique pour cette commande : le CLI est
 * la voie officielle. `prisma` est donc une dépendance de production et non
 * une dépendance de développement.
 */
import { spawn } from 'child_process';

export type Logger = (message: string) => void;

const MIGRATION_TIMEOUT_MS = 120_000;

export function runMigrations(log: Logger = console.log): Promise<void> {
  return new Promise((resolve, reject) => {
    log('⏳ Application des migrations Prisma...');

    const child = spawn(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
      { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Les migrations ont dépassé ${MIGRATION_TIMEOUT_MS / 1000} s.\n${output}`));
    }, MIGRATION_TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        log('✅ Migrations à jour.');
        return resolve();
      }
      reject(new Error(`\`prisma migrate deploy\` a échoué (code ${code}).\n${output}`));
    });
  });
}
