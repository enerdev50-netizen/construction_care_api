#!/bin/sh
# Applique les migrations versionnées avant de démarrer l'API.
#
# Historique : ce script utilisait `prisma db push --accept-data-loss`, faute de
# migrations versionnées dans le projet. Elles existent désormais
# (`prisma/migrations/`, cf. P1-6), et `db push --accept-data-loss` est
# dangereux sur une base de production : il aligne le schéma en supprimant sans
# confirmation les colonnes/tables absentes du schéma Prisma. `migrate deploy`
# est la commande prévue pour la production : elle applique uniquement les
# migrations en attente, n'en génère aucune et ne détruit rien.
#
# Idempotent : sans migration en attente, la base n'est pas modifiée.
# RUN_DB_MIGRATE=false pour désactiver (ex. schéma géré par un autre processus).
#
# Note : `src/bootstrap/` applique déjà migrations + amorçage au démarrage du
# serveur quand NODE_ENV=production. Les deux sont idempotents et donc sûrs
# cumulés ; pour ne garder qu'un seul mécanisme, désactiver l'autre via
# RUN_DB_MIGRATE=false ou BOOTSTRAP_ON_START=false.
set -e

if [ "${RUN_DB_MIGRATE:-true}" = "true" ]; then
  echo "▶ Application des migrations Prisma…"
  npx prisma migrate deploy
  echo "✓ Migrations à jour"
fi

exec "$@"
