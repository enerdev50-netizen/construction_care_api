#!/bin/sh
# Synchronise le schéma sur la base avant de démarrer l'API.
#
# `prisma db push` est utilisé plutôt que `migrate deploy` car le projet n'a pas
# de dossier de migrations versionnées. Il est idempotent : sans changement de
# schéma, il ne touche pas à la base.
#
# RUN_DB_PUSH=false pour désactiver (ex. si le schéma est géré manuellement).
set -e

if [ "${RUN_DB_PUSH:-true}" = "true" ]; then
  echo "▶ Synchronisation du schéma Prisma…"
  npx prisma db push --skip-generate --accept-data-loss
  echo "✓ Schéma synchronisé"
fi

exec "$@"
