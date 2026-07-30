/**
 * Point d'entrée en ligne de commande de l'amorçage de production.
 *
 *   npm run seed:prod     (développement, via ts-node)
 *   npm run deploy        (production, via `node dist/bootstrap/cli.js` après build)
 *
 * Crée uniquement les 3 forfaits système et 1 Super Administrateur.
 * Additif et idempotent : aucune suppression, rejouable à chaque déploiement.
 *
 * Utile lorsque l'hébergeur dispose d'une phase de release distincte du
 * démarrage. Sinon, `src/bootstrap/index.ts` fait le même travail au lancement
 * du serveur — voir BOOTSTRAP_ON_START.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedProduction } from './seedProduction';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Amorçage de production — forfaits système et Super Administrateur.');
  await seedProduction(prisma);
  console.log('✅ Amorçage terminé. Aucune donnée de démonstration créée.');
}

main()
  .catch((e: unknown) => {
    console.error(`\n❌ Amorçage interrompu : ${e instanceof Error ? e.message : e}`);
    // Code de sortie non nul : interrompt un déploiement automatisé.
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
