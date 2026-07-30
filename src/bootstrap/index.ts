/**
 * Amorçage exécuté au démarrage du serveur, avant d'accepter des requêtes.
 *
 * Applique les migrations en attente puis crée les données indispensables
 * (3 forfaits système + 1 Super Administrateur). Les deux opérations sont
 * idempotentes : elles peuvent être rejouées à chaque déploiement et à chaque
 * redémarrage d'instance.
 *
 * Activation :
 *   - actif par défaut lorsque NODE_ENV=production (déploiement en une commande) ;
 *   - inactif ailleurs, pour ne pas ralentir le développement et les tests ;
 *   - BOOTSTRAP_ON_START=true|false force le comportement dans les deux sens
 *     (utile quand le déploiement dispose d'une phase de release dédiée).
 *
 * En cas d'échec, le serveur REFUSE de démarrer : sans les forfaits système,
 * l'inscription d'entreprise et le contrôle des quotas ne peuvent pas fonctionner.
 * Mieux vaut un déploiement interrompu qu'une plateforme en ligne et cassée.
 */
import { prisma } from '../prisma';
import { runMigrations } from './migrate';
import { seedProduction } from './seedProduction';

export type Logger = (message: string) => void;

export function isBootstrapEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.BOOTSTRAP_ON_START === 'true') return true;
  if (env.BOOTSTRAP_ON_START === 'false') return false;
  return env.NODE_ENV === 'production';
}

export async function bootstrap(log: Logger = console.log): Promise<void> {
  if (!isBootstrapEnabled()) {
    return;
  }

  log('🚀 Amorçage au démarrage (migrations + données indispensables).');
  await runMigrations(log);
  await seedProduction(prisma, log);
  log('✅ Amorçage terminé — le serveur peut accepter des requêtes.');
}
