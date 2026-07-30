import app from './app';
import { bootstrap } from './bootstrap';

const PORT = process.env.PORT || 3000;

async function start() {
  // Migrations et données indispensables appliquées AVANT d'ouvrir le port :
  // le serveur n'accepte jamais de requête sur une base non prête.
  await bootstrap();

  app.listen(PORT as number, '0.0.0.0', () => {
    console.log(`🚀 Serveur démarré sur http://0.0.0.0:${PORT}`);
  });
}

start().catch((err: unknown) => {
  console.error(`\n❌ Démarrage interrompu : ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
